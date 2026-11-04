export const SESSION_EVENTS={OPEN:'Regular session opens',CLOSE:'Regular session closes',BREAK_START:'Trading break',BREAK_END:'Trading resumes',PRE_MARKET_OPEN:'Pre-market opens',AFTER_HOURS_OPEN:'After-hours opens',AFTER_HOURS_CLOSE:'After-hours closes',OVERNIGHT_OPEN:'Overnight opens'};
const phases={OPEN:'regular',CLOSE:'closed',BREAK_START:'break',BREAK_END:'regular',PRE_MARKET_OPEN:'pre',AFTER_HOURS_OPEN:'post',AFTER_HOURS_CLOSE:'closed',OVERNIGHT_OPEN:'overnight'};
const labels={regular:'Market open',pre:'Pre-market',post:'After-hours',overnight:'Overnight',closed:'Market closed',break:'Trading break',unknown:'Hours unavailable'};
export function instrumentSession(item,fetchedAt,now=Date.now()){
  const unknown={phase:'unknown',label:labels.unknown,next:null};
  if(!item?.events?.length||!Number.isFinite(fetchedAt)||now<fetchedAt-300000||now-fetchedAt>15*60000)return unknown;
  const events=item.events,previous=events.filter(e=>e.at<=now).at(-1),next=events.find(e=>e.at>now);
  // Outside the supplied time events we cannot infer holidays or later hours.
  if(!previous||!next)return unknown;
  let phase=phases[previous.type]||'unknown';
  if(['pre','post','overnight'].includes(phase)&&!item.extendedHours)phase='closed';
  return {phase,label:labels[phase],next};
}
export function normalizeExchanges(raw){
  if(!Array.isArray(raw)||raw.length>1000)throw Error('Exchange schedules are incomplete.');
  const schedules=new Map();
  for(const exchange of raw){
    if(typeof exchange?.name!=='string'||!Array.isArray(exchange.workingSchedules)||exchange.workingSchedules.length>2000)throw Error('Invalid exchange schedule.');
    for(const schedule of exchange.workingSchedules){
      if(!Number.isSafeInteger(schedule.id)||!Array.isArray(schedule.timeEvents)||schedule.timeEvents.length>10000)throw Error('Invalid schedule events.');
      const events=schedule.timeEvents.map(event=>{
        const at=typeof event.date==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(event.date)?Date.parse(event.date):NaN;
        if(!Number.isFinite(at)||!Object.hasOwn(SESSION_EVENTS,event.type))throw Error('Unsupported schedule event.');
        return {at,type:event.type};
      }).sort((a,b)=>a.at-b.at||Number(!a.type.includes('CLOSE'))-Number(!b.type.includes('CLOSE')));
      const value={exchange:exchange.name.slice(0,160),events};
      if(schedules.has(schedule.id)&&JSON.stringify(schedules.get(schedule.id))!==JSON.stringify(value))throw Error('Ambiguous working schedule.');
      schedules.set(schedule.id,value);
    }
  }
  return Object.fromEntries(schedules);
}
