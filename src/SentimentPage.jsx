import {PageHeader} from './PageHeader';
import {useDisplayTime} from './DisplayTime';
import {lazy,Suspense,useMemo,useState} from 'react';
import {ArrowClockwise,CaretRight} from '@phosphor-icons/react';
import {SentimentCard} from './Briefing';
import {useFeed,SourceLink,Unavailable} from './Feeds';
import {sentimentScore,sentimentDisplay,sentimentHistoryRange} from './data/sentiment.mjs';
import './sentiment.css';

const Gauge=lazy(()=>import('./SentimentCharts').then(module=>({default:module.SentimentGauge})));
const HistoryChart=lazy(()=>import('./SentimentCharts').then(module=>({default:module.SentimentHistoryChart})));
const CNN='https://www.cnn.com/markets/fear-and-greed';
const components=[
 ['market_momentum_sp500','Market momentum','S&P 500 vs. 125-day moving average'],
 ['stock_price_strength','Stock price strength','52-week highs vs. lows'],
 ['stock_price_breadth','Stock price breadth','Trading volume: rising vs. falling stocks'],
 ['put_call_options','Put & call options','Put volume vs. call volume'],
 ['market_volatility_vix','Market volatility','VIX vs. its recent trend'],
 ['junk_bond_demand','Junk bond demand','Lower-rated vs. investment-grade bonds'],
 ['safe_haven_demand','Safe-haven demand','Stock vs. Treasury bond returns'],
];
const roundedScore=value=>Number.isFinite(value)?String(Math.round(value)):'—';
const tone=rating=>rating?.toLowerCase().includes('fear')?'fear':rating?.toLowerCase().includes('greed')?'greed':'neutral';
const dateLabel=date=>new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',day:'numeric',month:'short',year:'numeric'}).format(new Date(date+'T12:00:00Z'));
const cadence=feed=>feed.source?.delivery==='daily'?'Daily CNN backup':feed.source?.delivery==='hourly'?'Hourly CNN snapshot':feed.source?.delivery==='api'?'CNN API snapshot':'Cadence not supplied';
function Rating({rating}){return <span className={`sentiment-rating ${tone(rating)}`}>{rating||'Not supplied'}</span>;}
function Source({feed}){return <><SourceLink href={feed.source?.url||CNN}>CNN</SourceLink>{feed.source?.via&&<> via <SourceLink href={feed.source.via.url}>{feed.source.via.name}</SourceLink></>}</>;}
function Overview({briefing,onSettings}){
 const {sentiment:feed}=briefing,{marketTime,zoneLabel}=useDisplayTime(),reading=feed.data,display=sentimentDisplay(feed,briefing.now);
 // Preserve the existing optional manual backup and its explicit save controls during an outage.
 if(!reading)return <SentimentCard briefing={briefing} onSettings={onSettings}/>;
 return <section className="sentiment-overview" aria-label="CNN Fear and Greed">
  {display.outdated&&<div className="sentiment-current-unavailable" role="status"><strong>Current reading unavailable</strong><p>{display.detail}</p></div>}
  <div className="sentiment-overview-grid"><div className="sentiment-score-panel">
   <div className="sentiment-score-copy">{display.outdated&&<small className="sentiment-snapshot-label">Last available snapshot</small>}<div className="sentiment-value"><strong title={`Source score: ${sentimentScore(reading.score)}`}>{roundedScore(reading.score)}</strong><span>/ 100</span></div><div className="sentiment-provider-rating">Provider rating <Rating rating={reading.rating}/></div></div>
   {display.outdated?<p className="sentiment-gauge-unavailable">{display.label}<br/><small>The gauge returns when a current observation is available.</small></p>:<Suspense fallback={<div className="sentiment-gauge-loading">Loading scale…</div>}><Gauge score={reading.score} rating={reading.rating}/></Suspense>}
  </div><div className="sentiment-comparisons"><h2>Comparisons</h2><table className="sentiment-history"><caption className="sr-only">Provider comparison scores</caption><tbody>{[['Previous close','previousClose'],['1 week','previousWeek'],['1 month','previousMonth'],['1 year','previousYear']].map(([label,key])=><tr key={key}><th scope="row">{label}</th><td><strong>{sentimentScore(reading[key])}</strong></td></tr>)}</tbody></table></div></div>
  <div className="sentiment-source-line"><span>Source: <Source feed={feed}/></span><span className="reading-date">Observation: {marketTime(reading.observedAt)} {zoneLabel}</span>{feed.fetchedAt&&<span>Fetched: {marketTime(feed.fetchedAt)} {zoneLabel}</span>}<span className={`sentiment-source-status ${display.warning?'amber':'muted'}`}>{display.label}</span></div>
  <details className="sentiment-headline-details"><summary>Headline source details</summary><p>{cadence(feed)} · checks every 10 min · not a real-time feed.</p>{feed.checkedAt&&<p>Source checked {marketTime(feed.checkedAt)} {zoneLabel}</p>}</details>
  {display.detail&&!display.outdated&&<p className="sentiment-detail-note amber" role="status">{display.detail}</p>}
 </section>;
}
function History({feed,now}){
 const [range,setRange]=useState('1M'),[selected,setSelected]=useState(null);
 const {marketTime,zoneLabel}=useDisplayTime();
 const points=useMemo(()=>sentimentHistoryRange(feed.data?.points||[],range,now),[feed.data,range,now]);
 const active=Math.min(selected??points.length-1,points.length-1),point=points[active];
 return <section className="sentiment-timeline" aria-label="Fear and Greed history">
  <header><h2>History</h2><div className="sentiment-ranges" role="group" aria-label="Sentiment history range">{['1M','3M','6M','YTD','1Y','All'].map(value=><button key={value} aria-pressed={range===value} onClick={()=>{setRange(value);setSelected(null);}}>{value}</button>)}</div></header>
  {!feed.data?<Unavailable feed={feed}/>:!points.length?<p className="sentiment-empty">No observations supplied for this period.</p>:<>
   <Suspense fallback={<div className="sentiment-history-chart" role="status">Loading history…</div>}><HistoryChart points={points} selected={active}/></Suspense>
   <details className="sentiment-history-details"><summary>Explore observations & source details</summary>
    <div className="sentiment-history-reading" aria-live="polite"><strong>{sentimentScore(point.score)}</strong><Rating rating={point.rating}/><time dateTime={point.date}>{dateLabel(point.date)}</time></div>
    <label className="sentiment-history-slider">Explore observations<input type="range" min="0" max={points.length-1} value={active} onChange={e=>setSelected(Number(e.target.value))} aria-label="Historical sentiment observation" aria-valuetext={`${dateLabel(point.date)}, ${sentimentScore(point.score)}, ${point.rating}`}/></label>
    <p className="sentiment-detail-note">{points.length} supplied daily observations · Latest: {dateLabel(points.at(-1).date)}. Dates follow the provider’s daily series. Missing dates are not filled; the latest point may be an intraday snapshot.</p>
    <p className="sentiment-detail-note">Source: <Source feed={feed}/>{feed.fetchedAt&&<> · Fetched {marketTime(feed.fetchedAt)} {zoneLabel}</>}</p>
   </details>
  </>}
  {feed.status==='stale'&&<p className="sentiment-detail-note amber" role="status">Cached history · {feed.message}</p>}
 </section>;
}
function ComponentTable({items,readings}){
 return <table className="sentiment-component-table"><caption className="sr-only">CNN sentiment components: {items.map(item=>item[1]).join(', ')}</caption><thead><tr><th>Component</th><th>Rating</th><th>Value</th></tr></thead><tbody>{items.map(([id,title,description])=>{
  const item=readings.get(id);
  return <tr key={id} className="sentiment-component"><th scope="row"><strong>{title}</strong><span>{description}</span></th><td data-label="Rating"><Rating rating={item?.rating}/></td><td data-label="Value" className="sentiment-component-reading" title={item?`Source score: ${sentimentScore(item.score)}`:undefined}>{roundedScore(item?.score)}</td></tr>;
 })}</tbody></table>;
}
export default function SentimentPage({briefing,onSettings}){
 const {marketTime,zoneLabel}=useDisplayTime(),details=useFeed('/api/sentiment/details');
 const fallback={status:details.status,message:details.message,data:null};
 const indicators=details.data?.components||fallback,history=details.data?.history||fallback;
 const readings=new Map((indicators.data?.components||[]).map(item=>[item.id,item]));
 const refresh=()=>{briefing.sentiment.refresh();details.refresh();};
 return <div className="sentiment-page">
  <PageHeader title="Fear & Greed" description="CNN market sentiment and its components." actions={<button className="button primary" onClick={refresh} disabled={briefing.sentiment.refreshing||details.refreshing||details.status==='loading'}><ArrowClockwise size={18}/>Refresh readings</button>}/>
  <Overview briefing={briefing} onSettings={onSettings}/>
  <History feed={history} now={briefing.now}/>
  <section className="sentiment-components" aria-label="Seven sentiment indicators"><header><h2>Components</h2><div>Source: <Source feed={indicators}/> <span className="sentiment-component-cadence">{cadence(indicators)} · daily history</span></div></header>
   {!indicators.data&&<Unavailable feed={indicators}/>}
   {indicators.status==='stale'&&<p className="sentiment-detail-note amber" role="status">Cached components · {indicators.message}</p>}
   <div className="sentiment-component-tables"><ComponentTable items={components.slice(0,4)} readings={readings}/><ComponentTable items={components.slice(4)} readings={readings}/></div>
   <details className="sentiment-source-details"><summary>About the readings & sources</summary><p>These are sentiment scores out of 100, not stock prices, VIX levels or put/call ratios. The rating comes from the provider. Components and the headline may update separately.</p><p>{indicators.data?.observedAt?`Component snapshot: ${marketTime(indicators.data.observedAt)} ${zoneLabel}.`:'The provider does not supply a snapshot observation time; freshness cannot be confirmed for undated components.'}{indicators.fetchedAt?` Fetched: ${marketTime(indicators.fetchedAt)} ${zoneLabel}.`:''}</p><p>Comparison timestamps are not supplied. Automatic sources are checked every 10 minutes; this is not a real-time feed. CNN combines seven measures of market behaviour. The index does not confirm a break-and-retest entry. Raw history for individual components is not supplied.</p>{briefing.sentiment.data&&<button className="text-button" onClick={onSettings}>Manage CNN connection<CaretRight size={16}/></button>}</details>
  </section>
 </div>;
}
