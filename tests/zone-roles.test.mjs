import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {applyZoneRoles,LEVEL_FRAMES} from '../src/data/zone-roles.mjs';
import {parseLevels} from '../src/data/market.js';
import {entryState} from '../src/data/quotes.mjs';
import {createMarketService,marketDataMiddleware,parseCandles,resolveSymbol} from '../server/market-data.mjs';
import {NOW,yahooPayload,fixtureQuote} from './fixtures/market.mjs';
const instrument={symbol:'QQQ',timeframe:'30 min',zones:[{type:'S',low:707.23,high:708.14},{type:'D',low:700,high:702.7},{type:'G',low:710,high:710}]};
const bar=(close,end=1,closed=true)=>({close,end,closed});
test('Full-zone closes flip either way; wicks, equality and developing candles do not',()=>{
 const unchanged=applyZoneRoles(instrument,[{...bar(708.14),high:720,low:690},bar(700,2),bar(900,3,false)]);
 // The close at 700 crosses supply's lower edge, but does not cross demand's lower edge.
 assert.deepEqual(unchanged.zones.map(z=>z.type),['S','D','G']);
 const flipped=applyZoneRoles(instrument,[bar(708.15)]);
 assert.equal(flipped.zones[0].type,'D');assert.deepEqual(flipped.zones[0].lastFlip,{from:'S',to:'D',at:1,close:708.15});
 assert.equal(applyZoneRoles(instrument,[bar(699.99)]).zones[1].type,'S');
});
test('Replay is ordered, handles repeated flips, deduplicates closes, and preserves imported prices/roles',()=>{
 const original=structuredClone(instrument),bars=[bar(709,3),bar(706,2),bar(709,1),bar(709,1)];
 const result=applyZoneRoles(instrument,bars),zone=result.zones[0];
 assert.equal(zone.type,'D');assert.equal(zone.originalType,'S');assert.equal(zone.flipCount,3);assert.equal(zone.lastFlip.at,3);
 assert.deepEqual([zone.low,zone.high],[707.23,708.14]);assert.deepEqual(instrument,original);
 assert.equal(result.zones[2].type,'G');assert.equal(applyZoneRoles(null,bars),null);
 assert.deepEqual(applyZoneRoles(instrument,bars),result);
});
test('Source timeframe is independent of display history, and incomplete candles stay excluded',async()=>{
 const body=yahooPayload('QQQ',{step:30}),start=body.chart.result[0].timestamp[0];
 let time=(start+75*60)*1000;body.chart.result[0].meta.regularMarketTime=time/1000;
 const urls=[],service=createMarketService({now:()=>time,fetcher:async url=>{urls.push(url);return Response.json(body);}});
 const first=await service.levelHistory('QQQ','30m','2026-10-23');
 assert.equal(first.status,'ok');assert.equal(first.bars.length,2);assert.equal(first.through,start+60*60);
 assert.ok(urls[0].includes('interval=30m'));assert.ok(first.bars.every(b=>b.closed));
 time+=30000;const cached=await service.levelHistory('QQQ','30m','2026-10-23');assert.deepEqual(cached.bars,first.bars);assert.equal(urls.length,1);
});
test('Delayed futures and cached source snapshots cannot confirm a candle prematurely',async()=>{
 const body=yahooPayload('NQ=F',{step:30}),start=body.chart.result[0].timestamp[0];
 let time=(start+65*60)*1000,offline=false;body.chart.result[0].meta.regularMarketTime=time/1000;
 const service=createMarketService({now:()=>time,fetcher:async()=>{if(offline)throw Error('offline');return Response.json(body);}});
 const first=await service.levelHistory('NQ','30m','2026-10-23');assert.equal(first.bars.length,1);assert.equal(first.through,start+1800);
 time+=45*60000;offline=true;const cached=await service.levelHistory('NQ','30m','2026-10-23');assert.equal(cached.status,'stale');assert.deepEqual(cached.bars,first.bars);
});
test('Imported 15-minute NQ levels request 15-minute candles and honor futures delay',async()=>{
 const nq=parseLevels('LVLS 2026-10-23\nNQ|15min|S 30370-30332.25|FUT').instruments.NQ;
 const body=yahooPayload('NQ=F',{step:15}),start=body.chart.result[0].timestamp[0],time=(start+50*60)*1000;
 body.chart.result[0].meta.regularMarketTime=time/1000;
 const urls=[],service=createMarketService({now:()=>time,fetcher:async url=>{urls.push(url);return Response.json(body);}});
 const frame=LEVEL_FRAMES[nq.timeframe];assert.equal(frame,'15m');
 let result;const res={setHeader(){},end(text){result=JSON.parse(text);}};
 await marketDataMiddleware(service)({method:'GET',url:`/api/market/level-history?symbol=NQ&interval=${frame}&from=2026-10-23`},res,()=>assert.fail('Expected level-history response'));
 assert.equal(result.status,'ok');assert.equal(result.timeframe,'15m');
 assert.equal(new URL(urls[0]).searchParams.get('interval'),'15m');
 assert.equal(result.bars.length,2);assert.equal(result.through,start+30*60);
 assert.ok(result.bars.every(b=>b.closed&&b.end-b.timestamp===900));
});
test('Closed shortened 4h sessions confirm; missing constituent bars never confirm',async()=>{
 const payload=yahooPayload(),asset=resolveSymbol('QQQ');
 const rows=parseCandles(payload,asset,'4h',NOW,{full:true});assert.equal(rows.length,2);assert.ok(rows.every(r=>r.complete));assert.equal(rows[1].partial,true);
 const service=createMarketService({now:()=>NOW,fetcher:async()=>Response.json(payload)});
 assert.equal((await service.levelHistory('QQQ','4h','2026-10-23')).bars.length,2);
 payload.chart.result[0].indicators.quote[0].open[1]=null;
 assert.equal(parseCandles(payload,asset,'4h',NOW,{full:true})[0].complete,false);
 const missing=createMarketService({now:()=>NOW,fetcher:async()=>Response.json(payload)});
 const valid=await missing.levelHistory('QQQ','4h','2026-10-23');assert.equal(valid.bars.length,1);assert.equal(valid.bars[0].timestamp,rows[1].timestamp);
});
test('Insufficient sheet-date coverage pauses roles even with an old quote; invalid requests never fetch',async()=>{
 let calls=0;const service=createMarketService({now:()=>NOW+3*86400000,fetcher:async()=>{calls++;return Response.json(yahooPayload());}});
 const result=await service.levelHistory('QQQ','30m','2026-10-01');assert.equal(result.status,'insufficient');assert.deepEqual(result.bars,[]);assert.equal(result.through,null);
 const middleware=marketDataMiddleware(service);
 for(const query of ['symbol=VIX&interval=30m&from=2026-10-23','symbol=QQQ&interval=W&from=2026-10-23','symbol=QQQ&interval=30m&from=not-a-date']){
  const res={setHeader(){},end(){}};await middleware({method:'GET',url:'/api/market/level-history?'+query},res,()=>{});assert.equal(res.statusCode,400);
 }
 assert.equal(calls,1);
});
test('Saved cached history replays the same roles after a backend restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'zone-history-')),cachePath=join(dir,'cache.json');
 try{
  const first=await createMarketService({cachePath,now:()=>NOW,fetcher:async()=>Response.json(yahooPayload('QQQ',{step:30,price:710}))}).levelHistory('QQQ','30m','2026-10-23');
  await new Promise(r=>setTimeout(r,350));
  const replay=await createMarketService({cachePath,now:()=>NOW+30000,fetcher:async()=>{throw Error('offline');}}).levelHistory('QQQ','30m','2026-10-23');
  assert.deepEqual(replay.bars,first.bars);assert.equal(applyZoneRoles(instrument,replay.bars).zones[0].type,'D');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('QQQ watchlist uses confirmed current roles, and pauses while confirmation is unavailable',()=>{
 const sheet=parseLevels('LVLS 2026-10-23\nQQQ|30min|S 708.14-707.23'),entry={symbol:'QQQ',exchange:'NASDAQ',group:'FUND'};
 sheet.instruments.QQQ={...applyZoneRoles(sheet.instruments.QQQ,[bar(709)]),roleStatus:'ok'};
 assert.equal(entryState(entry,sheet,fixtureQuote('QQQ')).label,'Testing demand');
 sheet.instruments.QQQ.roleStatus='stale';assert.equal(entryState(entry,sheet,fixtureQuote('QQQ')).location,null);
});
