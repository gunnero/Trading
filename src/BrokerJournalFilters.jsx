import {useId,useRef,useState} from 'react';
import {CalendarBlank,CaretDown} from '@phosphor-icons/react';
import {usePortfolioPrivacy} from './PortfolioPrivacy';

const calendarDate=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
const day=value=>new Date(value+'T00:00:00Z');
function rangeLabel(from,to){
  if(from&&to)return calendarDate.formatRange(day(from),day(to));
  if(from)return 'From '+calendarDate.format(day(from));
  if(to)return 'Through '+calendarDate.format(day(to));
  return 'All dates';
}
export const emptyFilters={person:'',account:'',ticker:'',stock:'',from:'',to:''};
export default function BrokerJournalFilters({filters,options,apply}){
  const p=usePortfolioPrivacy(),rangeId=useId(),panel=useRef(),[draft,setDraft]=useState({from:'',to:''}),[searching,setSearching]=useState(false);
  const {person,account,ticker,stock,from,to}=filters;
  return <div className="bj-filters" role="group" aria-label="Broker journal filters">
    <label>Person<select value={person} onChange={e=>apply({...filters,person:e.target.value,account:'',ticker:''})}>
      <option value="">Everyone</option>{options.people.map(o=><option key={o.id} value={o.id}>{p.person(o.name)}</option>)}</select></label>
    <label>Account<select value={account} onChange={e=>apply({...filters,account:e.target.value,ticker:''})}>
      <option value="">All accounts</option>{options.accounts.filter(a=>!person||a.personId===person).map(a=><option key={a.id} value={a.id}>
        {p.person(options.people.find(o=>o.id===a.personId)?.name)} · {p.label(a.label,a.id)}{a.environment==='demo'?' · DEMO':''}</option>)}</select></label>
    <label>Stock<select value={searching?'search':ticker} onChange={e=>{
      const value=e.target.value;if(apply({...filters,ticker:value==='search'?'':value,stock:''}))setSearching(value==='search');
    }}><option value="">All stocks</option>{options.listings.map(l=><option key={l.ticker} value={l.ticker}>{l.ticker} · {l.name}</option>)}
      <option value="search">Search by company or ticker…</option></select></label>
    <div className="bj-range"><span className="bj-range-label">Date range
      {(Object.values(filters).some(Boolean)||searching)&&<button className="text-button bj-clear" onClick={()=>{if(apply(emptyFilters))setSearching(false);}}>Clear filters</button>}</span><button type="button" popoverTarget={rangeId} onClick={()=>setDraft({from,to})} aria-label={'Date range, '+rangeLabel(from,to)}><CalendarBlank/>{rangeLabel(from,to)}<CaretDown/></button>
      <div ref={panel} id={rangeId} className="bj-range-panel" popover="auto"><form onSubmit={e=>{e.preventDefault();if(apply({...filters,...draft}))panel.current.hidePopover();}}>
        <label>From<input type="date" value={draft.from} max={draft.to||undefined} onChange={e=>setDraft({...draft,from:e.target.value})}/></label>
        <label>To<input type="date" value={draft.to} min={draft.from||undefined} onChange={e=>setDraft({...draft,to:e.target.value})}/></label>
        <button type="button" className="text-button" onClick={()=>{if(apply({...filters,from:'',to:''}))panel.current.hidePopover();}}>All dates</button><button className="button primary">Apply dates</button>
      </form></div>
    </div>
    {searching&&<label>Search<input type="search" maxLength={80} value={stock} placeholder="Company or ticker" onChange={e=>apply({...filters,stock:e.target.value})}/></label>}
  </div>;
}
