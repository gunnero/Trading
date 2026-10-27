export const DRAWING_TYPES=['horizontal','trend','rectangle','text'];
export const DRAWING_COLORS=['#efbd4e','#27cbb0','#f46f73','#73b8ff','#e8edf0'];
export const MAX_DRAWINGS=80;
export function validateDrawings(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>300)throw new Error('Invalid chart drawings.');
  let total=0;const result={};
  for(const [key,items] of Object.entries(value)){
    if(!/^(?:QQQ|SPY|NQ|ES|VIX|VIX1D|DXY|US10Y|US2Y|NYMEX:CL1!|COMEX:GC1!|CME_MINI:RTY1!|(?:NASDAQ|NYSE|AMEX|CBOE|NYSEARCA|NYSEAMERICAN|BATS):[A-Z][A-Z0-9.]{0,9})\|(2m|5m|15m|30m|1h|4h|D|W|M)$/.test(key)||!Array.isArray(items)||items.length>MAX_DRAWINGS||(total+=items.length)>1000)throw new Error('Invalid chart drawing scope or limit.');
    const ids=new Set();result[key]=items.map(item=>{
      if(!item||typeof item.id!=='string'||!item.id||item.id.length>80||ids.has(item.id)||!DRAWING_TYPES.includes(item.type)||!DRAWING_COLORS.includes(item.color)||!Array.isArray(item.points)||item.points.length!==(['trend','rectangle'].includes(item.type)?2:1))throw new Error('Invalid chart drawing.');
      ids.add(item.id);
      const points=item.points.map(p=>{
        if(!p||typeof p.time!=='number'||!Number.isFinite(p.time)||p.time<0||p.time>7258118400||typeof p.price!=='number'||!Number.isFinite(p.price)||Math.abs(p.price)>1e9)throw new Error('Invalid drawing coordinates.');
        return {time:p.time,price:p.price};
      });
      if(item.type==='text'&&(typeof item.text!=='string'||!item.text.trim()||item.text.length>120))throw new Error('Drawing notes need 1–120 characters.');
      return {id:item.id,type:item.type,color:item.color,points,...(item.type==='text'?{text:item.text}:{})};
    });
  }
  return result;
}

// Anchors keep their source times when a rolling history gains or loses candles.
export function timeIndex(times,time){
  if(!times.length||time<times[0]||time>times.at(-1))return null;
  let lo=0,hi=times.length-1;
  while(lo<hi){const mid=Math.floor((lo+hi)/2);if(times[mid]<time)lo=mid+1;else hi=mid;}
  return times[lo]===time||lo===0?lo:lo-1+(time-times[lo-1])/(times[lo]-times[lo-1]);
}
export function indexTime(times,index){
  const bounded=Math.max(0,Math.min(times.length-1,index)),lo=Math.floor(bounded),hi=Math.ceil(bounded);
  return times[lo]+(times[hi]-times[lo])*(bounded-lo);
}
