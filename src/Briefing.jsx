import { useState } from 'react';
import { CalendarBlank, Gauge, Newspaper, CaretLeft, CaretRight, Factory, ArrowUpRight } from '@phosphor-icons/react';

import { marketDay, addDays, weekRange, periodRange, validateRange, eventDay, briefingTime, eventDisplayDate, nextHighImpact } from './data/calendar.mjs';

import {useFeed,useMinuteClock,SourceLink,FeedStatus,Unavailable} from './Feeds';
import {EarningsSummary} from './Earnings';
import {sentimentDisplay,sentimentScore} from './data/sentiment.mjs';

export const TV_SCRIPT = 'https://www.tradingview.com/script/seVxGaLs-gunner-s-lvls/';
const CNN = 'https://edition.cnn.com/markets/fear-and-greed';
const FF = 'https://www.forexfactory.com/calendar';
const YAHOO = 'https://finance.yahoo.com/';
const MARKET_NEWS = '/api/news?symbols=DIA%2CIWM%2CQQQ%2CSPY';
const marketTime = briefingTime;
export function useBriefing({manual,setManual,section='overview'}) {
  const sentiment=useFeed('/api/sentiment',section==='overview'||section==='briefing');
  const news=useFeed(MARKET_NEWS,section==='overview'||section==='news');
  const now=useMinuteClock();
  const range=periodRange('upcoming',marketDay(now));
  const calendar=useFeed(`/api/calendar?${new URLSearchParams(range)}`,section==='overview');
  const [calendarPeriod,setCalendarPeriod]=useState('week');
  const earnings=useFeed(`/api/earnings?${new URLSearchParams(range)}`,section==='overview');
  return {sentiment,calendar,news,manual,setManual,now,calendarPeriod,setCalendarPeriod,earnings};
}
function NewsImage({image,priority=false}) {
  const [failed,setFailed]=useState(null);
  if (!image?.url || failed===image.url) return null;
  return <span className="news-image"><img src={image.url} alt={image.alt || ''} loading={priority?'eager':'lazy'} decoding="async" referrerPolicy="no-referrer" onError={()=>setFailed(image.url)}/></span>;
}
export function BriefingStrip({briefing,watchlist,onOpen,onNews,onEarnings}) {
  const reading=briefing.sentiment.data || briefing.manual;
  const isManual=!briefing.sentiment.data && Boolean(briefing.manual);
  const sentimentState=sentimentDisplay(briefing.sentiment,briefing.now);
  const outdated=!isManual&&sentimentState.outdated;
  const sentimentTone=outdated?'unavailable':({'extreme fear':'extreme-fear',fear:'fear',neutral:'neutral',greed:'greed','extreme greed':'extreme-greed'})[reading?.rating?.trim().toLowerCase()] || 'unavailable';
  const event=nextHighImpact(briefing.calendar.data?.events,briefing.now);
  const calendar=briefing.calendar;
  const calendarTitle=event?.title || (calendar.status==='loading' ? 'Checking upcoming releases…' : !calendar.data ? 'Calendar unavailable' : 'No timed high-impact events');
  const calendarContext=[calendar.status==='stale'?'Cached schedule':null,event?.status==='estimated'?'Estimated schedule':null,event?.dataStale?'Verification overdue':null,calendar.source?.name,event?'U.S. releases':'Next 14 days'].filter(Boolean).join(' · ');
  const news=briefing.news, headline=news.data?.articles?.[0];
  const newsTitle=headline?.title || (news.status==='loading' ? 'Checking the latest headlines…' : news.data ? 'No market headlines returned' : 'Headlines unavailable');
  return <section className="briefing-strip briefing-strip-with-earnings" aria-label="Current market briefing">
    <button className={`overview-sentiment sentiment-${sentimentTone}`} onClick={onOpen}><Gauge size={23}/><span><small>CNN FEAR & GREED</small><strong>{outdated ? 'Current reading unavailable' : reading ? `${sentimentScore(reading.score)} / 100 · ${reading.rating}` : briefing.sentiment.status==='loading' ? 'Checking market sentiment' : 'Reading unavailable'}</strong>{outdated && <em>Last snapshot: {sentimentScore(reading.score)} · {reading.rating}</em>}<em>{isManual ? 'Saved manual reading' : reading ? `${sentimentState.label} · ${marketTime(reading.observedAt)} Skopje` : 'Updates automatically here'}</em></span><CaretRight size={15}/></button>
    <button className="overview-next-impact" onClick={()=>{briefing.setCalendarPeriod('upcoming');onOpen();}} aria-label="Next high-impact event: open economic calendar"><Factory size={23} weight="fill"/><span><small>NEXT HIGH IMPACT</small><strong title={calendarTitle}>{calendarTitle}</strong>{event && <time dateTime={event.date}>{marketTime(event.date)} · Skopje</time>}<em className={calendar.status==='stale' || event?.dataStale ? 'amber' : ''}>{calendarContext}</em></span><CaretRight size={15}/></button>
    <EarningsSummary feed={briefing.earnings} watchlist={watchlist} now={briefing.now} onOpen={onEarnings}/>
    <button className="overview-news" onClick={onNews} aria-label="Open News"><NewsImage image={headline?.image} priority/><Newspaper className="news-fallback-icon" size={23}/><span className="overview-news-copy"><small>LATEST HEADLINE</small><strong title={newsTitle}>{newsTitle}</strong>{headline && <em>{headline.publisher} · <time dateTime={headline.publishedAt}>{marketTime(headline.publishedAt)} Skopje</time></em>}<em className={news.status==='stale' || news.status==='unavailable'?'amber':''}>{news.status==='stale'?'Cached headlines · ':news.status==='unavailable'?'Feed unavailable · ':''}Yahoo Finance · View news</em></span><CaretRight size={15}/></button>
  </section>;
}
function SentimentCard({briefing,onSettings}) {
  const {sentiment:feed,manual,setManual}=briefing;
  const reading=feed.data || manual;
  const isManual=!feed.data && Boolean(manual);
  const change=reading && Number.isFinite(reading.previousClose) ? reading.score-reading.previousClose : null;
  const tone=reading?.rating?.toLowerCase().includes('fear')?'fear':reading?.rating?.toLowerCase().includes('greed')?'greed':'neutral';
  const display=sentimentDisplay(feed,briefing.now);
  const outdated=!isManual&&display.outdated;
  const [editing,setEditing]=useState(false), [score,setScore]=useState(''), [date,setDate]=useState(''), [rating,setRating]=useState('Fear'), [error,setError]=useState('');
  function editReading() { setScore(manual ? String(manual.score) : '');setDate(manual?.date || '');setRating(manual?.rating || 'Fear');setError('');setEditing(true); }
  function save(event) {
    event.preventDefault();
    const value=Number(score), observed=new Date(`${date}T12:00:00Z`);
    if (!score.trim() || !Number.isFinite(value) || value<0 || value>100 || !date || !Number.isFinite(observed.getTime()) || date>new Date().toISOString().slice(0,10)) {setError('Enter a score from 0 to 100 and the reading’s date (not a future date).');return;}
    setManual({score:value,rating,observedAt:observed.toISOString(),manual:true,date});setEditing(false);setError('');
  }
  return <section className="panel sentiment-panel" aria-label="CNN Fear and Greed">
    <div className="briefing-heading"><div><span className="eyebrow">MARKET SENTIMENT</span><h2>Fear & Greed</h2></div><SourceLink href={CNN}>CNN</SourceLink></div>
    {outdated && <div className="sentiment-current-unavailable" role="status"><strong>Current reading unavailable</strong><p>{display.detail}</p></div>}
    {reading ? <div className={`sentiment-snapshot${outdated?' outdated':''}`}>
      {outdated && <p className="sentiment-snapshot-label">Last available snapshot</p>}
      <div className={`sentiment-value ${tone}`}><strong>{sentimentScore(reading.score)}</strong><span>/ 100</span><b>{reading.rating}</b></div>
      {change!==null && <p className="sentiment-change">{change>0?'+':''}{change.toFixed(2)} points <span>vs {outdated?'snapshot’s previous close':'previous close'}</span></p>}
      {!outdated && <><div className="sentiment-scale" role="meter" aria-label="Fear and Greed score" aria-valuemin={0} aria-valuemax={100} aria-valuenow={reading.score} aria-valuetext={`${sentimentScore(reading.score)} out of 100, ${reading.rating}`}><i style={{left:`${reading.score}%`}}/></div><div className="scale-labels"><span>Extreme fear</span><span>Extreme greed</span></div></>}
      <p className="reading-date">{isManual ? `Manually entered · ${manual.date}` : `Index reading · ${marketTime(reading.observedAt)} Skopje`}</p>
      {isManual && Date.now()-Date.parse(reading.observedAt)>4*24*60*60*1000 && <p className="amber small-copy">This manual reading is over four days old.</p>}
      <div className="sentiment-history">{[['Previous close','previousClose'],['1 week ago','previousWeek'],['1 month ago','previousMonth']].map(([label,key])=><div key={key}><span>{label}</span><strong>{sentimentScore(reading[key])}</strong></div>)}</div>
    </div> : <Unavailable feed={feed}>{feed.message || 'The automatic source is temporarily unavailable. The app will retry without you leaving this page.'}</Unavailable>}
    {feed.data && display.detail && !outdated && <p className="amber small-copy" role="status">{display.detail}</p>}
    {feed.data && feed.source?.via && <div className="sentiment-provenance"><span>{feed.source.delivery==='api'?'CNN API snapshot':feed.source.delivery==='hourly'?'Hourly CNN snapshot':'Daily CNN backup'} · checks every 10 min</span><SourceLink href={feed.source.via.url}>Via {feed.source.via.name}</SourceLink><small>{feed.source.delivery==='api'?'Uses the provider’s CNN observation time. Periodic snapshots may differ from CNN between checks.':feed.source.delivery==='hourly'?'The mirror runs about hourly and can lag. This is not a real-time feed.':'Published after the U.S. session. Automatic sources are checked for a newer reading.'}</small></div>}
    <p className="briefing-explanation">A view of U.S. stock-market sentiment. Use it alongside your levels and price reaction; it does not predict the next move.</p>
    <FeedStatus feed={feed} label={display.label} warning={display.warning} checkedTime/>
    <div className="sentiment-settings-link"><button className="text-button" onClick={onSettings}>Manage CNN connection<CaretRight size={16}/></button></div>
    {!feed.data && feed.status!=='loading' && (!editing ? <div className="manual-actions"><button className="text-button" onClick={editReading}>{manual ? 'Edit manual reading' : 'Enter a CNN reading'}</button>{manual && <button className="text-button muted" onClick={()=>setManual(null)}>Clear</button>}</div> : <form className="manual-form" onSubmit={save}><label>Score (0–100)<input type="number" required min="0" max="100" step="0.01" value={score} onChange={e=>setScore(e.target.value)}/></label><label>Reading date<input type="date" required max={new Date().toISOString().slice(0,10)} value={date} onChange={e=>setDate(e.target.value)}/></label><label>CNN rating<select value={rating} onChange={e=>setRating(e.target.value)}>{['Extreme fear','Fear','Neutral','Greed','Extreme greed'].map(x=><option key={x}>{x}</option>)}</select></label>{error && <p role="alert" className="red">{error}</p>}<p className="small-copy muted">Optional backup for a source outage. Automatic readings take priority when the feed returns.</p><div><button className="button primary" type="submit">Save reading</button><button type="button" className="text-button" onClick={()=>setEditing(false)}>Cancel</button></div></form>)}
  </section>;
}
function ImpactBadge({impact}) {
  const label = impact === 'Other' ? 'Unrated' : impact;
  return <span className={`impact ${impact.toLowerCase()}`} title={impact === 'Holiday' ? 'Holiday / non-economic event' : `${label} expected impact`}><Factory size={15} weight="fill" aria-hidden="true"/>{label}</span>;
}
const calendarDate = day => marketTime(`${day}T12:00:00Z`,{hour:undefined,minute:undefined});
const rangeLabel = range => `${calendarDate(range.from)} – ${calendarDate(range.to)}, ${range.to.slice(0,4)}`;
function CalendarPanel({initialPeriod='week'}) {
  const [period,setPeriod]=useState(initialPeriod), [impact,setImpact]=useState('all');
  const now=useMinuteClock();
  const [custom,setCustom]=useState(null), [editing,setEditing]=useState(false), [draft,setDraft]=useState({from:'',to:''}), [error,setError]=useState('');
  const range=period==='custom' ? custom : periodRange(period,marketDay(now));
  const feed=useFeed(`/api/calendar?${new URLSearchParams(range)}`);
  const events=feed.data?.events || [];
  const rows=events.filter(e=>(impact==='all' || e.impact===impact) && eventDay(e)>=range.from && eventDay(e)<=range.to && (period!=='upcoming' || !e.date || Date.parse(e.date)>=now));
  const next=nextHighImpact(events,now);
  function selectPeriod(id) {setPeriod(id);setEditing(false);setError('');}
  function shiftWeek(direction) {setCustom(weekRange(addDays(range.from,direction*7)));setPeriod('custom');setEditing(false);setError('');}
  function applyRange(event) {
    event.preventDefault();
    try {setCustom(validateRange(draft));setPeriod('custom');setEditing(false);setError('');} catch(e) {setError(e.message);}
  }
  const source=feed.source || (period==='week'||period==='today' ? {name:'Forex Factory',url:FF} : {name:'Finance Calendar',url:'https://www.financecalendar.com'});
  return <section className="panel calendar-panel" aria-label="U.S. economic calendar">
    <div className="briefing-heading"><div><span className="eyebrow">U.S. ONLY · SKOPJE TIME · 24H</span><h2>Economic calendar</h2></div><SourceLink href={source.url}>{source.name}</SourceLink></div>
    <div className="calendar-navigation"><button className="icon-button" aria-label="Go to previous week" onClick={()=>shiftWeek(-1)}><CaretLeft size={18}/></button><div aria-live="polite"><strong>{rangeLabel(range)}</strong><span>Loads automatically · refreshes every 10 min</span></div><button className="icon-button" aria-label="Go to next week" onClick={()=>shiftWeek(1)}><CaretRight size={18}/></button><button className="button calendar-date-button" aria-expanded={editing} onClick={()=>{setDraft(range);setError('');setEditing(!editing);}}><CalendarBlank size={16}/>Choose dates</button></div>
    <div className="calendar-controls"><div className="segmented" aria-label="Calendar period">{[['today','Today'],['upcoming','Upcoming'],['week','This week'],['nextweek','Next week'],['month','This month'],['nextmonth','Next month']].map(([id,label])=><button key={id} className={period===id?'selected':''} aria-pressed={period===id} onClick={()=>selectPeriod(id)}>{label}</button>)}</div><select aria-label="Event impact" value={impact} onChange={e=>setImpact(e.target.value)}><option value="all">All impact levels</option><option>High</option><option>Medium</option><option>Low</option><option>Holiday</option><option value="Other">Unrated</option></select></div>
    {editing && <form className="calendar-range-form" onSubmit={applyRange}><label>Start date<input type="date" required value={draft.from} onChange={e=>setDraft({...draft,from:e.target.value})}/></label><label>End date<input type="date" required value={draft.to} onChange={e=>setDraft({...draft,to:e.target.value})}/></label><button className="button primary" type="submit">Apply dates</button><button className="text-button muted" type="button" onClick={()=>setEditing(false)}>Cancel</button>{error && <p role="alert" className="red">{error}</p>}</form>}
    <div className="impact-legend" aria-label="Economic impact legend"><span>Filter by impact</span><button className="impact-filter all" aria-pressed={impact==='all'} onClick={()=>setImpact('all')}>All</button>{['Low','Medium','High','Holiday'].map(level=><button key={level} className={`impact-filter ${level.toLowerCase()}`} aria-label={`${level} only`} aria-pressed={impact===level} onClick={()=>setImpact(level)}><ImpactBadge impact={level}/></button>)}</div>
    {next && <div className="next-release"><Factory className="high-impact-icon" size={16} weight="fill" aria-hidden="true"/><span>Next high impact in range: <strong>{next.title}</strong>{next.status==='estimated'?' · Estimated':''}</span><time dateTime={next.date}>{marketTime(next.date)} Skopje</time></div>}
    {!feed.data ? <Unavailable feed={feed}/> : <><div className="calendar-coverage" aria-live="polite">{rows.length} U.S. events in selected dates · {feed.data.planning ? 'Scheduled releases' : 'Published weekly export'}</div>{rows.length ? <div className="calendar-table-scroll" key={`${range.from}:${range.to}`} tabIndex={0} role="region" aria-label="Economic events"><table className="calendar-table"><thead><tr><th>Date / Skopje</th><th>Event</th><th>Impact</th><th>Forecast</th><th>Previous</th><th>Actual</th></tr></thead><tbody>{rows.map(e=><tr key={e.id} className={e.status==='cancelled'?'cancelled-event':''}><td><time dateTime={e.date || eventDay(e)}>{eventDisplayDate(e)}<small>{e.date ? e.impact==='Holiday' ? 'Holiday' : marketTime(e.date,{month:undefined,day:undefined}) : e.timeLabel || 'Time TBA'}</small></time></td><td>{e.title}<small className={e.status==='estimated'||e.dataStale?'event-caution':''}>{e.status==='cancelled'?'Cancelled':e.status==='estimated'?'Estimated schedule':e.date && Date.parse(e.date)<now?'Past scheduled time':'Scheduled'} · U.S.{e.dataStale?' · Source verification overdue':''}{e.timeRole==='auction-close'?' · Auction closes':''}</small>{(e.unit || e.period) && <small>{[e.period,e.unit].filter(Boolean).join(' · ')}</small>}{e.sourceName && <small>{e.sourceUrl ? <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer">{e.sourceName} ↗</a> : e.sourceName}</small>}{(e.note || e.credits?.length>0) && <details className="event-notes"><summary>Source notes</summary>{e.note && <p>{e.note}</p>}{e.credits?.map((credit,i)=><p key={i}>{credit}</p>)}</details>}</td><td><ImpactBadge impact={e.impact}/></td><td>{e.forecast ?? '—'}</td><td>{e.previous ?? '—'}</td><td>{e.actual ?? '—'}</td></tr>)}</tbody></table></div> : <div className="feed-empty"><CalendarBlank size={26}/><strong>No matching events in this date range</strong><p>Try another date range or impact filter. An empty result does not guarantee that no releases are scheduled.</p></div>}<p className="feed-note">{feed.data.planning ? 'Future dates load automatically from Finance Calendar. Coverage and impact ratings differ from Forex Factory; some releases and forecasts are unavailable. Estimated schedules are marked.' : 'Forex Factory supplies the current published week. Choose Next week or a date range to load future schedules automatically from Finance Calendar.'} “—” means not supplied. Times are Skopje time (24h), including daylight saving changes. Date filters follow the U.S. release calendar; all-day and tentative dates stay as published.</p></>}
    {feed.status==='stale' && <p className="calendar-warning" role="status">{feed.message || 'Showing the last successful fetch while the app retries.'}</p>}
    <FeedStatus feed={feed}/>
  </section>;
}
export function NewsPanel({watchlist,marketFeed,fixedSymbol=null}) {
  const [scope,setScope]=useState(fixedSymbol?'watchlist':'markets'), [selected,setSelected]=useState('all'), [economy,setEconomy]=useState(false);
  const stocks=watchlist.filter(x=>['STOCKS','FUND','DEPOSITARY RECEIPT'].includes(x.group) && ['NASDAQ','NYSE','AMEX','CBOE','NYSEARCA','NYSEAMERICAN','BATS'].includes(x.exchange));
  const current=fixedSymbol||(selected === 'all' || stocks.some(s=>s.symbol===selected) ? selected : 'all');
  const symbols=scope==='markets' ? ['SPY','QQQ','IWM','DIA'] : current==='all' ? stocks.map(s=>s.symbol) : [current];
  const watchlistFeed=useFeed(scope==='watchlist' && symbols.length ? `/api/news?symbols=${encodeURIComponent([...new Set(symbols)].sort().join(','))}` : null);
  const feed=scope==='markets'?marketFeed:watchlistFeed;
  const articles=(feed.data?.articles || []).filter(a=>!economy || a.economy);
  return <section className="panel news-panel" aria-label="Market and watchlist news"><div className="briefing-heading"><div><span className="eyebrow">HEADLINES & CATALYSTS</span><h2>{fixedSymbol?`${fixedSymbol} headlines`:'News for your session'}</h2></div><SourceLink href={YAHOO}>Yahoo Finance</SourceLink></div>
    {!fixedSymbol&&<div className="news-controls"><div className="segmented" aria-label="News scope">{[['markets','U.S. markets'],['watchlist','My watchlist']].map(([id,label])=><button key={id} className={scope===id?'selected':''} aria-pressed={scope===id} onClick={()=>setScope(id)}>{label}</button>)}</div>{scope==='watchlist' && <select aria-label="News symbol" value={current} onChange={e=>setSelected(e.target.value)}><option value="all">All {stocks.length} U.S. listings</option>{stocks.map(s=><option key={s.id} value={s.symbol}>{s.symbol}</option>)}</select>}<label className="check-label"><input type="checkbox" checked={economy} onChange={e=>setEconomy(e.target.checked)}/>Economy headlines only</label></div>}
    <p className="news-context">{scope==='markets' ? 'Headlines from SPY, QQQ, IWM and DIA feeds.' : `Yahoo headlines for ${current==='all' ? 'the U.S.-listed stocks, ETFs and ADRs in your imported watchlist' : current}.`} {economy ? 'Economy view matches topics such as the Fed, inflation and jobs in returned headlines.' : 'Publisher selection may include related companies and global stories affecting U.S. markets.'}</p>
    {!symbols.length ? <div className="feed-empty"><strong>No U.S. listings in this watchlist</strong><p>Import stocks, ETFs or ADRs to follow their news.</p></div> : !feed.data ? <Unavailable feed={feed}/> : !articles.length ? <div className="feed-empty"><Newspaper size={26}/><strong>No headlines returned for this selection</strong><p>Try another symbol or turn off the economy filter. Coverage is limited to the publisher’s latest feed.</p></div> : <div className="news-list">{articles.map((a,i)=><a className={`news-article ${i===0?'news-lead':''}`} key={a.id} href={a.url} target="_blank" rel="noopener noreferrer"><NewsImage image={a.image} priority={i===0}/><span className="news-number">{String(i+1).padStart(2,'0')}</span><div className="news-article-copy">{i===0 && <span className="news-lead-label">Latest headline</span>}<span className="news-meta">{a.publisher} <span>·</span> <time dateTime={a.publishedAt}>{marketTime(a.publishedAt)} Skopje</time> {a.economy && <b>ECONOMY</b>}</span><h3>{a.title}</h3></div><ArrowUpRight size={20}/></a>)}</div>}
    {feed.status==='stale' && <p className="calendar-warning" role="status">Showing cached headlines while the source reconnects.</p>}
    <div className="news-bottom"><FeedStatus feed={feed}/><span className="small-copy muted">Publisher images where available · refreshes every 10 min · links may require a subscription</span></div>
  </section>;
}
export function BriefingPage({briefing,onTradingView,onSettings}) {
  return <div className="briefing-page"><div className="briefing-intro"><div><h2>Before the opening bell.</h2><p>Sentiment and economic releases for your session.</p></div><span className="briefing-date">{marketTime(Date.now(),{weekday:'short',hour:undefined,minute:undefined})} · CURRENT SOURCES</span></div><div className="briefing-notice">Each source shows its own observation time. Yahoo quotes and U.S. Treasury rates appear on Overview.</div><div className="briefing-grid"><div className="briefing-side"><SentimentCard briefing={briefing} onSettings={onSettings}/><section className="panel indicator-card"><span className="eyebrow">YOUR CHART TOOLKIT</span><h3>gunner’s lvls</h3><p>Bring your daily supply, demand and gap zones into TradingView.</p><button className="text-button" onClick={onTradingView}>Open indicator toolkit<CaretRight size={16}/></button></section></div><div className="briefing-calendars"><CalendarPanel initialPeriod={briefing.calendarPeriod}/></div></div></div>;
}

export function NewsPage({watchlist,marketFeed}) {
  return <div className="briefing-page news-page"><NewsPanel watchlist={watchlist} marketFeed={marketFeed}/></div>;
}
