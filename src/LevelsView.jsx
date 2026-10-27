import {useMemo,useState} from 'react';
import {UploadSimple,Info,MagnifyingGlass,CaretRight} from '@phosphor-icons/react';
import {formatDate,parseLevels,zoneText,zoneName} from './data/market';
import {levelDestination} from './data/level-listings.mjs';
import {levelSnapshots,compareLevelInstruments,LEVEL_HISTORY_DAYS} from './data/level-history.mjs';

function ZoneRow({zone,change}){
  return <div className={`level-row ${change==='Removed'?'level-zone-removed':''}`}><span className={zone.type==='S'?'red':zone.type==='D'?'green':'amber'}>{zoneName(zone.type)}</span><div>{change&&<small className="level-zone-change">{change}</small>}<strong>{zoneText(zone)}</strong></div></div>;
}

export function LevelsView({workspace,watchlist,onImport,onSelect}){
  const [query,setQuery]=useState(''),[selectedDate,setSelectedDate]=useState('latest'),[compareDate,setCompareDate]=useState('');
  const snapshots=useMemo(()=>levelSnapshots(workspace),[workspace.levelText,workspace.levelSourceDates,workspace.levelHistory]);
  const selected=snapshots.find(item=>item.date===selectedDate)||snapshots[0];
  const sheet=useMemo(()=>parseLevels(selected.levelText,selected.levelSourceDates),[selected]);
  const comparison=snapshots.find(item=>item.date===compareDate&&item.date!==selected.date);
  const previous=useMemo(()=>comparison?parseLevels(comparison.levelText,comparison.levelSourceDates):null,[comparison]);
  const historical=selected.date!==snapshots[0].date;
  const symbols=[...new Set([...Object.keys(sheet.instruments),...Object.keys(previous?.instruments||{})])];
  const entries=symbols.filter(symbol=>symbol.includes(query.trim().toUpperCase()));
  const count=Object.values(sheet.instruments).reduce((sum,item)=>sum+item.zones.length,0);
  const summary=previous?symbols.reduce((counts,symbol)=>{counts[compareLevelInstruments(sheet.instruments[symbol],previous.instruments[symbol]).status]++;return counts;},{changed:0,unchanged:0,added:0,removed:0}):null;
  const changeDate=value=>{setSelectedDate(value);if(value===compareDate||value==='latest'&&compareDate===snapshots[0].date)setCompareDate('');};
  return <section className="panel levels-page">
    <div className="section-heading"><div><h2>Key levels</h2><p>{formatDate(sheet.date)} · {Object.keys(sheet.instruments).length} instruments · {count} zones</p></div><button className="button outline" onClick={onImport}><UploadSimple size={18}/>Import levels</button></div>
    <div className="level-history-controls">
      <label>Level list<select aria-label="Level list date" value={historical?selected.date:'latest'} onChange={e=>changeDate(e.target.value)}>{snapshots.map((item,index)=><option key={item.date} value={index===0?'latest':item.date}>{formatDate(item.date)}{index===0?' · Latest':''}</option>)}</select></label>
      <label>Compare with<select aria-label="Compare levels with" value={comparison?.date||''} onChange={e=>setCompareDate(e.target.value)} disabled={snapshots.length<2}><option value="">No comparison</option>{snapshots.filter(item=>item.date!==selected.date).map(item=><option key={item.date} value={item.date}>{formatDate(item.date)}</option>)}</select></label>
      <span className="muted level-history-count">{snapshots.length} of {LEVEL_HISTORY_DAYS} daily lists saved</span>
      {historical&&<button className="text-button" onClick={()=>{setSelectedDate('latest');setCompareDate('');}}>Back to latest<CaretRight size={14}/></button>}
    </div>
    {historical&&<p className="notice level-history-notice">Viewing the saved {formatDate(sheet.date)} list. Historical levels are read-only; the latest list stays active for setups and scans.</p>}
    <div className="level-info"><Info size={18}/><p>S = supply · D = demand · G = gap. Each card keeps its original update date. Missing instruments carry forward. New imports retain the last five dated lists; a same-date correction replaces that day’s list.{snapshots.length===1?' Your first list is saved. Earlier dates will become available as you import new daily lists.':''}</p></div>
    {summary&&<div className="level-comparison-summary" role="status"><strong>{formatDate(sheet.date)} compared with {formatDate(previous.date)}</strong><span>{summary.changed} changed · {summary.unchanged} unchanged · {summary.added} added · {summary.removed} missing instruments</span><small>Added / removed describes zones in the selected list relative to the comparison list. Unchanged counts prices, roles and timeframes; update dates may differ.</small></div>}
    <label className="search-input levels-search"><MagnifyingGlass size={19}/><input aria-label="Search levels" placeholder="Find an instrument" value={query} onChange={e=>setQuery(e.target.value)}/></label>
    <div className="levels-grid">{entries.map(symbol=>{
      const item=sheet.instruments[symbol],old=previous?.instruments[symbol],shown=item||old,target=levelDestination(shown,watchlist),diff=previous?compareLevelInstruments(item,old):null;
      const label=historical?(['setup','chart'].includes(target.kind)?'View chart':target.kind==='choose'?'Choose listing':'View levels'):target.label;
      const open=()=>onSelect(shown,sheet,historical);
      return <article className="level-instrument" key={symbol} data-level-symbol={symbol}>
        <header><div><h3>{item?<button className="level-symbol-button" aria-label={`Open ${symbol} ${historical?'historical levels':target.kind==='setup'?'setup':target.kind==='chart'?'chart':'details'}`} onClick={open}>{symbol}</button>:symbol}</h3><span>{shown.timeframe}{shown.futures?' · Futures':target.entry?` · ${target.entry.exchange}`:''}</span></div>{item&&<button className="text-button level-card-action" aria-label={`${label} for ${symbol}`} onClick={open}>{label}<CaretRight size={14}/></button>}</header>
        {item&&<div className={`level-card-date ${item.carriedForward?'carried':''}`}><span>Levels updated <time dateTime={item.sourceDate}>{formatDate(item.sourceDate)}</time></span>{item.carriedForward&&<strong>Carried forward</strong>}</div>}
        {diff&&<div className="level-diff-heading"><strong>{({added:'Added instrument',removed:'Missing from selected list',changed:'Levels changed',unchanged:'Levels unchanged'})[diff.status]}</strong><span>{old?`Compared with ${formatDate(previous.date)} · levels updated ${formatDate(old.sourceDate)} · ${old.timeframe}${old.futures?' · Futures':''}`:'Not in the comparison list'}</span>{diff.metadataChanged&&<span>Timeframe or asset type changed</span>}</div>}
        <div>{item?.zones.map((zone,index)=><ZoneRow key={index} zone={zone} change={diff?(diff.added.includes(zone)?'Added':'Unchanged'):null}/>)}{diff?.removed.map((zone,index)=><ZoneRow key={`removed-${index}`} zone={zone} change="Removed"/>)}</div>
      </article>;
    })}</div>
    {!entries.length&&<div className="empty"><MagnifyingGlass size={30}/><h3>No matching levels</h3><p>Try a different instrument symbol.</p></div>}
  </section>;
}
