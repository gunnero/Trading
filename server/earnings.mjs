import {readFileSync,mkdirSync,writeFileSync,renameSync} from 'node:fs';
import {dirname} from 'node:path';
import {EARNINGS_SOURCE,earningsRange,earningsDays,earningsNumber} from '../src/data/earnings.mjs';
import {validDay} from '../src/data/calendar.mjs';
const clean=(value,max=180)=>typeof value==='string'||typeof value==='number'?String(value).trim().slice(0,max):'';
const supplied=value=>{const s=clean(value,60);return !s||['N/A','--','—','-'].includes(s)?null:s;};
function sourceDay(value){
  const match=/^[A-Za-z]{3}, ([A-Za-z]{3}) (\d{1,2}), (\d{4})$/.exec(value||'');
  const month=match&&['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(match[1])+1;
  return month?`${match[3]}-${String(month).padStart(2,'0')}-${match[2].padStart(2,'0')}`:null;
}
export function parseEarnings(raw,date){
  const data=raw?.data;
  if(!validDay(date)||raw?.status?.rCode!==200||!data||sourceDay(data.asOf)!==date||!(Array.isArray(data.rows)||(data.rows===null&&data.headers===null)))throw Error('The earnings source did not return the requested date.');
  const rows=data.rows||[],seen=new Set();
  if(rows.length>2000)throw Error('The earnings response exceeds the supported limit.');
  return rows.map(row=>{
    const symbol=clean(row?.symbol,20),name=clean(row?.name);
    if(!/^[A-Z][A-Z0-9.\/-]{0,14}$/.test(symbol)||!name||seen.has(symbol))throw Error('The earnings source returned incomplete company records.');
    seen.add(symbol);
    const epsActual=supplied(row.eps),reported=earningsNumber(epsActual)!==null;
    return {id:`${date}:${symbol}`,date,symbol,name,window:({'time-pre-market':'before','time-after-hours':'after','time-during-market':'during'})[row.time]||'unknown',epsForecast:supplied(row.epsForecast),epsActual:reported?epsActual:null,epsSurprise:reported?earningsNumber(row.surprise):null,marketCap:supplied(row.marketCap),lastYearEPS:supplied(row.lastYearEPS),fiscalQuarter:supplied(row.fiscalQuarterEnding),estimates:supplied(row.noOfEsts),status:reported?'reported':'expected'};
  });
}
export function createEarningsService({fetcher=fetch,now=()=>Date.now(),cachePath=null,timeoutMs=12000,onError=()=>{}}={}){
  const cache=new Map(),pending=new Map(),queue=[];let active=0,blockedUntil=0;
  if(cachePath)try{const saved=JSON.parse(readFileSync(cachePath,'utf8'));blockedUntil=Math.min(now()+86400000,Number(saved.blockedUntil)||0);if(saved.version===2){for(const [day,item] of (saved.entries||[]).slice(-93))if(validDay(day)&&Number.isFinite(item.retryAt)&&item.retryAt<now()+86400001&&(!item.events||Array.isArray(item.events)&&Number.isFinite(item.at)&&item.at<=now()&&now()-item.at<86400000&&item.events.every(e=>e.date===day)))cache.set(day,item);}}catch{}
  function persist(){if(!cachePath)return;try{mkdirSync(dirname(cachePath),{recursive:true});const temp=`${cachePath}.${process.pid}.tmp`;writeFileSync(temp,JSON.stringify({version:2,blockedUntil,entries:[...cache]}),{mode:0o600});renameSync(temp,cachePath);}catch{/* Optional public-feed cache. */}}
  function store(day,item){cache.delete(day);cache.set(day,item);while(cache.size>93)cache.delete(cache.keys().next().value);persist();}
  async function limited(fn){if(active>=2)await new Promise(r=>queue.push(r));else active++;try{return await fn();}finally{const next=queue.shift();if(next)next();else active--;}}
  async function daily(date){
    const old=cache.get(date),fallback=()=>old?.events&&now()-old.at<86400000?{...old,status:'stale'}:{status:'unavailable'};
    if(old?.retryAt>now())return old.failed?fallback():old;
    if(pending.has(date))return pending.get(date);
    if(blockedUntil>now())return fallback();
    const work=limited(async()=>{
      if(blockedUntil>now())return fallback();
      try{
        let response;
        try{response=await fetcher(`https://api.nasdaq.com/api/calendar/earnings?date=${date}`,{headers:{Accept:'application/json','User-Agent':'OpeningBell/1.0 (personal market dashboard)'},redirect:'error',signal:AbortSignal.timeout(timeoutMs)});}catch(error){blockedUntil=Math.max(blockedUntil,now()+300000);throw error;}
        if(!response.ok){
          // Rate limits/access failures pause the provider. A bad date response
          // must not prevent other dates in the requested range from loading.
          if([401,403,429].includes(response.status)){
            const retry=response.headers.get('retry-after'),seconds=Number(retry),until=retry&&Number.isFinite(seconds)?now()+seconds*1000:Date.parse(retry);
            blockedUntil=Math.max(now()+900000,Math.min(now()+86400000,until||0));
          }
          throw Error(`Earnings source temporarily unavailable (HTTP ${response.status}).`);
        }
        if(!response.headers.get('content-type')?.includes('application/json'))throw Error('Unexpected earnings source format.');
        const reader=response.body.getReader(),parts=[];let size=0;
        while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>2_000_000){await reader.cancel();throw Error('Earnings response too large.');}parts.push(value);}
        const events=parseEarnings(JSON.parse(Buffer.concat(parts).toString('utf8')),date),item={events,at:now(),retryAt:now()+1800000,status:'ok'};
        store(date,item);return item;
      }catch(error){onError(error,date);store(date,{...(old?.events&&now()-old.at<86400000?old:{}),failed:true,retryAt:Math.max(now()+600000,blockedUntil)});return fallback();}
    }).finally(()=>pending.delete(date));pending.set(date,work);return work;
  }
  async function get(input){
    const range=earningsRange(input),days=earningsDays(range),results=await Promise.all(days.map(daily));
    const available=results.filter(r=>Array.isArray(r.events)),missingDates=days.filter((day,i)=>!Array.isArray(results[i].events)),cachedDates=days.filter((day,i)=>results[i].status==='stale');
    const incomplete=missingDates.length>0,status=!available.length?'unavailable':incomplete||cachedDates.length?'stale':'ok';
    return {status,source:EARNINGS_SOURCE,checkedAt:new Date(now()).toISOString(),fetchedAt:available.length?new Date(Math.min(...available.map(r=>r.at))).toISOString():null,message:incomplete?`${missingDates.length} reporting date${missingDates.length===1?' is':'s are'} unavailable. Coverage is incomplete; retrying automatically.`:cachedDates.length?'Showing cached schedules while the source is unavailable.':null,data:available.length?{...range,events:available.flatMap(r=>r.events).sort((a,b)=>a.date.localeCompare(b.date)||a.symbol.localeCompare(b.symbol)),missingDates,cachedDates,incomplete}:null};
  }
  return {get};
}
export function earningsMiddleware(service=createEarningsService({cachePath:new URL('../.cache/earnings.json',import.meta.url).pathname,onError:(error,date)=>console.warn(`Earnings ${date}: ${error.message}`)})){
  return async(req,res,next)=>{
    const url=new URL(req.url,'http://localhost');if(url.pathname!=='/api/earnings')return next();
    res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    if(req.method!=='GET'){res.statusCode=405;res.setHeader('Allow','GET');res.end(JSON.stringify({message:'Use GET.'}));return;}
    try{res.end(JSON.stringify(await service.get({from:url.searchParams.get('from'),to:url.searchParams.get('to')})));}catch(error){res.statusCode=400;res.end(JSON.stringify({status:'unavailable',message:error.message}));}
  };
}
