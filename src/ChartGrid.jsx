import {useState} from 'react';
import {PushPin,ArrowsOutSimple,CaretLeft,CaretRight,Info} from '@phosphor-icons/react';
import {GridChart,PriceChart} from './Charts';
import {ChartHeader,ChartLevels,useSavedTimeframe} from './ChartSettings';
import {useMarketChart} from './useMarketData';
import {useZoneRoles} from './ZoneRoles';
import {useDisplayTime} from './DisplayTime';
import {useGridData} from './useGridData';
import {marketFeed} from './market-feed';
import {gridEntries,gridHistory} from './data/chart-grid.mjs';
import {quoteKey,quotePrice,quoteChange,quoteTone} from './data/quotes.mjs';
import {matchingInstrument} from './data/market';
import {stageLabel} from './data/retests.mjs';
import './chart-grid.css';

function GridCard({entry,history={status:'loading'},sheet,setup,interval,range,pinned,pinDisabled,onPin,onOpen}){
  const key=quoteKey(entry),roles=useZoneRoles(matchingInstrument(entry,sheet),sheet.date,key);
  const {quoteStamp,clockStamp,zoneLabel}=useDisplayTime(),view=gridHistory(history,range),quote=history.quote;
  const stale=history.status==='stale',indicators=view.indicators?.series||{};
  const missing=['ema9','ema21','vwap'].filter(id=>!indicators[id]?.some(value=>Number.isFinite(value)));
  const result=stale?{stage:'stale'}:setup||{stage:'no-levels'};
  return <article className={`grid-chart-card ${pinned?'is-pinned':''}`} data-market-key={key}>
    <header><button className="grid-symbol" onClick={onOpen} aria-label={`Expand ${entry.symbol} chart`}><strong>{entry.symbol}</strong><small>{entry.exchange}</small></button><div className="grid-card-price"><strong>{quotePrice(quote)}</strong><span className={quoteTone(quote)}>{quoteChange(quote)}</span></div><button className="icon-button" aria-label={`${pinned?'Unpin':'Pin'} ${entry.symbol}`} aria-pressed={pinned} disabled={pinDisabled&&!pinned} onClick={onPin}><PushPin size={17} weight={pinned?'fill':'regular'}/></button><button className="icon-button" onClick={onOpen} aria-label={`Open ${entry.symbol} full chart`}><ArrowsOutSimple size={18}/></button></header>
    <div className="grid-card-status"><span className={result.stage==='confirmed'?(result.direction==='bearish'?'red':'green'):'muted'}>{result.stage==='not-scanned'?'Not in stock scan':stageLabel(result.stage)}{result.direction?` · ${result.direction}`:''}</span><small>{result.timeframe||'—'} setup</small></div>
    {view.candles.length?<button className="grid-chart-open" onClick={onOpen} aria-label={`Inspect ${entry.symbol} chart`}><GridChart symbol={entry.symbol} timeframe={interval} candles={view.candles} indicators={view.indicators} instrument={roles.instrument} provider={quote?.provider||marketFeed.label}/></button>:<div className="grid-chart-empty" role="status"><strong>{history.status==='loading'?'Loading candles…':'Chart unavailable'}</strong><span>{history.message||'Waiting for actual source history.'}</span></div>}
    <footer><span className={stale?'amber':''}>{stale?'Cached / old · ':''}{quote?`${quote.provider||marketFeed.label} · ${quoteStamp(quote)}`:marketFeed.label}</span>
      <span>{view.date?`Regular-session history · ${range==='session'?view.date:'available history'} · ${view.candles.length} bars`:'Regular-session history unavailable'}{view.candles.at(-1)?.partial?' · Partial final bar':''}</span>
      {view.candles.length>0&&<span>Last bar {clockStamp(view.candles.at(-1).timestamp*1000)} · {zoneLabel}{missing.length?` · ${missing.map(id=>({ema9:'EMA 9',ema21:'EMA 21',vwap:'VWAP'}[id])).join(', ')} unavailable`:' · EMA 9/21 + VWAP'}</span>}
      <span>{roles.instrument?`Levels ${roles.date} · ${roles.instrument.timeframe} · ${roles.status==='ok'?'confirmed roles':roles.status==='stale'?'cached roles':'imported roles; confirmation pending'}`:'No matching imported levels'}</span>
      {result.through&&<span>Setup checked through {clockStamp(result.through*1000)} · {result.sessionDate}</span>}
    </footer>
  </article>;
}
export default function ChartGrid({watchlist,sheet,scan,config,onChange,onOpen}){
  const [page,setPage]=useState(0),{pinned,remaining}=gridEntries(watchlist,scan,config.mode,config.pins);
  const slots=6-pinned.length,pages=slots?Math.max(1,Math.ceil(remaining.length/slots)):1,current=Math.min(page,pages-1);
  const entries=[...pinned,...remaining.slice(current*slots,(current+1)*slots)],keys=entries.map(quoteKey),data=useGridData(keys,config.interval);
  const update=change=>{setPage(0);onChange(change);};
  const togglePin=key=>update({pins:config.pins.includes(key)?config.pins.filter(pin=>pin!==key):[...config.pins.filter(pin=>watchlist.some(entry=>quoteKey(entry)===pin)),key].slice(0,6)});
  return <section className="chart-grid-desk" aria-label="Top / Hot chart grid">
    <div className="chart-grid-heading"><div><h2>Market radar</h2><p>Compare your watchlist. Inspect a setup. Keep your shortlist pinned.</p></div><span className="grid-feed-status"><Info size={16}/>Real-time feed not connected</span></div>
    <div className="chart-grid-controls"><div className="segmented" aria-label="Grid source">{[['watchlist','Watchlist'],['scanner','Scanner']].map(([mode,label])=><button key={mode} aria-pressed={config.mode===mode} className={config.mode===mode?'selected':''} onClick={()=>update({mode})}>{label}</button>)}</div>
      <label>Chart interval<select aria-label="Grid chart interval" value={config.interval} onChange={event=>update({interval:event.target.value})}>{['2m','5m','15m'].map(frame=><option key={frame}>{frame}</option>)}</select></label>
      <label>Range<select aria-label="Grid history range" value={config.range} onChange={event=>update({range:event.target.value})}><option value="session">Latest session</option><option value="history">Available history</option></select></label>
      <div className="grid-pagination"><button className="icon-button" disabled={current===0} onClick={()=>setPage(current-1)} aria-label="Previous grid page"><CaretLeft size={18}/></button><span>{current+1} / {pages}</span><button className="icon-button" disabled={current>=pages-1} onClick={()=>setPage(current+1)} aria-label="Next grid page"><CaretRight size={18}/></button></div>
    </div>
    <p className="grid-source-note">{marketFeed.label} · checks every minute while visible · delivery may be delayed. Latest session shows available bars, which may cover only part of the session. {config.mode==='scanner'?'Scanner shows qualifying stocks/ADRs ranked by your existing rules; pinned symbols stay visible.':'Watchlist includes eligible U.S. stocks, ADRs and funds.'} Chart interval does not change setup confirmation.</p>
    {config.mode==='scanner'&&!remaining.length&&!pinned.length?<div className="empty"><h3>{scan.status==='loading'?'Checking your watchlist…':'No qualifying setups'}</h3><p>Use Watchlist to browse charts, or Scan details above to see data gaps and unmet rules.</p></div>:entries.length?<div className="chart-grid-cards">{entries.map(entry=><GridCard key={`${quoteKey(entry)}:${config.interval}`} entry={entry} history={data[quoteKey(entry)]} sheet={sheet} setup={scan.byKey[quoteKey(entry)]||{stage:scan.status==='loading'?'loading':entry.group==='FUND'?'not-scanned':'no-levels'}} interval={config.interval} range={config.range} pinned={config.pins.includes(quoteKey(entry))} pinDisabled={pinned.length>=6} onPin={()=>togglePin(quoteKey(entry))} onOpen={()=>onOpen(entry)}/>)}</div>:<div className="empty"><h3>No eligible watchlist symbols</h3><p>Add U.S. stocks, ADRs or funds in Settings → Watchlist.</p></div>}
    <p className="grid-source-note">Monitoring only · real-time market data and options liquidity are not connected.</p>
  </section>;
}

export function GridDetail({entry,sheet,interval,setup}){
  const [frame,setFrame]=useState(interval),key=quoteKey(entry),history=useMarketChart(key,frame),roles=useZoneRoles(matchingInstrument(entry,sheet),sheet.date,key);
  const {quoteStamp}=useDisplayTime(),[,saveFrame]=useSavedTimeframe(key);
  const changeFrame=value=>{setFrame(value);saveFrame(value);};
  return <section className="context-chart-panel"><ChartHeader symbol={entry.symbol} marketKey={key} timeframe={frame} onTimeframe={changeFrame} roles={roles}/>
    <ChartLevels scope={`${key}|${frame}`} instrument={roles.instrument} date={sheet.date} roles={roles} quoteDate={history.quote?.sessionDate}/>
    {history.candles?.length?<PriceChart symbol={entry.symbol} drawingKey={key} instrument={roles.instrument} timeframe={frame} candles={history.candles} price={history.quote?.price??history.candles.at(-1).ohlc[1]} indicators={history.indicators}/>:<div className="empty"><h3>{history.status==='loading'?'Loading chart…':'Chart unavailable'}</h3><p>{history.message}</p></div>}
    <p className="grid-source-note">{history.status==='stale'?'Cached / old history · ':''}{history.quote?`${history.quote.provider} · ${quoteStamp(history.quote)}`:'Waiting for source'} · Regular-session candles · source may be delayed.</p>
    <p className="grid-source-note">{stageLabel(setup?.stage||'loading')} · {setup?.timeframe||'Selected'} setup confirmation · chart interval is independent. Expanded charts include your saved indicators, display settings and drawings.</p>
  </section>;
}
