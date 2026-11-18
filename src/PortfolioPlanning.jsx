import {useEffect,useState} from 'react';
import {usePortfolioPrivacy} from './PortfolioPrivacy';
import {useDisplayTime} from './DisplayTime';
import PortfolioHoldingsCalendar from './PortfolioHoldingsCalendar';
import PortfolioAllocation from './PortfolioAllocation';
import PortfolioPerformance from './PortfolioPerformance';
import PortfolioMonitor from './PortfolioMonitor';
import {activityRequest} from './PortfolioNotifications';
import {usePortfolioResource,downloadPortfolioCsv} from './PortfolioTools';
import {reportCsv} from './data/portfolio-insights.mjs';
import {annualTotals} from './data/portfolio-planning.mjs';

export default function PortfolioPlanning({tab,navigation,onJournal}){
  const privacy=usePortfolioPrivacy(),view=usePortfolioResource('insights/planning'),[selected,setSelected]=useState(privacy.account||'');
  const accounts=view.data?.accounts||[],a=accounts.find(a=>a.id===selected)||accounts[0];
  if(tab==='monitor')return <PortfolioMonitor accounts={accounts} account={a} selectAccount={setSelected} view={view} navigation={navigation} onJournal={onJournal}/>;
  if(tab==='allocation')return <PortfolioAllocation accounts={accounts} account={a} selectAccount={setSelected} view={view} navigation={navigation} onJournal={onJournal}/>;
  if(tab==='performance')return <PortfolioPerformance accounts={accounts} account={a} selectAccount={setSelected} view={view} navigation={navigation} onJournal={onJournal}/>;
  return <PortfolioHoldingsCalendar accounts={accounts} account={a} selectAccount={setSelected} view={view} navigation={navigation} onJournal={onJournal}/>;
}
export function AnnualReport(){
  const privacy=usePortfolioPrivacy(),{settings,journalStamp}=useDisplayTime(),[year,setYear]=useState(String(new Date().getFullYear())),[person,setPerson]=useState(''),[people,setPeople]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const filters={year,person,timeZone:settings.timeZone},query=new URLSearchParams(filters).toString(),view=usePortfolioResource('insights/reports?'+query),data=view.data;
  useEffect(()=>{if(data)setPeople(data.people);},[data]);
  useEffect(()=>{let active=true,running=false;const update=async()=>{if(document.hidden||running)return;running=true;setBusy(true);try{await activityRequest('insights/reports/refresh',{year,person,timeZone:settings.timeZone});if(active){setError('');await view.refresh();}}catch(e){if(active)setError(e.message);}finally{running=false;if(active)setBusy(false);}};update();const timer=setInterval(update,60000);return()=>{active=false;clearInterval(timer);};},[query,view.refresh]);
  return <section className="panel pi-panel" aria-label="Annual accountant export"><header className="pi-heading"><div><h2>Annual accountant export</h2><p>Executions, reported results, distributions, interest and charges grouped by account and currency.</p></div><button className="button outline" disabled={!data||privacy.privateMode} onClick={()=>downloadPortfolioCsv(reportCsv(data),`portfolio-accountant-${year}.csv`)}>Export annual CSV</button></header><div className="pi-report-filters"><label>Year<input type="number" min="1900" max={new Date().getFullYear()} value={year} onChange={e=>setYear(e.target.value)}/></label><label>Report person<select aria-label="Report person" value={person} onChange={e=>setPerson(e.target.value)}><option value="">Everyone</option>{people.map(p=><option key={p.id} value={p.id}>{privacy.person(p.name)}</option>)}</select></label><button className="button outline" disabled={view.busy} onClick={view.refresh}>Refresh export data</button></div><p role="status">{busy?'Updating broker history…':'Using the latest completed imports.'}</p>{(error||view.error)&&<p role="alert" className="amber">{error||view.error}</p>}
    <p className="pi-help">The export covers the selected calendar year in {settings.timeZone}, with UTC timestamps on each record. It includes all imported executions in that year, not just the journal’s current page. Missing history is marked in the file. Amounts retain their currencies; no tax liability or local tax cost basis is calculated.</p>
    {!data?<p>Loading annual records…</p>:data.accounts.map(a=>{const totals=annualTotals(a);return <article className="pi-report-account" key={a.id}><h3>{privacy.person(a.person)} · {privacy.label(a.label,a.id)}{a.environment==='demo'?' · DEMO':''}</h3><p>{a.trades.length} executions · {a.income.length} distributions · {a.funding.length} cash movements</p><div className="pi-report-table"><table><thead><tr><th>Currency</th><th>Realized P/L</th><th>Distributions</th><th>Interest</th><th>Execution charges</th><th>Cash fees (signed)</th></tr></thead><tbody>{totals.currencies.map(t=><tr key={t.currency}><td>{t.currency}</td>{['realized','distributions','interest','charges','cashFees'].map(k=><td key={k}>{privacy.money(t[k],t.currency)}</td>)}</tr>)}</tbody></table></div><p className="pi-help">{totals.missingResults} sales without a supplied result · {totals.missingCharges} executions without supplied charges. Summaries are subtotals of supplied records; refer to the detailed CSV.</p>{a.warnings.map((w,i)=><p className="amber" key={i}>{w}</p>)}<p className="pi-help">Checked through: funding {a.coverage.funding?journalStamp(a.coverage.funding):'unavailable'} · executions {a.coverage.trades?journalStamp(a.coverage.trades):'unavailable'} · distributions {a.coverage.income?journalStamp(a.coverage.income):'unavailable'}.</p></article>;})}
  </section>;
}
