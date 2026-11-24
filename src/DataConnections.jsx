import {Fragment,useState} from 'react';
import {ArrowSquareOut,ArrowsClockwise,CaretDown,CaretRight,Circle,SlidersHorizontal,Warning} from '@phosphor-icons/react';
import {useMarketChart} from './useMarketData';
import {useDisplayTime} from './DisplayTime';
import {IbkrConnection} from './IbkrConnection';
import {SentimentConnection} from './SentimentConnection';
import {sentimentDisplay} from './data/sentiment.mjs';
import './data-connections.css';

const minute=60000;
const marketSources=[
  {id:'stocks',name:'Yahoo stock history',description:'Equity price history · U.S. listings',scope:'AAPL · NASDAQ',url:'https://finance.yahoo.com/quote/AAPL/history/',provider:'Yahoo Finance',cadence:'Every minute'},
  {id:'futures',name:'Yahoo futures',description:'Futures prices and history',scope:'NQ=F · E-mini Nasdaq-100',url:'https://finance.yahoo.com/quote/NQ%3DF/history/',provider:'Yahoo Finance',cadence:'Every minute'},
  {id:'treasury',name:'U.S. Treasury daily yield',description:'Daily 2-year Treasury par yield',scope:'U.S. 2-year par yield',url:'https://home.treasury.gov/resource-center/data-chart-center/interest-rates',provider:'U.S. Treasury',cadence:'Daily · checked hourly'},
];

function sourceHealth(feed,hasData,{partial=false,outdated=false,backup=false,history=false}={}){
  if(feed.status==='loading')return {label:'Checking',message:'Reading the source.'};
  if(!['ok','stale'].includes(feed.status)||!hasData)return {label:'Unavailable',message:'No reading available.',warning:feed.message||'The source did not return a usable reading.'};
  if(feed.status==='stale')return {label:history?'Stale':'Cached',message:history?'Last available series is shown.':'Last saved reading is shown.',warning:feed.message||'The source refresh is pending. Automatic checks will continue.'};
  if(outdated)return {label:'Delayed',message:'Observation is behind the session.',warning:feed.message};
  if(partial)return {label:'Partial',message:'Limited date coverage.',warning:feed.message};
  if(backup)return {label:'Daily backup',message:'Daily archive snapshot.'};
  return {label:'Available',message:'Source returned data.'};
}

function marketSource(source,feed,display){
  const treasury=source.id==='treasury',q=feed.quote;
  const count=treasury?feed.points?.length:feed.candles?.length;
  const hasData=Number.isFinite(q?.price)&&count>0;
  const health=sourceHealth(feed,hasData,{history:true});
  if(health.label==='Available')health.message=treasury?'Published yield available.':`${q.providerSymbol||source.scope} history available.`;
  return {...source,feed,health,observation:hasData?(treasury?`${q.price}%`:q.price.toLocaleString('en-US',{maximumFractionDigits:4})):'—',
    observationNote:hasData?(q.observedAt?display.stamp(q.observedAt):q.sessionDate):null,
    scopeLabel:'Checked series',scopeNote:hasData?(treasury?`${count} daily observations`:`${count} bars · 15m history`):null};
}

function connectionRows({sentiment,calendar,news,now},charts,display){
  const state=sentimentDisplay(sentiment,now),reading=sentiment.data;
  const cnnHealth=sourceHealth(sentiment,Number.isFinite(reading?.score),{outdated:state.outdated,backup:sentiment.source?.delivery==='daily'});
  const cnn={id:'cnn',name:'CNN Fear & Greed',description:'Market sentiment index (0–100)',feed:sentiment,health:cnnHealth,cadence:'Every 10 minutes',
    observation:Number.isFinite(reading?.score)?`${Math.round(reading.score)} / 100`:'—',observationNote:reading?.observedAt?display.stamp(reading.observedAt):null,
    scopeLabel:({daily:'Daily snapshot',hourly:'Hourly snapshot',api:'API delivery'})[sentiment.source?.delivery]||'Snapshot',scope:reading?state.label:'—',scopeNote:reading?.rating,provider:sentiment.source?.name||'CNN Fear & Greed',url:sentiment.source?.url||'https://edition.cnn.com/markets/fear-and-greed',via:sentiment.source?.via,
    warning:cnnHealth.warning||state.detail};
  const events=calendar.data?.events,articles=news.data?.articles;
  const ranged=calendar.data?.coverageStart&&calendar.data?.coverageEnd;
  return [cnn,...marketSources.map(source=>marketSource(source,charts[source.id],display)),{
    id:'calendar',name:'Economic calendar',description:'Key U.S. economic events and releases',feed:calendar,health:sourceHealth(calendar,Array.isArray(events),{partial:calendar.data?.partialCoverage}),cadence:'Every 10 minutes',
    observationLabel:'Scheduled events',observation:Array.isArray(events)?String(events.length):'—',observationNote:'Next 14 days',scopeLabel:'Coverage',scope:ranged?`${calendar.data.coverageStart} – ${calendar.data.coverageEnd}`:'—',
    provider:calendar.source?.name||'—',url:calendar.source?.url,
  },{
    id:'headlines',name:'Yahoo headlines',description:'Market and company news headlines',feed:news,health:sourceHealth(news,Array.isArray(articles)),cadence:'Every 10 minutes',
    observationLabel:'Latest headline',observation:articles?.[0]?.title||(Array.isArray(articles)?'No headlines':'—'),observationNote:articles?.[0]?.publishedAt?display.stamp(articles[0].publishedAt):null,
    scopeLabel:'Market feeds',scope:'DIA, IWM, QQQ, SPY',scopeNote:Array.isArray(articles)?`${articles.length} headlines`:null,provider:news.source?.name||'Yahoo Finance',url:news.source?.url||'https://finance.yahoo.com/',
  }];
}

function SourceDetails({row,stamp}){
  const {feed,health}=row,warning=row.warning||health.warning;
  const retry=['Unavailable','Cached','Stale','Delayed','Partial'].includes(health.label);
  return <div className="connection-details">
    <dl className="connection-facts">
      <div><dt>{row.observationLabel||'Last observation'}</dt><dd>{row.observation}</dd>{row.observationNote&&<dd className="connection-note">{row.observationNote}</dd>}</div>
      <div><dt>Last fetch</dt><dd>{stamp(feed.fetchedAt)}</dd>{feed.checkedAt&&feed.checkedAt!==feed.fetchedAt&&<dd className="connection-note">Checked {stamp(feed.checkedAt)}</dd>}</div>
      <div><dt>{row.scopeLabel}</dt><dd>{row.scope}</dd>{row.scopeNote&&<dd className="connection-note">{row.scopeNote}</dd>}</div>
      <div><dt>Source</dt><dd>{row.url?<a href={row.url} target="_blank" rel="noreferrer"><ArrowSquareOut size={16}/>{row.provider}</a>:row.provider}</dd>{row.via&&<dd className="connection-note">via {row.via.name}</dd>}</div>
    </dl>
    {(warning||retry)&&<div className="connection-warning"><Warning size={20}/><p><strong>{health.message}</strong> {warning}</p>{retry&&<button type="button" className="button outline" aria-label={`Retry ${row.name}`} disabled={feed.refreshing} onClick={feed.refresh}>{feed.refreshing?'Checking…':'Retry'}</button>}</div>}
  </div>;
}

export function DataConnections({briefing,settingsOpen,onSettings}){
  const [expanded,setExpanded]=useState('cnn');
  const stock=useMarketChart('NASDAQ:AAPL','15m'),future=useMarketChart('NQ','15m'),yieldHistory=useMarketChart('US2Y','D',true,60*minute);
  const {clockDate,clockTime,settings,zoneLabel}=useDisplayTime();
  const when=value=>Number.isFinite(Date.parse(value))?`${clockDate(value)}, ${clockTime(value)}`:'—';
  const stamp=value=>Number.isFinite(Date.parse(value))?`${when(value)} · ${zoneLabel}`:'—';
  const rows=connectionRows(briefing,{stocks:stock,futures:future,treasury:yieldHistory},{stamp});
  const busy=rows.some(({feed})=>feed.status==='loading'||feed.refreshing);
  return <section className="data-connections" aria-labelledby="data-connections-title">
    <header className="connections-heading"><div><h2 id="data-connections-title">Data connections</h2><p>Source health and automatic refresh.</p></div>
      <div className="connection-actions"><button type="button" className="button outline" disabled={busy} onClick={()=>rows.forEach(({feed})=>feed.refresh())}><ArrowsClockwise size={18}/>{busy?'Checking status…':'Refresh status'}</button>
        <button type="button" className="button primary" aria-expanded={settingsOpen} aria-controls={settingsOpen?'connection-settings':undefined} onClick={()=>onSettings(!settingsOpen)}><SlidersHorizontal size={18}/>Connection settings</button></div>
    </header>
    {settingsOpen&&<section id="connection-settings" className="connection-settings-card"><h3>CNN API connection</h3><SentimentConnection embedded onChange={briefing.sentiment.refresh}/></section>}
    <IbkrConnection/>
    <div className="connection-table"><table aria-label="Data source status">
      <colgroup><col className="con-source"/><col className="con-status"/><col className="con-updated"/><col/></colgroup>
      <thead><tr>{['Source','Status','Last updated','Refresh cadence'].map(label=><th key={label} scope="col">{label}</th>)}</tr></thead>
      <tbody>{rows.map(row=>{
        const open=expanded===row.id,detailId='connection-detail-'+row.id,updated=row.feed.fetchedAt;
        return <Fragment key={row.id}>
          <tr className={'connection-row'+(open?' expanded':'')}>
            <th scope="row"><button type="button" aria-expanded={open} aria-controls={open?detailId:undefined} aria-label={row.name} onClick={()=>setExpanded(open?null:row.id)}>{open?<CaretDown/>:<CaretRight/>}<span><strong>{row.name}</strong><small>{row.description}</small></span></button></th>
            <td className="con-health"><span className="connection-badge" data-tone={row.health.label==='Available'?'good':['Checking','Unavailable'].includes(row.health.label)?'neutral':'warn'}><Circle weight="fill" size={10}/>{row.health.label}</span><small>{row.health.message}</small></td>
            <td className="con-time"><span className="con-mobile-label">Last updated</span>{when(updated)}{updated&&<small>{settings.timeZone}</small>}</td>
            <td className="con-cadence"><span className="con-mobile-label">Refresh cadence</span>{row.cadence}</td>
          </tr>
          {open&&<tr id={detailId} className="connection-detail-row"><td colSpan={4}><SourceDetails row={row} stamp={stamp}/></td></tr>}
        </Fragment>;
      })}</tbody>
    </table></div>
  </section>;
}
