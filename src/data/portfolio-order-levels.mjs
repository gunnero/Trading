import {portfolioListing} from './portfolio-listings.mjs';

export function portfolioOrderLevels(instrument,currency,sheet,watchlist=[]){
  if(!instrument||instrument.currency!==currency)return null;
  const listing=portfolioListing({...instrument,instrumentCurrency:instrument.currency},watchlist);
  if(!listing)return null;
  const source=sheet?.instruments?.[listing.symbol];
  if(!source||source.futures||!Array.isArray(source.zones))return null;
  const options=[];
  for(const [index,zone] of source.zones.entries()){
    if(!['S','D','G'].includes(zone.type)||!Number.isFinite(zone.low)||!Number.isFinite(zone.high)||zone.low<=0||zone.high<zone.low)continue;
    const name={S:'Supply',D:'Demand',G:'Gap'}[zone.type];
    for(const [edge,price] of zone.low===zone.high?[['level',zone.low]]:[['low',zone.low],['high',zone.high]])options.push({id:`${index}:${edge}`,label:`${name} ${edge}`,price});
  }
  return options.length?{listing:listing.id,date:source.sourceDate||sheet.date,timeframe:source.timeframe,options}:null;
}
