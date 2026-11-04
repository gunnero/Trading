import {useEffect,useState} from 'react';
import {ArrowsClockwise} from '@phosphor-icons/react';
import {apiFetch} from './auth-client';
import {useDisplayTime} from './DisplayTime';
import {PORTFOLIO_RANGES} from './data/portfolio-history.mjs';
import {usePortfolioPrivacy} from './PortfolioPrivacy';
import {PortfolioValueChart} from './PortfolioValueChart';

const percent=v=>Number.isFinite(v)?`${v>0?'+':''}${v.toFixed(2)}%`:'—';
async function request(accountId,range,signal,action='',body={}){
  const path=`/api/portfolio/accounts/${accountId}/history${action?'/'+action:'?'+new URLSearchParams({range})}`;
  const res=await apiFetch(path,{signal:AbortSignal.any([signal,AbortSignal.timeout(25000)]),...(action?{method:'POST',headers:{'content-type':'application/json','x-opening-bell-client':'web'},body:JSON.stringify({...body,range})}:{})});
  const result=await res.json();if(!res.ok)throw Error(result.message||'Account history is unavailable.');return result;
}
export function PortfolioHistory({account,watchlist=[]}){
  const {money,hideBalances}=usePortfolioPrivacy();
  const [range,setRange]=useState('MAX'),[state,setState]=useState(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[busy,setBusy]=useState(false);
  const {clockStamp,displayDay,zoneLabel}=useDisplayTime(),key=account.id+'|'+range,snap=account.snapshot;
  useEffect(()=>{
    const controller=new AbortController();let pending=false;
    async function load(){
      if(pending||document.hidden)return;pending=true;setBusy(true);setError('');
      try{
        const accept=result=>{if(!controller.signal.aborted)setState({...result,key});};
        const saved=await request(account.id,range,controller.signal);accept(saved);
        if(account.connected)accept(await request(account.id,range,controller.signal,['loading','paused'].includes(saved.rebuild?.status)?'rebuild/sync':'sync'));
      }catch(e){if(!controller.signal.aborted)setError(e.message||'Account history is unavailable.');}
      finally{pending=false;if(!controller.signal.aborted)setBusy(false);}
    }
    load();const timer=setInterval(load,60000);document.addEventListener('visibilitychange',load);
    return()=>{controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',load);};
  },[key,account.connected,refresh]);
  const data=state?.key===key?state:null,rebuildState=data?.rebuild,r=data?.accountReturn,reported=snap?.source!=='api'&&range==='MAX';
  async function rebuild(){setBusy(true);setError('');try{const result=await request(account.id,range,new AbortController().signal,'rebuild',{listings:watchlist});setState({...result,key});setRefresh(n=>n+1);}catch(e){setError(e.message);}finally{setBusy(false);}}
  const amount=reported?snap.totalReturn:r?.amount,rate=reported?snap.returnPercent:r?.ratePercent,net=reported?snap.netDeposits:r?.netDeposits;
  const points=r?.valuePoints||[],partial=['partial','insufficient'].includes(r?.coverage),tone=amount>0?'green':amount<0?'red':'';
  const partialReturn=partial&&Number.isFinite(amount)&&Number.isFinite(r?.baselineAt);
  const status=error||r?.error||(r?.updating&&!Number.isFinite(amount)?'Calculating return from account history…':r?.reason);
  return <section className="pm-history pm-account-summary" aria-label="Account summary">
    <div className="pm-section-heading"><span className="pm-eyebrow">ACCOUNT VALUE{account.environment==='demo'?' · DEMO':''}</span><button className="icon-button" aria-label="Refresh portfolio history" disabled={busy} onClick={()=>setRefresh(n=>n+1)}><ArrowsClockwise size={17}/></button></div>
    <div className="pm-account-value">{money(snap?.accountValue,snap?.currency)} <small>{snap?.currency}</small></div>
    <dl className="pm-return-pair"><div><dt>{range==='MAX'?'TOTAL RETURN':partialReturn?'RETURN · PARTIAL PERIOD':`${range} RETURN`}</dt><dd className={tone}>{money(amount,snap?.currency)}</dd></div><div><dt>{reported?'REPORTED RETURN RATE':'RETURN RATE'}{Number.isFinite(rate)&&!reported&&<small> · calculated</small>}</dt><dd className={tone}>{percent(rate)}</dd></div></dl>
    <div className="pm-net-deposits"><span>Net deposits</span><strong>{money(net,snap?.currency)}</strong></div>
    {status&&<p className="pm-history-state" role="status">{status}</p>}
    {partial&&<p className="pm-history-state pm-period-coverage" role="status">{partialReturn?`Partial ${range} · Return and rate cover ${clockStamp(r.baselineAt)} to ${clockStamp(r.to)} ${zoneLabel}. Full ${range} history is not available yet.`:'Waiting for two recorded balances in this period and complete funding history to calculate return.'}</p>}
    {r?.estimated&&<p className="pm-history-state" role="status">Estimated return · Uses a reconstructed daily balance at {clockStamp(r.baselineAt)} {zoneLabel}. Daily closing prices can differ from Trading 212’s prices and period boundaries.</p>}
    {hideBalances?<div className="portfolio-privacy-note">Account chart hidden while balances are private.</div>:points.length?<PortfolioValueChart key={key} points={points} currency={snap?.currency}/>:<div className="pm-chart-empty" role="status">{data?'Your account chart builds as balances are recorded.':'Loading account chart…'}</div>}
    <div className="pm-periods" aria-label="Account chart period">{PORTFOLIO_RANGES.map(p=><button key={p} className={range===p?'selected':''} aria-pressed={range===p} onClick={()=>setRange(p)}>{p}</button>)}</div>
    {r?.valuationTrackingFrom&&<p className="pm-history-state">{r.reconstructedFrom?`Estimated daily history from ${displayDay(r.reconstructedFrom)} through ${displayDay(r.reconstructedTo)}; recorded balances from ${displayDay(r.recordedFrom)}`:`Recorded chart from ${displayDay(r.valuationTrackingFrom)}`} · {snap?.fetchedAt?`updated ${clockStamp(snap.fetchedAt)} ${zoneLabel}`:'saved observations'}</p>}
    <div className="pm-cash-row"><span>CASH</span><strong>{money(snap?.cash,snap?.currency)}</strong></div>
    {account.connected&&<details className="pm-history-explainer" open={['loading','paused','blocked','unavailable'].includes(rebuildState?.status)}><summary>Older account history</summary>
      <p>Rebuild estimated daily balances from this account’s full trade, cash and dividend history. Purchases, sales and cash must reconcile with the current account before the chart is added. Your API key needs History: Orders, History: Transactions and History: Dividends read permissions.</p>
      <p>Uses historical daily stock prices from Yahoo Finance. Supports matching account and stock currencies, verified listings, ordinary trades and paired stock splits verified against the price history. Transfers, other corporate actions or missing prices may prevent a reliable rebuild.</p>
      {rebuildState?.pages>0&&<p role="status">{rebuildState.pages} pages saved{Number.isFinite(rebuildState.records)?` · ${rebuildState.records} records`:''} · {rebuildState.priced}{rebuildState.instruments?` of ${rebuildState.instruments}`:''} instruments priced. Progress is saved on the server and survives refreshes.</p>}
      {rebuildState?.status==='loading'?<p role="status">{rebuildState.historyComplete?(rebuildState.stage==='listings'?'Matching historical instruments with Trading 212…':'Transactions saved · checking balances and collecting daily prices. The older chart is still being built.'):'Reading older history…'} Keep this page open; it continues each minute.</p>:<>
        {rebuildState?.status==='paused'&&<p role="status">Import paused. Saved pages will be reused. {rebuildState.retryAt?`Automatic retry after ${clockStamp(rebuildState.retryAt)} ${zoneLabel} while this page is open.`:'It resumes automatically while this page is open.'}</p>}
        {['blocked','unavailable'].includes(rebuildState?.status)&&rebuildState?.canResume&&<p role="status">{rebuildState.historyComplete?(rebuildState.stage==='prices'?'Transactions saved; older chart not ready.':'History import complete. The chart needs additional information before it can be calculated.'):'History import stopped at the next unread page.'} Saved history is retained; retrying will reuse it.</p>}
        <button className="button outline" disabled={busy||rebuildState?.retryAt>Date.now()} onClick={rebuild}>{rebuildState?.canResume?(rebuildState.historyComplete?'Retry using saved history':'Resume history import'):rebuildState?.status==='ready'?'Rebuild history again':'Rebuild older history'}</button>
      </>}
      {data?.rebuild?.message&&<p role="status">{data.rebuild.message}</p>}
      {rebuildState?.listingMessage&&<p role="status">{rebuildState.listingMessage}</p>}
      {rebuildState?.listingChecks?.length>0&&<details open={rebuildState.listingChecks.some(i=>['unmatched','unavailable'].includes(i.status))} className="pm-listing-checks"><summary>Historical instruments · {rebuildState.priced} / {rebuildState.instruments} ready</summary>
        <ul>{rebuildState.listingChecks.map(i=><li key={i.ticker}><strong>{i.name}</strong> · {i.ticker} · {i.currency}<br/>{i.status==='saved'?`Prices saved · ${i.listing||'verified listing'}`:i.status==='pending'?`Waiting for prices · ${i.listing}`:i.status==='unavailable'?`${i.listing} · ${i.message}`:'No exact listing verified. Automatic matching needs the same instrument, currency and exchange; a similar fund is not substituted.'}</li>)}</ul>
      </details>}
      {data?.rebuild?.status==='ready'&&<p>Reconstructed history is available. Estimated points are identified on the chart.</p>}
    </details>}
    <details className="pm-history-explainer"><summary>Return details</summary>
      <dl className="pm-return-breakdown"><div><dt>Open holdings return</dt><dd>{money(snap?.unrealized,snap?.currency)}{snap?.cost>0&&Number.isFinite(snap?.unrealized)?` (${percent(snap.unrealized/snap.cost*100)})`:''}</dd></div><div><dt>Realized trading return</dt><dd>{money(snap?.realized,snap?.currency)}</dd></div><div><dt>Investments / cost of open holdings</dt><dd>{money(snap?.investmentsValue,snap?.currency)} / {money(snap?.cost,snap?.currency)}</dd></div></dl>
      <p>Total return is account value minus net deposits, including cash, dividends, interest and charges reflected in the balance. It is available after funding history finishes loading with History: Transactions permission. Foreign-currency funding or ambiguous transfers can prevent a reliable calculation. {r?.pages?`${r.pages} funding pages checked.`:''} {r?.to?`Return valuation: ${clockStamp(r.to)} ${zoneLabel}.`:''}</p>
      <p>Calculated return rate uses dated deposits and withdrawals to calculate a money-weighted return over the displayed return dates. It is calculated here, not supplied by Trading 212, and may differ from their timing or rounding. Partial-period percentages cover only the recorded part, without projecting or annualizing it. Ambiguous cash-flow patterns or missing data leave the percentage unavailable. Imported snapshot percentages retain their reported basis.</p>
      <p>The chart shows account value, so deposits and withdrawals move the line. Returns exclude those cash movements. 1D is the last 24 hours; 1W is 7 days; 1M, 3M and 1Y are calendar lookbacks; YTD begins January 1 UTC. Earlier account valuations are not supplied directly by the API. Older account history can reconstruct estimated daily balances where complete transactions and verified prices are available. Until a starting balance is available for the full period, return uses the first recorded balance inside that period and is marked partial. Longer ranges can show the same partial return while they share the same recorded history. Full-period returns appear automatically as history builds; MAX uses the available all-time total. {r?.baselineAt?`The starting balance used is from ${clockStamp(r.baselineAt)} ${zoneLabel}${partial?'':'; the nearest recorded observation approximates the period boundary'}.`:''} Net deposits always shows the all-time amount. Snapshots are recorded every 15 minutes, with minute updates while this page is visible.</p>
      <p><a href="https://helpcentre.trading212.com/hc/en-us/articles/22435640547613-Portfolio-Charts" target="_blank" rel="noopener noreferrer">Trading 212’s return definitions ↗</a></p>
    </details>
  </section>;
}
