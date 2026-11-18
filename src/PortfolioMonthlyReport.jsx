import {useId,useMemo,useRef,useState} from 'react';
import {ArrowsClockwise,CalendarBlank,DownloadSimple,Info,LockKey,Printer,Stack,User} from '@phosphor-icons/react';
import {PortfolioPrivacyControls,usePortfolioPrivacy} from './PortfolioPrivacy';
import {PageHeader} from './PageHeader';
import {useDisplayTime} from './DisplayTime';
import {usePortfolioReport} from './usePortfolioReport';
import {reportCsv} from './data/portfolio-insights.mjs';
import {monthlyActivity} from './data/monthly-report.mjs';
import {portfolioPercent as percent,portfolioTone as tone,downloadPortfolioCsv} from './PortfolioTools';
import MonthlyResultsChart from './MonthlyResultsChart';
import './portfolio-monthly.css';

function AccountReport({account:a}){
  const privacy=usePortfolioPrivacy(),{money,number}=privacy;
  const {journalStamp}=useDisplayTime(),p=a.performance,charges=new Map();let missingCharges=0;
  for(const t of a.trades){if(t.charges===null)missingCharges++;for(const c of t.charges||[])charges.set(c.currency,(charges.get(c.currency)||0)+c.amount);}
  return <article className="pi-report-account"><header className="pi-heading"><h3>{privacy.person(a.person)} <span>· {privacy.label(a.label,a.id)}{a.environment==='demo'?' · DEMO':''}</span></h3><span>{a.currency||'Currency unavailable'}</span></header><dl className="pi-report-metrics"><div><dt>Account return · {p.coverage}</dt><dd className={tone(p.amount)}>{money(p.amount,a.currency)}</dd></div><div><dt>Calculated return rate</dt><dd className={!privacy.hideBalances?tone(p.ratePercent):undefined}>{privacy.hideBalances?'••••':percent(p.ratePercent)}</dd></div><div><dt>Net funding in return interval</dt><dd>{money(p.netFunding,a.currency)}</dd></div><div><dt>Imported executions</dt><dd>{a.trades.length}</dd></div></dl>
    {p.reason?<p className="amber">{p.reason}</p>:<p className="pi-help">{journalStamp(p.start.at)} · {money(p.start.value,a.currency)} → {journalStamp(p.end.at)} · {money(p.end.value,a.currency)}{p.coverage==='partial'?' · Only this recorded portion is included.':''}{p.coverage==='estimated'||p.start.estimated||p.end.estimated?' · Includes reconstructed account values.':''}</p>}
    <div className="pi-report-coverage">{a.warnings.map((w,i)=><p key={i}>{w}</p>)}<p>History checked through: funding {a.coverage.funding?journalStamp(a.coverage.funding):'unavailable'} · executions {a.coverage.trades?journalStamp(a.coverage.trades):'unavailable'} · distributions {a.coverage.income?journalStamp(a.coverage.income):'unavailable'}.</p></div>
    <h4>Reported execution charges</h4><p>{charges.size?[...charges].map(([c,v])=>`${money(v,c)} ${c}`).join(' · '):a.trades.length&&!missingCharges?'No charges reported':'—'}{missingCharges>0?` · charges missing for ${missingCharges} executions`:''}</p>
    <details className="pi-report-details"><summary>Executions · {a.trades.length}</summary><div className="pi-report-table"><table><thead><tr><th>Executed</th><th>Stock / side</th><th>Shares</th><th>Price</th><th>Realized P/L</th></tr></thead><tbody>{a.trades.map(t=><tr key={t.id}><td>{journalStamp(t.at)}</td><td>{t.name} · {t.side}</td><td>{number(t.quantity)}</td><td>{money(t.price,t.priceCurrency)} {t.priceCurrency}</td><td className={tone(t.realized)}>{money(t.realized,t.currency)} {t.currency}</td></tr>)}</tbody></table></div>{!a.trades.length&&<p>No imported executions in this month.</p>}</details>
    <details className="pi-report-details"><summary>Cash movements · {a.funding.length}</summary><ul className="pi-ledger">{a.funding.map(f=><li key={f.id}><time>{journalStamp(f.at)}</time><span>{f.type.replaceAll('_',' ')}</span><b>{money(f.amount,f.currency)} {f.currency}</b></li>)}</ul>{!a.funding.length&&<p>No imported cash movements in this month.</p>}</details>
    <details className="pi-report-details"><summary>Cash distributions · {a.income.length}</summary><ul className="pi-ledger">{a.income.map(f=><li key={f.id}><time>{journalStamp(f.at)}</time><span>{f.name} · {f.type.replaceAll('_',' ')}</span><b>{money(f.amount,f.currency)} {f.currency}</b></li>)}</ul>{!a.income.length&&<p>No imported distributions in this month.</p>}</details>
  </article>;
}

function accountName(account,privacy){
  return [privacy.person(account.person),privacy.label(account.label,account.id),account.environment==='demo'?'DEMO':null].filter(Boolean).join(' · ');
}
function signed(value,currency,privacy){
  return (!privacy.hideBalances&&value>0?'+':'')+privacy.money(value,currency);
}
function AccountTable({accounts}){
  const privacy=usePortfolioPrivacy(),{displayDay}=useDisplayTime();
  return <div className="mr-table-card"><table className="mr-accounts" aria-label="Account values and coverage"><thead><tr>
    {['Account','Opening value','Closing value','Net flows','Return estimate','Coverage'].map(s=><th key={s} scope="col">{s}</th>)}</tr></thead>
    <tbody>{accounts.map(a=>{
      const p=a.performance,partial=p.coverage==='partial'||!a.tradesComplete||!a.fundingComplete||!a.incomeComplete,estimated=p.coverage==='estimated'||p.start?.estimated||p.end?.estimated;
      return <tr key={a.id}><th scope="row">{accountName(a,privacy)} <small>{a.currency||'—'}</small></th>
        <td data-label="Opening value">{privacy.money(p.start?.value,a.currency)}</td><td data-label="Closing value">{privacy.money(p.end?.value,a.currency)}</td>
        <td data-label="Net flows" className={!privacy.hideBalances?tone(p.netFunding):undefined}>{signed(p.netFunding,a.currency,privacy)}</td>
        <td data-label="Return estimate" className={!privacy.hideBalances?tone(p.ratePercent):undefined}>{privacy.hideBalances?'••••':percent(p.ratePercent)}</td>
        <td data-label="Coverage">{partial||!p.start||!p.end?<span className={'mr-badge '+(p.start&&p.end?'mr-partial':'')}>{p.start&&p.end?'Partial history':'Unavailable'}</span>:null}
          {p.start&&p.end&&<span className="mr-dates">{displayDay(p.start.at)} – {displayDay(p.end.at)}</span>}{estimated&&<small>Includes reconstructed values</small>}</td></tr>;
    })}</tbody></table></div>;
}
function HeadlineFigures({bucket}){
  const p=usePortfolioPrivacy(),{currency}=bucket,byKey=Object.fromEntries(bucket.summary.map(r=>[r.key,r.amount]));
  return <dl className="mr-metrics">{[
    ['Realized P/L',bucket.result],['Deposits',byKey.deposits],['Withdrawals',Number.isFinite(byKey.withdrawals)?Math.abs(byKey.withdrawals):null],['Reported fees',byKey.charges]
  ].map(([label,value],i)=><div key={label}><dt>{label}</dt><dd className={!i&&!p.hideBalances?tone(value):undefined}>{i===0?signed(value,currency,p):p.money(value,currency)} <small>{currency}</small></dd>
    {i===3&&<small>Execution charges{Number.isFinite(byKey.cashFees)&&<> · Cash fees (signed) {p.money(byKey.cashFees,currency)}</>}</small>}</div>)}</dl>;
}
function ActivityPanels({bucket}){
  const privacy=usePortfolioPrivacy();
  return <div className="mr-panels"><section className="mr-card"><h2>Realized results by week ({bucket.currency})</h2>
    {privacy.hideBalances?<p className="mr-empty">Balances hidden</p>:bucket.weeks.some(w=>Number.isFinite(w.amount))?<MonthlyResultsChart weeks={bucket.weeks} currency={bucket.currency}/>:<p className="mr-empty">No reported realized results for this period.</p>}
    </section><section className="mr-card"><h2>Transactions summary</h2><table className="mr-transactions"><thead><tr><th>Type</th><th>Count</th><th>Amount ({bucket.currency})</th></tr></thead>
      <tbody>{bucket.summary.map(r=><tr key={r.key}><th scope="row">{r.label}</th><td>{r.count??'—'}</td><td className={!privacy.hideBalances&&r.key!=='charges'?tone(r.amount):undefined}>{r.key==='charges'?privacy.money(r.amount,bucket.currency):signed(r.amount,bucket.currency,privacy)}</td></tr>)}</tbody></table></section></div>;
}
export default function PortfolioMonthlyReport({navigation,onJournal,onPortfolios}){
  const privacy=usePortfolioPrivacy(),{settings,displayDay,journalStamp,zoneLabel}=useDisplayTime();
  const currentMonth=displayDay(Date.now()).slice(0,7);
  const [month,setMonth]=useState(currentMonth),[person,setPerson]=useState(''),[account,setAccount]=useState(''),[bucketKey,setBucketKey]=useState('');
  const [showPrivacy,setShowPrivacy]=useState(false),privacyId=useId(),details=useRef(null);
  const validMonth=/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(month)&&month<=currentMonth;
  const {view,people,accounts,importing,error,refresh}=usePortfolioReport({month,person,account,timeZone:settings.timeZone},validMonth),data=view.data;
  const activity=useMemo(()=>data?monthlyActivity(data):null,[data]);
  const bucket=activity?.buckets.find(b=>b.key===bucketKey)||activity?.buckets[0];
  const available=accounts.filter(a=>!person||a.personId===person);
  const selectedPerson=people.find(p=>p.id===person);
  const monthName=validMonth?new Intl.DateTimeFormat('en-US',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(month+'-01T12:00:00Z')):'Select a month';
  function print(){
    if(!data||privacy.privateMode)return;
    const items=[...(details.current?.querySelectorAll('details')||[])],opened=items.map(el=>el.open);
    items.forEach(el=>el.open=true);
    try{window.print();}finally{items.forEach((el,i)=>el.open=opened[i]);}
  }
  const actions=<><button className="button primary" disabled={!data||privacy.privateMode} onClick={()=>downloadPortfolioCsv(reportCsv(data),'portfolio-report-'+month+'.csv')}><DownloadSimple size={17}/>Export CSV</button>
    <button className="button outline" disabled={!data||privacy.privateMode} onClick={print} aria-label="Print / PDF"><Printer size={17}/>Print</button></>;
  return <section className="planning-view mr-view pi-report" aria-label="Monthly account reports">
    <PageHeader title="Monthly report" description={monthName+' · recorded activity and account performance.'} actions={actions}/>{navigation}
    <div className="mr-filters pi-no-print"><label>Month<span><CalendarBlank size={18}/><input aria-label="Month" type="month" min="1900-01" max={currentMonth} value={month} onChange={e=>setMonth(e.target.value)}/></span></label>
      <label>Person<span><User size={18}/><select aria-label="Person" value={person} onChange={e=>{setPerson(e.target.value);setAccount('');}}><option value="">Everyone</option>{people.map(p=><option key={p.id} value={p.id}>{privacy.person(p.name)}</option>)}</select></span></label>
      <label>Account<span><Stack size={18}/><select aria-label="Account" value={account} onChange={e=>setAccount(e.target.value)}><option value="">All accounts</option>{available.map(a=><option key={a.id} value={a.id}>{accountName({...a,person:people.find(p=>p.id===a.personId)?.name},privacy)}</option>)}</select></span></label></div>
    <p className="mr-print-scope">{selectedPerson?privacy.person(selectedPerson.name):'Everyone'} · {account?privacy.label(available.find(a=>a.id===account)?.label,account):'All accounts'} · {zoneLabel}</p>
    {error&&<p className="amber" role="alert">{error}</p>}
    {!validMonth?<p role="status">Choose the current month or an earlier month.</p>:!data?<p role="status">{view.error?'Monthly report unavailable.':'Loading monthly report…'}</p>:!data.accounts.length?<p className="mr-empty">No accounts in this report.</p>:<>
      {activity.buckets.length>1&&<label className="mr-currency">Activity summary<select aria-label="Activity summary currency" value={bucket.key} onChange={e=>setBucketKey(e.target.value)}>{activity.buckets.map(b=><option key={b.key} value={b.key}>{b.currency}{b.scope==='demo'?' · DEMO':''}</option>)}</select></label>}
      {bucket&&<HeadlineFigures bucket={bucket}/>}<AccountTable accounts={data.accounts}/>
      {bucket&&<ActivityPanels bucket={bucket}/>}
      <footer className="mr-source"><Info size={16}/><div><p>Cash movements are separate from trading P/L. Amounts retain their original currency.</p>
        <p>Source · Imported broker activity and account snapshots · {monthName} · Generated {journalStamp(data.generatedAt)} {zoneLabel}</p>
        {bucket?.partial&&<p>Partial history · Totals include supplied records. Dashes indicate unavailable amounts or counts.</p>}{activity.unassigned>0&&<p>{activity.unassigned} executions without a wallet currency are excluded from currency summaries.</p>}
      </div></footer>
      <div ref={details}><details className="mr-detail"><summary>Account details &amp; coverage</summary>{data.accounts.map(a=><AccountReport key={a.id} account={a}/>)}</details></div></>}
    <div className="mr-tools pi-no-print"><button className="text-button" disabled={importing||view.busy||!validMonth} onClick={refresh}><ArrowsClockwise size={15}/>{importing?'Updating broker history…':'Refresh report'}</button>
      <button className="text-button" aria-controls={privacyId} aria-expanded={showPrivacy} onClick={()=>setShowPrivacy(!showPrivacy)}><LockKey size={14}/>Privacy settings</button>
      <button className="text-button" onClick={onJournal}>Broker trade journal</button>{onPortfolios&&<button className="text-button" onClick={onPortfolios}>Portfolios</button>}</div>
    <div className="pi-no-print" id={privacyId} hidden={!showPrivacy}>{showPrivacy&&<PortfolioPrivacyControls/>}</div>
  </section>;
}
