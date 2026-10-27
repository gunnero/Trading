import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseEarnings,createEarningsService} from '../server/earnings.mjs';
import {earningsRange,earningsMatches,windowReference,upcomingEarnings} from '../src/data/earnings.mjs';
const NOW=Date.parse('2026-10-25T12:00:00Z');
const row={symbol:'NVDA',name:'NVIDIA Corporation',time:'time-after-hours',epsForecast:'($0.10)',lastYearEPS:'$0.00',fiscalQuarterEnding:'Sep/2026',noOfEsts:'0'};
const payload=(day,rows=[row])=>({status:{rCode:200},data:{asOf:new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'short',month:'short',day:'numeric',year:'numeric'}).format(new Date(`${day}T12:00:00Z`)),headers:rows===null?null:{},rows}});

test('Earnings parser validates date/shape and keeps missing, negative, zero and unknown timing distinct',()=>{
  const [event]=parseEarnings(payload('2026-10-26'),'2026-10-26');
  assert.equal(event.epsForecast,'($0.10)');assert.equal(event.lastYearEPS,'$0.00');assert.equal(event.estimates,'0');assert.equal(event.window,'after');assert.equal(event.status,'expected');
  assert.deepEqual(parseEarnings(payload('2026-10-25',null),'2026-10-25'),[]);
  const [missing]=parseEarnings(payload('2026-10-26',[{...row,time:'unknown',epsForecast:'N/A',lastYearEPS:null}]),'2026-10-26');assert.equal(missing.epsForecast,null);assert.equal(missing.window,'unknown');
  assert.throws(()=>parseEarnings(payload('2026-10-27'),'2026-10-26'));
  assert.throws(()=>parseEarnings({data:null,status:{rCode:200}},'2026-10-26'));
  assert.throws(()=>parseEarnings(payload('2026-10-26',[row,row]),'2026-10-26'));
  for(const r of [{from:'2026-02-30',to:'2026-03-01'},{from:'2026-10-26',to:'2026-10-25'},{from:'2026-10-01',to:'2026-11-01'}])assert.throws(()=>earningsRange(r));
});
test('Watchlist highlighting preserves U.S. stock identity and excludes funds, futures and foreign namesakes',()=>{
  const entries=[{id:'NASDAQ:NVDA',exchange:'NASDAQ',symbol:'NVDA',group:'STOCKS'},{id:'LSE:V',exchange:'LSE',symbol:'V',group:'STOCKS'},{id:'NASDAQ:QQQ',exchange:'NASDAQ',symbol:'QQQ',group:'FUND'},{id:'NYMEX:CL1!',exchange:'NYMEX',symbol:'CL',group:'FUTURES'},{id:'NYSE:BRK.B',exchange:'NYSE',symbol:'BRK.B',group:'STOCKS'}];
  const events=earningsMatches(['NVDA','V','QQQ','CL','BRK-B'].map(symbol=>({symbol})),entries);
  assert.deepEqual(events.map(e=>e.watchEntries.map(v=>v.id)),[['NASDAQ:NVDA'],[],[],[],['NYSE:BRK.B']]);
  assert.equal(windowReference({date:'2026-10-26',window:'before'}),'U.S. open: 14:30 Skopje');
  assert.equal(windowReference({date:'2026-11-02',window:'before'}),'U.S. open: 15:30 Skopje');
  assert.equal(windowReference({date:'2026-11-02',window:'unknown'}),null);
  assert.deepEqual(upcomingEarnings([{date:'2026-10-24',symbol:'A'},{date:'2026-10-25',symbol:'B',window:'before'}],NOW).map(e=>e.symbol),['B']);
});
test('Date requests coalesce across ranges, stay bounded, and do not turn a missing date into an empty schedule',async()=>{
  let active=0,max=0;const calls=[];
  const service=createEarningsService({now:()=>NOW,fetcher:async(url,options)=>{assert.equal(options.redirect,'error');assert.equal(new URL(url).hostname,'api.nasdaq.com');const day=new URL(url).searchParams.get('date');calls.push(day);max=Math.max(max,++active);await new Promise(r=>setTimeout(r,8));active--;return Response.json(day==='2026-10-27'?{status:{rCode:200},data:null}:payload(day,day==='2026-10-25'?null:[row]));}});
  const [a,b]=await Promise.all([service.get({from:'2026-10-25',to:'2026-10-28'}),service.get({from:'2026-10-26',to:'2026-10-28'})]);
  assert.equal(max,2);assert.equal(calls.length,4);assert.equal(a.status,'stale');assert.deepEqual(a.data.missingDates,['2026-10-27']);assert.equal(a.data.events.length,2);assert.ok(b.data.events.every(e=>e.date>='2026-10-26'));
  await service.get({from:'2026-10-25',to:'2026-10-28'});assert.equal(calls.length,4);
  const empty=await service.get({from:'2026-10-25',to:'2026-10-25'});assert.equal(empty.status,'ok');assert.deepEqual(empty.data.events,[]);
});
test('Cached schedules retain fetch time, expire after one day, and provider backoff survives restart',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'earnings-cache-')),cachePath=join(directory,'cache.json');let now=NOW,blocked=false,calls=0;
  const fetcher=async url=>{calls++;return blocked?new Response('',{status:429,headers:{'retry-after':'3600'}}):Response.json(payload(new URL(url).searchParams.get('date')));};
  try{
    let service=createEarningsService({cachePath,now:()=>now,fetcher});const original=await service.get({from:'2026-10-26',to:'2026-10-26'});assert.equal(original.status,'ok');
    now+=1800001;blocked=true;const stale=await service.get({from:'2026-10-26',to:'2026-10-26'});assert.equal(stale.status,'stale');assert.equal(stale.fetchedAt,original.fetchedAt);assert.deepEqual(stale.data.cachedDates,['2026-10-26']);
    service=createEarningsService({cachePath,now:()=>now,fetcher});const unavailable=await service.get({from:'2026-10-27',to:'2026-10-27'});assert.equal(unavailable.status,'unavailable');assert.equal(unavailable.data,null);assert.equal(calls,2);
    now=NOW+86400001;const expired=await service.get({from:'2026-10-26',to:'2026-10-26'});assert.equal(expired.status,'unavailable');assert.equal(expired.data,null);
    now+=3600001;blocked=false;const recovered=await service.get({from:'2026-10-26',to:'2026-10-26'});assert.equal(recovered.status,'ok');assert.notEqual(recovered.fetchedAt,original.fetchedAt);
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('A date-specific HTTP failure does not suppress healthy reporting dates',async()=>{
 const requested=[],service=createEarningsService({now:()=>NOW,fetcher:async url=>{const date=new URL(url).searchParams.get('date');requested.push(date);return date==='2026-10-26'?new Response('',{status:502}):Response.json(payload(date));}});
 const result=await service.get({from:'2026-10-26',to:'2026-10-29'});assert.equal(result.status,'stale');assert.equal(requested.length,4);assert.deepEqual(result.data.missingDates,['2026-10-26']);assert.equal(result.data.events.length,3);
});
