import {quoteKey} from './quotes.mjs';

export const INDICATOR_CONTEXT=[['VIX','VIX'],['VIX1D','VIX1D'],['DXY','DXY'],['US10Y','US 10Y'],['US2Y','US 2Y']];
export const FUTURES_CONTEXT=[
  {id:'NYMEX:CL1!',key:'NYMEX:CL1!',label:'CL'},
  {id:'CME_MINI:ES1!',key:'ES',label:'ES'},
  {id:'COMEX:GC1!',key:'COMEX:GC1!',label:'GC'},
  {id:'CME_MINI:NQ1!',key:'NQ',label:'NQ'},
  {id:'CME_MINI:RTY1!',key:'CME_MINI:RTY1!',label:'RTY'},
];
export const CONTEXT_INSTRUMENTS=[...FUTURES_CONTEXT.map(item=>[item.key,item.label]),...INDICATOR_CONTEXT];
export const EXTRA_FUTURES_CHART_KEYS=FUTURES_CONTEXT.map(item=>item.key).filter(key=>key.includes(':'));
export function marketGroups(watchlist){
  return [
    {id:'indicators',label:'Market indicators',source:'Yahoo Finance · U.S. Treasury',items:INDICATOR_CONTEXT.map(([key,label])=>({key,label}))},
    {id:'futures',label:'Futures',source:'Yahoo Finance · futures contracts',items:watchlist.filter(entry=>entry.group==='FUTURES').map(entry=>({key:FUTURES_CONTEXT.find(item=>item.id===entry.id)?.key||entry.id,label:entry.symbol,entry}))},
    {id:'funds',label:'Funds / ETFs',source:'Yahoo Finance · regular session',items:watchlist.filter(entry=>entry.group==='FUND').map(entry=>({key:quoteKey(entry),label:entry.symbol,entry}))},
  ];
}
