export const MAX_BANK_SOURCES=6;
export const PLATFORMS=['IBKR','Trading212','Vanquish'];
export const ACTIVITIES={deposit:'Deposit',withdrawal:'Withdrawal',cost:'Cost',refund:'Refund',exclude:'Exclude / duplicate'};
export const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
export function decimal(value,{nullable=false}={}){
 if(value===null&&nullable)return null;
 if(typeof value!=='string'||! /^-?\d{1,24}(?:\.\d{1,8})?$/.test(value))throw Error('Amounts must be exact decimal strings (up to eight decimal places).');
 const [whole,fraction='']=value.split('.'),negative=whole.startsWith('-');
 const digits=whole.replace('-','').replace(/^0+(?=\d)/,'');const f=fraction.replace(/0+$/,'');
 return `${negative&&(digits!=='0'||f)?'-':''}${digits}${f?'.'+f:''}`;
}
const units=value=>{const text=decimal(value),negative=text.startsWith('-'),[whole,fraction='']=text.replace('-','').split('.');return BigInt(whole+fraction.padEnd(8,'0'))*(negative?-1n:1n);};
const fromUnits=value=>decimal(`${value<0n?'-':''}${(value<0n?-value:value)/100000000n}.${((value<0n?-value:value)%100000000n).toString().padStart(8,'0')}`);
export const addMoney=(a,b)=>fromUnits(units(a)+units(b));
export const subtractMoney=(a,b)=>fromUnits(units(a)-units(b));
export const magnitude=value=>decimal(value).replace('-','');
export function moneyText(value,currency){if(value===null)return '—';const [whole,fraction='']=decimal(value).split('.');return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')}.${fraction.padEnd(2,'0')} ${currency||'Unknown currency'}`;}
function optionalText(value,max){if(value===null)return null;if(typeof value!=='string'||value.length>max)throw Error('Invalid bank transaction text.');return value;}
export function normalizeExport(rows,source){
 if(!Array.isArray(rows)||rows.length>5000)throw Error('Expected an NLB JSON array with at most 5,000 transactions.');
 if(!source||!['account','card'].includes(source.kind)||typeof source.key!=='string'||source.key.length>200||!source.key)throw Error('Select an account or card source.');
 if(source.kind==='account'&&!/^[A-Z]{3}$/.test(source.currency||''))throw Error('Confirm the account currency first.');
 const fields=source.kind==='account'?['date','recipient','description','status','amount','fee','balance']:['date','description','amount','currency'];
 return rows.map(row=>{
  if(!row||typeof row!=='object'||fields.some(key=>!Object.hasOwn(row,key))||Object.keys(row).some(key=>!fields.includes(key)&&!(source.kind==='card'&&['bookingDate','settlementAmount'].includes(key))))throw Error('This file does not match the NLB v1 transaction export.');
  if(row.bookingDate!==undefined&&row.bookingDate!==null&&!validDay(row.bookingDate))throw Error('Invalid booking date.');
  if(row.date!==null&&!validDay(row.date))throw Error('Invalid bank transaction date.');
  if([row.amount,row.fee,row.balance].some(value=>typeof value==='string'&&value.replace('-','').split('.')[0].length>18))throw Error('Source amounts exceed the supported precision.');
  const currency=source.kind==='account'?source.currency:row.currency;
  if(currency!==null&&(typeof currency!=='string'||!/^[A-Z]{3}$/.test(currency)))throw Error('Invalid transaction currency.');
  return {...(source.kind==='card'&&row.settlementAmount!==undefined?{settlementAmount:decimal(row.settlementAmount,{nullable:true}),bookingDate:row.bookingDate||null}:{}),date:row.date,description:optionalText(row.description,2000),recipient:source.kind==='account'?optionalText(row.recipient,500):null,status:source.kind==='account'?optionalText(row.status,100):null,amount:decimal(row.amount,{nullable:true}),currency,fee:source.kind==='account'?decimal(row.fee,{nullable:true}):null,balance:source.kind==='account'?decimal(row.balance,{nullable:true}):null};
 });
}
export function matchKey(row){return JSON.stringify([row.sourceKey,row.description,row.recipient,row.status,row.amount===null?null:row.amount.startsWith('-')?'-':'+']);}
export function suggestion(row){const text=`${row.recipient||''} ${row.description||''}`.toLowerCase();if(/interactive brokers|\bibkr\b/.test(text))return 'IBKR';if(/trading\s*212/.test(text))return 'Trading212';if(/vanquish|\bvanq\b/.test(text))return 'Vanquish';return '';}
// Match the merchant wording in Opis, not variable reference prefixes or account IDs.
export function descriptionPlatform(row){
 const text=(row.description||'').normalize('NFKC').replace(/\s+/g,' ').trim();
 if(/\bINTERACTIVE BROKERS(?: LLC)?\b|\bIBKR\b/i.test(text+' '+(row.recipient||'')))return 'IBKR';
 // Generic wire receipts with a broker-style reference are candidates only.
 if(row.kind==='account'&&row.description==='Девизен прилив'&&['USD','EUR'].includes(row.currency)&&row.amount&&!row.amount.startsWith('-')&&/\bU\d{5,12}\b/.test(row.recipient||''))return 'IBKR';
 if(/\bVANQUISH TRADER\b/i.test(text))return 'Vanquish';
 if(/\bLONDON TRADING 212\b/i.test(text))return 'Trading212';
 return '';
}
export function automaticDescriptionReview(row){
 if(row.review||row.possibleDuplicate||row.possibleChange||!['card','account'].includes(row.kind)||!['Vanquish','Trading212','IBKR'].includes(descriptionPlatform(row))||!row.amount?.startsWith('-'))return null;
 try{const platform=descriptionPlatform(row);if(platform==='Trading212'&&row.kind!=='card')return null;if(platform==='IBKR'){if(row.kind!=='account')return null;const activity=row.description==='Провизија за девизен налог за плаќање'?'cost':row.description==='Девизен налог за плаќање'?'deposit':null;if(!activity)return null;return {...validateReview(row,{platform,activity}),automatic:true};}return {...validateReview(row,{platform,activity:platform==='Trading212'?'deposit':'cost'}),automatic:true};}catch{return null;}
}
// Account credits identify the sender; card credits carry the original currency.
// Pair only unique exact MKD amounts within three booking days. Never pair by
// the card purchase date: banks can reuse the original deposit date on refunds.
export function tradingRows(rows){
 // The bank repeats wire fees in the card history. Only reconcile a unique
 // account fee with a unique exact card representation; retain raw records.
 const feeAccount=row=>row.kind==='account'&&row.currency==='MKD'&&row.amount?.startsWith('-')&&row.description==='Провизија за девизен налог за плаќање'&&descriptionPlatform(row)==='IBKR';
 const sameFee=(a,b)=>a.date===b.date&&a.currency===b.currency&&a.amount===b.amount;
 const resolvedFees=new Set(),duplicateFees=new Map();
 const identicalFee=(a,b)=>['sourceKey','date','description','recipient','currency','amount','balance','fee','status'].every(key=>a[key]===b[key]);
 for(const row of rows.filter(feeAccount)){
  if(row.possibleChange||!validDay(row.date))continue;
  const accounts=rows.filter(other=>feeAccount(other)&&sameFee(row,other));
  const cards=rows.filter(other=>other.kind==='card'&&sameFee(row,other)&&other.description==='1980 - 1980 - Девизен налог за плаќање'&&!other.possibleChange&&!other.review);
  if(cards.length!==1)continue;
  if(accounts.length===1){resolvedFees.add(row);continue;}
  // User-approved correction: identical account snapshots with the same balance
  // and one card charge represent one fee. Conflicting evidence stays untouched.
  if(row.balance==null||!row.sourceKey||accounts.some(other=>!other.id||other.possibleChange||!identicalFee(row,other)||other.review&&(other.review.platform!=='IBKR'||other.review.activity!=='cost')))continue;
  if(new Set(accounts.map(other=>other.id)).size!==accounts.length)continue;
  const canonical=[...accounts].sort((a,b)=>a.id.localeCompare(b.id))[0];resolvedFees.add(canonical);
  for(const other of accounts)if(other!==canonical)duplicateFees.set(other,canonical.id);
 }
 rows=rows.map(row=>duplicateFees.has(row)?{...row,settlementOnly:true,duplicateOf:duplicateFees.get(row)}:resolvedFees.has(row)?{...row,possibleDuplicate:false,reconciledBankFee:true}:row);
 const named=row=>/\bLONDON TRADING 212\b/i.test((row.recipient||'').normalize('NFKC').replace(/\s+/g,' '));
 const positive=value=>typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value)&&Number(value)>0;
 const safe=row=>!row.possibleDuplicate&&!row.possibleChange&&row.review?.activity!=='exclude';
 const accounts=rows.filter(row=>row.kind==='account'&&row.currency==='MKD'&&positive(row.amount));
 const cards=rows.filter(row=>row.kind==='card'&&positive(row.amount)&&positive(row.settlementAmount)&&validDay(row.bookingDate)&&validDay(row.date)&&row.review?.activity!=='exclude'&&(!row.review||row.review.platform==='Trading212'&&row.review.activity==='withdrawal')&&(/^(?:Uplata na tekuai raeun \(kartica\))$/i.test((row.description||'').trim())||descriptionPlatform(row)==='Trading212'));
 const related=(account,card)=>validDay(account.date)&&addMoney(account.amount,'0')===addMoney(card.settlementAmount,'0')&&Date.parse(card.bookingDate)>=Date.parse(account.date)&&Date.parse(card.bookingDate)-Date.parse(account.date)<=3*86400000;
 const links=new Map(),settlements=new Set();
 for(const account of accounts.filter(row=>named(row)&&safe(row)&&(!row.review||row.review.platform==='Trading212'&&row.review.activity==='withdrawal'))){
  const matches=cards.filter(card=>related(account,card));
  if(matches.length!==1||accounts.filter(other=>related(other,matches[0])).length!==1)continue;
  links.set(matches[0],account);settlements.add(account);
 }
 return rows.filter(row=>descriptionPlatform(row)||named(row)||links.has(row)).map(row=>({...row,
  review:row.review||(links.has(row)&&safe(row)?{platform:'Trading212',activity:'withdrawal',automatic:true}:automaticDescriptionReview(row)),
  ...(links.has(row)?{linkedAccountId:links.get(row).id,matchedPlatform:'Trading212'}:{}),
  ...(settlements.has(row)?{settlementOnly:true}:{})
 }));
}
export function validateReview(row,review){
 if(!review||!Object.hasOwn(ACTIVITIES,review.activity))throw Error('Choose a transaction category.');
 if(review.activity==='exclude')return {platform:'',activity:'exclude'};
 if(!PLATFORMS.includes(review.platform))throw Error('Choose a platform.');
 if(!row.date||row.amount===null||!row.currency||row.amount==='0')throw Error('Missing date, amount or currency: this transaction can only be excluded.');
 const outgoing=row.amount.startsWith('-');
 if(outgoing!==['deposit','cost'].includes(review.activity))throw Error('The category must match the source amount direction.');
 return {platform:review.platform,activity:review.activity};
}
// Fees remain MKD. A unique same-day bank wire identifies the currency section,
// not an exchange rate; incomplete conversion evidence never becomes zero.
export function convertMoney(amount,fromRate,toRate='1'){
 const a=units(amount),from=units(fromRate),to=units(toRate);if(from<=0n||to<=0n)throw Error('Invalid exchange rate');
 const n=a*from*100n,d=to*100000000n,negative=n<0n,abs=negative?-n:n,cents=(abs+d/2n)/d;
 return decimal(`${negative&&cents?'-':''}${cents/100n}.${String(cents%100n).padStart(2,'0')}`);
}
export function ibkrBankBreakdown(rows,fx=null){
 const rates=fx?.rates&&['USD','EUR'].every(c=>typeof fx.rates[c]==='string'&&/^\d+(\.\d{1,8})?$/.test(fx.rates[c])&&Number(fx.rates[c])>0)?fx.rates:null;
 const included=rows.filter(r=>!r.settlementOnly&&r.review?.platform==='IBKR'&&r.review.activity!=='exclude');
 const wires=included.filter(r=>r.kind==='account'&&['USD','EUR'].includes(r.currency)&&['deposit','withdrawal'].includes(r.review.activity));
 const fees=included.filter(r=>r.kind==='account'&&r.currency==='MKD'&&r.review.activity==='cost'&&r.description==='Провизија за девизен налог за плаќање');
 const groups=Object.fromEntries(['USD','EUR'].map(c=>[c,{fee:'0',mkdNet:null,missingConversions:0,estimatedConversions:0,count:0}]));
 let unmatchedFees='0';
 for(const fee of fees){
  const candidates=wires.filter(w=>w.review.activity==='deposit'&&w.description==='Девизен налог за плаќање'&&w.date===fee.date&&validDay(w.date)&&w.recipient===fee.recipient&&!w.possibleChange&&(!w.possibleDuplicate||w.review&&!w.review.automatic));
  if(candidates.length===1&&!fee.possibleChange)groups[candidates[0].currency].fee=addMoney(groups[candidates[0].currency].fee,magnitude(fee.amount));
  else unmatchedFees=addMoney(unmatchedFees,magnitude(fee.amount));
 }
 for(const currency of ['USD','EUR']){
  const group=groups[currency],items=wires.filter(w=>w.currency===currency);group.count=items.length;
  const known=items.filter(w=>w.settlementAmount&&w.settlementAmount!=='0'&&w.settlementAmount.startsWith('-')===w.amount.startsWith('-'));
  group.missingConversions=items.length-known.length;
  if(!group.missingConversions||rates){
   group.estimatedConversions=group.missingConversions;
   group.mkdNet=subtractMoney(items.reduce((sum,w)=>addMoney(sum,known.includes(w)?w.settlementAmount:convertMoney(w.amount,rates[currency])),'0'),group.fee);
  }
 }
 const nativeNet=included.filter(r=>r.currency==='MKD'&&!fees.includes(r)).reduce((sum,r)=>addMoney(sum,r.amount),'0');
 const mkdNet=Object.values(groups).every(g=>g.mkdNet!==null)?addMoney(nativeNet,subtractMoney(addMoney(groups.USD.mkdNet,groups.EUR.mkdNet),unmatchedFees)):null;
 return {groups,unmatchedFees,totalFees:fees.reduce((sum,r)=>addMoney(sum,magnitude(r.amount)),'0'),mkdNet,usdNet:mkdNet!==null&&rates?convertMoney(mkdNet,'1',rates.USD):null,eurNet:mkdNet!==null&&rates?convertMoney(mkdNet,'1',rates.EUR):null,estimated:Object.values(groups).some(g=>g.estimatedConversions>0)};
}

export function transferSummary(rows,platform=''){
 const groups=new Map();
 const purchases=groupInstallments(rows).flatMap(group=>{if(!group.children)return [group];const included=group.children.filter(row=>row.review&&row.review.activity!=='exclude');return included.every(row=>row.review.platform==='Vanquish'&&row.review.activity==='cost')?included.slice(0,1):group.children;});
 for(const row of purchases){if(row.settlementOnly||!row.review||row.review.activity==='exclude'||platform&&row.review.platform!==platform)continue;
  const key=`${row.review.platform}:${row.currency}`,total=groups.get(key)||{platform:row.review.platform,currency:row.currency,deposit:'0',withdrawal:'0',cost:'0',refund:'0',fee:'0',missingFees:0,count:0};
  total[row.review.activity]=addMoney(total[row.review.activity],magnitude(row.amount));
  if(row.fee===null)total.missingFees++;else total.fee=addMoney(total.fee,row.fee);
  total.count++;groups.set(key,total);
 }
 return [...groups.values()].map(g=>({...g,netContributions:subtractMoney(g.deposit,g.withdrawal),netCosts:subtractMoney(g.cost,g.refund)})).sort((a,b)=>a.platform.localeCompare(b.platform)||a.currency.localeCompare(b.currency));
}

// Identical, explicitly confirmed purchases can share the same bank description/date.
// Split equivalent installment occurrences into parallel plans; never resolve flagged
// amendments or differing amounts by guessing which purchase owns a later charge.
function parallelPlans(group){
 const stages=new Map();
 for(const item of group.items){if(!stages.has(item.number))stages.set(item.number,[]);stages.get(item.number).push(item);}
 const first=stages.get(1)||[];
 if(first.length<2||first.some(({row})=>row.review?.automatic))return [group];
 if(group.items.some(({row})=>!row.id||row.possibleDuplicate||row.possibleChange||row.review?.platform!=='Vanquish'||row.review?.activity!=='cost'||!row.settlementAmount?.startsWith('-'))||new Set(group.items.map(x=>x.row.id)).size!==group.items.length)return [group];
 for(const items of stages.values())if(items.length>first.length||new Set(items.map(x=>x.row.settlementAmount)).size!==1||new Set(items.map(x=>x.row.bookingDate)).size!==1||!items[0].row.bookingDate)return [group];
 const plans=first.map(()=>({...group,items:[]}));
 for(const items of stages.values())items.slice().sort((a,b)=>a.row.id.localeCompare(b.row.id)).forEach((item,i)=>plans[i].items.push(item));
 return plans;
}

// Group only installments sharing the card, published date, merchant and amount.
// Repeated installment numbers are ambiguous and remain separate.
export function groupInstallments(rows){
 const groups=new Map();
 for(const row of rows){
  const match=(row.description||'').normalize('NFKC').trim().match(/^(.*?)\s+(\d{1,2})\/(\d{1,2})$/);
  if(descriptionPlatform(row)!=='Vanquish'||row.kind!=='card'||!match||!row.date||!row.currency||!row.amount?.startsWith('-'))continue;
  const number=Number(match[2]),count=Number(match[3]);if(number<1||count<2||number>count)continue;
  const merchant=match[1].replace(/\s+/g,' ').trim();
  const key=JSON.stringify([row.sourceKey,row.date,merchant.toUpperCase(),row.amount,row.currency,count]);
  if(!groups.has(key))groups.set(key,{merchant,count,items:[]});groups.get(key).items.push({row,number});
 }
 const byId=new Map();
 for(const group of [...groups.values()].flatMap(parallelPlans)){
  if(group.items.length<2||new Set(group.items.map(item=>item.number)).size!==group.items.length)continue;
  const children=group.items.sort((a,b)=>a.number-b.number).map(item=>item.row);
  const entry={...children[0],id:'installments:'+children[0].id,description:group.merchant,children,installmentCount:group.count,amount:children[0].amount,rawAmount:children.reduce((total,row)=>addMoney(total,row.amount),'0')};
  for(const row of children)byId.set(row.id,entry);
 }
 const seen=new Set();return rows.flatMap(row=>{const group=byId.get(row.id);if(!group)return [row];if(seen.has(group.id))return [];seen.add(group.id);return [group];});
}

export function bankMkdCoverage(rows){
 const included=rows.filter(row=>row.kind==='card'&&row.review?.platform==='Vanquish'&&['cost','refund'].includes(row.review.activity));
 const known=included.filter(row=>row.settlementAmount!=null);
 const amount=known.reduce((sum,row)=>subtractMoney(sum,row.settlementAmount),'0');
 let remaining='0',remainingCount=0,uncertain=known.length!==included.length;
 const plans=new Map();
 for(const row of included){
  const match=(row.description||'').normalize('NFKC').trim().match(/^(.*?)\s+(\d{1,2})\/(\d{1,2})$/);
  if(!match||Number(match[3])<=1||row.review.activity!=='cost')continue;
  const number=Number(match[2]),count=Number(match[3]);
  if(number<1||number>count){uncertain=true;continue;}
  const key=JSON.stringify([row.sourceKey,row.date,match[1].replace(/\s+/g,' ').toUpperCase(),row.amount,row.currency,count]);
  if(!plans.has(key))plans.set(key,{count,items:[]});plans.get(key).items.push({row,number});
 }
 for(const {count,items} of [...plans.values()].flatMap(parallelPlans)){
  if(new Set(items.map(item=>item.number)).size!==items.length){uncertain=true;continue;}
  if(items.length===count)continue;
  if(items.some(item=>item.row.settlementAmount==null||!item.row.settlementAmount.startsWith('-')||item.row.possibleDuplicate||item.row.possibleChange)){uncertain=true;continue;}
  const latest=items.reduce((a,b)=>a.number>b.number?a:b).row.settlementAmount;
  const missing=count-items.length;remainingCount+=missing;
  for(let i=0;i<missing;i++)remaining=subtractMoney(remaining,latest);
 }
 return {amount,known:known.length,total:included.length,fullAmount:uncertain?null:addMoney(amount,remaining),remaining:uncertain?null:remaining,remainingCount:uncertain?null:remainingCount,calculated:!uncertain&&remainingCount>0};
}

// User-requested cumulative recovery model, not a statutory tax calculation.
// Card cost equivalents include projected remaining installments; mirrored account costs are omitted.
export function recoveryReserve(rows){
 const selected=rows.filter(row=>row.review?.platform==='Vanquish'&&row.review.activity!=='exclude');
 const coverage=bankMkdCoverage(selected);
 let paid=coverage.fullAmount??'0',received='0',missing=coverage.fullAmount===null;
 for(const row of selected){
  if(!['deposit','withdrawal','refund'].includes(row.review.activity)||row.kind==='card'&&row.review.activity==='refund')continue;
  const amount=row.currency==='MKD'?row.amount:row.settlementAmount;
  if(amount==null){missing=true;continue;}
  if(row.review.activity==='deposit')paid=addMoney(paid,magnitude(amount));
  else received=addMoney(received,magnitude(amount));
 }
 if(rows.some(row=>!row.review||row.possibleDuplicate&&row.review?.automatic))missing=true;
 if(missing)return {paid:null,received:null,remaining:null,profit:null,tax:null,calculated:coverage.calculated};
 const delta=units(received)-units(paid),profit=delta>0n?delta:0n;
 // Ten percent, rounded half-up to two MKD decimal places.
 const tax=fromUnits(((profit+5000000n)/10000000n)*1000000n);
 return {paid,received,remaining:fromUnits(delta<0n?-delta:0n),profit:fromUnits(profit),tax,calculated:coverage.calculated};
}

// Shared by the full ledger and privacy-limited sidebar endpoint. MKD is the
// common basis: actual settlements, projected Vanquish installments, then FX.
export function globalTradingSummary(rows,fx=null){
 const included=rows.filter(r=>!r.settlementOnly&&r.review&&r.review.activity!=='exclude');
 const ibkr=ibkrBankBreakdown(rows,fx);
 const vanquishRows=rows.filter(r=>r.review?.platform==='Vanquish'||descriptionPlatform(r)==='Vanquish');
 const reserve=recoveryReserve(vanquishRows);
 const vanquish=reserve.paid!==null&&reserve.received!==null?subtractMoney(reserve.received,reserve.paid):null;
 let trading212='0',estimated=ibkr.estimated||reserve.calculated;
 // Trading212's displayed MKD balance comes from card settlements. Account
 // representations may have manual reviews but must not be added again.
 for(const row of included.filter(r=>r.review.platform==='Trading212'&&r.kind==='card')){
  let amount=row.currency==='MKD'?row.amount:row.settlementAmount;
  if(amount==null){
   if(fx?.rates?.[row.currency]){amount=convertMoney(row.amount,fx.rates[row.currency]);estimated=true;}
   else {trading212=null;break;}
  }
  trading212=addMoney(trading212,amount);
 }
 const components={IBKR:ibkr.mkdNet,Trading212:trading212,Vanquish:vanquish};
 const mkd=Object.values(components).every(v=>v!==null)?Object.values(components).reduce(addMoney,'0'):null;
 const usd=mkd!==null&&fx?.rates?.USD?convertMoney(mkd,'1',fx.rates.USD):null;
 const eur=mkd!==null&&fx?.rates?.EUR?convertMoney(mkd,'1',fx.rates.EUR):null;
 return {currency:'USD',net:usd,totals:{MKD:mkd,USD:usd,EUR:eur},estimated:estimated||!!fx?.rates,rateDate:fx?.date||null,cached:!!fx?.cached,entries:included.length,pending:rows.filter(r=>!r.settlementOnly&&!r.review).length,components};
}

// User-defined cross-platform planning reserve, not a statutory tax calculation.
export function globalRecoveryReserve(rows,fx=null){
 const summary=globalTradingSummary(rows,fx);
 const vanquish=recoveryReserve(rows.filter(r=>r.review?.platform==='Vanquish'||descriptionPlatform(r)==='Vanquish'));
 const unavailable={paid:null,received:null,remaining:null,profit:null,tax:null,calculated:summary.estimated};
 if(summary.totals.MKD===null||vanquish.paid===null||vanquish.received===null)return unavailable;
 let paid=vanquish.paid,received=vanquish.received;
 for(const row of rows.filter(r=>!r.settlementOnly&&r.review&&r.review.activity!=='exclude'&&(r.review.platform==='IBKR'||r.review.platform==='Trading212'&&r.kind==='card'))){
  let amount=row.currency==='MKD'?row.amount:row.settlementAmount;
  if(amount==null){if(!fx?.rates?.[row.currency])return unavailable;amount=convertMoney(row.amount,fx.rates[row.currency]);}
  if(amount.startsWith('-'))paid=addMoney(paid,magnitude(amount));else received=addMoney(received,amount);
 }
 // The reserve must reconcile to the same combined net displayed above.
 if(subtractMoney(received,paid)!==summary.totals.MKD)return unavailable;
 const delta=units(received)-units(paid),profit=delta>0n?delta:0n;
 return {paid,received,remaining:fromUnits(delta<0n?-delta:0n),profit:fromUnits(profit),tax:fromUnits(((profit+5000000n)/10000000n)*1000000n),calculated:summary.estimated};
}
