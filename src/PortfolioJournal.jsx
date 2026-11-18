import {useEffect,useId,useState} from 'react';
import {ArrowsClockwise,CaretLeft,CaretRight,CheckCircle,DownloadSimple,Info,LockKey} from '@phosphor-icons/react';
import {usePortfolioPrivacy,PortfolioPrivacyControls} from './PortfolioPrivacy';
import {useDisplayTime} from './DisplayTime';
import {activityRequest} from './PortfolioNotifications';
import {safeCsv} from './data/portfolio-insights.mjs';
import {usePortfolioResource,downloadPortfolioCsv} from './PortfolioTools';
import BrokerJournalTable,{executionKey} from './BrokerJournalTable';
import BrokerJournalFilters,{emptyFilters} from './BrokerJournalFilters';
import './broker-journal.css';

function Coverage({statuses}){
  const {clockDate}=useDisplayTime(),p=usePortfolioPrivacy();
  if(!statuses.length)return <p className="bj-coverage"><Info/>No broker history in this selection.</p>;
  const complete=statuses.every(s=>s.complete&&!s.error),offline=statuses.some(s=>!s.connected);
  const pageCounts=statuses.map(s=>s.complete?s.completedPages:s.pages);
  const pages=pageCounts.every(Number.isInteger)?pageCounts.reduce((a,b)=>a+b,0):null;
  const through=complete&&statuses.every(s=>Number.isFinite(s.coveredThrough))?Math.min(...statuses.map(s=>s.coveredThrough)):null;
  const status=complete?'History imported':statuses.some(s=>s.error)?'Import needs attention':'Partial history';
  const Icon=complete&&!offline?CheckCircle:Info;
  return <details className="bj-coverage"><summary><Icon className={complete&&!offline?'green':'amber'}/><span>
    {pages>0&&<><b>{pages} {pages===1?'page':'pages'} saved</b> · </>}
    {through?'Complete through '+clockDate(through):status}{offline?' · Includes disconnected accounts':''}</span></summary>
    {statuses.map(s=><p key={s.accountId}><b>{p.person(s.person)} · {p.label(s.accountLabel,s.accountId)}</b> · {s.error?(p.privateMode?'Check connection':s.error):s.complete?'History imported':'History incomplete'}</p>)}
  </details>;
}

export default function PortfolioJournal(){
  const privacy=usePortfolioPrivacy(),{settings,clockDate,clockTime,zoneLabel}=useDisplayTime(),privacyId=useId();
  const [filters,setFilters]=useState(emptyFilters),[offset,setOffset]=useState(0),[limit,setLimit]=useState(5);
  const [sort,setSort]=useState({field:'date',direction:'desc'}),[showPrivacy,setShowPrivacy]=useState(false);
  const [options,setOptions]=useState({people:[],accounts:[],listings:[]});
  const [editor,setEditor]=useState(null),[saving,setSaving]=useState(false),[noteError,setNoteError]=useState('');
  const numericSort=privacy.hideBalances&&['price','quantity','realized'].includes(sort.field);
  const field=numericSort?'date':sort.field,direction=numericSort?'desc':sort.direction;
  const query=new URLSearchParams({...filters,offset,limit,sort:field,direction,timeZone:settings.timeZone}).toString();
  const view=usePortfolioResource('journal?'+query,15000);
  const expanded=editor?.query===query?editor:null;
  const data=expanded?.page??view.data,trade=editor?.trade;
  const dirty=!!trade&&(editor.reason!==trade.note.reason||editor.notes!==trade.note.notes);
  useEffect(()=>{
    if(view.data)setOptions({people:view.data.people,accounts:view.data.accounts,listings:view.data.listings||[]});
  },[view.data]);
  useEffect(()=>{
    if(!dirty&&!saving)return;
    const protect=e=>{e.preventDefault();e.returnValue='';};
    window.addEventListener('beforeunload',protect);
    const leave=e=>{if(saving||!window.confirm('Discard your unsaved journal notes?'))e.preventDefault();};
    window.addEventListener('desk:before-navigation',leave);
    return ()=>{window.removeEventListener('beforeunload',protect);window.removeEventListener('desk:before-navigation',leave);};
  },[dirty,saving]);
  function close(){
    if(saving||(dirty&&!window.confirm('Discard your unsaved journal notes?')))return false;
    setEditor(null);setNoteError('');return true;
  }
  function select(t,notes=false){
    const key=executionKey(t);
    if(notes&&editor?.key===key)return;
    if(!close()||editor?.key===key)return;
    setEditor({key,query,trade:t,page:data,reason:t.note.reason,notes:t.note.notes,reasonOpen:!!t.note.reason});
  }
  async function save(e){
    e.preventDefault();
    if(!dirty||privacy.privateMode||saving)return;
    setSaving(true);setNoteError('');
    try{
      const note=await activityRequest('journal/notes',{accountId:trade.accountId,executionId:trade.id,
        brokerIdentity:trade.brokerId==null?undefined:trade.environment+':'+trade.brokerId,
        revision:trade.note.revision,reason:editor.reason,notes:editor.notes});
      const updated={...trade,note};
      setEditor({...editor,trade:updated,reason:note.reason,notes:note.notes,page:{...data,items:data.items.map(t=>executionKey(t)===editor.key?updated:t)}});
      await view.refresh();
    }catch(err){setNoteError(err.message);}finally{setSaving(false);}
  }
  function exportPage(){
    if(privacy.privateMode||!data?.items.length)return;
    const csv=safeCsv([['Person','Account','Environment','Executed (UTC)','Stock','Side','Shares','Price','Price currency','Realized P/L','Account currency','Execution ID','Reason','Notes','Broker ticker'],...data.items.map(t=>[t.person,t.accountLabel,t.environment,new Date(t.at).toISOString(),t.name,t.side,t.quantity,t.price,t.priceCurrency,t.realized,t.currency,t.id,t.note.reason,t.note.notes,t.ticker])]);
    downloadPortfolioCsv(csv,'broker-journal-page.csv');
  }
  const ids=new Set(data?.accounts.filter(a=>!filters.person||a.personId===filters.person).map(a=>a.id));
  const statuses=data?.statuses.filter(s=>ids.has(s.accountId)&&(!filters.account||s.accountId===filters.account))||[];
  const checked=statuses.reduce((last,s)=>Math.max(last,s.checkedAt||0),0);
  function sortBy(next,order){
    if(!close())return;
    const ascending=next===field?direction==='desc':next!=='date';
    setOffset(0);setSort({field:next,direction:order||(ascending?'asc':'desc')});
  }
  return <section className="bj-journal" aria-label="Automatic broker trade journal"><h2 className="sr-only">Broker trades</h2>
    <BrokerJournalFilters filters={filters} options={options} apply={next=>{if(!close())return false;setFilters(next);setOffset(0);return true;}}/>
    <div className="bj-source"><p>Trading 212 executions · imported automatically{checked>0&&' · Last checked '+clockDate(checked)+', '+clockTime(checked)+' '+zoneLabel}</p>
      <div><button className="icon-button" title="Privacy settings" aria-label="Privacy settings" aria-expanded={showPrivacy} aria-controls={privacyId} onClick={()=>setShowPrivacy(!showPrivacy)}><LockKey/></button>
        <button className="icon-button" aria-label="Refresh journal" title="Refresh journal" disabled={view.busy||saving} onClick={()=>{if(close())view.refresh();}}><ArrowsClockwise/></button>
        <button className="icon-button" aria-label="Export this page" title="Export this page" disabled={!data?.items.length||privacy.privateMode} onClick={exportPage}><DownloadSimple/></button>
      </div></div>
    {showPrivacy&&<div id={privacyId}><PortfolioPrivacyControls/></div>}
    {view.error&&<p role="alert" className="amber">{view.error}</p>}
    {!data?!view.error&&<p role="status">Loading broker executions…</p>:<>
      {data.items.length?<BrokerJournalTable rows={data.items} sort={field} direction={direction} onSort={sortBy} editor={expanded}
        onSelect={select} onChange={(key,value)=>setEditor(s=>s&&({...s,[key]:value}))} onSave={save} onClose={close} saving={saving} error={noteError}/>:
        <p className="bj-empty">{Object.values(filters).some(Boolean)?'No imported executions match these filters.':'No broker executions have been imported yet.'}</p>}
      {(data.total>5||offset>0)&&<div className="bj-pagination">
        <label>Rows per page <select value={limit} onChange={e=>{if(close()){setLimit(Number(e.target.value));setOffset(0);}}}>{[5,25,50].map(n=><option key={n}>{n}</option>)}</select></label>
        <span>{data.items.length?(offset+1)+'–'+(offset+data.items.length)+' of '+data.total:data.total+' records'}</span>
        <button className="icon-button" aria-label="Previous executions" disabled={!offset||view.busy||saving} onClick={()=>{if(close())setOffset(Math.max(0,offset-limit));}}><CaretLeft/></button>
        <button className="icon-button" aria-label="Next executions" disabled={!data.more||view.busy||saving} onClick={()=>{if(close())setOffset(offset+limit);}}><CaretRight/></button>
      </div>}
      <Coverage statuses={statuses}/>
    </>}
  </section>;
}
