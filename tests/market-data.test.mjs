import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolveSymbol,parseYahoo,parseCandles,parseTreasury,quoteIsOld,createMarketService,marketDataMiddleware} from '../server/market-data.mjs';
import {initialWorkspace,validateWorkspace} from '../server/workspace.mjs';
import {entryState} from '../src/data/quotes.mjs';
import {parseLevels} from '../src/data/market.js';
import {NOW,yahooPayload} from './fixtures/market.mjs';
const asset=resolveSymbol('QQQ');
test('Verified symbol mappings preserve futures/stock identity and reject unsupported venues',()=>{
 assert.equal(resolveSymbol('NASDAQ:BRK.B').symbol,'BRK-B');assert.equal(resolveSymbol('CME_MINI:NQ1!').symbol,'NQ=F');assert.equal(resolveSymbol('US10Y').symbol,'^TNX');assert.equal(resolveSymbol('US2Y').kind,'treasury');
 for(const key of ['BITSTAMP:BTCUSD','LSE:QQQ','https://bad.test','NASDAQ:AAPL?x','NASDAQ:NQ1!'])assert.equal(resolveSymbol(key),null);
 assert.throws(()=>parseYahoo(yahooPayload('SPY'),asset,NOW));assert.throws(()=>parseYahoo(yahooPayload('QQQ=F'),{...asset,symbol:'QQQ=F'},NOW));
});
test('Quote uses previous session close, preserves source timestamp, rejects missing/future prices',()=>{
 const body=yahooPayload(),q=parseYahoo(body,asset,NOW);assert.equal(q.price,707.85);assert.equal(q.change,1);assert.equal(q.sessionDate,'2026-10-23');assert.equal(q.observedAt,'2026-10-23T20:00:00.000Z');
 delete body.chart.result[0].meta.previousClose;assert.equal(parseYahoo(body,asset,NOW).changePercent,null);
 body.chart.result[0].meta.regularMarketPrice=null;assert.throws(()=>parseYahoo(body,asset,NOW));assert.throws(()=>parseYahoo(yahooPayload(),asset,NOW-86400000));
});
test('Four-hour candles preserve OHLC/volume and exclude the closing marker; no cross-session bars',()=>{
 const body=yahooPayload(),r=body.chart.result[0],hour=parseCandles(body,asset,'1h',NOW),four=parseCandles(body,asset,'4h',NOW);
 assert.equal(hour.length,7);assert.equal(four.length,2);assert.equal(four[0].ohlc[0],hour[0].ohlc[0]);assert.equal(four[0].ohlc[1],hour[3].ohlc[1]);assert.equal(four[0].volume,hour.slice(0,4).reduce((n,x)=>n+x.volume,0));assert.equal(four[0].partial,false);assert.equal(four[1].partial,true);assert.equal(hour.at(-1).timestamp,r.meta.regularMarketTime-1800);
 const next=yahooPayload('QQQ',{start:Date.parse('2026-10-26T13:30:00Z')/1000}).chart.result[0];
 r.timestamp.push(...next.timestamp);r.meta.tradingPeriods.push(...next.meta.tradingPeriods);for(const k of ['open','close','low','high','volume'])r.indicators.quote[0][k].push(...next.indicators.quote[0][k]);
 const combined=parseCandles(body,asset,'4h',Date.parse('2026-10-26T21:00:00Z'));assert.equal(combined.length,4);assert.notEqual(combined[1].date,combined[2].date);
});
test('Early closes and DST use provider session bounds, and malformed candles are dropped',()=>{
 const start=Date.parse('2026-11-27T14:30:00Z')/1000,body=yahooPayload('QQQ',{start,minutes:210});
 const bars=parseCandles(body,asset,'4h',Date.parse('2026-11-27T19:00:00Z'));assert.equal(bars.length,1);assert.equal(bars[0].timestamp,start);assert.equal(bars[0].partial,true);
 body.chart.result[0].indicators.quote[0].open[1]=null;const hours=parseCandles(body,asset,'1h',Date.parse('2026-11-27T19:00:00Z'));assert.equal(hours.length,3);
 const open=parseCandles(yahooPayload(),asset,'4h',Date.parse('2026-10-23T15:00:00Z'));assert.equal(open.length,1);assert.equal(open[0].partial,true);
});
test('Weekly/monthly candles sum supplied daily history without inventing bars',()=>{
 const body=yahooPayload(),r=body.chart.result[0];r.timestamp=['2026-09-30','2026-10-01','2026-10-02','2026-10-05'].map(d=>Date.parse(d+'T13:30Z')/1000);
 r.indicators.quote[0]={open:[10,11,12,13],close:[11,12,13,14],low:[9,10,11,12],high:[12,13,14,15],volume:[10,20,30,40]};
 const months=parseCandles(body,asset,'M',NOW);assert.equal(months.length,2);assert.deepEqual(months[1].ohlc,[11,14,10,15]);assert.equal(months[1].volume,90);assert.equal(months[1].partial,true);
 const weeks=parseCandles(body,asset,'W',NOW);assert.equal(weeks.length,2);assert.equal(weeks[0].volume,60);
});
test('Daily Treasury parser preserves observation dates, excludes future and missing yields',()=>{
 const xml='<feed xmlns:d="d" xmlns:m="m">'+[['2026-10-23',4.69],['2026-10-22',4.65],['2026-10-26',9]].map(([d,p])=>`<entry><content><m:properties><d:NEW_DATE>${d}T00:00:00</d:NEW_DATE><d:BC_2YEAR>${p}</d:BC_2YEAR></m:properties></content></entry>`).join('')+'</feed>';
 const q=parseTreasury(xml,NOW);assert.equal(q.price,4.69);assert.equal(q.observedAt,null);assert.equal(q.sessionDate,'2026-10-23');assert.ok(Math.abs(q.change-.04)<1e-9);assert.throws(()=>parseTreasury('<feed/>',NOW));
});
test('Freshness distinguishes weekend close from stalled session quotes and old daily readings',()=>{
 const q=parseYahoo(yahooPayload(),asset,NOW);assert.equal(quoteIsOld(q,NOW),false);assert.equal(quoteIsOld({...q,observedAt:'2026-10-23T14:00Z'},NOW),true);assert.equal(quoteIsOld(q,Date.parse('2026-10-26T14:30Z')),true);
 assert.equal(quoteIsOld({...q,kind:'treasury',sessionDate:'2026-10-20'},NOW),false);assert.equal(quoteIsOld({...q,kind:'treasury',sessionDate:'2026-10-19'},NOW),true);
});
test('Single-flight cache retains honest source/fetch times, stale outages expire, and failures back off',async()=>{
 let time=NOW,calls=0,offline=false;
 const service=createMarketService({now:()=>time,fetcher:async()=>{calls++;if(offline)throw new Error('offline');return Response.json(yahooPayload());}});
 const [a,b]=await Promise.all([service.quote('QQQ'),service.quote('QQQ')]);assert.equal(calls,1);assert.deepEqual(a,b);time+=30000;assert.equal((await service.quote('QQQ')).fetchedAt,a.fetchedAt);assert.equal(calls,1);
 time+=60000;offline=true;const stale=await service.quote('QQQ');assert.equal(stale.status,'stale');assert.equal(stale.quote.observedAt,a.quote.observedAt);assert.equal(stale.fetchedAt,a.fetchedAt);await service.quote('QQQ');assert.equal(calls,2);
 time+=25*3600000;assert.equal((await service.quote('QQQ')).status,'unavailable');
});
test('Yahoo rate limiting backs off across symbols and does not block Treasury',async()=>{
 let time=NOW,calls=0;
 const service=createMarketService({now:()=>time,fetcher:async()=>{calls++;return new Response('limited',{status:429,headers:{'Retry-After':'3600'}});}});
 await service.quote('QQQ');time+=10*60000;await service.quote('SPY');assert.equal(calls,1);await service.quote('US2Y');assert.equal(calls,2);
});
test('Cached quotes survive a service restart with their original timestamps',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'market-cache-')),cachePath=join(dir,'cache.json');
 try{const a=await createMarketService({cachePath,now:()=>NOW,fetcher:async()=>Response.json(yahooPayload())}).quote('QQQ');await new Promise(r=>setTimeout(r,350));const b=await createMarketService({cachePath,now:()=>NOW+30000,fetcher:async()=>{throw new Error('must use cache');}}).quote('QQQ');assert.deepEqual(a,b);}finally{rmSync(dir,{recursive:true,force:true});}
});
test('API validates requests before fetching and supports partial unavailable symbols',async()=>{
 let calls=0;const middleware=marketDataMiddleware({quote:async key=>{calls++;return {status:key==='QQQ'?'ok':'unavailable'};}});
 for(const [url,method,status] of [['/api/market/quotes?symbols=http%3A%2F%2Fevil','GET',400],['/api/market/chart?symbol=AAPL&interval=4h','GET',400],['/api/market/chart?symbol=QQQ&interval=constructor','GET',400],['/api/market/quotes?symbols=QQQ','POST',405],['/api/market/nope','GET',404]]){const res={setHeader(){},end(body){this.body=body;}};await middleware({url,method},res,()=>{});assert.equal(res.statusCode,status);}assert.equal(calls,0);
 const res={setHeader(){},end(body){this.body=JSON.parse(body);}};await middleware({url:'/api/market/quotes?symbols=QQQ,BITSTAMP%3ABTCUSD',method:'GET'},res,()=>{});assert.equal(res.body.quotes.QQQ.status,'ok');assert.equal(res.body.quotes['BITSTAMP:BTCUSD'].status,'unavailable');
});
test('Real plan reference quotes persist; missing quote evidence is rejected; legacy sample plans remain readable',()=>{
 const data=initialWorkspace(),base={id:'p',symbol:'QQQ',scenario:'rejection',strategy:'Long put',scenarioTitle:'Supply rejection',expiration:'2026-10-30',sessionDate:'2026-10-23',budget:'100',thesis:'Conditional',notes:'',priceMode:'yahoo',marketQuote:{price:707.85,observedAt:'2026-10-23T20:00Z',provider:'Yahoo Finance'}};
 data.plans=[base];assert.equal(validateWorkspace(data).plans[0].marketQuote.price,707.85);data.plans=[{...base,marketQuote:null}];assert.throws(()=>validateWorkspace(data));data.plans=[{...base,priceMode:'sample'}];assert.equal(validateWorkspace(data).plans[0].priceMode,'sample');
});
test('Watchlist comparisons stop for stale or mismatched quotes and futures contract bases',()=>{
 const sheet=parseLevels('LVLS 2026-10-23\nQQQ|4h|S 708-707|D 702-700'),entry={symbol:'QQQ',group:'FUND'},quote=parseYahoo(yahooPayload(),asset,NOW);
 assert.equal(entryState(entry,sheet,{status:'ok',quote}).label,'Testing supply');assert.equal(entryState(entry,sheet,{status:'stale',quote}).location,null);assert.equal(entryState(entry,parseLevels('LVLS 2026-10-26\nQQQ|4h|S 708-707|D 702-700'),{status:'ok',quote},NOW).label,'Dated levels');assert.equal(entryState({...entry,group:'FUTURES'},sheet,{status:'ok',quote}).label,'Context');
});
test('Macro charts use fixed Yahoo aliases and retain index/yield/futures identity',async()=>{
 const requested=[];
 const service=createMarketService({now:()=>NOW,fetcher:async url=>{requested.push(url);const symbol=decodeURIComponent(new URL(url).pathname.split('/').at(-1));return Response.json(yahooPayload(symbol,{price:symbol==='^TNX'?4.988:100}));}});
 for(const [key,symbol] of [['NQ','NQ=F'],['ES','ES=F'],['VIX','^VIX'],['US10Y','^TNX']]){const value=await service.chart(key,'4h');assert.equal(value.status,'ok');assert.equal(value.quote.providerSymbol,symbol);assert.equal(value.candles.length,2);assert.ok(requested.at(-1).includes(encodeURIComponent(symbol)));}
 assert.equal((await service.chart('LSE:NVDA','4h')).status,'unavailable');assert.equal((await service.chart('US2Y','4h')).status,'unavailable');assert.equal(requested.length,8);
});
test('Treasury daily history crosses the year boundary, retains exact dates and caches hourly',async()=>{
 const now=Date.parse('2026-01-06T18:00Z'),urls=[];
 const xml=rows=>'<feed>'+rows.map(([d,p])=>`<entry><content><properties><NEW_DATE>${d}T00:00:00</NEW_DATE><BC_2YEAR>${p}</BC_2YEAR></properties></content></entry>`).join('')+'</feed>';
 const service=createMarketService({now:()=>now,fetcher:async url=>{urls.push(url);return new Response(xml(url.endsWith('2025')?[['2025-12-30',4.1],['2025-12-31',4.12]]:[['2026-01-02',4.15],['2026-01-05',4.2]]));}});
 const result=await service.chart('US2Y','D');assert.equal(result.status,'ok');assert.deepEqual(result.points.map(p=>p.date),['2025-12-30','2025-12-31','2026-01-02','2026-01-05']);assert.equal(result.quote.provider,'U.S. Treasury');assert.equal(result.quote.observedAt,null);assert.equal(result.quote.price,4.2);await service.chart('US2Y','D');assert.equal(urls.length,2);
});
test('Four-hour futures aggregation stays anchored to source sessions crossing midnight',()=>{
 const start=Date.parse('2026-10-22T22:00Z')/1000,body=yahooPayload('NQ=F',{start,minutes:23*60}),nq=resolveSymbol('NQ');
 const bars=parseCandles(body,nq,'4h',NOW);assert.equal(bars.length,6);assert.equal(bars[1].timestamp,start+4*3600);assert.equal(bars[1].volume,104+105+106+107);assert.equal(bars[1].partial,false);assert.equal(bars.at(-1).partial,true);
});

test('Earnings quote aliases require actual U.S. equity metadata, including shared cached results',async()=>{
 let meta={exchangeName:'NMS',instrumentType:'EQUITY',currency:'USD'},calls=0;
 const service=createMarketService({now:()=>NOW,fetcher:async url=>{calls++;const symbol=decodeURIComponent(new URL(url).pathname.split('/').at(-1)),body=yahooPayload(symbol);Object.assign(body.chart.result[0].meta,meta);return Response.json(body);}});
 const good=await service.quote('EARNINGS:GOOG');assert.equal(good.quote.providerSymbol,'GOOG');assert.equal(good.quote.exchangeName,'NMS');
 assert.equal((await service.chart('EARNINGS:GOOG','4h')).status,'unavailable');assert.equal(calls,1);
 for(const [symbol,fields] of [['BAD1',{exchangeName:'LSE'}],['BAD2',{currency:'GBP'}],['BAD3',{instrumentType:'ETF'}],['BAD4',{exchangeName:null}]]){
  meta={exchangeName:'NMS',instrumentType:'EQUITY',currency:'USD',...fields};
  await service.quote(`NASDAQ:${symbol}`);const before=calls;
  assert.equal((await service.quote(`EARNINGS:${symbol}`)).status,'unavailable');assert.equal(calls,before);
 }
 meta={exchangeName:'NYQ',instrumentType:'EQUITY',currency:'USD'};
 assert.equal((await service.quote('EARNINGS:CL')).quote.providerSymbol,'CL');assert.equal(resolveSymbol('NYMEX:CL1!').symbol,'CL=F');
});
