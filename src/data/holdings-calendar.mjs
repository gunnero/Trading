import {addDays,validDay} from './calendar.mjs';

const dayMs=86400000;
const civilDate=day=>new Date(day+'T12:00:00Z');
const formatDate=new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',weekday:'short',day:'numeric',month:'short',year:'numeric'});
const formatMonth=new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',month:'short',year:'numeric'});
export const holdingDateLabel=day=>formatDate.format(civilDate(day));
export const holdingMonthLabel=month=>formatMonth.format(civilDate(month+'-01'));
export function shiftHoldingMonth(month,change){
  const date=civilDate(month+'-01');
  date.setUTCMonth(date.getUTCMonth()+change);
  return date.toISOString().slice(0,7);
}
export function daysUntil(date,today){
  return Math.round((civilDate(date)-civilDate(today))/dayMs);
}
export function calendarRows(holdings,today){
  const events=[],unavailable=[];
  for(const holding of holdings){
    const future=holding.events.filter(event=>validDay(event.date)&&event.date>=today);
    for(const event of future)events.push({holding,event});
    const missing=[];
    if(!future.some(event=>event.type==='Earnings'))missing.push('Earnings');
    if(!future.some(event=>event.type==='Ex-dividend'||event.type==='Dividend payment'))missing.push('Dividend');
    if(missing.length)unavailable.push({holding,missing});
  }
  events.sort((a,b)=>a.event.date.localeCompare(b.event.date)||a.holding.ticker.localeCompare(b.holding.ticker)||a.event.type.localeCompare(b.event.type));
  return {events,unavailable};
}
export function calendarWindow(today,month,day){
  if(day)return {from:day,to:day,title:holdingDateLabel(day)};
  if(month)return {from:month+'-01',to:addDays(shiftHoldingMonth(month,1)+'-01',-1),title:holdingMonthLabel(month)};
  return {from:today,to:addDays(today,29),title:'Next 30 days'};
}
