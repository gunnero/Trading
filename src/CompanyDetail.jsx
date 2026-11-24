import {usePortfolioPrivacy} from './PortfolioPrivacy';
import {useDisplayTime} from './DisplayTime';
import {apiFetch} from './auth-client';
import {useEffect,useState,useId} from 'react';
import {ArrowUpRight,CaretRight,ArrowsClockwise,AppleLogo,Buildings,SlidersHorizontal,Tag,ChartBar,Stack,Coins,Note} from '@phosphor-icons/react';
import {PriceChart} from './Charts';
import {ChartLegend} from './ChartLegend';
import {ChartHeader,ChartLevels,useSavedTimeframe} from './ChartSettings';
import {SetupExplanation} from './SetupExplanation';
import {useMarketChart,useMarketQuotes} from './useMarketData';
import {useZoneRoles} from './ZoneRoles';
import {quoteKey,quotePrice,quoteChange,quoteTone,quoteDelay} from './data/quotes.mjs';
import {matchingInstrument,formatDate,zoneName,zoneText} from './data/market';

import {marketDay} from './data/calendar.mjs';
import {stageLabel} from './data/retests.mjs';
import {useStockSetup} from './useStockSetup';
import {CompanyNews} from './CompanyNews';
import './company-detail.css';
import './company-overview.css';
import './company-financials.css';
import {CompanyEarnings} from './CompanyEarnings';
import {PortfolioPosition} from './PortfolioPosition';
import {PortfolioStockChart} from './PortfolioStockChart';
import {portfolioAverageLine} from './data/portfolio-listings.mjs';
import {usePortfolioChartOrders,PortfolioChartOrders} from './PortfolioChartOrders';
import {portfolioChartOrderLines} from './data/portfolio-chart-orders.mjs';

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
const signedSummaryMetrics=new Set(['grossMargin','operatingMargin','dividendYield','ytdReturn','threeYearReturn','fiveYearReturn']);
function MetricGrid({data,ids,compact=false}){
 const labels={marketCap:data.fund?'Net assets':'Market cap',trailingPE:'P/E TTM',priceBook:'Price / book',dividendYield:'Dividend yield',grossMargin:'Gross margin',operatingMargin:'Operating margin',cash:'Cash',debt:'Debt',freeCashflow:'Free cash flow'};
 return <dl className="company-metrics">{ids.map(id=>{
  const metric=data.metrics[id];
  if(!metric)return null;
  const signed=compact&&signedSummaryMetrics.has(id)&&Number.isFinite(metric.value);
  const tone=signed&&metric.value!==0?(metric.value>0?'green':'red'):undefined;
  return <div key={id}>
   <dt title={metric.label}>{compact?(labels[id]||metric.label):metric.label}</dt>
   <dd className={tone}>{metricValue(metric)}</dd>
   {metric.asOf&&<small>As of {formatDate(metric.asOf)}</small>}
  </div>;
 })}</dl>;
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
 const description=p.description||'Business description not supplied.';
 const abbreviated=description.length>230;
 const summary=abbreviated?description.slice(0,230).replace(/\s+\S*$/,'')+'…':description;
 const facts=[['Listing',`${entry.symbol} · ${entry.exchange}`],['Currency',data.currency],['Company / fund type',data.fund?data.type:'Corporate (Equity)'],['Observation',q?quoteDelay(q):'Unavailable'],['Coverage','U.S. listing'],['Data source','Yahoo Finance']];
 const extra=data.fund?[['Fund family',p.fundFamily],['Category',p.category],['Inception',p.inception?formatDate(p.inception):null]]:[['Sector',p.sector],['Industry',p.industry],['Headquarters',[p.city,p.country].filter(Boolean).join(', ')],['Employees',number(p.employees,{maximumFractionDigits:0})],['Session volume',number(q?.volume,{notation:'compact'})]];
 return <section className="company-profile">
  <h3>{data.fund?'Fund profile':'Company profile'}</h3><p className="company-description">{summary}</p>
  <h4>{data.fund?'Fund facts':'Company facts'}</h4>
  <dl className="company-profile-facts">{facts.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value||'Not supplied'}</dd></div>)}</dl>
  <details className="company-disclosure"><summary>More about {entry.symbol}</summary>
   {abbreviated&&<p>{description}{description.length===700?'…':''}</p>}
   <dl className="company-profile-facts">{extra.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value||'Not supplied'}</dd></div>)}</dl>
   <div className="company-links">{p.website&&<a href={p.website} target="_blank" rel="noopener noreferrer">Company website <ArrowUpRight size={14}/></a>}{p.investorRelations&&<a href={p.investorRelations} target="_blank" rel="noopener noreferrer">Investor relations <ArrowUpRight size={14}/></a>}</div>
  </details>
 </section>;
}
const statements=[['income','Income statement'],['balance','Balance sheet'],['cash','Cash flow']];
const incomeFields=[['Revenue','revenue'],['Gross profit','grossProfit'],['Operating income','operatingIncome'],['Net income','income']];

function IncomeStatement({rows,currency,period}){
 if(!rows.length)return <p className="company-unavailable">No {period} income statement history supplied for this listing.</p>;
 return <div className="table-scroll" tabIndex={0} role="region" aria-label="Reported income statements">
  <table>
   <thead><tr><th scope="col">Item</th>{rows.map(row=><th scope="col" key={row.period}>{/^\d{4}$/.test(row.period)?`FY${row.period}`:row.period}</th>)}</tr></thead>
   <tbody>{incomeFields.map(([label,key])=><tr key={key}><th scope="row">{label}</th>{rows.map(row=>{
    const value=row[key];
    const millions=Number.isFinite(value)?value/1e6:null;
    const precision=millions&&Math.abs(millions)<0.01?{maximumSignificantDigits:2}:{};
    return <td key={row.period} className={value<0?'red':undefined} title={Number.isFinite(value)?`${currency?currency+' ':''}${number(value)}`:undefined}>{number(millions,precision)}</td>;
   })}</tr>)}</tbody>
  </table>
 </div>;
}

function FinancialHistory({data}){
 const [period,setPeriod]=useState('annual'),[statement,setStatement]=useState('income');
 const isIncome=statement==='income',isBalance=statement==='balance';
 const currency=isIncome?(data.earnings?.currency||data.financialCurrency):data.financialCurrency;
 const snapshotPeriod=isBalance?'latest reported quarter':'trailing 12 months';
 return <section className="company-history">
  <div className="company-statement-controls">
   <div className="company-statement-tabs" role="group" aria-label="Financial statement">{statements.map(([id,label])=><button key={id} aria-pressed={statement===id} onClick={()=>setStatement(id)}>{label}</button>)}</div>
   <div className="segmented" role="group" aria-label="Financial history period">{['annual','quarterly'].map(id=><button key={id} aria-pressed={period===id} className={period===id?'selected':''} onClick={()=>setPeriod(id)}>{id==='quarterly'?'Quarterly':'Annual'}</button>)}</div>
  </div>
  <p className="company-statement-caption">{isIncome?`${currency?currency+' millions':'Amounts in millions · currency unavailable'} · Fiscal periods`:`Available snapshot · ${snapshotPeriod}`}</p>
  <div className="company-statement-body">
   {isIncome?<IncomeStatement rows={(data[period]||[]).toReversed()} currency={currency} period={period}/>:<div className="company-statement-unavailable">
    <p>No {period} {isBalance?'balance sheet':'cash flow'} history supplied.</p>
    <MetricGrid data={data} ids={isBalance?['cash','debt','debtEquity','currentRatio']:['operatingCashflow','freeCashflow']}/>
   </div>}
   <aside aria-label="Statement details">
    <div><Stack size={20} aria-hidden="true"/><span>Statement currency<strong>{currency||'Not supplied'}</strong></span></div>
    <div><Note size={20} aria-hidden="true"/><span>Reported values<small>{isIncome?'Company-reported figures for each fiscal period.':`Yahoo Finance snapshot · ${snapshotPeriod}.`}</small></span></div>
   </aside>
  </div>
  {isIncome&&<p className="company-statement-caption">A dash means the source did not supply a figure.</p>}
 </section>;
}

const corporateSummaries=[
 ['Valuation',Tag,['marketCap','trailingPE','priceBook','dividendYield']],
 ['Profitability',ChartBar,['grossMargin','operatingMargin']],
 ['Balance sheet',Stack,['cash','debt']],
 ['Cash flow',Coins,['freeCashflow']],
];

function Financials({data,clockStamp,zoneLabel}){
 const summaries=data.fund?[
  ['Fund information',Stack,['marketCap','expenseRatio','fundYield']],
  ['Fund returns',ChartBar,['ytdReturn','threeYearReturn','fiveYearReturn']],
 ]:corporateSummaries;
 return <div className="company-financials">
  <div className={`company-financial-summary${data.fund?' company-fund-summary':''}`}>{summaries.map(([title,Icon,ids])=>
   <section key={title}><h3><Icon size={19} aria-hidden="true"/>{title}</h3><MetricGrid data={data} ids={ids} compact/></section>
  )}</div>
  {!data.fund&&<FinancialHistory data={data}/>}
  <details className="company-disclosure company-financial-details"><summary><Stack size={18} aria-hidden="true"/>All financial metrics &amp; source dates</summary>
   <p className="company-report-note">Quote currency: {data.currency||'not supplied'} · Financial statements: {data.financialCurrency||'not supplied'} · Latest reported quarter: {data.quarter?formatDate(data.quarter):'not supplied'}<br/>TTM means trailing 12 months.</p>
   <div className="company-two-column">{data.groups.map(group=><section className="company-card" key={group.id}><h3>{group.title}</h3><MetricGrid data={data} ids={group.ids}/></section>)}</div>
   <div className="company-two-column"><EarningsCard data={data}/><section className="company-card">
    <h3>Corporate actions &amp; source dates</h3>
    <div className="company-event-row"><span>Latest stock split</span><strong>{data.split.factor||'Not supplied'}</strong></div>
    <div className="company-event-row"><span>Split date</span><strong>{data.split.date?formatDate(data.split.date):'Not supplied'}</strong></div>
    <p className="small-copy muted">Trading snapshot quoted {clockStamp(data.quoteObservedAt)} {zoneLabel}. Financial, ownership and short-interest figures can have different reporting dates. Company snapshots refresh every 30 minutes.</p>
   </section></div>
  </details>
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
 const history=useMarketChart(key,timeframe,tab==='overview'&&!simpleChart),roles=useZoneRoles(matchingInstrument(entry,sheet),sheet.date,key);
 const listingQuotes=useMarketQuotes([],false,[key],!result,false);
 const quoteResult=result||listingQuotes[key],q=quoteResult?.quote;
 const chartQuote=q||history.quote;
 const setup=useStockSetup(entry,sheet,setupInterval),stale=quoteResult?.status==='stale',instrument=roles.instrument;
 const [showAverage,setShowAverage]=useState(true),averageLine=portfolioAverageLine(position?.holding,history.quote,entry);
 const [showOrders,setShowOrders]=useState(true),canReadOrders=!!position?.connected&&position.platform==='Trading 212'&&!hideBalances;
 const orderState=usePortfolioChartOrders(position?.accountId,position?.holding?.ticker,canReadOrders&&tab==='overview');
 const orderLines=hideBalances?[]:portfolioChartOrderLines(orderState.data,position,entry,orderState.stale);
 const chartOrderLines=showOrders&&history.quote?.providerSymbol===entry.symbol.replaceAll('.','-')?orderLines.filter(line=>line.currency===history.quote.currency):[];
 const source=snapshot.status==='loading'?'Loading company snapshot…':snapshot.status==='unavailable'?snapshot.message:`${snapshot.status==='stale'?'Cached snapshot':'Yahoo company snapshot'} · Fetched ${clockStamp(snapshot.fetchedAt)} ${zoneLabel}`;
 const Logo=entry.symbol==='AAPL'?AppleLogo:Buildings;
 const snapshotFooter=<footer className="company-footer"><span role="status">{source}{data?.quoteObservedAt&&` · Snapshot observation ${clockStamp(data.quoteObservedAt)} ${zoneLabel}`}{tab==='financials'?' · TTM: trailing 12 months':''}</span><div><button className="icon-button" aria-label="Refresh company snapshot" onClick={snapshot.refresh}><ArrowsClockwise size={15}/></button><a href={data?.sourceUrl||`https://finance.yahoo.com/quote/${encodeURIComponent(entry.symbol.replaceAll('.','-'))}/`} target="_blank" rel="noopener noreferrer">Source page <ArrowUpRight size={13}/></a></div></footer>;
 return <div className="company-detail" data-tab={tab}>
  <div className="company-masthead">
   <header className="company-identity">
    <span className="company-mark" aria-hidden="true"><Logo size={30} weight={entry.symbol==='AAPL'?'fill':'regular'}/></span>
    <div className="company-identity-copy">
     <h3><strong>{data?.name||q?.name||entry.symbol}</strong><span> · {entry.symbol} · {entry.exchange} · {q?.currency||data?.currency||'—'}</span></h3>
     <div className="company-quote">
      <strong>{quotePrice(q)}</strong><span className={quoteTone(q)}>{quoteChange(q)}</span>
      <small>{q?`Yahoo Finance · ${quoteStamp(q)} · ${quoteDelay(q)}`:quoteResult?.status==='loading'?'Loading quote…':'Quote unavailable'}{stale?' · Cached / old market data':''}</small>
     </div>
    </div>
    {onUseCustom&&<button className="button primary company-use" onClick={onUseCustom}><SlidersHorizontal size={15}/>Use as Custom</button>}
   </header>
  <div className="company-tabs" role="tablist" aria-label="Company details" onKeyDown={navigateTabs}>{tabs.map(([id,label])=><button key={id} id={`${tabId}-${id}`} role="tab" aria-controls={`${tabId}-panel`} tabIndex={tab===id?0:-1} aria-selected={tab===id} onClick={()=>selectTab(id)}>{label}</button>)}</div></div>
  {snapshot.status!=='ok'&&<p className="company-source-warning" role="status">{source}{snapshot.status==='stale'&&<> · {snapshot.message}</>}</p>}
  <div id={`${tabId}-panel`} role="tabpanel" aria-labelledby={`${tabId}-${tab}`} tabIndex={0}>
  {tab==='overview'&&<div className="company-overview">
   {position&&<><PortfolioPosition position={position} compact><div className="company-chart-choice segmented" aria-label="Holding chart view"><button aria-pressed={!simpleChart} className={!simpleChart?'selected':''} onClick={()=>setSimpleChart(false)}>Candles & levels</button><button aria-pressed={simpleChart} className={simpleChart?'selected':''} onClick={()=>setSimpleChart(true)}>Price history</button></div>{!simpleChart&&<div className="pm-chart-position"><label><input type="checkbox" checked={showAverage&&!hideBalances} disabled={!averageLine||hideBalances} onChange={e=>setShowAverage(e.target.checked)}/><i/>Average paid {hideBalances?'••••':number(position.holding.averagePrice)} {position.holding.instrumentCurrency}</label><span>{averageLine?`Account reference · ${entry.exchange}:${entry.symbol}`:history.status==='loading'?'Checking chart currency…':'Average line unavailable: chart symbol and currency must match the holding.'}</span></div>}</PortfolioPosition></>}
   {position&&simpleChart?<PortfolioStockChart entry={entry} position={position} instrument={instrument} sheetDate={sheet.date} orderLines={showOrders?orderLines:[]}/>:<section className="context-chart-panel company-chart" aria-label={`${entry.symbol} company chart`}><ChartHeader symbol={entry.symbol} quote={chartQuote} marketKey={key} timeframe={timeframe} onTimeframe={setTimeframe} roles={roles} showToolLabels/><ChartLevels scope={`${key}|${timeframe}`} instrument={instrument} date={sheet.date} roles={roles} quoteDate={chartQuote?.sessionDate}/>

    <SetupExplanation symbol={entry.symbol} result={setup}/>
    {history.candles?.length>0&&<ChartLegend scope={`${key}|${timeframe}`} indicators={history.indicators}/>}
    {history.candles?.length?<PriceChart symbol={entry.symbol} drawingKey={key} timeframe={timeframe} candles={history.candles} price={history.quote.price} instrument={instrument} indicators={history.indicators} referenceLine={showAverage&&!hideBalances?averageLine:null} orderLines={chartOrderLines}/>:<div className="empty" role="status"><h3>{history.status==='loading'?'Loading company chart…':'Company chart unavailable'}</h3><p>{history.message||'Fetching regular-session candles.'}</p></div>}
    <div className="chart-footnote"><span>{history.status==='stale'?'Cached / old history · ':''}Regular-session history · Yahoo Finance · {timeframe==='4h'?'4h from hourly bars · ':''}partial candles marked</span><span>{history.quote?.observedAt&&<>Observed {quoteStamp(history.quote)} · </>}Refreshes each minute</span></div>
   </section>}
   <div className="company-overview-bottom"><section className="company-setup"><h3>Break & retest</h3><div className="company-setup-status"><span className={setup?.direction==='bearish'?'red':setup?.stage==='confirmed'?'green':'amber'}>{stageLabel(setup?.stage||'loading')}</span><span>Confirmation · {setupInterval}</span></div><p>{setup?.message||`${setup?.direction==='bullish'?'Bullish':setup?.direction==='bearish'?'Bearish':'Monitoring'}${setup?.zone?` · ${setup.direction==='bullish'?'Break above':'Break below'} ${zoneText(setup.zone)}`:' · EMA 9/21 + session VWAP'}`}</p>
    <details className="company-exact-levels" open><summary>Exact level list<small>{instrument?`Sheet ${instrument.sourceDate||sheet.date} · ${instrument.timeframe}`:'No matching sheet'}{instrument?.carriedForward?' · Carried forward':''}</small></summary><div aria-label={`All ${entry.symbol} levels`}>{instrument?instrument.zones.map((z,i)=><div className="level-row" key={i}><span className={z.type==='S'?'red':z.type==='D'?'green':'amber'}>{zoneName(z.type)}</span><strong>{zoneText(z)}</strong>{z.lastFlip&&<small>Flipped from {zoneName(z.lastFlip.from).toLowerCase()}</small>}</div>):<p className="muted">No matching levels in your sheet.</p>}</div></details>
    <details className="company-disclosure"><summary>Strategy checks & earnings dates</summary>{setup?.checks?.map(c=><div className="company-event-row" key={c.name}><span>{c.name}</span><strong className={c.passed===true?'green':'amber'}>{c.passed===null?'Unavailable':c.passed?'Aligned':'Conflict'}</strong></div>)}{setup?.through&&<p className="small-copy muted">Checked through {clockStamp(setup.through*1000)} {zoneLabel} · regular session {setup.sessionDate}</p>}<p>Options bid/ask, Greeks and contract liquidity are not connected.</p>{data&&<EarningsCard data={data}/>}</details>
   </section>{data?<Profile data={data} entry={entry} q={chartQuote}/>:<section><h3>Company profile</h3><p className="muted">{snapshot.status==='loading'?'Loading source information…':snapshot.message}</p></section>}</div>
   {canReadOrders&&<PortfolioChartOrders state={orderState} lines={orderLines} shown={showOrders} onToggle={setShowOrders} matched={!!position.orderListing&&position.orderListing.id===entry.id&&(!orderState.data||orderState.data.priceCurrency===position.holding.instrumentCurrency)}/>}
  </div>}
  {tab==='financials'&&(data?<Financials data={data} clockStamp={clockStamp} zoneLabel={zoneLabel}/>:<div className="empty"><h3>{snapshot.status==='loading'?'Loading financials…':'Financials unavailable'}</h3><p>{snapshot.message||'Fetching the company snapshot.'}</p></div>)}
  {tab==='earnings'&&<CompanyEarnings key={key} data={data} status={snapshot.status} message={snapshot.message} source={source}/>}
  {tab==='news'&&<CompanyNews key={entry.id} symbol={entry.symbol}/>}
  </div>
  {snapshotFooter}
 </div>;
}
