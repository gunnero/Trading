import {lazy,Suspense,useState} from 'react';
import {ArrowDown,ArrowUp,CalendarBlank,CaretLeft,CaretRight,Clock,FileText,MagnifyingGlass,Notebook,Play,Plus,Stack,Tag,X} from '@phosphor-icons/react';
import {useDisplayTime} from './DisplayTime';
import {duration,journalDay,money,tradeResult} from './data/journal.mjs';

const Curve=lazy(()=>import('./JournalCurve'));
const monthFormat=new Intl.DateTimeFormat('en-US',{month:'long',year:'numeric',timeZone:'UTC'});
const expiryFormat=new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
const dollars=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:0,maximumFractionDigits:2});
const premium=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:4});
const color=value=>value>0?'green':value<0?'red':'';
const amount=value=>value==null?'—':dollars.format(value);
const signed=value=>value>0?'+'+amount(value):amount(value);
const monthDate=month=>new Date(month+'-01T00:00:00Z');
function moveMonth(month,delta){
  const date=monthDate(month);
  date.setUTCMonth(date.getUTCMonth()+delta);
  return date.toISOString().slice(0,7);
}

export function JournalFilters({trades,accounts,accountKey,month,allTime,onMonth,onAllTime,account,onAccount,symbol,onSymbol,query,onQuery,day,onClearDay}){
  const [chooseMonth,setChooseMonth]=useState(false);
  const [searching,setSearching]=useState(false);
  const months=new Set([month,journalDay(new Date()).slice(0,7)]);
  const symbols=new Set();
  for(const trade of trades){
    months.add(journalDay(trade.exitAt||trade.entryAt).slice(0,7));
    symbols.add(trade.symbol);
  }
  function selectPeriod(value){
    setChooseMonth(value==='choose');
    if(value==='all')onAllTime();
    else if(value!=='choose')onMonth(value);
  }
  return <div className="jt-filters journal-filters">
    <label className="jt-filter"><CalendarBlank/><select aria-label="Journal period" value={allTime?'all':month} onChange={e=>selectPeriod(e.target.value)}>
      {[...months].sort().reverse().map(value=><option key={value} value={value}>{monthFormat.format(monthDate(value))}</option>)}
      <option value="all">All time</option><option value="choose">Choose month…</option>
    </select></label>
    {chooseMonth&&<input aria-label="Choose journal month" type="month" autoFocus value={month} onChange={e=>{if(e.target.value){onMonth(e.target.value);setChooseMonth(false);}}}/>}
    <label className="jt-filter"><Stack/><select aria-label="Trading account" value={account} onChange={e=>onAccount(e.target.value)}>
      <option value="">All accounts</option>{accounts.map(t=><option key={accountKey(t)} value={accountKey(t)}>{t.firm} · {t.account}</option>)}
    </select></label>
    <label className="jt-filter"><Tag/><select aria-label="Symbol" value={symbol} onChange={e=>onSymbol(e.target.value)}>
      <option value="">All symbols</option>{[...symbols].sort().map(value=><option key={value}>{value}</option>)}
    </select></label>
    <button className="icon-button" aria-label="Search trades" aria-expanded={searching} onClick={()=>{setSearching(!searching);if(searching)onQuery('');}}><MagnifyingGlass size={17}/></button>
    {searching&&<input aria-label="Search" type="search" autoFocus placeholder="Symbol or review tag" value={query} onChange={e=>onQuery(e.target.value)}/>}
    {day&&<button className="text-button" onClick={onClearDay}>{day}<X size={14}/></button>}
  </div>;
}

export function JournalSummary({stats}){
  const missing=stats.missingFees;
  return <>
    <dl className="jt-metrics journal-stats">{[
      ['Closed trades',stats.closed],['Gross P/L',stats.closed?signed(stats.gross):'—',color(stats.gross)],
      ['Fees',amount(stats.fees)],['Net P/L',signed(stats.net),color(stats.net)],
      ['Win rate · gross',stats.winRate===null?'—':stats.winRate.toFixed(1)+'%']
    ].map(([label,value,tone])=><div key={label}><dt>{label}</dt><dd className={tone}>{value}</dd></div>)}</dl>
    {missing>0&&<p className="jt-fee-note">Net P/L unavailable · fees missing on {missing} closed {missing===1?'trade':'trades'}.</p>}
  </>;
}

function JournalCalendar({month,onMonth,stats,selected,onSelect}){
  const first=monthDate(month),offset=first.getUTCDay();
  const last=new Date(monthDate(moveMonth(month,1)).getTime()-86400000).getUTCDate();
  const cells=Math.ceil((offset+last)/7)*7,byDate=new Map(stats.series.map(d=>[d.date,d]));
  const basis=stats.missingFees?'gross':'net';
  return <section className="jt-panel jt-calendar">
    <header><h3>{monthFormat.format(first)} P/L calendar</h3><div>
      <button className="icon-button" aria-label="Previous journal month" onClick={()=>onMonth(moveMonth(month,-1))}><CaretLeft/></button>
      <button className="icon-button" aria-label="Next journal month" onClick={()=>onMonth(moveMonth(month,1))}><CaretRight/></button>
    </div></header>
    <div className="jt-days">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=><span key={d} className="jt-weekday">{d}</span>)}
      {Array.from({length:cells},(_,i)=>{
        const n=i-offset+1;
        if(n<1||n>last)return <span key={i} className="jt-pad" aria-hidden="true"/>;
        const date=month+'-'+String(n).padStart(2,'0'),day=byDate.get(date),value=day?.[basis];
        return <button key={i} aria-pressed={selected===date} onClick={()=>onSelect(selected===date?'':date)}
          aria-label={date+', '+(day?money(value)+' '+basis+', '+day.count+' trades':'no closed trades')}>
          <span>{n}</span><strong className={color(value)}>{value==null?'–':signed(value)}</strong>
        </button>;
      })}
    </div><small>{basis==='net'?'Net':'Gross'} P/L · Skopje exit date</small>
  </section>;
}

export function JournalAnalysis({stats,calendarStats,month,onMonth,day,onDay}){
  const basis=stats.missingFees?'gross':'net';
  return <div className="jt-analysis">
    <section className="jt-panel jt-curve"><header><h3>Cumulative {basis==='net'?'realized':'gross'} P/L</h3>
      {stats.closed>0&&<strong className={'jt-total '+color(stats[basis])}>{signed(stats[basis])}</strong>}
    </header>
      {stats.series.length?<Suspense fallback={<div className="jt-chart-empty">Loading chart…</div>}><Curve series={stats.exits} basis={basis}/></Suspense>:
        <div className="jt-chart-empty"><Notebook size={26}/><strong>No closed trades in this period</strong><span>Realized P/L appears when a trade has an exit.</span></div>}
      <small>{basis==='net'?'After recorded fees':'Before fees'} · USD · recorded exits</small>
    </section>
    <JournalCalendar month={month} onMonth={onMonth} stats={calendarStats} selected={day} onSelect={onDay}/>
  </div>;
}

export function JournalResults({trades,stats,hasTrades,onOpen,onAdd,addLabel}){
  const {zoneLabel,formatLabel,journalStamp,clockDate,clockTime}=useDisplayTime(),[ascending,setAscending]=useState(false);
  const rows=[...trades].sort((a,b)=>(ascending?1:-1)*(a.exitAt||a.entryAt).localeCompare(b.exitAt||b.entryAt));
  const sortButton=<button onClick={()=>setAscending(!ascending)}>Date {ascending?<ArrowUp/>:<ArrowDown/>}</button>;
  return <section className="jt-results journal-trades"><header><h2>Trades</h2>
    {rows.length>1&&<span className="jt-mobile-sort">{sortButton}</span>}<small>Manual journal · USD · {zoneLabel} / {formatLabel}</small></header>
    {rows.length?<div className="jt-table-wrap"><table><thead><tr>
      <th aria-sort={ascending?'ascending':'descending'}>{sortButton}</th>
      <th>Account</th><th>Contract</th><th>Side</th><th>Qty</th><th>Entry</th><th>Exit</th><th>Net P/L</th><th><span className="sr-only">Actions</span></th>
    </tr></thead><tbody>{rows.map(t=>{
      const result=tradeResult(t),call=t.optionType==='CALL'?'Call':'Put',buy=t.position==='long';
      return <tr key={t.id}>
        <td data-label="Date"><time dateTime={t.exitAt||t.entryAt} title={(t.exitAt?'Exit':'Entry')+' · '+journalStamp(t.exitAt||t.entryAt)}>{clockDate(t.exitAt||t.entryAt)} {clockTime(t.exitAt||t.entryAt)}</time>{!t.exitAt&&<small>Open</small>}</td>
        <td data-label="Account" title={t.firm+' · '+t.account}>{t.account}</td>
        <td data-label="Contract"><button className="jt-contract" aria-label={t.symbol+' '+t.strike+' '+call} onClick={()=>onOpen(t,'chart')}>
          <b>{t.symbol}</b><span>{call}</span><span>{expiryFormat.format(new Date(t.expiration+'T00:00:00Z'))}</span><span>{t.strike}</span>
        </button></td>
        <td data-label="Opening side"><span className={'jt-side '+(buy?'jt-buy':'jt-sell')} title={buy?'Buy to open':'Sell to open'}>{buy?'Buy':'Sell'}</span></td>
        <td data-label="Qty">{t.quantity}</td><td data-label="Entry">{premium.format(t.entryPrice)}</td>
        <td data-label="Exit">{t.exitPrice===null?'—':premium.format(t.exitPrice)}</td>
        <td data-label="Net P/L" title={t.exitAt?'Gross P/L '+money(result.gross)+' · fees '+money(t.fees):'Open position'}><b className={color(result.net)}>{signed(result.net)}</b></td>
        <td className="jt-row-actions"><button onClick={()=>onOpen(t,'chart')}><Play/>Replay</button><button onClick={()=>onOpen(t,'details')}><FileText/>Notes</button></td>
      </tr>;
    })}</tbody></table></div>:<div className="jt-empty"><Clock/><strong>{hasTrades?'No trades match these filters.':'No trades recorded yet.'}</strong>
      <button className="text-button" onClick={onAdd}><Plus size={15}/>{addLabel||(hasTrades?'Add a trade':'Add your first trade')}</button></div>}
    {rows.length>0&&<details className="jt-additional"><summary>Trade statistics</summary><p>{stats.wins} gross wins · {stats.losses} losses · {stats.breakeven} flat · {stats.open} open</p>
      <p>Gross profit factor {stats.profitFactor===null?'—':stats.profitFactor.toFixed(2)} · Average hold {duration(stats.averageHold)}</p></details>}
  </section>;
}
