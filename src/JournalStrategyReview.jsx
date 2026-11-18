import {ArrowClockwise,ChartLineUp,CheckCircle,Clock,Info,MinusCircle,XCircle} from '@phosphor-icons/react';
import {useDisplayTime} from './DisplayTime';
import './journal-strategy-review.css';

const outcomes={
  met:{label:'Met',Icon:CheckCircle},
  'not-met':{label:'Not met',Icon:XCircle},
  unknown:{label:'Unknown',Icon:MinusCircle}
};
const outcomeOf=check=>check.passed===null?'unknown':check.passed?'met':'not-met';

function evidenceGroups(checks){
  const groups=new Map();
  // Several rules can be waiting on the same sheet or candle sequence.
  // Keep that explanation with every affected rule, including on narrow screens.
  for(const check of checks){
    const key=check.passed===null?check.detail:check.id;
    if(!groups.has(key))groups.set(key,{detail:check.detail,checks:[]});
    groups.get(key).checks.push(check);
  }
  return [...groups.values()].sort((a,b)=>Number(a.checks[0].passed===null)-Number(b.checks[0].passed===null));
}

export default function JournalStrategyReview({trade,replay}){
  const {journalStamp,clockTime,zoneLabel}=useDisplayTime();
  const {review,reviewHistory,levels}=replay;
  if(!review)return null;
  const loading=Boolean(replay.symbol)&&reviewHistory.status==='loading';
  const groups=evidenceGroups(review.checks);
  const counts={met:review.passed,'not-met':review.failed,unknown:review.unknown};
  const stamp=seconds=>journalStamp(seconds*1000)+' '+zoneLabel;
  const sheetNote=levels?.message&&!groups.some(group=>group.detail===levels.message)?levels.message:null;

  return <section className="journal-auto-review" aria-label="Automatic strategy review" aria-busy={loading}>
    <header className="evidence-header">
      <span className="evidence-icon"><ChartLineUp size={24}/></span>
      <div>
        <p>Break &amp; retest <span>·</span> 2m</p>
        <h3>{loading?'Checking the entry…':review.headline}</h3>
        <p>{review.direction==='bullish'?'Bullish':'Bearish'} setup · {trade.position} {trade.optionType.toLowerCase()} · entry {clockTime(trade.entryAt,true)} {zoneLabel}</p>
      </div>
      <button type="button" className="text-button" disabled={!replay.symbol||loading} onClick={replay.refresh}><ArrowClockwise size={16}/>Recheck strategy</button>
    </header>
    {loading?<p role="status" className="evidence-loading">Loading dated candles for this entry…</p>:<>
      <div className="evidence-summary">
        <div className="evidence-counts">{Object.entries(outcomes).map(([key,{label,Icon}])=>
          <span key={key} className={'rule-count '+key}><Icon size={16}/><strong>{counts[key]}</strong> {label.toLowerCase()}</span>
        )}</div>
        <span className="evidence-coverage">{review.passed+review.failed} of {review.checks.length} evaluated</span>
      </div>
      <div className="evidence-list">
        <div className="evidence-column-labels" aria-hidden="true"><span>Entry check</span><span>Result</span><span>Evidence at entry</span></div>
        <dl className="journal-auto-checks">
          {groups.map(group=><div className="evidence-group" key={group.checks[0].id}>
            {group.checks.map(check=>{
              const outcome=outcomeOf(check);
              return <dt key={check.id} data-rule={check.id} data-result={outcome}>
                <strong>{check.label}</strong><span className={'rule-state '+outcome}>{outcomes[outcome].label}</span>
              </dt>;
            })}
            <dd style={{gridRow:'1 / span '+group.checks.length}}>{group.detail}</dd>
          </div>)}
        </dl>
      </div>
      {review.pattern&&<div className="evidence-pattern">
        <div><span>Break close</span><strong>{stamp(review.pattern.breakAt)}</strong></div>
        <div><span>Retest close</span><strong>{review.pattern.confirmedAt?stamp(review.pattern.confirmedAt):'Unconfirmed at entry'}</strong></div>
      </div>}
      {sheetNote&&<p className="evidence-source"><Info size={16}/>{sheetNote}</p>}
      <footer className="evidence-foot">
        <span><Clock size={15}/>{review.through?'Last completed candle · '+stamp(review.through):'Entry-time candle sequence unavailable'}</span>
        {reviewHistory.status==='stale'&&<b>Cached history</b>}
      </footer>
      <details className="evidence-method"><summary>How these checks work</summary><p>Each rule uses the saved execution and the completed two-minute candles available before entry. Entry distance uses the underlying candle’s close. Unknown checks need more evidence. The counts describe setup adherence independently of P/L. Grading the exit would require a recorded stop and target.</p></details>
    </>}
  </section>;
}
