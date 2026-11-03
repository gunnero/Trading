import {chartableEntry} from './instruments.mjs';

// Primary USD listings, kept distinct from broker IDs and share classes.
// FB -> META is the issuer's documented ticker rename, not a generic alias rule.
const listings=[
  ['AMD','US0079031078'],['AAPL','US0378331005'],['TSLA','US88160R1014'],
  ['GOOG','US02079K1079'],['GOOGL','US02079K3059'],['META','US30303M1027'],
];
export function portfolioListing(holding) {
  if(!holding||holding.instrumentCurrency!=='USD')return null;
  const ticker=holding.ticker.replace(/_US_EQ$/,''),symbol=ticker==='FB'?'META':ticker;
  const known=listings.find(([id,isin])=>id===symbol&&(!holding.isin||holding.isin===isin));
  if(!known)return null;
  return {id:`NASDAQ:${symbol}`,symbol,ticker:symbol,exchange:'NASDAQ',group:'STOCKS'};
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
