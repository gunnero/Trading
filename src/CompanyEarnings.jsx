import {useState,useEffect,useRef} from 'react';
import {formatDate} from './data/market';
import {earningsComparison} from './data/company-earnings.mjs';
import './company-earnings.css';
const number=(n,options={})=>Number.isFinite(n)?n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2,...options}):'—';
const percent=n=>Number.isFinite(n)?`${n>0?'+':''}${number(n)}%`:'—';

function EarningsChart({rows}){
 const container=useRef(null),[available,setAvailable]=useState(540);
 const width=Math.max(available,rows.length*85),height=230,top=20,bottom=185,left=52,right=18;
 const values=rows.flatMap(r=>[r.actual,r.estimate]).filter(Number.isFinite);
 const hasValues=values.length>0;
 useEffect(()=>{if(!container.current)return;const el=container.current;const update=()=>setAvailable(Math.max(300,Math.floor(el.clientWidth)));update();const observer=new ResizeObserver(update);observer.observe(el);return()=>observer.disconnect();},[hasValues]);
 if(!hasValues)return null;
 const low=Math.min(0,...values),high=Math.max(0,...values),span=high-low||1;
 const y=v=>bottom-(v-low)/span*(bottom-top),slot=(width-left-right)/rows.length,bar=Math.min(34,slot*.24);
 return <div ref={container} className="company-eps-scroll" tabIndex={0} role="region" aria-label="EPS comparison chart, scroll horizontally for older quarters"><svg width={width} height={height} role="img" aria-label="Actual versus estimated EPS by fiscal quarter. Exact values follow in the table.">
  {[low,(low+high)/2,high].filter((v,i,a)=>a.indexOf(v)===i).map(v=><g key={v}><line x1={left} x2={width-right} y1={y(v)} y2={y(v)} stroke="#2a414a" strokeDasharray={v===0?undefined:'3 4'}/><text x={left-7} y={y(v)+4} textAnchor="end">{number(v)}</text></g>)}
  {rows.map((r,i)=>{const x=left+slot*(i+.5);return <g key={r.end||r.period}><title>{r.period}: actual {number(r.actual)}, estimate {number(r.estimate)}</title>{[[r.actual,-bar-3,'#24c4b0'],[r.estimate,3,'#9bafb9']].map(([v,dx,color],j)=>Number.isFinite(v)&&<rect key={j} x={x+dx} y={Math.min(y(v),y(0))} width={bar} height={Math.max(1,Math.abs(y(v)-y(0)))} rx="2" fill={color} opacity={j?.55:1}/>)}<text x={x} y={bottom+24} textAnchor="middle">{r.period}</text></g>;})}
 </svg></div>;
}
export function CompanyEarnings({data,status,message,financialHistory}){
 const [selected,setSelected]=useState(null),[year,setYear]=useState('all');
 if(!data)return <div className="empty" role="status"><h3>{status==='loading'?'Loading earnings…':'Earnings unavailable'}</h3><p>{message||'Fetching reported results for this company.'}</p></div>;
 if(data.fund)return <section className="company-card"><h3>Earnings reports do not apply to this fund</h3><p className="muted">Funds do not publish corporate quarterly EPS results. Fund information and distributions are available in Overview and Financials.</p></section>;
 const e=data.earnings,series=e.series?.length?e.series:[{id:'default',basis:e.basis,history:e.history}],active=series.find(s=>s.id===(selected||e.defaultSeries))||series[0];
 const all=active.history.toReversed(),years=[...new Set(all.map(r=>/\d{4}/.exec(r.period)?.[0]).filter(Boolean))].sort().reverse(),rows=year==='all'?all:all.filter(r=>r.period.includes(year));
 const latest=all[0],comparison=latest&&earningsComparison(latest);
 return <div className="company-earnings">
  <section className="company-card company-earnings-results">
   <div className="company-card-heading"><div><span className="eyebrow">EARNINGS HISTORY</span><h3>Previous earnings</h3></div><div className="company-earnings-filters">{series.length>1&&<label>EPS basis<select aria-label="EPS basis" value={active.id} onChange={event=>setSelected(event.target.value)}>{series.map(s=><option key={s.id} value={s.id}>{s.basis}</option>)}</select></label>}<label>Fiscal year<select aria-label="Fiscal year" value={year} onChange={event=>setYear(event.target.value)}><option value="all">All available</option>{years.map(y=><option key={y}>{y}</option>)}</select></label></div></div>
   <p className="company-earnings-coverage">{all.length} available quarter{all.length===1?'':'s'}{all.length?` · ${all.at(-1).period} – ${all[0].period}`:''} · {active.basis} EPS per listed share</p>
   <p className="small-copy muted">Yahoo supplies recent quarters, not the company’s full lifetime history. Every available quarter is shown below. GAAP and Non-GAAP results use different accounting bases; estimates can also differ from the Nasdaq calendar.</p>
   {latest&&<div className="company-earnings-summary"><div><span>Latest actual EPS · {latest.period}</span><strong>{number(latest.actual)}</strong><small>{latest.reported?`Reported ${formatDate(latest.reported)}`:'Report date not supplied'}</small></div><div><span>Consensus EPS</span><strong>{number(latest.estimate)}</strong><small>{active.basis}</small></div><div><span>EPS surprise</span><strong className={comparison.tone}>{percent(comparison.percent)}</strong><small className={comparison.tone}>{comparison.result}{comparison.derived?' · calculated':''}</small></div></div>}
   {rows.length?<><div className="company-eps-heading"><h4>Actual vs. estimated EPS</h4><div className="company-eps-legend"><span><i/>Actual</span><span><i/>Estimate</span></div></div><EarningsChart rows={rows.toReversed()}/><div className="table-scroll" tabIndex={0} role="region" aria-label="Previous earnings reports"><table><thead><tr><th scope="col">Fiscal quarter</th><th scope="col">Reported</th><th scope="col">Actual EPS</th><th scope="col">Estimate EPS</th><th scope="col">Surprise</th><th scope="col">Result</th></tr></thead><tbody>{rows.map(row=>{const c=earningsComparison(row);return <tr key={row.end||row.period}><th scope="row">{row.period}{row.end&&<small>Ended {formatDate(row.end)}</small>}</th><td>{row.reported?formatDate(row.reported):'—'}</td><td>{number(row.actual)}</td><td>{number(row.estimate)}</td><td className={c.tone} title={c.derived?'Calculated: (actual − estimate) ÷ absolute estimate × 100':'As supplied by Yahoo'}>{percent(c.percent)}{c.derived&&<small>Calculated</small>}</td><td><span className={`company-eps-result ${c.tone}`}>{c.result}</span></td></tr>;})}</tbody></table></div><p className="small-copy muted">{rows.length} of {all.length} available quarters · EPS uses Yahoo’s listed-share basis; EPS currency is not specified by this feed. “—” means not supplied. Calculated surprises use (actual − estimate) ÷ |estimate|; a zero estimate has no calculated percentage.</p></>:<p className="muted">{all.length?'No results for this fiscal year.':'No previous earnings supplied for this company.'}</p>}
  </section>
  {financialHistory}
 </div>;
}
