import {useEffect,useState} from 'react';
import {ArrowsClockwise} from '@phosphor-icons/react';
import {apiFetch} from './auth-client';
import {useDisplayTime} from './DisplayTime';
import {PORTFOLIO_RANGES} from './data/portfolio-history.mjs';
import {PortfolioValueChart} from './PortfolioValueChart';

const money=(v,c)=>Number.isFinite(v)&&c?new Intl.NumberFormat('en-US',{style:'currency',currency:c,maximumFractionDigits:2}).format(v):'—';
const percent=v=>Number.isFinite(v)?`${v>0?'+':''}${v.toFixed(2)}%`:'—';
async function request(accountId,range,signal,sync=false){
  const path=`/api/portfolio/accounts/${accountId}/history${sync?'/sync':'?'+new URLSearchParams({range})}`;
  const res=await apiFetch(path,{signal:AbortSignal.any([signal,AbortSignal.timeout(25000)]),...(sync?{method:'POST',headers:{'content-type':'application/json','x-opening-bell-client':'web'},body:JSON.stringify({range})}:{})});
  const result=await res.json();if(!res.ok)throw Error(result.message||'Account history is unavailable.');return result;
}
export function PortfolioHistory({account}){
  const [range,setRange]=useState('MAX'),[state,setState]=useState(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[busy,setBusy]=useState(false);
  const {clockStamp,displayDay,zoneLabel}=useDisplayTime(),key=account.id+'|'+range,snap=account.snapshot;
  useEffect(()=>{
    const controller=new AbortController();let pending=false;
    async function load(){
      if(pending||document.hidden)return;pending=true;setBusy(true);setError('');
      try{
        const accept=result=>{if(!controller.signal.aborted)setState({...result,key});};
        accept(await request(account.id,range,controller.signal));
        if(account.connected)accept(await request(account.id,range,controller.signal,true));
      }catch(e){if(!controller.signal.aborted)setError(e.message||'Account history is unavailable.');}
      finally{pending=false;if(!controller.signal.aborted)setBusy(false);}
    }
    load();const timer=setInterval(load,60000);document.addEventListener('visibilitychange',load);
    return()=>{controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',load);};
  },[key,account.connected,refresh]);
  const data=state?.key===key?state:null,r=data?.accountReturn,reported=snap?.source!=='api'&&range==='MAX';
  const amount=reported?snap.totalReturn:r?.amount,rate=reported?snap.returnPercent:r?.ratePercent,net=reported?snap.netDeposits:r?.netDeposits;
  const points=r?.valuePoints||[],partial=['partial','insufficient'].includes(r?.coverage),tone=amount>0?'green':amount<0?'red':'';
  const status=error||r?.error||(r?.updating&&!Number.isFinite(amount)?'Calculating return from account history…':r?.reason)||(partial?'Return for this period is not available yet. Earlier account values were not supplied.':null);
  return <section className="pm-history pm-account-summary" aria-label="Account summary">
    <div className="pm-section-heading"><span className="pm-eyebrow">ACCOUNT VALUE{account.environment==='demo'?' · DEMO':''}</span><button className="icon-button" aria-label="Refresh portfolio history" disabled={busy} onClick={()=>setRefresh(n=>n+1)}><ArrowsClockwise size={17}/></button></div>
    <div className="pm-account-value">{money(snap?.accountValue,snap?.currency)} <small>{snap?.currency}</small></div>
    <dl className="pm-return-pair"><div><dt>{range==='MAX'?'TOTAL RETURN':`${range} RETURN`}</dt><dd className={tone}>{money(amount,snap?.currency)}</dd></div><div><dt>{reported?'REPORTED RETURN RATE':'RETURN RATE'}{Number.isFinite(rate)&&!reported&&<small> · calculated</small>}</dt><dd className={tone}>{percent(rate)}</dd></div></dl>
    <div className="pm-net-deposits"><span>Net deposits</span><strong>{money(net,snap?.currency)}</strong></div>
    {status&&<p className="pm-history-state" role="status">{status}</p>}
    {points.length?<PortfolioValueChart key={key} points={points} currency={snap?.currency}/>:<div className="pm-chart-empty" role="status">{data?'Your account chart builds as balances are recorded.':'Loading account chart…'}</div>}
    <div className="pm-periods" aria-label="Account chart period">{PORTFOLIO_RANGES.map(p=><button key={p} className={range===p?'selected':''} aria-pressed={range===p} onClick={()=>setRange(p)}>{p}</button>)}</div>
    {r?.valuationTrackingFrom&&<p className="pm-history-state">Recorded chart from {displayDay(r.valuationTrackingFrom)} · {snap?.fetchedAt?`updated ${clockStamp(snap.fetchedAt)} ${zoneLabel}`:'saved observations'}</p>}
    <div className="pm-cash-row"><span>CASH</span><strong>{money(snap?.cash,snap?.currency)}</strong></div>
    <details className="pm-history-explainer"><summary>Return details</summary>
      <dl className="pm-return-breakdown"><div><dt>Open holdings return</dt><dd>{money(snap?.unrealized,snap?.currency)}{snap?.cost>0&&Number.isFinite(snap?.unrealized)?` (${percent(snap.unrealized/snap.cost*100)})`:''}</dd></div><div><dt>Realized trading return</dt><dd>{money(snap?.realized,snap?.currency)}</dd></div><div><dt>Investments / cost of open holdings</dt><dd>{money(snap?.investmentsValue,snap?.currency)} / {money(snap?.cost,snap?.currency)}</dd></div></dl>
      <p>Total return is account value minus net deposits, including cash, dividends, interest and charges reflected in the balance. It is available after funding history finishes loading with History: Transactions permission. Foreign-currency funding or ambiguous transfers can prevent a reliable calculation. {r?.pages?`${r.pages} funding pages checked.`:''} {r?.to?`Return valuation: ${clockStamp(r.to)} ${zoneLabel}.`:''}</p>
      <p>Calculated return rate uses dated deposits and withdrawals to calculate a money-weighted return over the selected period. It is calculated here, not supplied by Trading 212, and may differ from their timing or rounding. Ambiguous cash-flow patterns or missing data leave the percentage unavailable. Imported snapshot percentages retain their reported basis.</p>
      <p>The chart shows account value, so deposits and withdrawals move the line. Returns exclude those cash movements. 1D is the last 24 hours; 1W is 7 days; 1M, 3M and 1Y are calendar lookbacks; YTD begins January 1 UTC. Earlier account valuations are not supplied by the API. A period’s return needs a recorded starting value; MAX uses the available all-time total. {r?.baselineAt?`The starting balance used is from ${clockStamp(r.baselineAt)} ${zoneLabel}; the nearest recorded observation approximates the period boundary.`:''} Net deposits always shows the all-time amount. Snapshots are recorded every 15 minutes, with minute updates while this page is visible.</p>
      <p><a href="https://helpcentre.trading212.com/hc/en-us/articles/22435640547613-Portfolio-Charts" target="_blank" rel="noopener noreferrer">Trading 212’s return definitions ↗</a></p>
    </details>
  </section>;
}
