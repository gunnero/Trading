import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarketService,parseCandles,resolveSymbol,marketDataMiddleware} from '../server/market-data.mjs';
import {tradeDates,tradeListings,validTradeHistory,executionMarkers,tradeViewport} from '../src/data/journal-chart.mjs';
import {fixture} from './fixtures/journal.mjs';
import {yahooPayload} from './fixtures/market.mjs';
const start=Date.parse('2026-10-26T13:30:00Z')/1000,now=Date.parse('2026-10-27T17:00:00Z');
const payload=(frame=2)=>yahooPayload('AMD',{start,step:frame,price:520});
const candles=()=>parseCandles(payload(),resolveSymbol('NASDAQ:AMD'),'2m',now,{full:true});
test('Trade date requests use the exchange date, bounded stock frames and exact available listings',()=>{
  assert.deepEqual(tradeDates(fixture({entryAt:'2026-10-27T00:05:00+01:00',exitAt:'2026-10-27T00:06:00+01:00'})),{from:'2026-10-26',to:'2026-10-26'});
  assert.equal(tradeListings('AMD',[])[0].id,'NASDAQ:AMD');assert.deepEqual(tradeListings('UNKNOWN',[]),[]);
  const listings=[{symbol:'AMD',id:'NYSE:AMD',group:'STOCKS'},{symbol:'AMD',id:'NASDAQ:AMD',group:'STOCKS'}];assert.deepEqual(tradeListings('AMD',listings),listings);
  assert.equal(validTradeHistory('NASDAQ:AMD','2m','2026-10-26','2026-10-26'),true);
  for(const args of [['NQ','2m','2026-10-26','2026-10-26'],['NASDAQ:AMD','4h','2026-10-26','2026-10-26'],['NASDAQ:AMD','2m','2026-02-30','2026-03-01'],['NASDAQ:AMD','2m','2026-01-01','2026-10-26']])assert.equal(validTradeHistory(...args),false);
});
test('Markers retain exact execution seconds, stay distinct in one candle and never invent underlying fills',()=>{
  const trade=fixture({exitAt:'2026-10-26T16:19:59+01:00'}),rows=candles(),markers=executionMarkers(trade,rows,now/1000);
  assert.equal(markers.length,2);assert.ok(markers.every(m=>m.available));assert.equal(markers[1].time-markers[0].time,5);assert.equal(markers[0].bar,markers[1].bar);assert.equal(markers[0].price,undefined);
  assert.equal(executionMarkers(trade,rows.filter(c=>c!==markers[0].bar),now/1000)[0].available,false);
  assert.equal(executionMarkers(trade,rows,markers[0].time-1)[0].available,false);
  assert.equal(executionMarkers(fixture({exitAt:null,exitPrice:null}),rows,now/1000).length,1);
  const boundary=fixture({exitAt:'2026-10-26T21:00:00+01:00'});assert.equal(executionMarkers(boundary,rows,now/1000)[1].available,true);
  const viewport=tradeViewport(trade,rows,'2m');assert.ok(viewport[0]<Date.parse(trade.entryAt)&&viewport[1]>Date.parse(trade.exitAt));
});
test('Historical service requests the actual session, preserves full bars and reuses cache without current-quote staleness',async()=>{
  const urls=[],service=createMarketService({now:()=>now,fetcher:async url=>{urls.push(new URL(url));return Response.json(payload());}});
  const result=await service.tradeHistory('NASDAQ:AMD','2m','2026-10-26','2026-10-26');
  assert.equal(result.status,'ok');assert.equal(result.candles.length,195);assert.equal(result.candles[0].timestamp,start);assert.equal(result.candles.at(-1).end,start+23400);assert.ok(result.indicators.series.ema9.at(-1));assert.ok(result.indicators.series.vwap.at(-1));
  await service.tradeHistory('NASDAQ:AMD','2m','2026-10-26','2026-10-26');assert.equal(urls.length,2);
  assert.equal(urls[0].searchParams.get('range'),null);assert.equal(urls[0].searchParams.get('includePrePost'),'false');assert.equal(+urls[0].searchParams.get('period1'),Date.parse('2026-10-26T04:00Z')/1000);assert.equal(+urls[0].searchParams.get('period2'),Date.parse('2026-10-27T04:00Z')/1000);
  assert.equal((await service.tradeHistory('NASDAQ:AMD','2m','2026-10-28','2026-10-28')).status,'unavailable');assert.equal(urls.length,2);
});
test('Wrong symbol or range, unavailable history and provider backoff never substitute another chart',async()=>{
  let time=now,fail=false,calls=0;
  const service=createMarketService({now:()=>time,fetcher:async()=>{calls++;return fail?new Response('',{status:429}):Response.json(payload());}});
  const good=await service.tradeHistory('NASDAQ:AMD','2m','2026-10-26','2026-10-26');time+=3600001;fail=true;
  const cached=await service.tradeHistory('NASDAQ:AMD','2m','2026-10-26','2026-10-26');assert.equal(cached.status,'stale');assert.equal(cached.fetchedAt,good.fetchedAt);
  const missing=await service.tradeHistory('NASDAQ:AMD','2m','2026-10-23','2026-10-23');assert.equal(missing.status,'unavailable');assert.equal(missing.candles,undefined);assert.equal(calls,3);
  const wrong=createMarketService({now:()=>now,fetcher:async()=>Response.json(yahooPayload('SPY',{start,step:2}))});assert.equal((await wrong.tradeHistory('NASDAQ:AMD','2m','2026-10-26','2026-10-26')).status,'unavailable');
  const outOfRange=createMarketService({now:()=>now,fetcher:async()=>Response.json(payload())});assert.equal((await outOfRange.tradeHistory('NASDAQ:AMD','2m','2026-10-23','2026-10-23')).status,'unavailable');
});
test('Unavailable daily context does not hide execution candles, EMAs or session VWAP',async()=>{
  const service=createMarketService({now:()=>now,fetcher:async url=>new URL(url).searchParams.get('interval')==='1d'?new Response('',{status:503}):Response.json(payload())});
  const result=await service.tradeHistory('NASDAQ:AMD','2m','2026-10-26','2026-10-26');
  assert.equal(result.status,'ok');assert.equal(result.candles.length,195);
  assert.ok(result.indicators.series.ema21.at(-1));assert.ok(result.indicators.series.vwap.at(-1));
  assert.ok(result.indicators.series.sma200.every(value=>value===null));
});
test('History route rejects unsupported identifiers and malformed dates before requesting a provider',async()=>{
  let called=false;const middleware=marketDataMiddleware({tradeHistory:async()=>{called=true;return {status:'ok'};}});
  const res={setHeader(){},end(body){this.body=JSON.parse(body);}};
  await middleware({method:'GET',url:'/api/market/trade-history?symbol=NQ&interval=2m&from=2026-10-26&to=2026-10-26'},res,()=>{});assert.equal(res.statusCode,400);assert.equal(called,false);
  await middleware({method:'GET',url:'/api/market/trade-history?symbol=NASDAQ:AMD&interval=2m&from=2026-10-26&to=2026-10-26'},res,()=>{});assert.equal(res.statusCode,200);assert.equal(called,true);
});
