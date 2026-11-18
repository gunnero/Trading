import {addDays} from './calendar.mjs';

export function reportWeeks(month,lastDay){
  const weeks=[];
  for(let from=month+'-01';from<=lastDay;){
    const weekday=new Date(from+'T12:00:00Z').getUTCDay();
    const sunday=addDays(from,(7-weekday)%7);
    const to=sunday>lastDay?lastDay:sunday;
    weeks.push({from,to});
    from=addDays(to,1);
  }
  return weeks;
}

const categories=[
  ['buys','Trades (buy)','trades'],['sells','Trades (sell)','trades'],['income','Distributions','income'],
  ['deposits','Deposits','funding'],['withdrawals','Withdrawals','funding'],
  ['charges','Execution charges','trades'],['cashFees','Cash fees','funding'],
  ['interest','Interest','funding'],['other','Other cash movements','funding']
];

function tally(){return {count:0,known:0,sum:0};}
function record(group,value){
  group.count++;
  if(Number.isFinite(value)){group.known++;group.sum+=value;}
}
function observed(group,complete){
  return group.known?group.sum:complete&&!group.count?0:null;
}

// Each bucket contains one ledger currency and either live or demo accounts.
export function monthlyActivity(report){
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:report.timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
  const monthEnd=new Date(Date.UTC(+report.month.slice(0,4),+report.month.slice(5),0)).toISOString().slice(0,10);
  const asOf=date.format(report.generatedAt);
  const weeks=reportWeeks(report.month,asOf<monthEnd?asOf:monthEnd);
  const buckets=new Map(),groups=new Map();
  let unassigned=0;
  for(const a of report.accounts){
    const scope=a.environment==='demo'?'demo':'live';
    if(!groups.has(scope))groups.set(scope,[]);
    groups.get(scope).push(a);
    function bucket(currency){
      if(!currency)return null;
      const key=scope+'/'+currency;
      if(!buckets.has(key))buckets.set(key,{key,scope,currency,realized:tally(),weeks:weeks.map(w=>({...w,...tally()})),rows:Object.fromEntries(categories.map(([k])=>[k,tally()]))});
      return buckets.get(key);
    }
    bucket(a.currency);
    for(const trade of a.trades){
      const b=bucket(trade.currency);
      if(b){
        const buy=trade.side==='BUY';
        const net=Number.isFinite(trade.netValue)?Math.abs(trade.netValue)*(buy?-1:1):null;
        record(b.rows[buy?'buys':'sells'],net);
        if(!buy||Number.isFinite(trade.realized)){
          record(b.realized,trade.realized);
          const day=date.format(trade.at),week=b.weeks.find(w=>w.from<=day&&day<=w.to);
          if(week)record(week,trade.realized);
        }
      }else unassigned++;
      for(const charge of trade.charges||[])record(bucket(charge.currency).rows.charges,charge.amount);
    }
    for(const d of a.income)record(bucket(d.currency).rows.income,d.amount);
    for(const f of a.funding){
      const key=({DEPOSIT:'deposits',WITHDRAW:'withdrawals',FEE:'cashFees',INTEREST_ON_FREE_CASH:'interest',LENDING_INTEREST:'interest'})[f.type]||'other';
      record(bucket(f.currency).rows[key],key==='withdrawals'?-Math.abs(f.amount):f.amount);
    }
  }
  for(const b of buckets.values()){
    const accounts=groups.get(b.scope);
    const complete=kind=>accounts.every(a=>a[kind+'Complete']===true);
    // A fill without wallet currency or a charge list cannot establish a zero.
    const knownWallet=accounts.every(a=>a.trades.every(t=>t.currency));
    const knownCharges=accounts.every(a=>a.trades.every(t=>Array.isArray(t.charges)));
    const tradesComplete=complete('trades')&&knownWallet;
    b.partial=!tradesComplete||!complete('income')||!complete('funding')||!knownCharges||b.realized.known<b.realized.count;
    b.result=observed(b.realized,tradesComplete);
    b.weeks=b.weeks.map(w=>({...w,amount:observed(w,tradesComplete)}));
    b.summary=categories.map(([key,label,source])=>{
      const row=b.rows[key];
      const full=complete(source)&&(source!=='trades'||(key==='charges'?knownCharges:knownWallet));
      if(row.known<row.count)b.partial=true;
      return {key,label,count:row.count|| (full?0:null),amount:observed(row,full)};
    }).filter((r,i)=>i<6||b.rows[r.key].count);
  }
  return {buckets:[...buckets.values()],unassigned};
}
