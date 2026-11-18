const interestTypes=new Set(['INTEREST_ON_FREE_CASH','LENDING_INTEREST']);
const fields=['realized','distributions','interest','charges','cashFees'];

export function annualTotals(account){
  const rows=new Map();
  const missingResults=account.trades.filter(t=>t.side==='SELL'&&(!Number.isFinite(t.realized)||!t.currency)).length;
  const missingCharges=account.trades.filter(t=>!Array.isArray(t.charges)).length;
  function row(currency){
    if(currency&&!rows.has(currency))rows.set(currency,{currency,realized:null,distributions:null,interest:null,charges:null,cashFees:null});
    return rows.get(currency);
  }
  function add(currency,key,amount){
    const r=row(currency);
    if(r&&Number.isFinite(amount))r[key]=(r[key]??0)+amount;
  }
  row(account.currency);
  for(const t of account.trades){
    add(t.currency,'realized',t.realized);
    for(const c of t.charges||[])add(c.currency,'charges',c.amount);
  }
  for(const d of account.income)add(d.currency,'distributions',d.amount);
  for(const f of account.funding){
    row(f.currency);
    if(interestTypes.has(f.type))add(f.currency,'interest',f.amount);
    if(f.type==='FEE')add(f.currency,'cashFees',f.amount);
  }
  const complete={realized:account.tradesComplete&&!missingResults,distributions:account.incomeComplete,
    interest:account.fundingComplete,cashFees:account.fundingComplete,charges:account.tradesComplete&&!missingCharges};
  for(const r of rows.values())for(const key of fields)if(r[key]===null&&complete[key])r[key]=0;
  return {currencies:[...rows.values()],missingResults,missingCharges};
}

const categories=[
  ['executions','Executions',['trades']],['funding','Funding',['funding']],
  ['distributions','Dividends & distributions',['income']],['interest','Interest',['funding']],
  ['charges','Charges',['trades','funding']]
];

export function annualCoverage(accounts){
  const rows=Object.fromEntries(categories.map(([key,label,sources])=>[key,{key,label,sources,count:0,from:null,to:null}]));
  function record(row,at,count=1){
    if(!count)return;
    row.count+=count;
    if(!Number.isFinite(at))return;
    row.from=Math.min(row.from??at,at);
    row.to=Math.max(row.to??at,at);
  }
  let missingResults=0,missingCharges=0;
  for(const a of accounts){
    for(const t of a.trades){
      record(rows.executions,t.at);
      if(t.side==='SELL'&&(!Number.isFinite(t.realized)||!t.currency))missingResults++;
      if(!Array.isArray(t.charges))missingCharges++;
      else record(rows.charges,t.at,t.charges.length);
    }
    for(const d of a.income)record(rows.distributions,d.at);
    for(const f of a.funding)record(interestTypes.has(f.type)?rows.interest:f.type==='FEE'?rows.charges:rows.funding,f.at);
  }
  for(const row of Object.values(rows)){
    const complete=accounts.length>0&&accounts.every(a=>row.sources.every(s=>a[s+'Complete']===true));
    const missing=row.key==='charges'?missingCharges:row.key==='executions'?missingResults:0;
    const checked=accounts.some(a=>row.sources.some(s=>a[s+'Complete']||Number.isFinite(a.coverage?.[s])));
    row.status=complete&&!missing?'Complete':row.count||checked||missing?'Partial':'Unavailable';
  }
  const checkpoints=accounts.flatMap(a=>['trades','funding','income'].map(s=>a.coverage?.[s]));
  const checkedThrough=checkpoints.length&&checkpoints.every(Number.isFinite)?Math.min(...checkpoints):null;
  return {rows:Object.values(rows),checkedThrough,missingResults,missingCharges};
}
