import {useDisplayTime} from './DisplayTime';
import {money,duration,tradeResult} from './data/journal.mjs';
export default function JournalOptionFills({trade}){
  const {clockTime,zoneLabel}=useDisplayTime();
  const result=tradeResult(trade),prices=[trade.entryPrice,...(trade.exitAt?[trade.exitPrice]:[])],low=Math.min(...prices),high=Math.max(...prices),spread=Math.max(high-low,.05);
  const y=price=>94-(price-low)/spread*52,entryY=y(trade.entryPrice),exitY=trade.exitAt?y(trade.exitPrice):null;
  const clock=value=>clockTime(value,true);
  return <section className="journal-option-fills" aria-label="Exact option executions">
    <header><strong>Your option fills</strong><span>Recorded executions · premiums per share</span></header>
    <svg viewBox="0 0 400 158" role="img" aria-label={`Exact option entry ${money(trade.entryPrice)} at ${clock(trade.entryAt)} ${zoneLabel}${trade.exitAt?`, exit ${money(trade.exitPrice)} at ${clock(trade.exitAt)} ${zoneLabel}`:'. No exit recorded'}`}>
      <path d="M60 116H340" stroke="#ddd8ea" strokeWidth="1"/>
      <path d={`M72 ${entryY+7}V116`} stroke="#087a4b" strokeDasharray="3 4"/>
      <circle cx="72" cy={entryY} r="6" fill="#087a4b"/>
      <text x="72" y={entryY-15} textAnchor="middle" fill="#087a4b">ENTRY {money(trade.entryPrice)}</text>
      <text x="72" y="139" textAnchor="middle" fill="#6f6483">{clock(trade.entryAt)}</text>
      {trade.exitAt?<><path d={`M328 ${exitY+7}V116`} stroke="#8f5900" strokeDasharray="3 4"/><circle cx="328" cy={exitY} r="6" fill="#8f5900"/><text x="328" y={exitY-15} textAnchor="middle" fill="#8f5900">EXIT {money(trade.exitPrice)}</text><text x="328" y="139" textAnchor="middle" fill="#6f6483">{clock(trade.exitAt)}</text><text x="200" y="80" textAnchor="middle" fill="#6f6483">{duration(result.seconds)} held</text></>:<text x="270" y="80" textAnchor="middle" fill="#6f6483">Position open</text>}
    </svg>
    <p>Only your recorded fills are plotted. The price path between them is unavailable.</p>
  </section>;
}
