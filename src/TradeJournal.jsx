import {brokerWorkspace,journalBroker} from './data/journal-brokers.mjs';
import IbkrJournal from './IbkrJournal';
import SessionReview from './SessionReview';
import PortfolioJournal from './PortfolioJournal';
import {PageHeader,useSectionNavigation} from './PageHeader';
import {useDisplayTime} from './DisplayTime';
import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {ArrowLeft,Plus,UploadSimple,DownloadSimple,X,Trash,ArrowUpRight,CheckCircle,ImageSquare,ArrowCounterClockwise} from '@phosphor-icons/react';
import {apiFetch} from './auth-client';
import {REVIEW_ITEMS,JOURNAL_TAGS,emptyJournal,validateTrade,validateJournal,localStamp,localToInstant,journalDay,parseJournalImport,planJournalImport,tradeResult,journalStats,money,duration} from './data/journal.mjs';
import './journal.css';
import './journal-trades.css';
import {JournalAnalysis,JournalFilters,JournalResults,JournalSummary} from './JournalDashboard';
import SavedPlans from './SavedPlans';
import {marketDay} from './data/calendar.mjs';

import {useJournalReplay} from './useJournalReplay';
import JournalTradeReview from './JournalTradeReview';
const contract=t=>`${t.symbol} ${t.strike} ${t.optionType==='CALL'?'Call':'Put'}`;
const accountKey=t=>JSON.stringify([t.firm,t.account]);
const tone=n=>n>0?'green':n<0?'red':'muted';
function download(trades,label){const blob=new Blob([JSON.stringify({format:'opening-bell-journal-v1',currency:'USD',label,trades})],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`opening-bell-trades-${journalDay(new Date())}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function JournalModal({title,children,onClose,review=false}){
  const {zoneLabel,formatLabel}=useDisplayTime();
  const ref=useRef(),id=useId();
  useEffect(()=>{const node=ref.current,trigger=document.activeElement,overflow=document.body.style.overflow;document.body.style.overflow='hidden';node.showModal();return()=>{node.close();document.body.style.overflow=overflow;if(trigger?.isConnected)trigger.focus({preventScroll:true});};},[]);
  const previousTitle=useRef(title);
  useEffect(()=>{
    if(review&&title!==previousTitle.current){
      ref.current.scrollTop=0;
      ref.current.querySelector('.journal-dialog-title h2')?.focus({preventScroll:true});
    }
    previousTitle.current=title;
  },[review,title]);
  function backdropClick(e){
    if(e.target!==e.currentTarget)return;
    const box=e.currentTarget.getBoundingClientRect();
    if(e.clientX<box.left||e.clientX>box.right||e.clientY<box.top||e.clientY>box.bottom)onClose();
  }
  return <dialog ref={ref} className={`modal wide journal-modal ${review?'journal-review-modal':''}`} aria-labelledby={id} onCancel={e=>{e.preventDefault();onClose();}} onClick={backdropClick}><div className="modal-inner"><header className="modal-header"><div className="journal-dialog-title">{review?<button type="button" className="icon-button" aria-label="Back to journal" onClick={onClose}><ArrowLeft size={20}/></button>:<span className="eyebrow">TRADE JOURNAL · {zoneLabel} / {formatLabel}</span>}<h2 id={id} tabIndex={review?-1:undefined}>{title}</h2></div><button className="icon-button" aria-label="Close trade dialog" onClick={onClose}><X size={22}/></button></header>{children}</div></dialog>;
}
function toForm(trade){const now=localStamp(new Date());return trade?{...trade,entryAt:localStamp(trade.entryAt),exitAt:trade.exitAt?localStamp(trade.exitAt):'',status:trade.exitAt?'closed':'open',fees:trade.fees??'',risk:trade.risk??'',reportedPnl:trade.reportedPnl??''}:{id:crypto.randomUUID(),firm:'Vanquish',account:'Main',symbol:'QQQ',expiration:now.slice(0,10),optionType:'CALL',position:'long',strike:'',quantity:1,multiplier:100,entryPrice:'',exitPrice:'',entryAt:now,exitAt:now,status:'closed',fees:'',risk:'',reportedPnl:'',review:Object.fromEntries(REVIEW_ITEMS.map(([key])=>[key,null])),tags:[],notes:'',source:'manual',sourceLabel:'Manual entry',entryOrderId:'',exitOrderId:''};}
function fromForm(form,saved){
  const opt=key=>form[key]===''?null:Number(form[key]);
  const instant=key=>saved?.[key]&&form[key]===localStamp(saved[key])?saved[key]:localToInstant(form[key]);
  return validateTrade({...form,symbol:form.symbol.trim().toUpperCase(),strike:Number(form.strike),quantity:Number(form.quantity),multiplier:Number(form.multiplier),entryPrice:Number(form.entryPrice),exitPrice:form.status==='open'?null:Number(form.exitPrice),entryAt:instant('entryAt'),exitAt:form.status==='open'?null:instant('exitAt'),fees:opt('fees'),risk:opt('risk'),reportedPnl:opt('reportedPnl')});}
function TradeEditor({trade,initialView='chart',onSave,onClose,onDelete,accounts,workspace,workspaceStatus,managed=false}){
  const [form,setForm]=useState(()=>toForm(trade)),initial=useRef(JSON.stringify(form)),[error,setError]=useState('');
  const [view,setView]=useState(trade?initialView:'details');
  const priorView=useRef(view);
  const replay=useJournalReplay(trade,workspace,view==='chart'||view==='chart-notes');
  const edit=(key,value)=>{setError('');setForm(v=>({...v,[key]:value}));};
  const close=()=>{if(JSON.stringify(form)!==initial.current&&!confirm('Discard the unsaved changes to this trade?'))return;onClose();};
  let result=null;try{result=tradeResult(fromForm(form,trade));}catch{}
  const input=(key,label,type='text',extra={})=><label>{label}<input type={type} value={form[key]??''} onChange={e=>edit(key,e.target.value)} {...extra}/></label>;
  const timeInput=(key,label)=>{const [date='',time='']=form[key].split('T'),disabled=key==='exitAt'&&form.status==='open';return <div className="journal-time-field"><span>{label} · Skopje</span><div><label><span className="sr-only">{label} date · Skopje</span><input type="date" required={!disabled} disabled={disabled} value={date} onChange={e=>edit(key,`${e.target.value}T${time}`)}/></label><label><span className="sr-only">{label} time · Skopje · 24h</span><input type="text" required={!disabled} disabled={disabled} placeholder="HH:MM:SS" maxLength={8} pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9])?" title="24-hour time, for example 16:19:54" value={time} onChange={e=>edit(key,`${date}T${e.target.value}`)}/></label></div></div>;};
  const save=async()=>{try{await onSave(fromForm(form,trade));}catch(e){setError(e.message);}};
  const editing=!trade||view==='edit';
  return <JournalModal title={trade?(editing?'Edit trade':'Trade review'):'Add a trade'} onClose={close} review={!!trade}>
    {trade&&!editing&&<JournalTradeReview trade={trade} replay={replay} form={form} edit={edit}
      view={view} onView={setView} onEdit={managed?null:()=>{priorView.current=view;setView('edit');}}
      dirty={JSON.stringify(form)!==initial.current} save={save} error={error} workspaceStatus={workspaceStatus}/>}
    {editing&&<form className="journal-form" onSubmit={e=>{e.preventDefault();save();}}>
    {trade&&<button type="button" className="text-button review-editor-back" onClick={e=>{if(e.currentTarget.form.reportValidity())setView(priorView.current);}}><ArrowLeft size={16}/>{priorView.current==='details'?'Return to details & notes':'Return to replay'}</button>}
    <p className="journal-help">One option entry and its matched exit per record. For partial exits, record each matched quantity separately. Entry fields use Europe/Skopje, 24-hour time; premiums are per underlying share in USD.</p>
    <div className="journal-form-grid">{input('firm','Prop firm / broker','text',{required:true,maxLength:60})}{input('account','Trading account','text',{required:true,maxLength:80,list:'journal-accounts'})}<label>Position status<select value={form.status} onChange={e=>edit('status',e.target.value)}><option value="closed">Closed</option><option value="open">Open</option></select></label></div>
    <datalist id="journal-accounts">{accounts.map(a=><option key={a} value={a}/>)}</datalist>
    <fieldset><legend>Option contract</legend><div className="journal-form-grid">{input('symbol','Underlying symbol','text',{required:true,maxLength:12,autoCapitalize:'characters'})}{input('expiration','Expiration date','date',{required:true})}{input('strike','Strike price','number',{required:true,min:0.001,step:0.001})}<label>Option type<select value={form.optionType} onChange={e=>edit('optionType',e.target.value)}><option>CALL</option><option>PUT</option></select></label><label>Position<select value={form.position} onChange={e=>edit('position',e.target.value)}><option value="long">Long · buy to open</option><option value="short">Short · sell to open</option></select></label>{input('quantity','Matched contracts','number',{required:true,min:1,max:10000,step:1})}</div></fieldset>
    <fieldset><legend>Execution</legend><div className="journal-form-grid two">{timeInput('entryAt','Entry')}{timeInput('exitAt','Exit')}{input('entryPrice','Entry premium','number',{required:true,min:0.0001,step:0.0001})}{input('exitPrice','Exit premium','number',{required:form.status==='closed',disabled:form.status==='open',min:0,step:0.0001})}{input('fees','Total fees · USD (optional)','number',{min:0,step:0.01,placeholder:'Unknown · enter 0 only if confirmed'})}{input('risk','Initial risk · USD (optional)','number',{min:0.01,step:0.01,placeholder:'Planned maximum loss'})}</div>
      <details className="journal-extra"><summary>Multiplier, order IDs & reported P/L</summary><div className="journal-form-grid two">{input('multiplier','Contract multiplier','number',{required:true,min:1,max:1000,step:1})}{input('reportedPnl','Platform-reported P/L (optional)','number',{step:0.01})}{input('entryOrderId','Entry order ID','text',{maxLength:80})}{input('exitOrderId','Exit order ID','text',{maxLength:80})}</div><p className="journal-help">Standard U.S. equity options usually use 100; confirm adjusted contracts. Reported P/L is retained separately because its fee basis may be unknown.</p></details>
    </fieldset>
    <div className="journal-trade-result"><div><small>Calculated gross P/L</small><strong className={tone(result?.gross)}>{money(result?.gross??null)}</strong></div><div><small>Net after fees</small><strong>{money(result?.net??null)}</strong></div><div><small>Holding time</small><strong>{duration(result?.seconds??null)}</strong></div><div><small>Gross R</small><strong>{result?.r!=null?result.r.toFixed(2)+'R':'—'}</strong></div></div>
    <details className="journal-extra"><summary>Your own strategy notes (optional)</summary><fieldset><legend>Your assessment</legend><p className="journal-help">Keep your own observations alongside the automatic checks. These notes do not change the automatic result.</p><div className="journal-checklist">{REVIEW_ITEMS.map(([key,label])=><label key={key}><span>{label}</span><select value={form.review[key]===null?'unknown':String(form.review[key])} onChange={e=>edit('review',{...form.review,[key]:e.target.value==='unknown'?null:e.target.value==='true'})}><option value="unknown">Not reviewed</option><option value="true">Yes</option><option value="false">No</option></select></label>)}</div></fieldset></details>
    <div className="journal-tags" role="group" aria-label="Trade tags">{JOURNAL_TAGS.map(tag=><button type="button" key={tag} aria-pressed={form.tags.includes(tag)} onClick={()=>edit('tags',form.tags.includes(tag)?form.tags.filter(t=>t!==tag):[...form.tags,tag])}>{tag}</button>)}</div>
    <label>Review notes<textarea value={form.notes} maxLength={2000} rows={4} placeholder="Why did you enter? What did you follow or miss? What will you change next time?" onChange={e=>edit('notes',e.target.value)}/></label>
    <p className="journal-help">Source: {form.sourceLabel||form.source}. {result?.returnPct!=null&&`Gross premium return: ${result.returnPct.toFixed(2)}%. `}Open records are excluded from performance. Blank fees and risk remain unknown.</p>
    {error&&<p role="alert" className="amber">{error}</p>}<footer className="journal-form-actions">{trade&&<button type="button" className="text-button red" onClick={()=>{if(confirm('Delete this trade from the journal? You can undo the removal.'))onDelete(trade.id);}}><Trash size={17}/>Delete trade</button>}<button type="button" className="button outline" onClick={close}>Cancel</button><button type="submit" className="button primary">{trade?'Save trade':'Add trade'}</button></footer>
  </form>}</JournalModal>;
}
function ImportTrades({prepared,existing,onImport,onClose}){
  const {zoneLabel,journalStamp}=useDisplayTime();
  const [packet,setPacket]=useState(prepared||null),[raw,setRaw]=useState(''),[error,setError]=useState(''),[verified,setVerified]=useState(false),[firm,setFirm]=useState(prepared?.trades[0]?.firm||'Vanquish'),[account,setAccount]=useState(prepared?.trades[0]?.account||'Main');
  const load=text=>{setPacket(null);setVerified(false);setError('');try{const next=parseJournalImport(text);setPacket(next);setFirm(next.trades[0].firm);setAccount(next.trades[0].account);}catch(e){setError(e.message);}};
  const mixedAccounts=!!packet&&new Set(packet.trades.map(accountKey)).size>1;
  const rows=packet?.trades.map(t=>mixedAccounts?t:({...t,firm:firm.trim(),account:account.trim()}))||[];let plan={added:[],duplicates:0},problem='';try{plan=planJournalImport(existing,rows);}catch(e){problem=e.message;}
  return <JournalModal title="Review trade import" onClose={onClose}><div className="journal-import">
    <p>Import the journal file prepared from your daily screenshot, or add trades manually. Review every record before it enters your results. Screenshot images cannot be imported directly.</p>
    <label className="journal-file-input">Choose a reviewed journal file<input type="file" accept=".json,application/json" onChange={async e=>{const file=e.target.files[0];if(!file)return;setPacket(null);setVerified(false);if(file.size>2000000){setError('Choose a JSON file under 2 MB.');return;}try{load(await file.text());}catch{setError('Could not read this file.');}e.target.value='';}}/></label>
    <details className="journal-extra"><summary>Or paste reviewed journal JSON</summary><textarea aria-label="Reviewed journal JSON" rows={5} value={raw} onChange={e=>setRaw(e.target.value)}/><button className="button outline" disabled={!raw.trim()} onClick={()=>load(raw)}>Preview import</button></details>
    {packet&&<><div className="journal-import-heading"><ImageSquare size={24}/><div><strong>{packet.label}</strong><small>{rows.length} records · USD · times shown in {zoneLabel}</small></div></div>
      <div className="journal-form-grid two" hidden={mixedAccounts}><label>Prop firm / broker<input value={firm} maxLength={60} onChange={e=>{setFirm(e.target.value);setVerified(false);}}/></label><label>Trading account<input value={account} maxLength={80} onChange={e=>{setAccount(e.target.value);setVerified(false);}}/></label></div>
      {mixedAccounts&&<p className="journal-help">Multiple accounts in this file. Each record keeps its original firm and account.</p>}
      <div className="journal-import-rows">{rows.map((t,i)=>{const r=tradeResult(t);return <article key={i}><header><strong>{contract(t)}</strong><b className={tone(r.gross)}>{money(r.gross)} <small>gross</small></b></header><p>{t.firm} · {t.account}<br/>Expires {t.expiration} · {t.position} · {t.quantity} {t.quantity===1?'contract':'contracts'} × {t.multiplier}</p><div><span>Entry<strong>{journalStamp(t.entryAt)}</strong>{money(t.entryPrice)}</span><span>Exit<strong>{journalStamp(t.exitAt)}</strong>{money(t.exitPrice)}</span></div><small>Fees: {t.fees===null?'Unknown':money(t.fees)} · Reported P/L: {money(t.reportedPnl)} (basis not supplied)</small></article>;})}</div>
      <p className="journal-help">{plan.duplicates} duplicate records will be skipped; their saved notes and fees stay unchanged. {plan.added.filter(t=>t.fees===null).length} new records have unknown fees; net P/L stays unavailable for those trades.</p>
      <label className="journal-confirm"><input type="checkbox" checked={verified} onChange={e=>setVerified(e.target.checked)}/>I checked the account, contracts, quantities, prices and times against my source.</label>
    </>}
    {(error||problem)&&<p role="alert" className="amber">{error||problem}</p>}<footer className="journal-form-actions"><button className="button outline" onClick={onClose}>Cancel</button><button className="button primary" disabled={!verified||!plan.added.length||!!problem||!firm.trim()||!account.trim()} onClick={()=>{try{onImport(rows);}catch(e){setError(e.message);}}}>Import {plan.added.length} {plan.added.length===1?'trade':'trades'}</button></footer>
  </div></JournalModal>;
}
export function JournalTrades({workspace,tradeId,onClearTrade,nav,missing,managed=false,title="Vanquish journal",extra,onConnect}){
  const [symbol,setSymbol]=useState('');
  const trades=workspace.data.journal?.trades||[],[month,setMonth]=useState(()=>journalDay(new Date()).slice(0,7)),[allTime,setAllTime]=useState(false),[account,setAccount]=useState(''),[query,setQuery]=useState(''),[day,setDay]=useState(''),[editor,setEditor]=useState(null),[importing,setImporting]=useState(null),[drafts,setDrafts]=useState([]),[draftError,setDraftError]=useState(''),[notice,setNotice]=useState(''),[removed,setRemoved]=useState(null);
  useEffect(()=>{const trade=tradeId?trades.find(t=>t.id===tradeId):null;setEditor(trade?{trade}:null);},[tradeId]);
  const closeEditor=()=>{setEditor(null);if(tradeId)onClearTrade();};
  useEffect(()=>{if(managed)return;const controller=new AbortController();apiFetch('/api/journal/drafts',{signal:controller.signal}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.message);if(!controller.signal.aborted){setDrafts(d.drafts);setDraftError(d.message||'');}}).catch(e=>{if(!controller.signal.aborted)setDraftError(e.message);});return()=>controller.abort();},[]);
  const accounts=[...new Map(trades.map(t=>[accountKey(t),t])).values()];
  const matching=useMemo(()=>trades.filter(t=>(!symbol||t.symbol===symbol)&&(!account||accountKey(t)===account)
    &&(!query||[t.symbol,t.optionType,...t.tags].join(' ').toLowerCase().includes(query.toLowerCase()))),[trades,symbol,account,query]);
  const filtered=useMemo(()=>matching.filter(t=>{
    const date=journalDay(t.exitAt||t.entryAt);
    return (allTime||date.startsWith(month))&&(!day||date===day);
  }),[matching,allTime,month,day]);
  const stats=useMemo(()=>journalStats(filtered),[filtered]);
  const calendarStats=useMemo(()=>journalStats(matching.filter(t=>t.exitAt&&journalDay(t.exitAt).startsWith(month))),[matching,month]);
  const prepared=drafts.filter(d=>d.trades.every(t=>journalBroker(t)==='trades')).filter(d=>{try{return planJournalImport(trades,d.trades).added.length;}catch{return true;}});
  const changeMonth=value=>{if(!/^\d{4}-\d{2}$/.test(value))return;setMonth(value);setAllTime(false);setDay('');};
  function update(change){return workspace.update(current=>({...current,journal:validateJournal(change(current.journal||emptyJournal()))}));}
  async function save(trade){if(!managed&&journalBroker(trade)!=='trades')throw Error('Use the matching broker journal for this trade.');if(managed&&JSON.stringify(trades.find(t=>t.id===trade.id))!==JSON.stringify(editor.trade))throw Error('This IBKR trade changed during review. Copy your notes, then reopen it before saving.');await update(j=>({...j,trades:editor?.trade?j.trades.map(t=>t.id===trade.id?trade:t):[...j.trades,trade]}));closeEditor();setNotice(managed?'IBKR notes saved.':'Trade updated. Changes save to your workspace.');}
  function importRows(rows){if(rows.some(t=>journalBroker(t)!=='trades'))throw Error('Import Vanquish trades here. IBKR and Trading 212 have separate journals.');let n=0;update(j=>{const plan=planJournalImport(j.trades,rows);n=plan.added.length;return {...j,trades:[...j.trades,...plan.added]};});setImporting(null);setNotice(`${n} trades added. Changes save to your workspace.`);if(rows.length)changeMonth(journalDay(rows[0].exitAt||rows[0].entryAt).slice(0,7));}
  function remove(id){const t=trades.find(t=>t.id===id);update(j=>({...j,trades:j.trades.filter(t=>t.id!==id)}));setRemoved(t);closeEditor();setNotice('Trade removed.');}
  const actions=<>
    {!managed&&<><button className="button primary" onClick={()=>setEditor({trade:null})}><Plus size={17}/>Add trade</button>
    <button className="button outline" aria-label="Import trades" onClick={()=>setImporting({})}><UploadSimple size={17}/>Import</button></>}
    <button className="button outline" disabled={!filtered.length} onClick={()=>download(filtered,'Journal export')}><DownloadSimple size={17}/>Export</button>
  </>;
  return <div className="journal-page jt-page">
    <PageHeader title={title} description="Review your executions and improve your process." actions={actions}/>
    {nav}
    {extra}
    {missing&&<p className="journal-help amber" role="status">This trade is no longer in the journal.</p>}
    {prepared.map(d=><div className="journal-prepared" key={d.id}><ImageSquare size={23}/><div><strong>Screenshot ready to review</strong><span>{d.label} · not yet added to your results</span></div><button className="button outline" onClick={()=>setImporting({prepared:d})}>Review import<ArrowUpRight size={16}/></button></div>)}
    {draftError&&<p className="journal-help amber" role="status">{draftError}</p>}
    {notice&&<div className="journal-notice" role="status"><CheckCircle size={18}/><span>{notice}</span>{removed&&<button className="text-button" onClick={()=>{try{update(j=>({...j,trades:[...j.trades,removed]}));setRemoved(null);setNotice('Trade restored.');}catch(e){setNotice(e.message);}}}><ArrowCounterClockwise size={15}/>Undo removal</button>}<button className="icon-button" aria-label="Dismiss journal message" onClick={()=>setNotice('')}><X size={15}/></button></div>}
    <JournalFilters trades={trades} accounts={accounts} accountKey={accountKey} month={month} allTime={allTime}
      onMonth={changeMonth} onAllTime={()=>{setAllTime(true);setDay('');}} account={account} onAccount={setAccount}
      symbol={symbol} onSymbol={setSymbol} query={query} onQuery={setQuery} day={day} onClearDay={()=>setDay('')}/>
    <JournalSummary stats={stats}/>
    <JournalAnalysis stats={stats} calendarStats={calendarStats} month={month} onMonth={changeMonth} day={day}
      onDay={value=>{setDay(value);setAllTime(false);}}/>
    <JournalResults trades={filtered} stats={stats} hasTrades={!!trades.length} onOpen={(trade,view)=>setEditor({trade,view})}
      addLabel={managed?'Connection settings':undefined} onAdd={()=>managed?onConnect?.():setEditor({trade:null})}/>
    {editor&&<TradeEditor managed={managed} key={editor.trade?.id??'new'} trade={editor.trade} initialView={editor.view} workspace={workspace.data} workspaceStatus={workspace.status} accounts={[...new Set(trades.map(t=>t.account))]} onSave={save} onClose={closeEditor} onDelete={remove}/>}
    {importing&&<ImportTrades prepared={importing.prepared} existing={trades} onImport={importRows} onClose={()=>setImporting(null)}/>}
  </div>;
}

export default function TradeJournal({workspace,tab='trades',tradeId:encodedId,onTab,onNewPlan,onReview,onClearTrade,reviewDay,onReviewDay}){
  const tabs=useSectionNavigation(tab);
  let tradeId='';try{tradeId=decodeURIComponent(encodedId||'');}catch{}
  const vanquish=brokerWorkspace(workspace,'trades');
  const other=brokerWorkspace(workspace,'other');
  const selected=workspace.data.journal?.trades.find(trade=>trade.id===tradeId);
  const nav=<nav ref={tabs} className="journal-page-tabs" aria-label="Trade journal sections"><button aria-current={tab==='trades'?'page':undefined} onClick={()=>onTab('trades')}>Vanquish</button><button aria-current={tab==='ibkr'?'page':undefined} onClick={()=>onTab('ibkr')}>IBKR</button><button aria-current={tab==='broker'?'page':undefined} onClick={()=>onTab('broker')}>Trading 212</button>{other.data.journal.trades.length>0&&<button aria-current={tab==='other'?'page':undefined} onClick={()=>onTab('other')}>Other imports</button>}<button aria-current={tab==='plans'?'page':undefined} onClick={()=>onTab('plans')}>Plans{tab!=='plans'&&tab!=='review'&&<span>{workspace.data.plans.length}</span>}</button><button aria-current={tab==='review'?'page':undefined} onClick={()=>onReview(selected?marketDay(selected.entryAt):undefined)}>Session review</button></nav>;
  if(tab==='ibkr')return <IbkrJournal workspace={workspace} nav={nav} tradeId={tradeId} onClearTrade={onClearTrade}/>;
  if(tab==='other')return <JournalTrades workspace={other} title="Other imported trades" nav={nav} managed onClearTrade={onClearTrade}/>;
  if(tab==='broker')return <div className="journal-page jt-page bj-page"><PageHeader title="Trading 212 journal" description="Trading 212 records with your own review notes."/>{nav}<PortfolioJournal/>{brokerWorkspace(workspace,'broker').data.journal.trades.length>0&&<JournalTrades workspace={brokerWorkspace(workspace,'broker')} title="Trading 212 option imports" managed onClearTrade={onClearTrade}/>}</div>;
  if(tab==='trades')return <JournalTrades workspace={vanquish} tradeId={tradeId} onClearTrade={onClearTrade} missing={tradeId&&!selected} nav={nav}/>;
  if(tab==='plans')return <div className="journal-page jt-page plans-page">
    <PageHeader title="Saved plans" description="Draft setups, separate from actual trades." actions={
      <button className="button primary" title="Choose a setup on Overview" onClick={onNewPlan}><Plus size={17}/>New plan</button>}/>
    {nav}<SavedPlans workspace={workspace} onNewPlan={onNewPlan}/>
  </div>;
  return <div className="journal-page jt-page review-page"><PageHeader title="Session review" description="Turn today’s trading into one useful lesson."/>
    {nav}<SessionReview onNewPlan={onNewPlan} workspace={vanquish} selectedDay={reviewDay} onDay={onReviewDay} onJournal={()=>onTab('trades')} onTrade={id=>onTab(`trades/${encodeURIComponent(id)}`)}/>
  </div>;
}
