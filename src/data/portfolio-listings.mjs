import {chartableEntry} from './instruments.mjs';

// Primary USD listings, kept distinct from broker IDs and share classes.
// FB -> META and IPOE -> SOFI are documented issuer renames, not generic aliases.
const listings=[
  ['AMD','US0079031078'],['AAPL','US0378331005'],['TSLA','US88160R1014'],
  ['GOOG','US02079K1079'],['GOOGL','US02079K3059'],['META','US30303M1027'],
  ['SOFI','US83406F1021'],
  ['NFLX','US64110L1061'],
  ['QQQ','US46090E1038','NASDAQ','FUND'],
  ['SPY','US78462F1030','NYSEARCA','FUND'],
];
export function portfolioListing(holding,watchlist=[]) {
  if(!holding||holding.instrumentCurrency!=='USD')return null;
  const match=/^([A-Z][A-Z0-9.]{0,9})(?:_US_EQ)?$/.exec(holding.ticker);
  if(!match)return null;
  const ticker=match[1],symbol=ticker==='FB'?'META':ticker==='IPOE'?'SOFI':ticker;
  const known=listings.find(([id])=>id===symbol);
  if(known){
    if(holding.isin&&holding.isin!==known[1])return null;
    const exchange=known[2]||'NASDAQ',group=known[3]||'STOCKS';
    return {id:`${exchange}:${symbol}`,symbol,ticker:symbol,exchange,group};
  }
  // For other US broker tickers, use the owner's exact saved listing. Never
  // treat the watchlist's first row (often QQQ) as the default for a stock.
  if(!holding.ticker.endsWith('_US_EQ')||listings.some(([id,isin])=>holding.isin&&holding.isin===isin&&id!==symbol))return null;
  const matches=portfolioListingChoices(watchlist).filter(e=>e.symbol===symbol&&e.ticker===symbol&&e.id===`${e.exchange}:${symbol}`);
  if(matches.length!==1)return null;
  const entry=matches[0];
  if(holding.isin&&entry.isin&&holding.isin!==entry.isin)return null;
  return entry;
}
export function portfolioHoldingLabel(holding,watchlist=[]){
  return {name:holding.name,symbol:portfolioListing(holding,watchlist)?.symbol||null,brokerId:holding.ticker};
}
export function portfolioListingChoices(watchlist) {
  return [...new Map(watchlist.filter(chartableEntry).map(entry=>[entry.id,entry])).values()];
}
// The average belongs to the instrument's currency, never the account currency.
// Wait for quote metadata and never overlay unlike currencies or share classes.
export function portfolioAverageLine(holding,quote,entry) {
  if(!holding||!entry||!Number.isFinite(holding.averagePrice)||holding.averagePrice<0||
    quote?.currency!==holding.instrumentCurrency||quote?.providerSymbol!==entry.symbol.replaceAll('.','-'))return null;
  return {value:holding.averagePrice,label:'Avg. paid',currency:holding.instrumentCurrency};
}
