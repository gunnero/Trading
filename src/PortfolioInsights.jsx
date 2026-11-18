import {usePortfolioPrivacy,PortfolioPrivacyControls} from './PortfolioPrivacy';
import {useEffect,useState} from 'react';
import {DownloadSimple,Printer} from '@phosphor-icons/react';
import PortfolioPriceAlerts from './PortfolioPriceAlerts';
import PortfolioExposure from './PortfolioExposure';
import {PageHeader,useSectionNavigation} from './PageHeader';
import {useDisplayTime} from './DisplayTime';
import {activityRequest} from './PortfolioNotifications';
import {reportCsv} from './data/portfolio-insights.mjs';
import {portfolioPercent as percent,portfolioTone as tone,usePortfolioResource,downloadPortfolioCsv} from './PortfolioTools';
import './portfolio-insights.css';
import PortfolioPlanning,{AnnualReport} from './PortfolioPlanning';

export default function PortfolioInsights({watchlist,tab='exposure',onTab,onPortfolios,onJournal}){
  const exposure=tab==='exposure';
  const planning=['monitor','allocation','performance','calendar'].includes(tab);
  const tabNav=useSectionNavigation(tab);
  const tabs=<nav ref={tabNav} className="pi-tabs" aria-label="Portfolio insight sections">{[['exposure','Combined exposure'],['monitor','Monitor'],['allocation','Target allocations'],['performance','Performance'],['calendar','Holdings calendar'],['alerts','Price alerts'],['reports','Monthly reports'],['annual','Annual export']].map(([id,label])=><button key={id} aria-current={tab===id?'page':undefined} onClick={()=>onTab(id)}>{label}</button>)}</nav>;
  if(tab==='alerts')return <div className="pi-page compact-planning-page"><PortfolioPriceAlerts navigation={tabs} onJournal={onJournal} onPortfolios={onPortfolios}/></div>;
  const navigation=planning?tabs:<><PageHeader title={exposure?'Portfolio Manager':'Portfolio insights'}
    description={exposure?undefined:'Account monitoring, allocation plans, performance and reports.'}
    actions={!exposure&&<><button className="button outline" onClick={onJournal}>Broker trade journal</button>{onPortfolios&&<button className="button outline" onClick={onPortfolios}>Portfolios</button>}</>}/>
    {!exposure&&<PortfolioPrivacyControls/>}{tabs}</>;
  return <div className={'pi-page'+(exposure?' pi-exposure-page':planning?' compact-planning-page':'')}>
    {planning?<PortfolioPlanning tab={tab} navigation={navigation} onJournal={onJournal}/>:<>{navigation}
      {tab==='annual'?<AnnualReport/>:tab==='reports'?<MonthlyReports/>:<PortfolioExposure watchlist={watchlist} onJournal={onJournal} onPortfolios={onPortfolios}/>}</>}
  </div>;
}
function MonthlyReports(){
  const privacy=usePortfolioPrivacy(),{money,number}=privacy;
  const {settings,journalStamp,zoneLabel}=useDisplayTime(),[month,setMonth]=useState(()=>new Intl.DateTimeFormat('en-CA',{timeZone:settings.timeZone,year:'numeric',month:'2-digit'}).format(Date.now())),[person,setPerson]=useState(''),[people,setPeople]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const filters={month,person,timeZone:settings.timeZone},query=new URLSearchParams(filters).toString(),view=usePortfolioResource('insights/reports?'+query),data=view.data;
  useEffect(()=>{if(data)setPeople(data.people);},[data]);
  // Resume paginated imports while the report is visible. The server applies
  // per-account backoff; this does not change holdings or broker orders.
  useEffect(()=>{let active=true,running=false;const refresh=async()=>{if(document.hidden||running)return;running=true;if(active)setBusy(true);try{await activityRequest('insights/reports/refresh',{month,person,timeZone:settings.timeZone});if(active){setError('');await view.refresh();}}catch(e){if(active)setError(e.message);}finally{running=false;if(active)setBusy(false);}};refresh();const timer=setInterval(refresh,60000);return()=>{active=false;clearInterval(timer);};},[query,view.refresh]);
  return <section className="panel pi-panel pi-report" aria-label="Monthly account reports"><header className="pi-heading"><div><h2>Monthly account report</h2><p>Account-wide return, executions, charges and cash movements.</p></div><div className="pi-actions pi-no-print"><button className="button outline" disabled={!data||privacy.privateMode} onClick={()=>downloadPortfolioCsv(reportCsv(data),`portfolio-report-${month}.csv`)}><DownloadSimple size={16}/>Export CSV</button><button className="button outline" disabled={!data||privacy.privateMode} onClick={()=>{const details=[...document.querySelectorAll('.pi-report-details')],states=details.map(d=>d.open);details.forEach(d=>d.open=true);window.print();details.forEach((d,i)=>d.open=states[i]);}}><Printer size={16}/>Print / PDF</button></div></header>
    <div className="pi-report-filters pi-no-print"><label>Month<input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label><label>Person<select aria-label="Person" value={person} onChange={e=>setPerson(e.target.value)}><option value="">Everyone</option>{people.map(p=><option key={p.id} value={p.id}>{privacy.person(p.name)}</option>)}</select></label><button className="button outline" disabled={view.busy} onClick={view.refresh}>Refresh report</button><span role="status">{busy?'Updating broker history…':'Saved history'} · {zoneLabel}</span></div>
    {(error||view.error)&&<p role="alert" className="amber">{error||view.error}</p>}{!data?<p role="status">Loading monthly report…</p>:<><p className="pi-help">{month} · {zoneLabel} · generated {journalStamp(data.generatedAt)}. Returns include changes in open holdings and cash. Fees and distributions are shown separately for reference; they are already reflected in account value and are not deducted again. Dashes mean unavailable.</p>{!data.accounts.length&&<p>No accounts in this report.</p>}{data.accounts.map(a=><AccountReport key={a.id} account={a}/>)}</>}
  </section>;
}
function AccountReport({account:a}){
  const privacy=usePortfolioPrivacy(),{money,number}=privacy;
  const {journalStamp}=useDisplayTime(),p=a.performance,charges=new Map();let missingCharges=0;
  for(const t of a.trades){if(t.charges===null)missingCharges++;for(const c of t.charges||[])charges.set(c.currency,(charges.get(c.currency)||0)+c.amount);}
  return <article className="pi-report-account"><header className="pi-heading"><h3>{privacy.person(a.person)} <span>· {privacy.label(a.label,a.id)}{a.environment==='demo'?' · DEMO':''}</span></h3><span>{a.currency||'Currency unavailable'}</span></header><dl className="pi-report-metrics"><div><dt>Account return · {p.coverage}</dt><dd className={tone(p.amount)}>{money(p.amount,a.currency)}</dd></div><div><dt>Calculated return rate</dt><dd className={tone(p.ratePercent)}>{percent(p.ratePercent)}</dd></div><div><dt>Net funding in return interval</dt><dd>{money(p.netFunding,a.currency)}</dd></div><div><dt>Imported executions</dt><dd>{a.trades.length}</dd></div></dl>
    {p.reason?<p className="amber">{p.reason}</p>:<p className="pi-help">{journalStamp(p.start.at)} · {money(p.start.value,a.currency)} → {journalStamp(p.end.at)} · {money(p.end.value,a.currency)}{p.coverage==='partial'?' · Only this recorded portion is included.':''}{p.coverage==='estimated'||p.start.estimated||p.end.estimated?' · Includes reconstructed account values.':''}</p>}
    <div className="pi-report-coverage">{a.warnings.map((w,i)=><p key={i}>{w}</p>)}<p>History checked through: funding {a.coverage.funding?journalStamp(a.coverage.funding):'unavailable'} · executions {a.coverage.trades?journalStamp(a.coverage.trades):'unavailable'} · distributions {a.coverage.income?journalStamp(a.coverage.income):'unavailable'}.</p></div>
    <h4>Reported execution charges</h4><p>{charges.size?[...charges].map(([c,v])=>`${money(v,c)} ${c}`).join(' · '):a.trades.length&&!missingCharges?'No charges reported':'—'}{missingCharges>0?` · charges missing for ${missingCharges} executions`:''}</p>
    <details className="pi-report-details"><summary>Executions · {a.trades.length}</summary><div className="pi-report-table"><table><thead><tr><th>Executed</th><th>Stock / side</th><th>Shares</th><th>Price</th><th>Realized P/L</th></tr></thead><tbody>{a.trades.map(t=><tr key={t.id}><td>{journalStamp(t.at)}</td><td>{t.name} · {t.side}</td><td>{number(t.quantity)}</td><td>{money(t.price,t.priceCurrency)} {t.priceCurrency}</td><td className={tone(t.realized)}>{money(t.realized,t.currency)} {t.currency}</td></tr>)}</tbody></table></div>{!a.trades.length&&<p>No imported executions in this month.</p>}</details>
    <details className="pi-report-details"><summary>Cash movements · {a.funding.length}</summary><ul className="pi-ledger">{a.funding.map(f=><li key={f.id}><time>{journalStamp(f.at)}</time><span>{f.type.replaceAll('_',' ')}</span><b>{money(f.amount,f.currency)} {f.currency}</b></li>)}</ul>{!a.funding.length&&<p>No imported cash movements in this month.</p>}</details>
    <details className="pi-report-details"><summary>Cash distributions · {a.income.length}</summary><ul className="pi-ledger">{a.income.map(f=><li key={f.id}><time>{journalStamp(f.at)}</time><span>{f.name} · {f.type.replaceAll('_',' ')}</span><b>{money(f.amount,f.currency)} {f.currency}</b></li>)}</ul>{!a.income.length&&<p>No imported distributions in this month.</p>}</details>
  </article>;
}
