import {StockHours} from './PortfolioHours';
import {useEffect,useRef,useState} from 'react';
import {apiFetch} from './auth-client';
import {useDisplayTime} from './DisplayTime';
import {cashOrderQuantity,orderPercentage} from './data/portfolio-order-size.mjs';
import {portfolioOrderLevels} from './data/portfolio-order-levels.mjs';

const money=(value,currency)=>Number.isFinite(value)&&currency?new Intl.NumberFormat('en-US',{style:'currency',currency}).format(value):'—';
const priceMoney=(value,currency)=>Number.isFinite(value)&&currency?new Intl.NumberFormat('en-US',{style:'currency',currency,maximumFractionDigits:8}).format(value):'—';
const shares=value=>Number.isFinite(value)?new Intl.NumberFormat('en-US',{maximumFractionDigits:8}).format(value):'—';
const percent=value=>Number.isFinite(value)?`${value>0?'+':''}${value.toFixed(2)}%`:'—';
const tone=value=>value>0?'green':value<0?'red':'';
const sessionLabel=order=>order.extendedHours===true?'Extended sessions · 24/5 where available':order.extendedHours===false?'Regular hours only':'Session not reported by broker';
const statusLabel=status=>({NEW:'Pending',LOCAL:'Pending',UNCONFIRMED:'Pending',CONFIRMED:'Pending',PARTIALLY_FILLED:'Partially filled',FILLED:'Filled',CANCELLED:'Cancelled',REJECTED:'Rejected',REPLACING:'Replacing',REPLACED:'Replaced',CANCELLING:'Cancelling'}[status]||status);
async function request(id,path='',body,signal){
  const res=await apiFetch(`/api/portfolio/accounts/${id}/trading${path}`,{method:body===undefined?'GET':'POST',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(25000)]):AbortSignal.timeout(25000),...(body===undefined?{}:{headers:{'Content-Type':'application/json','X-Opening-Bell-Client':'web'},body:JSON.stringify(body)})});
  const data=await res.json();if(!res.ok)throw Object.assign(Error(data.message||'The trading request could not be completed.'),{status:res.status});return data;
}
export function PortfolioTrading({account,owner,initialHolding,initialSide='BUY',sheet,watchlist,onPortfolioChange}){
  const [state,setState]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[authorized,setAuthorized]=useState(false),[query,setQuery]=useState(initialHolding?.ticker||''),[matches,setMatches]=useState([]),[instrument,setInstrument]=useState(null),[side,setSide]=useState(initialSide),[type,setType]=useState('LIMIT'),[quantity,setQuantity]=useState(''),[limit,setLimit]=useState(''),[validity,setValidity]=useState('DAY'),[review,setReview]=useState(null),[confirmed,setConfirmed]=useState(false),[result,setResult]=useState(null),[orders,setOrders]=useState(null),[checkedAttempt,setCheckedAttempt]=useState(null),[now,setNow]=useState(Date.now());
  const {clockStamp,zoneLabel}=useDisplayTime(),id=account.id;
  const [holdingState,setHoldingState]=useState(null),[holdingRefresh,setHoldingRefresh]=useState(0),[preset,setPreset]=useState(null);
  const [sizeMode,setSizeMode]=useState('shares'),[cashAmount,setCashAmount]=useState(''),[levelChoice,setLevelChoice]=useState(''),[trackingError,setTrackingError]=useState('');
  const synced=useRef(null),trackingBusy=useRef(false);
  const ticker=instrument?.ticker;
  const [sessionChoice,setSessionChoice]=useState('extended');
  const extendedHours=type==='MARKET'&&instrument?.extendedHours===true&&sessionChoice==='extended';
  useEffect(()=>setSessionChoice('extended'),[id,ticker]);
  useEffect(()=>{setQuantity('');setCashAmount('');setPreset(null);},[id,ticker,side]);
  useEffect(()=>{setLimit('');setLevelChoice('');},[id,ticker]);
  useEffect(()=>{
    if(!state?.enabled||!ticker||busy||review)return;
    let active=true,controller,retry;
    async function load(attempt=0){
      if(controller&&!controller.signal.aborted)controller.abort();
      controller=new AbortController();const signal=controller.signal;
      setHoldingState({id,ticker,loading:true});setPreset(null);
      try{const data=await request(id,'/position?'+new URLSearchParams({ticker}),undefined,signal);if(active&&!signal.aborted)setHoldingState({id,ticker,data});}
      catch(e){if(active&&!signal.aborted){if(e.status===409&&attempt<3)retry=setTimeout(()=>load(attempt+1),2000);else setHoldingState({id,ticker,error:e.message});}}
    }
    load();const timer=setInterval(()=>{if(!document.hidden)load();},60000);
    return()=>{active=false;controller?.abort();clearTimeout(retry);clearInterval(timer);};
  },[id,ticker,state?.enabled,busy,review,holdingRefresh]);
  const holding=holdingState?.id===id&&holdingState?.ticker===ticker?holdingState:null,position=holding?.data;
  const fresh=position&&now-position.checkedAt<65000&&now-position.checkedAt>=-5000;
  const sameCurrency=instrument?.currency===position?.currency;
  const sizingPrice=type==='LIMIT'?Number(limit):position?.price;
  const sizedQuantity=sizeMode==='cash'?(fresh&&sameCurrency?cashOrderQuantity(Number(cashAmount),sizingPrice):''):quantity;
  const levels=portfolioOrderLevels(instrument,account.snapshot?.currency,sheet,watchlist);
  const percentageQuantity=percent=>fresh&&sameCurrency&&!busy?orderPercentage({side,percent,availableShares:position.availableShares,availableCash:position.availableCash,price:sizingPrice}):'';
  const estimate=fresh&&sameCurrency&&Number(sizedQuantity)>0&&Number(sizingPrice)>0?Number(sizedQuantity)*sizingPrice:null;
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
  async function prepare(body){setResult(null);setConfirmed(false);setReview(await request(id,'/preview',body));}
  async function submit(){
    const token=review.token;setReview(null);
    try{setResult(await request(id,'/submit',{token,confirmed:true}));}
    catch{setError('The result was not received. Check recent attempts below and Trading 212 before submitting anything again.');}
    finally{await refresh();}
  }
  const seconds=review?Math.min(60,Math.max(0,Math.ceil((review.expiresAt-now)/1000))):0;
  return <section className="pm-trading" aria-label="Account trading">
    <div className={`pm-trading-account ${account.environment==='live'?'pm-live':''}`}><strong>{account.environment==='demo'?'DEMO · Practice money':'LIVE · Real money'}</strong><span>{owner} · {account.label}</span><small>Trading 212 account {account.snapshot?.brokerId} · {account.snapshot?.currency}</small></div>
    {error&&<p className="pm-alert" role="alert">{error}</p>}
    {!state?<p role="status">Loading trading settings…</p>:!account.connected?<p>Reconnect this account to trade.</p>:!state.enabled?<div className="pm-trading-enable">
      <h3>Trading is disabled for this account</h3><p>The account owner must enable Metadata, Orders: Read and Orders: Execute on their Trading 212 API key. Update the connection if the key or secret changes.</p>
      <label className="pm-check"><input type="checkbox" checked={authorized} onChange={e=>setAuthorized(e.target.checked)}/>The account owner authorizes me to place and cancel orders in this {account.environment==='demo'?'demo':'real-money'} account.</label>
      <button className="button primary" disabled={!authorized||busy} onClick={()=>run(async()=>{setState(await request(id,'/settings',{enabled:true,authorized:true}));setAuthorized(false);})}>Enable {account.environment==='demo'?'demo':'live'} trading</button>
    </div>:<>
      <div className="pm-section-heading"><p>Trading enabled · {account.environment==='demo'?'Demo orders':'Real-money orders'}</p><button className="text-button" disabled={busy} onClick={()=>run(async()=>{setState(await request(id,'/settings',{enabled:false}));setReview(null);setOrders(null);})}>Disable trading</button></div>
      <p className="pm-history-state">Disabling trading here leaves existing broker orders active. Reconnecting a key requires enabling trading again.</p>
      {state.blocked&&<p className="pm-alert" role="status">An earlier order has an uncertain result. Check Trading 212 and mark that attempt reviewed below before submitting another order.</p>}
      {review?<div className="pm-order-review" aria-label="Order review">
        <h3>{review.action==='CANCEL'?'Review cancellation':`Review ${review.side.toLowerCase()} order`}</h3>
        <dl><div><dt>Account</dt><dd>{owner} · {account.label} · {review.environment.toUpperCase()} · {review.brokerId}</dd></div>{review.action==='CANCEL'?<><div><dt>Order</dt><dd>#{review.orderId} · {review.order.side} · {review.order.ticker}</dd></div><div><dt>Shares</dt><dd>{review.order.quantity??'Value order'}</dd></div></>:<><div><dt>Stock / ETF</dt><dd>{review.name} · {review.ticker}</dd></div><div><dt>Order</dt><dd>{review.side} · {review.quantity} shares · {review.type}</dd></div><div><dt>Trading session</dt><dd>{review.type==='LIMIT'?'Set by broker · not selectable here':sessionLabel(review)}</dd></div><div><dt>{review.type==='LIMIT'?'Limit price':'Broker reference price'}</dt><dd>{priceMoney(review.referencePrice,review.currency)}</dd></div><div><dt>Estimated value, before additional charges</dt><dd>{money(review.estimate,review.currency)}</dd></div><div><dt>Shares · before → after full fill</dt><dd>{shares(review.currentShares)} → {shares(review.remainingShares)}</dd></div><div><dt>Available cash · before → estimated after</dt><dd>{money(review.availableCash,review.currency)} → {money(review.remainingCash,review.currency)}</dd></div>{review.requestedCashAmount!==null&&review.requestedCashAmount!==undefined&&<div><dt>Requested amount</dt><dd>{money(review.requestedCashAmount,review.currency)} · converted to the fixed share quantity above</dd></div>}{review.side==='SELL'&&<div><dt>Estimated sale profit / loss</dt><dd className={tone(review.estimatedProfit)}>{money(review.estimatedProfit,review.currency)} ({percent(review.estimatedProfitPercent)})</dd></div>}{review.side==='SELL'&&<div><dt>Available shares</dt><dd>{review.availableShares}</dd></div>}{review.type==='LIMIT'&&<div><dt>Duration</dt><dd>{review.timeValidity==='DAY'?'Day':'Good until cancelled'}</dd></div>}</>}</dl>
        {review.action!=='CANCEL'&&<small>After values assume a full fill at the reference price, before fees and taxes. Sale profit uses the holding’s average cost; the broker’s final result can differ.</small>}<p>{review.action==='CANCEL'?'Cancellation may arrive after a fill. Check the final broker status.':review.type==='MARKET'?(review.extendedHours?'This order permits pre-market, after-hours and overnight execution where the broker supports it. Thin liquidity can delay execution or change the fill price.':'This order permits regular-session execution only and waits when that session is closed.')+' The final execution price can differ from the reference price.':'A limit order may remain pending or fill partially. This API does not let us select its trading session. Use Trading 212 directly to choose 24/5 for a limit order.'}</p>
        <label className="pm-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I confirm this {review.environment==='demo'?'demo':'real-money'} {review.action==='CANCEL'?'cancellation':review.side.toLowerCase()+' order'} for the account shown above.</label>
        <div className="pm-actions"><button className="button primary" disabled={!confirmed||busy||seconds===0||state.blocked} onClick={()=>run(submit)}>{review.action==='CANCEL'?'Confirm cancellation':`Confirm ${review.environment==='demo'?'demo':'live'} ${review.side.toLowerCase()}`}</button><button className="button outline" disabled={busy} onClick={()=>setReview(null)}>Back</button><small>{seconds?`Review expires in ${seconds}s`:'Review expired. Go back and review again.'}</small></div>
      </div>:<form onSubmit={e=>{e.preventDefault();run(()=>prepare({side,type,...(type==='MARKET'?{extendedHours}:{}),ticker:instrument?.ticker,...(sizeMode==='cash'?{cashAmount:Number(cashAmount)}:{quantity:Number(quantity)}),limitPrice:Number(limit),timeValidity:validity}));}}>
        <div className="pm-trade-fields"><label>Side<select value={side} onChange={e=>setSide(e.target.value)}><option value="BUY">Buy</option><option value="SELL">Sell</option></select></label><label>Order type<select value={type} onChange={e=>{setType(e.target.value);setPreset(null);}}><option value="LIMIT">Limit</option><option value="MARKET">Market</option></select></label></div>
        <label>Find a stock or ETF<input aria-label="Find a stock or ETF" value={query} onChange={e=>{setQuery(e.target.value);setInstrument(null);}} placeholder="Name, broker ticker or ISIN" autoComplete="off"/></label>
        {!instrument&&matches.length>0&&<div className="pm-instrument-results" aria-label="Broker instruments">{matches.map(item=><button type="button" key={item.ticker} onClick={()=>{setInstrument(item);setMatches([]);}}><strong>{item.name}</strong><span>{item.ticker} · {item.currency} · {item.type}</span></button>)}</div>}
        {instrument&&<p className="pm-selected-instrument">{instrument.name} · {instrument.ticker} · {instrument.currency} <button type="button" className="text-button" onClick={()=>setInstrument(null)}>Change</button></p>}
        {instrument&&<StockHours accountId={account.id} connected={account.connected} ticker={instrument.ticker} name={instrument.name}/>}
        {instrument&&<div className="pm-order-session">{type==='MARKET'?<><label>Trading session<select aria-label="Trading session" value={extendedHours?'extended':'regular'} onChange={e=>setSessionChoice(e.target.value)}><option value="extended" disabled={!instrument.extendedHours}>24/5 · Extended sessions</option><option value="regular">Regular hours only</option></select></label><p className="pm-history-state">{instrument.extendedHours?'Extended sessions include pre-market, after-hours and overnight where this stock is eligible. Orders can still wait for liquidity or an open session.':'The broker has not confirmed extended-session eligibility for this stock. Regular-hours execution is available.'}</p></>:<p className="pm-history-state">To request extended-session execution here, choose a Market order. For a limit order with 24/5 selected, use Trading 212 directly; its API does not expose that session setting.</p>}</div>}

        {instrument&&<section className="pm-order-holding" aria-label="Current holding">
          <div className="pm-section-heading"><h3>Current holding</h3><button type="button" className="text-button" disabled={busy||holding?.loading||position&&now-position.checkedAt<5000} onClick={()=>setHoldingRefresh(value=>value+1)}>Refresh holding</button></div>
          {holding?.loading||!holding?<p role="status">Checking shares and value…</p>:holding.error?<p role="status">{holding.error}</p>:<>
            <dl><div><dt>Current shares</dt><dd>{shares(position?.shares)}</dd></div><div><dt>Position value · {position?.currency}</dt><dd>{money(position?.value,position?.currency)}</dd></div><div><dt>Current price · {position?.instrumentCurrency}</dt><dd>{priceMoney(position?.price,position?.instrumentCurrency)}</dd></div><div><dt>Average purchase price</dt><dd>{priceMoney(position?.averagePrice,position?.instrumentCurrency)}</dd></div><div className="pm-holding-profit"><dt>Holding profit / loss · {position?.currency}</dt><dd className={tone(position?.unrealized)}>{money(position?.unrealized,position?.currency)} <small className={tone(position?.unrealized)}>{percent(position?.unrealizedPercent)}</small></dd></div><div><dt>Available to sell</dt><dd>{shares(position?.availableShares)} shares</dd></div><div><dt>Available cash · {position?.currency}</dt><dd>{money(position?.availableCash,position?.currency)}</dd></div></dl>
            <small>{fresh?'Checked':'Last checked'} {clockStamp(position?.checkedAt)} {zoneLabel}{!fresh?' · Refresh to use shortcuts':''}</small>
          </>}
        </section>}
        <div className="pm-size-mode" role="group" aria-label="Size order by"><button type="button" aria-pressed={sizeMode==='shares'} onClick={()=>{setQuantity(sizedQuantity);setSizeMode('shares');}}>Shares</button><button type="button" aria-pressed={sizeMode==='cash'} onClick={()=>{setCashAmount(estimate!==null?String(Number(estimate.toFixed(2))):'');setSizeMode('cash');setPreset(null);}}>Cash amount</button></div>
        <div className="pm-trade-fields">{sizeMode==='cash'?<label>Cash amount · {account.snapshot?.currency}<input aria-label="Order cash amount" required type="number" min="0.01" step="0.01" value={cashAmount} onChange={e=>{setCashAmount(e.target.value);setPreset(null);}}/></label>:<label>Shares<input aria-label="Order shares" required type="number" min="0.00000001" step="0.00000001" value={quantity} onChange={e=>{setQuantity(e.target.value);setPreset(null);}}/></label>}{type==='LIMIT'&&<><label>Limit price · {account.snapshot?.currency}<input aria-label="Order limit price" required type="number" min="0.00000001" step="any" value={limit} onChange={e=>{setLimit(e.target.value);setLevelChoice('');setPreset(null);}}/></label><label>Duration<select value={validity} onChange={e=>setValidity(e.target.value)}><option value="DAY">Day</option><option value="GOOD_TILL_CANCEL">Good until cancelled</option></select></label></>}</div>
        {sizeMode==='cash'&&<p className="pm-cash-conversion" role="status">{sizedQuantity?`Estimated quantity: ${sizedQuantity} shares. The review fixes the share quantity; the final cash amount can change at execution.`:'Enter an amount and a limit price, or wait for a current broker price.'}</p>}
        {instrument&&<div className="pm-order-levels">
          {levels?<><label>Use a chart level<select aria-label="Use a chart level" value={levelChoice} onChange={e=>{const selected=levels.options.find(o=>o.id===e.target.value);setLevelChoice(e.target.value);if(selected){setType('LIMIT');setLimit(String(selected.price));setPreset(null);}}}><option value="">Choose a price…</option>{levels.options.map(option=><option key={option.id} value={option.id}>{option.label} · {priceMoney(option.price,instrument.currency)}</option>)}</select></label><small>{levels.listing} · sheet {levels.date} · {levels.timeframe}. Original imported zone prices; selecting one fills the limit price for review.</small></>:<small>No matching imported chart levels for this listing and currency.</small>}
        </div>}
        {instrument&&<div className="pm-order-sizing">
          <span id="pm-size-label">{side==='SELL'?'% of available shares':'% of available cash'}</span>
          <div className="pm-order-percentages" role="group" aria-labelledby="pm-size-label">{[25,50,75,100].map(percent=><button key={percent} type="button" disabled={!percentageQuantity(percent)||state.blocked} aria-pressed={preset===percent} onClick={()=>{setQuantity(percentageQuantity(percent));setSizeMode('shares');setPreset(percent);}}>{percent}%</button>)}</div>
          {side==='SELL'?<small>Reserved shares and shares in pies may be excluded. 100% uses only shares available to sell.</small>:<small>{Number(sizingPrice)>0?'Cash sizing is an estimate before fees; market prices can move.':'Enter a limit price to size by cash when a current price is unavailable.'}</small>}
          <p className="pm-order-estimate">Estimated order value <strong>{money(estimate,position?.currency)}</strong></p>
        </div>}
        <p className="pm-history-state">Trades use share quantities. This version supports stocks and ETFs in the primary account currency. Sell quantities use shares available for trading; shares in pies or reserved orders may be excluded.</p>
        <button className="button primary" disabled={busy||!instrument||holding?.loading||state.blocked||sizeMode==='cash'&&!sizedQuantity} type="submit">{busy?'Checking broker…':'Review order'}</button>
      </form>}
      {result&&<div className={`pm-order-result ${result.state==='UNKNOWN'?'pm-alert':''}`} role="status"><strong>{result.state==='UNKNOWN'?'Result uncertain':result.state==='REJECTED'?'Order rejected':result.action==='CANCEL'?'Cancellation requested':'Broker response'}</strong><p>{result.message}</p>{result.order&&<p>#{result.order.id} · {result.order.status} · {result.order.filledQuantity??'—'} shares filled</p>}</div>}
      <div className="pm-section-heading pm-orders-heading"><h3>Orders & recent activity</h3><button className="button outline" disabled={busy} onClick={()=>run(pending)}>Refresh orders</button></div>
      <p className="pm-history-state">The server checks orders every 15 seconds, including after closing this ticket. Filled shares refresh holdings and cash automatically. Final status uses History: Orders permission. Submitted orders keep their original session settings. Before replacing a pending order, wait for confirmed cancellation to avoid duplicate trades.</p>
      {(trackingError||orders?.error||orders?.historyError||orders?.balanceError)&&<p className="pm-alert" role="status">{trackingError||orders.error||orders.historyError||orders.balanceError}</p>}
      {!orders?<p className="pm-history-state">Checking broker orders…</p>:<>{orders.checkedAt&&<p className="pm-history-state">Orders checked {clockStamp(orders.checkedAt)} {zoneLabel}{orders.balanceError?'':orders.syncedRevision>0?' · Holdings and cash refreshed':''}</p>}{orders.orders.length?orders.orders.map(order=><div className="pm-pending-order" key={order.id}><div><strong>{order.side} {order.quantity??money(order.value,order.currency)} · {order.name}</strong><span className={`pm-order-status ${order.status==='FILLED'?'green':order.status==='REJECTED'?'red':''}`}>{statusLabel(order.status)}</span><small>#{order.id} · {order.ticker} · {order.type} · filled {shares(order.filledQuantity)}{order.quantity!==null?` / ${shares(order.quantity)} shares`:''}</small><small>{sessionLabel(order)}</small>{order.awaitingHistory&&<small>Not in pending orders. Waiting for a confirmed final status from broker history.</small>}</div>{!order.awaitingHistory&&!['CANCELLING','FILLED','CANCELLED','REJECTED','REPLACED'].includes(order.status)&&<button className="button outline" disabled={busy||state.blocked} onClick={()=>run(()=>prepare({action:'CANCEL',orderId:order.id}))}>Review cancellation</button>}</div>):<p>No tracked orders yet.</p>}</>}

    </>}
    {state?.attempts.length>0&&<details className="pm-trade-attempts" open={state.blocked}><summary>Recent order attempts</summary>{state.attempts.map(attempt=><div key={attempt.token}><strong>{attempt.action==='CANCEL'?'CANCEL #'+attempt.orderId:attempt.side+' '+attempt.quantity+' '+attempt.ticker} · {attempt.state}</strong><p>{attempt.message}</p>{attempt.action==='ORDER'&&attempt.type==='MARKET'&&<small>Requested: {sessionLabel(attempt)}</small>}<small>{clockStamp(attempt.createdAt)} {zoneLabel} · {attempt.environment?.toUpperCase()} · account {attempt.brokerId}</small>{attempt.state==='UNKNOWN'&&<><label className="pm-check"><input type="checkbox" disabled={busy} checked={checkedAttempt===attempt.token} onChange={e=>setCheckedAttempt(e.target.checked?attempt.token:null)}/>I checked this attempt’s outcome in Trading 212, including pending orders and trade history.</label><button className="button outline" disabled={busy||checkedAttempt!==attempt.token} onClick={()=>run(async()=>{setState(await request(id,'/acknowledge',{token:attempt.token,checkedBroker:true}));setCheckedAttempt(null);})}>Mark reviewed</button></>}</div>)}</details>}
  </section>;
}
