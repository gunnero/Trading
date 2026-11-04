import {StockHours} from './PortfolioHours';
import {useEffect,useRef,useState} from 'react';
import {apiFetch} from './auth-client';
import {useDisplayTime} from './DisplayTime';
import {cashOrderQuantity,orderPercentage,roundedOrderQuantity,orderQuantityPrecision,marketBuyCashLimit,MARKET_BUY_BUFFER_PERCENT,sellRemainder,exactOrderQuantity} from './data/portfolio-order-size.mjs';
import {portfolioOrderLevels} from './data/portfolio-order-levels.mjs';

const money=(value,currency)=>Number.isFinite(value)&&currency?new Intl.NumberFormat('en-US',{style:'currency',currency}).format(value):'—';
const priceMoney=(value,currency)=>Number.isFinite(value)&&currency?new Intl.NumberFormat('en-US',{style:'currency',currency,maximumFractionDigits:8}).format(value):'—';
const shares=value=>Number.isFinite(value)?new Intl.NumberFormat('en-US',{maximumFractionDigits:8}).format(value):'—';
const percent=value=>Number.isFinite(value)?`${value>0?'+':''}${value.toFixed(2)}%`:'—';
const tone=value=>value>0?'green':value<0?'red':'';
const sessionLabel=order=>order.extendedHours===true?'Extended sessions · 24/5 where available':order.extendedHours===false?'Regular hours only':'Session not reported by broker';
const statusLabel=status=>({NEW:'Pending',LOCAL:'Pending',UNCONFIRMED:'Pending',CONFIRMED:'Pending',PARTIALLY_FILLED:'Partially filled',FILLED:'Filled',CANCELLED:'Cancelled',REJECTED:'Rejected',REPLACING:'Replacing',REPLACED:'Replaced',CANCELLING:'Cancelling'}[status]||status);
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
  try{res=await apiFetch(`/api/portfolio/accounts/${id}/trading${path}`,{method:body===undefined?'GET':'POST',signal:requestSignal,...(body===undefined?{}:{headers:{'Content-Type':'application/json','X-Opening-Bell-Client':'web'},body:JSON.stringify(body)})});}
  catch(error){if(signal?.aborted||error.auth)throw error;throw Error(requestSignal.aborted?'The trading request timed out. Refresh to check its status.':'The trading service could not be reached. Check your connection and refresh.');}
  let data;
  try{data=await res.json();if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Invalid response');}
  catch{throw Object.assign(Error(`The trading service returned an unreadable response (HTTP ${res.status}). Refresh to try again.`),{status:res.status});}
  if(!res.ok)throw Object.assign(Error(data.message||'The trading request could not be completed.'),{status:res.status});return data;
}
export function PortfolioTrading({account,owner,initialHolding,initialSide='BUY',sheet,watchlist,onPortfolioChange}){
  const [state,setState]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[authorized,setAuthorized]=useState(false),[query,setQuery]=useState(initialHolding?.ticker||''),[matches,setMatches]=useState([]),[instrument,setInstrument]=useState(null),[side,setSide]=useState(initialSide),[type,setType]=useState('MARKET'),[quantity,setQuantity]=useState(''),[limit,setLimit]=useState(''),[validity,setValidity]=useState('DAY'),[review,setReview]=useState(null),[confirmed,setConfirmed]=useState(false),[result,setResult]=useState(null),[orders,setOrders]=useState(null),[checkedAttempt,setCheckedAttempt]=useState(null),[now,setNow]=useState(Date.now());
  const {clockStamp,zoneLabel}=useDisplayTime(),id=account.id;
  const [recoveryToken,setRecoveryToken]=useState(()=>savedConfirmation(id)),[recoveryError,setRecoveryError]=useState(''),[recoveryAttempt,setRecoveryAttempt]=useState(null),[recoveryMissing,setRecoveryMissing]=useState(false),[recoveryChecked,setRecoveryChecked]=useState(false),[recoveryRefresh,setRecoveryRefresh]=useState(0);
  const orderBlocked=state?.blocked||!!recoveryToken;
  function rememberConfirmation(token){try{localStorage.setItem(recoveryKey(id),token);}catch{/* Keep the current page blocked even if browser storage is unavailable. */}setRecoveryToken(token);setRecoveryError('');setRecoveryAttempt(null);setRecoveryMissing(false);setRecoveryChecked(false);}
  function clearConfirmation(token){try{if(localStorage.getItem(recoveryKey(id))===token)localStorage.removeItem(recoveryKey(id));}catch{}setRecoveryToken(current=>current===token?null:current);setRecoveryError('');setRecoveryAttempt(null);setRecoveryMissing(false);setRecoveryChecked(false);}
  useEffect(()=>{const changed=event=>{if(event.key===null||event.key===recoveryKey(id)){setRecoveryToken(savedConfirmation(id));setRecoveryAttempt(null);setRecoveryMissing(false);setRecoveryChecked(false);}};window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed);},[id]);
  const [holdingState,setHoldingState]=useState(null),[holdingRefresh,setHoldingRefresh]=useState(0),[preset,setPreset]=useState(null),[fullSaleIntent,setFullSaleIntent]=useState(false);
  const [sizeMode,setSizeMode]=useState('shares'),[cashAmount,setCashAmount]=useState(''),[levelChoice,setLevelChoice]=useState(''),[trackingError,setTrackingError]=useState('');
  const synced=useRef(null),trackingBusy=useRef(false);
  const ticker=instrument?.ticker;
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
      setHoldingState({id,ticker,loading:true});setPreset(null);
      try{const data=await request(id,'/position?'+new URLSearchParams({ticker}),undefined,signal);if(active&&!signal.aborted){setHoldingState({id,ticker,data});schedule(Number.isFinite(data.priceQuote?.validUntil)?Math.max(5000,Math.min(60000,data.priceQuote.validUntil-Date.now()+100)):60000);}}
      catch(e){if(active&&!signal.aborted){if(e.status===409&&attempt<3)retry=setTimeout(()=>load(attempt+1),2000);else {setHoldingState({id,ticker,error:e.message});schedule();}}}
    }
    load();
    return()=>{active=false;controller?.abort();clearTimeout(retry);clearTimeout(timer);};
  },[id,ticker,state?.enabled,busy,review,holdingRefresh]);
  const holding=holdingState?.id===id&&holdingState?.ticker===ticker?holdingState:null,position=holding?.data;
  const fresh=position&&now-position.checkedAt<65000&&now-position.checkedAt>=-5000;
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
  function selectPercentage(percent){setQuantity(percentageQuantity(percent));setSizeMode('shares');setPreset(percent);setFullSaleIntent(side==='SELL'&&percent===100);}
  const levels=portfolioOrderLevels(instrument,account.snapshot?.currency,sheet,watchlist);
  const percentageQuantity=percent=>fresh&&sameCurrency&&!busy?orderPercentage({side,type,percent,availableShares:position.availableShares,availableCash:position.availableCash,price:sizingPrice,precision:quantityPrecision}):'';
  const estimate=fresh&&sameCurrency&&Number(sizedQuantity)>0&&Number(sizingPrice)>0?Number(sizedQuantity)*sizingPrice:null;
  const marketCashLimit=side==='BUY'&&type==='MARKET'&&fresh&&sameCurrency?marketBuyCashLimit(position.availableCash):null;
  const exceedsMarketBudget=marketCashLimit!==null&&estimate!==null&&estimate>marketCashLimit+1e-8;
  function acceptOrders(data){
    setOrders(data);setTrackingError('');
    if(data.syncedRevision>0&&synced.current!==data.syncedRevision){synced.current=data.syncedRevision;setHoldingRefresh(v=>v+1);onPortfolioChange?.();}
  }
  useEffect(()=>{
    if(!state?.enabled||busy||review||holding?.loading)return;
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
  },[id,state?.enabled,busy,review,holding?.loading,onPortfolioChange]);
  useEffect(()=>{let active=true;request(id).then(data=>{if(active)setState(data);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[id]);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{
    setMatches([]);if(!state?.enabled||query.trim().length<2)return;
    const controller=new AbortController(),timer=setTimeout(()=>{request(id,'/instruments?'+new URLSearchParams({q:query.trim()}),undefined,controller.signal).then(data=>{setMatches(data.items);if(initialHolding?.ticker===query){const exact=data.items.find(i=>i.ticker===initialHolding.ticker);if(exact)setInstrument(exact);}}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});},350);
    return()=>{clearTimeout(timer);controller.abort();};
  },[id,query,state?.enabled,initialHolding?.ticker]);
  async function run(fn){if(busy)return;setBusy(true);setError('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function refresh(){setState(await request(id));}
  async function pending(){const data=await request(id,'/orders');acceptOrders(data);await refresh();}
  async function prepare(body){if(orderBlocked||savedConfirmation(id))return;setResult(null);setConfirmed(false);setReview(await request(id,'/preview',body));}
  async function submit(){
    if(!review||orderBlocked||savedConfirmation(id))return;
    const token=review.token;rememberConfirmation(token);setRecoveryAttempt(review);setReview(null);
    try{const outcome=await request(id,'/submit',{token,confirmed:true});if(outcome.token!==token||!['ACCEPTED','REJECTED','REVIEWED','UNKNOWN'].includes(outcome.state))throw Error('Unverified confirmation response');setResult(outcome);if(outcome.state==='UNKNOWN')setState(current=>({...current,blocked:true}));clearConfirmation(token);}
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
          setResult(outcome);setError('');if(attempt.state==='UNKNOWN')setState(current=>({...current,blocked:true}));
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
  return <section className="pm-trading" aria-label="Account trading">
    <div className={`pm-trading-account ${account.environment==='live'?'pm-live':''}`}><strong>{account.environment==='demo'?'DEMO · Practice money':'LIVE · Real money'}</strong><span>{owner} · {account.label}</span><small>Trading 212 account {account.snapshot?.brokerId} · {account.snapshot?.currency}</small></div>
    {recoveryToken&&<section className="pm-alert pm-order-recovery" aria-label="Order confirmation status" role="status"><h3>Checking submitted order</h3><p>{recoveryError||'Waiting for the confirmation result. This order will not be resent.'}</p>{recoveryAttempt&&<p>{recoveryAttempt.action==='CANCEL'?`Cancellation · #${recoveryAttempt.orderId}`:`${recoveryAttempt.side} · ${recoveryAttempt.ticker} · ${recoveryAttempt.type} · ${shares(recoveryAttempt.quantity)} shares`}</p>}<p>New orders are paused until the result is known. This check continues after refreshing the page.</p><button className="button outline" disabled={busy} onClick={()=>setRecoveryRefresh(value=>value+1)}>Check saved result</button>{recoveryMissing&&<><label className="pm-check"><input type="checkbox" checked={recoveryChecked} onChange={e=>setRecoveryChecked(e.target.checked)}/>I checked this confirmation in Trading 212, including pending orders and trade history.</label><button className="button outline" disabled={!recoveryChecked||busy} onClick={()=>run(async()=>{await refresh();clearConfirmation(recoveryToken);setResult({state:'REVIEWED',message:'Marked checked in Trading 212. No order was resent.'});})}>Clear checked confirmation</button></>}</section>}
    {error&&<p className="pm-alert" role="alert">{error}</p>}
    {!state?<p role="status">Loading trading settings…</p>:!account.connected?<p>Reconnect this account to trade.</p>:!state.enabled?<div className="pm-trading-enable">
      <h3>Trading is disabled for this account</h3><p>The account owner must enable Metadata, Orders: Read and Orders: Execute on their Trading 212 API key. Update the connection if the key or secret changes.</p>
      <label className="pm-check"><input type="checkbox" checked={authorized} onChange={e=>setAuthorized(e.target.checked)}/>The account owner authorizes me to place and cancel orders in this {account.environment==='demo'?'demo':'real-money'} account.</label>
      <button className="button primary" disabled={!authorized||busy} onClick={()=>run(async()=>{setState(await request(id,'/settings',{enabled:true,authorized:true}));setAuthorized(false);})}>Enable {account.environment==='demo'?'demo':'live'} trading</button>
    </div>:<>
      <p className="pm-history-state">Maximum order estimate: {state.maxOrderValue!=null?money(state.maxOrderValue,account.snapshot?.currency):'No limit set'}. Configure this in Portfolio insights → Monitor. Market fills can differ from the estimate.</p>
      <div className="pm-section-heading"><p>Trading enabled · {account.environment==='demo'?'Demo orders':'Real-money orders'}</p><button className="text-button" disabled={busy} onClick={()=>run(async()=>{setState(await request(id,'/settings',{enabled:false}));setReview(null);setOrders(null);})}>Disable trading</button></div>
      <p className="pm-history-state">Disabling trading here leaves existing broker orders active. Reconnecting a key requires enabling trading again.</p>
      {state.blocked&&<p className="pm-alert" role="status">An earlier order has an uncertain result. Check Trading 212 and mark that attempt reviewed below before submitting another order.</p>}
      {review?<div className="pm-order-review" aria-label="Order review">
        <h3>{review.action==='CANCEL'?'Review cancellation':`Review ${review.side.toLowerCase()} order`}</h3>
        <dl><div><dt>Account</dt><dd>{owner} · {account.label} · {review.environment.toUpperCase()} · {review.brokerId}</dd></div>{review.action==='CANCEL'?<><div><dt>Order</dt><dd>#{review.orderId} · {review.order.side} · {review.order.ticker}</dd></div><div><dt>Shares</dt><dd>{review.order.quantity??'Value order'}</dd></div></>:<><div><dt>Stock / ETF</dt><dd>{review.name} · {review.ticker}</dd></div><div><dt>Order</dt><dd>{review.side} · {review.quantity} shares · {review.type}</dd></div><div><dt>Trading session</dt><dd>{review.type==='LIMIT'?'Set by broker · not selectable here':sessionLabel(review)}</dd></div><div><dt>{review.type==='LIMIT'?'Limit price':'Market reference price'}</dt><dd>{priceMoney(review.referencePrice,review.currency)}</dd></div><div><dt>Account order limit</dt><dd>{review.maxOrderValue!=null?money(review.maxOrderValue,review.currency):'No limit set'}</dd></div><div><dt>Estimated value, before additional charges</dt><dd>{money(review.estimate,review.currency)}</dd></div><div><dt>Shares · before → after full fill</dt><dd>{shares(review.currentShares)} → {shares(review.remainingShares)}</dd></div><div><dt>Available cash · before → estimated after</dt><dd>{money(review.availableCash,review.currency)} → {money(review.remainingCash,review.currency)}</dd></div>{review.requestedCashAmount!==null&&review.requestedCashAmount!==undefined&&<div><dt>Requested amount</dt><dd>{money(review.requestedCashAmount,review.currency)} · converted to the fixed share quantity above</dd></div>}{review.side==='SELL'&&<div><dt>Estimated sale profit / loss</dt><dd className={tone(review.estimatedProfit)}>{money(review.estimatedProfit,review.currency)} ({percent(review.estimatedProfitPercent)})</dd></div>}{review.side==='SELL'&&<div><dt>Available shares</dt><dd>{review.availableShares}</dd></div>}{review.type==='LIMIT'&&<div><dt>Duration</dt><dd>{review.timeValidity==='DAY'?'Day':'Good until cancelled'}</dd></div>}</>}</dl>
        {review.sellAll&&<p className="pm-cash-conversion pm-sell-all" role="status">Sell all available shares: {review.quantity}. No rounding. Confirming sends this exact quantity to Trading 212.</p>}
        {review.requestedQuantity!=null&&<p className="pm-cash-conversion" role="status">Rounded down from {review.requestedQuantity} to {review.quantity} shares ({review.quantityPrecision} decimal places). Confirming sends only the adjusted quantity.</p>}
        {review.marketCashLimit!=null&&<p className="pm-market-budget">Market buy budget: {money(review.marketCashLimit,review.currency)}. The app leaves {MARKET_BUY_BUFFER_PERCENT}% of available cash for price changes and charges. This is an estimate, not a guaranteed fill price or total cost.</p>}
        {review.priceQuote&&<p className="pm-history-state">{quoteNote(review.priceQuote)}</p>}{review.action!=='CANCEL'&&<small>After values assume a full fill at the reference price, before fees and taxes. Sale profit uses the holding’s average cost; the broker’s final result can differ.</small>}<p>{review.action==='CANCEL'?'Cancellation may arrive after a fill. Check the final broker status.':review.type==='MARKET'?(review.extendedHours?'This order permits pre-market, after-hours and overnight execution where the broker supports it. Thin liquidity can delay execution or change the fill price.':'This order permits regular-session execution only and waits when that session is closed.')+' The final execution price can differ from the reference price.':'A limit order may remain pending or fill partially. This API does not let us select its trading session. Use Trading 212 directly to choose 24/5 for a limit order.'}</p>
        <label className="pm-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I confirm this {review.environment==='demo'?'demo':'real-money'} {review.action==='CANCEL'?'cancellation':review.side.toLowerCase()+' order'} for the account shown above.</label>
        <div className="pm-actions"><button className="button primary" disabled={!confirmed||busy||seconds===0||orderBlocked} onClick={()=>run(submit)}>{review.action==='CANCEL'?'Confirm cancellation':`Confirm ${review.environment==='demo'?'demo':'live'} ${review.side.toLowerCase()}`}</button><button className="button outline" disabled={busy} onClick={()=>setReview(null)}>Back</button><small>{seconds?`Review expires in ${seconds}s`:'Review expired. Go back and review again.'}</small></div>
      </div>:<form onSubmit={e=>{e.preventDefault();if(exceedsMarketBudget||orderBlocked||sellBlocked||!sizedQuantity)return;run(()=>prepare({side,type,...(type==='MARKET'?{extendedHours}:{}),ticker:instrument?.ticker,...(sizeMode==='cash'?{cashAmount:Number(cashAmount)}:{quantity:Number(quantity),...(side==='SELL'?{sellAll}:{})}),limitPrice:Number(limit),timeValidity:validity}));}}>
        <div className="pm-trade-fields"><label>Side<select value={side} onChange={e=>setSide(e.target.value)}><option value="BUY">Buy</option><option value="SELL">Sell</option></select></label><label>Order type<select value={type} onChange={e=>{setType(e.target.value);setPreset(null);setLevelChoice('');}}><option value="MARKET">Market</option><option value="LIMIT">Limit</option></select></label></div>
        <label>Find a stock or ETF<input aria-label="Find a stock or ETF" value={query} onChange={e=>{setQuery(e.target.value);setInstrument(null);}} placeholder="Name, broker ticker or ISIN" autoComplete="off"/></label>
        {!instrument&&matches.length>0&&<div className="pm-instrument-results" aria-label="Broker instruments">{matches.map(item=><button type="button" key={item.ticker} onClick={()=>{setInstrument(item);setMatches([]);}}><strong>{item.name}</strong><span>{item.ticker} · {item.currency} · {item.type}</span></button>)}</div>}
        {instrument&&<p className="pm-selected-instrument">{instrument.name} · {instrument.ticker} · {instrument.currency} <button type="button" className="text-button" onClick={()=>setInstrument(null)}>Change</button></p>}
        {instrument&&<StockHours accountId={account.id} connected={account.connected} ticker={instrument.ticker} name={instrument.name}/>}
        {instrument&&<div className="pm-order-session">{type==='MARKET'?<><label>Trading session<select aria-label="Trading session" value={extendedHours?'extended':'regular'} onChange={e=>setSessionChoice(e.target.value)}><option value="extended" disabled={!instrument.extendedHours}>24/5 · Extended sessions</option><option value="regular">Regular hours only</option></select></label><p className="pm-history-state">{instrument.extendedHours?'Extended sessions include pre-market, after-hours and overnight where this stock is eligible. Orders can still wait for liquidity or an open session.':'The broker has not confirmed extended-session eligibility for this stock. Regular-hours execution is available.'}</p></>:<p className="pm-history-state">To request extended-session execution here, choose a Market order. For a limit order with 24/5 selected, use Trading 212 directly; its API does not expose that session setting.</p>}</div>}

        {instrument&&<section className="pm-order-holding" aria-label="Current holding">
          <div className="pm-section-heading"><h3>Current holding</h3><button type="button" className="text-button" disabled={busy||holding?.loading||position&&now-position.checkedAt<5000} onClick={()=>setHoldingRefresh(value=>value+1)}>Refresh holding</button></div>
          {holding?.loading||!holding?<p role="status">Checking shares and value…</p>:holding.error?<p role="status">{holding.error}</p>:<>
            <dl><div><dt>Current shares</dt><dd>{shares(position?.shares)}</dd></div><div><dt>Position value · {position?.currency}</dt><dd>{money(position?.value,position?.currency)}</dd></div><div><dt>{position?.priceQuote?.source==='Yahoo Finance'?'Latest market price':'Current price'} · {position?.instrumentCurrency}</dt><dd>{priceMoney(position?.price,position?.instrumentCurrency)}</dd></div><div><dt>Average purchase price</dt><dd>{priceMoney(position?.averagePrice,position?.instrumentCurrency)}</dd></div><div className="pm-holding-profit"><dt>Holding profit / loss · {position?.currency}</dt><dd className={tone(position?.unrealized)}>{money(position?.unrealized,position?.currency)} <small className={tone(position?.unrealized)}>{percent(position?.unrealizedPercent)}</small></dd></div><div><dt>Available to sell</dt><dd>{shares(position?.availableShares)} shares</dd></div><div><dt>Available cash · {position?.currency}</dt><dd>{money(position?.availableCash,position?.currency)}</dd></div></dl>
            {position?.priceQuote&&<p className="pm-history-state">{quoteNote(position.priceQuote)}</p>}{!priceFresh&&position?.price>0&&<p className="pm-history-state">Refresh the quote to update the market estimate.</p>}
            <small>{fresh?'Checked':'Last checked'} {clockStamp(position?.checkedAt)} {zoneLabel}{!fresh?' · Refresh to use shortcuts':''}</small>
          </>}
        </section>}
        <div className="pm-size-mode" role="group" aria-label="Size order by"><button type="button" aria-pressed={sizeMode==='shares'} onClick={()=>{setQuantity(sizedQuantity);setSizeMode('shares');setFullSaleIntent(false);}}>Shares</button><button type="button" aria-pressed={sizeMode==='cash'} onClick={()=>{setCashAmount(estimate!==null?String(Number(estimate.toFixed(2))):'');setSizeMode('cash');setPreset(null);setFullSaleIntent(false);}}>Cash amount</button></div>
        <div className="pm-trade-fields">{sizeMode==='cash'?<label>Cash amount · {account.snapshot?.currency}<input aria-label="Order cash amount" required type="number" min="0.01" step="0.01" value={cashAmount} onChange={e=>{setCashAmount(e.target.value);setPreset(null);}}/></label>:<label>Shares<input aria-label="Order shares" required type="number" min="0.00000001" step="any" value={quantity} onChange={e=>{setQuantity(e.target.value);setPreset(null);setFullSaleIntent(side==='SELL'&&sellReady&&Number(e.target.value)===position.availableShares);}}/></label>}{type==='LIMIT'&&<><label>Limit price · {account.snapshot?.currency}<input aria-label="Order limit price" required type="number" min="0.00000001" step="any" value={limit} onChange={e=>{setLimit(e.target.value);setLevelChoice('');setPreset(null);}}/></label><label>Duration<select value={validity} onChange={e=>setValidity(e.target.value)}><option value="DAY">Day</option><option value="GOOD_TILL_CANCEL">Good until cancelled</option></select></label></>}</div>
        {instrument&&!sellAll&&<p className="pm-history-state">Buys and partial sales use up to {quantityPrecision} decimal places and round down. Sell all preserves the exact available shares.</p>}
        {sellAll&&!fullSaleChanged&&<p className="pm-cash-conversion pm-sell-all" role="status">Sell all available shares: {sizedQuantity}. No rounding. Review and confirmation will use this exact quantity.</p>}
        {fullSaleChanged&&<p className="pm-alert" role="status">Available shares changed. Select 100% again to review the new quantity.</p>}
        {quantityAdjusted&&!sellBlocked&&<p className="pm-cash-conversion" role="status">Will review {sizedQuantity} shares, rounded down from {quantity}.</p>}
        {remainder?.belowStep&&<p className="pm-alert pm-sell-remainder" role="status">This partial sale would leave {remainder.shares} available shares. The broker may reject a small remaining position. <button type="button" className="text-button" disabled={!percentageQuantity(100)||orderBlocked} onClick={()=>selectPercentage(100)}>Use 100% without rounding</button></p>}
        {side==='SELL'&&!sellReady&&instrument&&!holding?.loading&&<p className="pm-history-state" role="status">Refresh the holding to check available shares before reviewing a sale.</p>}
        {sizeMode==='shares'&&Number(quantity)>0&&!sizedQuantity&&<p className="pm-cash-conversion" role="status">Enter at least {10**-quantityPrecision} shares and no more than 1,000,000.</p>}
        {sizeMode==='cash'&&<p className="pm-cash-conversion" role="status">{sizedQuantity?`Estimated quantity: ${sizedQuantity} shares. The review fixes the share quantity; the final cash amount can change at execution.`:Number(cashAmount)>0&&Number(sizingPrice)>0?`This amount cannot produce a quantity between ${10**-quantityPrecision} and 1,000,000 shares. Adjust the cash amount.`:type==='LIMIT'?'Enter a cash amount and a limit price.':'Enter a cash amount. A market quote is required to calculate shares; refresh if unavailable.'}</p>}
        {instrument&&type==='LIMIT'&&<div className="pm-order-levels">
          {levels?<><label>Use a chart level<select aria-label="Use a chart level" value={levelChoice} onChange={e=>{const selected=levels.options.find(o=>o.id===e.target.value);setLevelChoice(e.target.value);if(selected){setLimit(String(selected.price));setPreset(null);}}}><option value="">Choose a price…</option>{levels.options.map(option=><option key={option.id} value={option.id}>{option.label} · {priceMoney(option.price,instrument.currency)}</option>)}</select></label><small>{levels.listing} · sheet {levels.date} · {levels.timeframe}. Original imported zone prices; selecting one fills the limit price for review.</small></>:<small>No matching imported chart levels for this listing and currency.</small>}
        </div>}
        {instrument&&<div className="pm-order-sizing">
          <span id="pm-size-label">{side==='SELL'?'% of available shares':'% of available cash'}</span>
          <div className="pm-order-percentages" role="group" aria-labelledby="pm-size-label">{[25,50,75,100].map(percent=><button key={percent} type="button" disabled={!percentageQuantity(percent)||orderBlocked} aria-pressed={preset===percent} onClick={()=>selectPercentage(percent)}>{percent}%</button>)}</div>
          {side==='SELL'?<small>100% uses the exact available shares without rounding. Reserved shares and shares in pies may be excluded. Trading 212 validates the order after confirmation.</small>:<small>{Number(sizingPrice)>0?'Cash sizing is an estimate before fees; market prices can move.':type==='LIMIT'?'Enter a limit price to size by cash.':'Market quote unavailable. Refresh to size by cash, or enter shares directly.'}</small>}
          {marketCashLimit!==null&&<div className="pm-market-budget">
            <p>Market buy budget: <strong>{money(marketCashLimit,position.currency)}</strong>. The 100% button uses up to {100-MARKET_BUY_BUFFER_PERCENT}% of available cash, leaving at least {money(position.availableCash-marketCashLimit,position.currency)} for price changes and charges.</p>
            {exceedsMarketBudget&&<p role="status">This estimate exceeds the Market buy budget. Reduce the amount or select 100% to recalculate with the cash buffer.</p>}
            {estimate!==null&&<p>Estimated cash left after the trade: <strong>{money(position.availableCash-estimate,position.currency)}</strong>, before additional charges.</p>}
          </div>}
          <p className="pm-order-estimate">Estimated order value <strong>{money(estimate,position?.currency)}</strong></p>
        </div>}
        <p className="pm-history-state">Trades use share quantities. This version supports stocks and ETFs in the primary account currency. Sell quantities use shares available for trading; shares in pies or reserved orders may be excluded.</p>
        <button className="button primary" disabled={busy||!instrument||holding?.loading||orderBlocked||!sizedQuantity||exceedsMarketBudget||sellBlocked} type="submit">{busy?'Checking broker…':'Review order'}</button>
      </form>}
      {result&&<div className={`pm-order-result ${result.state==='UNKNOWN'?'pm-alert':''}`} role="status"><strong>{result.state==='UNKNOWN'?'Result uncertain':result.state==='REJECTED'?'Order rejected':result.state==='NOT_SENT'?'Order not submitted':result.state==='REVIEWED'?'Confirmation checked':result.action==='CANCEL'?'Cancellation requested':'Broker response'}</strong>{result.action==='ORDER'&&<p>{result.side} · {result.ticker} · {result.type} · {shares(result.quantity)} shares</p>}<p>{result.message}</p><SellRejectionHelp attempt={result}/>{result.brokerCode==='insufficient-free-for-stocks-buy'&&<p>The broker could not fund this buy. Refresh the holding to check available cash and pending orders, then review a smaller quantity. Market execution prices can differ from the displayed price. This order has not been retried.</p>}{result.order&&<p>#{result.order.id} · {result.order.status} · {result.order.filledQuantity??'—'} shares filled</p>}</div>}
      <div className="pm-section-heading pm-orders-heading"><h3>Orders & recent activity</h3><button className="button outline" disabled={busy} onClick={()=>run(pending)}>Refresh orders</button></div>
      <p className="pm-history-state">The server checks orders every 15 seconds, including after leaving this page. Filled shares refresh holdings and cash automatically. Final status uses History: Orders permission. Submitted orders keep their original session settings. Before replacing a pending order, wait for confirmed cancellation to avoid duplicate trades.</p>
      {(trackingError||orders?.error||orders?.historyError||orders?.balanceError)&&<p className="pm-alert" role="status">{trackingError||orders.error||orders.historyError||orders.balanceError}</p>}
      {!orders?<p className="pm-history-state">Checking broker orders…</p>:<>{orders.checkedAt&&<p className="pm-history-state">Orders checked {clockStamp(orders.checkedAt)} {zoneLabel}{orders.balanceError?'':orders.syncedRevision>0?' · Holdings and cash refreshed':''}</p>}{orders.orders.length?orders.orders.map(order=><div className="pm-pending-order" key={order.id}><div><strong>{order.side} {order.quantity??money(order.value,order.currency)} · {order.name}</strong><span className={`pm-order-status ${order.status==='FILLED'?'green':order.status==='REJECTED'?'red':''}`}>{statusLabel(order.status)}</span><small>#{order.id} · {order.ticker} · {order.type} · filled {shares(order.filledQuantity)}{order.quantity!==null?` / ${shares(order.quantity)} shares`:''}</small><small>{sessionLabel(order)}</small>{order.awaitingHistory&&<small>Not in pending orders. Waiting for a confirmed final status from broker history.</small>}</div>{!order.awaitingHistory&&!['CANCELLING','FILLED','CANCELLED','REJECTED','REPLACED'].includes(order.status)&&<button className="button outline" disabled={busy||orderBlocked} onClick={()=>run(()=>prepare({action:'CANCEL',orderId:order.id}))}>Review cancellation</button>}</div>):<p>No tracked orders yet.</p>}</>}

    </>}
    {state?.attempts.length>0&&<details className="pm-trade-attempts" open={state.blocked}><summary>Recent order attempts</summary>{state.attempts.map(attempt=><div key={attempt.token}><strong>{attempt.action==='CANCEL'?'CANCEL #'+attempt.orderId:attempt.side+' '+attempt.quantity+' '+attempt.ticker} · {attempt.state}</strong><p>{attempt.message}</p><SellRejectionHelp attempt={attempt}/>{attempt.action==='ORDER'&&attempt.type==='MARKET'&&<small>Requested: {sessionLabel(attempt)}</small>}<small>{clockStamp(attempt.createdAt)} {zoneLabel} · {attempt.environment?.toUpperCase()} · account {attempt.brokerId}</small>{attempt.state==='UNKNOWN'&&<><label className="pm-check"><input type="checkbox" disabled={busy} checked={checkedAttempt===attempt.token} onChange={e=>setCheckedAttempt(e.target.checked?attempt.token:null)}/>I checked this attempt’s outcome in Trading 212, including pending orders and trade history.</label><button className="button outline" disabled={busy||checkedAttempt!==attempt.token} onClick={()=>run(async()=>{setState(await request(id,'/acknowledge',{token:attempt.token,checkedBroker:true}));setCheckedAttempt(null);})}>Mark reviewed</button></>}</div>)}</details>}
  </section>;
}
