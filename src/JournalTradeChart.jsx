import {lazy,Suspense,useEffect,useMemo,useState} from 'react';
import {ArrowClockwise,ChartLine,Clock} from '@phosphor-icons/react';
import {apiFetch} from './auth-client';
import {parseWatchlist} from './data/market';
import {localStamp,money,tradeResult,duration} from './data/journal.mjs';
import {TRADE_CHART_FRAMES,tradeListings,tradeDates,executionMarkers} from './data/journal-chart.mjs';

const Canvas=lazy(()=>import('./JournalTradeCanvas'));
const stamp=value=>localStamp(value).replace('T',' · ');
export default function JournalTradeChart({trade,watchText}){
  const listings=useMemo(()=>tradeListings(trade.symbol,parseWatchlist(watchText,{allowEmpty:true})),[trade.symbol,watchText]);
  const [choice,setChoice]=useState(''),[frame,setFrame]=useState('2m'),[retry,setRetry]=useState(0),[response,setResponse]=useState(null);
  const symbol=listings.length===1?listings[0].id:listings.find(row=>row.id===choice)?.id;
  const {from,to}=tradeDates(trade),key=JSON.stringify([symbol,frame,from,to]);
  useEffect(()=>{
    if(!symbol)return;
    const controller=new AbortController();let cancelled=false;
    setResponse({key,status:'loading'});
    apiFetch(`/api/market/trade-history?${new URLSearchParams({symbol,interval:frame,from,to})}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(35000)])})
      .then(async r=>{const data=await r.json();if(!r.ok)throw Error(data.message||'History unavailable.');if(!cancelled)setResponse({...data,key});})
      .catch(e=>{if(!cancelled)setResponse({key,status:'unavailable',message:e.name==='TimeoutError'?'The history request timed out. Try again.':e.message});});
    return()=>{cancelled=true;controller.abort();};
  },[key,retry]);
  const history=response?.key===key?response:{status:'loading'},candles=history.candles||[],markers=executionMarkers(trade,candles,history.observedThrough??0),result=tradeResult(trade);
  return <section className="journal-execution-chart" aria-label="Trade entry and exit chart">
    <div className="journal-execution-summary">
      <article className="entry"><span>ENTRY · {trade.position==='short'?'SELL TO OPEN':'BUY TO OPEN'}</span><strong>{money(trade.entryPrice)} <small>option premium</small></strong><time dateTime={trade.entryAt}>{stamp(trade.entryAt)}</time></article>
      <article className="exit"><span>EXIT · {trade.position==='short'?'BUY TO CLOSE':'SELL TO CLOSE'}</span><strong>{money(trade.exitPrice)} <small>{trade.exitAt?'option premium':'Position open'}</small></strong>{trade.exitAt?<time dateTime={trade.exitAt}>{stamp(trade.exitAt)}</time>:<span>No exit recorded</span>}</article>
      <article><span>GROSS P/L · {trade.quantity} {trade.quantity===1?'CONTRACT':'CONTRACTS'}</span><strong className={result.gross>0?'green':result.gross<0?'red':'muted'}>{money(result.gross)}</strong><small>{trade.exitAt?`${duration(result.seconds)} held · net ${money(result.net)}`:'Open · unmarked'}</small></article>
    </div>
    <div className="journal-execution-heading"><div><h3>{trade.symbol} underlying chart</h3><p>{from===to?from:`${from} – ${to}`} · U.S. regular session · Skopje / 24h</p></div><div role="group" aria-label="Trade chart timeframe">{TRADE_CHART_FRAMES.map(value=><button type="button" key={value} aria-pressed={frame===value} onClick={()=>setFrame(value)}>{value}</button>)}</div></div>
    {listings.length>1&&<label className="journal-listing-choice">Choose the underlying listing<select value={choice} onChange={e=>setChoice(e.target.value)}><option value="">Choose listing</option>{listings.map(row=><option key={row.id} value={row.id}>{row.id}</option>)}</select></label>}
    {!symbol?<div className="journal-chart-empty"><ChartLine size={30}/><strong>{listings.length?'Choose a listing to load its history.':'Underlying listing unavailable'}</strong><span>{!listings.length&&'Add the exact U.S. stock or fund to your watchlist to enable its chart.'}</span></div>:
      candles.length?<Suspense fallback={<div className="journal-chart-empty">Loading chart…</div>}><Canvas key={key} trade={trade} candles={candles} markers={markers} timeframe={frame}/></Suspense>:
      <div className="journal-chart-empty" role="status"><Clock size={28}/><strong>{history.status==='loading'?'Loading trade history…':'Historical chart unavailable'}</strong><span>{history.status==='loading'?'Loading candles for the saved execution dates.':history.message}</span></div>}
    {candles.length>0&&markers.some(m=>!m.available)&&<p className="journal-chart-warning" role="status">{markers.filter(m=>!m.available).map(m=>m.kind==='entry'?'Entry':'Exit').join(' and ')} time has no covering source candle. No marker is drawn for that execution; history may be missing, delayed or outside regular stock hours.</p>}
    <div className="journal-execution-foot"><span>{history.status==='stale'?'Cached history · ':''}Yahoo Finance{history.fetchedAt?` · fetched ${stamp(history.fetchedAt)} Skopje`:''}</span><button type="button" className="text-button" disabled={!symbol||history.status==='loading'} onClick={()=>setRetry(n=>n+1)}><ArrowClockwise size={16}/>Refresh history</button></div>
    {history.status==='stale'&&<p className="journal-chart-warning" role="status">{history.message||'The source refresh failed. Showing cached history.'}</p>}
    <p className="journal-help">Markers show your recorded execution times on the underlying stock or ETF. Candle prices are not your option fill prices; historical option candles are not connected. Missing candles remain gaps. This review uses the saved trade and does not change its executions.</p>
  </section>;
}
