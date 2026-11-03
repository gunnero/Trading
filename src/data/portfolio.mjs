export const PORTFOLIO_LIMITS = {people:30, accounts:50, holdings:500};
export const portfolioError = message => Object.assign(new Error(message), {status:400});
export function portfolioText(value, label, max=100, optional=false) {
  if (optional && (value===undefined || value===null || value==='')) return '';
  if(typeof value!=='string' || !value.trim() || value.length>max || /[\x00-\x1f]/.test(value)) throw portfolioError(`Enter a valid ${label} (up to ${max} characters).`);
  return value.trim();
}
export function portfolioCurrency(value) {
  if(typeof value!=='string'|| !/^[A-Z]{3}$/.test(value)) throw portfolioError('Use a three-letter currency code.');
  return value;
}
export function portfolioNumber(value,label,{optional=true,min=-1e12,max=1e12}={}) {
  if(optional&&(value===null||value===undefined||value==='')) return null;
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max) throw portfolioError(`Invalid ${label}.`);
  return value;
}
export function normalizePortfolioSnapshot(raw) {
  if(!raw||raw.version!==1) throw portfolioError('Choose a Portfolio Manager snapshot JSON file (version 1).');
  const currency=portfolioCurrency(raw.currency);
  if(!Array.isArray(raw.holdings)||raw.holdings.length>PORTFOLIO_LIMITS.holdings) throw portfolioError('A snapshot supports up to 500 holdings.');
  const seen=new Set();
  const holdings=raw.holdings.map(row=>{
    const ticker=portfolioText(row?.ticker,'instrument identifier',80);
    if(seen.has(ticker))throw portfolioError('Duplicate instrument identifiers in the snapshot.');seen.add(ticker);
    return {ticker,name:portfolioText(row.name,'instrument name',160),isin:portfolioText(row.isin,'ISIN',20,true),
      quantity:portfolioNumber(row.quantity,'quantity',{optional:false,min:0}),
      instrumentCurrency:portfolioCurrency(row.instrumentCurrency||currency),
      averagePrice:portfolioNumber(row.averagePrice,'average price',{min:0}),price:portfolioNumber(row.price,'price',{min:0}),
      value:portfolioNumber(row.value,'holding value',{min:0}),cost:portfolioNumber(row.cost,'holding cost',{min:0}),
      unrealized:portfolioNumber(row.unrealized,'holding return'),fxImpact:portfolioNumber(row.fxImpact,'FX impact')};
  });
  let observedAt=null;
  if(raw.observedAt){
    if(typeof raw.observedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(raw.observedAt)||!Number.isFinite(Date.parse(raw.observedAt))||Date.parse(raw.observedAt)>Date.now()+300000)throw portfolioError('Use a valid source timestamp with a timezone, or leave it unknown.');
    observedAt=new Date(raw.observedAt).toISOString();
  }
  const result={version:1,currency,holdings,observedAt,source:'snapshot',sourceLabel:portfolioText(raw.sourceLabel||'Manual snapshot','source',150),note:portfolioText(raw.note,'source note',2000,true)};
  for(const field of ['accountValue','investmentsValue','cash','availableCash','reservedCash','pieCash','cost','unrealized','realized','totalReturn','returnPercent','netDeposits'])result[field]=portfolioNumber(raw[field],field);
  return result;
}
export function portfolioStatus(account,now=Date.now()) {
  if(!account.snapshot)return account.connected?'Waiting for first sync':'Not connected';
  if(account.snapshot.source!=='api')return 'Screenshot / manual snapshot';
  if(!account.connected)return 'Disconnected · saved snapshot';
  if(account.error||!account.lastSuccess||now-Date.parse(account.lastSuccess)>120000)return 'Stale · last successful sync';
  return account.environment==='demo'?'Demo · auto-updated':'Auto-updated';
}
export function portfolioTotals(accounts) {
  const currencies=new Map();
  for(const account of accounts){
    if(account.environment==='demo')continue;
    const snapshot=account.snapshot;if(!snapshot)continue;
    let total=currencies.get(snapshot.currency);
    if(!total){total={currency:snapshot.currency,value:0,known:0,accounts:0};currencies.set(snapshot.currency,total);}
    total.accounts++;if(snapshot.accountValue!==null){total.value+=snapshot.accountValue;total.known++;}
  }
  return [...currencies.values()];
}
