import {useRef,useState} from 'react';
import {CalendarBlank,CaretLeft,CaretRight,Factory,Circle,ArrowDown} from '@phosphor-icons/react';
import {useDisplayTime} from './DisplayTime';
import {useFeed,SourceLink,FeedStatus,Unavailable} from './Feeds';
import {marketDay,addDays,weekRange,periodRange,validateRange,eventDay,nextHighImpact} from './data/calendar.mjs';
import {marketSession} from './data/market-session.mjs';
import {calendarRows,calendarDays,impactMatches,supplied,releaseCountdown,fetchedAgo} from './data/economic-calendar.mjs';
import './economic-calendar.css';

const value=text=>supplied(text)?text:'—';
const dayLabel=day=>new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'short',month:'short',day:'numeric'}).format(new Date(`${day}T12:00:00Z`));
const rangeLabel=range=>`${dayLabel(range.from)} – ${dayLabel(range.to)}, ${range.to.slice(0,4)}`;
const periods=[['today','Today'],['upcoming','Upcoming'],['week','This week'],['nextweek','Next week'],['month','This month'],['nextmonth','Next month']];
const sourceFallback={name:'Calendar source',url:'https://www.forexfactory.com/calendar'};
function ImpactBadge({impact='Other'}) {
  const label=impact==='Other'?'Unrated':impact;
  return <span className={`eco-impact impact ${impact.toLowerCase()}`} title={impact==='Holiday'?'Holiday / non-economic event':`${label} expected impact`}><Factory size={12} weight="fill" aria-hidden="true"/>{label}</span>;
}
function EventTime({event,withDate=false}) {
  const {eventDisplayDate,clockTime,displayDay}=useDisplayTime();
  const rollover=event.date&&displayDay(event.date)!==eventDay(event);
  return <time dateTime={event.date||eventDay(event)}>{(withDate||rollover)&&<span>{eventDisplayDate(event)} · </span>}{event.date?clockTime(event.date):event.timeLabel||'Time TBA'}</time>;
}
function EventNotes({event}) {
  const caution=[event.status==='cancelled'?'Cancelled':event.status==='estimated'?'Estimated schedule':null,event.dataStale?'Verification overdue':null,event.timeRole==='auction-close'?'Auction closes':null].filter(Boolean).join(' · ');
  const hasDetails=event.unit||event.period||event.sourceName||event.note||event.credits?.length;
  return <>{caution&&<small className="eco-caution">{caution}</small>}{hasDetails&&<details className="eco-event-notes"><summary>Release details</summary>{(event.unit||event.period)&&<p>{[event.period,event.unit].filter(Boolean).join(' · ')}</p>}{event.sourceName&&<p>{event.sourceUrl?<SourceLink href={event.sourceUrl}>{event.sourceName}</SourceLink>:event.sourceName}</p>}{event.note&&<p>{event.note}</p>}{event.credits?.map((credit,i)=><p key={i}>{credit}</p>)}</details>}</>;
}
function NextRelease({feed,now}) {
  const {zoneLabel,marketTime}=useDisplayTime();
  const event=nextHighImpact(feed.data?.events,now);
  const batch=event?feed.data.events.filter(e=>e.impact==='High'&&e.status!=='cancelled'&&e.date&&Date.parse(e.date)===Date.parse(event.date)):[];
  return <section className="eco-next" aria-label="Next high-impact release">
    <div className="eco-next-heading"><div><span className="eco-eyebrow">Next up · High impact</span><h2>{event?.title||(feed.status==='loading'?'Checking upcoming releases…':feed.data?'No timed high-impact release listed':'Upcoming schedule unavailable')}</h2>{event&&<p><time dateTime={event.date}>{marketTime(event.date,{weekday:'long'})}</time> · {zoneLabel}{event.status==='estimated'?' · Estimated':''}{event.dataStale?' · Verification overdue':''}</p>}</div>{event&&<div className="eco-countdown"><strong>{releaseCountdown(event.date,now)}</strong><span>until scheduled release</span></div>}</div>
    {event?<div className="eco-next-metrics" role="table" aria-label="Next release estimates"><div role="row" className="eco-next-labels"><span role="columnheader">Release</span><span role="columnheader">Forecast</span><span role="columnheader">Previous</span></div>{batch.map(item=><div role="row" key={item.id}><strong role="cell">{item.title}</strong><span role="cell">{value(item.forecast)}</span><span role="cell">{value(item.previous)}</span></div>)}</div>:<p className="eco-muted">{feed.status==='loading'?'Checking the next 14 days.':feed.message||'The source has not supplied a timed high-impact event for the next 14 days. Coverage may be incomplete.'}</p>}
    <div className="eco-next-source"><span>{feed.status==='stale'?'Cached schedule · ':''}{feed.source?.name||'U.S. releases'} · Next 14 days{feed.fetchedAt?` · ${fetchedAgo(feed.fetchedAt,now)}`:''}</span>{feed.status==='stale'&&<span className="amber">{feed.message||'Checking for an updated schedule.'}</span>}</div>
  </section>;
}
export default function EconomicCalendar({briefing}) {
  const {now,calendar:upcoming}=briefing;
  const {zoneLabel,formatLabel,marketTime,clockTime}=useDisplayTime();
  const today=marketDay(now),session=marketSession(now);
  const [period,setPeriod]=useState(briefing.calendarPeriod),[impact,setImpact]=useState('important'),[custom,setCustom]=useState(null),[selectedDay,setSelectedDay]=useState(null);
  const [editing,setEditing]=useState(false),[draft,setDraft]=useState({from:'',to:''}),[error,setError]=useState(''),[limit,setLimit]=useState(60);
  const tableRef=useRef(null);
  const range=period==='custom'?custom:periodRange(period,today);
  const feed=useFeed(`/api/calendar?${new URLSearchParams(range)}`);
  const events=calendarRows(feed.data?.events,range,now,period==='upcoming');
  const day=(selectedDay>=range.from&&selectedDay<=range.to?selectedDay:null)||(period==='week'||period==='today'?today:null);
  const daily=day?events.filter(e=>eventDay(e)===day):events;
  const rows=daily.filter(e=>impactMatches(e,impact));
  const days=calendarDays(range,events,today);
  const title=day?day===today?'Today':dayLabel(day):periods.find(([id])=>id===period)?.[1]||'Selected dates';
  const source=feed.source||sourceFallback;
  function selectPeriod(id) {setPeriod(id);briefing.setCalendarPeriod(id);setSelectedDay(null);setLimit(60);setEditing(false);setError('');}
  function shiftWeek(direction) {setCustom(weekRange(addDays(range.from,direction*7)));setPeriod('custom');setSelectedDay(null);setLimit(60);setEditing(false);setError('');}
  function applyRange(e) {e.preventDefault();try{setCustom(validateRange(draft));setPeriod('custom');setSelectedDay(null);setLimit(60);setEditing(false);setError('');}catch(err){setError(err.message);}}
  function selectDay(date) {setSelectedDay(date);setLimit(60);tableRef.current?.scrollIntoView({behavior:'instant',block:'start'});tableRef.current?.focus({preventScroll:true});}
  const changeImpact=id=>{setImpact(id);setLimit(60);};
  return <div className="economic-page calendar-panel">
    <header className="eco-page-heading"><h1>Economic calendar</h1><p>U.S. economic releases, Fed events and Treasury auctions. Times in {zoneLabel} · {formatLabel}.</p></header>
    <div className="eco-session-strip"><strong><Circle size={10} weight="fill" aria-hidden="true"/>{marketTime(now,{weekday:'short',hour:undefined,minute:undefined})}</strong><span>{session.label} · {clockTime(now)} {zoneLabel}</span><span className={feed.status==='stale'?'amber':''}>{feed.status==='loading'?'Loading schedule…':feed.status==='stale'?'Cached · '+fetchedAgo(feed.fetchedAt,now):feed.data?fetchedAgo(feed.fetchedAt,now):'Schedule unavailable'}</span></div>
    <NextRelease feed={upcoming} now={now}/>
    <section className="eco-releases" aria-labelledby="eco-table-title">
      <header className="eco-section-heading"><div><h2 id="eco-table-title" tabIndex={-1} ref={tableRef}>{title}</h2><p>{day?dayLabel(day):rangeLabel(range)} · {feed.data?`${daily.length} releases · ${daily.filter(e=>e.status!=='cancelled'&&supplied(e.actual)).length} with actuals`:'Checking source'} · U.S. calendar dates</p></div><div className="segmented eco-quick-filter" role="group" aria-label="Quick impact filters">{[['High','High'],['important','High + Medium'],['all','All']].map(([id,label])=><button key={id} aria-pressed={impact===id} className={impact===id?'selected':''} onClick={()=>changeImpact(id)}>{label}</button>)}</div></header>
      <div className="eco-filter-row"><div className="impact-legend" aria-label="Economic impact legend"><span>Impact</span><button className="impact-filter all" aria-pressed={impact==='all'} onClick={()=>changeImpact('all')}>All</button>{['Low','Medium','High','Holiday'].map(level=><button key={level} className={`impact-filter ${level.toLowerCase()}`} aria-label={`${level} only`} aria-pressed={impact===level} onClick={()=>changeImpact(level)}><ImpactBadge impact={level}/></button>)}</div><select aria-label="Event impact" value={impact} onChange={e=>changeImpact(e.target.value)}><option value="all">All impact levels</option><option value="important">High + Medium</option><option>High</option><option>Medium</option><option>Low</option><option>Holiday</option><option value="Other">Unrated</option></select></div>
      <div className="eco-table-panel">{!feed.data?<Unavailable feed={feed}/>:<>{rows.length?<div className="eco-table-scroll" tabIndex={0} role="region" aria-label="Economic events"><table className="eco-table calendar-table"><thead><tr><th>Time / {zoneLabel}</th><th>Event</th><th>Impact</th><th>Actual</th><th>Forecast</th><th>Previous</th></tr></thead><tbody>{rows.slice(0,limit).map(e=><tr key={e.id} className={e.status==='cancelled'?'cancelled-event':''}><td className="eco-time"><EventTime event={e} withDate={!day}/></td><td className="eco-event"><strong>{e.title}</strong><EventNotes event={e}/></td><td className="eco-impact-cell"><ImpactBadge impact={e.impact}/></td><td data-label="Actual" className="eco-actual">{value(e.actual)}</td><td data-label="Forecast">{value(e.forecast)}</td><td data-label="Previous">{value(e.previous)}</td></tr>)}</tbody></table></div>:<div className="feed-empty"><CalendarBlank size={24}/><strong>No matching events in this date range</strong><p>{daily.length?'Choose All to include every impact level.':'The source has not listed releases for these dates. Coverage may be incomplete.'}</p></div>}{rows.length>limit&&<button className="button eco-show-more" onClick={()=>setLimit(limit+60)}>Show more ({limit} of {rows.length})</button>}{daily.length>rows.length&&<p className="eco-table-foot">{daily.length-rows.length} releases hidden by your impact filter. <button onClick={()=>changeImpact('all')}>Show all impacts</button></p>}</>}{feed.status==='stale'&&<p className="calendar-warning" role="status">{feed.message||'Showing the last available schedule while the source reconnects.'}</p>}</div>
    </section>
    <section className="eco-week" aria-labelledby="eco-week-title">
      <header className="eco-section-heading"><div><h2 id="eco-week-title">{periods.find(([id])=>id===period)?.[1]||'Selected dates'}{period==='today'?' at a glance':''}</h2><p>{rangeLabel(range)} · {feed.data?`${events.length} releases`:'Checking source'} · {impact==='important'?'high + medium':impact==='all'?'all impacts':impact.toLowerCase()+' only'}</p></div><span className="eco-key">A actual · F forecast · P previous</span></header>
      <div className="eco-range-toolbar"><div className="segmented" aria-label="Calendar period">{periods.map(([id,label])=><button key={id} className={period===id?'selected':''} aria-pressed={period===id} onClick={()=>selectPeriod(id)}>{label}</button>)}</div><div className="eco-range-actions"><button className="icon-button" aria-label="Go to previous week" onClick={()=>shiftWeek(-1)}><CaretLeft size={17}/></button><button className="icon-button" aria-label="Go to next week" onClick={()=>shiftWeek(1)}><CaretRight size={17}/></button><button className="button" aria-expanded={editing} onClick={()=>{setDraft(range);setError('');setEditing(!editing);}}><CalendarBlank size={16}/>Choose dates</button></div></div>
      {editing&&<form className="calendar-range-form" onSubmit={applyRange}><label>Start date<input type="date" required value={draft.from} onChange={e=>setDraft({...draft,from:e.target.value})}/></label><label>End date<input type="date" required value={draft.to} onChange={e=>setDraft({...draft,to:e.target.value})}/></label><button className="button primary" type="submit">Apply dates</button><button className="text-button muted" type="button" onClick={()=>setEditing(false)}>Cancel</button>{error&&<p role="alert" className="red">{error}</p>}</form>}
      {feed.data?<div className="eco-week-grid">{days.map(date=>{const all=events.filter(e=>eventDay(e)===date),visible=all.filter(e=>impactMatches(e,impact));return <article className={`eco-day ${date===today?'is-today':''} ${date===day?'is-selected':''}`} key={date}><header><button onClick={()=>selectDay(date)} aria-label={`View economic releases for ${date}`} aria-pressed={date===day}>{dayLabel(date)}</button>{date===today&&<span>Today</span>}</header><p>{all.length} releases{all.some(e=>e.impact==='High')?` · ${all.filter(e=>e.impact==='High').length} high`:''}</p>{visible.length?visible.slice(0,4).map(e=><div className={`eco-day-event ${e.status==='cancelled'?'cancelled-event':''}`} key={e.id}><div><EventTime event={e}/><ImpactBadge impact={e.impact}/></div><strong>{e.title}</strong>{(e.status==='estimated'||e.status==='cancelled'||e.dataStale)&&<small className="eco-caution">{e.status==='cancelled'?'Cancelled':e.status==='estimated'?'Estimated':'Verification overdue'}</small>}<p><span>A <b>{value(e.actual)}</b></span><span>F {value(e.forecast)}</span><span>P {value(e.previous)}</span></p></div>):<p className="eco-day-empty">{all.length?'No releases match this impact filter.':'No releases listed.'}</p>}<button className="eco-day-more" onClick={()=>selectDay(date)}>{visible.length>4?`View all ${visible.length} matching releases`:all.length>visible.length?`${all.length-visible.length} other impacts · View day`:'View day'}<ArrowDown size={12}/></button></article>;})}</div>:<Unavailable feed={feed}/>}
    </section>
    <footer className="eco-source-note"><SourceLink href={source.url}>{source.name}</SourceLink><p>{feed.data?.planning?'Finance Calendar supplies this range. Coverage and impact ratings differ from Forex Factory; estimated schedules are marked.':'Forex Factory supplies its published week; other dates load automatically from Finance Calendar.'} Refreshes every 10 minutes. “—” means not supplied; a past scheduled time does not confirm publication. Times use {zoneLabel} / {formatLabel}; date filters and day cards follow the U.S. release calendar. Converted dates are shown when they cross midnight. All-day and tentative dates stay as published.</p><FeedStatus feed={feed}/></footer>
  </div>;
}
