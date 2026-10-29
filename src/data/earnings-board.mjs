import {addDays,marketDay,weekRange} from './calendar.mjs';
import {tradingDay} from './market-session.mjs';
import {earningsMatches,earningsNumber} from './earnings.mjs';
import {LEVEL_LISTINGS} from './level-listings.mjs';
import {stockEntry} from './instruments.mjs';
const symbolKey=s=>s.replaceAll('.','-');
export function sessionNear(day,direction,include=false){
  for(let i=include?0:1;i<12;i++){const candidate=addDays(day,i*direction),schedule=tradingDay(candidate);if(schedule.kind==='session')return candidate;if(schedule.kind==='unknown')return null;}
  return null;
}
export function earningsBoardDates(now,offset=0){
  const today=marketDay(now),previous=sessionNear(today,-1)||addDays(today,-1),after=sessionNear(today,1,true)||today,next=sessionNear(today,1)||addDays(today,1);
  const week=weekRange(addDays(today,offset*7));
  const days=Array.from({length:5},(_,i)=>addDays(week.from,i+1));
  return {today,previous,after,next,week,days,range:{from:[previous,week.from].sort()[0],to:[next,week.to].sort().at(-1)}};
}
export function resultState(event){
  if(earningsNumber(event.epsActual)===null)return {id:'pending',label:'Pending',detail:'Published results not supplied'};
  const surprise=event.epsSurprise;
  return Number.isFinite(surprise)?surprise>0?{id:'beat',label:'Beat',detail:'EPS above consensus'}:surprise<0?{id:'miss',label:'Miss',detail:'EPS below consensus'}:{id:'met',label:'Met',detail:'EPS matched consensus'}:{id:'reported',label:'Reported',detail:'EPS published; surprise not supplied'};
}
export function earningsBoardRows(events,watchlist,sheet){
  return earningsMatches(events,watchlist).map(event=>{
    const catalog=Object.values(LEVEL_LISTINGS).find(e=>symbolKey(e.symbol)===symbolKey(event.symbol)&&stockEntry(e));
    const listing=event.watchEntries.length===1?event.watchEntries[0]:event.watchEntries.length?null:catalog;
    const level=Object.values(sheet?.instruments||{}).find(e=>!e.futures&&symbolKey(e.symbol)===symbolKey(event.symbol));
    return {...event,listing,level,result:resultState(event),cap:earningsNumber(event.marketCap)};
  }).sort((a,b)=>(b.cap??-1)-(a.cap??-1)||a.symbol.localeCompare(b.symbol));
}
export function groupEarnings(events,dates){
  return {
    recent:events.filter(e=>e.date>=dates.previous&&e.date<=dates.today&&e.result.id!=='pending'),
    after:events.filter(e=>e.date===dates.after&&e.window==='after'),
    before:events.filter(e=>e.date===dates.next&&e.window==='before'),
  };
}
export function compactCap(value){const n=earningsNumber(value);return n===null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:1}).format(n);}
export const surpriseText=value=>Number.isFinite(value)?`${value>0?'+':''}${value.toFixed(1)}%`:'—';
