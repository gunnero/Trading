import {randomUUID} from 'node:crypto';
import {cashOrderQuantity} from '../src/data/portfolio-order-size.mjs';
import {orderHistoryPath} from './portfolio-history.mjs';
import {createOrderTracker} from './portfolio-order-tracker.mjs';

const fail=(status,message)=>Object.assign(Error(message),{status});
const bases={live:'https://live.trading212.com/api/v0',demo:'https://demo.trading212.com/api/v0'};
const activeStatuses=['LOCAL','UNCONFIRMED','CONFIRMED','NEW','PARTIALLY_FILLED','REPLACING'];
const terminalStatuses=['CANCELLED','FILLED','REJECTED','REPLACED'];
const numeric=value=>typeof value==='number'&&Number.isFinite(value);
function quantity(value){if(!numeric(value)||value<=0||value>1000000||Number(value.toFixed(8))!==value)throw fail(400,'Enter a positive share quantity with up to 8 decimal places.');return value;}
function orderView(order){
  const ticker=order?.instrument?.ticker||order?.ticker;
  if(!Number.isSafeInteger(order?.id)||order.id<0||typeof ticker!=='string'||!['BUY','SELL'].includes(order.side)||!['MARKET','LIMIT','STOP','STOP_LIMIT'].includes(order.type)||![...activeStatuses,...terminalStatuses,'CANCELLING'].includes(order.status)||(!numeric(order.quantity)&&!(order.strategy==='VALUE'&&numeric(order.value))))throw fail(502,'The broker returned an incomplete order. Check Trading 212.');
  return {id:order.id,ticker,name:order.instrument?.name||ticker,side:order.side,type:order.type,status:order.status,quantity:numeric(order.quantity)?Math.abs(order.quantity):null,value:numeric(order.value)?Math.abs(order.value):null,filledQuantity:numeric(order.filledQuantity)?Math.abs(order.filledQuantity):null,limitPrice:order.limitPrice??null,currency:order.currency||order.instrument?.currency,createdAt:order.createdAt||null};
}

export function createPortfolioTrading(db,{now,credential,decode,account,isClosed,fetcher=fetch,timeoutMs=10000,onBalances}){
  db.exec(`CREATE TABLE IF NOT EXISTS portfolio_trading_settings(account_id TEXT PRIMARY KEY,generation TEXT NOT NULL,enabled INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS portfolio_order_attempts(token TEXT PRIMARY KEY,account_id TEXT NOT NULL,generation TEXT NOT NULL,created_at INTEGER NOT NULL,state TEXT NOT NULL,detail TEXT NOT NULL);`);
  // A process may have died after sending an order and before saving its reply.
  db.prepare("UPDATE portfolio_order_attempts SET state='UNKNOWN' WHERE state='SENDING'").run();
  const catalogs=new Map(),balances=new Map(),locks=new Set(),readBackoff=new Map();
  const tracker=createOrderTracker(db,{now,broker,current,orderView,refreshBalances:async(id,ctx)=>{
    balances.delete(id);const fresh=await freshBalances(id,ctx);current(id,ctx);
    if(onBalances)await onBalances(id,fresh,ctx.record.generation);
  }});
  const saved=token=>{const row=db.prepare('SELECT * FROM portfolio_order_attempts WHERE token=?').get(token);return row?{...row,detail:JSON.parse(row.detail)}:null;};
  const settings=id=>db.prepare('SELECT * FROM portfolio_trading_settings WHERE account_id=?').get(id);
  const enabled=id=>{const record=credential(id),s=settings(id);return !!record&&s?.generation===record.generation&&s.enabled===1;};
  const unresolved=id=>db.prepare("SELECT token FROM portfolio_order_attempts WHERE account_id=? AND state IN ('UNKNOWN','SENDING') LIMIT 1").get(id);
  const update=(token,state,detail)=>db.prepare('UPDATE portfolio_order_attempts SET state=?,detail=? WHERE token=?').run(state,JSON.stringify(detail),token);
  const publicAttempt=row=>({token:row.token,state:row.state,createdAt:row.created_at,...row.detail});
  function read(id){const a=account(id);return {enabled:enabled(id),environment:a.environment,brokerId:a.snapshot?.brokerId||null,blocked:!!unresolved(id),attempts:db.prepare("SELECT * FROM portfolio_order_attempts WHERE account_id=? AND state<>'PREPARED' ORDER BY created_at DESC LIMIT 30").all(id).map(row=>publicAttempt({...row,detail:JSON.parse(row.detail)}))};}
  function context(id,requireEnabled=true){
    const a=account(id),record=credential(id);
    if(!record||a.platform!=='Trading 212'||a.snapshot?.source!=='api')throw fail(400,'Connect this Trading 212 account first.');
    if(requireEnabled&&!enabled(id))throw fail(403,'Enable trading for this account first.');
    return {a,record,secret:decode(record,id)};
  }
  function current(id,ctx){if(isClosed()||credential(id)?.generation!==ctx.record.generation||!enabled(id))throw fail(409,'The account connection or trading permission changed. Review a new order.');}
  async function broker(path,secret,{method='GET',body}={}){
    const allowed=method==='GET'&&(path==='/equity/account/summary'||path==='/equity/positions'||path==='/equity/metadata/instruments'||path==='/equity/orders'||/^\/equity\/orders\/\d+$/.test(path)||path.startsWith('/equity/history/orders?')&&orderHistoryPath(path)===path)||method==='POST'&&['/equity/orders/market','/equity/orders/limit'].includes(path)||method==='DELETE'&&/^\/equity\/orders\/\d+$/.test(path);
    if(!allowed||!bases[secret.environment])throw fail(400,'Unsupported trading request.');
    try{
      const res=await fetcher(bases[secret.environment]+path,{method,redirect:'error',signal:AbortSignal.timeout(timeoutMs),headers:{Accept:'application/json',Authorization:'Basic '+Buffer.from(secret.apiKey+':'+secret.apiSecret).toString('base64'),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
      if(!res.ok){const error=fail(502,res.status===403?'Trading 212 denied access. Enable Metadata, Orders: Read and Orders: Execute permissions for this account.':res.status===400?'Trading 212 rejected the order parameters. Check quantity, cash, price and instrument restrictions.':res.status===429?'Trading 212 is rate limiting requests. Wait before trying again.':res.status===401?'Trading 212 rejected the API credentials. Reconnect this account.':'Trading 212 could not confirm this request.');error.definite=[400,401,403,404,429].includes(res.status);error.upstreamStatus=res.status;throw error;}
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
    const raw=await broker('/equity/metadata/instruments',ctx.secret);current(id,ctx);
    if(!Array.isArray(raw)||raw.length>40000)throw fail(502,'The broker instrument list is unavailable.');
    const items=raw.filter(r=>['STOCK','ETF'].includes(r.type)&&typeof r.ticker==='string'&&/^[A-Za-z0-9._-]{1,80}$/.test(r.ticker)&&typeof r.name==='string'&&/^[A-Z]{3}$/.test(r.currencyCode)).map(r=>({ticker:r.ticker,name:r.name.slice(0,160),currency:r.currencyCode,type:r.type,isin:r.isin||'',maxOpenQuantity:numeric(r.maxOpenQuantity)?r.maxOpenQuantity:null}));
    catalogs.delete(id);catalogs.set(id,{generation:ctx.record.generation,until:now()+3600000,items});
    while(catalogs.size>4)catalogs.delete(catalogs.keys().next().value);
    return items;
  }
  async function search(id,q){const ctx=context(id);if(typeof q!=='string'||q.length<2||q.length>80)return {items:[]};const query=q.toLowerCase();return {items:(await catalog(id,ctx)).filter(r=>(r.name+' '+r.ticker+' '+r.isin).toLowerCase().includes(query)).slice(0,40)};}
  async function pending(id){return exclusive(id,()=>{
    const ctx=context(id);
    // Continue accepted attempts made before order tracking was introduced.
    const attempts=db.prepare("SELECT detail FROM portfolio_order_attempts WHERE account_id=? AND generation=? AND state IN ('ACCEPTED','REJECTED') ORDER BY created_at DESC LIMIT 100").all(id,ctx.record.generation).map(row=>JSON.parse(row.detail)).filter(detail=>detail.order).map(detail=>orderView(detail.order));
    tracker.restore(id,ctx,attempts);
    return tracker.poll(id,ctx);
  });}
  async function freshBalances(id,ctx){
    let fresh=balances.get(id);
    if(!fresh||fresh.generation!==ctx.record.generation||now()-fresh.at>5000){
      const at=now(),summary=await broker('/equity/account/summary',ctx.secret);current(id,ctx);
      const positions=await broker('/equity/positions',ctx.secret);current(id,ctx);
      fresh={at,summary,positions,generation:ctx.record.generation};balances.set(id,fresh);
    }
    const {summary,positions}=fresh;
    if(String(summary?.id)!==ctx.a.snapshot.brokerId||summary.currency!==ctx.a.snapshot.currency||!numeric(summary.cash?.availableToTrade))throw fail(409,'The broker account identity or currency changed. Reconnect before trading.');
    if(!Array.isArray(positions))throw fail(502,'Available shares could not be checked.');
    return fresh;
  }
  async function position(id,ticker){return exclusive(id,async()=>{
    const ctx=context(id);
    if(typeof ticker!=='string'||!/^[A-Za-z0-9._-]{1,80}$/.test(ticker))throw fail(400,'Choose a valid broker instrument.');
    const instrument=(await catalog(id,ctx)).find(item=>item.ticker===ticker);
    if(!instrument)throw fail(400,'Choose an exact stock or ETF from the broker instrument list.');
    const {summary,positions,at}=await freshBalances(id,ctx);current(id,ctx);
    const holding=positions.find(item=>item.instrument?.ticker===ticker);
    return {ticker,currency:summary.currency,instrumentCurrency:instrument.currency,...holdingDetails(holding,summary.currency,instrument.currency),availableCash:summary.cash.availableToTrade,checkedAt:at};
  });}
  function holdingDetails(holding,currency,instrumentCurrency){
    const nonnegative=value=>numeric(value)&&value>=0?value:null;
    const shares=holding?nonnegative(holding.quantity):0,available=holding?nonnegative(holding.quantityAvailableForTrading):0;
    const wallet=holding?.walletImpact?.currency===currency?holding.walletImpact:null,cost=holding?nonnegative(wallet?.totalCost):0;
    const profit=holding&&numeric(wallet?.unrealizedProfitLoss)?wallet.unrealizedProfitLoss:null;
    const priceMatch=holding?.instrument?.currency===instrumentCurrency;
    return {shares,availableShares:available!==null&&shares!==null&&available<=shares?available:null,value:holding?nonnegative(wallet?.currentValue):0,
      price:priceMatch?nonnegative(holding.currentPrice):null,averagePrice:priceMatch?nonnegative(holding.averagePricePaid):null,cost,unrealized:profit,unrealizedPercent:profit!==null&&cost>0?profit/cost*100:null};
  }
  async function validate(id,input,ctx){
    const {summary,positions}=await freshBalances(id,ctx);
    if(input.action==='CANCEL'){
      if(!Number.isSafeInteger(input.orderId)||input.orderId<0)throw fail(400,'Choose a valid pending order.');
      const order=orderView(await broker('/equity/orders/'+input.orderId,ctx.secret));current(id,ctx);
      if(order.id!==input.orderId||!activeStatuses.includes(order.status))throw fail(409,'This order is no longer cancellable. Refresh orders.');
      return {action:'CANCEL',orderId:order.id,order,environment:ctx.a.environment,brokerId:ctx.a.snapshot.brokerId,currency:summary.currency};
    }
    if(!['BUY','SELL'].includes(input.side)||!['MARKET','LIMIT'].includes(input.type))throw fail(400,'Choose Buy or Sell and Market or Limit.');
    const instrument=(await catalog(id,ctx)).find(r=>r.ticker===input.ticker);
    if(!instrument)throw fail(400,'Choose an exact stock or ETF from the broker instrument list.');
    if(instrument.currency!==summary.currency)throw fail(400,'Trading here currently requires the instrument and primary account currency to match. Use Trading 212 for currency conversion orders.');
    if(input.type==='LIMIT'&&(!numeric(input.limitPrice)||input.limitPrice<=0||input.limitPrice>10000000))throw fail(400,'Enter a positive limit price in the account currency.');
    if(input.type==='LIMIT'&&input.timeValidity!==undefined&&!['DAY','GOOD_TILL_CANCEL'].includes(input.timeValidity))throw fail(400,'Choose a valid order duration.');
    if(!Array.isArray(positions))throw fail(502,'Available shares could not be checked.');
    const position=positions.find(p=>p.instrument?.ticker===instrument.ticker),holding=holdingDetails(position,summary.currency,instrument.currency),available=holding.availableShares;
    const reference=input.type==='LIMIT'?input.limitPrice:holding.price>0?holding.price:null;
    // Convert the cash intent only at preview. The persisted review and submit
    // use its fixed share quantity, never silently resize a confirmed order.
    const cashInput=input.cashAmount!==undefined;
    if(cashInput&&(!numeric(input.cashAmount)||input.cashAmount<=0||input.cashAmount>1e12))throw fail(400,'Enter a positive cash amount.');
    if(cashInput&&!(reference>0))throw fail(400,'A current broker price or limit price is required to size a cash amount.');
    const qty=quantity(cashInput?Number(cashOrderQuantity(input.cashAmount,reference)):input.quantity);
    if(input.side==='SELL'&&(!numeric(available)||qty>available+1e-9))throw fail(400,'The quantity exceeds shares available to trade. Shares reserved for orders or pies may be unavailable.');
    if(input.side==='BUY'&&instrument.maxOpenQuantity!==null&&qty+(position?.quantity||0)>instrument.maxOpenQuantity)throw fail(400,'This exceeds the broker’s maximum position size.');
    const estimate=reference===null?null:qty*reference;
    if(input.side==='BUY'&&(summary.cash.availableToTrade<=0||estimate!==null&&estimate>summary.cash.availableToTrade+1e-8))throw fail(400,'Not enough available cash for this order estimate.');
    const saleCost=input.side==='SELL'&&holding.cost!==null&&holding.shares>0?holding.cost*qty/holding.shares:null;
    const estimatedProfit=estimate!==null&&saleCost!==null?estimate-saleCost:null;
    return {action:'ORDER',side:input.side,type:input.type,ticker:instrument.ticker,name:instrument.name,quantity:qty,requestedCashAmount:cashInput?input.cashAmount:null,limitPrice:input.type==='LIMIT'?input.limitPrice:null,timeValidity:input.timeValidity==='GOOD_TILL_CANCEL'?'GOOD_TILL_CANCEL':'DAY',currency:summary.currency,availableCash:summary.cash.availableToTrade,availableShares:numeric(available)?available:null,referencePrice:reference,estimate,
      currentShares:holding.shares,remainingShares:holding.shares===null?null:holding.shares+(input.side==='BUY'?qty:-qty),remainingCash:estimate===null?null:summary.cash.availableToTrade+(input.side==='SELL'?estimate:-estimate),estimatedProfit,estimatedProfitPercent:saleCost>0&&estimatedProfit!==null?estimatedProfit/saleCost*100:null,
      environment:ctx.a.environment,brokerId:ctx.a.snapshot.brokerId};
  }
  async function exclusive(id,fn){if(locks.has(id))throw fail(409,'An order operation is already running for this account.');locks.add(id);try{return await fn();}finally{locks.delete(id);}}
  async function preview(id,input){return exclusive(id,async()=>{
    const ctx=context(id);if(unresolved(id))throw fail(409,'Check the uncertain order in Trading 212 and mark it reviewed before submitting another order.');
    const detail=await validate(id,input,ctx);current(id,ctx);const token=randomUUID(),at=now();
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
    await validate(id,row.detail,ctx);current(id,ctx);
    if(row.detail.expiresAt<=now())throw fail(409,'The review expired. Review the order again.');
    const d=row.detail;balances.delete(id);update(row.token,'SENDING',d);
    try{
      let result;
      if(d.action==='CANCEL'){await broker('/equity/orders/'+d.orderId,ctx.secret,{method:'DELETE'});tracker.record(id,ctx,d.order);result={...d,message:'Cancellation requested. Orders will refresh automatically to check the final result; a fill may have happened first.'};}
      else{const body={ticker:d.ticker,quantity:d.quantity*(d.side==='SELL'?-1:1),...(d.type==='LIMIT'?{limitPrice:d.limitPrice,timeValidity:d.timeValidity}:{extendedHours:false})};
        const order=orderView(await broker('/equity/orders/'+d.type.toLowerCase(),ctx.secret,{method:'POST',body}));
        if(order.ticker!==d.ticker||order.side!==d.side||order.type!==d.type||!numeric(order.quantity)||Math.abs(order.quantity-d.quantity)>1e-8)throw fail(502,'The broker reply does not match the submitted order. Check Trading 212.');
        tracker.record(id,ctx,order);
        result={...d,order,message:order.status==='FILLED'?'Order filled.':order.status==='REJECTED'?'Order rejected by Trading 212.':'Order received by Trading 212. Its status will update automatically.'};}
      const state=result.order?.status==='REJECTED'?'REJECTED':'ACCEPTED';if(!isClosed())update(row.token,state,result);return {token:row.token,state,...result};
    }catch(error){const state=error.definite?'REJECTED':'UNKNOWN',detail={...d,message:error.definite?error.message:'The result is uncertain. Do not repeat this order. Check orders and trade history in Trading 212, then mark this attempt reviewed.'};if(!isClosed())update(row.token,state,detail);return {token:row.token,state,...detail};}
  });}
  function acknowledge(id,input){context(id,false);const row=saved(input.token);if(!row||row.account_id!==id||row.state!=='UNKNOWN'||input.checkedBroker!==true)throw fail(400,'Confirm you checked this attempt in Trading 212.');update(row.token,'REVIEWED',{...row.detail,message:'Marked reviewed after checking Trading 212. This does not assert an execution outcome.'});return read(id);}
  function assertIdle(id){if(locks.has(id))throw fail(409,'Wait for the current order operation before changing this account.');}
  function remove(id){assertIdle(id);catalogs.delete(id);balances.delete(id);tracker.remove(id);db.prepare('DELETE FROM portfolio_trading_settings WHERE account_id=?').run(id);db.prepare('DELETE FROM portfolio_order_attempts WHERE account_id=?').run(id);}
  return {read,configure,search,pending,position,preview,submit,acknowledge,assertIdle,remove};
}
