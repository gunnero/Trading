import {ArrowsClockwise,Database,WarningCircle,WifiSlash} from '@phosphor-icons/react';
import {useDisplayTime} from './DisplayTime';
import './broker-order-states.css';

export function HoldingRecovery({message,observation,retained,retry,disabled,retryLabel='Retry holdings',children}){
  const {clockStamp,zoneLabel}=useDisplayTime();
  return <section className="broker-recovery broker-connection" aria-label="Holdings refresh status">
    <header><WifiSlash size={23}/><div><h3>Holdings refresh unavailable</h3><p role="status">{message}</p></div></header>
    <dl className="broker-facts">
      <div><dt>Holding data</dt><dd>{retained?'Last snapshot · read-only':'No snapshot available'}</dd></div>
      {observation!=null&&<div><dt>Last observation</dt><dd>{clockStamp(observation)} {zoneLabel}</dd></div>}
    </dl>
    {children}
    {retry&&<button type="button" className="button outline" disabled={disabled} onClick={retry}><ArrowsClockwise size={16}/>{retryLabel}</button>}
  </section>;
}

export function HistoryProgress({state,children}){
  const {pages,records,priced,instruments}=state||{};
  const started=pages>0||instruments>0||records>0;
  const counted=Number.isSafeInteger(priced)&&priced>=0&&Number.isSafeInteger(instruments)&&instruments>0&&priced<=instruments;
  return <section className="broker-recovery broker-history-progress" aria-label="History reconstruction">
    <header><Database size={23}/><h3>History reconstruction</h3></header>
    {started&&<dl className="broker-facts">
      <div><dt>Pages saved</dt><dd>{pages??'—'}</dd></div>
      {Number.isFinite(records)&&<div><dt>Records saved</dt><dd>{records}</dd></div>}
      <div><dt>Instruments priced</dt><dd>{counted?`${priced} of ${instruments}`:priced??'—'}</dd></div>
    </dl>}
    {counted&&<div className="broker-pricing-progress"><progress aria-label="Instruments priced" value={priced} max={instruments}/><span>{Math.round(priced/instruments*100)}%</span></div>}
    {children}
  </section>;
}

export function ListingRecovery({holding,choices,selected,onSelect}){
  return <section className="broker-recovery broker-listing" aria-label="Holding listing selection">
    <header><WarningCircle size={23}/><div><h3>Chart listing unverified</h3><p>No unique automatic match for {holding.name}.</p></div></header>
    <dl className="broker-facts"><div><dt>Broker listing</dt><dd>{holding.ticker}</dd></div><div><dt>Instrument currency</dt><dd>{holding.instrumentCurrency||'—'}</dd></div></dl>
    {choices.length?<label>Stock / ETF listing<select aria-label="Holding chart listing" value={selected} onChange={e=>onSelect(e.target.value)}>
      <option value="">Choose a chart listing</option>{choices.map(entry=><option key={entry.id} value={entry.id}>{entry.exchange}:{entry.symbol}</option>)}</select></label>:
      <p>Add the matching stock or ETF to your watchlist to select its chart.</p>}
    <small>Choose the same instrument and currency. QQQ is a separate ETF. This choice applies to this view only.</small>
  </section>;
}
