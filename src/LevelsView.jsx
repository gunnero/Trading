import {useMemo,useState} from 'react';
import {UploadSimple,Info,MagnifyingGlass,CaretRight,CaretDown,ArrowRight,ArrowSquareOut,Clock} from '@phosphor-icons/react';
import {formatDate,formatPrice,parseLevels,zoneText,zoneName} from './data/market';
import {levelDestination} from './data/level-listings.mjs';
import {levelSnapshots,compareLevelInstruments,LEVEL_HISTORY_DAYS} from './data/level-history.mjs';
import {FOCUS_SYMBOLS,CONTEXT_SYMBOLS,levelChartKey,nearestLevelZones,zoneDistance} from './data/level-focus.mjs';
import {quotePrice,quoteDelay,entryState,isExtendedQuote} from './data/quotes.mjs';
import {useDisplayTime} from './DisplayTime';
import {useMarketChart} from './useMarketData';
import {useZoneRoles} from './ZoneRoles';
import {ChartHeader,ChartLevels,useSavedTimeframe} from './ChartSettings';
import {PriceChart} from './Charts';
import './levels.css';

const diffLabels={added:'Added instrument',removed:'Missing from selected list',changed:'Levels changed',unchanged:'Levels unchanged'};
function ZoneRow({zone,change}){
  return <div className={`level-row ${change==='Removed'?'level-zone-removed':''}`}><span className={zone.type==='S'?'red':zone.type==='D'?'green':'amber'}>{zoneName(zone.type)}</span><div>{change&&<small className="level-zone-change">{change}</small>}<strong>{zoneText(zone)}</strong></div></div>;
}
function NearZones({instrument,type,price}){
  const zones=nearestLevelZones(instrument.zones,type,price);
  return <section className="level-nearest-group" aria-label={`${zoneName(type)} zones`}>
    <div className="level-nearest-heading"><h3>{Number.isFinite(price)?'Nearest ':''}{zoneName(type).toLowerCase()} levels</h3><span>Price range</span><span>Distance</span></div>
    {zones.map((zone,index)=><div className={`level-nearest-row ${type==='S'?'supply':'demand'}`} key={index}><span className={type==='S'?'red':'green'}>{zoneName(type)}</span><strong>{zoneText(zone)}</strong><span>{Number.isFinite(price)?zoneDistance(zone,price)===0?'Inside':formatPrice(zoneDistance(zone,price)):'—'}</span></div>)}
    {!zones.length&&<p className="level-nearest-empty">No {zoneName(type).toLowerCase()} zones supplied.</p>}
  </section>;
}

function LevelFocus({item,old,sheet,previous,historical,destination,onSelect}){
  const imported=item||old,marketKey=item?levelChartKey(item,destination):null;
  const [timeframe,setTimeframe]=useSavedTimeframe(marketKey),history=useMarketChart(marketKey,timeframe,!!marketKey);
  const confirmation=useZoneRoles(item,sheet.date,marketKey,!!marketKey&&!historical);
  const roles=marketKey&&!historical&&confirmation.status!=='unsupported'?confirmation:null;
  // Pre-market is context from imported zones; regular-session flips remain separate.
  const instrument=isExtendedQuote(history.quote)?imported:roles?.instrument||imported;
  const {quoteStamp,zoneLabel}=useDisplayTime();
  const quote=history.quote,sourceDate=imported.sourceDate;
  const diff=previous?compareLevelInstruments(item,old):null;
  const [allOpen,setAllOpen]=useState(false);
  const context=historical?{label:'Historical reference',reason:'Original roles · setup checks use your latest list.',tone:'muted'}:!item?{label:'Comparison only',reason:'Not in the selected list.',tone:'muted'}:imported.futures?{label:'Futures reference',reason:'Contract basis may differ from your levels.',tone:'muted'}:!marketKey?{label:'Listing needed',reason:'Choose an exact exchange to connect a chart.',tone:'muted'}:entryState(destination.entry,{...sheet,instruments:{...sheet.instruments,[item.symbol]:instrument}},history);
  const distancePrice=context.location&&history.status==='ok'?quote?.price:null;
  const openLabel=historical?'Open reference':destination.kind==='setup'?'Open setup':destination.kind==='chart'?'Open chart':destination.kind==='choose'?'Choose listing':destination.label;
  return <div className="level-focus" data-level-symbol={imported.symbol}>
    <header className="level-focus-heading">
      <div className="level-focus-name"><h2>{imported.symbol}</h2><div><span>{imported.futures?'Futures':destination.entry?.exchange||'Listing not connected'}</span><small>Levels · {imported.timeframe} · <time dateTime={sourceDate}>{formatDate(sourceDate)}</time>{imported.carriedForward?' · Carried forward':''}</small></div></div>
      <div className="level-focus-price"><small>Last · Yahoo Finance</small><strong>{quotePrice(quote)}</strong></div>
      <div className="level-focus-location"><strong className={context.tone}>{context.label}</strong><small>{context.location?.zone?zoneText(context.location.zone):context.location?'No active level':historical?'Saved level list':imported.futures?'Reference overlays':history.status==='loading'?'Loading source…':'Comparisons paused'}</small></div>
      {item&&<button className="button outline level-focus-open" aria-label={`${openLabel} for ${item.symbol}`} onClick={()=>onSelect(item,sheet,historical)}><ArrowSquareOut size={18}/>{openLabel}</button>}
    </header>
    <div className="level-focus-source" role="status"><span>{quote?`${quoteStamp(quote)} · ${quoteDelay(quote)}`:marketKey?history.status==='loading'?'Loading Yahoo history…':'Yahoo history unavailable':'No verified chart mapping'}{history.status==='stale'?' · Cached / old history':''}</span><span>{historical?'Original supplied roles':roles?.status==='ok'&&!isExtendedQuote(quote)?`Auto-flip · ${imported.timeframe} closes`:'Imported reference zones'}</span></div>
    {(historical||!item||imported.futures||!context.location||isExtendedQuote(quote))&&<p className="level-focus-note">{historical?'These saved levels are shown over the available price history, not a historical replay.':context.reason}{quote&&sourceDate!==quote.sessionDate?` Levels ${sourceDate}; quote session ${quote.sessionDate}.`:''}</p>}
    {marketKey?<section className="level-focus-chart chart-panel" aria-label={`${imported.symbol} level chart`}>
      <ChartHeader symbol={imported.symbol} marketKey={marketKey} timeframe={timeframe} onTimeframe={setTimeframe} roles={roles}/>
      <ChartLevels scope={`${marketKey}|${timeframe}`} instrument={instrument} date={sourceDate} roles={roles} quoteDate={quote?.sessionDate}/>
      {history.candles?.length?<PriceChart symbol={imported.symbol} drawingKey={marketKey} timeframe={timeframe} candles={history.candles} price={quote?.price} instrument={instrument} indicators={history.indicators}/>:<div className="empty" role="status"><Clock size={28}/><h3>{history.status==='loading'?'Loading chart…':'Chart unavailable'}</h3><p>{history.message||'Your exact imported zones remain available below.'}</p></div>}
      <div className="chart-footnote"><span>{history.status==='stale'?'Cached / old history · ':''}{timeframe==='4h'?'4h from hourly bars · ':''}{zoneLabel} time · partial bars marked</span><span>{imported.futures?'Yahoo contract history':'Regular-session candles'}</span></div>
    </section>:<div className="level-focus-unavailable" role="status"><Info size={28}/><h3>{!item?'Instrument missing from this list':destination.kind==='choose'?'Choose a listing for this symbol':'Chart not connected'}</h3><p>{!item?'The zones below belong to the comparison list.':imported.futures?'No verified chart mapping is available for this instrument. Your supplied levels are shown below.':'Use the listing action above to choose the exact exchange. Your supplied levels are shown below.'}</p></div>}
    <div className="level-nearest"><NearZones instrument={instrument} type="S" price={distancePrice}/><NearZones instrument={instrument} type="D" price={distancePrice}/></div>
    <div className="level-focus-bottom"><button className="text-button" aria-expanded={allOpen||!!diff} aria-controls="level-exact-zones" onClick={()=>setAllOpen(!allOpen)} disabled={!!diff}>{diff?'Comparing imported levels':`${allOpen?'Hide':'Show'} all ${imported.zones.length} levels`}{allOpen||diff?<CaretDown size={15}/>:<ArrowRight size={15}/>}</button><small>{Number.isFinite(distancePrice)?'Distance in price points to the nearest zone edge':'Distances paused · reference levels remain visible'}</small></div>
    {(allOpen||diff)&&<section className="level-exact-zones" id="level-exact-zones" aria-label={`${imported.symbol} exact imported levels`}>
      <div className={`level-card-date ${imported.carriedForward?'carried':''}`}><span>Levels updated <time dateTime={sourceDate}>{formatDate(sourceDate)}</time></span>{imported.carriedForward&&<strong>Carried forward</strong>}</div>
      {diff&&<div className="level-diff-heading"><strong>{diffLabels[diff.status]}</strong><span>{old?`Compared with ${formatDate(previous.date)} · levels updated ${formatDate(old.sourceDate)} · ${old.timeframe}${old.futures?' · Futures':''}`:'Not in the comparison list'}</span>{diff.metadataChanged&&<span>Timeframe or asset type changed</span>}</div>}
      <p className="level-focus-note">Original imported prices and roles{roles?.status==='ok'?' · chart colors follow confirmed flips':''}.</p>
      {item?.zones.map((zone,index)=><ZoneRow key={index} zone={zone} change={diff?(diff.added.includes(zone)?'Added':'Unchanged'):null}/>)}{diff?.removed.map((zone,index)=><ZoneRow key={`removed-${index}`} zone={zone} change="Removed"/>)}
    </section>}
  </div>;
}

export function LevelsView({workspace,watchlist,onImport,onSelect}){
  const [query,setQuery]=useState(''),[selectedDate,setSelectedDate]=useState('latest'),[compareDate,setCompareDate]=useState(''),[symbol,setSymbol]=useState('QQQ'),[browseAll,setBrowseAll]=useState(false);
  const snapshots=useMemo(()=>levelSnapshots(workspace),[workspace.levelText,workspace.levelSourceDates,workspace.levelHistory]);
  const selected=snapshots.find(item=>item.date===selectedDate)||snapshots[0];
  const sheet=useMemo(()=>parseLevels(selected.levelText,selected.levelSourceDates),[selected]);
  const comparison=snapshots.find(item=>item.date===compareDate&&item.date!==selected.date);
  const previous=useMemo(()=>comparison?parseLevels(comparison.levelText,comparison.levelSourceDates):null,[comparison]);
  const historical=selected.date!==snapshots[0].date;
  const symbols=[...new Set([...Object.keys(sheet.instruments),...Object.keys(previous?.instruments||{})])];
  const entries=symbols.filter(s=>s.includes(query.trim().toUpperCase()));
  const active=entries.includes(symbol)?symbol:entries.find(s=>s==='QQQ')||entries[0];
  const count=Object.values(sheet.instruments).reduce((sum,item)=>sum+item.zones.length,0);
  const summary=previous?symbols.reduce((counts,s)=>{counts[compareLevelInstruments(sheet.instruments[s],previous.instruments[s]).status]++;return counts;},{changed:0,unchanged:0,added:0,removed:0}):null;
  const changeDate=value=>{setSelectedDate(value);if(value===compareDate||value==='latest'&&compareDate===snapshots[0].date)setCompareDate('');};
  const others=entries.filter(s=>![...FOCUS_SYMBOLS,...CONTEXT_SYMBOLS].includes(s));
  const expanded=browseAll||!!query.trim()||others.includes(active);
  const groups=[['Your focus',FOCUS_SYMBOLS.filter(s=>entries.includes(s))],['Market context',CONTEXT_SYMBOLS.filter(s=>entries.includes(s))],['All instruments',expanded?others:[]]];
  return <section className="levels-page levels-workbench" aria-labelledby="levels-title">
    <header className="level-board-heading"><div><span className="eyebrow">FOCUS & SCAN</span><h1 id="levels-title">Key levels</h1><p>{formatDate(sheet.date)} · {Object.keys(sheet.instruments).length} instruments · {count} zones</p></div><button className="button outline" onClick={onImport}><UploadSimple size={18}/>Import levels</button></header>
    <div className="level-board-controls level-history-controls">
      <label>Levels from<select aria-label="Level list date" value={historical?selected.date:'latest'} onChange={e=>changeDate(e.target.value)}>{snapshots.map((item,index)=><option key={item.date} value={index===0?'latest':item.date}>{formatDate(item.date)}{index===0?' · Latest':''}</option>)}</select></label>
      <label>Compare with<select aria-label="Compare levels with" value={comparison?.date||''} onChange={e=>setCompareDate(e.target.value)} disabled={snapshots.length<2}><option value="">No comparison</option>{snapshots.filter(item=>item.date!==selected.date).map(item=><option key={item.date} value={item.date}>{formatDate(item.date)}</option>)}</select></label>
      <label className="search-input levels-search"><MagnifyingGlass size={19}/><input aria-label="Search levels" placeholder="Search instruments (e.g. SPY, QQQ, ES)" value={query} onChange={e=>setQuery(e.target.value)}/></label>
      <details className="level-guide"><summary aria-label="About level lists"><Info size={19}/><span>S = supply · D = demand · G = gap</span></summary><p>{snapshots.length} of {LEVEL_HISTORY_DAYS} daily lists saved. Missing instruments keep their original update date. A same-date correction replaces that day’s list. Chart interval and source-level timeframe stay independent.</p></details>
    </div>
    {historical&&<div className="notice level-history-notice"><span>Viewing {formatDate(sheet.date)}. Historical levels are read-only; the latest list stays active for setups and scans.</span><button className="text-button" onClick={()=>{setSelectedDate('latest');setCompareDate('');}}>Back to latest<CaretRight size={14}/></button></div>}
    {summary&&<div className="level-comparison-summary" role="status"><strong>{formatDate(sheet.date)} compared with {formatDate(previous.date)}</strong><span>{summary.changed} changed · {summary.unchanged} unchanged · {summary.added} added · {summary.removed} missing instruments</span><small>Comparing original supplied zones, roles and timeframes. Update dates may differ.</small></div>}
    {entries.length?<div className="level-board-body">
      <nav className="level-instrument-nav" aria-label="Level instruments">{groups.map(([label,items])=>items.length>0&&<section key={label} className="level-nav-group" data-group={label}><h2>{label}</h2><div className="level-nav-items">{items.map(s=>{
        const item=sheet.instruments[s]||previous.instruments[s],target=levelDestination(item,watchlist),diff=previous?compareLevelInstruments(sheet.instruments[s],previous.instruments[s]):null;
        return <button key={s} className={`level-nav-item ${active===s?'selected':''}`} aria-label={`Select ${s} levels`} aria-pressed={active===s} onClick={()=>setSymbol(s)}><span><strong>{s}</strong><small>{item.futures?'Futures':target.entry?.exchange||'Listing needed'} · {item.timeframe}</small>{diff&&<small className={`level-nav-diff ${diff.status}`}>{diffLabels[diff.status]}</small>}</span><span className="level-nav-count">{item.zones.length} zones</span><CaretRight size={16}/></button>;
      })}</div></section>)}
      {!!others.length&&!query.trim()&&entries.some(s=>FOCUS_SYMBOLS.includes(s)||CONTEXT_SYMBOLS.includes(s))&&<div className="level-browse"><button className="text-button" aria-expanded={expanded} onClick={()=>{setBrowseAll(!expanded);if(expanded&&others.includes(active))setSymbol(entries.find(s=>FOCUS_SYMBOLS.includes(s)||CONTEXT_SYMBOLS.includes(s))||active);}}>{expanded?'Show focus list':`${others.length} more instruments`}{expanded?<CaretDown size={16}/>:<CaretRight size={16}/>}</button><p>Browse all instruments to view imported zones.</p></div>}
      </nav>
      <LevelFocus key={`${active}:${selected.date}:${comparison?.date||''}`} item={sheet.instruments[active]} old={previous?.instruments[active]} sheet={sheet} previous={previous} historical={historical} destination={levelDestination(sheet.instruments[active]||previous.instruments[active],watchlist)} onSelect={onSelect}/>
    </div>:<div className="empty"><MagnifyingGlass size={30}/><h2>No matching levels</h2><p>Try a different instrument symbol.</p><button className="button outline" onClick={()=>setQuery('')}>Clear search</button></div>}
  </section>;
}
