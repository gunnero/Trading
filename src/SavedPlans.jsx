import {useEffect,useState} from 'react';
import {CaretDown,Circle,FloppyDisk,Info,Notebook,Trash} from '@phosphor-icons/react';
import {useDisplayTime} from './DisplayTime';
import {formatDate,formatPrice,zoneName,zoneText} from './data/market';
import {stageLabel} from './data/retests.mjs';
import './saved-plans.css';

function matches(plan,symbol,status){
  return (!symbol||plan.symbol===symbol)&&(!status||plan.priceMode===status);
}

function PlanFacts({plan}){
  const {quoteStamp}=useDisplayTime();
  const {marketKey,marketQuote,setupSnapshot:setup}=plan;
  const exchange=marketKey?.includes(':')?marketKey.split(':')[0]:({QQQ:'NASDAQ',SPY:'AMEX'}[plan.symbol]);
  const zone=setup?.zone;
  const opposite=setup?.direction&&setup.direction!==(plan.scenario==='continuation'?'bullish':'bearish');
  const confirmation=setup?(opposite?stageLabel(setup.stage)+' · '+setup.direction:stageLabel(setup.stage)):'Not recorded';
  return <>
    <dl className="draft-facts draft-quote">
      <div><dt>Listing</dt><dd>{exchange||'Not recorded'}</dd></div>
      <div><dt>Quote</dt><dd>{marketQuote?formatPrice(marketQuote.price):'—'}</dd>{marketQuote&&<small>{quoteStamp(marketQuote)}</small>}</div>
      <div><dt>Source</dt><dd>{marketQuote?.provider||(plan.priceMode==='sample'?'Legacy sample':'Not recorded')}</dd></div>
      <div><dt>Setup interval</dt><dd>{setup?.timeframe||'Not recorded'}</dd></div>
    </dl>
    <dl className="draft-facts draft-setup">
      <div><dt>{zone?'Zone ('+zoneName(zone.type).toLowerCase()+')':'Zone'}</dt><dd className={zone?.type==='D'?'green':zone?.type==='S'?'red':''}>{zone?zoneText(zone):'Not recorded'}</dd></div>
      <div><dt>Confirmation</dt><dd>{setup?<span className={'draft-stage'+(setup.stage==='confirmed'&&!opposite?' confirmed':'')}><Circle size={9} weight="fill"/>{confirmation}</span>:confirmation}</dd></div>
      <div><dt>Proposed expiration (unverified)</dt><dd>{formatDate(plan.expiration)}</dd></div>
    </dl>
  </>;
}

export default function SavedPlans({workspace,onNewPlan}){
  const {clockDate,quoteStamp}=useDisplayTime();
  const plans=workspace.data.plans;
  const [selected,setSelected]=useState(null);
  const [symbol,setSymbol]=useState(''),[status,setStatus]=useState('');
  const [edit,setEdit]=useState(null),[deleting,setDeleting]=useState(false),[submitted,setSubmitted]=useState(null);
  const symbols=[...new Set(plans.map(plan=>plan.symbol))].sort();
  const filtered=plans.filter(plan=>matches(plan,symbol,status));
  const plan=filtered.find(item=>item.id===selected)||filtered[0];
  const editing=!!plan&&edit?.id===plan.id;
  const thesis=editing?edit.thesis:plan?.thesis;
  const notes=editing?edit.notes:plan?.notes;
  const dirty=editing&&(thesis!==plan.thesis||notes!==plan.notes);
  useEffect(()=>{
    if(!dirty)return;
    const leave=event=>{if(!window.confirm('Discard unsaved plan and review notes?'))event.preventDefault();};
    const unload=event=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('desk:before-navigation',leave);
    window.addEventListener('beforeunload',unload);
    return ()=>{window.removeEventListener('desk:before-navigation',leave);window.removeEventListener('beforeunload',unload);};
  },[dirty]);
  function changeView(nextSymbol,nextStatus,id){
    const next=plans.filter(item=>matches(item,nextSymbol,nextStatus));
    const target=next.find(item=>item.id===id)||next[0];
    if(target?.id!==plan?.id){
      if(dirty&&!window.confirm('Discard unsaved plan and review notes?'))return;
      setEdit(null);setSubmitted(null);
    }
    setDeleting(false);setSelected(target?.id);setSymbol(nextSymbol);setStatus(nextStatus);
  }
  function updateText(field,value){
    setEdit({id:plan.id,thesis,notes,[field]:value});setSubmitted(null);
  }
  function save(event){
    event.preventDefault();
    if(!dirty)return;
    workspace.update(current=>({...current,plans:current.plans.map(item=>item.id===plan.id?{...item,thesis,notes}:item)}));
    setEdit(null);setSubmitted(plan.id);
  }
  function remove(){
    workspace.update(current=>({...current,plans:current.plans.filter(item=>item.id!==plan.id)}));
    setEdit(null);setDeleting(false);setSubmitted(null);setSelected(null);
    if(symbol&&!plans.some(item=>item.id!==plan.id&&item.symbol===symbol))setSymbol('');
  }
  return <section aria-label="Saved trade plans">
    <div className="draft-filters">
      <label>Symbol<select aria-label="Symbol" value={symbol} onChange={e=>changeView(e.target.value,status,plan?.id)}><option value="">All</option>{symbols.map(s=><option key={s}>{s}</option>)}</select></label>
      <label>Status<select aria-label="Status" value={status} onChange={e=>changeView(symbol,e.target.value,plan?.id)}><option value="">All drafts</option><option value="yahoo">Market drafts</option><option value="sample">Legacy samples</option></select></label>
    </div>
    <div className={'draft-workbench'+(!plan?' draft-workbench-empty':'')}>
      <div className="draft-index"><h2>{filtered.length} {filtered.length===1?'draft':'drafts'}</h2>
        <ul aria-label="Drafts">{filtered.map(item=><li key={item.id}><button type="button" aria-pressed={item.id===plan?.id} onClick={()=>changeView(symbol,status,item.id)}>
          <span className="draft-row-top"><strong>{item.symbol}</strong><span className="draft-tag">Draft</span></span>
          <span className="draft-row-title">{item.scenarioTitle}</span>
          {item.priceMode==='sample'&&<small className="draft-legacy">Legacy sample</small>}
          <small>{item.createdAt?'Created · '+clockDate(item.createdAt):'Session · '+formatDate(item.sessionDate)}</small>
          {item.marketQuote&&<small>Quote · {formatPrice(item.marketQuote.price)} · {quoteStamp(item.marketQuote)}</small>}
        </button></li>)}</ul>
      </div>
      {plan?<article className="draft-detail" aria-label={plan.symbol+' draft details'}>
        <header><div><strong>{plan.symbol}</strong><h2>{plan.scenarioTitle}</h2></div>
          <button className="button outline" aria-expanded={deleting} onClick={()=>setDeleting(!deleting)}><Trash/>Delete draft<CaretDown/></button></header>
        {deleting&&<div className="draft-delete" role="group" aria-label="Confirm draft deletion"><strong>Delete this {plan.symbol} draft and its notes?</strong>
          <button className="button outline" onClick={()=>setDeleting(false)}>Keep draft</button><button className="button outline draft-remove" onClick={remove}>Confirm deletion</button></div>}
        <PlanFacts plan={plan}/>
        <form onSubmit={save}>
          <label>Plan<textarea aria-label="Plan" rows={3} maxLength={10000} value={thesis} onChange={e=>updateText('thesis',e.target.value)}/></label>
          <label>Review notes<textarea aria-label={plan.symbol+' plan notes'} rows={3} maxLength={10000} placeholder="What confirmed or changed your view?" value={notes} onChange={e=>updateText('notes',e.target.value)}/></label>
          <div className="draft-terms"><span>{plan.strategy}</span>{plan.budget&&<span>Premium loss budget <b>${Number(plan.budget).toFixed(2)}</b></span>}</div>
          <footer><small><Info/>Saving a draft does not place a trade.</small><div>
            <span role="status">{dirty?'Unsaved changes':submitted===plan.id?({saved:'Changes saved',saving:'Saving…',pending:'Saving…',error:'Save failed',conflict:'Save conflict'}[workspace.status]):''}</span>
            <button className="button primary" disabled={!dirty}><FloppyDisk/>Save notes</button>
          </div></footer>
        </form>
      </article>:<div className="draft-empty"><Notebook size={29}/><h2>{plans.length?'No matching drafts':'No saved plans yet'}</h2>
        <p>{plans.length?'Try another symbol or status.':'Choose a setup on Overview to save your first plan.'}</p>
        <button className="button outline" onClick={plans.length?()=>changeView('','',null):onNewPlan}>{plans.length?'Clear filters':'Choose a setup'}</button>
      </div>}
    </div>
  </section>;
}
