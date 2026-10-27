import test from 'node:test';
import assert from 'node:assert/strict';
import {parseYahoo,parseCandles,resolveSymbol,quoteIsOld,createMarketService} from '../server/market-data.mjs';
import {entryState,quoteDelay,quoteStamp} from '../src/data/quotes.mjs';
import {parseLevels} from '../src/data/market.js';
import {evaluateRetest,topRetest} from '../src/data/retests.mjs';
import {PRE_NOW,premarketPayload} from './fixtures/market.mjs';
const asset=resolveSymbol('QQQ'),today='2026-10-26';
const sheet=parseLevels('LVLS 2026-10-26\nQQQ|30min|S 709-708|D 702-700'),instrument=sheet.instruments.QQQ;
const extended=body=>parseYahoo(body,asset,PRE_NOW,{extended:true});

test('Monday pre-market uses real source bars and keeps Friday close as a separate reference',()=>{
 const body=premarketPayload(),q=extended(body),regular=parseYahoo(body,asset,PRE_NOW);
 assert.equal(q.price,708.34);assert.equal(q.sessionDate,today);assert.equal(q.observedAt,'2026-10-26T12:25:00.000Z');
 assert.equal(q.sessionType,'pre');assert.equal(q.session,'Pre-market');assert.equal(q.priceSource,'chart-close');
 assert.equal(q.previousClose,704.4);assert.equal(q.volume,null);assert.deepEqual(q.trend,[707.8,708.34]);
 assert.ok(Math.abs(q.changePercent-(708.34/704.4-1)*100)<1e-9);
 assert.deepEqual(q.regularReference,{price:704.4,observedAt:'2026-10-23T20:00:00.000Z',sessionDate:'2026-10-23'});
 assert.equal(regular.sessionDate,'2026-10-23');assert.equal(regular.price,704.4);
 assert.match(quoteDelay(q),/Pre-market · chart price/);assert.match(quoteStamp(q),/13:25 · Skopje · bar time/);
 assert.ok(parseCandles(body,asset,'2m',PRE_NOW).every(b=>b.date==='2026-10-23'));
});

test('Missing, future, invalid or out-of-session observations never re-date Friday’s close',()=>{
 for(const change of [r=>{r.timestamp=r.timestamp.slice(0,-2);},r=>{r.timestamp=r.timestamp.map(t=>t+86400);},r=>{r.indicators.quote[0].close=r.timestamp.map(()=>null);},r=>{r.meta.currentTradingPeriod.pre.end=Date.parse('2026-10-26T12:00Z')/1000;},r=>{delete r.meta.currentTradingPeriod.pre;}]){
  const body=premarketPayload();change(body.chart.result[0]);const q=extended(body);
  assert.equal(q.sessionType,'regular');assert.equal(q.price,704.4);assert.equal(q.sessionDate,'2026-10-23');
 }
 const body=premarketPayload(),r=body.chart.result[0];r.timestamp.push(PRE_NOW/1000+60);r.indicators.quote[0].close.push(999);
 assert.equal(extended(body).price,708.34);
 assert.equal(parseYahoo(body,asset,Date.parse('2026-10-26T13:30Z'),{extended:true}).sessionType,'regular');
});

test('After-hours changes use that day’s regular close; a prior-day close is not enough',()=>{
 const now=Date.parse('2026-10-26T20:10Z'),body=premarketPayload(),r=body.chart.result[0];
 r.timestamp.push(Date.parse('2026-10-26T20:05Z')/1000);r.indicators.quote[0].close.push(711);
 assert.equal(parseYahoo(body,asset,now,{extended:true}).sessionType,'regular');
 r.meta.regularMarketTime=Date.parse('2026-10-26T20:00Z')/1000;r.meta.regularMarketPrice=710;
 const q=parseYahoo(body,asset,now,{extended:true});assert.equal(q.sessionType,'post');assert.equal(q.price,711);assert.equal(q.change,1);assert.equal(q.sessionDate,today);
});

test('Extended readings expire when old or when their source session ends',()=>{
 const q=extended(premarketPayload());assert.equal(quoteIsOld(q,PRE_NOW),false);
 assert.equal(quoteIsOld(q,PRE_NOW+31*60000),true);
 const recent={...q,observedAt:'2026-10-26T13:29:00.000Z'};
 assert.equal(quoteIsOld(recent,Date.parse('2026-10-26T13:29:30Z')),false);
 assert.equal(quoteIsOld(recent,Date.parse('2026-10-26T13:30Z')),true);
 assert.equal(quoteIsOld(q,Date.parse('2026-10-27T12:30Z')),true);
});

test('At the regular open cached pre-market readings are stale, then regular prices replace them',async()=>{
 let now=Date.parse('2026-10-26T13:29:40Z');const body=premarketPayload(),r=body.chart.result[0];
 r.timestamp[r.timestamp.length-1]=Date.parse('2026-10-26T13:29:00Z')/1000;
 const service=createMarketService({now:()=>now,fetcher:async()=>Response.json(body)});
 assert.equal((await service.quote('QQQ')).quote.sessionType,'pre');
 now=Date.parse('2026-10-26T13:30:05Z');assert.equal((await service.quote('QQQ')).status,'stale');
 now=Date.parse('2026-10-26T13:31:00Z');r.meta.regularMarketTime=Date.parse('2026-10-26T13:30:30Z')/1000;r.meta.regularMarketPrice=709;
 r.timestamp.push(r.meta.regularMarketTime);r.indicators.quote[0].close.push(709);
 const current=await service.quote('QQQ');assert.equal(current.status,'ok');assert.equal(current.quote.sessionType,'regular');assert.equal(current.quote.sessionDate,today);assert.equal(current.quote.price,709);assert.deepEqual(current.quote.trend,[709]);
});

test('Quote requests include extended data while charts, flips and setup histories stay regular-only',async()=>{
 const urls=[],service=createMarketService({now:()=>PRE_NOW,fetcher:async url=>{urls.push(new URL(url));return Response.json(premarketPayload());}});
 const quote=await service.quote('QQQ');assert.equal(quote.status,'ok');assert.equal(quote.quote.sessionType,'pre');
 const chart=await service.chart('QQQ','4h'),roles=await service.levelHistory('QQQ','30m',today),setup=await service.setupHistory('QQQ','2m',today);
 assert.equal(chart.quote.sessionType,'regular');assert.equal(setup.quote.sessionType,'regular');
 assert.ok(chart.candles.every(b=>b.date==='2026-10-23'));assert.deepEqual(roles.bars,[]);
 assert.equal(setup.status,'ok');assert.ok(setup.bars.every(b=>b.sessionDate==='2026-10-23'));
 assert.equal(urls[0].searchParams.get('includePrePost'),'true');
 assert.ok(urls.slice(1).every(u=>u.searchParams.get('includePrePost')==='false'));
 assert.equal(evaluateRetest(instrument,today,setup,PRE_NOW).stage,'awaiting-session');
});

test('Extended quote outages retain their original bar time and block level comparisons',async()=>{
 let now=PRE_NOW,offline=false,calls=0;
 const service=createMarketService({now:()=>now,fetcher:async()=>{calls++;if(offline)throw Error('Offline');return Response.json(premarketPayload());}});
 const before=await service.quote('QQQ');now+=61000;offline=true;const after=await service.quote('QQQ');
 assert.equal(after.status,'stale');assert.deepEqual(after.quote,before.quote);assert.equal(after.fetchedAt,before.fetchedAt);
 assert.equal(entryState({symbol:'QQQ',group:'FUND'},sheet,after,now).location,null);
 await service.quote('QQQ');assert.equal(calls,2);
});

test('Today’s levels provide pre-market context without requiring completed regular candles',()=>{
 const q=extended(premarketPayload()),entry={symbol:'QQQ',group:'FUND'},pending={...sheet,instruments:{QQQ:{...instrument,roleStatus:'loading'}}};
 const state=entryState(entry,pending,{status:'ok',quote:q},PRE_NOW);assert.equal(state.label,'Testing supply');assert.equal(state.location.zone.type,'S');assert.match(state.reason,/Pre-market context/);
 const regular=parseYahoo(premarketPayload(),asset,PRE_NOW),waiting=entryState(entry,sheet,{status:'ok',quote:regular},PRE_NOW);
 assert.equal(waiting.label,'Today’s levels ready');assert.equal(waiting.location,null);
 const older=parseLevels('LVLS 2026-10-23\nQQQ|30min|S 709-708');
 assert.equal(entryState(entry,older,{status:'ok',quote:q},PRE_NOW).label,'Dated levels');
});

test('Today’s setup waits for the real regular session and follows Skopje DST without asking for a new import',()=>{
 const quote=parseYahoo(premarketPayload(),asset,PRE_NOW),source={status:'ok',quote,timeframe:'2m',bars:[],through:quote.observedAt};
 const result=evaluateRetest(instrument,today,source,PRE_NOW);
 assert.equal(result.stage,'awaiting-session');assert.equal(result.through,null);assert.match(result.message,/14:30 Skopje/);assert.match(result.message,/No new import/);assert.equal(topRetest([result]),null);
 const afterOpen=evaluateRetest(instrument,today,source,Date.parse('2026-10-26T13:31Z'));assert.match(afterOpen.message,/Waiting for today's regular-session candles/);
 const nextWeek=evaluateRetest({...instrument,sourceDate:'2026-11-02'},'2026-11-02',source,Date.parse('2026-11-02T13:30Z'));assert.match(nextWeek.message,/15:30 Skopje/);
 assert.equal(evaluateRetest({...instrument,sourceDate:'2026-10-22'},today,source,PRE_NOW).stage,'dated');
 assert.equal(evaluateRetest(instrument,today,{...source,status:'stale'},PRE_NOW).stage,'stale');
});

test('A genuine regular-session pattern can confirm; an extended price cannot confirm the same pattern',()=>{
 const start=Date.parse('2026-10-26T13:30Z')/1000,z={...instrument,zones:[{type:'S',low:100,high:101}]};
 const bars=[100.5,101.4,101.3].map((close,i)=>({timestamp:start+i*120,end:start+(i+1)*120,sessionDate:today,open:close-.1,close,low:i===2?100.8:close-.2,high:close+.2,closed:true,indicators:{ema9:101.1,ema21:100.9,vwap:100.8}}));
 const source={status:'ok',timeframe:'2m',quote:{price:101.3,sessionDate:today,sessionType:'regular'},bars,through:bars.at(-1).end};
 assert.equal(evaluateRetest(z,today,source,Date.parse('2026-10-26T13:37Z')).stage,'confirmed');
 const extendedResult=evaluateRetest(z,today,{...source,quote:{...source.quote,sessionType:'pre'}},PRE_NOW);
 assert.equal(extendedResult.stage,'awaiting-session');assert.equal(topRetest([extendedResult]),null);
});
