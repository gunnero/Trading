import {chartableEntry} from './instruments.mjs';

// Primary USD listings, kept distinct from broker IDs and share classes.
// FB -> META and IPOE -> SOFI are documented issuer renames, not generic aliases.
const listings=[
  ['AMD','US0079031078'],['AAPL','US0378331005'],['TSLA','US88160R1014'],
  ['GOOG','US02079K1079'],['GOOGL','US02079K3059'],['META','US30303M1027'],
  ['SOFI','US83406F1021'],
  ['NFLX','US64110L1061'],
  ['V','US92826C8394','NYSE'],
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
// Historical valuation also supports this exact USD London fund listing.
// Vanguard identifies IE00BFMXXD54 / VUAA / VUAA.L under USD–London:
// https://www.vanguard.co.uk/professional/product/etf/equity/9694/sp-500-ucits-etf-usd-accumulating
// Keep it separate from the US-only interactive chart and order-quote resolver.
export function portfolioHistoryListing(holding,watchlist=[]) {
  if(holding?.ticker==='VUAAl_EQ'&&holding.isin==='IE00BFMXXD54'&&holding.instrumentCurrency==='USD')
    return {id:'LSE:VUAA',symbol:'VUAA',ticker:'VUAA',exchange:'LSE',group:'FUND'};
  // Trading 212 and Invesco identify this accumulating USD share class on SIX:
  // https://www.trading212.com/trading-instruments/invest/EQAC.CH
  // https://www.invesco.com/ch/en/financial-products/etfs/invesco-eqqq-nasdaq-100-ucits-etf-acc.html
  if(holding?.ticker==='EQACs_EQ'&&holding.isin==='IE00BFZXGZ54'&&holding.instrumentCurrency==='USD')
    return {id:'SIX:EQAC',symbol:'EQAC',ticker:'EQAC',exchange:'SIX',group:'FUND'};
  return portfolioListing(holding,watchlist);
}
// Only the authenticated broker catalog supplies these identities. A similar
// fund name, an ISIN on another venue, or the first watchlist row is not a match.
const historyExchanges={NASDAQ:'NASDAQ','New York Stock Exchange':'NYSE',NYSE:'NYSE','NYSE Arca':'NYSEARCA',NYSEARCA:'NYSEARCA','NYSE American':'AMEX',AMEX:'AMEX','London Stock Exchange':'LSE',LSE:'LSE','SIX Swiss Exchange':'SIX',SIX:'SIX'};
export function portfolioCatalogListing(holding,catalog=[]) {
  if(holding?.instrumentCurrency!=='USD'||!/^([A-Z]{2}[A-Z0-9]{9}[0-9])$/.test(holding.isin||''))return null;
  const matches=catalog.filter(i=>i.ticker===holding.ticker);
  if(matches.length!==1)return null;
  const i=matches[0],exchange=Object.hasOwn(historyExchanges,i.exchange)?historyExchanges[i.exchange]:null,symbol=i.shortName;
  if(!exchange||i.isin!==holding.isin||i.currencyCode!==holding.instrumentCurrency||!['STOCK','ETF'].includes(i.type)||!/^([A-Z][A-Z0-9.]{0,9})$/.test(symbol||''))return null;
  // Do not silently follow a ticker rename or borrow an alternate share class.
  // Explicitly verified historical aliases remain in portfolioHistoryListing.
  const suffix=exchange==='LSE'?'l_EQ':exchange==='SIX'?'s_EQ':'_US_EQ';
  if(holding.ticker!==symbol+suffix||(['LSE','SIX'].includes(exchange)&&i.type!=='ETF'))return null;
  return {id:`${exchange}:${symbol}`,symbol,ticker:symbol,exchange,group:i.type==='ETF'?'FUND':'STOCKS',providerCheck:{exchange,currency:i.currencyCode,type:i.type==='ETF'?'ETF':'EQUITY'}};
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
