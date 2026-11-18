import {useRef,useState} from 'react';
import {CaretDown,CaretRight,FunnelSimple,MagnifyingGlass,Plus,Trash,UploadSimple,XCircle} from '@phosphor-icons/react';
import {useDisplayTime} from './DisplayTime';
import {filterWatchlist} from './data/watchlist.mjs';
import {entryState,isExtendedQuote,quoteChange,quoteDelay,quoteKey,quotePrice,quoteTone} from './data/quotes.mjs';
import {zoneName,zoneText} from './data/market';
import './settings-watchlist.css';

const groups = new Map([['FUND','Funds'],['STOCKS','Stocks'],['DEPOSITARY RECEIPT','Depositary receipts'],['FUTURES','Futures'],['CRYPTO','Crypto']]);
const types = new Map([['STOCKS','Stock'],['DEPOSITARY RECEIPT','ADR'],['FUND','Fund'],['FUTURES','Futures'],['CRYPTO','Crypto']]);
const statusOptions = ['All','Testing supply','Testing demand','Approaching supply','Approaching demand','Between zones','No levels','Today’s levels ready','Dated levels','Checking level roles','Context','Cached / old quote','Unavailable'];
const sorts = {'Biggest move':'Biggest move (%)','Top gainers':'Top gainers (%)','Top losers':'Top losers (%)',Symbol:'Symbol A–Z',Default:'Watchlist order'};

function ListingRow({entry,sheet,result,onInspect,onRemove}){
  const {quoteStamp}=useDisplayTime();
  const quote=result?.quote;
  const state=entryState(entry,sheet,result);
  const zone=state.location?.zone;
  const name=quote?.name;
  return <tr data-watchlist-id={entry.id} onClick={event=>{
    if(event.target.closest('button'))return;
    const trigger=event.currentTarget.querySelector('.listing-symbol');
    trigger.focus({preventScroll:true});onInspect(entry);
  }}>
    <th scope="row"><button className="listing-symbol" onClick={()=>onInspect(entry)}>{entry.symbol}</button>
      {name&&name!==entry.symbol&&<small>{name}</small>}</th>
    <td className="listing-venue">{entry.exchange}</td>
    <td className="listing-kind"><span>{types.get(entry.group)||entry.group||'Unspecified'}</span></td>
    <td className="listing-price" data-label="Last price"><strong>{quotePrice(quote)}</strong>
      {quote&&<small title={quoteDelay(quote)}>{isExtendedQuote(quote)&&quote.session+' · '}{quoteStamp(quote)}</small>}</td>
    <td className={'listing-change '+quoteTone(quote)} data-label="Day change">{quoteChange(quote)}</td>
    <td className="listing-context">{zone&&<b>{zoneName(zone.type)} {zoneText(zone)} · </b>}
      {['Cached / old quote','Dated levels','Today’s levels ready','Checking level roles'].includes(state.label)&&<b>{state.label} · </b>}{state.reason}</td>
    <td className="listing-actions"><div><button className="icon-button" aria-label={'Open '+entry.id+' details'} onClick={()=>onInspect(entry)}><CaretRight/></button>
      <button className="icon-button" aria-label={'Remove '+entry.id+' from watchlist'} onClick={()=>onRemove(entry)}><Trash/></button></div></td>
  </tr>;
}

export function SettingsWatchlist({watchlist,sheet,quotes,onInspect,onAdd,onImport,onRemove,removedEntry,onUndoRemove,onDismissRemove}){
  const [query,setQuery]=useState(''),[asset,setAsset]=useState('All'),[status,setStatus]=useState('All');
  const [movement,setMovement]=useState('All'),[sort,setSort]=useState('Biggest move');
  const [collapsed,setCollapsed]=useState(new Set());
  const undo=useRef(null);
  const hasFilters=movement!=='All'||status!=='All'||sort!=='Biggest move';
  const clearFilters=()=>{setQuery('');setAsset('All');setMovement('All');setStatus('All');setSort('Biggest move');};
  const matches=filterWatchlist(watchlist,quotes,{query,group:asset,movement,sort})
    .filter(entry=>status==='All'||entryState(entry,sheet,quotes[quoteKey(entry)]).label===status);
  const buckets=new Map();
  for(const entry of matches){
    if(!buckets.has(entry.group))buckets.set(entry.group,[]);
    buckets.get(entry.group).push(entry);
  }
  const extraGroups=[...new Set(watchlist.map(entry=>entry.group))].filter(key=>!groups.has(key));
  const filters=['STOCKS','FUND','FUTURES','CRYPTO',...(watchlist.some(e=>e.group==='DEPOSITARY RECEIPT')?['DEPOSITARY RECEIPT']:[]),...extraGroups];
  const pending=watchlist.filter(entry=>!quotes[quoteKey(entry)]||quotes[quoteKey(entry)].status==='loading').length;
  function toggleGroup(key){
    setCollapsed(previous=>{const next=new Set(previous);if(next.has(key))next.delete(key);else next.add(key);return next;});
  }
  function remove(entry){
    onRemove(entry);
    requestAnimationFrame(()=>undo.current?.focus({preventScroll:true}));
  }
  function restore(){
    const id=removedEntry.entry.id;
    onUndoRemove();
    requestAnimationFrame(()=>document.querySelector('.listing-table tr[data-watchlist-id="'+CSS.escape(id)+'"] .listing-symbol')?.focus({preventScroll:true}));
  }
  return <section className="listing-manager" aria-labelledby="listing-title">
    <header className="listing-heading"><div><h2 id="listing-title">Watchlist · {watchlist.length} {watchlist.length===1?'symbol':'symbols'}</h2><p>Exact listings for your charts and scanner.</p></div>
      <div className="listing-heading-actions"><button className="button primary" onClick={()=>{clearFilters();setCollapsed(new Set());onAdd();}}><Plus/>Add symbol</button>
        <button className="button outline" onClick={onImport}><UploadSimple/>Import watchlist</button></div></header>
    <div className="listing-toolbar">
      <label className="listing-search"><MagnifyingGlass/><input type="text" aria-label="Search watchlist" placeholder="Search symbol, name or exchange…" value={query} onChange={e=>{setQuery(e.target.value);setCollapsed(new Set());}}/></label>
      <div className="listing-chips" role="group" aria-label="Filter asset group">{['All',...filters].map(key=><button key={key} aria-pressed={asset===key} onClick={()=>{setAsset(key);setCollapsed(new Set());}}>{groups.get(key)||key||'Unspecified'}</button>)}</div>
      <details className="listing-filters" onBlur={e=>{if(e.relatedTarget&&!e.currentTarget.contains(e.relatedTarget))e.currentTarget.open=false;}} onKeyDown={e=>{
        if(e.key==='Escape'){e.currentTarget.open=false;e.currentTarget.querySelector('summary').focus();}
      }}><summary><FunnelSimple/>Filters{hasFilters&&' · active'}</summary>
        <div><label>Status<select aria-label="Filter status" value={status} onChange={e=>setStatus(e.target.value)}>{statusOptions.map(label=><option key={label}>{label}</option>)}</select></label>
          <label>Movement<select aria-label="Filter movement" value={movement} onChange={e=>setMovement(e.target.value)}>{['All','Gainers','Losers','Unchanged'].map(label=><option key={label}>{label}</option>)}</select></label>
          <label>Sort within groups<select aria-label="Sort watchlist" value={sort} onChange={e=>setSort(e.target.value)}>{Object.entries(sorts).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
          <button className="text-button" onClick={clearFilters}>Reset</button></div></details>
    </div>
    <div className="listing-table-wrap"><table className="listing-table"><caption className="sr-only">Watchlist listings grouped by asset type</caption>
      <thead><tr>{['Symbol','Exchange','Type','Last price','Day change','What to watch'].map(label=><th scope="col" key={label}>{label}</th>)}<th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
      {[...groups.keys(),...extraGroups].filter(key=>buckets.has(key)).map(key=>{
        const rows=buckets.get(key),open=!collapsed.has(key);
        return <tbody key={key}><tr className="listing-group"><th scope="rowgroup" colSpan={7}><button onClick={()=>toggleGroup(key)} aria-expanded={open}>{open?<CaretDown/>:<CaretRight/>}{groups.get(key)||key||'Unspecified'} ({rows.length})</button></th></tr>
          {open&&rows.map(entry=><ListingRow key={entry.id} entry={entry} result={quotes[quoteKey(entry)]} sheet={sheet} onInspect={onInspect} onRemove={remove}/>)}</tbody>;
      })}</table>
      {!matches.length&&<div className="listing-empty">
        {!watchlist.length?<><h3>Your watchlist is empty</h3><button className="button primary" onClick={onAdd}><Plus/>Add your first symbol</button></>:<><h3>No symbols match</h3><button className="button outline" onClick={clearFilters}>Reset filters</button></>}
      </div>}</div>
    <footer className={'listing-source'+(removedEntry?' has-undo':'')}>
      {removedEntry&&<div className="listing-undo"><button className="icon-button" aria-label="Dismiss removal notice" onClick={onDismissRemove}><XCircle weight="fill"/></button><span role="status">Removed {removedEntry.entry.id}</span><button ref={undo} className="text-button" onClick={restore}>Undo</button></div>}
      <div className="listing-attribution"><span>Yahoo Finance · Source times shown per quote</span><span role="status">{pending>0?'Loading '+pending+' quotes…':'Missing data is not a trading recommendation.'}</span></div>
    </footer>
  </section>;
}
