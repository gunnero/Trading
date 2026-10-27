import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateRetest,topRetest} from '../src/data/retests.mjs';
import {stockEntry,chartableEntry} from '../src/data/instruments.mjs';
import {createMarketService,marketDataMiddleware} from '../server/market-data.mjs';
import {initialWorkspace,validateWorkspace} from '../server/workspace.mjs';
import {NOW,yahooPayload} from './fixtures/market.mjs';
const date='2026-10-23',start=Date.parse(date+'T13:30Z')/1000;
const zone={type:'S',low:100,high:101},instrument={symbol:'TEST',futures:false,timeframe:'4 h',zones:[zone]};
const bar=(i,close,low=close-.2,high=close+.2,extra={})=>({timestamp:start+i*120,end:start+(i+1)*120,sessionDate:date,open:close-.1,close,low,high,closed:true,indicators:{ema9:101.1,ema21:100.9,vwap:100.8,pdh:103,sma200:97},...extra});
const data=bars=>({status:'ok',timeframe:'2m',quote:{price:bars.at(-1).close,sessionDate:date},through:bars.at(-1).end,bars,dailyStatus:'ok'});
const bull=()=>[bar(0,100.5),bar(1,101.4,101.2,101.5),bar(2,101.3,100.8,101.4)];
test('Bullish break needs a separate completed retest with EMA and VWAP alignment',()=>{
 const result=evaluateRetest(instrument,date,data(bull()));assert.equal(result.stage,'confirmed');assert.equal(result.direction,'bullish');assert.equal(result.breakAt,bull()[1].end);assert.equal(result.confirmedAt,bull()[2].end);assert.ok(result.checks.every(c=>c.passed));
 assert.equal(evaluateRetest(instrument,date,data(bull().slice(0,2))).stage,'waiting-retest');
 assert.equal(evaluateRetest(instrument,date,data([bar(0,100.5),bar(1,101.4,100.5,101.5)])).stage,'waiting-retest');
});
test('Bearish break and retest mirror the bullish rules',()=>{
 const bearish={...instrument,zones:[{type:'D',low:99,high:100}]};
 const b=[bar(0,99.5),bar(1,98.8,98.5,99),bar(2,98.9,98.6,99.3)].map(b=>({...b,indicators:{ema9:99,ema21:99.4,vwap:99.3}}));
 const result=evaluateRetest(bearish,date,data(b));assert.equal(result.stage,'confirmed');assert.equal(result.direction,'bearish');assert.equal(result.invalidation,100);
});
test('Wicks, boundary equality and open candles never confirm a break or retest',()=>{
 assert.equal(evaluateRetest(instrument,date,data([bar(0,101,100,102)])).stage,'waiting-break');
 const developing=bull();developing[2].closed=false;assert.equal(evaluateRetest(instrument,date,data(developing)).stage,'waiting-retest');
 const equality=bull();equality[2].close=101;assert.notEqual(evaluateRetest(instrument,date,data(equality)).stage,'confirmed');
});
test('Indicator alignment is required at confirmation and now; missing readings never count as aligned',()=>{
 for(const key of ['ema9','ema21','vwap']){const b=bull();b[2].indicators[key]=null;assert.equal(evaluateRetest(instrument,date,data(b)).stage,'indicators-unavailable');}
 const conflict=bull();conflict[2].indicators.vwap=102;const result=evaluateRetest(instrument,date,data(conflict));assert.equal(result.stage,'indicator-conflict');assert.equal(topRetest([result]),null);
 const later=bull();later[2].indicators.ema9=99;later.push(bar(3,101.35,101.2,101.4));assert.equal(evaluateRetest(instrument,date,data(later)).stage,'indicator-conflict');
});
test('Failed, extended, expired, stale and wrong-session setups do not produce a Top pick',()=>{
 const source=data(bull());source.quote.price=99;assert.equal(evaluateRetest(instrument,date,source).stage,'invalidated');
 source.quote.price=105;assert.equal(evaluateRetest(instrument,date,source).stage,'extended');
 const expired=bull();for(let i=3;i<=5;i++)expired.push(bar(i,101.5,101.3,101.7));assert.equal(evaluateRetest(instrument,date,data(expired)).stage,'expired');
 assert.equal(evaluateRetest(instrument,'2026-10-26',data(bull()),NOW).stage,'dated');assert.equal(evaluateRetest(instrument,date,{...data(bull()),status:'stale'}).stage,'stale');
 const waiting=[bar(0,100.5),bar(1,101.4)];for(let i=2;i<15;i++)waiting.push(bar(i,101.5,101.3,101.7));assert.equal(evaluateRetest(instrument,date,data(waiting)).stage,'expired');
 assert.equal(topRetest([{stage:'expired'},{stage:'extended'},{stage:'stale'},{stage:'invalidated'}]),null);
});
test('Repeated direction changes can form a new setup; original levels and source timeframe stay unchanged',()=>{
 const original=structuredClone(instrument),b=bull();b.push(bar(3,99.7,99.4,100),bar(4,99.8,99.5,100.3));for(const item of b.slice(3))item.indicators={ema9:100,ema21:100.5,vwap:100.4};
 const result=evaluateRetest(instrument,date,data(b));assert.equal(result.stage,'confirmed');assert.equal(result.direction,'bearish');assert.deepEqual(instrument,original);assert.equal(result.timeframe,'2m');
});
test('Ranking favors confirmed retests, then recent events and proximity; Top excludes funds/futures/unsupported venues',()=>{
 const a={stage:'confirmed',confirmedAt:20,distance:.4,entry:{symbol:'A'}},b={stage:'confirmed',confirmedAt:30,distance:.5,entry:{symbol:'B'}};
 assert.equal(topRetest([a,b,{stage:'waiting-retest',breakAt:40}]),b);
 assert.equal(stockEntry({id:'NASDAQ:NVDA',group:'STOCKS'}),true);assert.equal(stockEntry({id:'NYSE:TSM',group:'DEPOSITARY RECEIPT'}),true);
 for(const entry of [{id:'NASDAQ:QQQ',group:'FUND'},{id:'CME_MINI:NQ1!',group:'FUTURES'},{id:'LSE:ABC',group:'STOCKS'}])assert.equal(stockEntry(entry),false);
 assert.equal(chartableEntry({id:'NASDAQ:QQQ',group:'FUND'}),true);
});
test('Verified U.S. listings support charts, roles and setup history; invalid venues are rejected before fetch',async()=>{
 const requested=[],service=createMarketService({now:()=>NOW,fetcher:async url=>{requested.push(url);const symbol=decodeURIComponent(new URL(url).pathname.split('/').at(-1));return Response.json(yahooPayload(symbol,{step:new URL(url).searchParams.get('interval')==='2m'?2:60}));}});
 const chart=await service.chart('NASDAQ:NVDA','4h');assert.equal(chart.status,'ok');assert.equal(chart.symbol,'NASDAQ:NVDA');
 const setup=await service.setupHistory('NASDAQ:NVDA','2m',date);assert.equal(setup.status,'ok');assert.equal(setup.bars.length,195);assert.ok(setup.bars.every(b=>b.closed&&b.end<=setup.through));assert.ok(setup.bars.at(-1).indicators.ema21);assert.ok(setup.bars.at(-1).indicators.vwap);
 const role=await service.levelHistory('NASDAQ:NVDA','4h',date);assert.equal(role.status,'ok');
 const count=requested.length,middleware=marketDataMiddleware(service);
 for(const query of ['symbol=NQ&interval=2m&from='+date,'symbol=LSE:NVDA&interval=2m&from='+date,'symbol=NASDAQ:NVDA&interval=M&from='+date]){const res={setHeader(){},end(){}};await middleware({url:'/api/market/setup?'+query,method:'GET'},res,()=>{});assert.equal(res.statusCode,400);}assert.equal(requested.length,count);
});
test('Developing/cached setup bars never become closed through elapsed time; missing session bars pause confirmation',async()=>{
 const payload=yahooPayload('NVDA',{step:2});let time=(start+5*60)*1000,offline=false;payload.chart.result[0].meta.regularMarketTime=time/1000;
 const service=createMarketService({now:()=>time,fetcher:async()=>{if(offline)throw Error();return Response.json(payload);}});
 const first=await service.setupHistory('NASDAQ:NVDA','2m',date);assert.equal(first.bars.length,2);time+=10*60000;offline=true;const cached=await service.setupHistory('NASDAQ:NVDA','2m',date);assert.equal(cached.status,'stale');assert.deepEqual(cached.bars,first.bars);
 payload.chart.result[0].indicators.quote[0].open[1]=null;const missing=await createMarketService({now:()=>NOW,fetcher:async()=>Response.json(payload)}).setupHistory('NASDAQ:NVDA','2m',date);assert.equal(missing.status,'insufficient');assert.deepEqual(missing.bars,[]);
});
test('Custom selection, focus and strategy interval persist without changing existing primary preferences',()=>{
 const input=initialWorkspace();input.preferences={symbol:'SPY',timeframe:'4h',focus:'custom',customSymbol:'NASDAQ:NVDA',setupInterval:'2m'};
 assert.deepEqual(validateWorkspace(input).preferences,input.preferences);
 for(const bad of [{focus:'bogus'},{customSymbol:'LSE:NVDA'},{setupInterval:'1s'}])assert.throws(()=>validateWorkspace({...input,preferences:{...input.preferences,...bad}}));
 const plan={id:'test',symbol:'NVDA',marketKey:'NASDAQ:NVDA',scenario:'continuation',scenarioTitle:'Bullish break & retest',strategy:'Long call',expiration:'2026-10-30',sessionDate:date,priceMode:'yahoo',marketQuote:{price:211,observedAt:'2026-10-23T20:00Z',provider:'Yahoo Finance'},budget:'',thesis:'Conditional',notes:''};
 assert.equal(validateWorkspace({...input,plans:[plan]}).plans[0].marketKey,'NASDAQ:NVDA');assert.throws(()=>validateWorkspace({...input,plans:[{...plan,marketKey:'NASDAQ:TSLA'}]}));
});
test('Missing final session bars cannot leave an old confirmation eligible under a fresh closing quote',async()=>{
 const payload=yahooPayload('NVDA',{step:2}),r=payload.chart.result[0];r.timestamp=r.timestamp.slice(0,-5);
 const service=createMarketService({now:()=>NOW,fetcher:async()=>Response.json(payload)});
 const result=await service.setupHistory('NASDAQ:NVDA','2m',date);assert.equal(result.status,'insufficient');assert.deepEqual(result.bars,[]);
});
