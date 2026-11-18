import {useEffect,useId,useRef,useState} from 'react';
import {ArrowClockwise,Bell,Check,CheckCircle,DotsThree,Info,LockKey,Pause,PencilSimple,Play,Stack} from '@phosphor-icons/react';
import {PageHeader} from './PageHeader';
import {PortfolioPrivacyControls,usePortfolioPrivacy} from './PortfolioPrivacy';
import {usePortfolioResource} from './PortfolioTools';
import {activityRequest} from './PortfolioNotifications';
import {useDisplayTime} from './DisplayTime';
import './portfolio-price-alerts.css';

const types={S:'Supply',D:'Demand',G:'Gap'};
const amount=new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:8});
const holdingKey=c=>c.accountId+':'+c.ticker;
const zoneKey=z=>JSON.stringify([z.type,z.low,z.high,z.date,z.timeframe]);
const initial={holding:'',mode:'above',price:'',zone:'',editing:null};
const symbol=r=>r.listing.split(':')[1];
const zoneText=z=>types[z.type]+' '+z.low+'–'+z.high;
function accountText(c,privacy){
  return [privacy.person(c.person),privacy.label(c.accountLabel??c.label,c.accountId),c.environment==='demo'?'DEMO':null].filter(Boolean).join(' · ');
}
function Actions({rule,busy,canEdit,onEdit,onAction}){
  const menu=useRef(null),more=useRef(null);
  function close(){menu.current.open=false;}
  function handle(action){close();onAction(action);}
  const edit=<button type="button" disabled={busy||!canEdit} onClick={()=>{close();onEdit();}}>Edit alert</button>;
  return <div className="pr-actions">
    {rule.enabled?<button className="pr-control" disabled={busy||!canEdit} aria-label={'Edit '+symbol(rule)+' alert'} title="Edit alert" onClick={onEdit}><PencilSimple size={17}/></button>
      :<button className="pr-control" disabled={busy||!rule.connected} onClick={()=>onAction('arm')}>{rule.firedAt?<ArrowClockwise size={15}/>:<Play size={15}/>} {rule.firedAt?'Re-arm':'Arm'}</button>}
    <details ref={menu} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))close();}}
      onKeyDown={e=>{if(e.key==='Escape'){close();more.current.focus();}}}>
      <summary role="button" ref={more} className="pr-control" aria-label={'More actions for '+symbol(rule)} title="More actions"><DotsThree size={20} weight="bold"/></summary>
      <div className="pr-menu">{rule.enabled?<button type="button" disabled={busy} onClick={()=>handle('pause')}>Pause</button>:edit}
        <button type="button" disabled={busy} onClick={()=>handle('delete')}>Remove</button></div>
    </details>
  </div>;
}
function RuleRow({rule,privacy,busy,canEdit,onEdit,onAction}){
  const {clockStamp,zoneLabel}=useDisplayTime();
  const status=!rule.connected?'Disconnected':rule.firedAt?'Triggered':rule.enabled?'Armed':'Paused';
  const Icon=status==='Paused'||status==='Disconnected'?Pause:Check;
  function price(value){return privacy.hideBalances?'••••':Number.isFinite(value)?amount.format(value)+' '+rule.currency:'—';}
  return <tr><th scope="row"><strong>{symbol(rule)}</strong><small>{accountText(rule,privacy)} · {rule.listing.split(':')[0]} · {rule.currency}</small></th>
    <td>{rule.mode==='zone'?<>Enters {types[rule.levelType]?.toLowerCase()} zone <b>{amount.format(rule.low)}–{amount.format(rule.high)} {rule.currency}</b><small>{rule.levelDate} · {rule.timeframe}</small></>
      :<>Price crosses {rule.mode} <b>{price(rule.price)}</b></>}</td>
    <td><span className={'pr-status pr-'+status.toLowerCase()} title={rule.firedAt?'Triggered '+clockStamp(rule.firedAt)+' '+zoneLabel:undefined}><Icon size={14} weight="bold"/>{status}</span>
      {rule.firedAt&&!rule.observedAt&&<small>Fired {clockStamp(rule.firedAt)} {zoneLabel}</small>}</td>
    <td>{Number.isFinite(rule.observedAt)?<><b>{price(rule.lastPrice)}</b><small title={rule.session}>{clockStamp(rule.observedAt)} {zoneLabel}</small></>:<span className="pr-muted">{rule.enabled&&rule.connected?'Awaiting first quote':'—'}</span>}{rule.error&&<small className="amber">{rule.error}</small>}</td>
    <td><Actions rule={rule} busy={busy} canEdit={canEdit} onEdit={onEdit} onAction={onAction}/></td></tr>;
}
export default function PortfolioPriceAlerts({navigation,onJournal,onPortfolios}){
  const view=usePortfolioResource('insights/alerts'),privacy=usePortfolioPrivacy(),{clockStamp,zoneLabel}=useDisplayTime();
  const [draft,setDraft]=useState(initial),[pending,setPending]=useState(false),[error,setError]=useState(''),[showPrivacy,setShowPrivacy]=useState(false);
  const form=useRef(null),privacyId=useId();
  const choices=view.data?.choices||[],rules=view.data?.rules||[],editing=draft.editing;
  const choice=draft.holding?choices.find(c=>holdingKey(c)===draft.holding):choices[0];
  const zoned=draft.mode==='zone',original=editing?.mode==='zone'?{type:editing.levelType,low:editing.low,high:editing.high,date:editing.levelDate,timeframe:editing.timeframe}:null;
  const zone=draft.zone==='original'?original:choice?.zones.find(z=>zoneKey(z)===draft.zone);
  const locked=privacy.privateMode||pending;
  const latest=rules.reduce((last,r)=>Number.isFinite(r.observedAt)?Math.max(last,r.observedAt):last,0);
  useEffect(()=>{if(privacy.privateMode)setDraft(initial);},[privacy.privateMode]);
  function change(patch){setDraft(prev=>({...prev,holding:choice?holdingKey(choice):prev.holding,...patch}));}
  async function mutate(body){
    setError('');setPending(true);
    try{await activityRequest('insights/alerts',body);await view.refresh();return true;}
    catch(e){setError(e.message);await view.refresh();return false;}
    finally{setPending(false);}
  }
  function edit(rule){
    setError('');
    setDraft({holding:holdingKey(rule),mode:rule.mode,price:String(rule.price??''),zone:rule.mode==='zone'?'original':'',editing:rule});
    form.current.querySelector('[name="mode"]').focus();
  }
  async function submit(e){
    e.preventDefault();
    if(locked||!choice||(zoned&&!zone))return;
    const trigger=zoned?{mode:'zone',zone:draft.zone==='original'?'original':zone.id,zoneSnapshot:zone}:{mode:draft.mode,price:Number(draft.price)};
    const body=editing?{action:'edit',id:editing.id,revision:editing.revision,...trigger}:{accountId:choice.accountId,ticker:choice.ticker,...trigger};
    if(await mutate(body))setDraft({...initial,holding:holdingKey(choice),mode:draft.mode});
  }
  const refresh=<button className="button outline" disabled={view.busy||pending} onClick={()=>{setError('');view.refresh();}}><ArrowClockwise size={18}/>Refresh alerts</button>;
  return <section className="planning-view pr-view" aria-label="Price alert rules">
    <PageHeader title="Portfolio insights" actions={refresh}/>{navigation}
    <div className="pr-heading"><div><h2>Price &amp; level alerts</h2><p>One alert on the next observed crossing.</p></div>
      <div className="pr-zone"><label><input type="checkbox" role="switch" checked={zoned} disabled={locked||!choice} onChange={e=>change({mode:e.target.checked?'zone':'above'})}/>Saved zone</label>
        <Info size={16} aria-label="Saved zones keep their original prices and sheet date"><title>Saved zones keep their original prices and sheet date.</title></Info>
        <span>Zone: <b>{zoned&&zone?types[zone.type]:'—'}</b></span><span>Timeframe: <b>{zoned&&zone?zone.timeframe:'—'}</b></span>
      </div></div>
    <form className="pr-form pr-card" ref={form} onSubmit={submit}>
      <label>Holding<select aria-label="Holding" disabled={locked||!!editing||!choices.length} required value={choice?holdingKey(choice):''} onChange={e=>change({holding:e.target.value,zone:'',price:''})}>
        {!choice&&<option value="">Choose a connected stock</option>}{choices.map(c=><option key={holdingKey(c)} value={holdingKey(c)}>{accountText(c,privacy)} · {symbol(c)} · {c.listing.split(':')[0]} · {c.currency}</option>)}</select></label>
      <label>Notify when<select name="mode" disabled={locked} value={draft.mode} onChange={e=>change({mode:e.target.value})}><option value="above">Price crosses above</option><option value="below">Price crosses below</option><option value="zone">Price enters a saved zone</option></select></label>
      {zoned?<label>Saved level<select aria-label="Saved level" disabled={locked||!choice} required value={zone?draft.zone:''} onChange={e=>change({zone:e.target.value})}>
        <option value="">{choice&&!choice.zones.length&&!original?'No saved zones':'Choose a zone'}</option>
        {original&&<option value="original">Original · {zoneText(original)} · {original.date} · {original.timeframe}</option>}
        {choice?.zones.map(z=><option key={z.id} value={zoneKey(z)}>{zoneText(z)} · {z.date} · {z.timeframe}</option>)}</select></label>
        :<label>Target price<span className="pr-price"><input aria-label="Target price" type="number" required min="0.00000001" max="100000000" step="any" disabled={locked} value={privacy.privateMode?'':draft.price} onChange={e=>change({price:e.target.value})}/><span>{choice?.currency}</span></span></label>}
      <button className="button primary" disabled={locked||!choice||(zoned?!zone:!Number(draft.price))}>{editing?'Save changes':'Create alert'}</button>
      {editing&&!privacy.privateMode&&<div className="pr-editing">Editing {symbol(editing)} alert <button className="text-button" type="button" disabled={pending} onClick={()=>{setDraft(initial);setError('');}}>Cancel edit</button></div>}
    </form>
    {privacy.privateMode&&<p className="pr-feedback">Show names and balances in Privacy settings to create or edit an alert.</p>}
    {!privacy.privateMode&&view.data&&!choices.length&&<p className="pr-feedback">A connected holding with a verified market listing is needed to create an alert.</p>}
    {(error||view.error)&&<p className="pr-feedback amber" role="alert">{error||view.error}</p>}
    <div className="pr-table pr-card"><table aria-label="Saved price alerts"><thead><tr>{['Holding','Trigger','Status','Last observed','Actions'].map(h=><th scope="col" key={h}>{h}</th>)}</tr></thead>
      <tbody>{rules.map(r=><RuleRow key={r.id} rule={r} privacy={privacy} busy={pending} canEdit={!privacy.privateMode&&choices.some(c=>holdingKey(c)===holdingKey(r)&&c.listing===r.listing&&c.currency===r.currency)}
        onEdit={()=>edit(r)} onAction={async action=>{if(await mutate({action,id:r.id,revision:r.revision})&&editing?.id===r.id)setDraft(initial);}}/>)}</tbody></table>
      {!rules.length&&<div className="pr-empty"><Bell size={22}/><strong>{view.data?'No alert rules yet.':view.error?'Alert rules unavailable.':'Loading alert rules…'}</strong></div>}
    </div>
    <div className="pr-notes">
      <div><CheckCircle/><span><b>Fresh quotes checked every minute</b><small>Yahoo Finance · available market sessions</small></span></div>
      <div><CheckCircle/><span><b>Quotes can be delayed</b><small>Crossings between readings may be missed.</small></span></div>
      <div><CheckCircle/><span><b>One alert per crossing rule</b><small>Re-arm to watch for the next crossing.</small></span></div>
      <div><Stack/><span><b>{latest?'Last quote · '+clockStamp(latest)+' '+zoneLabel:'Awaiting a source quote'}</b><small>U.S. listings · Yahoo Finance</small></span></div>
    </div>
    <footer className="pr-tools"><details><summary>How alerts work</summary><p>The first quote sets the starting price. Checks include available pre-market and after-hours quotes and start a new baseline after gaps over 30 minutes. Saved zones retain their original prices and date. Notifications appear in Activity &amp; alerts. Alert rules never place orders.</p></details>
      <button className="text-button" aria-controls={privacyId} aria-expanded={showPrivacy} onClick={()=>setShowPrivacy(!showPrivacy)}><LockKey size={14}/>Privacy settings</button>
      <button className="text-button" onClick={onJournal}>Broker trade journal</button>{onPortfolios&&<button className="text-button" onClick={onPortfolios}>Portfolios</button>}</footer>
    <div id={privacyId} hidden={!showPrivacy}>{showPrivacy&&<PortfolioPrivacyControls/>}</div>
  </section>;
}
