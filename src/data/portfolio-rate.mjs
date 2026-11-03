// Period money-weighted return, using dated external cash flows and an ending
// valuation. Conventional cash flows have exactly one IRR; ambiguous patterns
// are withheld. This is calculated here, not a broker-reported percentage.
export function moneyWeightedReturn({startAt,endAt,startValue=0,endValue,flows=[]}){
  if(![startAt,endAt,startValue,endValue].every(Number.isFinite)||endAt<=startAt||startValue<0||endValue<0)return null;
  const grouped=new Map([[startAt,-startValue]]);
  for(const flow of flows){if(!Number.isFinite(flow.at)||!Number.isFinite(flow.amount)||flow.at<startAt||flow.at>endAt)return null;grouped.set(flow.at,(grouped.get(flow.at)||0)-flow.amount);}
  grouped.set(endAt,(grouped.get(endAt)||0)+endValue);
  const rows=[...grouped].sort((a,b)=>a[0]-b[0]).filter(([,v])=>v!==0);
  if(!rows.length||rows[0][1]>=0)return null;
  if(endValue===0&&rows.every(([,v])=>v<0)&&rows.at(-1)[0]<endAt)return -100;
  const signs=rows.map(([,v])=>Math.sign(v));if(signs.filter((s,i)=>i&&s!==signs[i-1]).length!==1||signs.at(-1)!==1)return null;
  const scale=Math.max(...rows.map(([,v])=>Math.abs(v))),duration=endAt-startAt;
  const npv=x=>rows.reduce((sum,[at,value])=>sum+value/scale*Math.exp(-x*(at-startAt)/duration),0);
  let low=-32,high=32;if(npv(low)<=0||npv(high)>=0)return null;
  for(let i=0;i<120;i++){const mid=(low+high)/2;if(npv(mid)>0)low=mid;else high=mid;}
  const rate=Math.expm1((low+high)/2)*100;return Number.isFinite(rate)?Math.abs(rate)<1e-10?0:rate:null;
}
