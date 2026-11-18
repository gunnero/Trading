import {useId,useRef,useState} from 'react';
import {ArrowsClockwise,Bell,CalendarBlank,Circle,LockKey,Stack} from '@phosphor-icons/react';
import {PageHeader} from './PageHeader';
import {PortfolioPrivacyControls,usePortfolioPrivacy} from './PortfolioPrivacy';
import {useDisplayTime} from './DisplayTime';
import {portfolioPercent,usePortfolioSettings} from './PortfolioTools';
import './portfolio-monitor.css';

const notes=[
  [CalendarBlank,'Snapshots every 15 minutes','Connected accounts are checked on a 15-minute background schedule.'],
  [Bell,'One alert per incident','A connection warning appears in Activity & alerts. Another warning fires if the issue returns after recovery.'],
  [Stack,'Order estimate rechecked at review and submission','The limit applies to buys and sells placed here. Market fills and charges can differ from the estimate.'],
];
const historyLabels={
  connected:['Connection established','Connected','Broker connection verified'],
  disconnected:['Connection removed','Disconnected','Automatic account sync stopped'],
  synced:['Sync completed','Success','Portfolio data updated'],
  snapshot:['Recorded snapshot','Completed','Account value recorded'],
  failed:['Sync failed','Failed','Account data could not be refreshed'],
  imported:['Snapshot imported','Imported','Manual account snapshot saved'],
};

function Limits({account,refresh}){
  const form=usePortfolioSettings(account,refresh),d=form.draft;
  const optionalNumber=value=>value===''||value==null?null:Number(value);
  function submit(event){
    event.preventDefault();
    form.save({healthEnabled:d.healthEnabled,staleMinutes:Number(d.staleMinutes),
      concentrationPercent:optionalNumber(d.concentrationPercent),maxOrderValue:optionalNumber(d.maxOrderValue)});
  }
  return <form className="mon-card mon-settings" aria-label="Account limits" onSubmit={submit}>
    <fieldset disabled={form.busy}>
      <label className="mon-setting mon-switch-row">
        <span><strong>Connection health alerts</strong><small>Get notified if this account stops syncing.</small></span>
        <input type="checkbox" role="switch" aria-label="Connection health alerts" checked={d.healthEnabled} onChange={e=>form.edit('healthEnabled',e.target.checked)}/>
      </label>
      <label className="mon-setting"><span><b>Warn after no sync (minutes)</b><small>Send an alert when the last successful sync is older than this.</small></span>
        <input aria-label="Warn after no sync (minutes)" type="number" min="20" max="1440" required value={d.staleMinutes} onChange={e=>form.edit('staleMinutes',e.target.value)}/>
      </label>
      <label className="mon-setting"><span><b>Concentration threshold (%)</b><small>Flag holdings above this share of the whole account value, including cash.</small></span>
        <span className="mon-input"><input aria-label="Concentration threshold (%)" type="number" min="0.01" max="100" step="any" placeholder="—" value={d.concentrationPercent??''} onChange={e=>form.edit('concentrationPercent',e.target.value)}/>
          {optionalNumber(d.concentrationPercent)===null&&<small>Off</small>}</span>
      </label>
      <label className="mon-setting"><span><b>Maximum order value{account.currency?' ('+account.currency+')':''}</b><small>Orders with an estimated value above this amount are blocked.</small></span>
        <span className="mon-input"><input aria-label="Maximum order value" type="number" min="0.01" max="1000000000000" step="any" placeholder="—" value={d.maxOrderValue??''} onChange={e=>form.edit('maxOrderValue',e.target.value)}/>
          {optionalNumber(d.maxOrderValue)===null&&<small>No limit</small>}</span>
      </label>
      <div className="mon-buttons"><button className="button primary" disabled={!form.dirty}>{form.busy?'Saving…':'Save account limits'}</button>
        <button className="button outline" type="button" disabled={!form.dirty} onClick={form.reload}>Discard edits</button></div>
    </fieldset>{form.error&&<p role="alert" className="amber">{form.error}</p>}
  </form>;
}

function MonitorHistory({account}){
  const {displayDay,clockTime,zoneLabel}=useDisplayTime(),privacy=usePortfolioPrivacy(),events=account.connectionHistory||[];
  const accountLabel=[privacy.person(account.person),privacy.label(account.label,account.id),account.currency].filter(Boolean).join(' · ');
  return <section className="mon-history"><h2>Connections &amp; history</h2>
    {events.length?<table aria-label="Recent account connection history"><thead><tr><th>Event</th><th>Status</th><th>Details</th><th>Timestamp ({zoneLabel})</th></tr></thead>
      <tbody>{events.map(({kind,at},index)=>{
        const [title,status,details]=historyLabels[kind];
        return <tr key={kind+at}><th scope="row">{title}</th><td className={kind==='failed'||kind==='disconnected'?'amber':'green'}><Circle size={10} weight="fill"/> {status}</td>
          <td>{details}{index===0&&kind==='synced'?' · '+accountLabel:''}</td><td><time dateTime={new Date(at).toISOString()}>{displayDay(at)} · {clockTime(at)}</time><span className="mon-phone-zone"> {zoneLabel}</span></td></tr>;
      })}</tbody></table>:<p>No connection history recorded for this account yet.</p>}
  </section>;
}

export default function PortfolioMonitor({accounts,account:a,selectAccount,view,navigation,onJournal}){
  const privacy=usePortfolioPrivacy(),{displayDay,clockTime,clockStamp,zoneLabel}=useDisplayTime(),id=useId(),privacyButton=useRef(null);
  const [showPrivacy,setShowPrivacy]=useState(false);
  return <section className="planning-view mon-view" aria-label="Portfolio planning">
    <PageHeader title="Connection health & account limits" description={a&&<span className={a.health==='Healthy'?'green':'amber'}>
      <Circle size={12} weight="fill"/> {a.health}{a.lastSuccess&&' · last sync '+(displayDay(a.lastSuccess)===displayDay(Date.now())?clockTime(a.lastSuccess):clockStamp(a.lastSuccess))+' '+zoneLabel}</span>}
      actions={<select className="mon-select" aria-label="Planning account" value={a?.id||''} disabled={!accounts.length} onChange={e=>selectAccount(e.target.value)}>
        {!accounts.length&&<option value="">Choose an account</option>}{accounts.map(account=><option key={account.id} value={account.id}>
          {[privacy.person(account.person),privacy.label(account.label,account.id),account.currency,account.environment==='demo'?'DEMO':null].filter(Boolean).join(' · ')}
        </option>)}</select>}/>
    {navigation}{view.error&&<p role="alert" className="amber">{view.error}</p>}
    {a?<>{a.error&&<p className="amber" role="status">{a.error}</p>}
      <div className="mon-columns">{privacy.privateMode?<div className="mon-card mon-private"><LockKey size={24}/><p>Reveal names and balances to edit account limits.</p>
        <button className="button outline" onClick={()=>{setShowPrivacy(true);privacyButton.current?.focus();}}>Open privacy settings</button></div>:<Limits key={a.id} account={a} refresh={view.refresh}/>}
        <aside aria-label="How monitoring works" className="mon-card mon-notes">{notes.map(([Icon,title,detail])=><div key={title}>
          <span className="mon-icon"><Icon size={24}/></span><div><h3>{title}</h3><p>{detail}</p></div></div>)}</aside>
      </div>
      <section className="mon-card mon-breaches"><h2>Above the saved concentration threshold</h2>
        {a.concentrations.length?<ul>{a.concentrations.map(h=><li key={h.key}><b>{h.name}</b><span>{portfolioPercent(h.weight).replace('+','')} of account</span><strong>{privacy.money(h.value,a.currency)}</strong></li>)}</ul>
          :<div className="mon-empty"><Stack size={30}/><strong>{a.settings.concentrationPercent?'No confirmed breaches.':'Choose a concentration threshold to start monitoring.'}</strong>
            <p>{!a.settings.concentrationPercent?'Set a concentration threshold above to see holdings that exceed it.':a.health!=='Healthy'?'Waiting for a fresh account snapshot.':a.plan?.reason||'Only holdings above your saved threshold appear here.'}</p></div>}
      </section>
      <MonitorHistory account={a}/>
    </>:<p role="status">{view.error?'Account data unavailable.':view.data?'Add an account in Portfolio Manager to get started.':'Loading accounts…'}</p>}
    <footer className="mon-footer"><button className="text-button" ref={privacyButton} aria-controls={id} aria-expanded={showPrivacy} onClick={()=>setShowPrivacy(open=>!open)}><LockKey size={16}/>Privacy settings</button>
      <div><span>Source · Portfolio Manager</span><button className="text-button" aria-label="Refresh account view" disabled={view.busy} onClick={view.refresh}><ArrowsClockwise size={16}/>Refresh</button>
        <button className="text-button" onClick={onJournal}>Broker trade journal</button></div></footer>
    <div id={id} hidden={!showPrivacy}>{showPrivacy&&<PortfolioPrivacyControls/>}</div>
  </section>;
}
