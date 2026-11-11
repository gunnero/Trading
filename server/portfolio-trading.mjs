import {randomUUID} from 'node:crypto';
import {cashOrderQuantity,roundedOrderQuantity,orderQuantityPrecision,marketBuyCashLimit,exactOrderQuantity} from '../src/data/portfolio-order-size.mjs';
import {orderHistoryPath} from './portfolio-history.mjs';
import {createOrderTracker} from './portfolio-order-tracker.mjs';
import {createBalanceReader} from './portfolio-balance-reads.mjs';

const fail=(status,message)=>Object.assign(Error(message),{status});
const bases={live:'https://live.trading212.com/api/v0',demo:'https://demo.trading212.com/api/v0'};
const activeStatuses=['LOCAL','UNCONFIRMED','CONFIRMED','NEW','PARTIALLY_FILLED','REPLACING'];
const terminalStatuses=['CANCELLED','FILLED','REJECTED','REPLACED'];
const numeric=value=>typeof value==='number'&&Number.isFinite(value);
function quantity(value){if(!numeric(value)||value<=0||value>1000000)throw fail(400,'Enter a positive share quantity of no more than 1,000,000.');return value;}
async function rejectionReason(res,secret){
  // Read only bounded problem details, never expose the raw upstream response.
  // A missing/broken error body must not change a definite HTTP rejection into
  // an uncertain order outcome.
  try{
    if(!/\bapplication\/(?:problem\+)?json\b/i.test(res.headers.get('content-type')||''))return null;
    const reader=res.body.getReader(),chunks=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384){await reader.cancel();return null;}chunks.push(value);}
    const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const problem=body?.error&&typeof body.error==='object'?body.error:body;
    if(!problem||Array.isArray(problem)||typeof problem!=='object')return null;
    const redact=value=>{
      if(typeof value!=='string'||/[<>]/.test(value))return '';
      for(const item of [Buffer.from(secret.apiKey+':'+secret.apiSecret).toString('base64'),secret.apiKey,secret.apiSecret])if(item)value=value.split(item).join('[redacted]');
      return value.replace(/(?:authorization|api[_ -]?(?:key|secret)|access[_ -]?token)\s*[:=]\s*\S+/gi,'[redacted]').replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim().slice(0,500);
    };
    const rawCode=problem.code||(typeof problem.type==='string'&&problem.type.startsWith('/api-errors/')?problem.type.slice(12):'');
    const code=typeof rawCode==='string'&&/^[a-zA-Z0-9._-]{1,100}$/.test(rawCode)?redact(rawCode):'';
    const detail=redact(problem.detail)||redact(problem.message)||(typeof body.error==='string'?redact(body.error):'');
    if(!code&&!detail)return null;
    return {code:code||null,message:`Trading 212 rejected this order${detail?': '+detail:'.'}${code?' (code: '+code+')':''}`};
  }catch{return null;}
}
export function orderView(order){
  const ticker=order?.instrument?.ticker||order?.ticker;
  if(!Number.isSafeInteger(order?.id)||order.id<0||typeof ticker!=='string'||!/^[A-Za-z0-9._-]{1,80}$/.test(ticker)||!['BUY','SELL'].includes(order.side)||!['MARKET','LIMIT','STOP','STOP_LIMIT'].includes(order.type)||![...activeStatuses,...terminalStatuses,'CANCELLING'].includes(order.status)||(!numeric(order.quantity)&&!(order.strategy==='VALUE'&&numeric(order.value))))throw fail(502,'The broker returned an incomplete order. Check Trading 212.');
  const label=order.instrument?.name||order.name,code=value=>typeof value==='string'&&/^[A-Z]{3}$/.test(value)?value:null;
  return {id:order.id,ticker,name:typeof label==='string'?label.slice(0,160):ticker,strategy:order.strategy||'QUANTITY',side:order.side,type:order.type,status:order.status,extendedHours:typeof order.extendedHours==='boolean'?order.extendedHours:null,quantity:numeric(order.quantity)?Math.abs(order.quantity):null,value:numeric(order.value)?Math.abs(order.value):null,filledQuantity:numeric(order.filledQuantity)?Math.abs(order.filledQuantity):null,limitPrice:numeric(order.limitPrice)?order.limitPrice:null,currency:code(order.currency)||code(order.instrument?.currency),priceCurrency:code(order.instrument?.currency)||code(order.priceCurrency)||code(order.currency),createdAt:typeof order.createdAt==='string'&&Number.isFinite(Date.parse(order.createdAt))?order.createdAt:null};
}

export function createPortfolioTrading(db,{now,credential,decode,account,isClosed,fetcher=fetch,timeoutMs=10000,onBalances,onObserve,onRejected,readCatalog,balanceReader,balanceWait,marketPrice=async()=>null,orderLimit=()=>null,getOrderLimit=()=>null}){
  db.exec(`CREATE TABLE IF NOT EXISTS portfolio_trading_settings(account_id TEXT PRIMARY KEY,generation TEXT NOT NULL,enabled INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS portfolio_order_attempts(token TEXT PRIMARY KEY,account_id TEXT NOT NULL,generation TEXT NOT NULL,created_at INTEGER NOT NULL,state TEXT NOT NULL,detail TEXT NOT NULL);`);
  // A process may have died after sending an order and before saving its reply.
  db.prepare("UPDATE portfolio_order_attempts SET state='UNKNOWN' WHERE state='SENDING'").run();
  const catalogs=new Map(),locks=new Set(),readBackoff=new Map();
  const balances=balanceReader||createBalanceReader({now,request:broker,wait:balanceWait});
  const tracker=createOrderTracker(db,{now,broker,current,orderView,onObserve,refreshBalances:async(id,ctx)=>{
    balances.invalidate(id);const fresh=await freshBalances(id,ctx);current(id,ctx);
    if(onBalances)await onBalances(id,fresh,ctx.record.generation);
  }});
  const saved=token=>{const row=db.prepare('SELECT * FROM portfolio_order_attempts WHERE token=?').get(token);return row?{...row,detail:JSON.parse(row.detail)}:null;};
  const settings=id=>db.prepare('SELECT * FROM portfolio_trading_settings WHERE account_id=?').get(id);
  const enabled=id=>{const record=credential(id),s=settings(id);return !!record&&s?.generation===record.generation&&s.enabled===1;};
  const unresolved=id=>db.prepare("SELECT token FROM portfolio_order_attempts WHERE account_id=? AND state IN ('UNKNOWN','SENDING') LIMIT 1").get(id);
  const update=(token,state,detail)=>db.prepare('UPDATE portfolio_order_attempts SET state=?,detail=? WHERE token=?').run(state,JSON.stringify(detail),token);
  const publicAttempt=row=>({token:row.token,state:row.state,createdAt:row.created_at,...row.detail});
  function quantityRules(id){
    const generation=credential(id)?.generation;if(!generation)return [];
    // Reuse durable broker rejections, including those saved by older versions.
    // Client-supplied precision is never authoritative. Keep rules scoped to the
    // connection, instrument, side, order type and requested trading session.
    const rules=new Map();
    for(const row of db.prepare("SELECT detail FROM portfolio_order_attempts WHERE account_id=? AND generation=? AND state='REJECTED'").all(id,generation)){
      const d=JSON.parse(row.detail);
      if(d.action!=='ORDER'||d.brokerStatus!==400||d.brokerCode!=='quantity-precision-mismatch'||!['BUY','SELL'].includes(d.side)||!['MARKET','LIMIT'].includes(d.type))continue;
      const match=/^Trading 212 rejected this order: invalid quantity precision ([0-8]) \(code: quantity-precision-mismatch\)$/.exec(d.message);
      if(!match)continue;
      const rule={ticker:d.ticker,type:d.type,side:d.side,extendedHours:d.extendedHours===true,precision:Number(match[1])},key=JSON.stringify([rule.ticker,rule.type,rule.side,rule.extendedHours]);
      if(!rules.has(key)||rules.get(key).precision>rule.precision)rules.set(key,rule);
    }
    return [...rules.values()];
  }
  function read(id){const a=account(id);return {enabled:enabled(id),quantityRules:quantityRules(id),maxOrderValue:getOrderLimit(id),environment:a.environment,brokerId:a.snapshot?.brokerId||null,blocked:!!unresolved(id),attempts:db.prepare("SELECT * FROM portfolio_order_attempts WHERE account_id=? AND state<>'PREPARED' ORDER BY created_at DESC LIMIT 30").all(id).map(row=>publicAttempt({...row,detail:JSON.parse(row.detail)}))};}
  function attempt(id,token){
    const ctx=context(id,false);
    if(typeof token!=='string'||!/^[a-f0-9-]{36}$/.test(token))throw fail(400,'Choose a valid order confirmation.');
    const row=saved(token);
    if(!row||row.account_id!==id||row.generation!==ctx.record.generation)throw fail(409,'This confirmation is unavailable for the current connection. Check its outcome in Trading 212.');
    // A delayed POST can still arrive while a review is valid. Only an expired,
    // idle PREPARED review proves no submission can still start from this token.
    return {attempt:publicAttempt(row),inFlight:locks.has(id),notSubmitted:row.state==='PREPARED'&&row.detail.expiresAt<=now()&&!locks.has(id)};
  }
  function context(id,requireEnabled=true){
    const a=account(id),record=credential(id);
    if(!record||a.platform!=='Trading 212'||a.snapshot?.source!=='api')throw fail(400,'Connect this Trading 212 account first.');
    if(requireEnabled&&!enabled(id))throw fail(403,'Enable trading for this account first.');
    return {a,record,requireEnabled,secret:decode(record,id)};
  }
  function current(id,ctx){if(isClosed()||credential(id)?.generation!==ctx.record.generation||ctx.requireEnabled&&!enabled(id))throw fail(409,'The account connection or trading permission changed. Review a new order.');}
  async function broker(path,secret,{method='GET',body,onReadResponse}={}){
    const allowed=method==='GET'&&(path==='/equity/account/summary'||path==='/equity/positions'||path==='/equity/metadata/instruments'||path==='/equity/orders'||/^\/equity\/orders\/\d+$/.test(path)||path.startsWith('/equity/history/orders?')&&orderHistoryPath(path)===path)||method==='POST'&&['/equity/orders/market','/equity/orders/limit'].includes(path)||method==='DELETE'&&/^\/equity\/orders\/\d+$/.test(path);
    if(!allowed||!bases[secret.environment])throw fail(400,'Unsupported trading request.');
    try{
      const res=await fetcher(bases[secret.environment]+path,{method,redirect:'error',signal:AbortSignal.timeout(timeoutMs),headers:{Accept:'application/json',Authorization:'Basic '+Buffer.from(secret.apiKey+':'+secret.apiSecret).toString('base64'),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
      if(method==='GET')onReadResponse?.(res);
      if(!res.ok){const error=fail(502,res.status===403?'Trading 212 denied access. Enable Metadata, Orders: Read and Orders: Execute permissions for this account.':res.status===400?'Trading 212 rejected the request without a readable reason. Check the order in Trading 212 before trying again.':res.status===429?'Trading 212 is rate limiting requests. Wait before trying again.':res.status===401?'Trading 212 rejected the API credentials. Reconnect this account.':'Trading 212 could not confirm this request.');error.definite=[400,401,403,404,429].includes(res.status);error.upstreamStatus=res.status;const seconds=Number(res.headers.get('retry-after')),reset=Number(res.headers.get('x-ratelimit-reset'));error.retryMs=Math.min(86400000,Math.max(60000,Number.isFinite(seconds)?seconds*1000:Math.max(0,Date.parse(res.headers.get('retry-after'))-now())||0,Number.isFinite(reset)?reset*1000-now():0));if(method==='POST'&&res.status===400){const reason=await rejectionReason(res,secret);if(reason){error.message=reason.message;error.brokerCode=reason.code;}}if(method==='GET'&&res.status===403)error.message=path.includes('/history/')?'Final status needs History: Orders permission on the API key.':'Trading 212 denied read access. Check this account’s API read permissions.';throw error;}
      if(method==='DELETE')return null;
      if(!res.headers.get('content-type')?.includes('application/json'))throw Error('Invalid response');
      const reader=res.body.getReader(),chunks=[];let size=0;
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>(path.endsWith('/instruments')?16000000:2000000)){await reader.cancel();throw Error('Oversized response');}chunks.push(value);}
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }catch(error){if(error.status)throw error;throw fail(502,method==='GET'?'The broker data could not be refreshed. Try again shortly.':'No definite broker response. Check Trading 212 before placing another order.');}
  }
  function configure(id,input){
    const ctx=context(id,false);
    if(typeof input.enabled!=='boolean'||input.enabled&&input.authorized!==true)throw fail(400,'Confirm the account owner authorizes placing and cancelling orders.');
    if(locks.has(id))throw fail(409,'An order operation is still running. Wait for its result.');
    db.prepare('INSERT INTO portfolio_trading_settings VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET generation=excluded.generation,enabled=excluded.enabled').run(id,ctx.record.generation,+input.enabled);
    db.prepare("DELETE FROM portfolio_order_attempts WHERE account_id=? AND state='PREPARED'").run(id);
    return read(id);
  }
  async function catalog(id,ctx){
    const cached=catalogs.get(id);if(cached?.generation===ctx.record.generation&&cached.until>now())return cached.items;
    const key=id+':catalog';if((readBackoff.get(key)||0)>now())throw fail(429,'Wait a minute before refreshing the instrument list.');readBackoff.set(key,now()+60000);
    const raw=readCatalog?await readCatalog(id):await broker('/equity/metadata/instruments',ctx.secret);current(id,ctx);
    if(!Array.isArray(raw)||raw.length>40000)throw fail(502,'The broker instrument list is unavailable.');
    const items=raw.filter(r=>['STOCK','ETF'].includes(r.type)&&typeof r.ticker==='string'&&/^[A-Za-z0-9._-]{1,80}$/.test(r.ticker)&&typeof r.name==='string'&&/^[A-Z]{3}$/.test(r.currencyCode)).map(r=>({ticker:r.ticker,name:r.name.slice(0,160),currency:r.currencyCode,type:r.type,isin:r.isin||'',maxOpenQuantity:numeric(r.maxOpenQuantity)?r.maxOpenQuantity:null,extendedHours:r.extendedHours===true}));
    catalogs.delete(id);catalogs.set(id,{generation:ctx.record.generation,until:now()+600000,items});
    while(catalogs.size>4)catalogs.delete(catalogs.keys().next().value);
    return items;
  }
  async function search(id,q){const ctx=context(id);if(typeof q!=='string'||q.length<2||q.length>80)return {items:[]};const query=q.toLowerCase();return {items:(await catalog(id,ctx)).filter(r=>(r.name+' '+r.ticker+' '+r.isin).toLowerCase().includes(query)).slice(0,40)};}
  async function track(id,requireEnabled){
    const ctx=context(id,requireEnabled);
    // Continue accepted attempts after a restart without replaying old alerts.
    const attempts=db.prepare("SELECT detail FROM portfolio_order_attempts WHERE account_id=? AND generation=? AND state IN ('ACCEPTED','REJECTED') ORDER BY created_at DESC LIMIT 100").all(id,ctx.record.generation).map(row=>JSON.parse(row.detail)).filter(detail=>detail.order).map(detail=>orderView(detail.order));
    tracker.restore(id,ctx,attempts);
    const result=await tracker.poll(id,ctx);
    if(onObserve){result.activityError=null;for(const order of result.orders)try{onObserve(id,ctx.record.generation,order,null,false);}catch{result.activityError='Order status is saved; activity updates are waiting to catch up.';}}
    return result;
  }
  async function pending(id){return exclusive(id,()=>track(id,true));}
  async function monitor(id){
    if(isClosed()||locks.has(id))return;
    const record=credential(id);if(!record)return;
    const restore=db.prepare("SELECT 1 FROM portfolio_order_attempts WHERE account_id=? AND generation=? AND state IN ('ACCEPTED','REJECTED') LIMIT 1").get(id,record.generation);
    if(!enabled(id)&&!tracker.needsMonitoring(id,record.generation,!!restore))return;
    return exclusive(id,()=>track(id,false));
  }
  function tracking(id){const record=credential(id);return record?tracker.read(id,record.generation):null;}
  async function freshBalances(id,ctx){
    const fresh=await balances.read(id,ctx.record.generation,ctx.secret);current(id,ctx);
    const {summary,positions}=fresh;
    if(String(summary?.id)!==ctx.a.snapshot.brokerId||summary.currency!==ctx.a.snapshot.currency||!numeric(summary.cash?.availableToTrade))throw fail(409,'The broker account identity or currency changed. Reconnect before trading.');
    if(!Array.isArray(positions))throw fail(502,'Available shares could not be checked.');
    return fresh;
  }
  async function position(id,ticker){return exclusive(id,async()=>{
    const ctx=context(id);
    if(typeof ticker!=='string'||!/^[A-Za-z0-9._-]{1,80}$/.test(ticker))throw fail(400,'Choose a valid broker instrument.');
    let stage='instruments';
    try{
      const instrument=(await catalog(id,ctx)).find(item=>item.ticker===ticker);
      if(!instrument)throw fail(400,'Choose an exact stock or ETF from the broker instrument list.');
      stage='balances';
      const {summary,positions,at}=await freshBalances(id,ctx);current(id,ctx);
      const holding=holdingDetails(positions.find(item=>item.instrument?.ticker===ticker),summary.currency,instrument.currency);
      stage='price';
      const pricing=await referencePrice(instrument,holding,at);current(id,ctx);
      return {ticker,currency:summary.currency,instrumentCurrency:instrument.currency,...holding,...pricing,availableCash:summary.cash.availableToTrade,checkedAt:at};
    }catch(error){error.readStage=stage;throw error;}
  });}
  async function referencePrice(instrument,holding,at){
    if(holding.price>0)return {price:holding.price,priceQuote:{source:'Trading 212',observedAt:null,checkedAt:at,validUntil:at+65000,session:null,delayMinutes:null}};
    return await marketPrice(instrument)||{price:null,priceQuote:null};
  }
  function holdingDetails(holding,currency,instrumentCurrency){
    const nonnegative=value=>numeric(value)&&value>=0?value:null;
    const shares=holding?nonnegative(holding.quantity):0,available=holding?nonnegative(holding.quantityAvailableForTrading):0;
    const wallet=holding?.walletImpact?.currency===currency?holding.walletImpact:null,cost=holding?nonnegative(wallet?.totalCost):0;
    const profit=holding&&numeric(wallet?.unrealizedProfitLoss)?wallet.unrealizedProfitLoss:null;
    const priceMatch=holding?.instrument?.currency===instrumentCurrency;
    return {shares,availableShares:available!==null&&shares!==null&&available<=shares?available:null,value:holding?nonnegative(wallet?.currentValue):0,
      price:priceMatch?nonnegative(holding.currentPrice):null,averagePrice:priceMatch?nonnegative(holding.averagePricePaid):null,cost,unrealized:profit,unrealizedPercent:profit!==null&&cost>0?profit/cost*100:null};
  }
  async function validate(id,input,ctx,normalize=false){
    if(input.action==='CANCEL'){
      if(!Number.isSafeInteger(input.orderId)||input.orderId<0)throw fail(400,'Choose a valid pending order.');
      const order=orderView(await broker('/equity/orders/'+input.orderId,ctx.secret));current(id,ctx);
      if(order.id!==input.orderId||!activeStatuses.includes(order.status))throw fail(409,'This order is no longer cancellable. Refresh orders.');
      return {action:'CANCEL',orderId:order.id,order,environment:ctx.a.environment,brokerId:ctx.a.snapshot.brokerId,currency:ctx.a.snapshot.currency};
    }
    const {summary,positions,at}=await freshBalances(id,ctx);
    if(!['BUY','SELL'].includes(input.side)||!['MARKET','LIMIT'].includes(input.type))throw fail(400,'Choose Buy or Sell and Market or Limit.');
    const instrument=(await catalog(id,ctx)).find(r=>r.ticker===input.ticker);
    if(!instrument)throw fail(400,'Choose an exact stock or ETF from the broker instrument list.');
    if(instrument.currency!==summary.currency)throw fail(400,'Trading here currently requires the instrument and primary account currency to match. Use Trading 212 for currency conversion orders.');
    if(input.extendedHours!==undefined&&typeof input.extendedHours!=='boolean')throw fail(400,'Choose a valid trading session.');
    if(input.extendedHours===true&&input.type!=='MARKET')throw fail(400,'The API supports selecting extended sessions for market orders only. Use Trading 212 for an overnight limit order.');
    if(input.extendedHours===true&&!instrument.extendedHours)throw fail(400,'The broker has not marked this instrument as eligible for extended sessions.');
    if(input.type==='LIMIT'&&(!numeric(input.limitPrice)||input.limitPrice<=0||input.limitPrice>10000000))throw fail(400,'Enter a positive limit price in the account currency.');
    if(input.type==='LIMIT'&&input.timeValidity!==undefined&&!['DAY','GOOD_TILL_CANCEL'].includes(input.timeValidity))throw fail(400,'Choose a valid order duration.');
    if(!Array.isArray(positions))throw fail(502,'Available shares could not be checked.');
    const position=positions.find(p=>p.instrument?.ticker===instrument.ticker),holding=holdingDetails(position,summary.currency,instrument.currency),available=holding.availableShares;
    const pricing=input.type==='MARKET'?await referencePrice(instrument,holding,at):null;current(id,ctx);
    const reference=input.type==='LIMIT'?input.limitPrice:pricing.price;
    // Convert the cash intent only at preview. The persisted review and submit
    // use its fixed share quantity, never silently resize a confirmed order.
    const cashInput=input.cashAmount!==undefined;
    if(cashInput&&(!numeric(input.cashAmount)||input.cashAmount<=0||input.cashAmount>1e12))throw fail(400,'Enter a positive cash amount.');
    if(!(reference>0)&&(cashInput||input.type==='MARKET'&&(input.requestedCashAmount!=null||input.referencePrice!=null)))throw fail(400,'A current market reference price is unavailable. Refresh the quote and review again.');
    const quantityPrecision=orderQuantityPrecision(quantityRules(id),input);
    const requestedQuantity=cashInput?null:quantity(input.quantity);
    if(input.sellAll!==undefined&&typeof input.sellAll!=='boolean')throw fail(400,'Choose a valid sell-all quantity.');
    if(input.sellAll===true&&(input.side!=='SELL'||cashInput))throw fail(400,'Sell all requires a sell order with an exact share quantity.');
    if(input.sellAll===true&&requestedQuantity!==available)throw fail(409,'Available shares changed. Select 100% again and review the new quantity. No order was sent.');
    // At preview, only equality with broker-supplied available shares permits
    // exact sizing. Freeze that intent with the review; never promote a partial
    // review or resize an existing full-sale review at confirmation.
    const sellAll=input.side==='SELL'&&!cashInput&&requestedQuantity===available&&(normalize||input.sellAll===true);
    const rounded=sellAll?exactOrderQuantity(requestedQuantity):cashInput?cashOrderQuantity(input.cashAmount,reference,quantityPrecision):roundedOrderQuantity(requestedQuantity,quantityPrecision);
    if(!rounded)throw fail(400,`Use the ${10**-quantityPrecision} share sizing step, with a maximum of 1,000,000 shares. Adjust the quantity or cash amount.`);
    const qty=Number(rounded);
    if(!normalize&&qty!==input.quantity)throw fail(409,'The share precision changed. Review the adjusted quantity before confirming again.');
    if(input.side==='SELL'&&(!numeric(available)||qty>available))throw fail(400,'The quantity exceeds shares available to trade. Shares reserved for orders or pies may be unavailable.');
    if(input.side==='BUY'&&instrument.maxOpenQuantity!==null&&qty+(position?.quantity||0)>instrument.maxOpenQuantity)throw fail(400,'This exceeds the broker’s maximum position size.');
    const estimate=reference===null?null:qty*reference;
    const maxOrderValue=orderLimit(id,estimate,summary.currency);
    if(input.side==='BUY'&&(summary.cash.availableToTrade<=0||estimate!==null&&estimate>summary.cash.availableToTrade+1e-8))throw fail(400,'Not enough available cash for this order estimate.');
    const marketCashLimit=input.side==='BUY'&&input.type==='MARKET'?marketBuyCashLimit(summary.cash.availableToTrade):null;
    const saleCost=input.side==='SELL'&&holding.cost!==null&&holding.shares>0?holding.cost*qty/holding.shares:null;
    const estimatedProfit=estimate!==null&&saleCost!==null?estimate-saleCost:null;
    return {action:'ORDER',maxOrderValue,marketCashLimit,side:input.side,type:input.type,...(input.type==='MARKET'?{extendedHours:input.extendedHours===true}:{}),ticker:instrument.ticker,name:instrument.name,quantity:qty,quantityPrecision,sellAll,requestedQuantity:requestedQuantity!==null&&requestedQuantity!==qty?requestedQuantity:null,requestedCashAmount:cashInput?input.cashAmount:null,limitPrice:input.type==='LIMIT'?input.limitPrice:null,timeValidity:input.timeValidity==='GOOD_TILL_CANCEL'?'GOOD_TILL_CANCEL':'DAY',currency:summary.currency,availableCash:summary.cash.availableToTrade,availableShares:numeric(available)?available:null,referencePrice:reference,priceQuote:pricing?.priceQuote||null,estimate,
      currentShares:holding.shares,remainingShares:holding.shares===null?null:holding.shares+(input.side==='BUY'?qty:-qty),remainingCash:estimate===null?null:summary.cash.availableToTrade+(input.side==='SELL'?estimate:-estimate),estimatedProfit,estimatedProfitPercent:saleCost>0&&estimatedProfit!==null?estimatedProfit/saleCost*100:null,
      environment:ctx.a.environment,brokerId:ctx.a.snapshot.brokerId};
  }
  async function exclusive(id,fn){if(locks.has(id))throw fail(409,'An order operation is already running for this account.');locks.add(id);try{return await fn();}finally{locks.delete(id);}}
  async function preview(id,input){return exclusive(id,async()=>{
    const ctx=context(id);if(unresolved(id))throw fail(409,'Check the uncertain order in Trading 212 and mark it reviewed before submitting another order.');
    const detail=await validate(id,input,ctx,true);current(id,ctx);const token=randomUUID(),at=now();
    // A fresh review replaces unsent reviews from other tabs for this account.
    db.prepare("DELETE FROM portfolio_order_attempts WHERE account_id=? AND state='PREPARED'").run(id);
    db.prepare('INSERT INTO portfolio_order_attempts VALUES(?,?,?,?,?,?)').run(token,id,ctx.record.generation,at,'PREPARED',JSON.stringify({...detail,expiresAt:at+60000}));return publicAttempt(saved(token));
  });}
  async function submit(id,input){return exclusive(id,async()=>{
    if(typeof input?.token!=='string')throw fail(400,'A valid order review is required.');
    const ctx=context(id),row=saved(input.token);
    if(!row||row.account_id!==id||row.generation!==ctx.record.generation)throw fail(409,'This review does not belong to the current connection.');
    if(row.state!=='PREPARED')return publicAttempt(row);
    if(input.confirmed!==true)throw fail(400,'Review and confirm this exact order.');
    if(row.detail.expiresAt<=now())throw fail(409,'The review expired. Review the order again.');
    if(unresolved(id))throw fail(409,'Resolve the uncertain order before submitting another one.');
    if(row.detail.action!=='CANCEL'&&getOrderLimit(id)!==null)balances.invalidate(id); // Reprice a capped order immediately before submission.
    await validate(id,row.detail,ctx);current(id,ctx);
    if(row.detail.expiresAt<=now())throw fail(409,'The review expired. Review the order again.');
    const d=row.detail;balances.invalidate(id);update(row.token,'SENDING',d);
    let result;
    try{
      if(d.action==='CANCEL'){await broker('/equity/orders/'+d.orderId,ctx.secret,{method:'DELETE'});result={...d,message:'Cancellation requested. Orders will refresh automatically to check the final result; a fill may have happened first.'};}
      else{const body={ticker:d.ticker,quantity:d.quantity*(d.side==='SELL'?-1:1),...(d.type==='LIMIT'?{limitPrice:d.limitPrice,timeValidity:d.timeValidity}:{extendedHours:d.extendedHours===true})};
        const order=orderView(await broker('/equity/orders/'+d.type.toLowerCase(),ctx.secret,{method:'POST',body}));
        if(order.ticker!==d.ticker||order.side!==d.side||order.type!==d.type||!numeric(order.quantity)||(d.sellAll?order.quantity!==d.quantity:Math.abs(order.quantity-d.quantity)>1e-8))throw fail(502,'The broker reply does not match the submitted order. Check Trading 212.');
        if(d.type==='MARKET'&&order.extendedHours!==null&&order.extendedHours!==(d.extendedHours===true))throw fail(502,'The broker reply has a different trading session. Check Trading 212.');
        result={...d,order,message:order.status==='FILLED'?'Order filled.':order.status==='REJECTED'?'Order rejected by Trading 212.':'Order received by Trading 212. Its status will update automatically.'};}
    }catch(error){balances.invalidate(id);const state=error.definite?'REJECTED':'UNKNOWN',detail={...d,...(error.definite?{brokerStatus:error.upstreamStatus,brokerCode:error.brokerCode||null}:{}),message:error.definite?error.message:'The result is uncertain. Do not repeat this order. Check orders and trade history in Trading 212, then mark this attempt reviewed.'};if(!isClosed()){update(row.token,state,detail);if(state==='REJECTED')try{onRejected?.(id,ctx.record.generation,{...detail,token:row.token});}catch{}}return {token:row.token,state,...detail};}
    // Persist the broker receipt before local tracking/notification work. A
    // failed follow-up cannot turn an accepted order into an uncertain one.
    balances.invalidate(id);
    const state=result.order?.status==='REJECTED'?'REJECTED':'ACCEPTED';
    if(!isClosed()){
      update(row.token,state,result);
      try{tracker.record(id,ctx,result.order||d.order);}catch{try{tracker.deferRestore(id,ctx);}catch{}result.trackingMessage='Order status is saved; automatic tracking will retry.';}
    }
    return {token:row.token,state,...result};
  });}
  function acknowledge(id,input){context(id,false);const row=saved(input.token);if(!row||row.account_id!==id||row.state!=='UNKNOWN'||input.checkedBroker!==true)throw fail(400,'Confirm you checked this attempt in Trading 212.');update(row.token,'REVIEWED',{...row.detail,message:'Marked reviewed after checking Trading 212. This does not assert an execution outcome.'});return read(id);}
  function assertIdle(id){if(locks.has(id))throw fail(409,'Wait for the current order operation before changing this account.');}
  function remove(id){assertIdle(id);catalogs.delete(id);balances.remove(id);tracker.remove(id);db.prepare('DELETE FROM portfolio_trading_settings WHERE account_id=?').run(id);db.prepare('DELETE FROM portfolio_order_attempts WHERE account_id=?').run(id);}
  return {read,attempt,configure,search,pending,monitor,tracking,position,preview,submit,acknowledge,assertIdle,remove};
}
