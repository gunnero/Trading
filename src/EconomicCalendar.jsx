import {PageHeader} from './PageHeader';
import {useRef,useState} from 'react';
import {CalendarBlank,CaretLeft,CaretRight,CaretDown,Factory,ArrowsClockwise} from '@phosphor-icons/react';
import {useDisplayTime} from './DisplayTime';
import {useFeed,SourceLink,FeedStatus,Unavailable} from './Feeds';
import {marketDay,addDays,weekRange,periodRange,validateRange,eventDay,nextHighImpact} from './data/calendar.mjs';
import {calendarRows,impactMatches,supplied,releaseCountdown,fetchedAgo} from './data/economic-calendar.mjs';
import './economic-calendar.css';

const value=text=>supplied(text)?text:'—';
const dayLabel=day=>new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',weekday:'short',month:'short',day:'numeric',year:'numeric'}).format(new Date(`${day}T12:00:00Z`));
const rangeLabel=range=>`${new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',weekday:'short',day:'numeric',...(range.from.slice(0,7)!==range.to.slice(0,7)?{month:'short'}:{})}).format(new Date(`${range.from}T12:00:00Z`))} – ${dayLabel(range.to)}`;
const periods=[['today','Today'],['upcoming','Upcoming'],['week','This week'],['nextweek','Next week'],['month','This month'],['nextmonth','Next month']];
const sourceFallback={name:'Calendar source',url:'https://www.forexfactory.com/calendar'};
function ImpactBadge({impact='Other'}) {
  const label=impact==='Other'?'Unrated':impact;
  return <span className={`eco-impact impact ${impact.toLowerCase()}`} title={impact==='Holiday'?'Holiday / non-economic event':`${label} expected impact`}><Factory size={14} weight="fill" aria-hidden="true"/>{label}</span>;
}
function EventTime({event}) {
  const {eventDisplayDate,clockTime,displayDay}=useDisplayTime();
  const rollover=event.date&&displayDay(event.date)!==eventDay(event);
  return <time dateTime={event.date||eventDay(event)}>{rollover&&<span>{eventDisplayDate(event)} · </span>}{event.date?clockTime(event.date):event.timeLabel||'Time TBA'}</time>;
}
function EventNotes({event}) {
  const caution=[event.status==='cancelled'?'Cancelled':event.status==='estimated'?'Estimated schedule':null,event.dataStale?'Verification overdue':null,event.timeRole==='auction-close'?'Auction closes':null].filter(Boolean).join(' · ');
  return <><div className="eco-event-meta"><span>{['U.S.',event.period,event.unit].filter(Boolean).join(' · ')}</span>{event.sourceName&&<>{' · '}{event.sourceUrl?<SourceLink href={event.sourceUrl}>{event.sourceName}</SourceLink>:event.sourceName}</>}</div>{caution&&<small className="eco-caution">{caution}</small>}{(event.note||event.credits?.length)&&<details className="eco-event-notes"><summary>Release details</summary>{event.note&&<p>{event.note}</p>}{event.credits?.map((credit,i)=><p key={i}>{credit}</p>)}</details>}</>;
}
function WeekPicker({range,today,day,onDay,onShift}) {
  const anchor=day||(today>=range.from&&today<=range.to?today:range.from),week=weekRange(anchor);
  const dates=Array.from({length:7},(_,i)=>addDays(week.from,i));
  const month=new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',month:'short',year:'numeric'}).format(new Date(`${anchor}T12:00:00Z`));
  return <div className="eco-mini-calendar" aria-label="Calendar week navigator"><div className="eco-mini-heading"><button type="button" aria-label="Go to previous week" onClick={()=>onShift(-1)}><CaretLeft size={16}/></button><strong>{month}</strong><button type="button" aria-label="Go to next week" onClick={()=>onShift(1)}><CaretRight size={16}/></button></div><div className="eco-mini-days">{dates.map((date,i)=><div key={date}><span>{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][i]}</span><button type="button" aria-label={`View economic releases for ${date}`} aria-pressed={date===day} aria-current={date===today?'date':undefined} disabled={date<range.from||date>range.to} onClick={()=>onDay(date)}>{Number(date.slice(-2))}</button></div>)}</div></div>;
}
function NextRelease({feed,now}) {
  const {zoneLabel,marketTime}=useDisplayTime();
  const event=nextHighImpact(feed.data?.events,now),partial=feed.data?.partialCoverage;
  const batch=event?feed.data.events.filter(e=>e.impact==='High'&&e.status!=='cancelled'&&e.date&&Date.parse(e.date)===Date.parse(event.date)):[];
  const heading=event?.title||(feed.status==='loading'?'Checking upcoming releases…':partial?'No further high-impact release in available dates':feed.data?'No timed high-impact release listed':'Upcoming schedule unavailable');
  return <section className="eco-next" aria-label="Next high-impact release"><details><summary className="eco-next-heading"><Factory size={18} weight="fill" aria-hidden="true"/><div className="eco-next-summary"><span>Next release: </span><h2>{heading}</h2>{event&&<time dateTime={event.date}> · {marketTime(event.date,{weekday:'short'})}</time>}{partial&&<span className="eco-coverage-label"> · Partial coverage</span>}{feed.status==='stale'&&<span> · Cached</span>}{event?.status==='estimated'&&<span> · Estimated</span>}</div><CaretDown size={14} className="eco-next-chevron"/></summary><div className="eco-next-details">{event&&<><p className="eco-countdown"><strong>{releaseCountdown(event.date,now)}</strong> until scheduled release · {zoneLabel}{event.dataStale?' · Verification overdue':''}</p><div className="eco-next-metrics" role="table" aria-label="Next release estimates"><div role="row"><span role="columnheader">Release</span><span role="columnheader">Forecast</span><span role="columnheader">Previous</span></div>{batch.map(item=><div role="row" key={item.id}><strong role="cell">{item.title}</strong><span role="cell">{value(item.forecast)}</span><span role="cell">{value(item.previous)}</span></div>)}</div></>}<div className="eco-next-source"><span>{feed.source?.name||'U.S. releases'} · {partial?`Available ${feed.data.coverageStart} – ${feed.data.coverageEnd}`:'Next 14 days'}{feed.fetchedAt?` · ${fetchedAgo(feed.fetchedAt,now)}`:''}</span><button className="icon-button" type="button" aria-label="Refresh upcoming schedule" disabled={feed.status==='loading'||feed.refreshing} onClick={feed.refresh}><ArrowsClockwise size={16}/></button></div></div></details>{feed.message&&<p className="eco-next-warning" role="status">{feed.message}</p>}</section>;
}
export default function EconomicCalendar({briefing}) {
  const {now,calendar:upcoming}=briefing;
  const {zoneLabel,formatLabel}=useDisplayTime();
  const today=marketDay(now);
  const [period,setPeriod]=useState(briefing.calendarPeriod),[impact,setImpact]=useState('all'),[custom,setCustom]=useState(null),[selectedDay,setSelectedDay]=useState(null);
  const [editing,setEditing]=useState(false),[draft,setDraft]=useState({from:'',to:''}),[error,setError]=useState(''),[limit,setLimit]=useState(60);
  const tableRef=useRef(null);
  const range=period==='custom'?custom:periodRange(period,today);
  const feed=useFeed(`/api/calendar?${new URLSearchParams(range)}`);
  const events=calendarRows(feed.data?.events,range,now,period==='upcoming');
  const day=selectedDay>=range.from&&selectedDay<=range.to?selectedDay:null;
  const daily=day?events.filter(e=>eventDay(e)===day):events;
  const rows=daily.filter(e=>impactMatches(e,impact));
  const groups=Object.groupBy(rows.slice(0,limit),eventDay);
  const title=day?day===today?'Today':dayLabel(day):periods.find(([id])=>id===period)?.[1]||'Selected dates';
  const source=feed.source||sourceFallback;
  function selectPeriod(id) {setPeriod(id);briefing.setCalendarPeriod(id);setSelectedDay(null);setLimit(60);setEditing(false);setError('');}
  function shiftWeek(direction) {setCustom(weekRange(addDays(range.from,direction*7)));setPeriod('custom');setSelectedDay(null);setLimit(60);setEditing(false);setError('');}
  function applyRange(e) {e.preventDefault();try{setCustom(validateRange(draft));setPeriod('custom');setSelectedDay(null);setLimit(60);setEditing(false);setError('');}catch(err){setError(err.message);}}
  function selectDay(date) {setSelectedDay(date);setLimit(60);tableRef.current?.scrollIntoView({behavior:'instant',block:'nearest'});tableRef.current?.focus({preventScroll:true});}
  const changeImpact=id=>{setImpact(id);setLimit(60);};
  return <div className="economic-page calendar-panel">
    <PageHeader title="Economic Calendar" description={`U.S. releases · ${zoneLabel} · ${formatLabel}`} actions={<WeekPicker range={range} today={today} day={day} onDay={selectDay} onShift={shiftWeek}/>}/>
    <NextRelease feed={upcoming} now={now}/>
    <div className="eco-range-toolbar"><div className="eco-periods" role="group" aria-label="Calendar period">{periods.map(([id,label])=><button key={id} className={period===id?'selected':''} aria-pressed={period===id} onClick={()=>selectPeriod(id)}>{label}</button>)}<button className="eco-choose-dates" aria-expanded={editing} onClick={()=>{setDraft(range);setError('');setEditing(!editing);}}><CalendarBlank size={15}/>Choose dates</button></div><span className="eco-range-label">{rangeLabel(range)}</span></div>
    {editing&&<form className="calendar-range-form" onSubmit={applyRange}><label>Start date<input type="date" required value={draft.from} onChange={e=>setDraft({...draft,from:e.target.value})}/></label><label>End date<input type="date" required value={draft.to} onChange={e=>setDraft({...draft,to:e.target.value})}/></label><button className="button primary" type="submit">Apply dates</button><button className="text-button muted" type="button" onClick={()=>setEditing(false)}>Cancel</button>{error&&<p role="alert" className="red">{error}</p>}</form>}
    <section className="eco-releases" aria-labelledby="eco-table-title"><h2 className="eco-sr-only" id="eco-table-title" tabIndex={-1} ref={tableRef}>{title}</h2>
      <div className="eco-filter-row"><div className="impact-legend" aria-label="Economic impact legend"><span>Impact:</span><button className="impact-filter all" aria-pressed={impact==='all'} onClick={()=>changeImpact('all')}><Factory size={14} weight="fill"/>All</button>{['Low','Medium','High','Holiday'].map(level=><button key={level} className={`impact-filter ${level.toLowerCase()}`} aria-label={`${level} only`} aria-pressed={impact===level} onClick={()=>changeImpact(level)}><ImpactBadge impact={level}/></button>)}</div><select aria-label="Event impact" value={impact} onChange={e=>changeImpact(e.target.value)}><option value="all">All impacts</option><option value="important">High + Medium</option><option>High</option><option>Medium</option><option>Low</option><option>Holiday</option><option value="Other">Unrated</option></select></div>
      {day&&<div className="eco-day-selection">{dayLabel(day)}<button className="text-button" onClick={()=>setSelectedDay(null)}>Show all dates</button></div>}
      {feed.data?.partialCoverage&&<p className="calendar-warning" role="status">{feed.message}</p>}
      <div className="eco-table-panel">{!feed.data?<Unavailable feed={feed}/>:<>{rows.length?<div className="eco-table-scroll" tabIndex={0} role="region" aria-label="Economic events"><table className="eco-table"><thead><tr><th scope="col">Time ({zoneLabel})</th><th scope="col">Event</th><th scope="col">Impact</th><th scope="col">Actual</th><th scope="col">Forecast</th><th scope="col">Previous</th></tr></thead>{Object.entries(groups).map(([date,items])=><tbody key={date}><tr className="eco-date-heading"><th colSpan={6} scope="rowgroup">{dayLabel(date)}{date===today&&<span>Today</span>}</th></tr>{items.map(e=><tr key={e.id} className={`eco-event-row ${e.status==='cancelled'?'cancelled-event':''}`}><td className="eco-time"><EventTime event={e}/></td><td className="eco-event"><strong>{e.title}</strong><EventNotes event={e}/></td><td className="eco-impact-cell"><ImpactBadge impact={e.impact}/></td><td data-label="Actual" className="eco-actual">{value(e.actual)}</td><td data-label="Forecast">{value(e.forecast)}</td><td data-label="Previous">{value(e.previous)}</td></tr>)}</tbody>)}</table></div>:<div className="feed-empty"><CalendarBlank size={24}/><strong>No matching events in this date range</strong><p>{daily.length?'Choose All to include every impact level.':'The source has not listed releases for these dates. Coverage may be incomplete.'}</p></div>}{rows.length>limit&&<button className="button eco-show-more" onClick={()=>setLimit(limit+60)}>Show more ({limit} of {rows.length})</button>}{daily.length>rows.length&&<p className="eco-table-foot">{daily.length-rows.length} releases hidden by your impact filter. <button onClick={()=>changeImpact('all')}>Show all impacts</button></p>}</>}{feed.status==='stale'&&!feed.data?.partialCoverage&&<p className="calendar-warning" role="status">{feed.message||'Showing the last available schedule while the source reconnects.'}</p>}</div>
    </section>
    <footer className="eco-source-note"><div className="eco-source-line">{(feed.sources||[source]).map(s=><SourceLink key={s.name} href={s.url}>{s.name}</SourceLink>)}<span>Schedules may be estimated or incomplete.</span><FeedStatus feed={feed} label={feed.data?.partialCoverage?'Partial coverage':undefined}/></div><details><summary>Source coverage & timing</summary><p>{feed.data?.planning?'FXMacroData supplies dates outside Forex Factory’s published week. Its impact ratings and event coverage differ; actuals, forecasts and previous values are not supplied by its free schedule. It refreshes at most every 30 minutes.':'Forex Factory supplies its published week. Longer ranges depend on the separate calendar provider.'} The app checks for updates every 10 minutes. “—” means not supplied; a past scheduled time does not confirm publication. Times use {zoneLabel} / {formatLabel}; date filters and groups follow the U.S. release calendar. Converted dates are shown when they cross midnight. All-day and tentative dates stay as published.</p></details></footer>
  </div>;
}
