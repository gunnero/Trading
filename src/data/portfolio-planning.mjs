// Cash-flow adjusted estimates use linked Modified Dietz intervals. Historical
// valuations are required; deposits must never masquerade as investment gains.
const day=86400000,finite=Number.isFinite;
export function allocationPlan(snapshot,targets={}){
  const empty={rows:[],reason:'A complete positive account value, cash balance and holding values are required.'};
  if(!snapshot||!(snapshot.accountValue>0)||!finite(snapshot.cash)||snapshot.cash<0||snapshot.holdings.some(h=>!finite(h.value)||h.value<0))return empty;
  const sum=snapshot.cash+snapshot.holdings.reduce((n,h)=>n+h.value,0);
  if(Math.abs(sum-snapshot.accountValue)>Math.max(1,snapshot.accountValue*.005))return {...empty,reason:'Holdings and cash do not reconcile with account value. Refresh the broker snapshot before planning.'};
  const entries=[...snapshot.holdings.map(h=>({key:h.ticker,name:h.name,value:h.value,price:h.price,currency:h.instrumentCurrency})),{key:'CASH',name:'Cash',value:snapshot.cash}];
  if(Object.keys(targets).some(key=>!entries.some(e=>e.key===key)))return {...empty,reason:'A saved target is no longer held. Update the targets before preparing a plan.'};
  const configured=Object.keys(targets).length>0;
  return {reason:null,configured,total:snapshot.accountValue,currency:snapshot.currency,rows:entries.map(e=>{
    const target=configured?(Object.hasOwn(targets,e.key)?targets[e.key]:0):null,delta=target===null?null:snapshot.accountValue*target/100-e.value;
    return {...e,weight:e.value/snapshot.accountValue*100,target,delta,shares:e.key!=='CASH'&&delta!==null&&e.price>0&&e.currency===snapshot.currency?Math.floor(Math.abs(delta)/e.price*1e8)/1e8:null};
  })};
}
export function contributionBreakdown(snapshot,executions){
  const rows=new Map();
  const get=(ticker,name,currency)=>{const key=ticker+':'+currency;if(!rows.has(key))rows.set(key,{ticker,name,currency,open:0,realized:0,missing:0});return rows.get(key);};
  for(const h of snapshot?.holdings||[]){const r=get(h.ticker,h.name,snapshot.currency);if(finite(h.unrealized))r.open+=h.unrealized;else r.open=null;}
  for(const f of executions.items){if(f.side!=='SELL'&&!finite(f.realized))continue;const r=get(f.ticker,f.name,f.currency||'Unknown');if(finite(f.realized))r.realized+=f.realized;else r.missing++;}
  return {complete:executions.complete,coveredThrough:executions.coveredThrough,rows:[...rows.values()].map(r=>({...r,total:r.open===null||r.missing?null:r.open+r.realized})).sort((a,b)=>(b.total??-Infinity)-(a.total??-Infinity))};
}
export function performanceIndex(ledger,currency,from=0,now=Date.now()){
  const empty=reason=>({points:[],reason});
  if(!ledger.complete)return empty('Complete funding history is required.');
  const end=Math.min(now,ledger.coveredThrough||0);
  let rows=[...new Map(ledger.values.filter(v=>v.currency===currency&&finite(v.value)&&v.value>=0&&v.at>=from&&v.at<=end).map(v=>[v.at,v])).values()].sort((a,b)=>a.at-b.at);
  const funded=rows.findIndex(v=>v.value>0);rows=funded<0?[]:rows.slice(funded);
  if(rows.length<2)return empty('At least two positive dated account observations are required in this range.');
  const movements=ledger.flows.filter(f=>f.at>rows[0].at&&f.at<=rows.at(-1).at);
  if(movements.some(f=>!['DEPOSIT','WITHDRAW','FEE','INTEREST_ON_FREE_CASH','LENDING_INTEREST'].includes(f.type)))return empty('Transfers or unsupported cash movements prevent a verified comparison.');
  const flows=movements.filter(f=>['DEPOSIT','WITHDRAW'].includes(f.type)).sort((a,b)=>a.at-b.at);
  if(flows.some(f=>f.currency!==currency||!finite(f.amount)))return empty('Foreign-currency or incomplete funding cannot be converted reliably.');
  let index=100,cursor=0,estimated=rows.some(v=>v.estimated),flowAdjusted=false;
  const points=[{at:rows[0].at,value:index,accountValue:rows[0].value}];
  for(let i=1;i<rows.length;i++){
    const a=rows[i-1],b=rows[i];let net=0,weighted=0;
    while(cursor<flows.length&&flows[cursor].at<=b.at){const f=flows[cursor++],amount=f.type==='WITHDRAW'?-Math.abs(f.amount):f.amount;net+=amount;weighted+=amount*(b.at-f.at)/(b.at-a.at);flowAdjusted=true;}
    const capital=a.value+weighted;if(!(capital>0))return empty('A zero or negative capital interval prevents a reliable return index.');
    const factor=1+(b.value-a.value-net)/capital;
    if(!finite(factor)||factor<=0)return empty('A depleted account interval prevents a continuous return index.');
    index*=factor;if(!finite(index))return empty('The return index is outside the supported range.');points.push({at:b.at,value:index,accountValue:b.value});
  }
  return {points,reason:null,estimated,flowAdjusted,ratePercent:index-100,start:rows[0].at,end:rows.at(-1).at};
}
export function drawdownSummary(points){
  if(points.length<2)return null;
  let peak=points[0],max=0,worst=null,episode=null;
  for(const p of points){
    if(p.value>=peak.value-1e-10){if(episode&&worst?.peakAt===episode.peakAt&&!worst.recoveredAt)worst.recoveredAt=p.at;peak=p;episode=null;}
    else {const decline=(p.value/peak.value-1)*100;if(!episode)episode={peakAt:peak.at};if(decline<max){max=decline;worst={peakAt:peak.at,troughAt:p.at,recoveredAt:null};}}
  }
  const last=points.at(-1);return {currentPercent:(last.value/peak.value-1)*100,maxPercent:max,...worst,recoveryDays:worst?.recoveredAt?(worst.recoveredAt-worst.peakAt)/day:null,underwaterDays:episode?(last.at-episode.peakAt)/day:0};
}
export function benchmarkComparison(ledger,currency,prices,from=0,now=Date.now()){
  if(currency!=='USD')return {reason:'SPY and QQQ are USD benchmarks. Comparison requires a USD account; no FX conversion is assumed.',points:[]};
  if(prices?.currency!=='USD'||!prices.points?.length)return {reason:'Verified benchmark history is unavailable.',points:[]};
  // Pair actual readings within a day. No extrapolation over a missing session,
  // no newer close applied to an earlier account observation.
  const rows=ledger.values.filter(v=>v.currency===currency&&v.at>=from&&v.at<=Math.min(now,ledger.coveredThrough||0)).sort((a,b)=>a.at-b.at),matched=[];
  let cursor=0;
  for(const price of [...prices.points].sort((a,b)=>a.at-b.at)){while(cursor<rows.length&&rows[cursor].at<price.at)cursor++;const v=rows[cursor];if(v&&v.at-price.at<=day&&finite(price.value)&&price.value>0&&(!matched.length||v.at>matched.at(-1).at))matched.push({...v,benchmarkAt:price.at,benchmarkPrice:price.value});}
  const index=performanceIndex({...ledger,values:matched},currency,from,now);
  if(index.reason)return {reason:'Not enough overlapping account observations and benchmark closes. '+index.reason,points:[]};
  const byTime=new Map(matched.map(p=>[p.at,p])),first=byTime.get(index.start),points=index.points.map(p=>({...p,benchmark:(byTime.get(p.at).benchmarkPrice/first.benchmarkPrice)*100,benchmarkAt:byTime.get(p.at).benchmarkAt}));
  return {...index,points,benchmarkPercent:points.at(-1).benchmark-100,benchmarkStart:first.benchmarkAt,benchmarkEnd:points.at(-1).benchmarkAt};
}
export function annualTotals(account){
  const totals=new Map(),add=(currency,key,value)=>{if(!finite(value)||!currency)return;if(!totals.has(currency))totals.set(currency,{currency,realized:0,distributions:0,charges:0,interest:0,cashFees:0});totals.get(currency)[key]+=value;};
  for(const f of account.trades){add(f.currency,'realized',f.realized);for(const c of f.charges||[])add(c.currency,'charges',c.amount);}
  for(const d of account.income)add(d.currency,'distributions',d.amount);
  for(const f of account.funding){if(['INTEREST_ON_FREE_CASH','LENDING_INTEREST'].includes(f.type))add(f.currency,'interest',f.amount);if(f.type==='FEE')add(f.currency,'cashFees',f.amount);}
  return {currencies:[...totals.values()],missingResults:account.trades.filter(f=>f.side==='SELL'&&!finite(f.realized)).length,missingCharges:account.trades.filter(f=>f.charges===null).length};
}
