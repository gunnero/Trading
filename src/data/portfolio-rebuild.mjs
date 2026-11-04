import {marketDay,addDays} from './calendar.mjs';
import {exchangeInstant} from './market-session.mjs';

const finite=value=>typeof value==='number'&&Number.isFinite(value);
const timestamp=value=>typeof value==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(value)?Date.parse(value):NaN;
const fail=message=>{throw Error(message);};
export function verifyPortfolioSplits(splits,history){
  for(const split of splits){
    const day=marketDay(split.at),matches=history?.splitAdjustments?.filter(s=>finite(s.at)&&marketDay(s.at)===day);
    if(history?.shareBasis!=='historical'||matches?.length!==1||!finite(matches[0].ratio)||matches[0].ratio<=0||
      Math.abs(split.before*matches[0].ratio-split.after)>1e-7||split.at>=Date.parse(exchangeInstant(day,9,30)))
      fail('The stock split date or ratio could not be verified against historical prices for '+split.ticker+'. Saved history is retained.');
  }
}
export function portfolioLedger({orders,transactions,dividends,snapshot}){
  const end=Date.parse(snapshot.fetchedAt),currency=snapshot.currency,events=[],instruments=new Map(),quantities=new Map(),splitPairs=new Map(),splits=[];
  if(!Number.isFinite(end)||!finite(snapshot.cash))fail('A current broker balance is required.');
  const add=(at,cash,extra={})=>{if(!Number.isFinite(at)||!finite(cash))fail('Historical amounts or timestamps are incomplete.');if(at<=end)events.push({at,cash,...extra});};
  for(const row of transactions){
    const at=timestamp(row.dateTime);if(!Number.isFinite(at))fail('A transaction has no valid timestamp.');if(at>end)continue;
    if(row.currency!==currency)fail('Historical funding uses another currency. Verified account-currency amounts are needed to rebuild it.');
    if(!['DEPOSIT','WITHDRAW','FEE','INTEREST_ON_FREE_CASH','LENDING_INTEREST'].includes(row.type))fail('Transfers or unsupported cash movements need broker statement balances before this history can be rebuilt.');
    if(!finite(row.amount)||row.type==='DEPOSIT'&&row.amount<0)fail('A cash movement has an invalid amount.');
    add(at,row.type==='WITHDRAW'?-Math.abs(row.amount):row.amount);
  }
  for(const row of dividends){
    const at=timestamp(row.paidOn);if(!Number.isFinite(at))fail('A dividend has no valid payment date.');if(at>end)continue;
    if(row.currency!==currency)fail('A dividend is missing its account-currency amount.');add(at,row.amount);
  }
  const fills=new Set();
  for(const item of orders){
    const fill=item?.fill,order=item?.order;
    if(!order||!['LOCAL','UNCONFIRMED','CONFIRMED','NEW','CANCELLING','CANCELLED','PARTIALLY_FILLED','FILLED','REJECTED','REPLACING','REPLACED'].includes(order.status))fail('A historical order is incomplete. No reconstructed chart was published.');
    if(!fill){if(order&&['FILLED','PARTIALLY_FILLED'].includes(order.status))fail('An executed order is missing its fill.');continue;}
    if(!Number.isSafeInteger(fill.id)||fills.has(fill.id))fail('Historical execution identities are incomplete or duplicated.');fills.add(fill.id);
    const at=timestamp(fill.filledAt);if(!Number.isFinite(at))fail('An execution has no valid timestamp.');if(at>end)continue;
    if(!['TRADE','STOCK_SPLIT'].includes(fill.type))fail('This account includes stock transfers or corporate actions. Automatic reconstruction needs their verified adjustments; recorded balances remain available.');
    const instrument=order?.instrument,ticker=instrument?.ticker||order?.ticker,wallet=fill.walletImpact;
    if(!['BUY','SELL'].includes(order?.side)||!instrument||typeof ticker!=='string'||!finite(fill.quantity)||fill.quantity===0||!finite(wallet?.netValue))fail('An execution is missing shares or its net cash amount.');
    if(instrument.currency!==currency||wallet.currency!==currency)fail('Historical trades use another currency. Daily FX values are required to reconstruct this account.');
    const existing=instruments.get(ticker);if(existing&&existing.isin!==instrument.isin)fail('A broker ticker changed instrument identity. A verified listing history is needed.');
    instruments.set(ticker,{ticker,name:instrument.name||ticker,isin:instrument.isin||'',instrumentCurrency:instrument.currency});
    if(fill.type==='STOCK_SPLIT'){
      if(order.status!=='FILLED'||!instrument.isin||!finite(fill.price)||fill.price<=0||wallet.netValue<0||
        (order.side==='SELL'?fill.quantity>=0:fill.quantity<=0)||Math.abs(Math.abs(fill.quantity)*fill.price-wallet.netValue)>.02)
        fail('A stock split has incomplete share or cost information. Saved history is retained.');
      const key=JSON.stringify([ticker,at]),pair=splitPairs.get(key)||[];
      pair.push({side:order.side,quantity:Math.abs(fill.quantity),price:fill.price,cost:wallet.netValue});splitPairs.set(key,pair);
      continue;
    }
    const quantity=Math.abs(fill.quantity)*(order.side==='BUY'?1:-1),cash=Math.abs(wallet.netValue)*(order.side==='BUY'?-1:1);
    add(at,cash,{ticker,quantity});
  }
  for(const [key,pair] of splitPairs){
    const [ticker,at]=JSON.parse(key),sell=pair.find(p=>p.side==='SELL'),buy=pair.find(p=>p.side==='BUY');
    if(pair.length!==2||!sell||!buy||Math.abs(sell.cost-buy.cost)>.01||sell.quantity===buy.quantity||
      Math.abs(sell.price*sell.quantity-buy.price*buy.quantity)>.02||
      events.some(e=>e.ticker===ticker&&e.at===at))
      fail('Stock split corporate actions need a matching removal and replacement with unchanged cost. Saved history is retained.');
    const split={ticker,at,before:sell.quantity,after:buy.quantity};splits.push(split);
    // These are share replacements, not cash trades. Apply both legs together.
    add(at,0,{ticker,quantity:buy.quantity-sell.quantity,split});
  }
  events.sort((a,b)=>a.at-b.at);
  let cash=0;
  for(const event of events){
    cash+=event.cash;if(!event.ticker)continue;
    const before=quantities.get(event.ticker)||0;
    if(event.split&&Math.abs(before-event.split.before)>1e-7)fail('The stock split does not match the shares held before it. Earlier trades or additional adjustments are missing.');
    const quantity=before+event.quantity;
    if(quantity< -1e-7)fail('Historical sales exceed recorded purchases. Earlier transactions or share adjustments are missing.');
    quantities.set(event.ticker,quantity);
  }
  if(!events.length)fail('No historical activity was supplied.');
  const holdings=new Map(snapshot.holdings.map(h=>[h.ticker,h.quantity]));
  for(const ticker of new Set([...holdings.keys(),...quantities.keys()]))if(Math.abs((holdings.get(ticker)||0)-(quantities.get(ticker)||0))>1e-7)fail('The imported trade history does not reconcile with current shares for '+ticker+'. Older executions or share adjustments may be missing.');
  if(Math.abs(cash-snapshot.cash)>.02)fail('The imported cash history does not reconcile with the broker balance. Missing payments, fees or cash adjustments must be resolved first.');
  return {events,instruments:[...instruments.values()],splits,from:events[0].at,to:end,cash};
}
export function rebuildPortfolioValues(ledger,histories,currency){
  const startDay=marketDay(ledger.from),endDay=marketDay(ledger.to),points=[],positions=new Map(),indexes=new Map();let cash=0,index=0;
  if(Date.parse(endDay)-Date.parse(startDay)>20*366*86400000)fail('Automatic reconstruction supports up to 20 years per account.');
  for(const instrument of ledger.instruments){
    const h=histories[instrument.ticker];
    if(h?.currency!==currency||!Array.isArray(h.points)||!h.points.length||h.points.some((p,i)=>!finite(p.at)||!finite(p.value)||p.value<=0||i>0&&p.at<=h.points[i-1].at))fail('Verified daily prices are unavailable for '+instrument.ticker+'.');indexes.set(instrument.ticker,0);
    verifyPortfolioSplits((ledger.splits||[]).filter(s=>s.ticker===instrument.ticker),h);
  }
  for(let day=startDay;day<=endDay;day=addDays(day,1)){
    const at=Date.parse(exchangeInstant(day,16));if(at>ledger.to||at<ledger.from)continue;
    while(index<ledger.events.length&&ledger.events[index].at<=at){const e=ledger.events[index++];cash+=e.cash;if(e.ticker)positions.set(e.ticker,(positions.get(e.ticker)||0)+e.quantity);}
    let value=cash;
    for(const [ticker,quantity] of positions){
      if(Math.abs(quantity)<1e-7)continue;
      const prices=histories[ticker].points;let cursor=indexes.get(ticker);
      while(cursor+1<prices.length&&prices[cursor+1].at<=at)cursor++;indexes.set(ticker,cursor);const price=prices[cursor];
      if(price.at>at||at-price.at>7*86400000)fail('Daily price coverage has a gap for '+ticker+' on '+day+'.');
      if((ledger.splits||[]).some(s=>s.ticker===ticker&&s.at<=at&&s.at>price.at))fail('A price after the stock split is missing for '+ticker+' on '+day+'.');
      value+=quantity*price.value;
    }
    if(value<-.02||!finite(value))fail('A historical balance could not be reconciled.');
    points.push({at,value:Math.max(0,value),estimated:true});
  }
  if(!points.length)fail('No completed daily balances can be reconstructed yet.');return points;
}
