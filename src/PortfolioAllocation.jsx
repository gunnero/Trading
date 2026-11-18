import {useId,useState} from 'react';
import {ArrowsClockwise,DownloadSimple,FileText,Info,LockKey} from '@phosphor-icons/react';
import {PageHeader} from './PageHeader';
import {useDisplayTime} from './DisplayTime';
import {PortfolioPrivacyControls,usePortfolioPrivacy} from './PortfolioPrivacy';
import {downloadPortfolioCsv,usePortfolioSettings} from './PortfolioTools';
import {safeCsv} from './data/portfolio-insights.mjs';
import './portfolio-allocation.css';

const symbol=row=>row.key==='CASH'?'Cash':row.key.replace(/_US_EQ$/,'');
const percent=value=>Number.isFinite(value)?value.toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:2})+'%':'—';
const difference=value=>Number.isFinite(value)?value.toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:2,signDisplay:'exceptZero'})+' pp':'—';
const complete=total=>Math.abs(total-100)<=1e-6;

function SavedPlan({account,edited}){
  const privacy=usePortfolioPrivacy(),{clockStamp,zoneLabel}=useDisplayTime();
  const {plan,currency}=account,ready=plan.configured===true;
  function exportPlan(){
    const csv=safeCsv([
      ['Allocation review plan',account.person,account.label,account.id,currency,account.observedAt],
      ['Holding','Current value','Weight %','Target %','Value difference','Estimated shares','Broker instrument','Current shares','Target value','Target shares','Change in shares'],
      ...plan.rows.map(r=>[r.name,r.value,r.weight,r.target,r.delta,r.shares,r.key,r.quantity,r.targetValue,r.targetShares,r.changeShares]),
      ['Snapshot source',plan.source,'Available cash',plan.availableCash,currency],
      ['No orders placed. Each trade needs separate review and confirmation.'],
    ]);
    downloadPortfolioCsv(csv,'allocation-review.csv');
  }
  return <section className="alloc-card alloc-plan" aria-label="Saved rebalance plan">
    <header><div><h2>Saved rebalance plan</h2><span className="alloc-tag">Review only</span></div>
      <button type="button" className="button outline" disabled={!ready||privacy.privateMode} onClick={exportPlan}><DownloadSimple size={16}/>Export review plan</button></header>
    {ready?<><div className="alloc-plan-scroll" role="region" tabIndex={0} aria-label="Rebalance plan quantities"><table>
      <thead><tr>{['Holding','Current shares','Target shares','Δ Shares (indicative)','Δ Value ('+(currency||'account currency')+', indicative)','Action (indicative)'].map(h=><th scope="col" key={h}>{h}</th>)}</tr></thead>
      <tbody>{plan.rows.map(r=>{
        const cash=r.key==='CASH',direction=r.delta>0?'Buy':'Sell';
        const action=cash||Math.abs(r.delta)<.01?'—':r.shares===null?direction+' · shares unavailable':direction+' '+privacy.number(r.shares)+' shares';
        return <tr key={r.key}><th scope="row" title={r.name}>{symbol(r)}</th>
          <td data-label="Current">{cash?privacy.money(r.value,currency):privacy.number(r.quantity)}</td>
          <td data-label="Target">{cash?privacy.money(r.targetValue,currency):privacy.number(r.targetShares)}</td>
          <td data-label="Δ Shares">{cash?'—':privacy.number(r.changeShares)}</td><td data-label="Δ Value">{privacy.money(r.delta,currency)}</td><td data-label="Action">{action}</td>
        </tr>;
      })}</tbody></table></div>{edited&&<p className="alloc-message" role="status">This plan uses your saved targets. Save your edits to update it.</p>}</>
      :<p className="alloc-plan-empty">{plan.reason?'A plan is unavailable for this snapshot.':'Save targets totaling 100% to see the estimated share and value changes.'}</p>}
    <p className="alloc-review-note"><Info size={18}/><strong>No orders placed. Each trade needs separate review and confirmation.</strong></p>
    <footer><span>Snapshot source · {plan.source||'—'}{account.observedAt&&' · '+clockStamp(account.observedAt)+' '+zoneLabel}{account.health&&' · '+account.health}</span>
      <span>Available cash · {privacy.money(plan.availableCash,currency)}</span></footer>
  </section>;
}

function Allocations({account:a,refresh}){
  const privacy=usePortfolioPrivacy(),s=usePortfolioSettings(a,refresh),{plan}=a;
  const targets=privacy.privateMode?a.settings.targets:s.draft.targets;
  const total=Object.values(targets).reduce((n,v)=>n+Number(v||0),0);
  const rows=plan.rows,currentTotal=rows.reduce((n,r)=>n+r.weight,0),hasTargets=Object.keys(targets).length>0;
  const canSave=!privacy.privateMode&&!s.busy&&rows.length>0&&complete(total);
  function submit(e){
    e.preventDefault();
    if(canSave)s.save({targets:Object.fromEntries(Object.entries(targets).map(([k,v])=>[k,Number(v||0)]))});
  }
  return <>{plan.reason&&<p className="alloc-message amber" role="status">{plan.reason}</p>}
    <form onSubmit={submit} aria-label="Target weights">
      {rows.length>0&&<div className="alloc-card alloc-editor"><table aria-label="Current and target weights">
        <thead><tr>{['Holding','Current weight','Target weight','Difference'].map(h=><th key={h} scope="col">{h}</th>)}</tr></thead>
        <tbody>{rows.map(r=>{
          const target=targets[r.key]??'',gap=hasTargets?Number(target||0)-r.weight:null;
          return <tr key={r.key}><th scope="row" title={r.name}>{symbol(r)}</th>
            <td><div className="alloc-weight"><span>{percent(r.weight)}</span><progress max="100" value={r.weight} aria-label={r.name+' current weight'}/></div></td>
            <td>{privacy.privateMode?<span>{hasTargets?percent(Number(target||0)):'—'}</span>:<label className="alloc-input"><input type="number" min="0" max="100" step="any" disabled={s.busy}
              aria-label={r.name+' · target %'} value={target} placeholder="0" onChange={e=>s.edit('targets',{...targets,[r.key]:e.target.value})}/><span aria-hidden="true">%</span></label>}</td>
            <td>{difference(gap)}</td></tr>;
        })}</tbody>
        <tfoot><tr><th scope="row">Total</th><td className={complete(currentTotal)?'green':undefined}>{percent(currentTotal)}</td><td className={complete(total)?'green':'amber'}>{percent(total)}</td><td>{difference(hasTargets?total-currentTotal:null)}</td></tr></tfoot>
      </table></div>}
      {privacy.privateMode?<p className="alloc-message">Reveal names and balances to change targets or export a plan.</p>:<div className="alloc-actions">
        <button className="button primary" disabled={!canSave}><FileText size={17}/>{s.busy?'Saving…':'Save targets & prepare plan'}</button>
        {s.dirty&&<button type="button" className="button outline" disabled={s.busy} onClick={s.reload}>Discard edits</button>}
        {Object.keys(a.settings.targets).length>0&&<button type="button" className="text-button" disabled={s.busy} onClick={()=>s.save({targets:{}})}>Clear targets</button>}
      </div>}
      {s.error&&<p role="alert" className="alloc-message amber">{s.error}</p>}
    </form><SavedPlan account={a} edited={!privacy.privateMode&&s.dirty}/></>;
}

export default function PortfolioAllocation({accounts,account:a,selectAccount,view,navigation,onJournal}){
  const privacy=usePortfolioPrivacy(),{clockStamp,zoneLabel}=useDisplayTime(),id=useId();
  const [showPrivacy,setShowPrivacy]=useState(false);
  return <section className="planning-view alloc-view" aria-label="Portfolio planning">
    <PageHeader title="Target allocations" description="Set targets and prepare a plan for review."/>{navigation}
    <div className="alloc-card alloc-context">
      <label>Account<select aria-label="Planning account" disabled={!accounts.length} value={a?.id||''} onChange={e=>selectAccount(e.target.value)}>
        {!accounts.length&&<option value="">Choose an account</option>}{accounts.map(item=><option key={item.id} value={item.id}>
          {[privacy.person(item.person),privacy.label(item.label,item.id),item.currency,item.environment==='demo'?'DEMO':null].filter(Boolean).join(' · ')}</option>)}</select></label>
      <dl>{[['Currency',a?.currency],['Observation',a?.observedAt?clockStamp(a.observedAt)+' '+zoneLabel:null],['Coverage',a?.plan.rows.length?'Holdings & cash':null],['Data source',a?.plan.source]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value||'—'}</dd></div>)}</dl>
    </div>
    {view.error&&<p role="alert" className="alloc-message amber">{view.error}</p>}
    {a?<Allocations key={a.id} account={a} refresh={view.refresh}/>:<p role="status">{view.error?'Account data unavailable.':view.data?'Add an account in Portfolio Manager to get started.':'Loading accounts…'}</p>}
    <footer className="alloc-tools"><button className="text-button" aria-expanded={showPrivacy} aria-controls={id} onClick={()=>setShowPrivacy(open=>!open)}><LockKey size={15}/>Privacy settings</button>
      <button className="text-button" aria-label="Refresh account view" disabled={view.busy} onClick={view.refresh}><ArrowsClockwise size={15}/>Refresh</button><button className="text-button" onClick={onJournal}>Broker trade journal</button></footer>
    <div id={id} hidden={!showPrivacy}>{showPrivacy&&<PortfolioPrivacyControls/>}</div>
  </section>;
}
