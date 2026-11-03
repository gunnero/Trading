export const PORTFOLIO_RANGES=['1D','1W','1M','1Y','MAX'];
export function portfolioRangeStart(range,now=Date.now()){
  if(!PORTFOLIO_RANGES.includes(range))throw Error('Choose a supported performance range.');
  if(range==='MAX')return 0;
  if(range==='1D'||range==='1W')return now-(range==='1D'?1:7)*86400000;
  const date=new Date(now),day=date.getUTCDate();date.setUTCDate(1);
  if(range==='1M')date.setUTCMonth(date.getUTCMonth()-1);else date.setUTCFullYear(date.getUTCFullYear()-1);
  const last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();date.setUTCDate(Math.min(day,last));return +date;
}
function compact(points,limit=240){
  if(points.length<=limit)return points;
  // Keep actual samples, including endpoints; never manufacture intermediate values.
  return Array.from({length:limit},(_,i)=>points[Math.round(i*(points.length-1)/(limit-1))]);
}
export function sampledPerformance(samples,range,now=Date.now()){
  const from=portfolioRangeStart(range,now),rows=samples.filter(r=>r.at<=now).sort((a,b)=>a.at-b.at),latest=rows.at(-1);
  if(!latest)return {amount:null,points:[],coverage:'unavailable',from,to:null,baselineAt:null};
  if(range==='MAX')return {amount:latest.pnl,points:compact(rows.map(r=>({at:r.at,value:r.pnl}))),coverage:'recorded',from:rows[0].at,to:latest.at,baselineAt:null};
  const boundary=rows.filter(r=>r.at<=from).at(-1),inside=rows.filter(r=>r.at>=from);
  // A recorded point near the boundary can approximate a rolling window. Long
  // gaps remain explicit; never call an old Friday value a Monday baseline.
  const baseline=boundary&&from-boundary.at<=(range==='1Y'?36*3600000:30*60000)?boundary:inside[0];
  if(!baseline||latest.at<=baseline.at)return {amount:null,points:[],coverage:'insufficient',from,to:latest.at,baselineAt:baseline?.at||null};
  return {amount:latest.pnl-baseline.pnl,points:compact(rows.filter(r=>r.at>=baseline.at).map(r=>({at:r.at,value:r.pnl-baseline.pnl}))),coverage:baseline===boundary?'sampled':'partial',from,to:latest.at,baselineAt:baseline.at};
}
export function realizedPerformance(fills,range,now=Date.now()){
  const from=portfolioRangeStart(range,now),rows=fills.filter(r=>r.at>=from&&r.at<=now).sort((a,b)=>a.at-b.at);
  const missing=rows.filter(r=>!Number.isFinite(r.pnl)).length;
  if(missing)return {amount:null,points:[],missing,count:rows.length,from,to:now};
  let total=0;const points=[];
  for(const row of rows){total+=row.pnl;const previous=points.at(-1);if(previous?.at===row.at)previous.value=total;else points.push({at:row.at,value:total});}
  return {amount:total,points:compact(points),missing:0,count:rows.length,from:range==='MAX'?(rows[0]?.at||null):from,to:now};
}
