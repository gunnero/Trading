import {apiFetch} from './auth-client';
import {useEffect,useState,useId} from 'react';
import {ArrowUpRight,CaretRight,ArrowsClockwise} from '@phosphor-icons/react';
import {PriceChart} from './Charts';
import {ChartHeader,ChartLevels,useSavedTimeframe} from './ChartSettings';
import {TIMEFRAMES} from './data/candles';
import {useMarketChart} from './useMarketData';
import {useZoneRoles,ZoneRoleStatus} from './ZoneRoles';
import {quoteKey,quotePrice,quoteChange,quoteTone,quoteStamp,quoteDelay} from './data/quotes.mjs';
import {matchingInstrument,formatDate,zoneName,zoneText} from './data/market';
import {clockStamp} from './data/market-session.mjs';
import {marketDay} from './data/calendar.mjs';
import {stageLabel} from './data/retests.mjs';
import {useStockSetup} from './useStockSetup';
import {NewsPanel} from './Briefing';
import {CompanyEarnings} from './CompanyEarnings';

const number=(value,options={})=>Number.isFinite(value)?value.toLocaleString('en-US',{maximumFractionDigits:2,...options}):'—';
export function metricValue(metric){
 if(!metric||!Number.isFinite(metric.value))return '—';
 const {value,format,currency}=metric;
 return `${currency?currency+' ':''}${format==='percent'?number(value*100)+'%':format==='percent-points'?number(value)+'%':format==='compact'?number(value,{notation:'compact'}):number(value,{minimumFractionDigits:format==='price'?2:0})}`;
}
function useCompany(symbol){
 const [state,setState]=useState({key:null,status:'loading'}),[revision,setRevision]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();let busy=false;
  async function load(){if(busy||document.hidden)return;busy=true;try{
   const response=await apiFetch('/api/company?'+new URLSearchParams({symbol}),{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)])});
   if(!response.ok)throw Error();const body=await response.json();if(body.symbol!==symbol||!['ok','stale','unavailable'].includes(body.status))throw Error();
   if(!controller.signal.aborted)setState({...body,key:symbol});
  }catch{if(!controller.signal.aborted)setState(previous=>previous.key===symbol&&previous.data&&Date.now()-Date.parse(previous.fetchedAt)<86400000?{...previous,status:'stale',message:'Snapshot refresh unavailable.'}:{key:symbol,status:'unavailable',message:'Company data unavailable. Chart and levels remain available.'});}finally{busy=false;}}
  load();const timer=setInterval(load,60000);document.addEventListener('visibilitychange',load);
  return()=>{controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',load);};
 },[symbol,revision]);
 return {...(state.key===symbol?state:{status:'loading'}),refresh:()=>setRevision(r=>r+1)};
}
function MetricGrid({data,ids}){
 return <dl className="company-metrics">{ids.map(id=>{const metric=data.metrics[id];return metric?<div key={id}><dt>{metric.label}</dt><dd>{metricValue(metric)}</dd>{metric.asOf&&<small>As of {formatDate(metric.asOf)}</small>}</div>:null;})}</dl>;
}
function EarningsCard({data}){
 const e=data.earnings,dates=e.dates,today=marketDay(Date.now()),next=dates.find(d=>d>=today),past=dates.length&&!next;
 return <section className="company-card company-catalyst"><span className="eyebrow">EARNINGS & DIVIDENDS</span><h3>{data.fund?'Fund distributions':past?'Latest listed earnings date':'Next earnings'}</h3><strong className="earnings-date">{dates.length?dates.map(formatDate).join(' – '):data.fund?'Earnings not applicable':'Date unavailable'}</strong>
  {!data.fund&&<><p className="small-copy muted">{dates.length?`${e.estimated===true?'Estimated date / window':e.estimated===false?'Source-listed date':'Date estimate status unavailable'} · ${past?'past date; next release not supplied':'exact release time not supplied'}`:'No upcoming earnings date supplied by Yahoo.'}</p><div className="company-mini-metrics"><span>Consensus EPS<strong>{e.epsEstimate===null?'—':number(e.epsEstimate)}</strong></span><span>Consensus revenue<strong>{e.revenueEstimate===null?'—':`${data.financialCurrency||''} ${number(e.revenueEstimate,{notation:'compact'})}`}</strong></span></div><small className="muted">Estimates · {e.period||'period not supplied'} · {e.basis} · EPS per listed share</small></>}
  <div className="company-event-row"><span>Ex-dividend date</span><strong>{data.exDividend?formatDate(data.exDividend):'Not supplied'}</strong></div><div className="company-event-row"><span>Dividend payment</span><strong>{data.dividendDate?formatDate(data.dividendDate):'Not supplied'}</strong></div><p className="small-copy muted">Dates remain as published. Schedules can change.</p>
 </section>;
}
function Profile({data}){
 const p=data.profile;
 return <section className="company-card"><span className="eyebrow">{data.fund?'FUND PROFILE':'ABOUT THE COMPANY'}</span><h3>{data.name}</h3><p className="company-description">{p.description||'Business description not supplied.'}{p.description?.length===700?'…':''}</p><dl className="company-profile-facts">{(data.fund?[['Fund family',p.fundFamily],['Category',p.category],['Inception',p.inception?formatDate(p.inception):null]]:[['Sector',p.sector],['Industry',p.industry],['Headquarters',[p.city,p.country].filter(Boolean).join(', ')],['Employees',p.employees===null?null:number(p.employees,{maximumFractionDigits:0})]]).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value||'Not supplied'}</dd></div>)}</dl><div className="company-links">{p.website&&<a href={p.website} target="_blank" rel="noopener noreferrer">Company website <ArrowUpRight size={14}/></a>}{p.investorRelations&&<a href={p.investorRelations} target="_blank" rel="noopener noreferrer">Investor relations <ArrowUpRight size={14}/></a>}</div></section>;
}
function FinancialHistory({data}){
 const [period,setPeriod]=useState('quarterly'),rows=data[period];
 return <section className="company-card company-history"><div className="company-card-heading"><div><span className="eyebrow">REPORTED HISTORY</span><h3>Revenue & net income</h3></div><div className="segmented" aria-label="Financial history period">{['quarterly','annual'].map(p=><button key={p} aria-pressed={period===p} className={period===p?'selected':''} onClick={()=>setPeriod(p)}>{p==='quarterly'?'Quarterly':'Annual'}</button>)}</div></div>
  {rows.length?<div className="table-scroll"><table><thead><tr><th>Fiscal period</th><th>Revenue · {data.financialCurrency}</th><th>Net income · {data.financialCurrency}</th></tr></thead><tbody>{rows.toReversed().map(row=><tr key={row.period}><th>{row.period}</th><td>{number(row.revenue,{notation:'compact'})}</td><td className={row.income<0?'red':''}>{number(row.income,{notation:'compact'})}</td></tr>)}</tbody></table></div>:<p className="muted">No financial history supplied for this listing.</p>}
  <p className="small-copy muted">Fiscal periods follow the company’s reporting calendar; they may differ from calendar quarters. Values are supplied by Yahoo.</p>
 </section>;
}
export function CompanyDetail({entry,sheet,result,setupInterval,onUseCustom}){
 const key=quoteKey(entry),snapshot=useCompany(key),data=snapshot.data;
 const [tab,setTab]=useState('overview'),tabId=useId();
 const tabs=[['overview','Overview'],['financials','Financials'],['earnings','Earnings'],['news','News']];
 function selectTab(id){setTab(id);document.getElementById(`${tabId}-panel`)?.closest('dialog')?.scrollTo({top:0,behavior:'instant'});}
 function navigateTabs(event){if(event.target.getAttribute('role')!=='tab')return;const index=tabs.findIndex(([id])=>id===tab),next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:null;if(next===null)return;event.preventDefault();selectTab(tabs[next][0]);document.getElementById(`${tabId}-${tabs[next][0]}`)?.focus({preventScroll:true});}
 const [timeframe,setTimeframe]=useSavedTimeframe(key);
 const history=useMarketChart(key,timeframe),roles=useZoneRoles(matchingInstrument(entry,sheet),sheet.date,key),q=result?.quote||history.quote;
 const setup=useStockSetup(entry,sheet,setupInterval);
 const stale=result?.status==='stale'||history.status==='stale',instrument=roles.instrument;
 return <div className="company-detail">
  <header className="company-identity"><div><span className="eyebrow">{entry.exchange} · {data?.type||entry.group} · {q?.currency||data?.currency||'Currency pending'}</span><h3>{data?.name||q?.name||entry.symbol}</h3><p>{[data?.profile.sector,data?.profile.industry].filter(Boolean).join(' · ')||'Company & market details'}</p></div><div className="company-quote"><strong>{quotePrice(q)}</strong><span className={quoteTone(q)}>{quoteChange(q)}</span><small>{q?`${quoteStamp(q)} · ${quoteDelay(q)}`:'Quote unavailable'}</small><small>Session volume · {number(q?.volume,{notation:'compact'})}</small>{stale&&<small className="amber">Cached / old market data</small>}</div></header>
  <div className="company-tabs" role="tablist" aria-label="Company details" onKeyDown={navigateTabs}>{tabs.map(([id,label])=><button key={id} id={`${tabId}-${id}`} role="tab" aria-controls={`${tabId}-panel`} tabIndex={tab===id?0:-1} aria-selected={tab===id} onClick={()=>selectTab(id)}>{label}</button>)}<button className="company-use" onClick={onUseCustom}>Use as Custom<CaretRight size={15}/></button></div>
  <div className="company-source" role="status"><span>{snapshot.status==='loading'?'Loading company snapshot…':snapshot.status==='unavailable'?snapshot.message:`${snapshot.status==='stale'?'Cached snapshot':'Yahoo company snapshot'} · fetched ${clockStamp(snapshot.fetchedAt)} Skopje`}</span><button className="icon-button" aria-label="Refresh company snapshot" onClick={snapshot.refresh}><ArrowsClockwise size={16}/></button></div>
  {snapshot.status==='stale'&&<p className="calendar-warning">{snapshot.message}</p>}
  <div id={`${tabId}-panel`} role="tabpanel" aria-labelledby={`${tabId}-${tab}`} tabIndex={0}>
  {tab==='overview'&&<div className="company-overview">
   {data&&<MetricGrid data={data} ids={data.fund?['marketCap','averageVolume','yearLow','yearHigh','expenseRatio']:['marketCap','trailingPE','float','averageVolume','beta','shortFloat']}/>}
   <section className="context-chart-panel company-chart" aria-label={`${entry.symbol} company chart`}><ChartHeader symbol={entry.symbol} marketKey={key} timeframe={timeframe} onTimeframe={setTimeframe} roles={roles}/>
    <ChartLevels scope={`${key}|${timeframe}`} instrument={instrument} date={sheet.date} roles={roles} quoteDate={q?.sessionDate}/>
    {history.candles?.length?<PriceChart symbol={entry.symbol} drawingKey={quoteKey(entry)} timeframe={timeframe} candles={history.candles} price={history.quote.price} instrument={instrument} indicators={history.indicators}/>:<div className="empty" role="status"><h3>{history.status==='loading'?'Loading company chart…':'Company chart unavailable'}</h3><p>{history.message||'Fetching regular-session candles.'}</p></div>}
    <div className="chart-footnote"><span>{history.status==='stale'?'Cached / old history · ':''}{timeframe==='4h'?'4h from hourly bars · ':''}Regular session · partial candles marked</span><span>Skopje time · refreshes each minute</span></div>
   </section>
   <div className="company-two-column"><section className="company-card company-setup"><span className="eyebrow">YOUR BREAK & RETEST STRATEGY</span><h3 className={setup?.direction==='bearish'?'red':setup?.stage==='confirmed'?'green':'amber'}>{stageLabel(setup?.stage||'loading')}</h3><p>{setup?.direction?`${setup.direction==='bullish'?'Bullish':'Bearish'} · `:''}{setup?.timeframe||'Selected'} candles · EMA 9/21 + session VWAP</p>{setup?.stage==='awaiting-session'&&<p>{setup.message}</p>}{setup?.zone&&<p>{setup.direction==='bullish'?'Break above':'Break below'} <strong>{zoneText(setup.zone)}</strong></p>}{setup?.checks?.map(c=><div className="company-event-row" key={c.name}><span>{c.name}</span><strong className={c.passed===true?'green':'amber'}>{c.passed===null?'Unavailable':c.passed?'Aligned':'Conflict'}</strong></div>)}{setup?.through&&<p className="small-copy muted">Checked through {clockStamp(setup.through*1000)} Skopje · regular session {setup.sessionDate}</p>}<p className="small-copy muted">Open in Custom for the complete setup and options plan. Options bid/ask, Greeks and contract liquidity are not connected.</p><button className="button outline" onClick={onUseCustom}>Open setup in Custom<CaretRight size={16}/></button></section>{data?<EarningsCard data={data}/>:<section className="company-card"><h3>Earnings & fundamentals</h3><p className="muted">{snapshot.status==='loading'?'Loading source information…':snapshot.message}</p></section>}</div>
   <div className="company-two-column">{data&&<Profile data={data}/>}<section className="company-card"><span className="eyebrow">YOUR MAP</span><h3>All {entry.symbol} levels</h3><p className="small-copy muted">{instrument?.carriedForward?'Carried forward · ':''}{instrument?.sourceDate||sheet.date} · {instrument?.timeframe||'No matching sheet'}</p>{instrument?instrument.zones.map((z,i)=><div className="level-row" key={i}><span className={z.type==='S'?'red':z.type==='D'?'green':'amber'}>{zoneName(z.type)}</span><strong>{zoneText(z)}</strong></div>):<p className="muted">No matching levels in your sheet.</p>}</section></div>
  </div>}
  {tab==='financials'&&(data?<div className="company-financials"><div className="company-report-note">Quote currency: {data.currency||'not supplied'} · Financial statements: {data.financialCurrency||'not supplied'} · Latest reported quarter: {data.quarter?formatDate(data.quarter):'not supplied'}<br/>TTM = trailing 12 months. “—” means not supplied. Estimates and reported figures are labeled separately; no currency conversion is applied.</div><div className="company-two-column">{data.groups.map(group=><section className="company-card" key={group.id}><h3>{group.title}</h3><MetricGrid data={data} ids={group.ids}/></section>)}</div>{!data.fund&&<FinancialHistory data={data}/>}<div className="company-two-column"><EarningsCard data={data}/><section className="company-card"><h3>Corporate actions & source dates</h3><div className="company-event-row"><span>Latest stock split</span><strong>{data.split.factor||'Not supplied'}</strong></div><div className="company-event-row"><span>Split date</span><strong>{data.split.date?formatDate(data.split.date):'Not supplied'}</strong></div><p className="small-copy muted">Trading snapshot quoted {clockStamp(data.quoteObservedAt)} Skopje. Financial, ownership and short-interest figures can have different reporting dates. Company snapshots refresh every 30 minutes.</p></section></div></div>:<div className="empty"><h3>{snapshot.status==='loading'?'Loading financials…':'Financials unavailable'}</h3><p>{snapshot.message||'Fetching the company snapshot.'}</p></div>)}
  {tab==='earnings'&&<CompanyEarnings key={key} data={data} status={snapshot.status} message={snapshot.message} financialHistory={data&&!data.fund?<FinancialHistory data={data}/>:null}/> }
  {tab==='news'&&<NewsPanel watchlist={[entry]} fixedSymbol={entry.symbol.replaceAll('.','-')}/>}
  </div>
  <footer className="company-footer"><span>Yahoo Finance · source coverage varies by company and fund · data may be delayed</span><a href={data?.sourceUrl||`https://finance.yahoo.com/quote/${encodeURIComponent(entry.symbol.replaceAll('.','-'))}/`} target="_blank" rel="noopener noreferrer">Source page <ArrowUpRight size={13}/></a></footer>
 </div>;
}
