import {useEffect,useRef} from 'react';
import {Briefcase,Coins,User,Warning} from '@phosphor-icons/react';
import {orderStatusLabel} from './data/portfolio-activity.mjs';
import {money,priceMoney,shares,percent,tone,sessionLabel} from './data/portfolio-order-display.mjs';
import {BrokerStatus} from './BrokerOrderStatus';

function Detail({label,children,className}){
  return <div><dt>{label}</dt><dd className={className}>{children}</dd></div>;
}

export function OrderReview({review,owner,accountLabel,listing,confirmed,onConfirmChange,seconds,busy,blocked,onBack,onSubmit,quoteNote}){
  const heading=useRef(null);
  useEffect(()=>{heading.current?.focus();},[]);
  const cancelling=review.action==='CANCEL';
  const order=cancelling?review.order:review;
  const currency=review.currency;
  const live=review.environment==='demo'?'demo':'live';
  const action=cancelling?'cancellation':review.side.toLowerCase()+' order';
  return <section className={'pm-order-review broker-review'+(cancelling?' broker-cancel':'')} aria-label="Order review">
    <header><h3 tabIndex={-1} ref={heading}>{cancelling?'Cancel this order?':`Review ${action}`}</h3>
      <p>{cancelling?'The broker may fill this order before cancellation is confirmed.':'Check the details before sending this order to Trading 212.'}</p></header>
    <div className="broker-account-strip"><span><User/>{owner}</span><span><Briefcase/>{accountLabel} · {review.environment.toUpperCase()} · {review.brokerId}</span><span><Coins/>{currency}</span></div>
    <div className="broker-review-columns"><div className="broker-review-ticket">
      <div className="broker-instrument"><b className={order.side==='BUY'?'buy':'sell'}>{order.side}</b>
        <div><strong>{listing?.symbol||order.ticker}</strong><small>{[order.name,listing?.exchange,listing&&order.ticker].filter(Boolean).join(' · ')}</small></div></div>
      <dl className="broker-facts">
        {cancelling&&<><Detail label="Order">#{review.orderId}</Detail><Detail label="Broker status"><BrokerStatus label={orderStatusLabel(order.status)}/></Detail></>}
        <Detail label="Order type">{order.type||'—'}</Detail>
        <Detail label={!Number.isFinite(order.quantity)&&Number.isFinite(order.value)?'Order value':'Quantity'}>{Number.isFinite(order.quantity)?shares(order.quantity)+(order.quantity===1?' share':' shares'):Number.isFinite(order.value)?money(order.value,order.currency):'—'}</Detail>
        {cancelling?<>
          {Number.isFinite(order.limitPrice)&&<Detail label="Limit price">{priceMoney(order.limitPrice,order.priceCurrency||order.currency)}</Detail>}
          {Number.isFinite(order.filledQuantity)&&<Detail label="Already filled">{shares(order.filledQuantity)} {order.filledQuantity===1?'share':'shares'}</Detail>}
        </>:<>
          <Detail label={order.type==='LIMIT'?'Limit price':'Market reference price'}>{priceMoney(review.referencePrice,currency)}</Detail>
          <Detail label="Estimated value, before additional charges">{money(review.estimate,currency)}</Detail>
          <Detail label="Trading session">{review.type==='LIMIT'?'Set by broker · not selectable here':sessionLabel(review)}</Detail>
          {review.type==='LIMIT'&&<Detail label="Duration">{review.timeValidity==='DAY'?'Day':'Good until cancelled'}</Detail>}
        </>}
      </dl>
    </div>
    {!cancelling&&<div className="broker-review-estimates"><h4>Account after a full fill</h4>
      <dl className="broker-facts">
        <Detail label="Shares · before → after">{shares(review.currentShares)} → {shares(review.remainingShares)}</Detail>
        <Detail label="Available cash · before → estimated after">{money(review.availableCash,currency)} → {money(review.remainingCash,currency)}</Detail>
        {review.side==='SELL'&&<><Detail label="Available shares">{shares(review.availableShares)}</Detail><Detail label="Estimated sale profit / loss" className={tone(review.estimatedProfit)}>{money(review.estimatedProfit,currency)} ({percent(review.estimatedProfitPercent)})</Detail></>}
        {review.requestedCashAmount!=null&&<Detail label="Requested amount">{money(review.requestedCashAmount,currency)}</Detail>}
        <Detail label="Account order limit">{review.maxOrderValue!=null?money(review.maxOrderValue,currency):'No limit set'}</Detail>
      </dl>
      <small>Estimates use the reference price before fees and taxes.{review.side==='SELL'?' Sale profit uses the holding’s average cost.':''}</small>
    </div>}</div>
    {review.sellAll&&<p className="pm-cash-conversion pm-sell-all" role="status">Sell all available shares: {review.quantity}. No rounding. Confirming sends this exact quantity to Trading 212.</p>}
    {review.requestedQuantity!=null&&<p className="pm-cash-conversion" role="status">Rounded down from {review.requestedQuantity} to {review.quantity} shares ({review.quantityPrecision} decimal places). Confirming sends only the adjusted quantity.</p>}
    {review.priceQuote&&<p>{quoteNote(review.priceQuote)}</p>}
    {!cancelling&&<div className="broker-review-warning"><Warning size={19}/><p><strong>Final price and charges may differ.</strong>{' '}
      {review.type==='LIMIT'?'Limit orders can remain pending or fill partially. Trading 212 sets the session for API limit orders.':review.extendedHours?'Extended sessions include pre-market, after-hours and overnight where eligible. Thin liquidity can delay execution or change the fill price.':'Regular-session orders wait when the session is closed.'}</p></div>}
    <label className="pm-check"><input type="checkbox" checked={confirmed} onChange={e=>onConfirmChange(e.target.checked)}/>I confirm this {live==='demo'?'demo':'real-money'} {action} for the account shown above.</label>
    <footer className="broker-review-actions"><small>{seconds?`Review expires in ${seconds}s`:'Review expired. Go back and review again.'}</small>
      <button type="button" className="button outline" disabled={busy} onClick={onBack}>{cancelling?'Keep order':'Back to edit'}</button>
      <button type="button" className="button primary" disabled={!confirmed||busy||seconds===0||blocked} onClick={onSubmit}>{cancelling?'Confirm cancellation':`Confirm ${live} ${review.side.toLowerCase()}`}</button>
    </footer>
  </section>;
}
