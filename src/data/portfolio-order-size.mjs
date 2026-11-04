// Decimal arithmetic keeps percentage shortcuts below the available shares/cash.
// Use a four-decimal app sizing step unless this account's broker has reported
// a stricter limit. Holdings retain their original precision.
export const DEFAULT_ORDER_PRECISION=4;
// App allowance for share-based Market buys, not a broker execution guarantee.
export const MARKET_BUY_BUFFER_PERCENT=5;
export function orderQuantityPrecision(rules=[],order={}){
  return rules.reduce((precision,rule)=>rule.ticker===order.ticker&&rule.type===order.type&&rule.side===order.side&&rule.extendedHours===(order.extendedHours===true)&&Number.isInteger(rule.precision)&&rule.precision>=0&&rule.precision<=8?Math.min(precision,rule.precision):precision,DEFAULT_ORDER_PRECISION);
}
function decimal(value){
  if(typeof value!=='number'||!Number.isFinite(value)||value<0)return null;
  const [coefficient,exponent='0']=String(value).split('e'),fraction=coefficient.split('.')[1]||'';
  const digits=BigInt(coefficient.replace('.','')),power=Number(exponent)-fraction.length;
  return power>=0?{n:digits*10n**BigInt(power),d:1n}:{n:digits,d:10n**BigInt(-power)};
}
export function marketBuyCashLimit(availableCash){
  const amount=decimal(availableCash);
  if(!amount)return null;
  // Floor to cents so the displayed maximum is also safe to enter as cash.
  const cents=amount.n*BigInt(100-MARKET_BUY_BUFFER_PERCENT)/amount.d;
  return Number(`${cents/100n}.${String(cents%100n).padStart(2,'0')}`);
}
export function orderPercentage({side,type='LIMIT',percent,availableShares,availableCash,price,precision=DEFAULT_ORDER_PRECISION}){
  if(![25,50,75,100].includes(percent)||!['BUY','SELL'].includes(side))return '';
  if(side==='SELL'&&percent===100)return exactOrderQuantity(availableShares);
  const quantity=sizedQuantity(side==='SELL'?availableShares:availableCash,side==='SELL'?1:price,percent,precision);
  if(side!=='BUY'||type!=='MARKET')return quantity;
  const maximum=cashOrderQuantity(marketBuyCashLimit(availableCash),price,precision);
  return quantity&&maximum?(Number(quantity)>Number(maximum)?maximum:quantity):'';
}
export function cashOrderQuantity(amount,price,precision=DEFAULT_ORDER_PRECISION){return sizedQuantity(amount,price,100,precision);}
export function roundedOrderQuantity(value,precision=DEFAULT_ORDER_PRECISION){return sizedQuantity(value,1,100,precision);}
// Preserve a full available sale exactly; this does not assert broker acceptance.
export function exactOrderQuantity(value){return typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=1000000?String(value):'';}
export function sellRemainder(availableShares,quantity,precision=DEFAULT_ORDER_PRECISION){
  const available=decimal(availableShares),sale=decimal(quantity);
  if(!available||!sale||!Number.isInteger(precision)||precision<0||precision>8)return null;
  // Decimal subtraction avoids displaying a binary tail or treating an exact
  // sizing-step remainder as too small. Holdings themselves are never rounded.
  const denominator=available.d>sale.d?available.d:sale.d;
  const remaining=available.n*(denominator/available.d)-sale.n*(denominator/sale.d);
  if(remaining<0n)return null;
  const digits=String(denominator).length-1;
  const fraction=String(remaining%denominator).padStart(digits,'0').replace(/0+$/,'');
  return {shares:String(remaining/denominator)+(fraction?'.'+fraction:''),belowStep:remaining>0n&&remaining*10n**BigInt(precision)<denominator};
}
function sizedQuantity(value,price,percent,precision){
  const amount=decimal(value),cost=decimal(price);
  if(!amount||!cost||cost.n===0n||!Number.isInteger(precision)||precision<0||precision>8)return '';
  const scale=10n**BigInt(precision),units=amount.n*BigInt(percent)*scale*cost.d/(100n*amount.d*cost.n);
  if(units===0n||units>1000000n*scale)return '';
  const fraction=String(units%scale).padStart(precision,'0').replace(/0+$/,'');
  return String(units/scale)+(fraction?'.'+fraction:'');
}
