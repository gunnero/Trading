import {useEffect,useState,useId,useRef} from 'react';
import {ArrowsClockwise} from '@phosphor-icons/react';
import {apiFetch} from './auth-client';
import {useDisplayTime} from './DisplayTime';
import {PORTFOLIO_RANGES} from './data/portfolio-history.mjs';

const labels={'1D':'Day','1W':'Week','1M':'Month','1Y':'Year',MAX:'Max'};
const money=(v,c)=>Number.isFinite(v)&&c?new Intl.NumberFormat('en-US',{style:'currency',currency:c,maximumFractionDigits:2}).format(v):'—';
async function request(accountId,range,signal,sync=false){
  const path=`/api/portfolio/accounts/${accountId}/history${sync?'/sync':'?'+new URLSearchParams({range})}`;
  const res=await apiFetch(path,{signal:AbortSignal.any([signal,AbortSignal.timeout(25000)]),...(sync?{method:'POST',headers:{'content-type':'application/json','x-opening-bell-client':'web'},body:JSON.stringify({range})}:{})});
  const result=await res.json();if(!res.ok)throw Error(result.message||'Performance history is unavailable.');return result;
}
export function PortfolioHistory({account}){
  const [range,setRange]=useState('1D'),[mode,setMode]=useState('total'),[state,setState]=useState(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[busy,setBusy]=useState(false);
  const {clockTime,displayDay,zoneLabel}=useDisplayTime(),key=account.id+'|'+range;
  useEffect(()=>{
    const controller=new AbortController();let pending=false;
    async function load(){
      if(pending||document.hidden)return;pending=true;setBusy(true);setError('');
      try{
        const accept=result=>{if(!controller.signal.aborted)setState({...result,key});};
        accept(await request(account.id,range,controller.signal));
        if(account.connected)accept(await request(account.id,range,controller.signal,true));
      }catch(e){if(!controller.signal.aborted)setError(e.message||'Performance history is unavailable.');}
      finally{pending=false;if(!controller.signal.aborted)setBusy(false);}
    }
    load();const timer=setInterval(load,60000);document.addEventListener('visibilitychange',load);
    return()=>{controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',load);};
  },[key,account.connected,refresh]);
  const data=state?.key===key?state:null,result=mode==='total'?data?.sampled:data?.realized,amount=result?.amount;
  const timing=value=>value?`${displayDay(value)} · ${clockTime(value)} ${zoneLabel}`:'—';
  return <section className="pm-history" aria-label="Portfolio profit and loss">
    <div className="pm-section-heading"><div><h3>Profit / loss</h3><p>Trading performance · {account.snapshot?.currency||'account currency'}{account.environment==='demo'?' · DEMO':''}</p></div><button className="icon-button" aria-label="Refresh portfolio history" disabled={busy} onClick={()=>setRefresh(n=>n+1)}><ArrowsClockwise size={17}/></button></div>
    <div className="pm-history-controls"><div className="segmented" aria-label="Profit and loss type"><button aria-pressed={mode==='total'} className={mode==='total'?'selected':''} onClick={()=>setMode('total')}>Open + sold trades</button><button aria-pressed={mode==='realized'} className={mode==='realized'?'selected':''} onClick={()=>setMode('realized')}>Realized trades</button></div><div className="segmented" aria-label="Profit and loss period">{PORTFOLIO_RANGES.map(r=><button key={r} className={range===r?'selected':''} aria-pressed={range===r} onClick={()=>setRange(r)}>{labels[r]}</button>)}</div></div>
    <div className="pm-history-value"><strong className={amount>0?'green':amount<0?'red':''}>{money(amount,data?.currency)}</strong><span>{mode==='total'?(range==='MAX'?'Combined trading return · broker total':result?.coverage==='partial'?'Change since first available observation':`${labels[range]} trading P/L change`):`${labels[range]} realized P/L`}</span></div>
    {!data?<p className="pm-history-state" role="status">{error||'Loading performance history…'}</p>:<>
      {mode==='total'&&<p className="pm-history-state">{result.coverage==='unavailable'?'Connect an account to start recording performance. A screenshot has no historical account valuations.':result.coverage==='insufficient'?'Waiting for another recorded observation. Past open-position values are not provided by the broker.':result.coverage==='partial'?`Partial period · observations begin ${timing(result.baselineAt)}. Earlier open-position values are unavailable.`:result.coverage==='recorded'?`Broker total shown above; chart observations start ${timing(data.trackingFrom)}.`:`Compared with the recorded observation at ${timing(result.baselineAt)}; sampled, not an exact boundary valuation.`}{result.to&&` Latest observation ${timing(result.to)}.`}</p>}
      {mode==='realized'&&<p className="pm-history-state" role="status">{result.error|| (result.mixedCurrencies?'Order history contains different wallet currencies. A combined amount is unavailable without verified conversion.':result.missing?`${result.missing} executions have no supplied realized P/L. This period’s total is unavailable.`:result.status==='unavailable'?(account.connected?'Loading broker order history…':'Connect this account to read historical realized results.'):`${result.count} executions with a supplied result · history checked ${timing(data.fetchedAt)}.`)}{result.updating&&` Reading history · ${result.pages} pages checked. ${data.fetchedAt?'Showing the last completed import.':'Totals appear after all pages are checked.'}`}</p>}
      {error&&<p className="pm-history-state amber" role="status">{error} Showing the last available history.</p>}
      <PerformanceChart key={`${key}|${mode}`} points={result?.points||[]} currency={data.currency}/>
      {mode==='realized'&&result.status==='ready'&&result.amount===0&&!result.count&&<p className="pm-history-state">No realized results in this period.</p>}
    </>}
    <details className="pm-history-explainer"><summary>Period coverage & calculations</summary><p>Day is the last 24 hours; Week is 7 days; Month and Year look back one calendar month or year. Open + sold trades uses changes in the broker’s combined realized and unrealized P/L. Deposits and withdrawals are not counted as trading profit. Max shows the latest broker combined trading return; its chart covers recorded observations only. Snapshots are recorded every 15 minutes in the background and refreshed each minute while this page is visible. Historical valuations before tracking began are unavailable.</p><p>Realized trades uses each execution’s broker-reported realized result after the full order history has loaded. It requires History: Orders read permission. Amounts exclude dividends, interest and any charges not included in the broker’s P/L fields. Period percentages need historical invested capital and cash flows, which this connection does not provide.</p></details>
  </section>;
}
function PerformanceChart({points,currency}){
  const [index,setIndex]=useState(null),[width,setWidth]=useState(1000),ref=useRef(null),id=useId(),{clockStamp,clockTime,displayDay}=useDisplayTime();
  useEffect(()=>{if(!ref.current)return;const observer=new ResizeObserver(()=>setWidth(Math.max(240,ref.current.clientWidth)));observer.observe(ref.current);return()=>observer.disconnect();},[points.length>0]);
  if(!points.length)return null;
  const low=Math.min(...points.map(p=>p.value)),high=Math.max(...points.map(p=>p.value)),padding=Math.max(1,(high-low)*.12),min=low-padding,max=high+padding;
  const start=points[0].at,end=points.at(-1).at,x=p=>60+(end===start?0.5:(p.at-start)/(end-start))*(width-100),y=p=>175-(p.value-min)/(max-min)*155;
  const selected=Math.min(index??points.length-1,points.length-1),chosen=points[selected],line=points.map(p=>`${x(p)},${y(p)}`).join(' '),color=points.at(-1).value>=0?'#27cbb0':'#f46f73';
  return <div ref={ref} className="pm-performance-chart"><div className="pm-history-readout" aria-live="polite">{clockStamp(chosen.at)} <b>{money(chosen.value,currency)}</b></div><svg viewBox={`0 0 ${width} 210`} role="img" aria-labelledby={id} onPointerMove={e=>{const rect=e.currentTarget.getBoundingClientRect(),at=start+Math.max(0,Math.min(1,((e.clientX-rect.left)/rect.width*width-60)/(width-100)))*(end-start);let nearest=0;points.forEach((p,i)=>{if(Math.abs(p.at-at)<Math.abs(points[nearest].at-at))nearest=i;});setIndex(nearest);}}><title id={id}>Profit and loss from {points.length} recorded observations</title>{[min,(min+max)/2,max].map(v=><g key={v}><line x1="60" x2={width-40} y1={y({value:v})} y2={y({value:v})} stroke="#26383f"/><text x="50" y={y({value:v})+4} textAnchor="end" fill="#9aafb9" fontSize="11">{new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(v)}</text></g>)}<polyline points={line} fill="none" stroke={color} strokeWidth="2"/><circle cx={x(chosen)} cy={y(chosen)} r="4" fill={color}/><text x="60" y="204" fill="#9aafb9" fontSize="11">{displayDay(start)===displayDay(end)?clockTime(start):displayDay(start)}</text><text x={width-40} y="204" textAnchor="end" fill="#9aafb9" fontSize="11">{displayDay(start)===displayDay(end)?clockTime(end):displayDay(end)}</text></svg>{points.length>1&&<input type="range" aria-label="Performance chart observation" min="0" max={points.length-1} value={selected} onChange={e=>setIndex(+e.target.value)}/>}</div>;
}
