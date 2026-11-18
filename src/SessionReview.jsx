import {useMemo,useState} from 'react';
import {ArrowClockwise,CalendarBlank,CaretDown,CaretLeft,CaretRight,Check,FloppyDisk,Notebook} from '@phosphor-icons/react';
import {useDisplayTime} from './DisplayTime';
import {useMinuteClock} from './Feeds';
import {marketDay,validDay,addDays} from './data/calendar.mjs';
import {money,tradeResult} from './data/journal.mjs';
import {SESSION_CHECKS,sessionAccount,sessionDates,defaultSessionDay,sessionResults,sessionAdherence,saveSessionNote,saveSessionCheck} from './data/session-review.mjs';
import {useSessionReviews} from './useSessionReviews';
import './session-review.css';

const tone=value=>value>0?'green':value<0?'red':'';
const signed=value=>value>0?'+'+money(value):money(value);
const contract=t=>`${t.symbol} ${t.strike} ${t.optionType==='CALL'?'Call':'Put'}`;
const premium=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:4});
const tradingDate=day=>new Intl.DateTimeFormat('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(day+'T12:00:00Z'));

function ReviewToolbar({day,today,onDay,latest,accounts,scope,onAccount}){
  return <section className="sr-toolbar" aria-label="Review date and account">
    <div className="sr-date-controls">
      <button className="sr-arrow" aria-label="Previous review day" onClick={()=>onDay(addDays(day,-1))}><CaretLeft/></button>
      <label className="sr-date"><CalendarBlank/><span aria-hidden="true">{tradingDate(day)}</span><CaretDown size={14} aria-hidden="true"/>
        <input type="date" aria-label="Session review date" value={day} onChange={e=>{if(validDay(e.target.value))onDay(e.target.value);}}/>
      </label>
      <button className="sr-arrow" aria-label="Next review day" onClick={()=>onDay(addDays(day,1))}><CaretRight/></button>
      <button className="sr-today" onClick={()=>onDay(today)}>Today</button>
      {latest&&latest!==day&&<button className="text-button" onClick={()=>onDay(latest)}>Latest recorded</button>}
    </div>
    {!!accounts.length&&<label className="sr-account">Account<select aria-label="Session review account" value={scope} onChange={e=>onAccount(e.target.value)}>
      <option value="">All accounts</option>{accounts.map(t=><option key={sessionAccount(t)} value={sessionAccount(t)}>{t.firm} · {t.account}</option>)}
    </select></label>}
  </section>;
}

function ReviewStats({summary}){
  const {stats}=summary,grossOnly=stats.missingFees>0;
  const pnl=grossOnly?stats.gross:stats.net;
  return <dl className="session-review-stats">
    <div><dt>Closed trades</dt><dd>{stats.closed}</dd></div>
    <div><dt>{grossOnly?'Gross':'Net'} P/L</dt><dd className={tone(pnl)}>{stats.closed?signed(pnl):'—'}</dd></div>
    <div><dt>Wins / Losses</dt><dd>{stats.wins} / {stats.losses}</dd><small>{stats.winRate!==null&&stats.winRate.toFixed(1)+'% gross'}{stats.breakeven>0&&' · '+stats.breakeven+' flat'}</small></div>
    <div><dt>Fees</dt><dd>{money(stats.fees)}</dd>{grossOnly&&<small>Missing on {stats.missingFees} of {stats.closed} closed trades</small>}</div>
  </dl>;
}

function EntryEvidence({adherence,entries,results,refresh,onTrade}){
  const {clockTime}=useDisplayTime();
  return <details className="sr-disclosure"><summary>Automatic entry checks{adherence.complete>0&&<span>{adherence.matched} / {adherence.complete} matched</span>}</summary>
    <div className="sr-evidence"><p>Completed 2m candles before entry, compared with dated levels, EMA 9/21 and VWAP.</p>
      <button className="text-button" aria-label="Recheck session strategy" disabled={!adherence.total||!!adherence.loading} onClick={refresh}><ArrowClockwise/>Recheck</button></div>
    <table className="sr-rule-table"><thead><tr><th>Rule</th><th>Met</th><th>Missed</th><th>Unknown</th></tr></thead>
      <tbody>{adherence.rules.map(r=><tr key={r.id}><th scope="row">{r.label}</th><td>{r.met}</td><td>{r.missed}</td><td>{r.unknown}</td></tr>)}</tbody></table>
    {!!entries.length&&<ul className="sr-entries">{entries.map(trade=>{
      const result=results[trade.id];
      return <li key={trade.id}><button className="text-button" onClick={()=>onTrade(trade.id)}>{clockTime(trade.entryAt)} · {contract(trade)}</button>
        <span>{trade.firm} · {trade.account} · {result?.review?.headline||'Checking entry…'}</span>
        {result?.review&&<small>{result.review.passed}/6 met · {result.review.failed} missed · {result.review.unknown} unknown</small>}
        {result?.message&&<small>{result.message}</small>}</li>;
    })}</ul>}
    <footer aria-live="polite">{adherence.loading?`Checking ${adherence.loading} of ${adherence.total} entries…`:`${adherence.complete} entries checked · ${adherence.incomplete} incomplete · ${adherence.outside} outside the regular session`}{adherence.cached>0&&` · ${adherence.cached} use cached history`}
      <small>Missing levels or price history leave checks unknown.</small></footer>
  </details>;
}

function ReviewTrades({day,summary,results,onTrade,onJournal}){
  const {clockTime,clockDate,journalStamp,zoneLabel,formatLabel}=useDisplayTime();
  const related=[...new Map([...summary.entries,...summary.closed].map(t=>[t.id,t])).values()];
  const timeFor=t=>marketDay(t.entryAt)===day?t.entryAt:t.exitAt;
  related.sort((a,b)=>timeFor(a).localeCompare(timeFor(b)));
  const basis=summary.stats.missingFees?'gross':'net';
  return <section className="sr-card session-review-trades">
    <header><h2>Trades in this session</h2><small>Manual journal · U.S. options · USD</small></header>
    <p className="sr-caption">Entries and exits for {tradingDate(day)} (New York). Results use the exit date.</p>
    {related.length?<table className="sr-trade-table"><thead><tr>
      <th>Time ({zoneLabel})</th><th>Contract</th><th>Opening side</th><th>Entry</th><th>Exit</th><th>Qty</th><th>{basis==='net'?'Net':'Gross'} result</th><th>Details</th>
    </tr></thead><tbody>{related.map(t=>{
      const entered=marketDay(t.entryAt)===day,exited=!!t.exitAt&&marketDay(t.exitAt)===day;
      const amount=exited?tradeResult(t)[basis]:null,review=results[t.id]?.review;
      const status=!entered?'Entry from another session':review?.headline||'Checking entry…';
      const instant=timeFor(t);
      return <tr className="session-review-trade" key={t.id}>
        <td data-label={'Time ('+zoneLabel+')'}><time dateTime={instant} title={journalStamp(instant)+' · '+zoneLabel+' / '+formatLabel}>{clockTime(instant)}</time>{!entered&&<small>Exit</small>}</td>
        <td data-label="Contract"><strong>{t.symbol}</strong><small>{t.strike} {t.optionType==='CALL'?'Call':'Put'} · {t.expiration}</small></td>
        <td data-label="Opening side"><span className={'jt-side '+(t.position==='long'?'jt-buy':'jt-sell')}>{t.position==='long'?'Buy':'Sell'}</span></td>
        <td data-label="Entry" title={journalStamp(t.entryAt)}>{premium.format(t.entryPrice)}</td>
        <td data-label="Exit" title={t.exitAt?journalStamp(t.exitAt):'Still open'}>{t.exitAt?premium.format(t.exitPrice):'—'}</td>
        <td data-label="Qty" title="Option contracts">{t.quantity}</td>
        <td data-label={basis==='net'?'Net result':'Gross result'}><b className={tone(amount)}>{signed(amount)}</b>{!exited&&<small>{t.exitAt?'Exit '+clockDate(t.exitAt):'Still open'}</small>}</td>
        <td className="sr-view"><button className="text-button" onClick={()=>onTrade(t.id)} aria-label={'View '+contract(t)+' trade at '+journalStamp(instant)} title={t.firm+' · '+t.account+' · '+status}>View trade<CaretRight/></button></td>
      </tr>;
    })}</tbody></table>:<div className="sr-empty"><Notebook/><h3>No trades recorded for this session</h3><p>Choose another account or date, or add a trade to your journal.</p>
      <button className="text-button" onClick={onJournal}>Go to journal<CaretRight/></button></div>}
  </section>;
}

export default function SessionReview({workspace,selectedDay,onDay,onJournal,onTrade,onNewPlan}){
  const now=useMinuteClock(),trades=workspace.data.journal?.trades||[],today=marketDay(now);
  const day=validDay(selectedDay)?selectedDay:defaultSessionDay(trades,now);
  const [account,setAccount]=useState(''),[noteError,setNoteError]=useState(null);
  const accounts=[...new Map(trades.map(t=>[sessionAccount(t),t])).values()];
  const scope=accounts.some(t=>sessionAccount(t)===account)?account:'';
  const summary=useMemo(()=>sessionResults(trades,day,scope),[trades,day,scope]);
  const {results,refresh}=useSessionReviews(summary.entries,workspace.data);
  const adherence=sessionAdherence(summary.entries,results);
  const failed=adherence.rules.filter(rule=>rule.missed).sort((a,b)=>b.missed-a.missed);
  const notes=workspace.data.sessionReviews?.days.find(row=>row.date===day);
  function edit(updater,key,value){
    try{
      workspace.update(current=>({...current,sessionReviews:updater(current.sessionReviews,day,key,value)}));setNoteError(null);
    }catch(error){setNoteError({day,message:error.message});}
  }
  function textField(key,label,placeholder,rows=2){
    return <textarea aria-label={label} maxLength={2000} rows={rows} value={notes?.[key]||''} onChange={e=>edit(saveSessionNote,key,e.target.value)} placeholder={placeholder}/>;
  }
  const state={pending:'Saving…',saving:'Saving…',error:'Save failed',conflict:'Workspace conflict'}[workspace.status]||(notes?'Session review saved':'Saves automatically');
  return <div className="session-review-page">
    <ReviewToolbar day={day} today={today} latest={sessionDates(scope?trades.filter(t=>sessionAccount(t)===scope):trades)[0]} onDay={onDay} accounts={accounts} scope={scope} onAccount={setAccount}/>
    <ReviewStats summary={summary}/>
    <div className="sr-columns">
      <section className="sr-card session-review-rules"><h2>Did you follow your setup?</h2>
        <div className="sr-checks" role="group" aria-label="Your daily checklist across all accounts">{SESSION_CHECKS.map(([key,label])=>
          <label key={key}><input type="checkbox" checked={!!notes?.checks?.includes(key)} onChange={e=>edit(saveSessionCheck,key,e.target.checked)}/>{label}</label>)}</div>
        {scope&&<small>Daily checklist and notes cover all accounts.</small>}
        <EntryEvidence adherence={adherence} entries={summary.entries} results={results} refresh={refresh} onTrade={onTrade}/>
      </section>
      <section className="sr-card session-review-observations"><h2>What to learn from today</h2>
        {textField('reflection','What to learn from today','Which decision would you repeat or change?',3)}
        <details className="sr-disclosure"><summary>Patterns and trade tags</summary>
          {failed.length?<ul>{failed.map(r=><li key={r.id}>{r.label} · missed on {r.missed} of {summary.entries.length} entries</li>)}</ul>:
            <p>{adherence.loading?'Checking entries…':adherence.matched?'Fully checked entries met all six rules.':'No verified rule misses for these entries.'}</p>}
          <p>{summary.tags.length?summary.tags.map(t=>t.label+' ('+t.count+')').join(' · '):'No tags recorded for these entries.'}</p>
        </details>
      </section>
    </div>
    <ReviewTrades day={day} summary={summary} results={results} onTrade={onTrade} onJournal={onJournal}/>
    <section className="sr-card session-review-notes"><h2>Keep the lesson</h2>
      {textField('lesson','Main lesson','One takeaway to bring into your next session.')}
      <details className="sr-disclosure sr-extra"><summary>More daily notes</summary><div>{[
        ['wentWell','What went well','What should you repeat?'],['mistakes','Mistakes to work on','What would you change?'],['nextSession','Focus for the next session','One action for your next session.']
      ].map(([key,label,placeholder])=><label key={key}>{label}{textField(key,label,placeholder)}</label>)}</div></details>
      {noteError?.day===day&&<p role="alert">{noteError.message}</p>}
      <footer><small role="status">{workspace.status==='saved'&&notes&&<Check/>}{state} · All accounts</small><div>
        <button className="button primary" disabled={workspace.status!=='pending'} onClick={workspace.saveNow}><FloppyDisk/>Save session review</button>
        <button className="text-button" onClick={onNewPlan}>Start a new plan<CaretRight/></button>
      </div></footer>
    </section>
  </div>;
}
