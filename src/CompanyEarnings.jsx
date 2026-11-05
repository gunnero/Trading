import {useState,useEffect,useRef} from 'react';
import {CalendarBlank} from '@phosphor-icons/react';
import {formatDate} from './data/market';
import {marketDay} from './data/calendar.mjs';
import {earningsComparison,reportedRevenue} from './data/company-earnings.mjs';
import './company-earnings.css';
const number=(n,options={})=>Number.isFinite(n)?n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2,...options}):'—';
const percent=n=>Number.isFinite(n)?`${n>0?'+':''}${number(n)}%`:'—';

function EarningsChart({rows,revenue=false,currency}){
 const element=useRef(null),values=rows.flatMap(r=>revenue?[r.revenue]:[r.actual,r.estimate]),available=values.some(Number.isFinite);
 const largest=Math.max(0,...values.filter(Number.isFinite).map(Math.abs)),scale=revenue?(largest>=1e9?1e9:largest>=1e6?1e6:1):1,unit=scale===1e9?'billions':scale===1e6?'millions':'';
 useEffect(()=>{
  if(!available)return;
  let active=true,chart,observer;
  import('./earnings-chart.mjs').then(core=>{
   if(!active)return;chart=core.init(element.current);
   const series=[{name:'Reported',type:'bar',barMaxWidth:32,data:rows.map(r=>Number.isFinite(revenue?r.revenue:r.actual)?(revenue?r.revenue:r.actual)/scale:null),label:{show:true,position:'top',fontSize:9,color:'#251b3a',formatter:p=>number(p.value,{minimumFractionDigits:0})}}];
   if(!revenue)series.push({name:'Estimate',type:'bar',barMaxWidth:32,data:rows.map(r=>r.estimate),label:{show:true,position:'top',fontSize:9,color:'#251b3a',formatter:p=>number(p.value)}});
   chart.setOption({animation:false,color:['#713bdd','#cbb5f4'],textStyle:{fontFamily:'Inter',color:'#251b3a'},grid:{left:40,right:10,top:25,bottom:25},tooltip:{trigger:'axis',confine:true},xAxis:{type:'category',data:rows.map(r=>r.period),axisTick:{show:false},axisLine:{lineStyle:{color:'#ddd8ea'}},axisLabel:{fontSize:9,interval:0}},yAxis:{type:'value',splitNumber:4,axisLabel:{fontSize:9,color:'#6f6483'},splitLine:{lineStyle:{color:'#e8e1f2'}}},series});
   observer=new ResizeObserver(()=>chart.resize());observer.observe(element.current);
  }).catch(()=>{});
  return()=>{active=false;observer?.disconnect();chart?.dispose();};
 },[rows,revenue,scale,available]);
 return <section className="company-earnings-chart"><div className="company-eps-heading"><h4>{revenue?`Revenue · ${currency||'currency unspecified'} ${unit}`:'EPS per listed share'}</h4><div className="company-eps-legend"><span><i/>Reported</span>{!revenue&&<span><i/>Estimate</span>}</div></div>{available?<div key="chart" ref={element} className="company-eps-canvas" role="img" aria-label={revenue?'Reported revenue by fiscal quarter. Exact values follow in the table.':'Actual versus estimated EPS by fiscal quarter. Exact values follow in the table.'}/>:<div key="empty" className="company-chart-empty">No reported {revenue?'revenue':'EPS'} supplied for these fiscal quarters.</div>}{revenue&&<small>Historical revenue estimates not supplied.</small>}</section>;
}
export function CompanyEarnings({data,status,message}){
 const [selected,setSelected]=useState(null),[year,setYear]=useState('all');
 if(!data)return <div className="empty" role="status"><h3>{status==='loading'?'Loading earnings…':'Earnings unavailable'}</h3><p>{message||'Fetching reported results for this company.'}</p></div>;
 if(data.fund)return <section className="company-card"><h3>Earnings reports do not apply to this fund</h3><p className="muted">Funds do not publish corporate quarterly EPS results. Fund information and distributions are available in Overview and Financials.</p></section>;
 const e=data.earnings,series=e.series?.length?e.series:[{id:'default',basis:e.basis,history:e.history}],active=series.find(s=>s.id===(selected||e.defaultSeries))||series[0];
 const all=active.history.toReversed().map(r=>({...r,revenue:reportedRevenue(r,data.quarterly)})),years=[...new Set(all.map(r=>/\d{4}/.exec(r.period)?.[0]).filter(Boolean))].sort().reverse(),rows=year==='all'?all:all.filter(r=>r.period.includes(year));
 const latest=all[0],comparison=latest&&earningsComparison(latest),chartRows=rows.slice(0,4).toReversed(),today=marketDay(Date.now()),future=e.dates.filter(d=>d>=today);
 return <div className="company-earnings">
  <div className="company-earnings-banner"><div><h3>Earnings</h3><p>Quarterly earnings per listed share (EPS) and revenue for {data.name}, including reported results and publisher estimates.</p></div><div className="company-next-report"><CalendarBlank size={20}/><div><span>{future.length?'Next report':e.dates.length?'Latest listed report date':'Next report'}</span><strong>{(future.length?future:e.dates).map(formatDate).join(' – ')||'Date not supplied'}{e.dates.length&&e.estimated===true?' · Estimated':''}</strong><p>{future.length?'Exact release time not supplied':e.dates.length?'Past date · next release not supplied':'Schedule unavailable'}</p></div></div></div>
  <div className="company-earnings-filters"><span>{active.basis} · {all.length} available quarter{all.length===1?'':'s'}</span>{series.length>1&&<label>EPS basis<select aria-label="EPS basis" value={active.id} onChange={event=>setSelected(event.target.value)}>{series.map(s=><option key={s.id} value={s.id}>{s.basis}</option>)}</select></label>}<label>Fiscal year<select aria-label="Fiscal year" value={year} onChange={event=>setYear(event.target.value)}><option value="all">All available</option>{years.map(y=><option key={y}>{y}</option>)}</select></label></div>
  {rows.length?<><div className="company-earnings-charts"><EarningsChart rows={chartRows}/><EarningsChart rows={chartRows} revenue currency={data.financialCurrency}/></div>
  <section className="company-earnings-results"><div className="company-card-heading"><h3>Earnings history</h3>{latest?.reported&&<span><CalendarBlank size={14}/>Previous report: {formatDate(latest.reported)}</span>}</div><div className="table-scroll" tabIndex={0} role="region" aria-label="Previous earnings reports"><table><thead><tr><th scope="col">Fiscal quarter</th><th scope="col">Report date</th><th scope="col">EPS reported</th><th scope="col">EPS estimate</th><th scope="col">Revenue</th><th scope="col">Result / surprise</th></tr></thead><tbody>{rows.map(row=>{const c=earningsComparison(row);return <tr key={row.end||row.period}><th scope="row">{row.period}{row.end&&<small>Ended {formatDate(row.end)}</small>}</th><td>{row.reported?formatDate(row.reported):'—'}</td><td>{number(row.actual)}</td><td>{number(row.estimate)}</td><td>{number(row.revenue,{notation:'compact',minimumFractionDigits:0})}{Number.isFinite(row.revenue)&&data.financialCurrency?` ${data.financialCurrency}`:''}</td><td><span className={`company-eps-result ${c.tone}`}>{c.result}</span>{c.percent!==null&&<small className={c.tone} title={c.derived?'Calculated: (actual − estimate) ÷ absolute estimate × 100':'As supplied by Yahoo'}>{percent(c.percent)}</small>}</td></tr>;})}</tbody></table></div><p className="company-earnings-coverage">{rows.length} of {all.length} available quarters · Charts show the latest {chartRows.length} selected quarters · “—” means not supplied.</p></section></>:<p className="company-unavailable">{all.length?'No results for this fiscal year.':'No previous earnings supplied for this company.'}</p>}
  <details className="company-disclosure"><summary>Reporting basis & coverage</summary>{latest&&<p className="company-earnings-summary">Latest actual EPS: {number(latest.actual)} · Consensus: {number(latest.estimate)} · <span className={comparison.tone}>{comparison.result} {percent(comparison.percent)}</span></p>}<p>Yahoo supplies recent quarters, not the company’s full lifetime history. Every available quarter is shown in the table. GAAP and Non-GAAP results use different accounting bases; estimates can differ from the Nasdaq calendar. EPS currency is not specified by this feed. Revenue retains the financial statement currency and is matched only to the same published fiscal period. Upcoming revenue consensus is not a historical estimate. Calculated surprises use (actual − estimate) ÷ |estimate|; a zero estimate has no calculated percentage. Schedules can change.</p></details>
 </div>;
}
