import {randomUUID} from 'node:crypto';
import {parseLevels,parseWatchlist} from '../src/data/market.js';
import {portfolioListing} from '../src/data/portfolio-listings.mjs';
const fail=(status,message)=>Object.assign(Error(message),{status});
const identity=a=>a?.snapshot?.source==='api'?`${a.environment}:${a.snapshot.brokerId}`:null;
export function priceCrossed(rule,previous,price){
  if(!Number.isFinite(previous)||!Number.isFinite(price))return false;
  if(rule.mode==='above')return previous<rule.price&&price>=rule.price;
  if(rule.mode==='below')return previous>rule.price&&price<=rule.price;
  return (previous<rule.low||previous>rule.high)&&price>=rule.low&&price<=rule.high;
}
export function createPortfolioAlerts(db,{now,account,accounts,credential,isClosed,workspace,quote,activity}){
  db.exec('CREATE TABLE IF NOT EXISTS portfolio_price_alerts(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,identity TEXT NOT NULL,revision INTEGER NOT NULL,detail TEXT NOT NULL)');
  let checking=false,nextCheck=0;
  function context(){const raw=workspace()||{};let watchlist=[],sheet=null;try{watchlist=parseWatchlist(raw.watchText||'',{allowEmpty:true});}catch{}try{sheet=parseLevels(raw.levelText||'',raw.levelSourceDates);}catch{}return {watchlist,sheet};}
  function choices(){
    const root=accounts(),{watchlist,sheet}=context();
    return root.accounts.filter(a=>a.connected&&identity(a)).flatMap(a=>(a.snapshot.holdings||[]).flatMap(h=>{
      const listing=portfolioListing(h,watchlist);if(!listing)return [];
      const instrument=sheet?.instruments[listing.symbol],zones=instrument&&!instrument.futures?instrument.zones.map((z,i)=>({...z,id:String(i),date:instrument.sourceDate||sheet.date,timeframe:instrument.timeframe})):[];
      return [{accountId:a.id,ticker:h.ticker,name:h.name,listing:listing.id,currency:h.instrumentCurrency,person:root.people.find(p=>p.id===a.personId)?.name,label:a.label,environment:a.environment,zones}];
    }));
  }
  const get=id=>{const row=db.prepare('SELECT * FROM portfolio_price_alerts WHERE id=?').get(id);return row?{...JSON.parse(row.detail),id:row.id,accountId:row.account_id,identity:row.identity,revision:row.revision}:null;};
  const save=r=>db.prepare('INSERT INTO portfolio_price_alerts VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,detail=excluded.detail').run(r.id,r.accountId,r.identity,r.revision,JSON.stringify(r));
  function read(){const root=accounts();return {choices:choices(),rules:db.prepare('SELECT id FROM portfolio_price_alerts').all().map(row=>get(row.id)).filter(r=>root.accounts.some(a=>a.id===r.accountId&&identity(a)===r.identity)).map(r=>{const a=account(r.accountId);return {...r,person:root.people.find(p=>p.id===a.personId)?.name,accountLabel:a.label,environment:a.environment,connected:!!credential(a.id)};})};}
  function create(input){
    const choice=choices().find(c=>c.accountId===input?.accountId&&c.ticker===input?.ticker);
    if(!choice)throw fail(400,'Choose a connected holding with a verified market listing.');
    if(db.prepare('SELECT count(*) n FROM portfolio_price_alerts').get().n>=100)throw fail(400,'Up to 100 price alert rules are supported. Remove old rules first.');
    const mode=input.mode;if(!['above','below','zone'].includes(mode))throw fail(400,'Choose a crossing direction or saved zone.');
    const zone=mode==='zone'?choice.zones.find(z=>z.id===input.zone):null;
    if(mode==='zone'&&!zone)throw fail(400,'Choose a saved zone.');
    if(mode!=='zone'&&(!Number.isFinite(input.price)||input.price<=0||input.price>1e8))throw fail(400,'Enter a positive target price.');
    const rule={id:randomUUID(),revision:1,accountId:choice.accountId,identity:identity(account(choice.accountId)),ticker:choice.ticker,name:choice.name,listing:choice.listing,currency:choice.currency,mode,...(zone?{low:zone.low,high:zone.high,levelType:zone.type,levelDate:zone.date,timeframe:zone.timeframe}:{price:input.price}),enabled:true,createdAt:now(),lastPrice:null,observedAt:null,firedAt:null,error:null};save(rule);return read();
  }
  function update(input){const rule=get(input?.id);if(!rule||identity(account(rule.accountId))!==rule.identity)throw fail(404,'Price alert not found.');if(rule.revision!==input.revision)throw fail(409,'This alert changed. Reload before editing it.');
    if(input.action==='delete')db.prepare('DELETE FROM portfolio_price_alerts WHERE id=?').run(rule.id);
    else if(['pause','arm'].includes(input.action))save({...rule,revision:rule.revision+1,enabled:input.action==='arm',lastPrice:null,observedAt:null,firedAt:null,error:null});
    else throw fail(400,'Choose pause, arm or delete.');return read();
  }
  async function check(){
    if(isClosed()||checking||nextCheck>now())return;checking=true;nextCheck=now()+60000;
    try{
      const rules=read().rules.filter(r=>r.enabled&&r.connected),queue=[...new Set(rules.map(r=>r.listing))];
      const worker=async()=>{while(queue.length&&!isClosed()){
        const listing=queue.shift();let result;try{result=await quote(listing);}catch{result=null;}
        if(isClosed())return;
        for(const original of rules.filter(r=>r.listing===listing)){
          const rule=get(original.id),g=credential(original.accountId)?.generation;
          if(!rule||rule.revision!==original.revision||!rule.enabled||!g||identity(account(rule.accountId))!==rule.identity)continue;
          const q=result?.quote,at=Date.parse(q?.observedAt);
          if(result?.status!=='ok'||!Number.isFinite(q?.price)||q.price<=0||q.currency!==rule.currency||q.providerSymbol!==listing.split(':')[1].replaceAll('.','-')||!Number.isFinite(at)||at>now()+300000||now()-at>600000){save({...rule,error:'Waiting for a fresh matching market quote.'});continue;}
          if(rule.observedAt!==null&&at<=rule.observedAt)continue;
          const baseline=rule.observedAt!==null&&at-rule.observedAt<=30*60000?rule.lastPrice:null;
          const fired=priceCrossed(rule,baseline,q.price),next={...rule,lastPrice:q.price,observedAt:at,session:q.session||'Market quote',error:null,...(fired?{enabled:false,firedAt:now()}:{})};
          db.exec('BEGIN IMMEDIATE');try{
            if(fired)activity.priceAlert(rule.accountId,g,`price:${rule.id}:${rule.revision}`,{ticker:rule.ticker,name:rule.name,price:q.price,currency:rule.currency,observedAt:at,listing,session:q.session,source:'Yahoo Finance',message:rule.mode==='zone'?`Entered saved ${rule.levelType} zone ${rule.low}–${rule.high} (${rule.levelDate}).`:`Crossed ${rule.mode} ${rule.price} ${rule.currency}.`});
            save(next);db.exec('COMMIT');
          }catch(e){db.exec('ROLLBACK');throw e;}
        }
      }};await Promise.all([worker(),worker()]);
    }finally{checking=false;}
  }
  function remove(id){db.prepare('DELETE FROM portfolio_price_alerts WHERE account_id=?').run(id);}
  return {read,create,update,check,remove};
}
