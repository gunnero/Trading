import {ArrowsClockwise,CaretDown} from '@phosphor-icons/react';
import {portfolioListing} from './data/portfolio-listings.mjs';
import {StockHours} from './PortfolioHours';
import {useEffect,useRef,useState} from 'react';
import {apiFetch} from './auth-client';
import {useDisplayTime} from './DisplayTime';
import {cashOrderQuantity,cashPercentage,orderPercentage,roundedOrderQuantity,orderQuantityPrecision,marketBuyCashLimit,sellRemainder,exactOrderQuantity} from './data/portfolio-order-size.mjs';
import {portfolioOrderLevels} from './data/portfolio-order-levels.mjs';

const money=(value,currency)=>Number.isFinite(value)&&currency?new Intl.NumberFormat('en-US',{style:'currency',currency}).format(value):'—';
const priceMoney=(value,currency)=>Number.isFinite(value)&&currency?new Intl.NumberFormat('en-US',{style:'currency',currency,maximumFractionDigits:8}).format(value):'—';
const shares=value=>Number.isFinite(value)?new Intl.NumberFormat('en-US',{maximumFractionDigits:8}).format(value):'—';
const percent=value=>Number.isFinite(value)?`${value>0?'+':''}${value.toFixed(2)}%`:'—';
const tone=value=>value>0?'green':value<0?'red':'';
const sessionLabel=order=>order.extendedHours===true?'Extended sessions · 24/5 where available':order.extendedHours===false?'Regular hours only':'Session not reported by broker';
const statusLabel=status=>({NEW:'Pending',LOCAL:'Pending',UNCONFIRMED:'Pending',CONFIRMED:'Pending',PARTIALLY_FILLED:'Partially filled',FILLED:'Filled',CANCELLED:'Cancelled',REJECTED:'Rejected',REPLACING:'Replacing',REPLACED:'Replaced',CANCELLING:'Cancelling'}[status]||status);
const finalStatuses=new Set(['FILLED','CANCELLED','REJECTED','REPLACED']);
const recoveryKey=id=>'opening-bell.order-check.'+id;
function SellRejectionHelp({attempt}){
  if(attempt?.side!=='SELL')return null;
  if(attempt.sellAll&&attempt.brokerCode==='quantity-precision-mismatch')return <p>Trading 212 rejected the exact sell-all quantity shown above. The app sent it without rounding and has not retried the order.</p>;
  return attempt.brokerCode==='min-opened-position-exceeded'?<p>The broker rejected the remaining position that this partial sale would leave. To review all available shares without rounding, select 100%. This order has not been retried.</p>:null;
}
function savedConfirmation(id){try{const token=localStorage.getItem(recoveryKey(id));return typeof token==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(token)?token:null;}catch{return null;}}
async function request(id,path='',body,signal){
  const requestSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(25000)]):AbortSignal.timeout(25000);
  let res;
  try{res=await apiFetch(`/api/portfolio/accounts/${id}/trading${path}`,{method:body===undefined?'GET':'POST',signal:requestSignal,headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json','X-Opening-Bell-Client':'web'})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
  catch(error){if(signal?.aborted||error.auth)throw error;throw Object.assign(Error(requestSignal.aborted?'The trading request timed out. Refresh to check its status.':'The trading service could not be reached. Check your connection and refresh.'),{transientRead:true});}
  const retryHeader=res.headers.get('retry-after'),retryDelay=retryHeader?(Number.isFinite(Number(retryHeader))?Number(retryHeader)*1000:Date.parse(retryHeader)-Date.now()):0;
  const retryAfterMs=Number.isFinite(retryDelay)?Math.min(86400000,Math.max(0,retryDelay)):0;
  const reference=name=>{const value=res.headers.get(name);return value&&/^[a-zA-Z0-9-]{1,80}$/.test(value)?value:null;};
  const details={status:res.status,requestId:reference('x-opening-bell-request-id'),ray:reference('cf-ray')};
  const gateway=()=>Object.assign(Error(`The holding service connection was interrupted (HTTP ${res.status}).`),{...details,transientRead:[502,503,504,520,521,522,523,524].includes(res.status),retryAfterMs});
  let data;
  try{data=await res.json();if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Invalid response');}
  catch{if(path.startsWith('/position?')&&res.status>=500)throw gateway();throw Object.assign(Error(`The trading service returned an unreadable response (HTTP ${res.status}). Refresh to try again.`),details);}
  if(!res.ok){if(path.startsWith('/position?')&&res.status>=500&&!data.message)throw gateway();throw Object.assign(Error(data.message||'The trading request could not be completed.'),{...details,retryAfterMs:Math.max(retryAfterMs||0,Number.isFinite(data.retryAfterMs)?data.retryAfterMs:0)});}return data;
}
export function PortfolioTrading({account,owner,initialHolding,initialSide='BUY',sheet,watchlist,onPortfolioChange}){
  const [state,setState]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[authorized,setAuthorized]=useState(false),[query,setQuery]=useState(initialHolding?.ticker||''),[matches,setMatches]=useState(null),[instrument,setInstrument]=useState(null),[side,setSide]=useState(initialSide),[type,setType]=useState('MARKET'),[quantity,setQuantity]=useState(''),[limit,setLimit]=useState(''),[validity,setValidity]=useState('DAY'),[review,setReview]=useState(null),[confirmed,setConfirmed]=useState(false),[result,setResult]=useState(null),[orders,setOrders]=useState(null),[checkedAttempt,setCheckedAttempt]=useState(null),[now,setNow]=useState(Date.now());
  const [linkedTicker,setLinkedTicker]=useState(initialHolding?.ticker||null),[searchError,setSearchError]=useState('');
  const searchInput=useRef(null);
  const {clockStamp,zoneLabel}=useDisplayTime(),id=account.id;
  const [recoveryToken,setRecoveryToken]=useState(()=>savedConfirmation(id)),[recoveryError,setRecoveryError]=useState(''),[recoveryAttempt,setRecoveryAttempt]=useState(null),[recoveryMissing,setRecoveryMissing]=useState(false),[recoveryChecked,setRecoveryChecked]=useState(false),[recoveryRefresh,setRecoveryRefresh]=useState(0);
  const orderBlocked=state?.blocked||!!recoveryToken;
  function rememberConfirmation(token){try{localStorage.setItem(recoveryKey(id),token);}catch{/* Keep the current page blocked even if browser storage is unavailable. */}setRecoveryToken(token);setRecoveryError('');setRecoveryAttempt(null);setRecoveryMissing(false);setRecoveryChecked(false);}
  function clearConfirmation(token){try{if(localStorage.getItem(recoveryKey(id))===token)localStorage.removeItem(recoveryKey(id));}catch{}setRecoveryToken(current=>current===token?null:current);setRecoveryError('');setRecoveryAttempt(null);setRecoveryMissing(false);setRecoveryChecked(false);}
  useEffect(()=>{const changed=event=>{if(event.key===null||event.key===recoveryKey(id)){setRecoveryToken(savedConfirmation(id));setRecoveryAttempt(null);setRecoveryMissing(false);setRecoveryChecked(false);}};window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed);},[id]);
  const [holdingState,setHoldingState]=useState(null),[holdingRefresh,setHoldingRefresh]=useState(0),[preset,setPreset]=useState(null),[fullSaleIntent,setFullSaleIntent]=useState(false);
  const [sizeMode,setSizeMode]=useState('shares'),[cashAmount,setCashAmount]=useState(''),[levelChoice,setLevelChoice]=useState(''),[trackingError,setTrackingError]=useState('');
  const synced=useRef(null),trackingBusy=useRef(false),submittedDraft=useRef(null),currentDraft=useRef(null);
  const ticker=instrument?.ticker;
  currentDraft.current={id,ticker,side,sizeMode,quantity,cashAmount};
  function acceptResult(outcome){
    setResult(outcome);
    if(outcome.state==='ACCEPTED'&&outcome.action==='ORDER'){
      setHoldingState(previous=>previous?.id===id?{...previous,loading:true}:previous);setHoldingRefresh(value=>value+1);
    }
    const draft=submittedDraft.current;
    if(outcome.state==='ACCEPTED'&&outcome.action==='ORDER'&&draft?.token===outcome.token){
      if(Object.entries(currentDraft.current).every(([key,value])=>draft[key]===value)){
        setQuantity('');setCashAmount('');setPreset(null);setFullSaleIntent(false);
      }
      submittedDraft.current=null;
    }
  }
  const [sessionChoice,setSessionChoice]=useState('extended');
  const extendedHours=type==='MARKET'&&instrument?.extendedHours===true&&sessionChoice==='extended';
  useEffect(()=>setSessionChoice('extended'),[id,ticker]);
  useEffect(()=>{setQuantity('');setCashAmount('');setPreset(null);setFullSaleIntent(false);},[id,ticker,side]);
  useEffect(()=>{setLimit('');setLevelChoice('');},[id,ticker]);
  useEffect(()=>{
    if(!state?.enabled||!ticker||busy||review)return;
    let active=true,controller,retry,timer;
    function schedule(delay=60000){
      clearTimeout(timer);timer=setTimeout(()=>{if(document.hidden)schedule();else load();},delay);
    }
    async function load(attempt=0){
      if(controller&&!controller.signal.aborted)controller.abort();
      controller=new AbortController();const signal=controller.signal;
      setHoldingState(previous=>({id,ticker,loading:true,data:previous?.id===id&&previous?.ticker===ticker?previous.data:undefined}));setPreset(null);
      try{const data=await request(id,'/position?'+new URLSearchParams({ticker}),undefined,signal);if(active&&!signal.aborted){setHoldingState({id,ticker,data});schedule(Number.isFinite(data.priceQuote?.validUntil)?Math.max(5000,Math.min(60000,data.priceQuote.validUntil-Date.now()+100)):60000);}}
      catch(e){if(active&&!signal.aborted){
        const retryDelay=e.status===409&&attempt<3?2000:e.transientRead&&attempt<2&&!(e.retryAfterMs>10000)?Math.max(attempt===0?2000:5000,e.retryAfterMs||0):null;
        const failure={id,ticker,error:`Holding refresh failed. ${e.message}`,failedAt:Date.now(),status:e.status,requestId:e.requestId,ray:e.ray};
        const failedState=previous=>({...failure,data:previous?.id===id&&previous?.ticker===ticker?previous.data:undefined});
        if(retryDelay!==null){setHoldingState(previous=>({...failedState(previous),loading:true}));retry=setTimeout(()=>{if(document.hidden){setHoldingState(failedState);schedule();}else load(attempt+1);},retryDelay);}
        else {setHoldingState(failedState);schedule(Math.max(60000,e.retryAfterMs||0));}
      }}
    }
    load();
    return()=>{active=false;controller?.abort();clearTimeout(retry);clearTimeout(timer);};
  },[id,ticker,state?.enabled,busy,review,holdingRefresh]);
  const holding=holdingState?.id===id&&holdingState?.ticker===ticker?holdingState:null,position=holding?.data;
  const fresh=position&&!holding.loading&&!holding.error&&now-position.checkedAt<65000&&now-position.checkedAt>=-5000;
  const sameCurrency=instrument?.currency===position?.currency;
  const priceFresh=fresh&&(!position.priceQuote||now<position.priceQuote.validUntil);
  const sizingPrice=type==='LIMIT'?Number(limit):priceFresh?position?.price:null;
  const quoteNote=q=>q?`${q.source}${q.session?' · '+q.session:''} · ${q.observedAt!=null?'Price at '+clockStamp(q.observedAt):'Checked '+clockStamp(q.checkedAt)+'; quote time not supplied'} ${zoneLabel}${q.source==='Yahoo Finance'?' · Latest available estimate; may be delayed and does not include overnight prices.':''}`:'';
  const quantityPrecision=orderQuantityPrecision(state?.quantityRules,{ticker,type,side,extendedHours});
  const sellReady=side!=='SELL'||fresh&&sameCurrency&&Number.isFinite(position.availableShares);
  const sellAll=side==='SELL'&&sizeMode==='shares'&&!!exactOrderQuantity(Number(quantity))&&(fullSaleIntent||sellReady&&Number(quantity)===position.availableShares);
  const sizedQuantity=sizeMode==='cash'?(fresh&&sameCurrency?cashOrderQuantity(Number(cashAmount),sizingPrice,quantityPrecision):''):sellAll?exactOrderQuantity(Number(quantity)):roundedOrderQuantity(Number(quantity),quantityPrecision);
  const quantityAdjusted=sizeMode==='shares'&&sizedQuantity&&Number(sizedQuantity)!==Number(quantity);
  const remainder=side==='SELL'&&sellReady&&sizedQuantity?sellRemainder(position.availableShares,Number(sizedQuantity),quantityPrecision):null;
  const fullSaleChanged=sellAll&&sellReady&&Number(quantity)!==position.availableShares;
  const sellBlocked=side==='SELL'&&(!sellReady||Number(sizedQuantity)>position.availableShares||fullSaleChanged);
  function selectPercentage(percent){
    if(side==='BUY'&&sizeMode==='cash')setCashAmount(cashPercentage(position.availableCash,percent));
    else {setQuantity(percentageQuantity(percent));setSizeMode('shares');}
    setPreset(percent);setFullSaleIntent(side==='SELL'&&percent===100);
  }
  const levels=portfolioOrderLevels(instrument,account.snapshot?.currency,sheet,watchlist);
  const percentageQuantity=percent=>fresh&&sameCurrency&&!busy?orderPercentage({side,type,percent,availableShares:position.availableShares,availableCash:position.availableCash,price:sizingPrice,precision:quantityPrecision}):'';
  const estimate=fresh&&sameCurrency&&Number(sizedQuantity)>0&&Number(sizingPrice)>0?Number(sizedQuantity)*sizingPrice:null;
  const marketCashLimit=side==='BUY'&&type==='MARKET'&&fresh&&sameCurrency?marketBuyCashLimit(position.availableCash):null;
  const exceedsMarketBudget=marketCashLimit!==null&&estimate!==null&&estimate>marketCashLimit+1e-8;
  function acceptOrders(data){
    setOrders(data);setTrackingError('');
    setResult(previous=>{
      if(previous?.state!=='ACCEPTED')return previous;
      const orderId=previous.action==='CANCEL'?previous.orderId??previous.order?.id:previous.order?.id;
      const order=orderId!=null&&data.orders?.find(item=>String(item.id)===String(orderId));
      const expected={ticker:previous.ticker??previous.order?.ticker,side:previous.side??previous.order?.side,type:previous.type??previous.order?.type,quantity:previous.quantity??previous.order?.quantity};
      if(!order||finalStatuses.has(previous.order?.status)||Object.entries(expected).some(([key,value])=>value!=null&&order[key]!=null&&value!==order[key])||Number.isFinite(previous.order?.filledQuantity)&&Number.isFinite(order.filledQuantity)&&order.filledQuantity<previous.order.filledQuantity)return previous;
      return {...previous,order:{...previous.order,...order},orderCheckedAt:data.checkedAt};
    });
    if(data.syncedRevision>0&&synced.current!==data.syncedRevision){synced.current=data.syncedRevision;setHoldingRefresh(v=>v+1);onPortfolioChange?.();}
  }
  useEffect(()=>{
    if(!state?.enabled||busy||review)return;
    let active=true;const controller=new AbortController();
    async function poll(){
      if(document.hidden||trackingBusy.current)return;
      trackingBusy.current=true;
      try{const data=await request(id,'/orders',undefined,controller.signal);if(active)acceptOrders(data);}
      catch(e){if(active&&!controller.signal.aborted&&e.status!==409)setTrackingError(e.message);}
      finally{trackingBusy.current=false;}
    }
    const first=setTimeout(poll,500),timer=setInterval(poll,15000);
    document.addEventListener('visibilitychange',poll);
    return()=>{active=false;controller.abort();clearTimeout(first);clearInterval(timer);document.removeEventListener('visibilitychange',poll);};
  },[id,state?.enabled,busy,review,onPortfolioChange]);
  useEffect(()=>{let active=true;request(id).then(data=>{if(active)setState(data);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[id]);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{
    const term=query.trim();
    if(!state?.enabled||!term||instrument)return;
    const controller=new AbortController();
    const params=new URLSearchParams(linkedTicker?{ticker:linkedTicker}:{q:term});
    const timer=setTimeout(async()=>{
      try{
        const data=await request(id,'/instruments?'+params,undefined,controller.signal);
        if(controller.signal.aborted)return;
        if(linkedTicker){
          const exact=data.items.find(item=>item.ticker===linkedTicker);
          if(exact)setInstrument(exact);
          else setSearchError('This broker instrument is unavailable. Search for a U.S. stock.');
        }else setMatches(data.items);
      }catch(e){if(!controller.signal.aborted)setSearchError(e.message);}
    },linkedTicker?0:250);
    return()=>{clearTimeout(timer);controller.abort();};
  },[id,query,state?.enabled,linkedTicker,instrument]);
  function changeQuery(value){
    setQuery(value);setLinkedTicker(null);setMatches(null);setSearchError('');setInstrument(null);
  }
  async function run(fn){if(busy)return;setBusy(true);setError('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function refresh(){setState(await request(id));}
  async function pending(){const data=await request(id,'/orders');acceptOrders(data);await refresh();}
  async function prepare(body){if(orderBlocked||savedConfirmation(id))return;setResult(null);setConfirmed(false);setReview(await request(id,'/preview',body));}
  async function submit(){
    if(!review||orderBlocked||savedConfirmation(id))return;
    const token=review.token;submittedDraft.current={token,...currentDraft.current};rememberConfirmation(token);setRecoveryAttempt(review);setReview(null);
    try{const outcome=await request(id,'/submit',{token,confirmed:true});if(outcome.token!==token||!['ACCEPTED','REJECTED','REVIEWED','UNKNOWN'].includes(outcome.state))throw Error('Unverified confirmation response');acceptResult(outcome);if(outcome.state==='UNKNOWN')setState(current=>({...current,blocked:true}));clearConfirmation(token);}
    catch{setRecoveryError('The confirmation response was not received. Checking the saved result; this order will not be resent.');}
    finally{try{await refresh();}catch{setTrackingError('The saved status could not be refreshed. The last confirmed result is kept; check Trading 212 before placing another order.');}}
  }
  useEffect(()=>{
    if(!recoveryToken||busy)return;
    let active=true,timer;const controller=new AbortController();
    async function check(){
      try{
        const data=await request(id,'/attempt?'+new URLSearchParams({token:recoveryToken}),undefined,controller.signal);
        if(!active)return;
        const attempt=data.attempt;
        if(!attempt||attempt.token!==recoveryToken)throw Error('The saved confirmation could not be verified.');
        setRecoveryAttempt(attempt);setRecoveryMissing(false);setRecoveryChecked(false);
        if(['ACCEPTED','REJECTED','REVIEWED','UNKNOWN'].includes(attempt.state)||(data.notSubmitted===true&&attempt.state==='PREPARED'&&data.inFlight===false)){
          const outcome=data.notSubmitted?{...attempt,state:'NOT_SENT',message:'This confirmation was not submitted. Review a new order to continue.'}:attempt.state==='UNKNOWN'?{...attempt,message:attempt.message||'The outcome is uncertain. Check this order in Trading 212 before submitting another order.'}:attempt;
          acceptResult(outcome);setError('');if(attempt.state==='UNKNOWN')setState(current=>({...current,blocked:true}));
          clearConfirmation(recoveryToken);
          try{await refresh();}catch{setTrackingError('The saved status could not be refreshed. The last confirmed result is kept; check Trading 212 before placing another order.');}
          return;
        }
        setRecoveryError('The server is still checking this confirmation. No order has been resent.');
      }catch(e){if(active&&!controller.signal.aborted){setRecoveryMissing(e.status===409);setRecoveryError(e.status===409?'This confirmation is unavailable for the current connection. Check its outcome in Trading 212.':'The saved result is temporarily unavailable. Check pending orders and trade history in Trading 212 before placing another order.');if(e.status===409)return;}}
      if(active)timer=setTimeout(check,5000);
    }
    check();return()=>{active=false;controller.abort();clearTimeout(timer);};
  },[id,recoveryToken,busy,recoveryRefresh]);
  const seconds=review?Math.min(60,Math.max(0,Math.ceil((review.expiresAt-now)/1000))):0;
  const listing=instrument&&portfolioListing({...instrument,instrumentCurrency:instrument.currency},watchlist);
  const displaySymbol=listing?.symbol||instrument?.shortName||ticker?.replace(/_US_EQ$/,'');
  const holdingPanel=<section className="pm-order-holding" aria-label="Current holding">
          <div className="pm-section-heading"><h3>Current holding / cash</h3>{instrument&&<button type="button" className="text-button" disabled={busy||holding?.loading||position&&now-position.checkedAt<5000} onClick={()=>setHoldingRefresh(value=>value+1)}>Refresh holding</button>}</div>
          {instrument?<div className="pm-holding-symbol"><strong>{displaySymbol}</strong> · {instrument.name}<span>{listing?.exchange||instrument.currency}</span></div>:<p>Select a stock to see its holding and available cash.</p>}
          {holding?.error?<><p role="status">{holding.error} {holding.loading?'Retrying the holding check…':'The holding check will retry automatically.'} This does not change any order’s status.</p><details><summary>Refresh details</summary><small>{clockStamp(holding.failedAt)} {zoneLabel}{holding.status?` · HTTP ${holding.status}`:''}{holding.requestId?` · App request ${holding.requestId}`:''}{holding.ray?` · Gateway ${holding.ray}`:''}</small></details></>:instrument&&(holding?.loading||!holding)?<p role="status">Checking shares and value…</p>:null}
          {position&&<>
            <dl><div><dt>Current shares</dt><dd>{shares(position?.shares)}</dd></div><div><dt>Position value · {position?.currency}</dt><dd>{money(position?.value,position?.currency)}</dd></div><div><dt>{position?.priceQuote?.source==='Yahoo Finance'?'Latest market price':'Current price'} · {position?.instrumentCurrency}</dt><dd>{priceMoney(position?.price,position?.instrumentCurrency)}</dd></div><div><dt>Average purchase price</dt><dd>{priceMoney(position?.averagePrice,position?.instrumentCurrency)}</dd></div><div className="pm-holding-profit"><dt>Holding profit / loss · {position?.currency}</dt><dd className={tone(position?.unrealized)}>{money(position?.unrealized,position?.currency)} <small className={tone(position?.unrealized)}>{percent(position?.unrealizedPercent)}</small></dd></div><div><dt>Available to sell</dt><dd>{shares(position?.availableShares)} shares</dd></div><div><dt>Available cash · {position?.currency}</dt><dd>{money(position?.availableCash,position?.currency)}</dd></div>{estimate!==null&&Number.isFinite(position.availableCash)&&<div><dt>Estimated remaining cash</dt><dd>{money(position.availableCash+(side==='BUY'?-estimate:estimate),position.currency)}</dd></div>}</dl>
            {position?.priceQuote&&<p className="pm-history-state">{quoteNote(position.priceQuote)}</p>}{!priceFresh&&position?.price>0&&<p className="pm-history-state">Refresh the quote to update the market estimate.</p>}
            <small>{fresh?'Checked':'Last confirmed holding'} {clockStamp(position?.checkedAt)} {zoneLabel}{!fresh?' · For reference only. Refresh required before sizing or reviewing another order.':''}</small>
            <div className="pm-market-budget"><p>Buy 100% uses the full available cash balance{Number.isFinite(position.availableCash)?` (${money(position.availableCash,position.currency)})`:''}. Sell 100% uses the exact available shares without rounding.</p></div>
          </>}
        </section>;
  const receiptStatus=result?.order?.status;
  const receiptHeading=result?.state==='UNKNOWN'?'Result uncertain':result?.state==='REJECTED'?'Order rejected':result?.state==='NOT_SENT'?'Order not submitted':result?.state==='REVIEWED'?'Confirmation checked':result?.action==='CANCEL'&&!finalStatuses.has(receiptStatus)?'Cancellation requested':receiptStatus==='FILLED'?'Order filled':receiptStatus==='PARTIALLY_FILLED'?'Order partially filled':receiptStatus==='CANCELLED'?'Order cancelled':receiptStatus==='REJECTED'?'Order rejected by broker':'Order accepted';
  const receipt=result&&<section className={`pm-order-result ${result.state==='UNKNOWN'?'pm-alert':''}`} aria-label="Latest order status" role="status">
    <strong>{receiptHeading}</strong>
    {result.action==='ORDER'&&<p>{result.side} · {result.ticker} · {result.type} · {shares(result.quantity)} shares</p>}
    {result.order&&<p className="pm-order-receipt-status">Order #{result.order.id??result.orderId} · <strong>{statusLabel(receiptStatus)||'Awaiting status'}</strong> · {shares(result.order.filledQuantity)} shares filled</p>}
    <p>{result.message}</p>
    {result.state==='ACCEPTED'&&result.action==='ORDER'&&<p>{finalStatuses.has(receiptStatus)?'This is the confirmed broker status.':receiptStatus==='PARTIALLY_FILLED'?'Part of this order has filled. The remaining quantity is still being tracked.':'The broker has accepted this order; it is waiting for execution. Its status updates here automatically.'} A holding or cash refresh warning does not mean this order failed.</p>}
    {result.orderCheckedAt&&<small>Status checked {clockStamp(result.orderCheckedAt)} {zoneLabel}</small>}
    <SellRejectionHelp attempt={result}/>
    {result.brokerCode==='insufficient-free-for-stocks-buy'&&<p>The broker could not fund this buy. Refresh the holding to check available cash and pending orders, then review a smaller quantity. Market execution prices can differ from the displayed price. This order has not been retried.</p>}
  </section>;
  return <section className="pm-trading" aria-label="Account trading">
    {recoveryToken&&<section className="pm-alert pm-order-recovery" aria-label="Order confirmation status" role="status"><h3>Checking submitted order</h3><p>{recoveryError||'Waiting for the confirmation result. This order will not be resent.'}</p>{recoveryAttempt&&<p>{recoveryAttempt.action==='CANCEL'?`Cancellation · #${recoveryAttempt.orderId}`:`${recoveryAttempt.side} · ${recoveryAttempt.ticker} · ${recoveryAttempt.type} · ${shares(recoveryAttempt.quantity)} shares`}</p>}<p>New orders are paused until the result is known. This check continues after refreshing the page.</p><button className="button outline" disabled={busy} onClick={()=>setRecoveryRefresh(value=>value+1)}>Check saved result</button>{recoveryMissing&&<><label className="pm-check"><input type="checkbox" checked={recoveryChecked} onChange={e=>setRecoveryChecked(e.target.checked)}/>I checked this confirmation in Trading 212, including pending orders and trade history.</label><button className="button outline" disabled={!recoveryChecked||busy} onClick={()=>run(async()=>{await refresh();clearConfirmation(recoveryToken);setResult({state:'REVIEWED',message:'Marked checked in Trading 212. No order was resent.'});})}>Clear checked confirmation</button></>}</section>}
    {error&&<p className="pm-alert" role="alert">{error}</p>}
    {!state?<p role="status">Loading trading settings…</p>:!account.connected?<p>Reconnect this account to trade.</p>:!state.enabled?<div className="pm-trading-enable">
      <h3>Trading is disabled for this account</h3><p>The account owner must enable Metadata, Orders: Read and Orders: Execute on their Trading 212 API key. Update the connection if the key or secret changes.</p>
      <label className="pm-check"><input type="checkbox" checked={authorized} onChange={e=>setAuthorized(e.target.checked)}/>The account owner authorizes me to place and cancel orders in this {account.environment==='demo'?'demo':'real-money'} account.</label>
      <button className="button primary" disabled={!authorized||busy} onClick={()=>run(async()=>{setState(await request(id,'/settings',{enabled:true,authorized:true}));setAuthorized(false);})}>Enable {account.environment==='demo'?'demo':'live'} trading</button>
    </div>:<>
      <div className="pm-ticket-status">
        <span>Trading 212 {account.snapshot?.brokerId&&`· Account ${account.snapshot.brokerId}`} · {account.snapshot?.currency} · Trading enabled</span>
        <span>Maximum order estimate: {state.maxOrderValue!=null?money(state.maxOrderValue,account.snapshot?.currency):'No limit set'}</span>
        <button className="text-button" title="Existing broker orders stay active" disabled={busy} onClick={()=>run(async()=>{setState(await request(id,'/settings',{enabled:false}));setReview(null);setOrders(null);})}>Disable trading</button>
      </div>
      {state.blocked&&<p className="pm-alert" role="status">An earlier order has an uncertain result. Check Trading 212 and mark that attempt reviewed below before submitting another order.</p>}
      {receipt}
      {review?<div className="pm-order-review" aria-label="Order review">
        <h3>{review.action==='CANCEL'?'Review cancellation':`Review ${review.side.toLowerCase()} order`}</h3>
        <dl><div><dt>Account</dt><dd>{owner} · {account.label} · {review.environment.toUpperCase()} · {review.brokerId}</dd></div>{review.action==='CANCEL'?<><div><dt>Order</dt><dd>#{review.orderId} · {review.order.side} · {review.order.ticker}</dd></div><div><dt>Shares</dt><dd>{review.order.quantity??'Value order'}</dd></div></>:<><div><dt>Stock / ETF</dt><dd>{review.name} · {review.ticker}</dd></div><div><dt>Order</dt><dd>{review.side} · {review.quantity} shares · {review.type}</dd></div><div><dt>Trading session</dt><dd>{review.type==='LIMIT'?'Set by broker · not selectable here':sessionLabel(review)}</dd></div><div><dt>{review.type==='LIMIT'?'Limit price':'Market reference price'}</dt><dd>{priceMoney(review.referencePrice,review.currency)}</dd></div><div><dt>Account order limit</dt><dd>{review.maxOrderValue!=null?money(review.maxOrderValue,review.currency):'No limit set'}</dd></div><div><dt>Estimated value, before additional charges</dt><dd>{money(review.estimate,review.currency)}</dd></div><div><dt>Shares · before → after full fill</dt><dd>{shares(review.currentShares)} → {shares(review.remainingShares)}</dd></div><div><dt>Available cash · before → estimated after</dt><dd>{money(review.availableCash,review.currency)} → {money(review.remainingCash,review.currency)}</dd></div>{review.requestedCashAmount!==null&&review.requestedCashAmount!==undefined&&<div><dt>Requested amount</dt><dd>{money(review.requestedCashAmount,review.currency)} · converted to the fixed share quantity above</dd></div>}{review.side==='SELL'&&<div><dt>Estimated sale profit / loss</dt><dd className={tone(review.estimatedProfit)}>{money(review.estimatedProfit,review.currency)} ({percent(review.estimatedProfitPercent)})</dd></div>}{review.side==='SELL'&&<div><dt>Available shares</dt><dd>{review.availableShares}</dd></div>}{review.type==='LIMIT'&&<div><dt>Duration</dt><dd>{review.timeValidity==='DAY'?'Day':'Good until cancelled'}</dd></div>}</>}</dl>
        {review.sellAll&&<p className="pm-cash-conversion pm-sell-all" role="status">Sell all available shares: {review.quantity}. No rounding. Confirming sends this exact quantity to Trading 212.</p>}
        {review.requestedQuantity!=null&&<p className="pm-cash-conversion" role="status">Rounded down from {review.requestedQuantity} to {review.quantity} shares ({review.quantityPrecision} decimal places). Confirming sends only the adjusted quantity.</p>}
        {review.marketCashLimit!=null&&<p className="pm-market-budget">Available cash: {money(review.availableCash,review.currency)}. The reviewed shares are fixed; the final cost depends on execution prices and charges.</p>}
        {review.priceQuote&&<p className="pm-history-state">{quoteNote(review.priceQuote)}</p>}{review.action!=='CANCEL'&&<small>After values assume a full fill at the reference price, before fees and taxes. Sale profit uses the holding’s average cost; the broker’s final result can differ.</small>}<p>{review.action==='CANCEL'?'Cancellation may arrive after a fill. Check the final broker status.':review.type==='MARKET'?(review.extendedHours?'This order permits pre-market, after-hours and overnight execution where the broker supports it. Thin liquidity can delay execution or change the fill price.':'This order permits regular-session execution only and waits when that session is closed.')+' The final execution price can differ from the reference price.':'A limit order may remain pending or fill partially. This API does not let us select its trading session. Use Trading 212 directly to choose 24/5 for a limit order.'}</p>
        <label className="pm-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I confirm this {review.environment==='demo'?'demo':'real-money'} {review.action==='CANCEL'?'cancellation':review.side.toLowerCase()+' order'} for the account shown above.</label>
        <div className="pm-actions"><button className="button primary" disabled={!confirmed||busy||seconds===0||orderBlocked} onClick={()=>run(submit)}>{review.action==='CANCEL'?'Confirm cancellation':`Confirm ${review.environment==='demo'?'demo':'live'} ${review.side.toLowerCase()}`}</button><button className="button outline" disabled={busy} onClick={()=>setReview(null)}>Back</button><small>{seconds?`Review expires in ${seconds}s`:'Review expired. Go back and review again.'}</small></div>
      </div>:<form className="pm-order-form" onSubmit={e=>{e.preventDefault();if(!fresh||exceedsMarketBudget||orderBlocked||sellBlocked||!sizedQuantity)return;run(()=>prepare({side,type,...(type==='MARKET'?{extendedHours}:{}),ticker:instrument?.ticker,...(sizeMode==='cash'?{cashAmount:Number(cashAmount)}:{quantity:Number(quantity),...(side==='SELL'?{sellAll}:{})}),limitPrice:Number(limit),timeValidity:validity}));}}><div className="pm-ticket-entry">
        <h3>Trade ticket</h3>
        <div className="pm-ticket-row"><label htmlFor="pm-stock-search">Instrument</label><div>
          {instrument?<button id="pm-stock-search" className="pm-selected-instrument" aria-label="Change instrument" type="button" onClick={()=>{changeQuery('');requestAnimationFrame(()=>searchInput.current?.focus());}}>
            <strong>{displaySymbol}</strong><span>{listing&&`${listing.exchange} · `}{instrument.name} · {instrument.ticker} · {instrument.currency}</span><CaretDown size={15}/>
          </button>:<input id="pm-stock-search" ref={searchInput} aria-label="Find a U.S. stock" value={query} onChange={e=>changeQuery(e.target.value)} placeholder="Find a U.S. stock by ticker, name or ISIN" autoComplete="off" maxLength={80}/>}
          {!instrument&&query.trim()&&(searchError?<p role="status">{searchError}</p>:matches===null?<small role="status">Searching…</small>:matches.length?<div className="pm-instrument-results" aria-label="U.S. stocks">{matches.map(item=><button type="button" key={item.ticker} onClick={()=>setInstrument(item)}><strong>{item.name}</strong><span>{item.ticker} · {item.currency} · {item.type}</span></button>)}</div>:<small role="status">No matching U.S.-listed stocks.</small>)}
        </div></div>
        <div className="pm-ticket-choices"><TicketChoice label="Action" options={['BUY','SELL']} value={side} onChange={setSide}/><TicketChoice label="Order type" options={['MARKET','LIMIT']} value={type} onChange={value=>{setType(value);setPreset(null);setLevelChoice('');}}/></div>
        {instrument&&<div className="pm-order-session">{type==='MARKET'?<><label className="pm-ticket-row">Trading session<select aria-label="Trading session" value={extendedHours?'extended':'regular'} onChange={e=>setSessionChoice(e.target.value)}><option value="extended" disabled={!instrument.extendedHours}>24/5 · Extended sessions</option><option value="regular">Regular hours only</option></select></label><div className="pm-ticket-hours"><StockHours accountId={id} connected={account.connected} ticker={ticker} name={instrument.name}/><span>{extendedHours?'Pre-market, after-hours and overnight where eligible.':'Regular-hours execution only.'}</span></div></>:<p className="pm-history-state">To request extended-session execution here, choose a Market order. For a limit order with 24/5 selected, use Trading 212 directly; its API does not expose that session setting.</p>}</div>}


        <div className="pm-ticket-sizing"><div className="pm-ticket-row"><span>Sizing</span><div className="pm-size-mode" role="group" aria-label="Size order by"><button type="button" aria-pressed={sizeMode==='shares'} onClick={()=>{setQuantity(sizedQuantity);setSizeMode('shares');setFullSaleIntent(false);}}>Shares</button><button type="button" aria-pressed={sizeMode==='cash'} onClick={()=>{setCashAmount(estimate!==null?String(Number(estimate.toFixed(2))):'');setSizeMode('cash');setPreset(null);setFullSaleIntent(false);}}>Cash amount</button></div></div>
        <div className="pm-trade-fields">{sizeMode==='cash'?<label>Cash amount · {account.snapshot?.currency}<input aria-label="Order cash amount" required type="number" min="0.01" step="0.01" value={cashAmount} onChange={e=>{setCashAmount(e.target.value);setPreset(null);}}/></label>:<label>Shares<input aria-label="Order shares" required type="number" min="0.00000001" step="any" value={quantity} onChange={e=>{setQuantity(e.target.value);setPreset(null);setFullSaleIntent(side==='SELL'&&sellReady&&Number(e.target.value)===position.availableShares);}}/></label>}{type==='LIMIT'&&<><label>Limit price · {account.snapshot?.currency}<input aria-label="Order limit price" required type="number" min="0.00000001" step="any" value={limit} onChange={e=>{setLimit(e.target.value);setLevelChoice('');setPreset(null);}}/></label><label>Duration<select value={validity} onChange={e=>setValidity(e.target.value)}><option value="DAY">Day</option><option value="GOOD_TILL_CANCEL">Good until cancelled</option></select></label></>}</div></div>

        {sellAll&&!fullSaleChanged&&<p className="pm-cash-conversion pm-sell-all" role="status">Sell all available shares: {sizedQuantity}. No rounding. Review and confirmation will use this exact quantity.</p>}
        {fullSaleChanged&&<p className="pm-alert" role="status">Available shares changed. Select 100% again to review the new quantity.</p>}
        {quantityAdjusted&&!sellBlocked&&<p className="pm-cash-conversion" role="status">Will review {sizedQuantity} shares, rounded down from {quantity}.</p>}
        {remainder?.belowStep&&<p className="pm-alert pm-sell-remainder" role="status">This partial sale would leave {remainder.shares} available shares. The broker may reject a small remaining position. <button type="button" className="text-button" disabled={!percentageQuantity(100)||orderBlocked} onClick={()=>selectPercentage(100)}>Use 100% without rounding</button></p>}
        {side==='SELL'&&!sellReady&&instrument&&!holding?.loading&&<p className="pm-history-state" role="status">Refresh the holding to check available shares before reviewing a sale.</p>}
        {sizeMode==='shares'&&Number(quantity)>0&&!sizedQuantity&&<p className="pm-cash-conversion" role="status">Enter at least {10**-quantityPrecision} shares and no more than 1,000,000.</p>}
        {sizeMode==='cash'&&!sizedQuantity&&<p className="pm-cash-conversion" role="status">{Number(cashAmount)>0&&Number(sizingPrice)>0?`This amount cannot produce a quantity between ${10**-quantityPrecision} and 1,000,000 shares. Adjust the cash amount.`:type==='LIMIT'?'Enter a cash amount and a limit price.':'Enter a cash amount. A market quote is required to calculate shares; refresh if unavailable.'}</p>}
        {instrument&&type==='LIMIT'&&<div className="pm-order-levels">
          {levels?<><label>Use a chart level<select aria-label="Use a chart level" value={levelChoice} onChange={e=>{const selected=levels.options.find(o=>o.id===e.target.value);setLevelChoice(e.target.value);if(selected){setLimit(String(selected.price));setPreset(null);}}}><option value="">Choose a price…</option>{levels.options.map(option=><option key={option.id} value={option.id}>{option.label} · {priceMoney(option.price,instrument.currency)}</option>)}</select></label><small>{levels.listing} · sheet {levels.date} · {levels.timeframe}. Original imported zone prices; selecting one fills the limit price for review.</small></>:<small>No matching imported chart levels for this listing and currency.</small>}
        </div>}
        {instrument&&<div className="pm-order-sizing">
          <span id="pm-size-label">{side==='SELL'?'% of available shares':'% of available cash'}</span>
          <div className="pm-ticket-budget-row"><div className="pm-order-percentages" role="group" aria-labelledby="pm-size-label">{[25,50,75,100].map(percent=><button key={percent} type="button" disabled={!percentageQuantity(percent)||orderBlocked} aria-pressed={preset===percent} onClick={()=>selectPercentage(percent)}>{percent}%</button>)}</div>
            {fresh&&<small>{side==='BUY'?'Available cash':'Available to sell'} <b>{side==='BUY'?money(position.availableCash,position.currency):shares(position.availableShares)+' shares'}</b></small>}
          </div>
          {fresh&&!sameCurrency&&<p className="pm-ticket-caveat">Order sizing requires the instrument and account currencies to match.</p>}
          {type==='MARKET'&&fresh&&!sizingPrice&&<p className="pm-ticket-caveat">Market quote unavailable. Enter shares or refresh the holding to size by cash.</p>}
          {exceedsMarketBudget&&<p className="pm-alert" role="status">This estimate exceeds available cash. Reduce the amount or select 100% to recalculate.</p>}
          <div className="pm-ticket-metrics"><div><small>{type==='LIMIT'?'Limit price':'Reference price'}</small><strong>{priceMoney(sizingPrice>0?sizingPrice:null,instrument.currency)}</strong></div>
            <div><small>{type==='LIMIT'?'Price source':'Source'}</small><b>{type==='LIMIT'?'Entered limit':position?.price>0?(position.priceQuote?.source||'Trading 212'):'—'}</b>{type==='MARKET'&&position?.price>0&&<small>{position.priceQuote?.observedAt?'Observed':'Checked'} {clockStamp(position.priceQuote?.observedAt??position.checkedAt)} {zoneLabel}</small>}</div>
            <div><small>Estimated shares</small><strong>{sizedQuantity||'—'}</strong></div>
          </div>
          <p className="pm-order-estimate">Estimated order value <strong>{money(estimate,position?.currency)}</strong></p>
        </div>}
        <p className="pm-ticket-note">Review fixes the share quantity. The final cash amount can change.</p>
        <button className="button primary" disabled={busy||!instrument||!fresh||orderBlocked||!sizedQuantity||exceedsMarketBudget||sellBlocked} type="submit">{busy?'Checking broker…':`Review ${side.toLowerCase()} order`}</button>
      </div>{holdingPanel}</form>}
      <PortfolioOrderList orders={orders} error={trackingError||orders?.error||orders?.historyError||orders?.balanceError||orders?.activityError} busy={busy} blocked={orderBlocked}
        refresh={()=>run(pending)} cancel={orderId=>run(()=>prepare({action:'CANCEL',orderId}))}/>
    </>}
    {state?.attempts.length>0&&<details className="pm-trade-attempts" open={state.blocked}><summary>Recent order attempts</summary>{state.attempts.map(attempt=><div key={attempt.token}><strong>{attempt.action==='CANCEL'?'CANCEL #'+attempt.orderId:attempt.side+' '+attempt.quantity+' '+attempt.ticker} · {attempt.state}</strong><p>{attempt.message}</p><SellRejectionHelp attempt={attempt}/>{attempt.action==='ORDER'&&attempt.type==='MARKET'&&<small>Requested: {sessionLabel(attempt)}</small>}<small>{clockStamp(attempt.createdAt)} {zoneLabel} · {attempt.environment?.toUpperCase()} · account {attempt.brokerId}</small>{attempt.state==='UNKNOWN'&&<><label className="pm-check"><input type="checkbox" disabled={busy} checked={checkedAttempt===attempt.token} onChange={e=>setCheckedAttempt(e.target.checked?attempt.token:null)}/>I checked this attempt’s outcome in Trading 212, including pending orders and trade history.</label><button className="button outline" disabled={busy||checkedAttempt!==attempt.token} onClick={()=>run(async()=>{setState(await request(id,'/acknowledge',{token:attempt.token,checkedBroker:true}));setCheckedAttempt(null);})}>Mark reviewed</button></>}</div>)}</details>}
  </section>;
}

function TicketChoice({label,options,value,onChange}){
  return <div className="pm-ticket-row"><span>{label}</span><div className="pm-size-mode" role="group" aria-label={label}>
    {options.map(option=><button type="button" key={option} aria-pressed={value===option} onClick={()=>onChange(option)}>{option[0]+option.slice(1).toLowerCase()}</button>)}
  </div></div>;
}

const filters=['All','Pending','Partially filled','Filled'];

function PortfolioOrderList({orders,error,busy,blocked,refresh,cancel}){
  const [filter,setFilter]=useState('All');
  const {clockStamp,zoneLabel}=useDisplayTime();
  const visible=orders?.orders.filter(order=>{
    if(filter==='All')return true;
    if(filter==='Pending'&&['REPLACING','CANCELLING'].includes(order.status))return true;
    return statusLabel(order.status)===filter;
  })||[];
  return <section className="pm-orders-card" aria-label="Orders and recent activity">
    <header className="pm-section-heading"><h3>Orders &amp; recent activity</h3>
      <button type="button" className="button outline" disabled={busy} onClick={refresh}><ArrowsClockwise size={15}/>Refresh orders</button>
    </header>
    <div className="pm-order-filters" role="group" aria-label="Filter orders by status">
      {filters.map(value=><button type="button" key={value} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{value}</button>)}
    </div>
    {error&&<p className="pm-alert" role="status">{error}</p>}
    {!orders?<p role="status">Checking broker orders…</p>:!visible.length?<p role="status">{filter==='All'?'No tracked orders yet.':'No orders with this status.'}</p>:
      <div className="pm-orders-scroll" tabIndex={0} role="region" aria-label="Account orders table">
        <table className="pm-orders-table"><thead><tr>
          {[`Time (${zoneLabel})`,'Instrument','Side','Order type','Quantity','Limit price','Status',''].map(label=><th key={label} scope="col">{label||<span className="sr-only">Actions</span>}</th>)}
        </tr></thead><tbody>{visible.map(order=>{
          const status=statusLabel(order.status);
          return <tr key={order.id} className="pm-pending-order">
            <td>{order.createdAt?clockStamp(Date.parse(order.createdAt)):'—'}</td>
            <td><strong>{order.ticker}</strong><small>{order.name!==order.ticker?`${order.name} · `:null}#{order.id}</small></td>
            <td><span className={order.side==='BUY'?'green':'red'}>{order.side==='BUY'?'Buy':'Sell'}</span></td>
            <td>{order.type}<small>{sessionLabel(order)}</small></td>
            <td>{order.quantity!=null?shares(order.quantity)+' shares':money(order.value,order.currency)}</td>
            <td>{money(order.limitPrice,order.priceCurrency||order.currency)}</td>
            <td><span className="pm-order-status" data-status={status}>{status}</span><small>{shares(order.filledQuantity)} shares filled</small>{order.awaitingHistory&&<small>Waiting for broker history</small>}</td>
            <td>{!order.awaitingHistory&&!['CANCELLING','FILLED','CANCELLED','REJECTED','REPLACED'].includes(order.status)&&<button type="button" className="text-button" disabled={busy||blocked} onClick={()=>cancel(order.id)}>Review cancellation</button>}</td>
          </tr>;
        })}</tbody></table>
      </div>}
    <details className="pm-order-tracking"><summary>Order tracking{orders?.checkedAt?` · Checked ${clockStamp(orders.checkedAt)} ${zoneLabel}`:''}</summary>
      <p>{!orders?.balanceError&&orders?.syncedRevision>0&&'Holdings and cash refreshed. '}The server checks every 15 seconds. Fills refresh holdings and cash. Final status uses the broker’s order history. Wait for confirmed cancellation before replacing an order.</p>
    </details>
  </section>;
}
