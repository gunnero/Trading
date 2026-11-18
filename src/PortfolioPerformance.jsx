import {useId,useState} from 'react';
import {ArrowsClockwise,CalendarBlank,Info,LockKey} from '@phosphor-icons/react';
import {PageHeader} from './PageHeader';
import {useDisplayTime} from './DisplayTime';
import {PortfolioPrivacyControls,usePortfolioPrivacy} from './PortfolioPrivacy';
import {portfolioPercent,portfolioTone,usePortfolioResource} from './PortfolioTools';
import PortfolioPerformanceChart from './PortfolioPerformanceChart';
import './portfolio-performance.css';

function Contributions({data}){
  const privacy=usePortfolioPrivacy();
  return <section className="perf-contributions"><h2>Stock return contributions</h2>
    {data.rows.length?<div className="perf-table-wrap"><table aria-label="Stock return contributions across all imported history">
      <thead><tr>{['Ticker','Currency','Open return','Realized return','Combined return'].map(label=><th key={label} scope="col">{label}</th>)}</tr></thead>
      <tbody>{data.rows.map(row=><tr key={row.ticker+':'+row.currency}>
        <th scope="row" title={row.name+' · '+row.ticker}>{row.ticker.replace(/_US_EQ$/,'')}<span className="perf-sr"> · {row.name}</span>{row.missing>0&&<small>{row.missing} sales without a result</small>}</th>
        <td>{row.currency}</td>{['open','realized','total'].map(key=><td key={key} className={privacy.hideBalances?'':portfolioTone(row[key])}>
          {row[key]>0&&!privacy.hideBalances?'+':''}{privacy.money(row[key],row.currency)}</td>)}</tr>)}</tbody></table></div>:<p>No holdings or executions available.</p>}
  </section>;
}

function PerformanceDetails({data,benchmark}){
  const {journalStamp,zoneLabel}=useDisplayTime(),{comparison,index,drawdown}=data;
  return <details className="perf-details"><summary>Calculation &amp; coverage details</summary>
    <p>The account return uses linked Modified Dietz estimates to adjust for dated deposits and withdrawals. It includes cash, income and fees reflected in account value. Trading 212’s money-weighted return can differ. <a href="https://www.gipsstandards.org/standards/gips-standards-for-firms/gips-standards-handbook-for-firms/" target="_blank" rel="noreferrer">Return calculation reference</a></p>
    {index.start&&<p>Account observations · {journalStamp(index.start)} – {journalStamp(index.end)} {zoneLabel}. Peaks between observations can be missed.
      {drawdown?.peakAt?' The largest decline began '+journalStamp(drawdown.peakAt)+' and reached its low '+journalStamp(drawdown.troughAt)+'. '+(drawdown.recoveredAt?'Recovery took '+drawdown.recoveryDays.toFixed(1)+' days, through '+journalStamp(drawdown.recoveredAt)+'.':'Recovery has not been observed.'):' No decline observed.'}</p>}
    {!comparison.reason&&<p>Shared interval returns · Account {portfolioPercent(comparison.ratePercent)} · {benchmark} {portfolioPercent(comparison.benchmarkPercent)}. Benchmark closes span {journalStamp(comparison.benchmarkStart)} – {journalStamp(comparison.benchmarkEnd)} {zoneLabel}. Each matched account observation follows the corresponding close by at most 24 hours. Missing closes are skipped.</p>}
    <p>Contributions cover all imported history. Amounts combine current open profit or loss and reported realized sales for each broker ticker and currency. Cash interest and unallocated income or fees are excluded.</p>
  </details>;
}

function PerformanceResults({account,range,benchmark,accountView}){
  const resource=usePortfolioResource('insights/performance?'+new URLSearchParams({account:account.id,range,benchmark}));
  const {clockDate,settings}=useDisplayTime(),data=resource.data;
  const days=data?.drawdown?.underwaterDays;
  return <><section className="perf-results"><h2>Performance &amp; drawdown</h2>
    {resource.error&&<p className="amber" role="alert">{resource.error}</p>}
    {!data&&!resource.error&&<p role="status">Loading performance…</p>}
    {data&&<>{data.index.reason?<p className="perf-empty">{data.index.reason}</p>:<dl className="perf-metrics">
      {[['Account return estimate',data.index.ratePercent],['Current drawdown',data.drawdown?.currentPercent],['Largest observed drawdown',data.drawdown?.maxPercent]].map(([label,value])=><div key={label}><dt>{label}</dt><dd className={portfolioTone(value)}>{portfolioPercent(value)}</dd></div>)}
      <div><dt>Time below peak</dt><dd>{Number.isFinite(days)?days.toLocaleString('en-US',{maximumFractionDigits:1})+(days===1?' day':' days'):'—'}</dd></div>
    </dl>}
    {data.comparison.reason?<p className="perf-empty">{data.comparison.reason}</p>:<PortfolioPerformanceChart comparison={data.comparison} benchmark={benchmark}/>}</>}
  </section>
    {data&&<><Contributions data={data.contributions}/>
      <footer className="perf-coverage">{data.index.start&&<span><CalendarBlank aria-hidden="true" size={17}/>{data.index.estimated?'Recorded / reconstructed observations':'Observed interval'} · {clockDate(data.index.start)} – {clockDate(data.index.end)} ({settings.timeZone})</span>}
        <span><Info aria-hidden="true" size={17}/>{data.contributions.complete?'Contributions cover all imported executions.':'Incomplete execution history. Earlier realized returns may be missing.'}</span></footer>
      <PerformanceDetails data={data} benchmark={benchmark}/></>}
    <button className="text-button perf-refresh" disabled={resource.busy||accountView.busy} onClick={()=>{resource.refresh();accountView.refresh();}}><ArrowsClockwise aria-hidden="true" size={15}/>Refresh account view</button>
  </>;
}

export default function PortfolioPerformance({accounts,account,selectAccount,view,navigation,onJournal}){
  const privacy=usePortfolioPrivacy(),privacyId=useId();
  const [range,setRange]=useState('1M'),[benchmark,setBenchmark]=useState('SPY'),[showPrivacy,setShowPrivacy]=useState(false);
  const filters=<div className="perf-filters"><label>Account<select aria-label="Planning account" value={account?.id||''} disabled={!accounts.length} onChange={e=>selectAccount(e.target.value)}>
    {!accounts.length&&<option value="">Choose an account</option>}{accounts.map(a=><option key={a.id} value={a.id}>{[privacy.person(a.person),privacy.label(a.label,a.id),a.currency,a.environment==='demo'?'DEMO':null].filter(Boolean).join(' · ')}</option>)}</select></label>
    <label>Range<select aria-label="Performance range" value={range} onChange={e=>setRange(e.target.value)}>{['1M','3M','YTD','1Y','MAX'].map(v=><option key={v} value={v}>{v==='YTD'?'YTD (UTC)':v}</option>)}</select></label>
    <label>Benchmark<select aria-label="Benchmark" value={benchmark} onChange={e=>setBenchmark(e.target.value)}><option>SPY</option><option>QQQ</option></select></label></div>;
  return <section className="planning-view perf-view" aria-label="Portfolio planning"><PageHeader title="Portfolio insights" actions={filters}/>{navigation}
    {view.error&&<p role="alert" className="amber">{view.error}</p>}{account?<PerformanceResults key={account.id} account={account} range={range} benchmark={benchmark} accountView={view}/>:<p role="status">{view.error?'Account data unavailable.':view.data?'Add an account in Portfolio Manager to get started.':'Loading accounts…'}</p>}
    <div className="perf-tools"><button className="text-button" aria-expanded={showPrivacy} aria-controls={privacyId} onClick={()=>setShowPrivacy(!showPrivacy)}><LockKey aria-hidden="true" size={15}/>Privacy settings</button>
      {!account&&<button className="text-button" onClick={view.refresh} disabled={view.busy}>Refresh account view</button>}<button className="text-button" onClick={onJournal}>Broker trade journal</button></div>
    <div id={privacyId} hidden={!showPrivacy}>{showPrivacy&&<PortfolioPrivacyControls/>}</div>
  </section>;
}
