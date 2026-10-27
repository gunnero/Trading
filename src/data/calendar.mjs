// Calendar dates are civil dates in New York, independent of the browser zone.
export const marketDay = value => new Intl.DateTimeFormat('en-CA', { timeZone:'America/New_York', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date(value));
export const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0,10) === value;
export const addDays = (day, count) => new Date(Date.parse(`${day}T12:00:00Z`) + count * 86400000).toISOString().slice(0,10);
export function weekRange(day) {
  const from = addDays(day, -new Date(`${day}T12:00:00Z`).getUTCDay());
  return { from, to:addDays(from,6) };
}
export function periodRange(period, today) {
  const week = weekRange(today);
  if (period === 'today') return {from:today,to:today};
  if (period === 'upcoming') return {from:today,to:addDays(today,13)};
  if (period === 'nextweek') return {from:addDays(week.from,7),to:addDays(week.to,7)};
  if (period === 'month' || period === 'nextmonth') {
    const date = new Date(`${today.slice(0,7)}-01T12:00:00Z`);
    if (period === 'nextmonth') date.setUTCMonth(date.getUTCMonth()+1);
    const from = date.toISOString().slice(0,10);
    date.setUTCMonth(date.getUTCMonth()+1);
    return {from,to:addDays(date.toISOString().slice(0,10),-1)};
  }
  return week;
}
export function validateRange({from,to} = {}) {
  if (!validDay(from) || !validDay(to) || from > to || Date.parse(to)-Date.parse(from) > 92*86400000) throw new Error('Choose valid start and end dates, covering up to 93 calendar days.');
  return {from,to};
}
export const eventDay = event => event.calendarDate || (event.date ? marketDay(event.date) : null);

export const DISPLAY_TIME_ZONE = 'Europe/Skopje';
export const briefingTime = (date, options={}) => new Intl.DateTimeFormat('en-US', {
  timeZone:DISPLAY_TIME_ZONE, month:'short', day:'numeric', hour:'2-digit', minute:'2-digit', hourCycle:'h23', ...options,
}).format(new Date(date));

// A date-only event has no instant to convert. Keep its published calendar date.
export const eventDisplayDate = event => event.date
  ? briefingTime(event.date,{hour:undefined,minute:undefined})
  : briefingTime(`${eventDay(event)}T12:00:00Z`,{hour:undefined,minute:undefined});

export function nextHighImpact(events=[], now=Date.now()) {
  return events.filter(event => event.impact === 'High' && event.status !== 'cancelled' && event.date && Date.parse(event.date) >= now)
    .sort((a,b) => Date.parse(a.date)-Date.parse(b.date))[0] || null;
}
