import {FUTURES_CONTEXT} from './market-context.mjs';
import {quoteKey} from './quotes.mjs';

export const FOCUS_SYMBOLS=['QQQ','SPY'];
export const CONTEXT_SYMBOLS=['NQ','ES','IWM','RTY'];

// Use only the same explicitly mapped listings as the existing charts.
export function levelChartKey(instrument,destination){
  if(!instrument)return null;
  if(instrument.futures)return FUTURES_CONTEXT.find(item=>item.label===instrument.symbol)?.key||null;
  return destination.kind==='setup'?quoteKey(destination.entry):null;
}
export function zoneDistance(zone,price){
  return Number.isFinite(price)?Math.max(zone.low-price,price-zone.high,0):null;
}
export function nearestLevelZones(zones,type,price){
  return zones.filter(zone=>zone.type===type).toSorted((a,b)=>{
    if(Number.isFinite(price))return zoneDistance(a,price)-zoneDistance(b,price)||a.low-b.low;
    return type==='D'?b.high-a.high:a.low-b.low;
  }).slice(0,2);
}
