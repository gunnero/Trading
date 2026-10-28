import {XMLParser} from 'fast-xml-parser';
import {readFileSync, mkdirSync, writeFileSync, renameSync} from 'node:fs';
import {dirname} from 'node:path';
import {marketDay, addDays,validDay} from '../src/data/calendar.mjs';
import {tradingDay,exchangeInstant} from '../src/data/market-session.mjs';
import {chartIndicators} from '../src/data/indicators.mjs';
import {supportsLevelHistory} from '../src/data/zone-roles.mjs';
import {isEquityKey} from '../src/data/instruments.mjs';
import {EXTRA_FUTURES_CHART_KEYS} from '../src/data/market-context.mjs';
import {validTradeHistory} from '../src/data/journal-chart.mjs';

export const FRAMES = {'2m':['2m','5d',120],'5m':['5m','5d',120],'15m':['15m','1mo',100],'30m':['30m','1mo',100],'1h':['1h','3mo',100],'4h':['1h','3mo',80],D:['1d','5y',120],W:['1d','5y',104],M:['1d','5y',48]};
const chartSymbols=['QQQ','SPY','NQ','ES','VIX','VIX1D','DXY','US10Y','US2Y',...EXTRA_FUTURES_CHART_KEYS];
export const supportsChart=(symbol,frame)=>(chartSymbols.includes(symbol)||isEquityKey(symbol))&&Object.hasOwn(FRAMES,frame)&&(symbol!=='US2Y'||frame==='D');
export const supportsSetup=(symbol,frame)=>isEquityKey(symbol)&&['2m','5m','15m','30m','1h','4h','D'].includes(frame);
const aliases={NQ:['NQ=F','future',10],ES:['ES=F','future',10],VIX:['^VIX','index',15],VIX1D:['^VIX1D','index',null],DXY:['DX-Y.NYB','index',null],US10Y:['^TNX','yield',15],US2Y:['US2Y','treasury',null],'CME_MINI:NQ1!':['NQ=F','future',10],'CME_MINI:ES1!':['ES=F','future',10],'CME_MINI:RTY1!':['RTY=F','future',10],'NYMEX:CL1!':['CL=F','future',30],'COMEX:GC1!':['GC=F','future',30]};
export function resolveSymbol(key){
  if(Object.hasOwn(aliases,key)){const [symbol,kind,delayMinutes]=aliases[key];return {key,symbol,kind,delayMinutes};}
  if(['QQQ','SPY'].includes(key))return {key,symbol:key,kind:'equity',delayMinutes:null};
  const match=/^(NASDAQ|NYSE|AMEX|CBOE|NYSEARCA|NYSEAMERICAN|BATS):([A-Z][A-Z0-9.]{0,9})$/.exec(key);
  return match?{key,symbol:match[2].replaceAll('.','-'),kind:'equity',delayMinutes:null}:null;
}
const validNumber=n=>typeof n==='number'&&Number.isFinite(n);
const iso=seconds=>new Date(seconds*1000).toISOString();
function resultOf(payload,asset){
  const r=payload?.chart?.result?.[0];
  if(payload?.chart?.error||!r||r.meta?.symbol!==asset.symbol)throw new Error('Yahoo did not return this symbol.');
  const type=r.meta.instrumentType;
  if(asset.kind==='equity'&&!['EQUITY','ETF','MUTUALFUND'].includes(type))throw new Error('Yahoo instrument type does not match this listing.');
  if(asset.kind==='index'&&type!=='INDEX')throw new Error('Yahoo instrument type does not match this index.');
  if(asset.kind==='future'&&type!=='FUTURE')throw new Error('Yahoo instrument type does not match this future.');
  return r;
}
export function parseYahoo(payload,asset,now=Date.now(),{extended=false}={}){
  const r=resultOf(payload,asset),m=r.meta;
  if(!validNumber(m.regularMarketPrice)||m.regularMarketPrice<=0||!validNumber(m.regularMarketTime)||m.regularMarketTime*1000>now+300000)throw new Error('Yahoo returned an invalid quote.');
  // previousClose is the preceding session; chartPreviousClose can be the start of a multi-day range.
  const previous=validNumber(m.previousClose)&&m.previousClose>0?m.previousClose:null;
  const change=previous===null?null:m.regularMarketPrice-previous;
  const q=r.indicators?.quote?.[0];
  const day=marketDay(m.regularMarketTime*1000);
  const regularPeriods=(Array.isArray(m.tradingPeriods)?m.tradingPeriods:m.tradingPeriods?.regular||[]).flat(Infinity).concat(m.currentTradingPeriod?.regular||[]);
  const points=(r.timestamp||[]).flatMap((t,i)=>validNumber(q?.close?.[i])&&t<=m.regularMarketTime&&marketDay(t*1000)===day&&(!extended||asset.kind!=='equity'||regularPeriods.some(p=>t>=p.start&&t<=p.end))?[q.close[i]]:[]);
  const stride=Math.max(1,Math.ceil(points.length/48));
  const trend=points.filter((_,i)=>i%stride===0||i===points.length-1);
  const regular={provider:'Yahoo Finance',providerSymbol:asset.symbol,name:m.shortName||m.longName||asset.symbol,kind:asset.kind,currency:m.currency||null,price:m.regularMarketPrice,previousClose:previous,change,changePercent:previous===null?null:change/previous*100,observedAt:iso(m.regularMarketTime),sessionDate:day,sessionEnd:validNumber(m.currentTradingPeriod?.regular?.end)?iso(m.currentTradingPeriod.regular.end):null,delayMinutes:asset.delayMinutes,volume:validNumber(m.regularMarketVolume)?m.regularMarketVolume:null,trend,sourceUrl:`https://finance.yahoo.com/quote/${encodeURIComponent(asset.symbol)}/`,session:asset.kind==='equity'?'Regular session':'Market quote',sessionType:'regular'};
  if(!extended||asset.kind!=='equity')return regular;
  // regularMarketPrice remains the regular close during pre/post-market. Use only
  // real chart observations inside the source's currently active extended period.
  for(const type of ['pre','post']){
    const period=m.currentTradingPeriod?.[type];
    if(!validNumber(period?.start)||!validNumber(period?.end)||now/1000<period.start||now/1000>=period.end)continue;
    const today=marketDay(now);
    if(type==='post'&&day!==today)continue;
    const observed=(r.timestamp||[]).flatMap((t,i)=>validNumber(t)&&t>=period.start&&t<period.end&&t>m.regularMarketTime&&t<=now/1000&&marketDay(t*1000)===today&&validNumber(q?.close?.[i])&&q.close[i]>0?[{time:t,price:q.close[i]}]:[]).sort((a,b)=>a.time-b.time);
    const latest=observed.at(-1);if(!latest)continue;
    const delta=latest.price-regular.price,stride=Math.max(1,Math.ceil(observed.length/48));
    return {...regular,price:latest.price,previousClose:regular.price,change:delta,changePercent:delta/regular.price*100,observedAt:iso(latest.time),sessionDate:today,sessionEnd:iso(period.end),volume:null,trend:observed.filter((_,i)=>i%stride===0||i===observed.length-1).map(p=>p.price),session:type==='pre'?'Pre-market':'After-hours',sessionType:type,priceSource:'chart-close',regularReference:{price:regular.price,observedAt:regular.observedAt,sessionDate:regular.sessionDate}};
  }
  return regular;
}
export function parseCandles(payload,asset,frame,now=Date.now(),{full=false}={}){
  const r=resultOf(payload,asset),q=r.indicators?.quote?.[0],intraday=!['D','W','M'].includes(frame);
  const seconds={ '2m':120,'5m':300,'15m':900,'30m':1800,'1h':3600,'4h':3600 }[frame];
  const periods=(Array.isArray(r.meta.tradingPeriods)?r.meta.tradingPeriods:r.meta.tradingPeriods?.regular||[]).flat(Infinity).filter(p=>validNumber(p?.start)&&validNumber(p?.end));
  const seen=new Set();
  let rows=(r.timestamp||[]).flatMap((t,i)=>{
    const o=q?.open?.[i],c=q?.close?.[i],l=q?.low?.[i],h=q?.high?.[i],v=q?.volume?.[i];
    if(!validNumber(t)||t*1000>now+300000||seen.has(t)||![o,c,l,h].every(n=>validNumber(n)&&n>0)||l>Math.min(o,c)||h<Math.max(o,c)||h<l)return [];
    seen.add(t);
    const day=marketDay(t*1000);
    // Use the source's actual sessions (including early closes). Do not turn the closing quote marker into another candle.
    const period=intraday?periods.find(p=>t>=p.start&&t<p.end):null;
    if(intraday&&!period)return [];
    const sourceEnd=r.meta.currentTradingPeriod?.regular?.end;
    const suppliedEnd=validNumber(sourceEnd)&&marketDay((sourceEnd-1)*1000)===day?sourceEnd:null;
    // DXY trades beyond the U.S. equity close; VIX1D can publish through the
    // quarter-hour after it. Do not project those final daily closes at 16:00.
    const indexEnd=asset.symbol==='DX-Y.NYB'?Date.parse(exchangeInstant(addDays(day,1),0))/1000:asset.symbol==='^VIX1D'?Date.parse(tradingDay(day).close||`${day}T21:00:00Z`)/1000+900:null;
    const dailyEnd=indexEnd?Math.max(indexEnd,suppliedEnd||0):suppliedEnd??(asset.kind==='future'?Date.parse(exchangeInstant(addDays(day,1),0))/1000:Date.parse(tradingDay(day).close||`${day}T21:00:00Z`)/1000);
    const end=intraday?Math.min(t+seconds,period.end):dailyEnd;
    return [{timestamp:t,date:day,sessionDate:period?marketDay((period.end-1)*1000):day,ohlc:[o,c,l,h],volume:validNumber(v)&&v>=0?v:null,start:period?.start,end,sessionEnd:period?.end,complete:now/1000>=end,partial:now/1000<end||(intraday&&end-t<seconds)}];
  }).sort((a,b)=>a.timestamp-b.timestamp);
  if(frame==='4h'||frame==='W'||frame==='M'){
    const groups=new Map();
    for(const row of rows){
      let key;
      if(frame==='4h')key=`${row.start}:${Math.floor((row.timestamp-row.start)/14400)}`;
      else if(frame==='M')key=row.date.slice(0,7);
      else {const d=new Date(`${row.date}T12:00:00Z`);key=addDays(row.date,-(d.getUTCDay()+6)%7);}
      let group=groups.get(key);
      if(!group){group={...row,ohlc:[...row.ohlc],volume:0,count:0,partial:false,key};groups.set(key,group);}
      group.ohlc[1]=row.ohlc[1];group.ohlc[2]=Math.min(group.ohlc[2],row.ohlc[2]);group.ohlc[3]=Math.max(group.ohlc[3],row.ohlc[3]);
      group.volume=group.volume===null||row.volume===null?null:group.volume+row.volume;group.count++;group.end=row.end;group.lastDate=row.date;group.partial ||= row.partial;group.complete &&= row.complete;
    }
    rows=[...groups.values()].map(g=>{
      if(frame==='4h'){
        const start=g.start+Math.floor((g.timestamp-g.start)/14400)*14400,end=Math.min(start+14400,g.sessionEnd);
        g.partial ||= g.timestamp!==start||end-start<14400||g.count<Math.ceil((end-start)/3600)||now/1000<end;
        g.complete &&= g.timestamp===start&&g.end===end&&g.count===Math.ceil((end-start)/3600)&&now/1000>=end;
      }else{
        const last=frame==='W'?addDays(g.key,4):new Date(Date.UTC(+g.key.slice(0,4),+g.key.slice(5,7),0,12)).toISOString().slice(0,10);
        const close=tradingDay(last).close||`${last}T21:00:00Z`;
        g.partial ||= now<Date.parse(close);
      }
      return g;
    });
  }
  if(!rows.length)throw new Error('Yahoo returned no valid candles.');
  return full?rows:rows.slice(-FRAMES[frame][2]).map(({timestamp,date,ohlc,volume,partial})=>({timestamp,date,ohlc,volume,partial}));
}
export function parseTreasuryHistory(xml,now=Date.now()){
  const doc=new XMLParser({removeNSPrefix:true}).parse(xml);
  const entries=doc?.feed?.entry;const list=Array.isArray(entries)?entries:entries?[entries]:[];
  const rows=list.map(e=>e.content?.properties).filter(p=>typeof p?.NEW_DATE==='string'&&validNumber(p.BC_2YEAR)&&p.BC_2YEAR>=0).map(p=>({date:p.NEW_DATE.slice(0,10),price:p.BC_2YEAR})).filter(p=>/^\d{4}-\d{2}-\d{2}$/.test(p.date)&&p.date<=marketDay(now)).sort((a,b)=>a.date.localeCompare(b.date));
  if(!rows.length)throw new Error('Treasury did not return a 2-year rate.');
  return [...new Map(rows.map(row=>[row.date,row])).values()];
}
function treasuryQuote(rows){
  const last=rows.at(-1),previous=rows.at(-2)?.price??null;
  return {provider:'U.S. Treasury',providerSymbol:'US2Y',kind:'treasury',name:'Daily 2-year par yield',price:last.price,previousClose:previous,change:previous===null?null:last.price-previous,changePercent:null,sessionDate:last.date,observedAt:null,trend:rows.slice(-30).map(r=>r.price),delayMinutes:null,sourceUrl:'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve',session:'Daily reading'};
}
export function parseTreasury(xml,now=Date.now()){return treasuryQuote(parseTreasuryHistory(xml,now));}
export function quoteIsOld(quote,now=Date.now()){
  const today=marketDay(now);
  if(quote.sessionDate<addDays(today,-7))return true;
  if(quote.kind==='treasury')return quote.sessionDate<addDays(today,-4);
  if(quote.kind==='equity'&&['pre','post'].includes(quote.sessionType))return quote.sessionDate!==today||now-Date.parse(quote.observedAt)>30*60000||now>=Date.parse(quote.sessionEnd);
  if(quote.kind==='future')return now-Date.parse(quote.observedAt)>(([0,6].includes(new Date(`${today}T12:00Z`).getUTCDay()))?72:28)*3600000;
  for(let i=0;i<10;i++){
    const day=tradingDay(addDays(today,-i));
    if(day.kind==='session'&&now>=Date.parse(day.open)+30*60000){
      if(quote.sessionDate<day.day)return true;
      if(quote.sessionDate===day.day&&now<Date.parse(day.close)+30*60000&&now-Date.parse(quote.observedAt)>30*60000)return true;
      const end=quote.sessionEnd&&marketDay(quote.sessionEnd)===quote.sessionDate?Date.parse(quote.sessionEnd):Date.parse(day.close);
      if(quote.sessionDate===day.day&&now>=end&&Date.parse(quote.observedAt)<end-30*60000)return true;
      return false;
    }
  }
  return false;
}
const unavailable=message=>({status:'unavailable',message,quote:null});
export function createMarketService({fetcher=fetch,now=()=>Date.now(),cachePath=null}={}){
  const cache=new Map(),failures=new Map(),pending=new Map();let blockedUntil=0,active=0,saveTimer;const queue=[];
  if(cachePath)try{const data=JSON.parse(readFileSync(cachePath,'utf8'));if(data.version===1){for(const [k,v] of data.entries.slice(-192))if(now()-v.fetchedAt<86400000)cache.set(k,v);for(const [k,v] of (data.failures||[]).slice(-192))if(v>now())failures.set(k,v);blockedUntil=Math.min(now()+86400000,Number(data.blockedUntil)||0);}}catch{}
  function persist(){if(!cachePath||saveTimer)return;saveTimer=setTimeout(()=>{saveTimer=null;try{mkdirSync(dirname(cachePath),{recursive:true});writeFileSync(`${cachePath}.tmp`,JSON.stringify({version:1,entries:[...cache],failures:[...failures],blockedUntil}),{mode:0o600});renameSync(`${cachePath}.tmp`,cachePath);}catch{}},250);saveTimer.unref();}
  async function limited(fn){if(active>=3)await new Promise(r=>queue.push(r));else active++;try{return await fn();}finally{const next=queue.shift();if(next)next();else active--;}}
  async function request(url,isYahoo=true){
    if(isYahoo&&now()<blockedUntil)throw new Error('Yahoo is temporarily rate-limited. Automatic retry is scheduled.');
    const response=await fetcher(url,{headers:{'User-Agent':'OpeningBell/1.0 (personal market dashboard)','Accept':isYahoo?'application/json':'application/xml'},redirect:'error',signal:AbortSignal.timeout(8000)});
    if(!response.ok){if(isYahoo&&[403,429].includes(response.status)){const retry=response.headers.get('retry-after'),seconds=Number(retry),until=retry&&Number.isFinite(seconds)?now()+seconds*1000:Date.parse(retry);blockedUntil=Math.max(now()+300000,Math.min(now()+86400000,until||0));}throw new Error(response.status===404?'Symbol unavailable from Yahoo.':`Source unavailable (HTTP ${response.status}).`);}
    const reader=response.body.getReader();const parts=[];let size=0;
    while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>6_000_000){await reader.cancel();throw new Error('Source response too large.');}parts.push(value);}
    return Buffer.concat(parts).toString('utf8');
  }
  async function get(key,ttl,load){
    const old=cache.get(key);
    if(old&&now()-old.fetchedAt<ttl)return {...old.data,fetchedAt:new Date(old.fetchedAt).toISOString(),status:'ok'};
    const fallback=()=>old&&now()-old.fetchedAt<86400000?{...old.data,fetchedAt:new Date(old.fetchedAt).toISOString(),status:'stale',message:'Cached reading · source refresh unavailable.'}:unavailable('Source unavailable. Retrying automatically.');
    if((failures.get(key)||0)>now())return fallback();
    if(pending.has(key))return pending.get(key);
    const task=limited(async()=>{try{const data=await load();cache.delete(key);cache.set(key,{data,fetchedAt:now()});while(cache.size>192)cache.delete(cache.keys().next().value);failures.delete(key);persist();return {...data,status:'ok',fetchedAt:new Date(now()).toISOString()};}catch{failures.set(key,Math.max(now()+300000,blockedUntil));while(failures.size>192)failures.delete(failures.keys().next().value);persist();return fallback();}}).finally(()=>pending.delete(key));
    pending.set(key,task);return task;
  }
  function markAge(value){if(value.quote&&quoteIsOld(value.quote,now()))return {...value,status:'stale',message:'The source quote is older than the expected session.'};return value;}
  async function quote(key){
    const asset=resolveSymbol(key);if(!asset)return unavailable('No verified Yahoo mapping for this exchange/instrument.');
    return markAge(await get(`quote:${asset.kind==='equity'?'extended:':''}${asset.symbol}`,asset.kind==='treasury'?3600000:60000,async()=>{
      if(asset.kind==='treasury'){
        const year=marketDay(now()).slice(0,4);let xml=await request(`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${year}`,false);
        // Early January can precede the first publication for the new year.
        if(!xml.includes('BC_2YEAR'))xml=await request(`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${+year-1}`,false);
        return {quote:parseTreasury(xml,now())};
      }
      const payload=JSON.parse(await request(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(asset.symbol)}?interval=5m&range=5d&includePrePost=${asset.kind==='equity'}`));
      return {quote:parseYahoo(payload,asset,now(),{extended:true})};
    }));
  }
  async function chart(symbol,frame){
    if(!supportsChart(symbol,frame))return unavailable('Unsupported chart.');
    if(symbol==='US2Y'){
      const year=Number(marketDay(now()).slice(0,4));
      const data=await get(`history:US2Y:daily:${year}`,3600000,async()=>{
        const collected=[];
        // Two fixed years keep a full year of observations available across January.
        for(const y of [year-1,year]){
          const xml=await request(`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${y}`,false);
          if(xml.includes('BC_2YEAR'))collected.push(...parseTreasuryHistory(xml,now()));
        }
        const rows=[...new Map(collected.map(row=>[row.date,row])).values()].sort((a,b)=>a.date.localeCompare(b.date)).filter(row=>row.date>=addDays(marketDay(now()),-370));
        if(!rows.length)throw new Error('Treasury history unavailable.');
        return {points:rows,quote:treasuryQuote(rows)};
      });
      return markAge({...data,symbol,timeframe:'D'});
    }
    const asset=resolveSymbol(symbol),[interval,range]=FRAMES[frame];
    const raw=await get(`history:${asset.symbol}:${interval}:${range}`,60000,async()=>({payload:JSON.parse(await request(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(asset.symbol)}?interval=${interval}&range=${range}&includePrePost=false`))}));
    if(!raw.payload)return raw;
    try{
      const rows=parseCandles(raw.payload,asset,frame,now(),{full:true}),sourceRows=frame==='4h'?parseCandles(raw.payload,asset,'1h',now(),{full:true}):rows;
      const dailyRaw=interval==='1d'?raw:await get(`history:${asset.symbol}:1d:5y`,60000,async()=>({payload:JSON.parse(await request(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(asset.symbol)}?interval=1d&range=5y&includePrePost=false`))}));
      let dailyRows=[],dailyStatus=dailyRaw.status;
      try{dailyRows=parseCandles(dailyRaw.payload,asset,'D',now(),{full:true});if(quoteIsOld(parseYahoo(dailyRaw.payload,asset,now()),now()))dailyStatus='stale';}catch{dailyStatus='unavailable';}
      const indicators=chartIndicators({rows,sourceRows,dailyRows,frame,now:now(),limit:FRAMES[frame][2],kind:asset.kind,dailyStatus,dailyFetchedAt:dailyRaw.fetchedAt});
      return markAge({status:raw.status,message:raw.message,fetchedAt:raw.fetchedAt,quote:parseYahoo(raw.payload,asset,now()),candles:parseCandles(raw.payload,asset,frame,now()),indicators,symbol,timeframe:frame});
    }catch{return unavailable('Chart history unavailable from Yahoo.');}
  }
  async function levelHistory(symbol,frame,from){
    if(!supportsLevelHistory(symbol,frame)||!validDay(from))return unavailable('Unsupported level confirmation request.');
    const asset=resolveSymbol(symbol),[interval,range]=FRAMES[frame];
    const raw=await get(`history:${asset.symbol}:${interval}:${range}`,60000,async()=>({payload:JSON.parse(await request(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(asset.symbol)}?interval=${interval}&range=${range}&includePrePost=false`))}));
    if(!raw.payload)return raw;
    try{
      const quote=parseYahoo(raw.payload,asset,now());
      // A delayed or cached developing bar cannot become confirmed just through elapsed wall time.
      const cutoff=Math.min(now(),Date.parse(raw.fetchedAt)-(asset.delayMinutes||0)*60000,Date.parse(quote.observedAt)+1000);
      const rows=parseCandles(raw.payload,asset,frame,cutoff,{full:true});
      const covered=rows[0].sessionDate<=from&&(frame==='D'||rows[0].sessionDate<from||rows[0].timestamp===rows[0].start);
      const bars=rows.filter(row=>row.complete&&row.sessionDate>=from).map(row=>({timestamp:row.timestamp,end:row.end,sessionDate:row.sessionDate,close:row.ohlc[1],closed:true}));
      const result={status:covered?raw.status:'insufficient',message:covered?raw.message:'Source history does not reach the start of this level sheet. Imported roles shown.',fetchedAt:raw.fetchedAt,symbol,timeframe:frame,from,quote,bars:covered?bars:[],through:covered?(bars.at(-1)?.end??null):null};
      return covered?markAge(result):result;
    }catch{return unavailable('Closed-candle history unavailable. Imported roles shown.');}
  }
  async function setupHistory(symbol,frame,from){
    if(!supportsSetup(symbol,frame)||!validDay(from))return unavailable('Unsupported setup request.');
    const asset=resolveSymbol(symbol),[interval,range]=FRAMES[frame];
    const raw=await get(`history:${asset.symbol}:${interval}:${range}`,60000,async()=>({payload:JSON.parse(await request(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(asset.symbol)}?interval=${interval}&range=${range}&includePrePost=false`))}));
    if(!raw.payload)return {...raw,symbol,timeframe:frame,from};
    try{
      const quote=parseYahoo(raw.payload,asset,now()),cutoff=Math.min(now(),Date.parse(raw.fetchedAt),Date.parse(quote.observedAt)+1000);
      const rows=parseCandles(raw.payload,asset,frame,cutoff,{full:true}),dayRows=rows.filter(row=>row.sessionDate===quote.sessionDate);
      const complete=rows.filter(row=>row.complete),previous=complete.filter(row=>row.sessionDate<quote.sessionDate).at(-1);
      const day=tradingDay(quote.sessionDate),expected=Date.parse(day.open)/1000,sessionEnd=Date.parse(day.close)/1000;
      const step={'2m':120,'5m':300,'15m':900,'30m':1800,'1h':3600,'4h':14400,D:sessionEnd-expected}[frame];
      const requiredEnd=cutoff/1000>=sessionEnd?sessionEnd:expected+Math.max(0,Math.floor((cutoff/1000-expected)/step))*step;
      const latestComplete=complete.findLast(row=>row.sessionDate===quote.sessionDate)?.end??expected;
      const covered=!!dayRows.length&&(frame==='D'||dayRows[0].timestamp===expected)&&dayRows.every((row,i)=>!i||dayRows[i-1].end===row.timestamp)&&latestComplete>=requiredEnd;
      const dailyRaw=interval==='1d'?raw:await get(`history:${asset.symbol}:1d:5y`,3600000,async()=>({payload:JSON.parse(await request(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(asset.symbol)}?interval=1d&range=5y&includePrePost=false`))}));
      let dailyRows=[],dailyStatus=dailyRaw.status;
      try{dailyRows=parseCandles(dailyRaw.payload,asset,'D',cutoff,{full:true});}catch{dailyStatus='unavailable';}
      const indicators=chartIndicators({rows:complete,sourceRows:frame==='4h'?parseCandles(raw.payload,asset,'1h',cutoff,{full:true}).filter(r=>r.complete):complete,dailyRows,frame,now:cutoff,dailyStatus,dailyFetchedAt:dailyRaw.fetchedAt,kind:'equity'});
      const bars=complete.flatMap((row,i)=>row===previous||row.sessionDate===quote.sessionDate?[{timestamp:row.timestamp,end:row.end,sessionDate:row.sessionDate,open:row.ohlc[0],close:row.ohlc[1],low:row.ohlc[2],high:row.ohlc[3],volume:row.volume,closed:true,indicators:Object.fromEntries(Object.entries(indicators.series).map(([key,values])=>[key,values[i]??null]))}]:[]);
      const result={status:covered?raw.status:'insufficient',message:covered?raw.message:'Incomplete session candles; setup confirmation paused.',symbol,timeframe:frame,from,quote,fetchedAt:raw.fetchedAt,bars:covered?bars:[],dailyStatus,through:covered?(bars.at(-1)?.end??null):null};
      return covered?markAge(result):result;
    }catch{return {...unavailable('Setup candles unavailable. Retrying automatically.'),symbol,timeframe:frame,from};}
  }
  async function tradeHistory(symbol,frame,from,to){
    if(!validTradeHistory(symbol,frame,from,to)||from>marketDay(now())||to>marketDay(now()))return unavailable('Choose a supported U.S. listing and a past/current date range of at most 31 days.');
    const asset=resolveSymbol(symbol),period1=Date.parse(exchangeInstant(from,0))/1000,period2=Date.parse(exchangeInstant(addDays(to,1),0))/1000;
    const raw=await get(`trade-history:${asset.symbol}:${frame}:${from}:${to}`,to<marketDay(now())?3600000:60000,async()=>{
      const payload=JSON.parse(await request(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(asset.symbol)}?interval=${frame}&period1=${period1}&period2=${period2}&includePrePost=false`));
      const result=resultOf(payload,asset);
      if(result.meta.currency!=='USD')throw Error('A USD listing is required.');
      // Validate before caching so malformed or unrelated responses cannot replace usable history.
      parseCandles(payload,asset,frame,now(),{full:true});
      return {payload};
    });
    if(!raw.payload)return {...raw,message:'Historical candles are unavailable from Yahoo for these dates. Intraday history may no longer be retained.',symbol,timeframe:frame,from,to};
    try{
      const meta=resultOf(raw.payload,asset).meta;
      if(!validNumber(meta.regularMarketTime))throw Error();
      const cutoff=Math.min(now(),Date.parse(raw.fetchedAt),meta.regularMarketTime*1000);
      const candles=parseCandles(raw.payload,asset,frame,cutoff,{full:true}).filter(c=>c.sessionDate>=from&&c.sessionDate<=to&&c.timestamp*1000<=cutoff);
      if(!candles.length)throw Error();
      const dailyRaw=await get(`history:${asset.symbol}:1d:5y`,3600000,async()=>({payload:JSON.parse(await request(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(asset.symbol)}?interval=1d&range=5y&includePrePost=false`))}));
      let dailyRows=[],dailyStatus=dailyRaw.status;
      try{dailyRows=parseCandles(dailyRaw.payload,asset,'D',cutoff,{full:true});}catch{dailyStatus='unavailable';}
      const indicators=chartIndicators({rows:candles,dailyRows,frame,now:cutoff,dailyStatus,dailyFetchedAt:dailyRaw.fetchedAt,kind:'equity'});
      return {status:raw.status,message:raw.message,provider:'Yahoo Finance',symbol,timeframe:frame,from,to,currency:'USD',fetchedAt:raw.fetchedAt,observedThrough:cutoff/1000,candles,indicators};
    }catch{return {...unavailable('No valid historical candles cover these trade dates.'),symbol,timeframe:frame,from,to};}
  }
  return {quote,chart,levelHistory,setupHistory,tradeHistory};
}
export function marketDataMiddleware(service=createMarketService({cachePath:new URL('../.cache/market-data.json',import.meta.url).pathname})){
  return async(req,res,next)=>{
    const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith('/api/market/'))return next();
    res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    const send=(status,value)=>{res.statusCode=status;res.end(JSON.stringify(value));};
    if(req.method!=='GET'){res.setHeader('Allow','GET');return send(405,{message:'Use GET.'});}
    if(url.pathname==='/api/market/quotes'){
      const keys=[...new Set((url.searchParams.get('symbols')||'').split(','))];
      if(keys.length>8||keys.some(k=>!k||k.length>32||!/^[A-Z0-9:.!_-]+$/.test(k)))return send(400,{message:'Request 1–8 instrument identifiers.'});
      return send(200,{quotes:Object.fromEntries(await Promise.all(keys.map(async k=>[k,await service.quote(k)])))});
    }
    if(url.pathname==='/api/market/chart'){
      const symbol=url.searchParams.get('symbol'),frame=url.searchParams.get('interval');
      if(!supportsChart(symbol,frame))return send(400,{message:'Choose a supported chart and interval. U.S. 2Y history is daily only.'});
      return send(200,await service.chart(symbol,frame));
    }
    if(url.pathname==='/api/market/trade-history'){
      const symbol=url.searchParams.get('symbol'),frame=url.searchParams.get('interval'),from=url.searchParams.get('from'),to=url.searchParams.get('to');
      if(!validTradeHistory(symbol,frame,from,to))return send(400,{message:'Choose a U.S. stock/fund, 2m/5m/15m candles and a date range of at most 31 days.'});
      return send(200,await service.tradeHistory(symbol,frame,from,to));
    }
    if(url.pathname==='/api/market/level-history'){
      const symbol=url.searchParams.get('symbol'),frame=url.searchParams.get('interval'),from=url.searchParams.get('from');
      if(!supportsLevelHistory(symbol,frame)||!validDay(from))return send(400,{message:'Choose a supported instrument, level timeframe and sheet date.'});
      return send(200,await service.levelHistory(symbol,frame,from));
    }
    if(url.pathname==='/api/market/setup'){
      const symbol=url.searchParams.get('symbol'),frame=url.searchParams.get('interval'),from=url.searchParams.get('from');
      if(!supportsSetup(symbol,frame)||!validDay(from))return send(400,{message:'Choose a supported U.S. listing, setup interval and sheet date.'});
      return send(200,await service.setupHistory(symbol,frame,from));
    }
    return send(404,{message:'Unknown market data route.'});
  };
}
