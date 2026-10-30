import {chartableEntry,isEquityKey} from './instruments.mjs';
import {quoteKey} from './quotes.mjs';
import {compareSetups} from './retests.mjs';
export const GRID_DEFAULTS={view:'single',mode:'watchlist',interval:'2m',range:'session',pins:[]};
export function validateGrid(value){
  if(!value||!['single','grid'].includes(value.view)||!['watchlist','scanner'].includes(value.mode)||!['2m','5m','15m'].includes(value.interval)||!['session','history'].includes(value.range)||!Array.isArray(value.pins)||value.pins.length>6||value.pins.some(key=>!isEquityKey(key))||new Set(value.pins).size!==value.pins.length)throw new Error('Invalid chart grid settings.');
  return {view:value.view,mode:value.mode,interval:value.interval,range:value.range,pins:[...value.pins]};
}
export function gridEntries(watchlist,scan,mode,pins){
  const eligible=[...new Map(watchlist.filter(chartableEntry).map(entry=>[quoteKey(entry),entry])).values()];
  const byKey=new Map(eligible.map(entry=>[quoteKey(entry),entry]));
  const pinned=pins.map(key=>byKey.get(key)).filter(Boolean);
  const candidates=mode==='scanner'?(scan.stocks||[]).filter(result=>['confirmed','retesting','waiting-retest'].includes(result.stage)).toSorted(compareSetups).map(result=>byKey.get(result.key)).filter(Boolean):eligible;
  return {pinned,remaining:candidates.filter(entry=>!pins.includes(quoteKey(entry))),total:candidates.length};
}
// Slice already-computed indicators with their candles; never restart EMA/VWAP at the display boundary.
export function gridHistory(history,range){
  const candles=history?.candles||[],date=candles.at(-1)?.date;
  const first=range==='session'?Math.max(0,candles.findIndex(row=>row.date===date)):0;
  return {candles:candles.slice(first),date,indicators:history?.indicators?{...history.indicators,series:Object.fromEntries(Object.entries(history.indicators.series||{}).map(([key,values])=>[key,values.slice(first)])),sessions:history.indicators.sessions?.slice(first)}:null};
}
