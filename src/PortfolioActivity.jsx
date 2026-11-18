import {useCallback,useEffect,useId,useRef,useState} from 'react';
import {ArrowsClockwise,Bell,CaretDown,CaretLeft,CaretRight,Check,Info,LockKey,MagnifyingGlass,Receipt,Stack} from '@phosphor-icons/react';
import {PortfolioPrivacyControls,usePortfolioPrivacy} from './PortfolioPrivacy';
import {PageHeader} from './PageHeader';
import {useDisplayTime} from './DisplayTime';
import {portfolioEventLabel} from './data/portfolio-activity.mjs';
import {activityRequest} from './PortfolioNotifications';
import PortfolioActivityTable,{ActivityAccount} from './PortfolioActivityTable';
import './portfolio-activity-view.css';

const emptyFilters={person:'',account:'',stock:'',from:'',to:''};
const pageSize=6;

function HistoryCoverage({statuses}){
  const {clockDate,clockTime,zoneLabel,settings}=useDisplayTime(),privacy=usePortfolioPrivacy();
  const attention=s=>!!(s.error||s.tracking?.error||s.tracking?.historyError||s.tracking?.balanceError);
  const needsAttention=statuses.some(attention);
  const hasHistory=statuses.some(s=>s.complete||s.pages>0||Number.isFinite(s.firstExecutionAt));
  const complete=statuses.length>0&&statuses.every(s=>s.complete);
  const starts=statuses.map(s=>s.firstExecutionAt).filter(Number.isFinite),ends=statuses.map(s=>s.lastExecutionAt).filter(Number.isFinite);
  const formatter=new Intl.DateTimeFormat('en-GB',{timeZone:settings.timeZone,day:'numeric',month:'short',year:'numeric'});
  const status=needsAttention?'Needs attention':complete?'History imported':statuses.every(s=>!s.connected)?'Disconnected':hasHistory?'Partial import':'Awaiting import';
  return <details className="pa-coverage" open><summary><Stack size={21}/>Connections &amp; history coverage<CaretDown size={16}/></summary>
    {!statuses.length?<p>No broker history for this selection.</p>:<div className="pa-coverage-block"><dl>
      <div><dt>Import status</dt><dd className={complete&&!needsAttention?'green':'amber'}>{status}</dd></div>
      <div><dt>Imported execution dates ({zoneLabel})</dt><dd>{starts.length&&ends.length?formatter.formatRange(Math.min(...starts),Math.max(...ends)):'—'}</dd></div>
      <div><dt>Coverage</dt><dd>{complete?'Trades & orders':hasHistory?'Trades & orders (partial)':'Awaiting records'}</dd></div>
      <div><dt>Data source</dt><dd>Trading 212</dd></div></dl>
      <details className="pa-history-accounts" key={needsAttention?'attention':'normal'} open={needsAttention}><summary>Connection details · {statuses.length} {statuses.length===1?'account':'accounts'}</summary>
        {statuses.map(s=><article key={s.accountId}><strong><ActivityAccount item={s}/></strong>
          <p>{!s.connected?'Disconnected · saved history':s.complete?'History imported':'Importing history · '+s.pages+' pages read'}
            {s.checkedAt&&' · Checked '+clockDate(s.checkedAt)+', '+clockTime(s.checkedAt)+' '+zoneLabel}</p>
          {s.tracking?.checkedAt&&<p>Orders checked {clockDate(s.tracking.checkedAt)}, {clockTime(s.tracking.checkedAt)} {zoneLabel}</p>}
          {[s.error,s.tracking?.error,s.tracking?.historyError,s.tracking?.balanceError].filter(Boolean).map((message,i)=><p className="amber" key={i}>{privacy.privateMode?'A broker connection check needs attention.':message}</p>)}
        </article>)}
        <p>Connected accounts check tracked orders every 15 seconds. Confirmed executions refresh holdings and cash.</p>
      </details></div>}</details>;
}

function ActivityAlerts({items}){
  const privacy=usePortfolioPrivacy(),{journalStamp}=useDisplayTime();
  return <ul className="pa-alert-list">{items.map(item=><li key={item.eventId} className={item.read?'':'unread'}><Bell size={20}/><div>
    <strong>{item.name||item.ticker} · {portfolioEventLabel(item)}</strong>
    {item.kind==='price'?<p>{privacy.money(item.price,item.currency)} · {item.session} · Yahoo Finance · observed {journalStamp(item.observedAt)}</p>:
      !['health','concentration'].includes(item.kind)&&<p>{item.side} {privacy.number(item.filledQuantity)} of {privacy.number(item.quantity)} shares{item.orderId!=null?' · Order '+item.orderId:''}</p>}
    {item.message&&!privacy.privateMode&&<p>{item.message}</p>}<div className="pa-account"><ActivityAccount item={item}/></div>
    <small>{journalStamp(item.at)} · {item.read?'Read':'Unread'}</small>
  </div></li>)}</ul>;
}

export default function PortfolioActivity({notifications,watchlist=[],onPortfolios}){
  const privacy=usePortfolioPrivacy(),{settings}=useDisplayTime();
  const [kind,setKind]=useState('trades'),[filters,setFilters]=useState(emptyFilters),[offset,setOffset]=useState(0);
  const [saved,setSaved]=useState(null),[meta,setMeta]=useState({people:[],accounts:[]}),[error,setError]=useState(''),[loading,setLoading]=useState(false),[marking,setMarking]=useState(false);
  const [showPrivacy,setShowPrivacy]=useState(false),privacyId=useId();
  const controller=useRef(null),active=useRef(false),sequence=useRef(0);
  const query=new URLSearchParams({...filters,kind,offset,limit:pageSize,timeZone:settings.timeZone}).toString(),data=saved?.query===query?saved.data:null;
  const refresh=useCallback(async()=>{
    controller.current?.abort();const ac=new AbortController();controller.current=ac;const seq=++sequence.current;setLoading(true);
    try{
      const result=await activityRequest('activity?'+query,undefined,ac.signal);
      if(active.current&&seq===sequence.current){
        if(offset>0&&offset>=result.total)setOffset(Math.max(0,Math.floor((result.total-1)/pageSize)*pageSize));
        setSaved({query,data:result});setMeta({people:result.people,accounts:result.accounts});setError('');
      }
    }catch(e){if(active.current&&!ac.signal.aborted&&seq===sequence.current)setError(e.message);}
    finally{if(active.current&&seq===sequence.current)setLoading(false);}
  },[query,offset]);
  useEffect(()=>{active.current=true;setError('');refresh();const visible=()=>{if(!document.hidden)refresh();},timer=setInterval(visible,15000);document.addEventListener('visibilitychange',visible);return()=>{active.current=false;controller.current?.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visible);};},[refresh]);
  const filter=(key,value)=>{setFilters(old=>({...old,[key]:value,...(key==='person'?{account:''}:{})}));setOffset(0);};
  const accounts=meta.accounts.filter(a=>!filters.person||a.personId===filters.person),statuses=data?.statuses.filter(s=>(!filters.account||s.accountId===filters.account)&&(!filters.person||accounts.some(a=>a.id===s.accountId)))||[];
  function selectKind(id){setKind(id);setOffset(0);}
  async function markAll(){setMarking(true);try{await notifications.markRead(notifications.feed.latestId);await refresh();}catch(e){setError(e.message);}finally{setMarking(false);}}
  return <div className="pa-page">
    <PageHeader title="Activity & alerts" actions={<>{onPortfolios&&<button className="button outline" onClick={onPortfolios}>Portfolios</button>}<button className="button primary" disabled={loading} onClick={()=>{refresh();notifications.refresh();}}><ArrowsClockwise size={17}/>{loading?'Refreshing…':'Refresh view'}</button></>}/>
    <div className="pa-summary"><Info size={19}/><span>Order updates continue in the background</span>
      <button className="pa-lock icon-button" title="Privacy settings" aria-label="Privacy settings" aria-expanded={showPrivacy} aria-controls={privacyId} onClick={()=>setShowPrivacy(!showPrivacy)}><LockKey size={17}/></button>
      <button type="button" className="pa-unread" title="Open alerts" onClick={()=>selectKind('alerts')}>{notifications.feed?notifications.feed.unread+' unread':'Checking alerts…'}</button></div>
    <div hidden={!showPrivacy} id={privacyId}>{showPrivacy&&<PortfolioPrivacyControls/>}</div>
    {notifications.error&&<p className="pa-error" role="status">Alerts could not be refreshed. {notifications.error}</p>}
    <section className="pa-panel" aria-label="Portfolio activity">
      <div className="pa-toolbar"><div className="pa-tabs" role="group" aria-label="Activity type">{[['trades','Trades'],['orders','Orders'],['alerts','Alerts']].map(([id,label])=><button key={id} aria-pressed={kind===id} onClick={()=>selectKind(id)}>{label}</button>)}</div>
        {kind==='alerts'&&<button className="button outline" disabled={marking||!notifications.feed?.unread} onClick={markAll}><Check size={15}/>Mark all read</button>}</div>
      <form className="pa-filters" onSubmit={e=>e.preventDefault()} aria-label="Activity filters">
        <label>Person<select aria-label="Person" value={filters.person} onChange={e=>filter('person',e.target.value)}><option value="">Everyone</option>{meta.people.map(p=><option key={p.id} value={p.id}>{privacy.person(p.name)}</option>)}</select></label>
        <label>Account<select aria-label="Account" value={filters.account} onChange={e=>filter('account',e.target.value)}><option value="">All accounts</option>{accounts.map(a=><option key={a.id} value={a.id}>{privacy.person(meta.people.find(p=>p.id===a.personId)?.name)} · {privacy.label(a.label,a.id)}{a.environment==='demo'?' · DEMO':''}</option>)}</select></label>
        <label>Stock<span className="pa-search"><MagnifyingGlass size={16}/><input aria-label="Stock" type="search" maxLength={80} placeholder="Search company or ticker" value={filters.stock} onChange={e=>filter('stock',e.target.value)}/></span></label>
        <label>From<input type="date" value={filters.from} onChange={e=>filter('from',e.target.value)}/></label>
        <label>To<input type="date" value={filters.to} onChange={e=>filter('to',e.target.value)}/></label>
        <button aria-label="Clear filters" className="button outline" type="button" onClick={()=>{setFilters(emptyFilters);setOffset(0);}}>Clear</button>
      </form>
      {error&&<p className="pa-error" role="alert">{error}{data?' Showing the last saved view.':''}</p>}
      {!data?<p className="pa-empty" role="status">{error?'This view could not be loaded.':'Loading activity…'}</p>:!data.items.length?<div className="pa-empty"><Receipt size={28}/><h2>No {kind} in this view</h2><p>{meta.accounts.length?'Try different filters or check the import status below.':'Connect a Trading 212 account in Portfolio Manager to begin.'}</p></div>:
        kind==='alerts'?<ActivityAlerts items={data.items}/>:<PortfolioActivityTable key={query} kind={kind} items={data.items} watchlist={watchlist}/>}
      {data&&<footer className="pa-pagination"><span aria-live="polite">{data.items.length?(offset+1)+'–'+(offset+data.items.length)+' of '+data.total:'0 records'}</span><div>
        <button className="button outline" aria-label="Previous" disabled={!offset||loading} onClick={()=>setOffset(Math.max(0,offset-pageSize))}><CaretLeft size={17}/></button>
        <button className="button outline" aria-label="Next" disabled={!data.more||loading} onClick={()=>setOffset(offset+pageSize)}><CaretRight size={17}/></button></div></footer>}
    </section>
    {data&&<HistoryCoverage statuses={statuses}/>}
  </div>;
}
