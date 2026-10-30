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
 if(/\bVANQUISH TRADER\b/i.test(text))return 'Vanquish';
 return '';
}
export function automaticDescriptionReview(row){
 if(row.review||row.possibleDuplicate||row.possibleChange||!['card','account'].includes(row.kind)||descriptionPlatform(row)!=='Vanquish'||!row.amount?.startsWith('-'))return null;
 try{return {...validateReview(row,{platform:'Vanquish',activity:'cost'}),automatic:true};}catch{return null;}
}
export function tradingRows(rows){return rows.filter(row=>descriptionPlatform(row)).map(row=>({...row,review:row.review||automaticDescriptionReview(row)}));}
export function validateReview(row,review){
 if(!review||!Object.hasOwn(ACTIVITIES,review.activity))throw Error('Choose a transaction category.');
 if(review.activity==='exclude')return {platform:'',activity:'exclude'};
 if(!PLATFORMS.includes(review.platform))throw Error('Choose a platform.');
 if(!row.date||row.amount===null||!row.currency||row.amount==='0')throw Error('Missing date, amount or currency: this transaction can only be excluded.');
 const outgoing=row.amount.startsWith('-');
 if(outgoing!==['deposit','cost'].includes(review.activity))throw Error('The category must match the source amount direction.');
 return {platform:review.platform,activity:review.activity};
}
export function transferSummary(rows,platform=''){
 const groups=new Map();
 const purchases=groupInstallments(rows).flatMap(group=>{if(!group.children)return [group];const included=group.children.filter(row=>row.review&&row.review.activity!=='exclude');return included.every(row=>row.review.platform==='Vanquish'&&row.review.activity==='cost')?included.slice(0,1):group.children;});
 for(const row of purchases){if(!row.review||row.review.activity==='exclude'||platform&&row.review.platform!==platform)continue;
  const key=`${row.review.platform}:${row.currency}`,total=groups.get(key)||{platform:row.review.platform,currency:row.currency,deposit:'0',withdrawal:'0',cost:'0',refund:'0',fee:'0',missingFees:0,count:0};
  total[row.review.activity]=addMoney(total[row.review.activity],magnitude(row.amount));
  if(row.fee===null)total.missingFees++;else total.fee=addMoney(total.fee,row.fee);
  total.count++;groups.set(key,total);
 }
 return [...groups.values()].map(g=>({...g,netContributions:subtractMoney(g.deposit,g.withdrawal),netCosts:subtractMoney(g.cost,g.refund)})).sort((a,b)=>a.platform.localeCompare(b.platform)||a.currency.localeCompare(b.currency));
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
 for(const group of groups.values()){
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
 for(const {count,items} of plans.values()){
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
