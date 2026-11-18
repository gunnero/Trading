import {useDisplayTime} from './DisplayTime';
import {lazy,Suspense} from 'react';
import {ChartLine,Clock} from '@phosphor-icons/react';
import {TRADE_CHART_FRAMES} from './data/journal-chart.mjs';

const Canvas=lazy(()=>import('./JournalTradeCanvas'));
export default function JournalTradeChart({trade,replay}){
  const {zoneLabel,formatLabel}=useDisplayTime();
  const {listings,choice,setChoice,symbol,frame,setFrame,history,candles,markers,levels}=replay;
  const {day:from,to}=replay.dates;
  return <section className="journal-execution-chart" aria-label="Trade entry and exit chart">
    <div className="journal-execution-heading"><div><h3>Underlying price replay <small>· {trade.symbol}</small></h3><p>{from===to?from:`${from} – ${to}`} · {history.provider||'Yahoo Finance'} · {zoneLabel} / {formatLabel}</p></div><div role="group" aria-label="Trade chart timeframe">{TRADE_CHART_FRAMES.map(value=><button type="button" key={value} aria-pressed={frame===value} onClick={()=>setFrame(value)}>{value}</button>)}</div></div>
    {listings.length>1&&<label className="journal-listing-choice">Choose the underlying listing<select value={choice} onChange={e=>setChoice(e.target.value)}><option value="">Choose listing</option>{listings.map(row=><option key={row.id} value={row.id}>{row.id}</option>)}</select></label>}
    {!symbol?<div className="journal-chart-empty"><ChartLine size={30}/><strong>{listings.length?'Choose a listing to load its history.':'Underlying listing unavailable'}</strong><span>{!listings.length&&'Add the exact U.S. stock or fund to your watchlist to enable its chart.'}</span></div>:
      candles.length?<Suspense fallback={<div className="journal-chart-empty">Loading chart…</div>}><Canvas key={history.key} trade={trade} candles={candles} markers={markers} timeframe={frame} levels={levels} observedThrough={history.observedThrough}/></Suspense>:
      <div className="journal-chart-empty" role="status"><Clock size={28}/><strong>{history.status==='loading'?'Loading trade history…':'Historical chart unavailable'}</strong><span>{history.status==='loading'?'Loading candles for the saved execution dates.':history.message}</span></div>}
    {candles.length>0&&markers.some(m=>!m.available)&&<p className="journal-chart-warning" role="status">{markers.filter(m=>!m.available).map(m=>m.kind==='entry'?'Entry':'Exit').join(' and ')} time has no covering source candle. No marker is drawn for that execution; history may be missing, delayed or outside regular stock hours.</p>}
    {history.status==='stale'&&<p className="journal-chart-warning" role="status">{history.message||'The source refresh failed. Showing cached history.'}</p>}
    <p className="journal-help">Candles show the underlying share price. Entry and exit mark the times of your saved option fills.</p>
  </section>;
}
