import {portfolioListing} from './portfolio-listings.mjs';
import {activityDateBounds} from './portfolio-activity.mjs';
import {moneyWeightedReturn} from './portfolio-rate.mjs';

export function portfolioExposure(data,watchlist=[]){
  const buckets=new Map();let missingAccounts=0,demoAccounts=0;
  for(const account of data.accounts){
    if(account.environment==='demo'){demoAccounts++;continue;}
    const s=account.snapshot;if(!s){missingAccounts++;continue;}
    let bucket=buckets.get(s.currency);if(!bucket){bucket={currency:s.currency,total:0,missing:0,rows:new Map()};buckets.set(s.currency,bucket);}
    const known=s.holdings.reduce((n,h)=>n+(Number.isFinite(h.value)?h.value:0),0);
    for(const h of s.holdings){
      if(!Number.isFinite(h.value)){bucket.missing++;continue;}
      const listing=portfolioListing(h,watchlist),identity=h.isin?`isin:${h.isin}:${h.instrumentCurrency}`:listing?listing.id:`${account.platform}:${h.ticker}:${h.instrumentCurrency}`;
      const key=h.isin||listing||s.source==='api'?identity:`manual:${account.id}:${identity}`;
      let row=bucket.rows.get(key);if(!row){row={key,name:h.name,symbol:listing?.symbol||h.ticker,identity:h.isin||listing?.id||h.ticker,instrumentCurrency:h.instrumentCurrency,value:0,accounts:[]};bucket.rows.set(key,row);}
      row.value+=h.value;bucket.total+=h.value;
      row.accounts.push({id:account.id,person:data.people.find(p=>p.id===account.personId)?.name||'Unknown person',label:account.label,value:h.value,quantity:h.quantity,weight:known>0?h.value/known*100:null,observedAt:s.fetchedAt||s.observedAt||null,source:s.source,connected:account.connected,error:account.error});
    }
  }
  return {missingAccounts,demoAccounts,buckets:[...buckets.values()].map(b=>({...b,rows:[...b.rows.values()].sort((a,b)=>b.value-a.value).map(r=>({...r,weight:b.total>0?r.value/b.total*100:null,accountCount:new Set(r.accounts.map(a=>a.id)).size,shared:new Set(r.accounts.map(a=>a.id)).size>1}))}))};
}
export function monthBounds(month,timeZone='Europe/Skopje'){
  if(typeof month!=='string'||!/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(month))throw Error('Choose a valid month.');
  const last=new Date(Date.UTC(+month.slice(0,4),+month.slice(5),0)).toISOString().slice(0,10);
  return activityDateBounds(month+'-01',last,timeZone);
}
export function monthlyReturn(ledger,currency,bounds,now=Date.now()){
  const empty={amount:null,ratePercent:null,coverage:'unavailable',start:null,end:null,netFunding:null};
  if(!ledger.complete)return {...empty,reason:'Complete funding history is required.'};
  const end=Math.min(bounds.to-1,now,ledger.coveredThrough||0),rows=ledger.values.filter(v=>v.currency===currency&&v.at<=end).sort((a,b)=>a.at-b.at);
  const boundary=rows.filter(v=>v.at<=bounds.from).at(-1),tolerance=v=>v?.estimated?36*3600000:30*60000;
  const first=boundary&&bounds.from-boundary.at<=tolerance(boundary)?boundary:rows.find(v=>v.at>=bounds.from),last=rows.at(-1);
  if(!first||!last||last.at<=first.at||last.at<bounds.from)return {...empty,reason:'Earlier account values are unavailable for this month.'};
  const movements=ledger.flows.filter(t=>t.at>first.at&&t.at<=last.at);
  if(movements.some(t=>!['DEPOSIT','WITHDRAW','FEE','INTEREST_ON_FREE_CASH','LENDING_INTEREST'].includes(t.type)))return {...empty,reason:'Transfers or unsupported cash movements prevent a verified return.'};
  const funding=movements.filter(t=>['DEPOSIT','WITHDRAW'].includes(t.type));
  if(funding.some(t=>t.currency!==currency))return {...empty,reason:'Foreign-currency funding cannot be converted reliably.'};
  const flows=funding.map(t=>({at:t.at,amount:t.type==='DEPOSIT'?t.amount:-Math.abs(t.amount)})),netFunding=flows.reduce((n,f)=>n+f.amount,0);
  const complete=first===boundary&&Math.min(bounds.to-1,now)-last.at<=tolerance(last),estimated=!!first.estimated||!!last.estimated;
  return {amount:last.value-first.value-netFunding,ratePercent:moneyWeightedReturn({startAt:first.at,endAt:last.at,startValue:first.value,endValue:last.value,flows}),netFunding,start:first,end:last,coverage:complete?(estimated?'estimated':'recorded'):'partial',reason:null};
}
export function safeCsv(rows){
  return '\uFEFF'+rows.map(row=>row.map(value=>{
    let text=value===null||value===undefined?'':String(value);
    if(typeof value!=='number'&&/^[\s\u0000-\u001f]*[=+@-]/.test(text))text="'"+text;
    return '"'+text.replaceAll('"','""')+'"';
  }).join(',')).join('\r\n')+'\r\n';
}
export function reportCsv(report){
  const rows=[['Monthly portfolio report',report.month,report.timeZone,'Generated',new Date(report.generatedAt).toISOString()],['Person','Account','Environment','Section','Date (UTC)','Instrument / type','Currency','Amount / value','Shares','Price','Price currency','Coverage / notes']];
  for(const a of report.accounts){
    const add=(section,at,name,currency,amount,shares=null,price=null,priceCurrency='',note='')=>rows.push([a.person,a.label,a.environment,section,at?new Date(at).toISOString():'',name,currency,amount,shares,price,priceCurrency,note]);
    add('Return',a.performance.end?.at,'Account return',a.currency,a.performance.amount,null,null,'',a.performance.reason||a.performance.coverage);
    add('Return rate',a.performance.end?.at,'Calculated MWRR (%)',a.currency,a.performance.ratePercent,null,null,'',a.performance.coverage);
    for(const edge of ['start','end'])if(a.performance[edge])add('Valuation',a.performance[edge].at,edge,a.currency,a.performance[edge].value,null,null,'',a.performance[edge].estimated?'Reconstructed estimate':'Recorded');
    for(const f of a.funding)add('Cash movement',f.at,f.type,f.currency,f.amount,null,null,'',a.fundingComplete?'Complete import':'Partial import');
    for(const f of a.trades){add('Execution',f.at,f.name,f.currency,f.netValue,f.quantity,f.price,f.priceCurrency,`${f.side} · execution ${f.id} · ${a.tradesComplete?'History imported':'Partial history'}`);if(f.realized!==null)add('Realized P/L',f.at,f.name,f.currency,f.realized);for(const c of f.charges||[])add('Execution charge',f.at,c.name,c.currency,c.amount);}
    for(const d of a.income)add('Distribution',d.at,d.type,d.currency,d.amount,null,null,'',`${d.name} · ${a.incomeComplete?'Complete import':'Partial import'}`);
    for(const warning of a.warnings)add('Coverage',null,'',null,null,null,null,'',warning);
  }
  return safeCsv(rows);
}
