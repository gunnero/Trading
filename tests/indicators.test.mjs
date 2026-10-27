import test from 'node:test';
import assert from 'node:assert/strict';
import {sma,ema,sessionVwap,chartIndicators,ribbonSegments} from '../src/data/indicators.mjs';
import {createMarketService,parseCandles,resolveSymbol} from '../server/market-data.mjs';
import {yahooPayload,NOW} from './fixtures/market.mjs';
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);
function dailyRows(count=250){
 let day=Date.parse('2025-01-02T14:30Z');const rows=[];
 while(rows.length<count){if(![0,6].includes(new Date(day).getUTCDay())){const value=rows.length+1;rows.push({timestamp:day/1000,date:new Date(day).toISOString().slice(0,10),end:day/1000+23400,ohlc:[value,value,value-0.5,value+0.5],volume:100});}day+=86400000;}
 return rows;
}
test('SMA requires the full window and EMA uses an SMA seed followed by exponential weighting',()=>{
 assert.deepEqual(sma([2,4,6,10,4],3),[null,null,4,20/3,20/3]);assert.deepEqual(ema([2,4,6,10,4],3),[null,null,4,7,5.5]);
 assert.deepEqual(sma([1,2,null,4,5,6],3),[null,null,null,null,null,5]);assert.deepEqual(ema([1,2,3,null,4,5,6],3),[null,null,2,null,null,null,5]);
});
test('VWAP preserves source sessions across midnight, weights volume and resets the next session',()=>{
 const rows=[{start:100,timestamp:100,end:160,date:'2026-10-22',ohlc:[10,10,9,11],volume:100},{start:100,timestamp:160,end:220,date:'2026-10-23',ohlc:[20,20,19,21],volume:300},{start:500,timestamp:500,end:560,date:'2026-10-23',ohlc:[30,30,29,31],volume:100}];
 assert.deepEqual(sessionVwap(rows),[10,17.5,30]);
 assert.deepEqual(sessionVwap([{...rows[0],volume:0},rows[1]]),[null,20]);
 assert.deepEqual(sessionVwap([{...rows[0],volume:null},rows[1],rows[2]]),[null,null,30]);
 assert.deepEqual(sessionVwap([rows[1],rows[2]]),[null,30]);
 assert.deepEqual(sessionVwap([rows[0],{...rows[1],timestamp:180},rows[2]]),[10,null,30]);
});
test('Daily SMAs and prior H/L/C exclude the developing/current day on intraday bars',()=>{
 const daily=dailyRows(250),last=daily.at(-1),rows=[{...last,sessionDate:last.date,start:last.timestamp,end:last.timestamp+3600}];
 const indicators=chartIndicators({rows,dailyRows:daily,frame:'1h',now:(last.end+1)*1000});
 near(indicators.series.sma200[0],149.5);assert.equal(indicators.series.pdh[0],249.5);assert.equal(indicators.series.pdl[0],248.5);assert.equal(indicators.series.pdc[0],249);assert.equal(indicators.previousDay,daily.at(-2).date);
 const changed=daily.map((row,i)=>i===249?{...row,ohlc:[999,999,998,1000]}:row);
 assert.deepEqual(chartIndicators({rows,dailyRows:changed,frame:'1h',now:(last.end+1)*1000}).series,indicators.series);
 near(chartIndicators({rows:[{...rows[0],end:last.end}],dailyRows:daily,frame:'1h',now:(last.end+1)*1000}).series.sma200[0],150.5);
 const earlier={...daily[199],sessionDate:daily[199].date,start:daily[199].timestamp,end:daily[199].timestamp+3600};
 assert.equal(chartIndicators({rows:[earlier],dailyRows:daily,frame:'1h',now:(last.end+1)*1000}).series.sma200[0],null);
});
test('Daily and weekly charts use confirmed daily closes, never 200 visible chart bars',()=>{
 const daily=dailyRows(),last=daily.at(-1),weekly={...last,date:daily.at(-5).date,lastDate:last.date};
 for(const [frame,rows] of [['D',[last]],['W',[weekly]],['M',[weekly]]]){
  const value=chartIndicators({rows,dailyRows:daily,frame,now:(last.end+1)*1000});near(value.series.sma200[0],150.5);assert.equal(value.vwapStatus,'intraday-only');assert.deepEqual(value.series.vwap,[null]);
 }
 near(chartIndicators({rows:[last],dailyRows:daily,frame:'D',now:(last.timestamp+3600)*1000}).series.sma200[0],149.5);
});
test('Historical projections never use later daily closes and EMA warms up before trimming',()=>{
 const daily=dailyRows(),rows=daily.slice(210),all=chartIndicators({rows:daily,dailyRows:daily,frame:'D',now:(daily.at(-1).end+1)*1000,limit:40});
 near(all.series.ema21[0],ema(daily.map(r=>r.ohlc[1]),21)[210]);near(all.series.sma200[0],111.5);assert.equal(all.series.ema21.length,rows.length);
 const truncated=chartIndicators({rows:daily.slice(0,211),dailyRows:daily.slice(0,211),frame:'D',now:(daily[210].end+1)*1000,limit:1});near(truncated.series.sma200[0],all.series.sma200[0]);
});
test('4h VWAP samples source hourly cumulative volume instead of aggregated-candle typical prices',()=>{
 const body=yahooPayload(),asset=resolveSymbol('QQQ'),sourceRows=parseCandles(body,asset,'1h',NOW,{full:true}),rows=parseCandles(body,asset,'4h',NOW,{full:true});
 const value=chartIndicators({rows,sourceRows,frame:'4h',now:NOW});near(value.series.vwap[0],sessionVwap(sourceRows)[3]);near(value.series.vwap[1],sessionVwap(sourceRows).at(-1));
 const noVolume=chartIndicators({rows,sourceRows,frame:'4h',now:NOW,kind:'index'});assert.equal(noVolume.vwapStatus,'no-volume');assert.deepEqual(noVolume.series.vwap,[null,null]);
});
test('EMA ribbon splits exactly at crossings and does not bridge missing values',()=>{
 const segments=ribbonSegments([2,0],[0,2]);assert.equal(segments.length,2);assert.equal(segments[0].bull,true);assert.equal(segments[1].bull,false);assert.deepEqual(segments[0].points[1],[.5,1]);assert.deepEqual(segments[1].points[0],[.5,1]);assert.equal(ribbonSegments([1,null,3],[2,2,2]).length,0);
});
test('Cached developing daily bars never become completed merely because wall time advanced',()=>{
 const daily=dailyRows(),last=daily.at(-1),value=chartIndicators({rows:[last],dailyRows:daily,frame:'D',now:(last.end+3600)*1000,dailyFetchedAt:new Date((last.timestamp+3600)*1000).toISOString(),dailyStatus:'stale'});
 near(value.series.sma200[0],149.5);assert.equal(value.dailyStatus,'stale');
 const evening={...last,sessionDate:'2099-01-01',timestamp:last.end-3600,start:last.end-3600,end:last.end};
 assert.equal(chartIndicators({rows:[evening],dailyRows:daily,frame:'1h',now:(last.end+3600)*1000}).series.pdc[0],249);
});
test('Daily service computes SMA 200 before trimming to 120 displayed candles',async()=>{
 const daily=dailyRows(300),body=yahooPayload(),r=body.chart.result[0];r.timestamp=daily.map(x=>x.timestamp);r.indicators.quote[0]={open:daily.map(x=>x.ohlc[0]),close:daily.map(x=>x.ohlc[1]),low:daily.map(x=>x.ohlc[2]),high:daily.map(x=>x.ohlc[3]),volume:daily.map(x=>x.volume)};
 const service=createMarketService({now:()=>NOW,fetcher:async()=>Response.json(body)}),value=await service.chart('QQQ','D');assert.equal(value.candles.length,120);assert.equal(value.indicators.series.sma200.length,120);near(value.indicators.series.sma200.at(-1),200.5);assert.equal(value.indicators.series.sma200[0],null);
});
test('Failed daily history leaves candles and chart-timeframe indicators available; daily fetch is shared',async()=>{
 const urls=[],service=createMarketService({now:()=>NOW,fetcher:async url=>{urls.push(url);return url.includes('interval=1d')?new Response('offline',{status:503}):Response.json(yahooPayload());}});
 const first=await service.chart('QQQ','4h');assert.equal(first.status,'ok');assert.equal(first.candles.length,2);assert.equal(first.indicators.dailyStatus,'unavailable');assert.deepEqual(first.indicators.series.sma200,[null,null]);assert.equal(first.indicators.vwapStatus,'ok');await service.chart('QQQ','1h');assert.equal(urls.length,2);
});
