// Decimal arithmetic keeps percentage shortcuts below the available shares/cash.
// Broker orders accept at most eight share decimals; always discard the remainder.
function decimal(value){
  if(typeof value!=='number'||!Number.isFinite(value)||value<0)return null;
  const [coefficient,exponent='0']=String(value).split('e'),fraction=coefficient.split('.')[1]||'';
  const digits=BigInt(coefficient.replace('.','')),power=Number(exponent)-fraction.length;
  return power>=0?{n:digits*10n**BigInt(power),d:1n}:{n:digits,d:10n**BigInt(-power)};
}
export function orderPercentage({side,percent,availableShares,availableCash,price}){
  if(![25,50,75,100].includes(percent)||!['BUY','SELL'].includes(side))return '';
  return sizedQuantity(side==='SELL'?availableShares:availableCash,side==='SELL'?1:price,percent);
}
export function cashOrderQuantity(amount,price){return sizedQuantity(amount,price,100);}
function sizedQuantity(value,price,percent){
  const amount=decimal(value),cost=decimal(price);
  if(!amount||!cost||cost.n===0n)return '';
  const units=amount.n*BigInt(percent)*100000000n*cost.d/(100n*amount.d*cost.n);
  if(units===0n||units>100000000000000n)return '';
  const fraction=String(units%100000000n).padStart(8,'0').replace(/0+$/,'');
  return String(units/100000000n)+(fraction?'.'+fraction:'');
}
