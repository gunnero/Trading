import {eventDay} from './calendar.mjs';
import {tradingDay} from './market-session.mjs';

export const DEFAULT_DISPLAY_TIME=Object.freeze({timeZone:'Europe/Skopje',hourCycle:'h23'});
export function validateDisplayTime(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.timeZone!=='string'||value.timeZone.length>80||!['h23','h12'].includes(value.hourCycle))throw new Error('Choose a valid time zone and 12-hour or 24-hour format.');
  try{new Intl.DateTimeFormat('en',{timeZone:value.timeZone});}catch{throw new Error('Choose a supported time zone.');}
  return {timeZone:value.timeZone,hourCycle:value.hourCycle};
}
export function displayTimeSettings(value){try{return validateDisplayTime(value);}catch{return {...DEFAULT_DISPLAY_TIME};}}
export function timeZones(current=DEFAULT_DISPLAY_TIME.timeZone){
  return [...new Set([current,'Europe/Skopje','UTC','America/New_York','Asia/Kathmandu',...(Intl.supportedValuesOf?.('timeZone')||['Europe/London','Europe/Berlin','America/Chicago','America/Los_Angeles','Asia/Tokyo','Asia/Kolkata','Asia/Kathmandu','Australia/Sydney'])])].sort();
}
// These formatters only change presentation. Exchange dates and execution instants
// remain independent of the owner's selected display zone.
export function createDisplayTime(value){
  const settings=displayTimeSettings(value),{timeZone,hourCycle}=settings;
  const zoneLabel=timeZone==='UTC'?'UTC':timeZone.split('/').at(-1).replaceAll('_',' '),formatLabel=hourCycle==='h12'?'12h':'24h';
  const cache=new Map();
  function format(instant,options,locale='en-GB'){
    const key=JSON.stringify([locale,options]);
    if(!cache.has(key))cache.set(key,new Intl.DateTimeFormat(locale,{timeZone,hourCycle,...options}));
    return cache.get(key).format(new Date(instant));
  }
  const clockDate=value=>format(value,{weekday:'short',day:'2-digit',month:'short',year:'numeric'});
  const clockTime=(value,seconds=false)=>format(value,{hour:'2-digit',minute:'2-digit',...(seconds?{second:'2-digit'}:{})}).toUpperCase();
  const clockStamp=value=>`${format(value,{weekday:'short',day:'2-digit',month:'short'})} · ${clockTime(value)}`;
  const displayDay=value=>format(value,{year:'numeric',month:'2-digit',day:'2-digit'},'en-CA');
  const clockRange=(start,end)=>`${clockTime(start)}–${clockTime(end)}${displayDay(start)!==displayDay(end)?' (+1 day)':''}`;
  const briefingTime=(value,options={})=>format(value,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',...options},'en-US');
  const eventDisplayDate=event=>event.date?briefingTime(event.date,{hour:undefined,minute:undefined}):briefingTime(`${eventDay(event)}T12:00:00Z`,{timeZone:'UTC',hour:undefined,minute:undefined});
  const quoteStamp=q=>q?.observedAt?`${clockStamp(q.observedAt)} · ${zoneLabel}${q.priceSource==='chart-close'?' · bar time':''}`:q?.sessionDate?`${q.sessionDate} · daily`:'Awaiting quote';
  const windowReference=event=>{const day=tradingDay(event.date),instant=event.window==='before'?day.open:event.window==='after'?day.close:null;return instant?`U.S. ${event.window==='before'?'open':'close'}: ${briefingTime(instant)} ${zoneLabel}`:null;};
  const journalStamp=value=>value?`${displayDay(value)} · ${clockTime(value,true)}`:'Open';
  return {settings,zoneLabel,formatLabel,clockDate,clockTime,clockStamp,clockRange,briefingTime,marketTime:briefingTime,eventDisplayDate,quoteStamp,windowReference,displayDay,journalStamp};
}
