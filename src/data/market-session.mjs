import {addDays, marketDay, DISPLAY_TIME_ZONE} from './calendar.mjs';

// Published exchange calendar, checked 2026-10-24. Outside this coverage we
// show an unknown schedule rather than guessing that a weekday is open.
export const MARKET_CALENDAR = {
  from:'2026-01-01', through:'2028-12-31', verified:'2026-10-24',
  source:'https://www.nyse.com/trade/hours-calendars',
  optionsSource:'https://www.nasdaqtrader.com/Trader.aspx?id=optionshours',
  extendedOptionsSource:'https://www.cboe.com/about/hours/us-options/',
};
const holidayNames = ['New Year’s Day','Martin Luther King Jr. Day','Presidents Day','Good Friday','Memorial Day','Juneteenth','Independence Day','Labor Day','Thanksgiving','Christmas'];
const dates = {
  2026:['01-01','01-19','02-16','04-03','05-25','06-19','07-03','09-07','11-26','12-25'],
  2027:['01-01','01-18','02-15','03-26','05-31','06-18','07-05','09-06','11-25','12-24'],
  // NYSE explicitly does not observe Saturday Jan 1, 2028 on Dec 31, 2027.
  2028:[null,'01-17','02-21','04-14','05-29','06-19','07-04','09-04','11-23','12-25'],
};
const holidays = new Map(Object.entries(dates).flatMap(([year,days])=>days.flatMap((day,i)=>day?[[`${year}-${day}`,holidayNames[i]]]:[])));
const earlyCloses = new Set(['2026-11-27','2026-12-24','2027-11-26','2028-07-03','2028-11-24']);
const nyParts = new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
const localDate = new Intl.DateTimeFormat('en-GB',{timeZone:DISPLAY_TIME_ZONE,weekday:'short',day:'2-digit',month:'short',year:'numeric'});
const localShortDate = new Intl.DateTimeFormat('en-GB',{timeZone:DISPLAY_TIME_ZONE,weekday:'short',day:'2-digit',month:'short'});
const localTime = new Intl.DateTimeFormat('en-GB',{timeZone:DISPLAY_TIME_ZONE,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const localSeconds = new Intl.DateTimeFormat('en-GB',{timeZone:DISPLAY_TIME_ZONE,hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
const localDay = new Intl.DateTimeFormat('en-CA',{timeZone:DISPLAY_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'});
export const clockDate = value => localDate.format(new Date(value));
export const clockTime = (value,seconds=false) => (seconds?localSeconds:localTime).format(new Date(value));
export const clockStamp = value => `${localShortDate.format(new Date(value))} · ${clockTime(value)}`;
export const clockRange = (start,end) => `${clockTime(start)}–${clockTime(end)}${localDay.format(new Date(end))!==localDay.format(new Date(start))?' (+1 day)':''}`;

// Convert the exchange's wall time at each target date using IANA timezone
// rules. Never reuse today's offset for next week's opening.
export function exchangeInstant(day,hour,minute=0) {
  const target=Date.parse(`${day}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00Z`);
  let guess=target;
  for(let i=0;i<3;i++) {
    const p=Object.fromEntries(nyParts.formatToParts(new Date(guess)).map(x=>[x.type,x.value]));
    const represented=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    guess+=target-represented;
  }
  return new Date(guess).toISOString();
}
export function tradingDay(day) {
  if(day<MARKET_CALENDAR.from || day>MARKET_CALENDAR.through) return {day,kind:'unknown'};
  if(holidays.has(day)) return {day,kind:'holiday',reason:holidays.get(day)};
  if([0,6].includes(new Date(`${day}T12:00:00Z`).getUTCDay())) return {day,kind:'weekend'};
  const early=earlyCloses.has(day);
  return {day,kind:'session',early,pre:exchangeInstant(day,4),open:exchangeInstant(day,9,30),close:exchangeInstant(day,early?13:16),post:exchangeInstant(day,early?17:20),optionsClose:exchangeInstant(day,early?13:16,15)};
}
export function marketSession(now=Date.now()) {
  const instant=new Date(now).getTime();
  const today=tradingDay(marketDay(instant));
  let nextOpen=null,nextSession=null;
  for(let i=0;i<12;i++) {
    const candidate=tradingDay(addDays(today.day,i));
    if(candidate.kind==='unknown') break;
    if(candidate.kind==='session' && Date.parse(candidate.open)>instant) {nextOpen=candidate.open;nextSession=candidate;break;}
  }
  let state=today.kind, transition=null;
  if(today.kind==='session') {
    if(instant<Date.parse(today.pre)) {state='closed';transition={label:'Pre-market starts',at:today.pre};}
    else if(instant<Date.parse(today.open)) {state='pre';transition={label:'Market opens',at:today.open};}
    else if(instant<Date.parse(today.close)) {state='open';transition={label:today.early?'Early close':'Market closes',at:today.close};}
    else if(instant<Date.parse(today.post)) {state='after';transition={label:'After-hours ends',at:today.post};}
    else state='closed';
  }
  if(!transition && nextSession) transition={label:'Pre-market starts',at:nextSession.pre};
  const label={open:'Market open',pre:'Pre-market',after:'After-hours',closed:'Market closed',weekend:'Weekend',holiday:'Market holiday',unknown:'Schedule unknown'}[state];
  const detail={open:today.early?'Early-close session':'Regular session',pre:'Before the opening bell',after:'Regular session closed',closed:'Outside trading hours',weekend:'U.S. stock market closed',holiday:today.reason,unknown:'Calendar update needed'}[state];
  return {now:instant,today,state,label,detail,nextOpen,transition,schedule:today.kind==='session' && instant<Date.parse(today.post)?today:nextSession};
}
export function until(at,now) {
  const seconds=Math.max(0,Math.ceil((Date.parse(at)-new Date(now).getTime())/1000));
  const days=Math.floor(seconds/86400),hours=Math.floor(seconds%86400/3600),minutes=Math.floor(seconds%3600/60);
  if(days)return `${days}d ${hours}h ${minutes}m`;
  if(hours)return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds%60}s`;
}
