import {useDisplayTime} from './DisplayTime';
import {lazy,Suspense} from 'react';
import {ArrowClockwise,ChartLine,Clock} from '@phosphor-icons/react';
import {money,tradeResult,duration} from './data/journal.mjs';
import {TRADE_CHART_FRAMES} from './data/journal-chart.mjs';
import JournalOptionFills from './JournalOptionFills';

const Canvas=lazy(()=>import('./JournalTradeCanvas'));
export default function JournalTradeChart({trade,replay}){
  const {journalStamp,zoneLabel,formatLabel}=useDisplayTime();
  const {listings,choice,setChoice,symbol,frame,setFrame,history,candles,markers,levels}=replay;
  const {day:from,to}=replay.dates,result=tradeResult(trade);
  return <section className="journal-execution-chart" aria-label="Trade entry and exit chart">
    <div className="journal-execution-summary">
      <article className="entry"><span>ENTRY · {trade.position==='short'?'SELL TO OPEN':'BUY TO OPEN'}</span><strong>{money(trade.entryPrice)} <small>option premium</small></strong><time dateTime={trade.entryAt}>{journalStamp(trade.entryAt)}</time></article>
      <article className="exit"><span>EXIT · {trade.position==='short'?'BUY TO CLOSE':'SELL TO CLOSE'}</span><strong>{money(trade.exitPrice)} <small>{trade.exitAt?'option premium':'Position open'}</small></strong>{trade.exitAt?<time dateTime={trade.exitAt}>{journalStamp(trade.exitAt)}</time>:<span>No exit recorded</span>}</article>
      <article><span>GROSS P/L · {trade.quantity} {trade.quantity===1?'CONTRACT':'CONTRACTS'}</span><strong className={result.gross>0?'green':result.gross<0?'red':'muted'}>{money(result.gross)}</strong><small>{trade.exitAt?`${duration(result.seconds)} held · net ${money(result.net)}`:'Open · unmarked'}</small></article>
    </div>
    <JournalOptionFills trade={trade}/>
    <div className="journal-execution-heading"><div><h3>{trade.symbol} underlying chart</h3><p>{from===to?from:`${from} – ${to}`} · U.S. regular session · {zoneLabel} / {formatLabel}</p></div><div role="group" aria-label="Trade chart timeframe">{TRADE_CHART_FRAMES.map(value=><button type="button" key={value} aria-pressed={frame===value} onClick={()=>setFrame(value)}>{value}</button>)}</div></div>
    {listings.length>1&&<label className="journal-listing-choice">Choose the underlying listing<select value={choice} onChange={e=>setChoice(e.target.value)}><option value="">Choose listing</option>{listings.map(row=><option key={row.id} value={row.id}>{row.id}</option>)}</select></label>}
    {!symbol?<div className="journal-chart-empty"><ChartLine size={30}/><strong>{listings.length?'Choose a listing to load its history.':'Underlying listing unavailable'}</strong><span>{!listings.length&&'Add the exact U.S. stock or fund to your watchlist to enable its chart.'}</span></div>:
      candles.length?<Suspense fallback={<div className="journal-chart-empty">Loading chart…</div>}><Canvas key={history.key} trade={trade} candles={candles} markers={markers} timeframe={frame} levels={levels}/></Suspense>:
      <div className="journal-chart-empty" role="status"><Clock size={28}/><strong>{history.status==='loading'?'Loading trade history…':'Historical chart unavailable'}</strong><span>{history.status==='loading'?'Loading candles for the saved execution dates.':history.message}</span></div>}
    {candles.length>0&&markers.some(m=>!m.available)&&<p className="journal-chart-warning" role="status">{markers.filter(m=>!m.available).map(m=>m.kind==='entry'?'Entry':'Exit').join(' and ')} time has no covering source candle. No marker is drawn for that execution; history may be missing, delayed or outside regular stock hours.</p>}
    <div className="journal-execution-foot"><span>{history.status==='stale'?'Cached history · ':''}Yahoo Finance{history.fetchedAt?` · fetched ${journalStamp(history.fetchedAt)} ${zoneLabel}`:''}</span><button type="button" className="text-button" disabled={!symbol||history.status==='loading'} onClick={replay.refresh}><ArrowClockwise size={16}/>Refresh history</button></div>
    {history.status==='stale'&&<p className="journal-chart-warning" role="status">{history.message||'The source refresh failed. Showing cached history.'}</p>}
    <p className="journal-help">Entry and exit arrows mark your exact recorded times, including seconds. Their option-premium labels are separate from the underlying price axis. Candles, indicators and dated zones provide strategy context; missing history remains visible as gaps.</p>
  </section>;
}
