import {useId,useMemo,useState} from 'react';
import {ArrowsClockwise,Check,CheckCircle,DownloadSimple,Info,LockKey} from '@phosphor-icons/react';
import {PortfolioPrivacyControls,usePortfolioPrivacy} from './PortfolioPrivacy';
import {PageHeader} from './PageHeader';
import {useDisplayTime} from './DisplayTime';
import {usePortfolioReport} from './usePortfolioReport';
import {downloadPortfolioCsv,portfolioTone} from './PortfolioTools';
import {annualCoverage,annualTotals} from './data/annual-report.mjs';
import {activityDateBounds} from './data/portfolio-activity.mjs';
import {reportCsv} from './data/portfolio-insights.mjs';
import './portfolio-annual.css';

function accountLabel(account,person,privacy){
  return [person?privacy.person(person):null,privacy.label(account.label,account.id),account.environment==='demo'?'DEMO':null].filter(Boolean).join(' · ');
}

function CoverageTable({coverage,data}){
  const bounds=data.bounds||activityDateBounds(data.year+'-01-01',data.year+'-12-31',data.timeZone);
  const format=new Intl.DateTimeFormat('en-GB',{timeZone:data.timeZone,year:'numeric',month:'short',day:'numeric'});
  return <div className="ar-card"><table className="ar-coverage" aria-label="Annual record coverage"><thead><tr>
    {['Coverage item','Records','Date range','Status'].map(h=><th key={h} scope="col">{h}</th>)}</tr></thead><tbody>
    {coverage.rows.map(row=>{
      const complete=row.status==='Complete',Icon=complete?Check:Info;
      const from=complete?bounds.from:row.from,to=complete?Math.min(bounds.to-1,data.generatedAt):row.to;
      const range=from===null?'—':format.formatRange(from,to);
      const detail=row.key==='charges'&&coverage.missingCharges?'Missing charge details':row.key==='executions'&&coverage.missingResults?'Missing realized results':null;
      return <tr key={row.key}><th scope="row"><span className="ar-item"><Icon size={17} weight={complete?'bold':'fill'} className={complete?'green':row.status==='Partial'?'amber':''} aria-hidden="true"/>{row.label}</span></th>
        <td data-label="Records">{row.count.toLocaleString('en-US')}</td><td data-label="Date range" title={complete?'Verified report period':'First and last imported records'}>{range}</td>
        <td><span className={'ar-badge ar-'+row.status.toLowerCase()} title={detail||undefined}>{row.status}{detail&&<span className="ar-status-detail"> · {detail}</span>}</span></td></tr>;
    })}</tbody></table></div>;
}

const amounts=[['realized','Realized P/L'],['distributions','Distributions'],['interest','Interest'],['charges','Execution charges'],['cashFees','Cash fees']];
function CurrencySummary({items,privacy}){
  const multiple=items.length>1;
  return <section className="ar-summary"><h2>Currency summary</h2><div className="ar-card"><table aria-label="Annual currency summary"><thead><tr>
    {multiple&&<th scope="col">Account</th>}<th scope="col">Currency</th>{amounts.map(([key,label])=><th key={key} scope="col">{label}</th>)}</tr></thead>
    <tbody>{items.flatMap(({account:a,totals})=>totals.currencies.map(row=><tr key={a.id+':'+row.currency}>
      {multiple&&<th className="ar-account-name" scope="row">{accountLabel(a,a.person,privacy)}</th>}<th className="ar-currency" scope="row">{row.currency}</th>
      {amounts.map(([key,label])=><td data-label={label} key={key} className={key==='realized'&&!privacy.hideBalances?portfolioTone(row[key]):undefined}>
        {key==='realized'&&row[key]>0&&!privacy.hideBalances?'+':''}{privacy.money(row[key],row.currency)}</td>)}</tr>))}</tbody></table>
      {items.every(item=>!item.totals.currencies.length)&&<p className="ar-empty">No records with a reporting currency for this selection.</p>}</div></section>;
}
function CoverageNotes({coverage,items,privacy}){
  const {clockDate,clockTime,zoneLabel}=useDisplayTime();
  const gaps=coverage.rows.filter(r=>r.status!=='Complete').map(r=>r.label.toLowerCase());
  return <details className="ar-notes ar-card" open><summary>Coverage and missing records</summary>
    <p>{gaps.length?'Incomplete coverage for '+gaps.join(', ')+'.':'All five categories have complete coverage for the report period.'}
      {coverage.missingCharges>0&&' The broker omitted charge details for '+coverage.missingCharges+' execution'+(coverage.missingCharges===1?'':'s')+'.'}
      {coverage.missingResults>0&&' Missing realized results or currencies for '+coverage.missingResults+' sale'+(coverage.missingResults===1?'':'s')+'.'}
      {gaps.length>0&&' Subtotals include the amounts supplied.'}</p>
    <details className="ar-checks"><summary>Import details by account</summary>
      <p>Complete rows show the covered period. Other date ranges show the first and last imported records. Interest and fees are counted separately from other funding movements. Charge counts include individual execution charges and cash fees.</p>
      {items.map(({account:a,totals})=><div key={a.id}><strong>{accountLabel(a,a.person,privacy)}</strong>
        <p>Checked through · {['trades','funding','income'].map((key,i)=>['Executions','Funding','Distributions'][i]+' '+(Number.isFinite(a.coverage?.[key])?clockDate(a.coverage[key])+' '+clockTime(a.coverage[key])+' '+zoneLabel:'unavailable')).join(' · ')}</p>
        {items.length>1&&(totals.missingCharges>0||totals.missingResults>0)&&<p>{totals.missingCharges} executions without charge details · {totals.missingResults} sales without reported results or currency</p>}
        {(a.warnings||[]).map((warning,i)=><p key={i}>{warning}</p>)}</div>)}
    </details></details>;
}

export default function PortfolioAnnualReport({navigation,onJournal,onPortfolios}){
  const privacy=usePortfolioPrivacy(),{settings,displayDay,clockDate,clockTime,zoneLabel}=useDisplayTime();
  const currentYear=Number(displayDay(Date.now()).slice(0,4));
  const [year,setYear]=useState(String(currentYear)),[person,setPerson]=useState(''),[account,setAccount]=useState('');
  const [showPrivacy,setShowPrivacy]=useState(false),privacyId=useId();
  const {view,people,accounts,importing,error,refresh}=usePortfolioReport({year,person,account,timeZone:settings.timeZone});
  const data=view.data,available=accounts.filter(a=>!person||a.personId===person);
  const coverage=useMemo(()=>data?annualCoverage(data.accounts):null,[data]);
  const items=useMemo(()=>data?.accounts.map(a=>({account:a,totals:annualTotals(a)}))||[],[data]);
  const allComplete=coverage?.rows.every(r=>r.status==='Complete'),BadgeIcon=allComplete?CheckCircle:Info;
  const canDownload=!!items.length&&!privacy.privateMode;
  return <section className="planning-view ar-view" aria-label="Annual accountant export">
    <PageHeader title="Annual accountant export" description="Original records, separated by account and currency."/>{navigation}
    <div className="ar-filters"><label>Year<select aria-label="Year" value={year} onChange={e=>setYear(e.target.value)}>{Array.from({length:currentYear-1899},(_,i)=><option key={i}>{currentYear-i}</option>)}</select></label>
      <label>Person<select aria-label="Person" value={person} onChange={e=>{setPerson(e.target.value);setAccount('');}}><option value="">Everyone</option>
        {people.map(p=><option key={p.id} value={p.id}>{privacy.person(p.name)}</option>)}</select></label>
      <label>Account<select aria-label="Account" value={account} onChange={e=>setAccount(e.target.value)}><option value="">All accounts</option>{available.map(a=><option key={a.id} value={a.id}>
        {accountLabel(a,person?null:people.find(p=>p.id===a.personId)?.name,privacy)}</option>)}</select></label>
      <button className="button primary" disabled={!canDownload} onClick={()=>{if(canDownload)downloadPortfolioCsv(reportCsv(data),'portfolio-accountant-'+year+'.csv');}}><DownloadSimple size={17}/>Download accountant CSV</button></div>
    {(error||privacy.privateMode)&&<div className="ar-message">{error&&<p role="alert" className="amber">{error}</p>}{privacy.privateMode&&<p>Show names and balances in Privacy settings to download the CSV.</p>}</div>}
    {!data?<p className="ar-empty" role="status">{view.error?'Annual records unavailable.':'Loading annual records…'}</p>:!items.length?<p className="ar-empty">No accounts in this selection.</p>:<>
      <div className="ar-period"><BadgeIcon size={17} weight="fill" className={allComplete?'green':undefined}/>
        <span>{Number(year)===currentYear?'Year to date':year+' calendar year'} · {coverage.checkedThrough?'Sources checked through '+clockDate(coverage.checkedThrough)+' '+clockTime(coverage.checkedThrough)+' '+zoneLabel:'Some source checkpoints unavailable'}</span></div>
      <CoverageTable coverage={coverage} data={data}/><CurrencySummary items={items} privacy={privacy}/>
      <CoverageNotes coverage={coverage} items={items} privacy={privacy}/></>}
    <footer className="ar-footer"><span>For accountant review. CSV timestamps use UTC. Tax liability is outside this report.</span>
      <div><button className="text-button" disabled={view.busy||importing} onClick={refresh}><ArrowsClockwise size={14}/>{importing?'Refreshing…':'Refresh export data'}</button>
        <button className="text-button" aria-expanded={showPrivacy} aria-controls={privacyId} onClick={()=>setShowPrivacy(!showPrivacy)}><LockKey size={14}/>Privacy settings</button>
        <button className="text-button" onClick={onJournal}>Broker trade journal</button>{onPortfolios&&<button className="text-button" onClick={onPortfolios}>Portfolios</button>}</div></footer>
    <div id={privacyId} hidden={!showPrivacy}>{showPrivacy&&<PortfolioPrivacyControls/>}</div>
  </section>;
}
