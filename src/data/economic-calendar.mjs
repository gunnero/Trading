import {addDays,eventDay} from './calendar.mjs';

const impactOrder={High:0,Medium:1,Low:2,Holiday:3,Other:4};
export const impactMatches=(event,impact)=>impact==='all'||(impact==='important'?['High','Medium'].includes(event.impact):event.impact===impact);
export const supplied=value=>value!==null&&value!==undefined&&String(value).trim()!=='';
export function calendarRows(events=[],range,now,upcoming=false) {
  return events.filter(event=>eventDay(event)>=range.from&&eventDay(event)<=range.to&&(!upcoming||!event.date||Date.parse(event.date)>=now))
    .sort((a,b)=>eventDay(a).localeCompare(eventDay(b))||(a.date?Date.parse(a.date):Infinity)-(b.date?Date.parse(b.date):Infinity)||(impactOrder[a.impact]??4)-(impactOrder[b.impact]??4));
}
export function calendarDays(range,events=[],today) {
  const days=[];
  for(let day=range.from;day<=range.to;day=addDays(day,1)) {
    const weekday=new Date(`${day}T12:00:00Z`).getUTCDay();
    if((weekday>0&&weekday<6)||day===today||events.some(event=>eventDay(event)===day))days.push(day);
  }
  return days;
}
export function releaseCountdown(date,now) {
  const ms=Date.parse(date)-now;
  if(!Number.isFinite(ms)||ms<0)return 'Due now';
  const minutes=Math.ceil(ms/60000),days=Math.floor(minutes/1440),hours=Math.floor(minutes%1440/60);
  if(days)return `in ${days}d ${hours}h`;
  if(hours)return `in ${hours}h ${minutes%60}m`;
  return minutes?`in ${minutes}m`:'Due now';
}
export function fetchedAgo(date,now) {
  const elapsed=now-Date.parse(date);
  if(!Number.isFinite(elapsed)||elapsed<0)return 'Fetch time unavailable';
  const minutes=Math.floor(elapsed/60000);
  return minutes<1?'Fetched just now':minutes<60?`Fetched ${minutes} min ago`:`Fetched ${Math.floor(minutes/60)}h ${minutes%60}m ago`;
}
