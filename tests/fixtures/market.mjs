import {companyFixture} from './company.mjs';
import {authenticateTestPage} from './auth.mjs';
// Deterministic market fixtures for tests only. The app never imports this module.
import {resolveSymbol,parseCandles,FRAMES} from '../../server/market-data.mjs';
import {chartIndicators} from '../../src/data/indicators.mjs';
import {exchangeInstant} from '../../src/data/market-session.mjs';
export const NOW=Date.parse('2026-10-24T18:00:00Z');
export const PRE_NOW=Date.parse('2026-10-26T12:30:00Z');
export function premarketPayload(symbol='QQQ'){
 const payload=yahooPayload(symbol,{price:704.4,step:2}),r=payload.chart.result[0],seconds=time=>Date.parse(`2026-10-26T${time}Z`)/1000;
 r.meta.currentTradingPeriod={pre:{start:seconds('08:00'),end:seconds('13:30')},regular:{start:seconds('13:30'),end:seconds('20:00')},post:{start:seconds('20:00'),end:seconds('00:00')+86400}};
 r.meta.tradingPeriods={regular:r.meta.tradingPeriods};
 for(const [time,price] of [['12:20',707.8],['12:25',708.34]]){
  r.timestamp.push(seconds(time));
  for(const field of ['open','close','low','high'])r.indicators.quote[0][field].push(price);
  r.indicators.quote[0].volume.push(1200);
 }
 return payload;
}
export function yahooPayload(symbol='QQQ',{price=707.85,start=Date.parse('2026-10-23T13:30:00Z')/1000,minutes=390,step=60}={}){
 const timestamp=Array.from({length:Math.ceil(minutes/step)+1},(_,i)=>Math.min(start+i*step*60,start+minutes*60));
 return {chart:{error:null,result:[{meta:{symbol,instrumentType:symbol.endsWith('=F')?'FUTURE':(symbol.startsWith('^')||symbol==='DX-Y.NYB')?'INDEX':'ETF',currency:'USD',regularMarketPrice:price,regularMarketTime:start+minutes*60,shortName:`Test fixture ${symbol}`,previousClose:price-1,chartPreviousClose:price-20,currentTradingPeriod:{regular:{start,end:start+minutes*60}},tradingPeriods:[[{start,end:start+minutes*60}]]},timestamp,indicators:{quote:[{open:timestamp.map((_,i)=>price-2+i*.2),close:timestamp.map((_,i)=>price-1.9+i*.2),low:timestamp.map((_,i)=>price-2.2+i*.2),high:timestamp.map((_,i)=>price-1.8+i*.2),volume:timestamp.map((_,i)=>100+i)}]}}]}};
}
export function fixtureQuote(key){
 const asset=resolveSymbol(key);
 if(!asset)return {status:'unavailable',quote:null,message:'No verified Yahoo mapping for this exchange/instrument.'};
 const prices={QQQ:707.85,SPY:764.82,NQ:29240,ES:7712,VIX:19.6,US10Y:4.42,US2Y:4.05,'NASDAQ:NVDA':211.95,'NASDAQ:AMD':495.6,'NASDAQ:MU':865,'NASDAQ:TSLA':385.1,'NASDAQ:SMH':526.2};
 const price=prices[key]||100;
 return {status:'ok',fetchedAt:new Date(NOW).toISOString(),quote:{provider:asset.kind==='treasury'?'U.S. Treasury':'Yahoo Finance',providerSymbol:asset.symbol,price,change:1,changePercent:key==='NASDAQ:NVDA'?6:1,kind:asset.kind,sessionDate:'2026-10-23',observedAt:asset.kind==='treasury'?null:'2026-10-23T20:00:00.000Z',delayMinutes:asset.delayMinutes,trend:[price-2,price-1,price-1.2,price],name:`Test fixture ${key}`,volume:100000}};
}
export async function mockMarket(page){
 await authenticateTestPage(page);
 await page.route('**/api/company?*',route=>route.fulfill({json:companyFixture(new URL(route.request().url()).searchParams.get('symbol'))}));
 await page.route('**/api/market/setup?*',route=>{const u=new URL(route.request().url()),symbol=u.searchParams.get('symbol');return route.fulfill({json:{...fixtureQuote(symbol),symbol,timeframe:u.searchParams.get('interval'),from:u.searchParams.get('from'),bars:[],through:null,dailyStatus:'ok'}});});
 await page.route('**/api/market/level-history?*',route=>{const u=new URL(route.request().url());return route.fulfill({json:{status:'ok',symbol:u.searchParams.get('symbol'),timeframe:u.searchParams.get('interval'),from:u.searchParams.get('from'),bars:[],through:null}});});
 await page.route('**/api/market/quotes?*',route=>{const keys=new URL(route.request().url()).searchParams.get('symbols').split(',');return route.fulfill({json:{quotes:Object.fromEntries(keys.map(k=>[k,fixtureQuote(k)]))}});});
 await page.route('**/api/market/chart?*',route=>{
  const url=new URL(route.request().url()),symbol=url.searchParams.get('symbol'),frame=url.searchParams.get('interval'),q=fixtureQuote(symbol);
  if(symbol==='US2Y')return route.fulfill({json:{...q,symbol,timeframe:'D',points:[{date:'2026-10-21',price:4.00},{date:'2026-10-22',price:4.02},{date:'2026-10-23',price:4.05}]}});
  const asset=resolveSymbol(symbol);
  return route.fulfill({json:{...q,symbol,timeframe:frame,candles:parseCandles(yahooPayload(asset.symbol,{price:q.quote.price,step:frame==='2m'?2:frame==='5m'?5:60}),asset,frame,NOW)}});
 });
}

// Long deterministic histories exercise warm-up and daily indicators in browser QA.
export function indicatorFixture(symbol,frame){
 const asset=resolveSymbol(symbol),quote=fixtureQuote(symbol),base=quote.quote.price;
 const dates=Array.from({length:600},(_,i)=>new Date(Date.parse('2026-10-23T12:00Z')-(599-i)*86400000)).filter(date=>![0,6].includes(date.getUTCDay())).map(date=>date.toISOString().slice(0,10));
 function payload(daily){
  const body=yahooPayload(asset.symbol),r=body.chart.result[0],q={open:[],close:[],low:[],high:[],volume:[]};r.timestamp=[];r.meta.tradingPeriods=[];
  const step=daily?390:({'2m':2,'5m':5,'15m':15,'30m':30}[frame]||60),selected=daily?dates:dates.slice(-(['2m','5m'].includes(frame)?5:90));let index=0;
  for(const date of selected){
   const start=Date.parse(exchangeInstant(date,9,30))/1000,end=start+23400;r.meta.tradingPeriods.push([{start,end}]);
   for(let offset=0;offset<390;offset+=step){const value=base*(1+Math.sin(index/12)*.009),close=value+base*.0003*Math.cos(index/3);r.timestamp.push(start+offset*60);q.open.push(value);q.close.push(close);q.low.push(Math.min(value,close)-base*.001);q.high.push(Math.max(value,close)+base*.001);q.volume.push(asset.kind==='index'||asset.kind==='yield'?0:10000+index*13);index++;}
  }
  r.meta.regularMarketPrice=base;r.indicators.quote[0]=q;return body;
 }
 const dailyPayload=payload(true),raw=['D','W','M'].includes(frame)?dailyPayload:payload(false),rows=parseCandles(raw,asset,frame,NOW,{full:true});
 const sourceRows=frame==='4h'?parseCandles(raw,asset,'1h',NOW,{full:true}):rows,dailyRows=parseCandles(dailyPayload,asset,'D',NOW,{full:true});
 return {...quote,symbol,timeframe:frame,candles:parseCandles(raw,asset,frame,NOW),indicators:chartIndicators({rows,sourceRows,dailyRows,frame,now:NOW,limit:FRAMES[frame][2],kind:asset.kind,dailyFetchedAt:new Date(NOW).toISOString()})};
}
