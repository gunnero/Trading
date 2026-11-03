import {portfolioHoldingLabel} from './data/portfolio-listings.mjs';
import {useDisplayTime} from './DisplayTime';

const money=(value,currency)=>Number.isFinite(value)?new Intl.NumberFormat('en-US',{style:'currency',currency,maximumFractionDigits:2}).format(value):'—';
const tone=value=>value>0?'green':value<0?'red':'';
export function PortfolioPosition({position}){
  const {clockStamp,zoneLabel}=useDisplayTime();
  const {holding:h,currency,owner,accountLabel,source,sourceLabel,observedAt,lastSuccess,status,environment}=position;
  const symbol=position.listing?.symbol||portfolioHoldingLabel(h).symbol;
  const date=source==='api'?lastSuccess:observedAt;
  return <section className="pm-position" aria-label="Account holding">
    <header><div><span className="pm-eyebrow">{owner} · {accountLabel}{environment==='demo'?' · DEMO':''}</span><h3>Your investment</h3><p>{symbol?`${symbol} · `:''}{new Intl.NumberFormat('en-US',{maximumFractionDigits:8}).format(h.quantity)} shares</p></div><span className="pm-position-status">{status}</span></header>
    <dl><div><dt>Value · {currency}</dt><dd>{money(h.value,currency)}</dd></div><div><dt>Return · {currency}</dt><dd className={tone(h.unrealized)}>{money(h.unrealized,currency)}{Number.isFinite(h.unrealized)&&h.cost>0&&<small>{h.unrealized>0?'+':''}{(h.unrealized/h.cost*100).toFixed(2)}%</small>}</dd></div><div><dt>Shares</dt><dd>{new Intl.NumberFormat('en-US',{maximumFractionDigits:8}).format(h.quantity)}</dd></div><div><dt>Average price · {h.instrumentCurrency}</dt><dd className="pm-average-color">{money(h.averagePrice,h.instrumentCurrency)}</dd></div></dl>
    {position.onTrade&&<div className="pm-position-trades"><button className="button primary" onClick={()=>position.onTrade('BUY')}>Buy</button><button className="button outline" onClick={()=>position.onTrade('SELL')}>Sell</button></div>}
    <details className="pm-broker-identity"><summary>Broker instrument</summary><p>Broker last price: {money(h.price,h.instrumentCurrency)} · Broker ID: {h.ticker}{h.isin?` · ISIN: ${h.isin}`:''}</p></details>
    <p className="pm-position-source">{sourceLabel} · {date?`${source==='api'?'Synced':'Observed'} ${clockStamp(date)} ${zoneLabel}`:'Source date unknown'}. Broker prices and Yahoo chart quotes are separate readings and can differ.{source==='api'?' Broker quote observation time is not supplied.':''}</p>
  </section>;
}
