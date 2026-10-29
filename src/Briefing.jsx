import {useDisplayTime} from './DisplayTime';
import { useState } from 'react';
import { Gauge, Newspaper, CaretRight, Factory, ArrowUpRight } from '@phosphor-icons/react';

import {marketDay,periodRange,nextHighImpact} from './data/calendar.mjs';

import {useFeed,useMinuteClock,SourceLink,FeedStatus,Unavailable} from './Feeds';
import {EarningsSummary} from './Earnings';
import {sentimentDisplay,sentimentScore} from './data/sentiment.mjs';

export const TV_SCRIPT = 'https://www.tradingview.com/script/seVxGaLs-gunner-s-lvls/';
const CNN = 'https://edition.cnn.com/markets/fear-and-greed';
const YAHOO = 'https://finance.yahoo.com/';
const MARKET_NEWS = '/api/news?symbols=DIA%2CIWM%2CQQQ%2CSPY';
export function useBriefing({manual,setManual,section='overview'}) {
  const sentiment=useFeed('/api/sentiment');
  const news=useFeed(MARKET_NEWS,section==='overview'||section==='news');
  const now=useMinuteClock();
  const range=periodRange('upcoming',marketDay(now));
  const calendar=useFeed(`/api/calendar?${new URLSearchParams(range)}`,section==='overview'||section==='briefing');
  const [calendarPeriod,setCalendarPeriod]=useState('week');
  const earnings=useFeed(`/api/earnings?${new URLSearchParams(range)}`,section==='overview');
  return {sentiment,calendar,news,manual,setManual,now,calendarPeriod,setCalendarPeriod,earnings};
}
export function SidebarSentiment({briefing,active,onOpen}) {
  const {marketTime,zoneLabel}=useDisplayTime();
  const feed=briefing.sentiment,reading=feed.data||briefing.manual,isManual=!feed.data&&Boolean(briefing.manual),display=sentimentDisplay(feed,briefing.now);
  const rating=reading?.rating||'',tone=({'extreme fear':'fear',fear:'fear',neutral:'neutral',greed:'greed','extreme greed':'greed'})[rating.trim().toLowerCase()]||'unavailable';
  const status=reading?(isManual?'Manual reading':display.outdated||display.warning?display.label:null):feed.status==='loading'?'Checking score…':'Reading unavailable';
  const title=reading?`CNN Fear & Greed · ${sentimentScore(reading.score)} / 100 · ${rating} · ${isManual?'Manual reading':display.label} · ${marketTime(reading.observedAt)} ${zoneLabel}`:'CNN Fear & Greed · '+status;
  return <button className={`nav-item sidebar-sentiment ${active?'active':''}`} data-tone={tone} aria-label="Fear & Greed" aria-describedby="sidebar-sentiment-description" title={title} aria-current={active?'page':undefined} onClick={onOpen}>
    <span className="sidebar-sentiment-heading"><Gauge size={17} aria-hidden="true"/><span className="sidebar-sentiment-label">Fear & Greed</span><CaretRight size={14} aria-hidden="true"/></span>
    <span className="sidebar-sentiment-copy" id="sidebar-sentiment-description"><span id="sidebar-sentiment-reading" className="sidebar-sentiment-reading"><span className="sidebar-sentiment-score"><strong>{reading?sentimentScore(reading.score):'—'}</strong>{reading&&<small>/ 100</small>}</span>{rating&&<span className="sidebar-sentiment-rating">{rating}</span>}</span>{status&&<small className="sidebar-sentiment-status">{status}</small>}</span>
    {reading&&<meter className="sidebar-sentiment-meter" min="0" max="100" value={reading.score} aria-hidden="true"/>}
  </button>;
}
function NewsImage({image,priority=false}) {
  const [failed,setFailed]=useState(null);
  if (!image?.url || failed===image.url) return null;
  return <span className="news-image"><img src={image.url} alt={image.alt || ''} loading={priority?'eager':'lazy'} decoding="async" referrerPolicy="no-referrer" onError={()=>setFailed(image.url)}/></span>;
}
export function BriefingStrip({briefing,watchlist,onOpen,onNews,onEarnings,onSentiment}) {
  const {marketTime,zoneLabel}=useDisplayTime();
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
    <button className={`overview-sentiment sentiment-${sentimentTone}`} onClick={onSentiment} aria-label="Open Fear & Greed"><Gauge size={23}/><span><small>CNN FEAR & GREED</small><strong>{outdated ? 'Current reading unavailable' : reading ? `${sentimentScore(reading.score)} / 100 · ${reading.rating}` : briefing.sentiment.status==='loading' ? 'Checking market sentiment' : 'Reading unavailable'}</strong>{outdated && <em>Last snapshot: {sentimentScore(reading.score)} · {reading.rating}</em>}<em>{isManual ? 'Saved manual reading' : reading ? `${sentimentState.label} · ${marketTime(reading.observedAt)} ${zoneLabel}` : 'Updates automatically here'}</em></span><CaretRight size={15}/></button>
    <button className="overview-next-impact" onClick={()=>{briefing.setCalendarPeriod('upcoming');onOpen();}} aria-label="Next high-impact event: open economic calendar"><Factory size={23} weight="fill"/><span><small>NEXT HIGH IMPACT</small><strong title={calendarTitle}>{calendarTitle}</strong>{event && <time dateTime={event.date}>{marketTime(event.date)} · {zoneLabel}</time>}<em className={calendar.status==='stale' || event?.dataStale ? 'amber' : ''}>{calendarContext}</em></span><CaretRight size={15}/></button>
    <EarningsSummary feed={briefing.earnings} watchlist={watchlist} now={briefing.now} onOpen={onEarnings}/>
    <button className="overview-news" onClick={onNews} aria-label="Open News"><NewsImage image={headline?.image} priority/><Newspaper className="news-fallback-icon" size={23}/><span className="overview-news-copy"><small>LATEST HEADLINE</small><strong title={newsTitle}>{newsTitle}</strong>{headline && <em>{headline.publisher} · <time dateTime={headline.publishedAt}>{marketTime(headline.publishedAt)} {zoneLabel}</time></em>}<em className={news.status==='stale' || news.status==='unavailable'?'amber':''}>{news.status==='stale'?'Cached headlines · ':news.status==='unavailable'?'Feed unavailable · ':''}Yahoo Finance · View news</em></span><CaretRight size={15}/></button>
  </section>;
}
export function SentimentCard({briefing,onSettings}) {
  const {marketTime,zoneLabel}=useDisplayTime();
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
      <p className="reading-date">{isManual ? `Manually entered · ${manual.date}` : `Index reading · ${marketTime(reading.observedAt)} ${zoneLabel}`}</p>
      {isManual && Date.now()-Date.parse(reading.observedAt)>4*24*60*60*1000 && <p className="amber small-copy">This manual reading is over four days old.</p>}
      <div className="sentiment-history">{[['Previous close','previousClose'],['1 week ago','previousWeek'],['1 month ago','previousMonth'],['1 year ago','previousYear']].map(([label,key])=><div key={key}><span>{label}</span><strong>{sentimentScore(reading[key])}</strong></div>)}</div>
    </div> : <Unavailable feed={feed}>{feed.message || 'The automatic source is temporarily unavailable. The app will retry without you leaving this page.'}</Unavailable>}
    {feed.data && display.detail && !outdated && <p className="amber small-copy" role="status">{display.detail}</p>}
    {feed.data && feed.source?.via && <div className="sentiment-provenance"><span>{feed.source.delivery==='api'?'CNN API snapshot':feed.source.delivery==='hourly'?'Hourly CNN snapshot':'Daily CNN backup'} · checks every 10 min</span><SourceLink href={feed.source.via.url}>Via {feed.source.via.name}</SourceLink><small>{feed.source.delivery==='api'?'Uses the provider’s CNN observation time. Periodic snapshots may differ from CNN between checks.':feed.source.delivery==='hourly'?'The mirror runs about hourly and can lag. This is not a real-time feed.':'Published after the U.S. session. Automatic sources are checked for a newer reading.'}</small></div>}
    <p className="briefing-explanation">A view of U.S. stock-market sentiment. Use it alongside your levels and price reaction; it does not predict the next move.</p>
    <FeedStatus feed={feed} label={display.label} warning={display.warning} checkedTime/>
    <div className="sentiment-settings-link"><button className="text-button" onClick={onSettings}>Manage CNN connection<CaretRight size={16}/></button></div>
    {!feed.data && feed.status!=='loading' && (!editing ? <div className="manual-actions"><button className="text-button" onClick={editReading}>{manual ? 'Edit manual reading' : 'Enter a CNN reading'}</button>{manual && <button className="text-button muted" onClick={()=>setManual(null)}>Clear</button>}</div> : <form className="manual-form" onSubmit={save}><label>Score (0–100)<input type="number" required min="0" max="100" step="0.01" value={score} onChange={e=>setScore(e.target.value)}/></label><label>Reading date<input type="date" required max={new Date().toISOString().slice(0,10)} value={date} onChange={e=>setDate(e.target.value)}/></label><label>CNN rating<select value={rating} onChange={e=>setRating(e.target.value)}>{['Extreme fear','Fear','Neutral','Greed','Extreme greed'].map(x=><option key={x}>{x}</option>)}</select></label>{error && <p role="alert" className="red">{error}</p>}<p className="small-copy muted">Optional backup for a source outage. Automatic readings take priority when the feed returns.</p><div><button className="button primary" type="submit">Save reading</button><button type="button" className="text-button" onClick={()=>setEditing(false)}>Cancel</button></div></form>)}
  </section>;
}
export function NewsPanel({watchlist,marketFeed,fixedSymbol=null}) {
  const {marketTime,zoneLabel}=useDisplayTime();
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
    {!symbols.length ? <div className="feed-empty"><strong>No U.S. listings in this watchlist</strong><p>Import stocks, ETFs or ADRs to follow their news.</p></div> : !feed.data ? <Unavailable feed={feed}/> : !articles.length ? <div className="feed-empty"><Newspaper size={26}/><strong>No headlines returned for this selection</strong><p>Try another symbol or turn off the economy filter. Coverage is limited to the publisher’s latest feed.</p></div> : <div className="news-list">{articles.map((a,i)=><a className={`news-article ${i===0?'news-lead':''}`} key={a.id} href={a.url} target="_blank" rel="noopener noreferrer"><NewsImage image={a.image} priority={i===0}/><span className="news-number">{String(i+1).padStart(2,'0')}</span><div className="news-article-copy">{i===0 && <span className="news-lead-label">Latest headline</span>}<span className="news-meta">{a.publisher} <span>·</span> <time dateTime={a.publishedAt}>{marketTime(a.publishedAt)} {zoneLabel}</time> {a.economy && <b>ECONOMY</b>}</span><h3>{a.title}</h3></div><ArrowUpRight size={20}/></a>)}</div>}
    {feed.status==='stale' && <p className="calendar-warning" role="status">Showing cached headlines while the source reconnects.</p>}
    <div className="news-bottom"><FeedStatus feed={feed}/><span className="small-copy muted">Publisher images where available · refreshes every 10 min · links may require a subscription</span></div>
  </section>;
}
export function NewsPage({watchlist,marketFeed}) {
  return <div className="briefing-page news-page"><NewsPanel watchlist={watchlist} marketFeed={marketFeed}/></div>;
}
