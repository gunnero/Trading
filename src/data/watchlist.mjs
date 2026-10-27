import {parseWatchlist} from './market.js';

export const WATCH_GROUPS = {STOCKS:'Stocks','DEPOSITARY RECEIPT':'Depositary receipts',FUND:'Funds / ETFs',FUTURES:'Futures',CRYPTO:'Crypto'};
const equityExchanges = ['NASDAQ','NYSE','AMEX','CBOE','NYSEARCA','NYSEAMERICAN','BATS'];
export const WATCH_EXCHANGES = {STOCKS:equityExchanges,'DEPOSITARY RECEIPT':equityExchanges,FUND:equityExchanges,FUTURES:['CME_MINI','CME','CBOT','COMEX','NYMEX'],CRYPTO:['BITSTAMP']};
export const readWatchlist = text => parseWatchlist(text,{allowEmpty:true});
export function overviewWatchlist(entries) {
  const featured=['NVDA','AMD','MU','TSLA','COIN'].map(symbol=>entries.find(entry=>entry.symbol===symbol)).filter(Boolean);
  return [...featured,...entries.filter(entry=>!featured.some(item=>item.id===entry.id))].slice(0,5);
}

export function newWatchEntry({symbol,exchange,group}) {
  const ticker = symbol.trim().toUpperCase(), venue = exchange.trim().toUpperCase();
  if(!Object.hasOwn(WATCH_GROUPS,group) || !WATCH_EXCHANGES[group].includes(venue)) throw new Error('Choose an exchange for this asset type.');
  const valid = group==='FUTURES' ? /^[A-Z0-9][A-Z0-9.]{0,14}(?:!)?$/ : group==='CRYPTO' ? /^[A-Z0-9]{2,20}$/ : /^[A-Z][A-Z0-9.]{0,9}$/;
  if(!valid.test(ticker)) throw new Error(group==='FUTURES'?'Enter a futures symbol, for example NQ1!.':'Enter a ticker symbol, for example NVDA or BRK.B.');
  return parseWatchlist(`###${group},${venue}:${ticker}`)[0];
}

// Emit group markers where needed without changing listing order or identity.
export function serializeWatchlist(entries) {
  let previous = null;
  const tokens=[];
  for(const entry of entries) {
    if(entry.group!==previous) {tokens.push(`###${entry.group}`);previous=entry.group;}
    tokens.push(entry.id);
  }
  return tokens.join(',');
}

export function replaceWatchlist(workspace,entries) {
  const watchText=serializeWatchlist(entries), custom=workspace.preferences.customSymbol;
  const removedCustom=custom && !entries.some(entry=>entry.id===custom);
  return {...workspace,watchText,...(removedCustom?{preferences:{...workspace.preferences,customSymbol:'',...(workspace.preferences.focus==='custom'?{focus:workspace.preferences.symbol}:{})}}:{})};
}

export function addWatchEntry(workspace,entry,index=Infinity) {
  const entries=readWatchlist(workspace.watchText);
  if(entries.some(item=>item.id===entry.id)) throw new Error(`${entry.id} is already in your watchlist.`);
  entries.splice(Math.min(Math.max(index,0),entries.length),0,entry);
  return replaceWatchlist(workspace,entries);
}

export function removeWatchEntry(workspace,id) {
  const entries=readWatchlist(workspace.watchText);
  if(!entries.some(entry=>entry.id===id))return workspace;
  return replaceWatchlist(workspace,entries.filter(entry=>entry.id!==id));
}
