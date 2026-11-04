import {parseWatchlist} from '../src/data/market.js';
import {portfolioListing} from '../src/data/portfolio-listings.mjs';

const exchanges={NASDAQ:['NMS','NGM','NCM'],NYSE:['NYQ'],NYSEARCA:['PCX'],AMEX:['ASE'],NYSEAMERICAN:['ASE'],BATS:['BTS','BATS'],CBOE:['BTS','BATS','CBOE']};
// Reuse the market service's bounded cache/backoff. Only an exact saved or
// known listing may supply an estimate; neither chart levels nor client prices
// participate in this lookup. Yahoo may provide the last regular-session close.
export function createTradePrice({now,quote,workspace=()=>({})}){
  return async instrument=>{
    if(!quote)return null;
    try{
      const raw=workspace()||{},watchlist=parseWatchlist(raw.watchText||'',{allowEmpty:true});
      const listing=portfolioListing({ticker:instrument.ticker,isin:instrument.isin,instrumentCurrency:instrument.currency},watchlist);
      if(!listing)return null;
      const result=await quote(listing.id),q=result?.quote,at=now();
      const observed=Date.parse(q?.observedAt),checked=Date.parse(result?.fetchedAt);
      if(result?.status!=='ok'||q?.provider!=='Yahoo Finance'||q.kind!=='equity'||q.providerSymbol!==listing.symbol.replaceAll('.','-')||q.currency!==instrument.currency||
        !exchanges[listing.exchange]?.includes(q.exchangeName)||q.instrumentType!==(instrument.type==='ETF'?'ETF':'EQUITY')||
        !Number.isFinite(q.price)||q.price<=0||!Number.isFinite(observed)||!Number.isFinite(checked)||
        checked>at+5000||at-checked>=65000||observed>at+5000||at-observed>=4*86400000||!['regular','pre','post'].includes(q.sessionType))return null;
      return {price:q.price,priceQuote:{source:'Yahoo Finance',listing:listing.id,observedAt:observed,checkedAt:checked,
        validUntil:Math.min(checked+65000,observed+4*86400000),session:({regular:'Regular session',pre:'Pre-market',post:'After-hours'})[q.sessionType],delayMinutes:Number.isFinite(q.delayMinutes)?q.delayMinutes:null}};
    }catch{return null;}
  };
}
