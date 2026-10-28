import {CheckCircle,WarningCircle,Question,ArrowClockwise} from '@phosphor-icons/react';
import {localStamp} from './data/journal.mjs';
const stamp=seconds=>localStamp(seconds*1000).replace('T',' · ');
export default function JournalStrategyReview({trade,replay}){
  const {review,reviewHistory,levels}=replay;
  if(!review)return null;
  const loading=!!replay.symbol&&reviewHistory.status==='loading';
  return <section className="journal-auto-review" aria-label="Automatic strategy review">
    <header><div><span className="eyebrow">AUTOMATIC · BREAK & RETEST · 2M</span><h3>{loading?'Checking the entry…':review.headline}</h3><p>{review.direction==='bullish'?'Bullish':'Bearish'} setup · {trade.position} {trade.optionType.toLowerCase()} · evaluated before {localStamp(trade.entryAt).slice(11)} Skopje</p></div><strong className="journal-rule-score">{review.passed}<small>/ {review.checks.length} met</small></strong></header>
    <div className="journal-rule-counts"><span className="green">{review.passed} met</span><span className={review.failed?'red':'muted'}>{review.failed} not met</span><span className={review.unknown?'amber':'muted'}>{review.unknown} unknown</span></div>
    <div className="journal-auto-checks">{review.checks.map(check=>{
      const Icon=check.passed===true?CheckCircle:check.passed===false?WarningCircle:Question;
      return <article key={check.id} data-rule={check.id} data-result={check.passed===null?'unknown':check.passed?'met':'not-met'}><Icon size={20}/><div><strong>{check.label}<small>{check.passed===null?'Unknown':check.passed?'Met':'Not met'}</small></strong><p>{check.detail}</p></div></article>;
    })}</div>
    {review.pattern&&<div className="journal-pattern-times"><span>Break close <strong>{stamp(review.pattern.breakAt)} Skopje</strong></span><span>Retest close <strong>{review.pattern.confirmedAt?`${stamp(review.pattern.confirmedAt)} Skopje`:'Not confirmed before entry'}</strong></span></div>}
    <p className="journal-help">{levels?.message}</p>
    <footer><span>{review.through?`Last completed candle: ${stamp(review.through)} Skopje`:'No verified entry-time candle sequence'}{reviewHistory.status==='stale'?' · cached history':''}</span><button type="button" className="text-button" disabled={!replay.symbol||loading} onClick={replay.refresh}><ArrowClockwise size={15}/>Recheck strategy</button></footer>
    <p className="journal-help">A rule count, not a win probability. Your option fills are exact; entry-location checks use the last completed underlying candle. Profit or loss does not determine strategy adherence. Exit quality is not graded without a recorded stop and target.</p>
  </section>;
}
