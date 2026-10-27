import {addDays,validDay,marketDay,briefingTime} from './calendar.mjs';
import {stockEntry} from './instruments.mjs';
import {tradingDay} from './market-session.mjs';

export const EARNINGS_SOURCE={name:'Nasdaq',url:'https://www.nasdaq.com/market-activity/earnings'};
export function earningsRange({from,to}={}){
  if(!validDay(from)||!validDay(to)||from>to||Date.parse(to)-Date.parse(from)>30*86400000)throw Error('Choose a valid earnings range of up to 31 days.');
  return {from,to};
}
export function earningsDays(range){const days=[];for(let day=range.from;day<=range.to;day=addDays(day,1))days.push(day);return days;}
export const earningsDate=day=>briefingTime(`${day}T12:00:00Z`,{weekday:'short',hour:undefined,minute:undefined});
export const reportWindow=window=>({'before':'Before market','after':'After market','during':'During market'})[window]||'Time not supplied';
export function windowReference(event){
  const day=tradingDay(event.date),instant=event.window==='before'?day.open:event.window==='after'?day.close:null;
  return instant?`U.S. ${event.window==='before'?'open':'close'}: ${briefingTime(instant,{month:undefined,day:undefined})} Skopje`:null;
}
// Match only eligible U.S. stocks/ADRs. A same-ticker foreign listing or ETF is not a company match.
export function earningsMatches(events,watchlist){
  const bySymbol=new Map();
  for(const entry of watchlist.filter(stockEntry)){const key=entry.symbol.replaceAll('.','-');bySymbol.set(key,[...(bySymbol.get(key)||[]),entry]);}
  return events.map(event=>({...event,watchEntries:bySymbol.get(event.symbol.replaceAll('.','-'))||[]}));
}
export function upcomingEarnings(events,now){
  // These dates/windows are not exact release instants. Keep today's entries visible all day.
  return events.filter(event=>event.date>=marketDay(now)).sort((a,b)=>a.date.localeCompare(b.date)||({'before':0,'during':1,'after':2,'unknown':3}[a.window]??3)-({'before':0,'during':1,'after':2,'unknown':3}[b.window]??3)||a.symbol.localeCompare(b.symbol));
}
