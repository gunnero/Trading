import {randomUUID} from 'node:crypto';
import {parseWatchlist} from '../src/data/market.js';
import {portfolioListing} from '../src/data/portfolio-listings.mjs';
import {allocationPlan,contributionBreakdown,performanceIndex,drawdownSummary,benchmarkComparison} from '../src/data/portfolio-planning.mjs';
const fail=(status,message)=>Object.assign(Error(message),{status});
const identity=a=>a.snapshot?.source==='api'?`${a.environment}:${a.snapshot.brokerId}:${a.snapshot.currency}`:`manual:${a.id}:${a.snapshot?.currency}`;
const defaults={revision:0,healthEnabled:true,staleMinutes:30,concentrationPercent:null,maxOrderValue:null,targets:{}};
export function createPortfolioPlanning(db,{now,account,accounts,credential,activity,funding,workspace,benchmarkPrices,company,assertIdle,isClosed}){
  db.exec(`CREATE TABLE IF NOT EXISTS portfolio_planning(account_id TEXT PRIMARY KEY,identity TEXT NOT NULL,detail TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS portfolio_monitor_state(account_id TEXT PRIMARY KEY,identity TEXT NOT NULL,detail TEXT NOT NULL);`);
  function settings(id){const row=db.prepare('SELECT * FROM portfolio_planning WHERE account_id=?').get(id);return row?.identity===identity(account(id))?JSON.parse(row.detail):{...defaults,targets:{}};}
  function save(input){
    const a=account(input?.accountId),old=settings(a.id);assertIdle(a.id);
    if(old.revision!==input.revision)throw fail(409,'These settings changed in another view. Reload before saving.');
    const next={...old};
    if(input.healthEnabled!==undefined){if(typeof input.healthEnabled!=='boolean')throw fail(400,'Choose whether connection alerts are enabled.');next.healthEnabled=input.healthEnabled;}
    if(input.staleMinutes!==undefined){if(!Number.isInteger(input.staleMinutes)||input.staleMinutes<20||input.staleMinutes>1440)throw fail(400,'Choose a stale threshold from 20 to 1440 minutes.');next.staleMinutes=input.staleMinutes;}
    for(const [key,max] of [['concentrationPercent',100],['maxOrderValue',1e12]])if(input[key]!==undefined){if(input[key]!==null&&(!Number.isFinite(input[key])||input[key]<=0||input[key]>max))throw fail(400,'Enter a positive limit or leave it blank to disable it.');next[key]=input[key];}
    if(input.targets!==undefined){
      if(!input.targets||typeof input.targets!=='object'||Array.isArray(input.targets)||Object.keys(input.targets).length>501)throw fail(400,'Enter allocation targets for this account.');
      const allowed=new Set(['CASH',...(a.snapshot?.holdings||[]).map(h=>h.ticker)]),entries=Object.entries(input.targets);
      if(entries.some(([k,v])=>!allowed.has(k)||!Number.isFinite(v)||v<0||v>100)||entries.length&&Math.abs(entries.reduce((n,[,v])=>n+v,0)-100)>1e-6)throw fail(400,'Targets must use current holdings and cash, and add up to 100%.');
      next.targets=Object.fromEntries(entries);
    }
    next.revision++;db.prepare('INSERT INTO portfolio_planning VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET identity=excluded.identity,detail=excluded.detail').run(a.id,identity(a),JSON.stringify(next));
    return read();
  }
  function read(){const root=accounts();return {people:root.people,accounts:root.accounts.map(a=>{
    const s=settings(a.id),plan=allocationPlan(a.snapshot,s.targets),last=Date.parse(a.lastSuccess),fresh=Number.isFinite(last)&&now()-last<=s.staleMinutes*60000;
    const health=!a.connected?'Disconnected':a.error?'Sync failed':!fresh?'Sync overdue':'Healthy';
    return {id:a.id,person:root.people.find(p=>p.id===a.personId)?.name||'Unknown person',label:a.label,environment:a.environment,currency:a.snapshot?.currency,connected:a.connected,lastSuccess:a.lastSuccess,error:a.error,health,settings:s,plan,concentrations:s.concentrationPercent&&fresh&&!a.error?plan.rows.filter(r=>r.key!=='CASH'&&r.weight>s.concentrationPercent):[],observedAt:a.snapshot?.fetchedAt||a.snapshot?.observedAt||null};
  })};}
  function check(){
    for(const a of read().accounts){
      const g=credential(a.id)?.generation;if(!g)continue;
      const key=identity(account(a.id)),stored=db.prepare('SELECT * FROM portfolio_monitor_state WHERE account_id=?').get(a.id),old=stored?.identity===key?JSON.parse(stored.detail):{};
      const active={};
      if(a.settings.healthEnabled&&a.health!=='Healthy')active.health={name:'Connection health',message:`${a.health}. Last successful sync is older than expected or failed. Open Portfolio Manager to check the connection.`};
      if(a.health==='Healthy'&&a.settings.concentrationPercent)for(const h of a.concentrations)active['concentration:'+h.key]={ticker:h.key,name:h.name,message:`Holding exceeds the ${a.settings.concentrationPercent}% account allocation threshold.`,weight:h.weight};
      // A transient outage cannot re-arm concentration warnings on stale data.
      if(a.health!=='Healthy'&&a.settings.concentrationPercent)for(const [k,v] of Object.entries(old))if(k.startsWith('concentration:'))active[k]=v;
      db.exec('BEGIN IMMEDIATE');try{
        for(const [kind,detail] of Object.entries(active))if(!old[kind])activity.monitorAlert(a.id,g,`monitor:${randomUUID()}`,{...detail,ticker:detail.ticker||'',kind:kind==='health'?'health':'concentration'});
        if(old.health&&!active.health&&a.settings.healthEnabled)activity.monitorAlert(a.id,g,`monitor:${randomUUID()}`,{ticker:'',name:'Connection restored',kind:'health',message:'Account snapshots are updating again.'});
        db.prepare('INSERT INTO portfolio_monitor_state VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET identity=excluded.identity,detail=excluded.detail').run(a.id,key,JSON.stringify(active));db.exec('COMMIT');
      }catch(e){db.exec('ROLLBACK');throw e;}
    }
  }
  function orderLimit(id,estimate,currency){const a=account(id),limit=settings(id).maxOrderValue;if(limit===null)return null;
    if(currency!==a.snapshot?.currency||!Number.isFinite(estimate)||estimate<=0)throw fail(400,'This account has an order-size limit. A matching current broker price or limit price is required.');
    if(estimate>limit+1e-8)throw fail(400,`This order estimate exceeds the account’s maximum order value (${limit} ${currency}). Reduce the quantity or change the limit in Portfolio insights.`);return limit;
  }
  async function performance(filters){
    account(filters.account);const range=filters.range||'1Y',symbol=filters.benchmark||'SPY';
    if(!['1M','3M','YTD','1Y','MAX'].includes(range)||!['SPY','QQQ'].includes(symbol))throw fail(400,'Choose a supported range and SPY or QQQ.');
    await funding.sync(filters.account);if(isClosed())throw fail(503,'The server is restarting. Refresh shortly.');
    const a=account(filters.account),currency=a.snapshot?.currency;
    const time=now(),from=range==='MAX'?0:range==='YTD'?Date.UTC(new Date(time).getUTCFullYear(),0,1):time-({ '1M':30,'3M':90,'1Y':365}[range])*86400000;
    const ledger=funding.ledger(a.id),index=performanceIndex(ledger,currency,from,time);let comparison={points:[],reason:index.reason};
    if(!index.reason&&currency==='USD')try{const prices=await benchmarkPrices(symbol,index.start,index.end);comparison=benchmarkComparison(ledger,currency,prices,from,time);}catch{comparison={points:[],reason:'Benchmark history is temporarily unavailable. Account results remain available.'};}
    else if(currency!=='USD')comparison={points:[],reason:'Benchmark comparison is available for USD accounts. No FX conversion is assumed.'};
    return {accountId:a.id,currency,range,benchmark:symbol,index,drawdown:drawdownSummary(index.points),comparison,contributions:contributionBreakdown(a.snapshot,activity.ledger(a.id)),generatedAt:time};
  }
  function calendarChoices(id){const a=account(id);let watchlist=[];try{watchlist=parseWatchlist(workspace()?.watchText||'',{allowEmpty:true});}catch{}
    return (a.snapshot?.holdings||[]).map(h=>({ticker:h.ticker,name:h.name,listing:portfolioListing(h,watchlist)?.id||null}));
  }
  async function calendar(filters){
    const choices=calendarChoices(filters.account),offset=Number(filters.offset||0);if(!Number.isSafeInteger(offset)||offset<0||offset>500)throw fail(400,'Invalid calendar page.');
    const today=new Date(now()).toISOString().slice(0,10),queue=choices.slice(offset,offset+8),items=new Array(queue.length);let cursor=0;
    const worker=async()=>{while(cursor<queue.length){const i=cursor++,h=queue[i];let result;try{result=h.listing?await company(h.listing):null;}catch{}const d=result?.data,events=[];
      for(const date of d?.earnings?.dates||[])if(date>=today)events.push({type:'Earnings',date,estimated:d.earnings.estimated!==false});
      for(const [key,type] of [['exDividend','Ex-dividend'],['dividendDate','Dividend payment']])if(d?.[key]>=today)events.push({type,date:d[key],estimated:false});
      items[i]={...h,events,status:result?.status||'unavailable',fetchedAt:result?.fetchedAt||null,message:!h.listing?'No verified market listing.':!d?'Company dates are unavailable.':!events.length?'No upcoming dates supplied.':null};
    }};await Promise.all([worker(),worker()]);return {accountId:filters.account,items,offset,more:offset+items.length<choices.length,total:choices.length,source:'Yahoo Finance',generatedAt:now()};
  }
  function remove(id){for(const table of ['portfolio_planning','portfolio_monitor_state'])db.prepare(`DELETE FROM ${table} WHERE account_id=?`).run(id);}
  return {read,save,settings,check,orderLimit,performance,calendar,remove};
}
