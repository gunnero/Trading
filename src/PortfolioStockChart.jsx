import {useEffect,useState} from 'react';
import {apiFetch} from './auth-client';
import {useDisplayTime} from './DisplayTime';
import {quoteKey} from './data/quotes.mjs';
import {portfolioAverageLine} from './data/portfolio-listings.mjs';
import {PortfolioValueChart} from './PortfolioValueChart';
const periods=['1D','1W','1M','3M','1Y','MAX'];
const money=(v,c)=>Number.isFinite(v)&&c?new Intl.NumberFormat('en-US',{style:'currency',currency:c,maximumFractionDigits:2}).format(v):'—';
export function PortfolioStockChart({entry,position,instrument,sheetDate}){
  const symbol=quoteKey(entry),[range,setRange]=useState('1D'),[state,setState]=useState(null),[levels,setLevels]=useState(false),[average,setAverage]=useState(true),key=symbol+'|'+range;
  const {clockStamp,displayDay,zoneLabel}=useDisplayTime();
  useEffect(()=>{
    const controller=new AbortController();let pending=false;
    async function load(){if(pending||document.hidden)return;pending=true;try{
      const res=await apiFetch('/api/market/price-history?'+new URLSearchParams({symbol,range}),{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(25000)])});if(!res.ok)throw Error();
      const body=await res.json();if(body.symbol!==symbol||body.range!==range||!['ok','stale','unavailable'].includes(body.status))throw Error();
      if(!controller.signal.aborted)setState({...body,key});
    }catch{if(!controller.signal.aborted)setState(s=>s?.key===key&&s.points?.length?{...s,status:'stale',message:'Refresh unavailable. Showing the last reading.'}:{key,status:'unavailable',message:'Price history is temporarily unavailable.'});}finally{pending=false;}}
    load();const timer=setInterval(load,60000);document.addEventListener('visibilitychange',load);return()=>{controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',load);};
  },[key]);
  const data=state?.key===key?state:null,q=data?.quote,line=portfolioAverageLine(position.holding,q,entry),change=data?.change;
  return <section className="pm-stock-chart" aria-label={`${entry.symbol} price history`}>
    <span className="pm-eyebrow">{entry.exchange} · {entry.symbol} · SHARE PRICE</span>
    <div className="pm-account-value">{money(q?.price,q?.currency)} <small>{q?.currency}</small></div>
    <p className={`pm-stock-change ${change>0?'green':change<0?'red':''}`}>{money(change,q?.currency)}{Number.isFinite(data?.changePercent)?` (${change>0?'+':''}${data.changePercent.toFixed(2)}%)`:''} <small>{range==='1D'?'last regular session':range==='MAX'?'since first available price':`over available ${range} history`}</small></p>
    {data?.points?.length?<PortfolioValueChart key={key} points={data.points} currency={q.currency} title={`${entry.symbol} share price history`} reference={average?line:null} levels={levels&&line?instrument?.zones:[]}/>:<div className="pm-chart-empty" role="status">{data?.message||'Loading stock price chart…'}</div>}
    <div className="pm-periods" aria-label="Stock chart period">{periods.map(p=><button key={p} aria-pressed={range===p} className={range===p?'selected':''} onClick={()=>setRange(p)}>{p}</button>)}</div>
    <div className="pm-stock-overlays"><label><input type="checkbox" checked={average} disabled={!line} onChange={e=>setAverage(e.target.checked)}/>Average price</label><label><input type="checkbox" checked={levels} disabled={!instrument||!line} onChange={e=>setLevels(e.target.checked)}/>Your levels</label></div>
    <p className="pm-history-state">{data?.status==='stale'?'Cached / old · ':''}Yahoo Finance · regular-session prices · may be delayed{data?.to?` · ${clockStamp(data.to)} ${zoneLabel}`:''}{data?.from?` · history from ${displayDay(data.from)}`:''}. This is the stock’s price change.</p>
    {levels&&instrument&&<p className="pm-history-state">Levels: {instrument.sourceDate||sheetDate} · {instrument.timeframe} · visible price range. Open Advanced chart & levels for the full chart.</p>}
    {q&&!line&&<p className="pm-history-state">Average price and levels are hidden because the chart’s listing or currency does not match this holding.</p>}
  </section>;
}
