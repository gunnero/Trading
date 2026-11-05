import {usePortfolioPrivacy} from './PortfolioPrivacy';
import {useDisplayTime} from './DisplayTime';
import {apiFetch} from './auth-client';
import {useEffect,useState,useId} from 'react';
import {ArrowUpRight,CaretRight,ArrowsClockwise,AppleLogo,Buildings,SlidersHorizontal,Tag,ChartBar,Stack,Coins,Note} from '@phosphor-icons/react';
import {PriceChart} from './Charts';
import {ChartHeader,ChartLevels,useSavedTimeframe} from './ChartSettings';
import {useMarketChart} from './useMarketData';
import {useZoneRoles} from './ZoneRoles';
import {quoteKey,quotePrice,quoteChange,quoteTone,quoteDelay} from './data/quotes.mjs';
import {matchingInstrument,formatDate,zoneName,zoneText} from './data/market';

import {marketDay} from './data/calendar.mjs';
import {stageLabel} from './data/retests.mjs';
import {useStockSetup} from './useStockSetup';
import {CompanyNews} from './CompanyNews';
import './company-detail.css';
import {CompanyEarnings} from './CompanyEarnings';
import {PortfolioPosition} from './PortfolioPosition';
import {PortfolioStockChart} from './PortfolioStockChart';
import {portfolioAverageLine} from './data/portfolio-listings.mjs';

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
function MetricGrid({data,ids,compact=false}){
 const labels={marketCap:'Market cap',trailingPE:'P/E TTM',priceBook:'Price / book',dividendYield:'Dividend yield',grossMargin:'Gross margin',operatingMargin:'Operating margin',cash:'Cash',debt:'Debt',freeCashflow:'Free cash flow'};
 return <dl className="company-metrics">{ids.map(id=>{const metric=data.metrics[id];return metric?<div key={id}><dt title={metric.label}>{compact?(labels[id]||metric.label):metric.label}</dt><dd>{metricValue(metric)}</dd>{metric.asOf&&<small>As of {formatDate(metric.asOf)}</small>}</div>:null;})}</dl>;
}
function EarningsCard({data}){
 const e=data.earnings,dates=e.dates,today=marketDay(Date.now()),next=dates.find(d=>d>=today),past=dates.length&&!next;
 return <section className="company-card company-catalyst"><span className="eyebrow">EARNINGS & DIVIDENDS</span><h3>{data.fund?'Fund distributions':past?'Latest listed earnings date':'Next earnings'}</h3><strong className="earnings-date">{dates.length?dates.map(formatDate).join(' – '):data.fund?'Earnings not applicable':'Date unavailable'}</strong>
  {!data.fund&&<><p className="small-copy muted">{dates.length?`${e.estimated===true?'Estimated date / window':e.estimated===false?'Source-listed date':'Date estimate status unavailable'} · ${past?'past date; next release not supplied':'exact release time not supplied'}`:'No upcoming earnings date supplied by Yahoo.'}</p><div className="company-mini-metrics"><span>Consensus EPS<strong>{e.epsEstimate===null?'—':number(e.epsEstimate)}</strong></span><span>Consensus revenue<strong>{e.revenueEstimate===null?'—':`${data.financialCurrency||''} ${number(e.revenueEstimate,{notation:'compact'})}`}</strong></span></div><small className="muted">Estimates · {e.period||'period not supplied'} · {e.basis} · EPS per listed share</small></>}
  <div className="company-event-row"><span>Ex-dividend date</span><strong>{data.exDividend?formatDate(data.exDividend):'Not supplied'}</strong></div><div className="company-event-row"><span>Dividend payment</span><strong>{data.dividendDate?formatDate(data.dividendDate):'Not supplied'}</strong></div><p className="small-copy muted">Dates remain as published. Schedules can change.</p>
 </section>;
}
function Profile({data,entry,q}){
 const p=data.profile;
 const facts=[['Listing',`${entry.symbol} · ${entry.exchange}`],['Currency',data.currency],['Company / fund type',data.fund?data.type:'Corporate (Equity)'],['Observation',q?quoteDelay(q):'Unavailable'],['Data source','Yahoo Finance']];
 return <section className="company-profile"><h3>{data.fund?'Fund profile':'Company profile'}</h3><p className="company-description">{p.description||'Business description not supplied.'}{p.description?.length===700?'…':''}</p><h4>{data.fund?'Fund facts':'Company facts'}</h4><dl className="company-profile-facts">{facts.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value||'Not supplied'}</dd></div>)}</dl><details className="company-disclosure"><summary>More about {entry.symbol}</summary><dl className="company-profile-facts">{(data.fund?[['Fund family',p.fundFamily],['Category',p.category],['Inception',p.inception?formatDate(p.inception):null]]:[['Sector',p.sector],['Industry',p.industry],['Headquarters',[p.city,p.country].filter(Boolean).join(', ')],['Employees',number(p.employees,{maximumFractionDigits:0})],['Session volume',number(q?.volume,{notation:'compact'})]]).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value||'Not supplied'}</dd></div>)}</dl><div className="company-links">{p.website&&<a href={p.website} target="_blank" rel="noopener noreferrer">Company website <ArrowUpRight size={14}/></a>}{p.investorRelations&&<a href={p.investorRelations} target="_blank" rel="noopener noreferrer">Investor relations <ArrowUpRight size={14}/></a>}</div></details></section>;
}
function FinancialHistory({data}){
 const [period,setPeriod]=useState('annual'),[statement,setStatement]=useState('income');
 const rows=(data[period]||[]).toReversed();
 const fields=[['Revenue','revenue'],['Gross profit','grossProfit'],['Operating income','operatingIncome'],['Net income','income']];
 return <section className="company-history">
  <div className="company-statement-controls"><div className="company-statement-tabs" role="group" aria-label="Financial statement">{[['income','Income statement'],['balance','Balance sheet'],['cash','Cash flow']].map(([id,label])=><button key={id} aria-pressed={statement===id} onClick={()=>setStatement(id)}>{label}</button>)}</div><div className="segmented" aria-label="Financial history period">{['annual','quarterly'].map(p=><button key={p} aria-pressed={period===p} className={period===p?'selected':''} onClick={()=>setPeriod(p)}>{p==='quarterly'?'Quarterly':'Annual'}</button>)}</div></div>
  <p className="company-statement-caption">{data.financialCurrency||'Currency not supplied'} · Fiscal periods · Reported values</p>
  <div className="company-statement-body"><div>{statement==='income'?(rows.length?<div className="table-scroll" tabIndex={0} role="region" aria-label="Reported income statements"><table><thead><tr><th scope="col">Item</th>{rows.map(r=><th scope="col" key={r.period}>{/^\d{4}$/.test(r.period)?`FY${r.period}`:r.period}</th>)}</tr></thead><tbody>{fields.map(([label,key])=><tr key={key}><th scope="row">{label}</th>{rows.map(r=><td key={r.period} className={r[key]<0?'red':''}>{number(r[key],{notation:'compact'})}</td>)}</tr>)}</tbody></table></div>:<p className="company-unavailable">No {period} income statement history supplied for this listing.</p>):<div className="company-statement-unavailable"><p>No {period} {statement==='balance'?'balance sheet':'cash flow'} history supplied.</p><span>Available snapshot · {statement==='balance'?'latest reported quarter':'trailing 12 months'}</span><MetricGrid data={data} ids={statement==='balance'?['cash','debt','debtEquity','currentRatio']:['operatingCashflow','freeCashflow']}/></div>}</div>
  <aside><div><Stack size={18}/><span>Statement currency<strong>{data.financialCurrency||'Not supplied'}</strong></span></div><div><Note size={18}/><span>Reported values<small>Company-reported figures<br/>(no estimates)</small></span></div></aside></div>
  <p className="company-statement-caption">“—” means not supplied. Fiscal periods follow the company’s reporting calendar; no currency conversion is applied.</p>
 </section>;
}
function Financials({data,clockStamp,zoneLabel}){
 const summaries=[['Valuation',Tag,['marketCap','trailingPE','priceBook','dividendYield']],['Profitability',ChartBar,['grossMargin','operatingMargin']],['Balance sheet',Stack,['cash','debt']],['Cash flow',Coins,['freeCashflow']]];
 return <div className="company-financials">{data.fund?<div className="company-financial-summary company-fund-summary">{data.groups.filter(g=>g.id==='fund'||g.id==='trading').map(group=><section key={group.id}><h3>{group.title}</h3><MetricGrid data={data} ids={group.ids}/></section>)}</div>:<><div className="company-financial-summary">{summaries.map(([title,Icon,ids])=><section key={title}><h3><Icon size={18}/>{title}</h3><MetricGrid data={data} ids={ids} compact/></section>)}</div><FinancialHistory data={data}/><div className="company-fund-note"><Buildings size={20}/><div><strong>Fund view: net assets · expense ratio · yield · returns</strong><p>For ETFs and funds, Trading Desk shows fund-specific metrics instead of company financials.</p></div></div></>}
  <details className="company-disclosure"><summary>All financial metrics & source dates</summary><p className="company-report-note">Quote currency: {data.currency||'not supplied'} · Financial statements: {data.financialCurrency||'not supplied'} · Latest reported quarter: {data.quarter?formatDate(data.quarter):'not supplied'}<br/>TTM = trailing 12 months. Estimates and reported figures are labeled separately.</p><div className="company-two-column">{data.groups.map(group=><section className="company-card" key={group.id}><h3>{group.title}</h3><MetricGrid data={data} ids={group.ids}/></section>)}</div><div className="company-two-column"><EarningsCard data={data}/><section className="company-card"><h3>Corporate actions & source dates</h3><div className="company-event-row"><span>Latest stock split</span><strong>{data.split.factor||'Not supplied'}</strong></div><div className="company-event-row"><span>Split date</span><strong>{data.split.date?formatDate(data.split.date):'Not supplied'}</strong></div><p className="small-copy muted">Trading snapshot quoted {clockStamp(data.quoteObservedAt)} {zoneLabel}. Financial, ownership and short-interest figures can have different reporting dates. Company snapshots refresh every 30 minutes.</p></section></div></details>
 </div>;
}
export function CompanyDetail({entry,sheet,result,setupInterval,onUseCustom,position}){
 const {hideBalances}=usePortfolioPrivacy(),{quoteStamp,clockStamp,zoneLabel}=useDisplayTime();
 const key=quoteKey(entry),snapshot=useCompany(key),data=snapshot.data;
 const [tab,setTab]=useState('overview'),[simpleChart,setSimpleChart]=useState(false),tabId=useId();
 const tabs=[['overview','Overview'],['financials','Financials'],['earnings','Earnings'],['news','News']];
 function selectTab(id){setTab(id);document.getElementById(`${tabId}-panel`)?.closest('dialog')?.scrollTo({top:0,behavior:'instant'});}
 function navigateTabs(event){if(event.target.getAttribute('role')!=='tab')return;const index=tabs.findIndex(([id])=>id===tab),next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:null;if(next===null)return;event.preventDefault();selectTab(tabs[next][0]);document.getElementById(`${tabId}-${tabs[next][0]}`)?.focus({preventScroll:true});}
 const [timeframe,setTimeframe]=useSavedTimeframe(key);
 const history=useMarketChart(key,timeframe,tab==='overview'&&!simpleChart),roles=useZoneRoles(matchingInstrument(entry,sheet),sheet.date,key),q=result?.quote||history.quote;
 const setup=useStockSetup(entry,sheet,setupInterval),stale=result?.status==='stale'||history.status==='stale',instrument=roles.instrument;
 const [showAverage,setShowAverage]=useState(true),averageLine=portfolioAverageLine(position?.holding,history.quote,entry);
 const source=snapshot.status==='loading'?'Loading company snapshot…':snapshot.status==='unavailable'?snapshot.message:`${snapshot.status==='stale'?'Cached snapshot':'Yahoo company snapshot'} · Fetched ${clockStamp(snapshot.fetchedAt)} ${zoneLabel}`;
 const Logo=entry.symbol==='AAPL'?AppleLogo:Buildings;
 return <div className="company-detail" data-tab={tab}>
  <div className="company-masthead"><header className="company-identity"><span className="company-mark" aria-hidden="true"><Logo size={30} weight={entry.symbol==='AAPL'?'fill':'regular'}/></span><div className="company-identity-copy"><h3><strong>{data?.name||q?.name||entry.symbol}</strong><span> · {entry.symbol} · {entry.exchange} · {q?.currency||data?.currency||'—'}</span></h3>{tab==='overview'?<div className="company-quote"><strong>{quotePrice(q)}</strong><span className={quoteTone(q)}>{quoteChange(q)}</span><small>{q?`Yahoo · ${quoteStamp(q)} · ${quoteDelay(q)}`:'Quote unavailable'}{stale?' · Cached / old market data':''}</small></div>:<p>{data?`Observation: ${clockStamp(data.quoteObservedAt)} ${zoneLabel} · Yahoo Finance`:source}</p>}</div>{onUseCustom&&<button className="button primary company-use" onClick={onUseCustom}><SlidersHorizontal size={15}/>Use as Custom</button>}</header>
  <div className="company-tabs" role="tablist" aria-label="Company details" onKeyDown={navigateTabs}>{tabs.map(([id,label])=><button key={id} id={`${tabId}-${id}`} role="tab" aria-controls={`${tabId}-panel`} tabIndex={tab===id?0:-1} aria-selected={tab===id} onClick={()=>selectTab(id)}>{label}</button>)}</div></div>
  {snapshot.status!=='ok'&&<p className="company-source-warning" role="status">{source}{snapshot.status==='stale'&&<> · {snapshot.message}</>}</p>}
  <div id={`${tabId}-panel`} role="tabpanel" aria-labelledby={`${tabId}-${tab}`} tabIndex={0}>
  {tab==='overview'&&<div className="company-overview">
   {position&&<><PortfolioPosition position={position} compact><div className="company-chart-choice segmented" aria-label="Holding chart view"><button aria-pressed={!simpleChart} className={!simpleChart?'selected':''} onClick={()=>setSimpleChart(false)}>Candles & levels</button><button aria-pressed={simpleChart} className={simpleChart?'selected':''} onClick={()=>setSimpleChart(true)}>Price history</button></div>{!simpleChart&&<div className="pm-chart-position"><label><input type="checkbox" checked={showAverage&&!hideBalances} disabled={!averageLine||hideBalances} onChange={e=>setShowAverage(e.target.checked)}/><i/>Average paid {hideBalances?'••••':number(position.holding.averagePrice)} {position.holding.instrumentCurrency}</label><span>{averageLine?`Account reference · ${entry.exchange}:${entry.symbol}`:history.status==='loading'?'Checking chart currency…':'Average line unavailable: chart symbol and currency must match the holding.'}</span></div>}</PortfolioPosition></>}
   {position&&simpleChart?<PortfolioStockChart entry={entry} position={position} instrument={instrument} sheetDate={sheet.date}/>:<section className="context-chart-panel company-chart" aria-label={`${entry.symbol} company chart`}><ChartHeader symbol={entry.symbol} quote={q} marketKey={key} timeframe={timeframe} onTimeframe={setTimeframe} roles={roles}/><ChartLevels scope={`${key}|${timeframe}`} instrument={instrument} date={sheet.date} roles={roles} quoteDate={q?.sessionDate}/>

    {history.candles?.length?<PriceChart symbol={entry.symbol} drawingKey={key} timeframe={timeframe} candles={history.candles} price={history.quote.price} instrument={instrument} indicators={history.indicators} referenceLine={showAverage&&!hideBalances?averageLine:null}/>:<div className="empty" role="status"><h3>{history.status==='loading'?'Loading company chart…':'Company chart unavailable'}</h3><p>{history.message||'Fetching regular-session candles.'}</p></div>}
    <div className="chart-footnote"><span>{history.status==='stale'?'Cached / old history · ':''}Regular-session history · Yahoo Finance · {timeframe==='4h'?'4h from hourly bars · ':''}partial candles marked</span><span>{zoneLabel} · refreshes each minute</span></div>
   </section>}
   <div className="company-overview-bottom"><section className="company-setup"><h3>Break & retest</h3><div className="company-setup-status"><span className={setup?.direction==='bearish'?'red':setup?.stage==='confirmed'?'green':'amber'}>{stageLabel(setup?.stage||'loading')}</span><span>Confirmation · {setupInterval}</span></div><p>{setup?.message||`${setup?.direction==='bullish'?'Bullish':setup?.direction==='bearish'?'Bearish':'Monitoring'}${setup?.zone?` · ${setup.direction==='bullish'?'Break above':'Break below'} ${zoneText(setup.zone)}`:' · EMA 9/21 + session VWAP'}`}</p>
    <details className="company-exact-levels" open><summary>Exact level list<small>{instrument?.sourceDate||sheet.date} · {instrument?.timeframe||'No matching sheet'}{instrument?.carriedForward?' · Carried forward':''}</small></summary><div aria-label={`All ${entry.symbol} levels`}>{instrument?instrument.zones.map((z,i)=><div className="level-row" key={i}><span className={z.type==='S'?'red':z.type==='D'?'green':'amber'}>{zoneName(z.type)}</span><strong>{zoneText(z)}</strong></div>):<p className="muted">No matching levels in your sheet.</p>}</div></details>
    <details className="company-disclosure"><summary>Strategy checks & earnings dates</summary>{setup?.checks?.map(c=><div className="company-event-row" key={c.name}><span>{c.name}</span><strong className={c.passed===true?'green':'amber'}>{c.passed===null?'Unavailable':c.passed?'Aligned':'Conflict'}</strong></div>)}{setup?.through&&<p className="small-copy muted">Checked through {clockStamp(setup.through*1000)} {zoneLabel} · regular session {setup.sessionDate}</p>}<p>Options bid/ask, Greeks and contract liquidity are not connected.</p>{data&&<EarningsCard data={data}/>}</details>
   </section>{data?<Profile data={data} entry={entry} q={q}/>:<section><h3>Company profile</h3><p className="muted">{snapshot.status==='loading'?'Loading source information…':snapshot.message}</p></section>}</div>
  </div>}
  {tab==='financials'&&(data?<Financials data={data} clockStamp={clockStamp} zoneLabel={zoneLabel}/>:<div className="empty"><h3>{snapshot.status==='loading'?'Loading financials…':'Financials unavailable'}</h3><p>{snapshot.message||'Fetching the company snapshot.'}</p></div>)}
  {tab==='earnings'&&<CompanyEarnings key={key} data={data} status={snapshot.status} message={snapshot.message}/>}
  {tab==='news'&&<CompanyNews key={entry.id} symbol={entry.symbol.replaceAll('.','-')}/>}
  </div>
  <footer className="company-footer"><span role="status">{source}{tab==='financials'?' · TTM: trailing 12 months':''}</span><div><button className="icon-button" aria-label="Refresh company snapshot" onClick={snapshot.refresh}><ArrowsClockwise size={15}/></button><a href={data?.sourceUrl||`https://finance.yahoo.com/quote/${encodeURIComponent(entry.symbol.replaceAll('.','-'))}/`} target="_blank" rel="noopener noreferrer">Source page <ArrowUpRight size={13}/></a></div></footer>
 </div>;
}
