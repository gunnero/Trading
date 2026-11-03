import {moneyWeightedReturn} from './portfolio-rate.mjs';
export const PORTFOLIO_RANGES=['1D','1W','1M','3M','YTD','1Y','MAX'];
export function portfolioRangeStart(range,now=Date.now()){
  if(!PORTFOLIO_RANGES.includes(range))throw Error('Choose a supported performance range.');
  if(range==='MAX')return 0;
  if(range==='YTD')return Date.UTC(new Date(now).getUTCFullYear(),0,1);
  if(range==='1D'||range==='1W')return now-(range==='1D'?1:7)*86400000;
  const date=new Date(now),day=date.getUTCDate();date.setUTCDate(1);
  if(range==='1M'||range==='3M')date.setUTCMonth(date.getUTCMonth()-(range==='3M'?3:1));else date.setUTCFullYear(date.getUTCFullYear()-1);
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
  const boundary=rows.filter(r=>r.at<=from).at(-1);
  // A recorded point near the boundary can approximate a rolling window. Long
  // gaps remain explicit; never call an old Friday value a Monday baseline.
  const baseline=boundary&&from-boundary.at<=(['3M','1Y','YTD'].includes(range)?36*3600000:30*60000)?boundary:null;
  if(!baseline)return {amount:null,points:[],coverage:'partial',from,to:latest.at,baselineAt:null,trackingFrom:rows[0].at};
  if(latest.at<=baseline.at)return {amount:null,points:[],coverage:'insufficient',from,to:latest.at,baselineAt:baseline?.at||null};
  return {amount:latest.pnl-baseline.pnl,points:compact(rows.filter(r=>r.at>=baseline.at).map(r=>({at:r.at,value:r.pnl-baseline.pnl}))),coverage:'sampled',from,to:latest.at,baselineAt:baseline.at};
}
export function accountPerformance(valuations,transactions,currency,range,now=Date.now()){
  const latest=valuations.filter(v=>v.at<=now).sort((a,b)=>a.at-b.at).at(-1);
  const unavailable={amount:null,points:[],coverage:'unavailable',netDeposits:null,totalReturn:null,ratePercent:null,accountValue:latest?.value??null,reason:null};
  if(!latest)return {...unavailable,reason:'No account valuation has been recorded.'};
  const movements=transactions.filter(t=>t.at<=latest.at);
  // TRANSFER does not identify external funding vs internal movement. Unknown
  // transaction types and foreign funding must never be counted as profit.
  if(movements.some(t=>!['DEPOSIT','WITHDRAW','FEE','INTEREST_ON_FREE_CASH','LENDING_INTEREST'].includes(t.type)))return {...unavailable,reason:'Funding history contains transfers or unsupported movements. Their effect on net deposits cannot be verified.'};
  const funding=movements.filter(t=>['DEPOSIT','WITHDRAW'].includes(t.type)).sort((a,b)=>a.at-b.at);
  if(!funding.length)return {...unavailable,reason:'No deposits or withdrawals were supplied; net deposits cannot be verified.'};
  if(funding.some(t=>t.currency!==currency))return {...unavailable,reason:'Deposits or withdrawals use another currency. The API does not supply the conversion needed to verify net deposits.'};
  let index=0,netDeposits=0;const rows=[];
  for(const valuation of valuations.filter(v=>v.at>=funding[0].at&&v.at<=now).sort((a,b)=>a.at-b.at)){
    while(index<funding.length&&funding[index].at<=valuation.at){const movement=funding[index++];netDeposits+=movement.type==='DEPOSIT'?movement.amount:-Math.abs(movement.amount);}
    rows.push({at:valuation.at,pnl:valuation.value-netDeposits});
  }
  const performance=sampledPerformance(rows,range,now),startAt=range==='MAX'?funding[0].at:performance.baselineAt;
  const startValue=range==='MAX'?0:valuations.find(v=>v.at===startAt)?.value;
  const flows=funding.filter(t=>range==='MAX'||t.at>startAt).map(t=>({at:t.at,amount:t.type==='DEPOSIT'?t.amount:-Math.abs(t.amount)}));
  const ratePercent=Number.isFinite(performance.amount)?moneyWeightedReturn({startAt,endAt:latest.at,startValue,endValue:latest.value,flows}):null;
  return {...performance,netDeposits,totalReturn:latest.value-netDeposits,accountValue:latest.value,ratePercent,rateMethod:ratePercent===null?null:'calculated-mwrr',reason:null};
}
// The graph holds realized P/L constant between executions, including the
// period boundary and the current observation time. These are calculated
// balance points, not extra trades or invented market observations.
export function realizedChartPoints(result){
  if(!Number.isFinite(result?.amount)||!Number.isFinite(result.from)||!Number.isFinite(result.to))return [];
  const points=[{at:result.from,value:0},...result.points];
  if(points.at(-1).at<result.to)points.push({at:result.to,value:result.amount});
  return points;
}
export function realizedPerformance(fills,range,now=Date.now()){
  const from=portfolioRangeStart(range,now),rows=fills.filter(r=>r.at>=from&&r.at<=now).sort((a,b)=>a.at-b.at);
  const missing=rows.filter(r=>!Number.isFinite(r.pnl)).length;
  if(missing)return {amount:null,points:[],missing,count:rows.length,from,to:now};
  let total=0;const points=[];
  for(const row of rows){total+=row.pnl;const previous=points.at(-1);if(previous?.at===row.at)previous.value=total;else points.push({at:row.at,value:total});}
  return {amount:total,points,missing:0,count:rows.length,from:range==='MAX'?(rows[0]?.at||null):from,to:now};
}
