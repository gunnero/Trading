import {useMemo,useState} from 'react';
import {ArrowClockwise,CaretRight,Gauge} from '@phosphor-icons/react';
import {SentimentCard} from './Briefing';
import {useFeed,SourceLink,Unavailable,FeedStatus} from './Feeds';
import {briefingTime} from './data/calendar.mjs';
import {sentimentScore} from './data/sentiment.mjs';
import './sentiment.css';

const components=[
 ['market_momentum_sp500','Market momentum','The S&P 500’s position relative to its 125-day moving average.'],
 ['stock_price_strength','Stock price strength','Stocks reaching new highs compared with those reaching new lows.'],
 ['stock_price_breadth','Stock price breadth','Trading volume in rising stocks compared with falling stocks.'],
 ['put_call_options','Put & call options','The balance of put and call option activity across the market.'],
 ['market_volatility_vix','Market volatility','Expected S&P 500 volatility, measured with the VIX and its recent trend.'],
 ['junk_bond_demand','Junk bond demand','Demand for lower-rated debt compared with safer bonds.'],
 ['safe_haven_demand','Safe-haven demand','Stock returns compared with Treasury bond returns.'],
];
const tone=rating=>rating?.includes('fear')?'fear':rating?.includes('greed')?'greed':'neutral';
const dateLabel=date=>new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',day:'numeric',month:'short',year:'numeric'}).format(new Date(date+'T12:00:00Z'));
function History({feed,now}){
 const [days,setDays]=useState(90),[selected,setSelected]=useState(null);
 const points=useMemo(()=>(feed.data?.points||[]).filter(p=>Date.parse(p.date+'T00:00:00Z')>=now-days*86400000),[feed.data,days,now]);
 const active=Math.min(selected??points.length-1,points.length-1),point=points[active];
 const start=Date.parse(points[0]?.date),end=Date.parse(points.at(-1)?.date),span=end-start||86400000;
 const x=p=>48+(Date.parse(p.date)-start)/span*660,y=p=>230-p.score*2;
 const path=points.map((p,i)=>`${i?'L':'M'}${x(p).toFixed(2)},${y(p).toFixed(2)}`).join(' ');
 function selectAt(event){const box=event.currentTarget.getBoundingClientRect(),target=(event.clientX-box.left)/box.width*740;let nearest=0;points.forEach((p,i)=>{if(Math.abs(x(p)-target)<Math.abs(x(points[nearest])-target))nearest=i;});setSelected(nearest);}
 return <section className="panel sentiment-timeline" aria-label="Fear and Greed history">
  <header><div><span className="eyebrow">SENTIMENT OVER TIME</span><h2>How the mood has changed</h2></div><div className="segmented" role="group" aria-label="Sentiment history range">{[[30,'1M'],[90,'3M'],[365,'1Y']].map(([value,label])=><button key={value} aria-pressed={days===value} className={days===value?'selected':''} onClick={()=>{setDays(value);setSelected(null);}}>{label}</button>)}</div></header>
  {!feed.data?<Unavailable feed={feed}/>:!points.length?<p className="sentiment-empty">No observations supplied for this period.</p>:<>
   <div className="sentiment-history-reading" aria-live="polite"><strong>{sentimentScore(point.score)}</strong><span className={tone(point.rating)}>{point.rating}</span><time dateTime={point.date}>{dateLabel(point.date)}</time></div>
   <svg viewBox="0 0 740 260" className="sentiment-history-chart" role="img" aria-label={`CNN sentiment history, ${dateLabel(points[0].date)} to ${dateLabel(points.at(-1).date)}. Use the slider below to read each observation.`} onPointerMove={selectAt} onPointerDown={selectAt}>
    {[0,25,50,75,100].map(value=><g key={value}><line x1="48" x2="708" y1={230-value*2} y2={230-value*2} stroke="var(--border)" strokeDasharray={value===50?'4 5':undefined}/><text x="34" y={234-value*2} textAnchor="end">{value}</text></g>)}
    <path d={path} fill="none" stroke="var(--green)" strokeWidth="2.5"/>
    <line x1={x(point)} x2={x(point)} y1="25" y2="230" stroke="var(--muted)" strokeDasharray="3 5"/>
    <circle cx={x(point)} cy={y(point)} r="5" fill="var(--green)" stroke="var(--panel)" strokeWidth="2"/>
    <text x="48" y="252">{dateLabel(points[0].date)}</text><text x="708" y="252" textAnchor="end">{dateLabel(points.at(-1).date)}</text>
   </svg>
   <label className="sentiment-history-slider">Explore observations<input type="range" min="0" max={points.length-1} value={active} onChange={e=>setSelected(Number(e.target.value))} aria-label="Historical sentiment observation" aria-valuetext={`${dateLabel(point.date)}, ${sentimentScore(point.score)}, ${point.rating}`}/></label>
   <p className="sentiment-detail-note">{points.length} supplied daily observations · Latest: {dateLabel(points.at(-1).date)}. Dates follow the provider’s daily series. Missing dates are not filled; the latest point may be an intraday snapshot.</p>
  </>}
  {feed.status==='stale'&&<p className="sentiment-detail-note amber" role="status">{feed.message}</p>}
  <FeedStatus feed={feed} label={feed.status==='ok'?'Historical series':undefined}/>
 </section>;
}
export default function SentimentPage({briefing,onSettings}){
 const details=useFeed('/api/sentiment/details');
 const fallback={status:details.status,message:details.message,data:null};
 const indicators=details.data?.components||fallback,history=details.data?.history||fallback;
 const readings=new Map((indicators.data?.components||[]).map(item=>[item.id,item]));
 const refresh=()=>{briefing.sentiment.refresh();details.refresh();};
 return <div className="sentiment-page">
  <div className="sentiment-page-intro"><p>The mood of the U.S. stock market, and the indicators behind it.</p><button className="button outline" onClick={refresh} disabled={details.refreshing||details.status==='loading'}><ArrowClockwise size={17}/>Refresh readings</button></div>
  <div className="sentiment-hero"><SentimentCard briefing={briefing} onSettings={onSettings}/><History feed={{...history,refresh:details.refresh,refreshing:details.refreshing}} now={briefing.now}/></div>
  <section className="sentiment-components" aria-label="Seven sentiment indicators"><header><div><span className="eyebrow">THE SEVEN INDICATORS</span><h2>What’s behind the score?</h2></div><SourceLink href="https://www.oanor.dev/api/stockfeargreed-api">CNN data via Oanor</SourceLink></header>
   <p className="sentiment-detail-note">These are sentiment scores out of 100, not stock prices, VIX levels or put/call ratios. Open an indicator to see what it measures.</p>
   {!indicators.data&&<Unavailable feed={indicators}/>}
   {indicators.status==='stale'&&<p className="sentiment-detail-note amber" role="status">{indicators.message}</p>}
   {indicators.data&&<p className="sentiment-detail-note">{indicators.data.observedAt?`Indicator snapshot · ${briefingTime(indicators.data.observedAt)} Skopje`:'The provider does not supply an observation time for this component snapshot; its freshness cannot be confirmed.'}{indicators.fetchedAt?` Retrieved ${briefingTime(indicators.fetchedAt)} Skopje.`:''} Components and the headline may update separately.</p>}
   <div className="sentiment-components-grid">{components.map(([id,title,description],index)=>{const item=readings.get(id);return <details className={`panel sentiment-component ${item?tone(item.rating):''}`} key={id}><summary><span className="sentiment-component-number">0{index+1}</span><h3>{title}</h3><CaretRight size={16}/><div className="sentiment-component-reading"><strong>{item?sentimentScore(item.score):'—'}</strong><span>{item?item.rating:'Not supplied'}</span></div>{item&&<div className="sentiment-component-scale" aria-hidden="true"><i style={{width:`${item.score}%`}}/></div>}</summary><div className="sentiment-component-description"><p>{description}</p>{item&&<small>{item.observedAt?`Observed ${briefingTime(item.observedAt)} Skopje`:'Individual observation time not supplied.'}</small>}</div></details>;})}</div>
  </section>
  <section className="panel sentiment-about"><Gauge size={25}/><div><h2>Reading the index</h2><p>Lower scores indicate fear; higher scores indicate greed. CNN combines seven measures of market behaviour into one index. Compare it with your levels, price action and the session’s events. It does not confirm a break-and-retest entry.</p><p>The history shows the index score. Raw historical series for the individual indicators are not supplied by this connection.</p></div></section>
 </div>;
}
