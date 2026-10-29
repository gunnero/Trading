import {validDay} from '../src/data/calendar.mjs';
// Oanor documents scores and daily history, not raw indicator price series.
export const COMPONENT_IDS=['market_momentum_sp500','stock_price_strength','stock_price_breadth','put_call_options','market_volatility_vix','junk_bond_demand','safe_haven_demand'];
const ratings=['extreme fear','fear','neutral','greed','extreme greed'];
const score=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100;
function envelope(raw,key){
 const data=raw?.data;
 if(raw?.success!==true||raw.status!=='ok'||data?.index!=='CNN Fear & Greed (US stocks)'||data.source!=='CNN Business'||!Array.isArray(data[key])||!Number.isInteger(data.count)||data.count!==data[key].length)throw Error('Invalid CNN details.');
 return data;
}
function reading(item){
 const rating=typeof item?.rating==='string'?item.rating.toLowerCase():'';
 if(!score(item?.score)||!ratings.includes(rating))throw Error('Invalid CNN score.');
 return {score:item.score,rating};
}
function instant(value,now){
 if(typeof value!=='string'||!validDay(value.slice(0,10))||!/^\d{4}-\d\d-\d\d[T ].*(Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(Date.parse(value))||Date.parse(value)>now+300000)throw Error('Invalid CNN observation time.');
 return new Date(value).toISOString();
}
export function parseComponents(raw,now=Date.now()){
 const data=envelope(raw,'components');if(data.components.length>30)throw Error('Too many indicators.');
 const seen=new Set(),components=[];
 for(const item of data.components){
  // The S&P moving average and VIX moving average are reference lines, not
  // additional votes in CNN's seven-component index.
  if(!COMPONENT_IDS.includes(item?.indicator))continue;
  if(seen.has(item.indicator))throw Error('Duplicate indicator.');seen.add(item.indicator);
  components.push({id:item.indicator,...reading(item),observedAt:item.updated==null?null:instant(item.updated,now)});
 }
 if(!components.length)throw Error('No recognized CNN indicators.');
 return {components,observedAt:data.updated==null?null:instant(data.updated,now)};
}
export function parseHistory(raw,now=Date.now()){
 const data=envelope(raw,'history');if(data.history.length>400)throw Error('Too many history points.');
 const dates=new Map(),instants=new Map();
 for(const item of data.history){
  const observedAt=instant(item.date,now),value=reading(item),date=observedAt.slice(0,10);
  if(instants.has(observedAt)&&JSON.stringify(instants.get(observedAt))!==JSON.stringify(value))throw Error('Conflicting history observations.');
  instants.set(observedAt,value);
  // Preserve the provider's date; midnight labels are not New York instants.
  // Some responses repeat today's date with a later intraday snapshot.
  if(!dates.has(date)||observedAt>dates.get(date).observedAt)dates.set(date,{date,observedAt,...value});
 }
 return {points:[...dates.values()].sort((a,b)=>a.date.localeCompare(b.date))};
}
