import {chartableEntry} from './instruments.mjs';

// Exact listings supplied in the original watchlist. This is a lookup for the
// level library, not an automatic addition to the owner's saved watchlist.
const supplied = [
  ['NASDAQ','QQQ','FUND'],['AMEX','SPY','FUND'],['AMEX','IWM','FUND'],
  ['NASDAQ','SMH','FUND'],['CBOE','DRAM','FUND'],['CBOE','IGV','FUND'],
  ['NYSE','TSM','DEPOSITARY RECEIPT'],
  ...['TSLA','NVDA','AMD','INTC','MU','SNDK','SPCX','NBIS','META','AMZN','MSFT','AAPL','PLTR','CRWD','WMT'].map(symbol=>['NASDAQ',symbol,'STOCKS']),
  ...['DELL','NOW','MCD'].map(symbol=>['NYSE',symbol,'STOCKS']),
];
// Remaining Friday-sheet listings verified 2026-10-25 against issuer,
// exchange or SEC records. Do not infer a venue for future unknown symbols.
const verified = [
  ['NYSEARCA','XLP','FUND','https://www.sec.gov/Archives/edgar/data/1383951/000110465926062848/tm2613459d29_424b2.htm'],
  ['NASDAQ','SKHY','DEPOSITARY RECEIPT','https://www.nasdaqtrader.com/TraderNews.aspx?id=DTN2026-11'],
  ['NASDAQ','MRNA','STOCKS','https://www.sec.gov/edgar/browse/?CIK=1682852'],
  ['NASDAQ','ZS','STOCKS','https://ir.zscaler.com/node/5941'],
  ['NASDAQ','COST','STOCKS','https://investor.costco.com/stock-info/'],
  ['NYSE','UNH','STOCKS','https://www.unitedhealthgroup.com/investors/shareholder-materials.html'],
  ['NYSE','LLY','STOCKS','https://investor.lilly.com/news-releases/news-release-details/lilly-reports-second-quarter-2026-financial-results-raises-full'],
  ['NASDAQ','CSX','STOCKS','https://investors.csx.com/stock-information/default.aspx'],
];
export const LEVEL_LISTINGS = Object.fromEntries([...supplied,...verified].map(([exchange,symbol,group,sourceUrl])=>[
  symbol,{id:`${exchange}:${symbol}`,ticker:symbol,symbol,exchange,group,...(sourceUrl?{sourceUrl,verifiedAt:'2026-10-25'}:{})},
]));

export function levelDestination(instrument,watchlist) {
  if(instrument.futures){
    if(['NQ','ES'].includes(instrument.symbol))return {kind:'chart',label:'View chart'};
    const entry=watchlist.find(item=>item.symbol===instrument.symbol&&item.group==='FUTURES');
    return {kind:entry?'details':'unavailable',label:'View details',entry};
  }
  const entries=watchlist.filter(item=>item.symbol===instrument.symbol&&chartableEntry(item));
  if(entries.length>1)return {kind:'choose',label:'Choose listing',entries};
  const entry=entries[0]||LEVEL_LISTINGS[instrument.symbol];
  return entry?{kind:'setup',label:'View setup',entry}:{kind:'unavailable',label:'Set up listing'};
}
