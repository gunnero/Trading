import test from 'node:test';
import assert from 'node:assert/strict';
import {moneyWeightedReturn} from '../src/data/portfolio-rate.mjs';
import {parsePriceHistory,resolveSymbol,createMarketService,marketDataMiddleware} from '../server/market-data.mjs';
import {NOW,yahooPayload} from './fixtures/market.mjs';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
test('calculated money-weighted rate accounts for flow timing, gains, losses and withdrawals',()=>{
 close(moneyWeightedReturn({startAt:0,endAt:1000,endValue:1100,flows:[{at:0,amount:1000}]}),10);
 close(moneyWeightedReturn({startAt:0,endAt:1000,endValue:2310,flows:[{at:0,amount:1000},{at:500,amount:1000}]}),21);
 close(moneyWeightedReturn({startAt:0,endAt:1000,startValue:1000,endValue:1100,flows:[{at:500,amount:-100}]}),21);
 close(moneyWeightedReturn({startAt:0,endAt:1000,startValue:1000,endValue:900}),-10);
 assert.equal(moneyWeightedReturn({startAt:0,endAt:1000,startValue:1000,endValue:1000}),0);
 assert.equal(moneyWeightedReturn({startAt:0,endAt:1000,startValue:1000,endValue:0}),-100);
});
test('percentage stays unavailable for ambiguous sign changes, zero duration, bad or missing values',()=>{
 for(const input of [{startAt:0,endAt:0,startValue:100,endValue:100},{startAt:0,endAt:1000,startValue:0,endValue:100},{startAt:0,endAt:1000,startValue:1000,endValue:1100,flows:[{at:200,amount:-100},{at:500,amount:100}]},{startAt:0,endAt:1000,startValue:1000,endValue:-5},{startAt:0,endAt:1000,startValue:100,endValue:120,flows:[{at:2000,amount:5}]}])assert.equal(moneyWeightedReturn(input),null);
});
test('stock line history has exact symbol, source prices and dates, with day change from previous close',()=>{
 const p=parsePriceHistory(yahooPayload('AMD'),resolveSymbol('NASDAQ:AMD'),'1D',NOW);
 assert.equal(p.quote.providerSymbol,'AMD');assert.equal(p.range,'1D');assert.equal(p.points.at(-1).value,p.quote.price);assert.equal(p.change,1);assert.ok(p.points.every(x=>x.at<=Date.parse(p.quote.observedAt)));
 assert.throws(()=>parsePriceHistory(yahooPayload('QQQ'),resolveSymbol('NASDAQ:AMD'),'MAX',NOW));assert.throws(()=>parsePriceHistory(yahooPayload('AMD'),resolveSymbol('NASDAQ:AMD'),'ALL',NOW));
});
test('all stock periods are supported, MAX requests full source history, caches and respects provider backoff',async()=>{
 const calls=[];let offline=false,time=NOW;const service=createMarketService({now:()=>time,fetcher:async url=>{calls.push(url);return offline?new Response('',{status:429,headers:{'retry-after':'300'}}):Response.json(yahooPayload(decodeURIComponent(new URL(url).pathname.split('/').at(-1))));}});
 for(const range of ['1D','1W','1M','3M','YTD','1Y','MAX']){const p=await service.priceHistory('NASDAQ:AMD',range);assert.equal(p.range,range);assert.equal(p.symbol,'NASDAQ:AMD');assert.ok(p.points.length);}
 assert.ok(calls.some(url=>new URL(url).searchParams.get('period1')==='-2208988800'&&new URL(url).searchParams.get('interval')==='1d'));const count=calls.length;await service.priceHistory('NASDAQ:AMD','MAX');assert.equal(calls.length,count);
 time+=61000;offline=true;const p=await service.priceHistory('NASDAQ:AMD','MAX');assert.equal(p.status,'stale');const blockedCalls=calls.length;await service.priceHistory('NASDAQ:TSLA','MAX');assert.equal(calls.length,blockedCalls);
 assert.equal((await service.priceHistory('LSE:AMD','MAX')).status,'unavailable');
});
test('price-history route rejects unsupported paths/ranges and methods before fetching',async()=>{
 let calls=0;const middleware=marketDataMiddleware({priceHistory:async(symbol,range)=>{calls++;return {symbol,range};}});
 for(const [url,method,status] of [['/api/market/price-history?symbol=NASDAQ:AMD&range=MAX','GET',200],['/api/market/price-history?symbol=https://evil.invalid&range=MAX','GET',400],['/api/market/price-history?symbol=NASDAQ:AMD&range=ALL','GET',400],['/api/market/price-history?symbol=NASDAQ:AMD&range=MAX','POST',405]]){const res={setHeader(){},end(){}};await middleware({url,method},res,()=>assert.fail());assert.equal(res.statusCode,status);}assert.equal(calls,1);
});

test('MAX retains source observations before 1970 instead of clipping them to the Unix epoch',()=>{
 const payload=yahooPayload('AMD'),row=payload.chart.result[0],at=Date.parse('1965-01-04T14:30:00Z')/1000;
 row.timestamp.unshift(at);for(const key of ['open','close','low','high'])row.indicators.quote[0][key].unshift(10);row.indicators.quote[0].volume.unshift(100);
 const result=parsePriceHistory(payload,resolveSymbol('NASDAQ:AMD'),'MAX',NOW);
 assert.ok(result.points[0].at<0);assert.equal(result.points[0].value,10);
});

test('a provider interval override cannot be mislabeled as daily price history',()=>{
 const payload=yahooPayload('AMD');payload.chart.result[0].meta.dataGranularity='3mo';
 assert.throws(()=>parsePriceHistory(payload,resolveSymbol('NASDAQ:AMD'),'MAX',NOW),/interval/);
});
