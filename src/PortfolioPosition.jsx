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
    <header><div><span className="pm-eyebrow">{owner} · {accountLabel}{environment==='demo'?' · DEMO':''}</span><h3>{h.name}</h3><p>{symbol?`${symbol} · `:''}{new Intl.NumberFormat('en-US',{maximumFractionDigits:8}).format(h.quantity)} shares</p></div><span className="pm-position-status">{status}</span></header>
    <dl><div><dt>Average paid · {h.instrumentCurrency}</dt><dd className="pm-average-color">{money(h.averagePrice,h.instrumentCurrency)}</dd></div><div><dt>Broker last price · {h.instrumentCurrency}</dt><dd>{money(h.price,h.instrumentCurrency)}</dd></div><div><dt>Holding value · {currency}</dt><dd>{money(h.value,currency)}</dd></div><div><dt>Open return · {currency}</dt><dd className={tone(h.unrealized)}>{money(h.unrealized,currency)}{Number.isFinite(h.unrealized)&&h.cost>0&&<small>{h.unrealized>0?'+':''}{(h.unrealized/h.cost*100).toFixed(2)}%</small>}</dd></div></dl>
    <details className="pm-broker-identity"><summary>Broker instrument</summary><p>Broker ID: {h.ticker}{h.isin?` · ISIN: ${h.isin}`:''}</p></details>
    <p className="pm-position-source">{sourceLabel} · {date?`${source==='api'?'Synced':'Observed'} ${clockStamp(date)} ${zoneLabel}`:'Source date unknown'}. Broker prices and Yahoo chart quotes are separate readings and can differ.{source==='api'?' Broker quote observation time is not supplied.':''}</p>
  </section>;
}
