const activeStatuses=new Set(['NEW','LOCAL','UNCONFIRMED','CONFIRMED','PARTIALLY_FILLED','REPLACING','CANCELLING']);

// These references belong to one verified holding, never to a similar ticker,
// another account, or the account's reporting currency.
export function portfolioChartOrderLines(data,position,entry,stale=false){
  const holding=position?.holding;
  if(!position?.orderListing||position.orderListing.id!==entry?.id||data?.ticker!==holding?.ticker||data.priceCurrency!==holding.instrumentCurrency||!Array.isArray(data.orders))return [];
  const counts=new Map();for(const order of data.orders)counts.set(order?.id,(counts.get(order?.id)||0)+1);
  return data.orders.filter(order=>order&&Number.isSafeInteger(order.id)&&order.id>=0&&counts.get(order.id)===1&&order.ticker===holding.ticker&&order.type==='LIMIT'&&activeStatuses.has(order.status)&&['BUY','SELL'].includes(order.side)&&order.priceCurrency===holding.instrumentCurrency&&Number.isFinite(order.limitPrice)&&order.limitPrice>0&&Number.isFinite(order.quantity)&&order.quantity>0&&(order.filledQuantity==null||Number.isFinite(order.filledQuantity)&&order.filledQuantity>=0&&order.filledQuantity<order.quantity)).map(order=>({
    id:order.id,side:order.side,value:order.limitPrice,currency:order.priceCurrency,quantity:order.quantity,filledQuantity:order.filledQuantity??null,
    remainingQuantity:order.filledQuantity==null?null:Number((order.quantity-order.filledQuantity).toFixed(12)),status:order.status,unconfirmed:order.awaitingHistory===true,stale,
  }));
}
export function chartOrderStatus(line){
  return line.stale?'Last confirmed · refresh unavailable':line.unconfirmed?'Status unconfirmed':line.status==='PARTIALLY_FILLED'?'Partially filled':line.status==='CANCELLING'?'Cancellation pending':line.status==='REPLACING'?'Replacement pending':'Pending';
}
