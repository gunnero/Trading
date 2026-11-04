import {addDays,eventDay,marketDay,validDay,validateRange,weekRange} from '../src/data/calendar.mjs';

export const FUTURE_CALENDAR_SOURCE={name:'FXMacroData',url:'https://fxmacrodata.com/documentation/reference',feed:'https://api.fxmacrodata.com/v1/calendar/usd'};
const CACHE_KEY='calendar:fxmacro-usd:v1',TTL=30*60_000,MAX_AGE=24*60*60_000;
const text=(v,max=600)=>typeof v==='string'||typeof v==='number'?String(v).trim().slice(0,max):'';
const link=v=>{try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}};
const instant=v=>typeof v==='string'&&/T.*(?:Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;

export function parseFutureCalendar(raw,from){
  if(raw?.currency!=='USD'||!Array.isArray(raw.data)||raw.data.length>5000||raw.start_date!==from||!validDay(raw.history_start_date)||typeof raw.history_truncated!=='boolean'||!validDay(raw.data_quality?.latest_available_date)||raw.data_quality.row_count!==raw.data.length)throw Error('The future calendar returned an incomplete or unrecognized snapshot.');
  const seen=new Set();
  const events=raw.data.map(row=>{
    const stamp=instant(row.announcement_datetime_utc)||(Number.isSafeInteger(row.announcement_datetime)&&row.announcement_datetime>0?new Date(row.announcement_datetime*1000).toISOString():null);
    if(!stamp||!text(row.name)||!text(row.release))throw Error('The future calendar contains an unreadable release.');
    if(row.announcement_datetime_utc&&!instant(row.announcement_datetime_utc))throw Error('The future calendar contains an unreadable timestamp.');
    if(Number.isFinite(row.announcement_datetime)&&Date.parse(stamp)!==row.announcement_datetime*1000)throw Error('The future calendar contains conflicting timestamps.');
    const exact=row.time_announced===true&&row.release_time_assumed!==true&&!['assumed','bounded','unknown'].includes(row.release_time_status);
    const day=exact?marketDay(stamp):validDay(row.announcement_date)?row.announcement_date:marketDay(stamp);
    const id=text(row.calendar_event_id)||`${text(row.release)}:${day}:${exact?stamp:'date'}`;
    if(seen.has(id))throw Error('The future calendar contains duplicate releases.');seen.add(id);
    const status=row.status==='cancelled'||row.release_date_status==='cancelled'?'cancelled':row.release_date_confirmed===true?'confirmed':'estimated';
    return {id:`fxmacro:${id}`,title:text(row.name),country:'US',currency:'USD',date:exact?stamp:null,calendarDate:day,timeLabel:exact?null:'Time TBA',
      impact:({high:'High',medium:'Medium',low:'Low',holiday:'Holiday'})[row.event_importance]||'Other',status,
      // This free endpoint is a schedule, not an actual/consensus values feed.
      actual:null,forecast:null,previous:null,period:text(row.reference_period),unit:text(row.value_unit||row.unit),
      sourceName:text(row.source)||FUTURE_CALENDAR_SOURCE.name,sourceUrl:link(row.source_url),
      dataStale:raw.data_quality.is_stale===true,lastVerifiedAt:instant(row.source_last_updated_at),
      note:[text(row.source_release),text(row.release_time_assumption),text(row.source_changes)].filter(Boolean).join(' · '),
      credits:[row.source_attribution,row.source_license,row.source_license_url].filter(Boolean).map(v=>text(v)),provider:FUTURE_CALENDAR_SOURCE.name};
  });
  const coverageStart=from>raw.history_start_date?from:raw.history_start_date,coverageEnd=raw.data_quality.latest_available_date;
  if(coverageEnd<coverageStart||events.some(e=>eventDay(e)<coverageStart||eventDay(e)>coverageEnd))throw Error('The future calendar contains releases outside its declared coverage.');
  return {events,coverageStart,coverageEnd,planning:true,historyTruncated:raw.history_truncated,sourceStale:raw.data_quality.is_stale===true};
}

export function createCalendarService({getWeekly,fetcher=fetch,now=()=>Date.now(),timeoutMs=12000,cache=new Map(),onCache=()=>{}}){
  let pending;
  const {feed:upstream,...source}=FUTURE_CALENDAR_SOURCE;
  async function snapshot(){
    if(pending)return pending;
    const previous=cache.get(CACHE_KEY),usable=previous?.result.data&&now()-Date.parse(previous.result.fetchedAt)<MAX_AGE&&Date.parse(previous.result.fetchedAt)<=now();
    if(previous?.retryAt>now())return usable?previous.result:{status:'unavailable',source,data:null,message:previous.result.message||'Waiting before checking the calendar source again.'};
    pending=(async()=>{
      const checkedAt=new Date(now()).toISOString();let result,retry=TTL;
      try{
        const from=addDays(marketDay(now()),-90),url=`${upstream}?${new URLSearchParams({start_date:from})}`;
        const response=await fetcher(url,{headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
        if(!response.ok){const value=response.headers.get('retry-after'),delay=/^\d+$/.test(value||'')?Number(value)*1000:Date.parse(value)-now();if(Number.isFinite(delay))retry=Math.max(TTL,Math.min(delay,MAX_AGE));throw Error(`FXMacroData is unavailable (HTTP ${response.status}). Retrying automatically.`);}
        const reader=response.body.getReader();let bytes=0;const chunks=[];
        while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>2_000_000){await reader.cancel();throw Error('The future calendar response is too large.');}chunks.push(value);}
        const data=parseFutureCalendar(JSON.parse(Buffer.concat(chunks).toString('utf8')),from);
        result={status:data.sourceStale?'stale':'ok',source,fetchedAt:checkedAt,checkedAt,data,...(data.sourceStale?{message:'The calendar provider marks this schedule as stale.'}:{})};
      }catch(error){result={status:usable?'stale':'unavailable',source,fetchedAt:usable?previous.result.fetchedAt:null,checkedAt,data:usable?previous.result.data:null,message:error.name==='TimeoutError'?'FXMacroData did not respond in time. Retrying automatically.':error instanceof SyntaxError?'FXMacroData returned an unreadable snapshot.':error.message};}
      if(cache.size>=128&&!cache.has(CACHE_KEY))cache.delete(cache.keys().next().value);
      cache.set(CACHE_KEY,{result,retryAt:now()+retry});onCache(cache);return result;
    })();
    try{return await pending;}finally{pending=null;}
  }
  async function get(input){
    const range=validateRange(input),week=weekRange(marketDay(now())),overlap=range.from<=week.to&&range.to>=week.from;
    const weekly=overlap?await getWeekly():null;
    const validWeek=weekly?.data?.coverageStart&&weekly.data.coverageEnd&&marketDay(weekly.data.coverageStart)>=week.from&&marketDay(weekly.data.coverageEnd)<=week.to;
    if(validWeek&&range.from>=week.from&&range.to<=week.to)return {...weekly,data:{...weekly.data,requestedStart:range.from,requestedEnd:range.to,events:weekly.data.events.filter(e=>eventDay(e)>=range.from&&eventDay(e)<=range.to)}};
    const future=await snapshot(),parts=[];
    if(validWeek)parts.push({feed:weekly,from:week.from,to:week.to});
    if(future.data)parts.push({feed:future,from:future.data.coverageStart,to:future.data.coverageEnd});
    const used=new Set(),missing=[],events=[];
    for(let date=range.from;date<=range.to;date=addDays(date,1)){
      const part=parts.find(p=>date>=p.from&&date<=p.to);
      if(!part){missing.push(date);continue;}
      used.add(part.feed);events.push(...part.feed.data.events.filter(e=>eventDay(e)===date));
    }
    if(!used.size)return {...future,data:null,status:'unavailable',message:future.message||'The free calendar source has no coverage for these dates. Choose a more recent range.'};
    const sources=[...used].map(f=>({...f.source,fetchedAt:f.fetchedAt})),partial=missing.length>0;
    const stale=[...used].some(f=>f.status==='stale'),fetchedAt=[...used].map(f=>f.fetchedAt).filter(Boolean).sort()[0];
    const available=[];for(let date=range.from;date<=range.to;date=addDays(date,1))if(!missing.includes(date))available.push(date);
    const message=partial?`Partial schedule: available ${available[0]} – ${available.at(-1)}. ${future.message||'Some requested dates are outside the provider’s retained coverage.'}`:stale?[...used].find(f=>f.status==='stale')?.message:undefined;
    return {status:stale?'stale':'ok',source:{name:sources.map(s=>s.name).join(' + '),url:future.data?source.url:weekly.source.url},sources,fetchedAt,checkedAt:new Date(now()).toISOString(),...(message?{message}:{}),data:{events,requestedStart:range.from,requestedEnd:range.to,coverageStart:available[0],coverageEnd:available.at(-1),partialCoverage:partial,missingDates:missing,planning:true}};
  }
  return {get};
}
