import {normalizeExchanges} from '../src/data/portfolio-sessions.mjs';
const fail=(status,message)=>Object.assign(Error(message),{status});
export function createPortfolioMetadata(db,{now,credential,decode,account,isClosed,request}){
  db.exec('CREATE TABLE IF NOT EXISTS portfolio_metadata(account_id TEXT NOT NULL,kind TEXT NOT NULL,generation TEXT NOT NULL,detail TEXT NOT NULL,PRIMARY KEY(account_id,kind))');
  const pending=new Map();
  const saved=(id,kind,g)=>{const row=db.prepare('SELECT * FROM portfolio_metadata WHERE account_id=? AND kind=?').get(id,kind);return row?.generation===g?JSON.parse(row.detail):{};};
  const save=(id,kind,g,s)=>db.prepare('INSERT INTO portfolio_metadata VALUES(?,?,?,?) ON CONFLICT(account_id,kind) DO UPDATE SET generation=excluded.generation,detail=excluded.detail').run(id,kind,g,JSON.stringify(s));
  async function load(id,kind){
    account(id);const record=credential(id);if(!record)throw fail(400,'Connect this account to read its trading hours.');
    const g=record.generation,key=id+':'+kind+':'+g,s=saved(id,kind,g);
    if(s.items&&s.at+600000>now())return s;
    if(pending.has(key))return pending.get(key);
    if(s.retryAt>now())throw fail(429,s.error||'Broker metadata is waiting for its next refresh.');
    const task=(async()=>{
      save(id,kind,g,{...s,retryAt:now()+60000});
      try{
        const raw=await request('/equity/metadata/'+kind,decode(record,id));
        if(isClosed()||credential(id)?.generation!==g)throw fail(409,'The account connection changed.');
        let items;
        if(kind==='exchanges')items=normalizeExchanges(raw);
        else {
          if(!Array.isArray(raw)||raw.length>40000)throw Error('Invalid instrument catalog.');
          items=raw.filter(r=>r&&typeof r.ticker==='string'&&/^[A-Za-z0-9._-]{1,80}$/.test(r.ticker)&&typeof r.name==='string'&&/^[A-Z]{3}$/.test(r.currencyCode)).map(r=>({ticker:r.ticker,name:r.name.slice(0,160),currencyCode:r.currencyCode,type:r.type,isin:typeof r.isin==='string'?r.isin.slice(0,20):'',maxOpenQuantity:Number.isFinite(r.maxOpenQuantity)?r.maxOpenQuantity:null,extendedHours:r.extendedHours===true,workingScheduleId:Number.isSafeInteger(r.workingScheduleId)?r.workingScheduleId:null}));
        }
        const next={items,at:now(),retryAt:now()+600000};save(id,kind,g,next);return next;
      }catch(e){
        if(!isClosed()&&credential(id)?.generation===g)save(id,kind,g,{...s,retryAt:now()+Math.max(60000,e.retryMs||300000),error:'Trading hours could not be refreshed. Check Metadata read permission on the broker key.'});
        throw e.status?e:fail(502,'Trading 212 schedules could not be read.');
      }
    })();pending.set(key,task);try{return await task;}finally{pending.delete(key);}
  }
  async function instruments(id){return (await load(id,'instruments')).items;}
  async function hours(id,ticker){
    if(ticker&&!/^[A-Za-z0-9._-]{1,80}$/.test(ticker))throw fail(400,'Choose a valid instrument.');
    const a=account(id),g=credential(id)?.generation;
    try{
      const catalog=await load(id,'instruments'),schedules=await load(id,'exchanges');
      if(isClosed()||credential(id)?.generation!==g)throw fail(409,'The connection changed.');
      const selected=new Set(ticker?[ticker]:a.snapshot?.holdings.map(h=>h.ticker)||[]);
      return {fetchedAt:Math.min(catalog.at,schedules.at),source:'Trading 212',items:catalog.items.filter(i=>selected.has(i.ticker)).map(i=>{const schedule=schedules.items[i.workingScheduleId];return {ticker:i.ticker,name:i.name,extendedHours:i.extendedHours,scheduleId:i.workingScheduleId,exchange:schedule?.exchange,events:schedule?.events.filter(e=>i.extendedHours||['OPEN','CLOSE','BREAK_START','BREAK_END'].includes(e.type))};})};
    }catch(e){return {fetchedAt:null,items:[],error:e.status===400?e.message:'Trading hours could not be refreshed. Check Metadata read permission on the broker key. Broker limits may delay updates.'};}
  }
  function remove(id){db.prepare('DELETE FROM portfolio_metadata WHERE account_id=?').run(id);}
  return {instruments,hours,remove};
}
