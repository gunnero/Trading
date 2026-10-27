export const JOURNAL_ZONE='Europe/Skopje';
export const REVIEW_ITEMS=[['break','Closed 2m candle beyond the full zone'],['retest','Separate retest held the broken zone'],['ema','9 / 21 EMA aligned with the direction'],['vwap','Price on the correct side of session VWAP']];
export const JOURNAL_TAGS=['Followed plan','Chased entry','Early entry','Early exit','Late exit','Oversized','News event'];
export const emptyJournal=()=>({version:1,trades:[]});
const fail=message=>{throw new Error(message);};
const text=(value,name,max,optional=false)=>typeof value==='string'&&value.length<=max&&(optional||value.trim())?value.trim():fail(`Invalid ${name}.`);
const number=(value,name,min,max)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max?value:fail(`Invalid ${name}.`);
const optionalNumber=(value,name,min,max)=>value===null||value===undefined?null:number(value,name,min,max);
function premium(value,name,min){const n=number(value,name,min,1000000);if(Math.abs(n*10000-Math.round(n*10000))>0.00001)fail(`${name} supports at most four decimal places.`);return n;}
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
function instant(value,name){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!validDate(value.slice(0,10))||!Number.isFinite(Date.parse(value)))fail(`${name} needs a valid timestamp with a timezone offset.`);return new Date(value).toISOString();}
const localFormatter=new Intl.DateTimeFormat('en-GB',{timeZone:JOURNAL_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
export function localStamp(value){const parts=Object.fromEntries(localFormatter.formatToParts(new Date(value)).map(p=>[p.type,p.value]));return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;}
export const journalDay=value=>localStamp(value).slice(0,10);
export function localToInstant(value){
  const v=value.length===16?value+':00':value;
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(v)||!validDate(v.slice(0,10)))fail('Enter a valid Skopje date and time.');
  const approximate=Date.parse(v+'Z'),matches=[];
  for(let offset=-180;offset<=180;offset+=30){const candidate=approximate+offset*60000;if(Number.isFinite(candidate)&&localStamp(candidate)===v)matches.push(candidate);}
  if(matches.length!==1)fail(matches.length?'This Skopje time occurs twice during the clock change. Import an explicit timestamp with its offset.':'This Skopje time does not exist. Check the date and daylight-saving change.');
  return new Date(matches[0]).toISOString();
}
export function validateTrade(value){
  if(!value||typeof value!=='object')fail('Invalid trade.');
  const id=text(value.id,'trade ID',80),firm=text(value.firm,'firm',60),account=text(value.account,'account',80);
  if(!/^[A-Z][A-Z0-9.]{0,11}$/.test(value.symbol)||!validDate(value.expiration)||!['CALL','PUT'].includes(value.optionType)||!['long','short'].includes(value.position))fail('Check the symbol, expiration and option type.');
  const quantity=number(value.quantity,'contract quantity',1,10000),multiplier=number(value.multiplier,'contract multiplier',1,1000);
  if(!Number.isInteger(quantity)||!Number.isInteger(multiplier))fail('Quantity and multiplier must be whole numbers.');
  const strike=number(value.strike,'strike',0.001,1000000),entryPrice=premium(value.entryPrice,'Entry premium',0.0001),entryAt=instant(value.entryAt,'Entry time');
  const open=value.exitAt===null&&value.exitPrice===null;
  const exitAt=open?null:instant(value.exitAt,'Exit time'),exitPrice=open?null:premium(value.exitPrice,'Exit premium',0);
  if(exitAt&&exitAt<entryAt)fail('Exit must be at or after entry.');
  // Expiration is the exchange calendar date, not the user's local display date.
  const exchangeDay=stamp=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stamp));
  if(exchangeDay(entryAt)>value.expiration||exitAt&&exchangeDay(exitAt)>value.expiration)fail('An execution cannot be after the option expiration date.');
  const fees=optionalNumber(value.fees,'total fees',0,1000000),risk=optionalNumber(value.risk,'initial risk',0.01,10000000),reportedPnl=optionalNumber(value.reportedPnl,'reported P/L',-100000000,100000000);
  const review={};for(const [key] of REVIEW_ITEMS){const v=value.review?.[key]??null;if(v!==null&&typeof v!=='boolean')fail('Invalid strategy review.');review[key]=v;}
  if(!['manual','screenshot','import'].includes(value.source))fail('Invalid trade source.');
  if(!Array.isArray(value.tags)||value.tags.length>10)fail('Invalid trade tags.');
  const tags=[...new Set(value.tags.map(v=>text(v,'tag',40)))];
  return {id,firm,account,symbol:value.symbol,expiration:value.expiration,optionType:value.optionType,position:value.position,strike,quantity,multiplier,entryPrice,entryAt,exitPrice,exitAt,fees,risk,reportedPnl,review,tags,notes:text(value.notes??'','review notes',2000,true),source:value.source,sourceLabel:text(value.sourceLabel??'','source label',160,true),entryOrderId:text(value.entryOrderId??'','entry order ID',80,true),exitOrderId:text(value.exitOrderId??'','exit order ID',80,true)};
}
function executionValues(t){return [t.firm.toLowerCase(),t.account.toLowerCase(),t.symbol,t.expiration,t.optionType,t.position,t.strike,t.quantity,t.multiplier,t.entryAt,t.exitAt,t.entryPrice,t.exitPrice];}
export function tradeIdentity(t){return JSON.stringify([...executionValues(t),t.entryOrderId,t.exitOrderId]);}
export function validateJournal(value){
  if(!value||value.version!==1||!Array.isArray(value.trades)||value.trades.length>2000)fail('The journal supports up to 2,000 trade records.');
  const ids=new Set(),trades=value.trades.map(validateTrade);
  for(const trade of trades){if(ids.has(trade.id))fail('This trade is already in the journal.');ids.add(trade.id);}
  if(planJournalImport([],trades).duplicates)fail('This trade is already in the journal.');
  const result={version:1,trades};if(JSON.stringify(result).length>1500000)fail('Journal storage limit reached. Export a backup before reducing older records.');return result;
}
export function parseJournalImport(raw){
  if(typeof raw!=='string'||raw.length>2000000)fail('Choose a journal JSON file under 2 MB.');
  let value;try{value=JSON.parse(raw);}catch{fail('This is not a valid journal JSON file. Use the reviewed file prepared from your screenshot.');}
  if(value.format!=='opening-bell-journal-v1'||!Array.isArray(value.trades)||!value.trades.length||value.trades.length>2000)fail('Use an Opening Bell journal file with 1–2,000 trade records.');
  if(value.currency!=='USD')fail('This journal currently supports USD accounts only.');
  return {label:text(value.label||'Reviewed trade import','import label',160),trades:value.trades.map(row=>validateTrade({...row,id:row.id||crypto.randomUUID(),tags:row.tags||[],source:row.source||'import'}))};
}
export function planJournalImport(existing,incoming){
  const identities=new Set(existing.map(tradeIdentity)),ids=new Map(existing.map(t=>[t.id,tradeIdentity(t)])),values=new Map(),added=[];let duplicates=0;
  const register=t=>{const key=JSON.stringify(executionValues(t));values.set(key,[...(values.get(key)||[]),t]);};existing.forEach(register);
  for(const trade of incoming){const key=tradeIdentity(trade);if(ids.has(trade.id)&&ids.get(trade.id)!==key)fail('An imported trade ID already exists with different values. Edit the saved trade instead.');if(identities.has(key)){duplicates++;continue;}const same=values.get(JSON.stringify(executionValues(trade)))||[];if(same.some(t=>!t.entryOrderId||!t.exitOrderId||!trade.entryOrderId||!trade.exitOrderId))fail('A record already matches these executions, but order IDs differ or are missing. Review its order IDs before importing or adding another record.');identities.add(key);ids.set(trade.id,key);register(trade);added.push(trade);}
  return {added,duplicates};
}
export const roundMoney=value=>Math.round((value+Math.sign(value)*Number.EPSILON)*100)/100;
export function tradeResult(t){
  if(!t.exitAt)return {gross:null,net:null,returnPct:null,seconds:null,r:null};
  const gross=roundMoney((Math.round(t.exitPrice*10000)-Math.round(t.entryPrice*10000))/10000*t.quantity*t.multiplier*(t.position==='short'?-1:1));
  return {gross,net:t.fees===null?null:roundMoney(gross-t.fees),returnPct:t.position==='long'?gross/(t.entryPrice*t.quantity*t.multiplier)*100:null,seconds:(Date.parse(t.exitAt)-Date.parse(t.entryAt))/1000,r:t.risk===null?null:gross/t.risk};
}
export function journalStats(trades){
  const closed=trades.filter(t=>t.exitAt),results=closed.map(tradeResult),wins=results.filter(r=>r.gross>0),losses=results.filter(r=>r.gross<0),gross=roundMoney(results.reduce((s,r)=>s+r.gross,0)),missingFees=results.filter(r=>r.net===null).length;
  const winning=roundMoney(wins.reduce((s,r)=>s+r.gross,0)),losing=roundMoney(-losses.reduce((s,r)=>s+r.gross,0));
  const days=new Map();for(const t of [...closed].sort((a,b)=>a.exitAt.localeCompare(b.exitAt))){const date=journalDay(t.exitAt),day=days.get(date)||{date,gross:0,count:0};day.gross=roundMoney(day.gross+tradeResult(t).gross);day.count++;days.set(date,day);}
  let cumulative=0;const series=[...days.values()].map(d=>({...d,cumulative:cumulative=roundMoney(cumulative+d.gross)}));
  return {closed:closed.length,open:trades.length-closed.length,gross,missingFees,net:closed.length&&!missingFees?roundMoney(results.reduce((s,r)=>s+r.net,0)):null,wins:wins.length,losses:losses.length,breakeven:closed.length-wins.length-losses.length,winRate:closed.length?wins.length/closed.length*100:null,profitFactor:losing>0?winning/losing:null,averageHold:closed.length?results.reduce((s,r)=>s+r.seconds,0)/closed.length:null,series};
}
export const money=value=>value===null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(value);
export function duration(value){if(value===null)return '—';const seconds=Math.round(value);return seconds<60?`${seconds}s`:seconds<3600?`${Math.floor(seconds/60)}m ${seconds%60}s`:`${Math.floor(seconds/3600)}h ${Math.floor(seconds%3600/60)}m`;}
