import {useDisplayTime} from './DisplayTime';
import {optionPremium,duration,tradeResult} from './data/journal.mjs';
export default function JournalOptionFills({trade}){
  const {clockTime,zoneLabel}=useDisplayTime();
  const result=tradeResult(trade),prices=[trade.entryPrice,...(trade.exitAt?[trade.exitPrice]:[])],low=Math.min(...prices),high=Math.max(...prices),spread=Math.max(high-low,.05);
  const y=price=>94-(price-low)/spread*52,entryY=y(trade.entryPrice),exitY=trade.exitAt?y(trade.exitPrice):null;
  const clock=value=>clockTime(value,true);
  return <section className="journal-option-fills" aria-label="Exact option executions">
    <header><strong>Your option fills</strong><span>Recorded executions · premiums per share</span></header>
    <svg viewBox="0 0 400 158" role="img" aria-label={`Exact option entry ${optionPremium(trade.entryPrice)} at ${clock(trade.entryAt)} ${zoneLabel}${trade.exitAt?`, exit ${optionPremium(trade.exitPrice)} at ${clock(trade.exitAt)} ${zoneLabel}`:'. No exit recorded'}`}>
      <path d="M60 116H340" stroke="var(--border)" strokeWidth="1"/>
      <path d={`M72 ${entryY+7}V116`} stroke="var(--green)" strokeDasharray="3 4"/>
      <circle cx="72" cy={entryY} r="6" fill="var(--green)"/>
      <text x="72" y={entryY-15} textAnchor="middle" fill="var(--green)">ENTRY {optionPremium(trade.entryPrice)}</text>
      <text x="72" y="139" textAnchor="middle" fill="var(--muted)">{clock(trade.entryAt)}</text>
      {trade.exitAt?<><path d={`M328 ${exitY+7}V116`} stroke="var(--amber)" strokeDasharray="3 4"/><circle cx="328" cy={exitY} r="6" fill="var(--amber)"/><text x="328" y={exitY-15} textAnchor="middle" fill="var(--amber)">EXIT {optionPremium(trade.exitPrice)}</text><text x="328" y="139" textAnchor="middle" fill="var(--muted)">{clock(trade.exitAt)}</text><text x="200" y="80" textAnchor="middle" fill="var(--muted)">{duration(result.seconds)} held</text></>:<text x="270" y="80" textAnchor="middle" fill="var(--muted)">Position open</text>}
    </svg>
    <p>Only your recorded fills are plotted. The price path between them is unavailable.</p>
  </section>;
}
