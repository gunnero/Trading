import {marketDay,validDay} from './calendar.mjs';
import {chartableEntry,isEquityKey} from './instruments.mjs';
import {LEVEL_LISTINGS} from './level-listings.mjs';

export const TRADE_CHART_FRAMES=['2m','5m','15m'];
export function tradeListings(symbol,watchlist){
  const matches=watchlist.filter(row=>row.symbol===symbol&&chartableEntry(row));
  return matches.length?matches:LEVEL_LISTINGS[symbol]?[LEVEL_LISTINGS[symbol]]:[];
}
export function tradeDates(trade){return {from:marketDay(trade.entryAt),to:marketDay(trade.exitAt||trade.entryAt)};}
export function validTradeHistory(symbol,frame,from,to){
  return isEquityKey(symbol)&&TRADE_CHART_FRAMES.includes(frame)&&validDay(from)&&validDay(to)&&from<=to&&(Date.parse(to)-Date.parse(from))/86400000<=30;
}
// A marker identifies an execution time, never an inferred underlying fill price.
// No marker is snapped over a missing candle or extended-hours gap.
export function executionMarkers(trade,candles,observedThrough){
  return [['entry',trade.entryAt],['exit',trade.exitAt]].filter(([,at])=>at).map(([kind,at])=>{
    const time=Date.parse(at)/1000;
    const bar=candles.find(c=>c.timestamp<=time&&time<c.end)||candles.find(c=>c.end===time&&c.end===c.sessionEnd);
    const available=!!bar&&time<=observedThrough;
    return {kind,time,available,bar:available?bar:null};
  });
}
export function tradeViewport(trade,candles,frame){
  const padding=Number.parseInt(frame)*60000*12;
  const first=candles[0].timestamp*1000,last=candles.at(-1).end*1000;
  const start=Math.max(first,Date.parse(trade.entryAt)-padding),end=Math.min(last,Date.parse(trade.exitAt||trade.entryAt)+padding);
  return start<end?[start,end]:[first,last];
}
