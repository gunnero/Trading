// Decimal arithmetic keeps percentage shortcuts below the available shares/cash.
// Use a four-decimal app sizing step unless this account's broker has reported
// a stricter limit. Holdings retain their original precision.
export const DEFAULT_ORDER_PRECISION=4;
export function orderQuantityPrecision(rules=[],order={}){
  return rules.reduce((precision,rule)=>rule.ticker===order.ticker&&rule.type===order.type&&rule.side===order.side&&rule.extendedHours===(order.extendedHours===true)&&Number.isInteger(rule.precision)&&rule.precision>=0&&rule.precision<=8?Math.min(precision,rule.precision):precision,DEFAULT_ORDER_PRECISION);
}
function decimal(value){
  if(typeof value!=='number'||!Number.isFinite(value)||value<0)return null;
  const [coefficient,exponent='0']=String(value).split('e'),fraction=coefficient.split('.')[1]||'';
  const digits=BigInt(coefficient.replace('.','')),power=Number(exponent)-fraction.length;
  return power>=0?{n:digits*10n**BigInt(power),d:1n}:{n:digits,d:10n**BigInt(-power)};
}
export function orderPercentage({side,percent,availableShares,availableCash,price,precision=DEFAULT_ORDER_PRECISION}){
  if(![25,50,75,100].includes(percent)||!['BUY','SELL'].includes(side))return '';
  return sizedQuantity(side==='SELL'?availableShares:availableCash,side==='SELL'?1:price,percent,precision);
}
export function cashOrderQuantity(amount,price,precision=DEFAULT_ORDER_PRECISION){return sizedQuantity(amount,price,100,precision);}
export function roundedOrderQuantity(value,precision=DEFAULT_ORDER_PRECISION){return sizedQuantity(value,1,100,precision);}
function sizedQuantity(value,price,percent,precision){
  const amount=decimal(value),cost=decimal(price);
  if(!amount||!cost||cost.n===0n||!Number.isInteger(precision)||precision<0||precision>8)return '';
  const scale=10n**BigInt(precision),units=amount.n*BigInt(percent)*scale*cost.d/(100n*amount.d*cost.n);
  if(units===0n||units>1000000n*scale)return '';
  const fraction=String(units%scale).padStart(precision,'0').replace(/0+$/,'');
  return String(units/scale)+(fraction?'.'+fraction:'');
}
