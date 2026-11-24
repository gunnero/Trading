import {lazy,Suspense,useRef} from 'react';
import {ArrowClockwise,CaretDown,CheckCircle,ChartLine,NotePencil} from '@phosphor-icons/react';
import {JOURNAL_TAGS,REVIEW_ITEMS,duration,money,optionPremium,tradeResult} from './data/journal.mjs';
import {useDisplayTime} from './DisplayTime';
import JournalOptionFills from './JournalOptionFills';
import JournalStrategyReview from './JournalStrategyReview';
import './journal-trade-review.css';

const TradeChart=lazy(()=>import('./JournalTradeChart'));
const sourceNames={manual:'Manual journal',screenshot:'Screenshot import',import:'Journal import'};
export default function JournalTradeReview({trade,replay,form,edit,view,onView,onEdit,dirty,save,error,workspaceStatus}){
  const {zoneLabel,journalStamp}=useDisplayTime();
  const notesRef=useRef(null);
  const details=view==='details',notesOpen=details||view==='chart-notes';
  const result=tradeResult(trade),long=trade.position==='long';
  const contract=trade.symbol+' '+trade.strike+' '+(trade.optionType==='PUT'?'Put':'Call');
  const source=sourceNames[trade.source],fills=[{event:'Entry',at:trade.entryAt,price:trade.entryPrice,action:long?'Buy to open':'Sell to open',order:trade.entryOrderId}];
  if(trade.exitAt)fills.push({event:'Exit',at:trade.exitAt,price:trade.exitPrice,action:long?'Sell to close':'Buy to close',order:trade.exitOrderId});
  const noteField=<label className="review-note-label">Review notes<textarea ref={notesRef} rows={4} value={form.notes} maxLength={2000} placeholder="What did you see at entry and exit?" onChange={e=>edit('notes',e.target.value)}/></label>;
  return <div className="trade-review">
    <div className="review-heading"><div className="review-identity">
      <h3>{contract} · <span className={long?'green':'red'}>{long?'Long':'Short'}</span> · {source}</h3>
      <p>{journalStamp(trade.entryAt)} {zoneLabel} <span>·</span> {trade.firm} · {trade.account}</p>
    </div>
      <div className="review-view-switch" role="group" aria-label="Trade review views">
        <button type="button" aria-pressed={!details} onClick={()=>onView('chart')}><ChartLine size={15}/>Replay</button>
        <button type="button" aria-pressed={details} onClick={()=>onView('details')}><NotePencil size={15}/>Details &amp; notes</button>
      </div>
    </div>
    <div className="review-metrics" aria-label="Saved execution summary">
      <div><span>Entry premium</span><strong>{optionPremium(trade.entryPrice)}</strong></div>
      <div><span>Exit premium</span><strong>{trade.exitAt?optionPremium(trade.exitPrice):'Open'}</strong></div>
      <div><span>Quantity</span><strong>{trade.quantity} <small>{trade.quantity===1?'contract':'contracts'}</small></strong></div>
      <div><span>Realized gross P/L</span><strong className={result.gross>0?'green':result.gross<0?'red':''}>{result.gross>0?'+':''}{money(result.gross)} {result.returnPct!=null&&<small>({result.returnPct>0?'+':''}{result.returnPct.toFixed(2)}%)</small>}</strong></div>
    </div>
    {replay.listings.length>1&&<label className="journal-listing-choice">Choose the underlying listing<select value={replay.choice} onChange={e=>replay.setChoice(e.target.value)}><option value="">Choose listing</option>{replay.listings.map(row=><option key={row.id} value={row.id}>{row.id}</option>)}</select></label>}
    {details&&<button type="button" className="text-button review-note-shortcut" onClick={()=>notesRef.current?.focus()}><NotePencil size={14}/>Go to my notes</button>}
    <div className={'review-columns'+(details?' details-columns':'')}>
      {details?<JournalStrategyReview trade={trade} replay={replay}/>:<Suspense fallback={<div className="journal-chart-empty">Loading trade chart…</div>}><TradeChart trade={trade} replay={replay}/></Suspense>}
      <aside className="review-inspector">
        {details?<div className="review-notebook-heading"><NotePencil size={20}/><h3>My trade notes</h3></div>:
          <div className="review-tabs" role="group" aria-label="Replay inspector">
            <button type="button" aria-pressed={!notesOpen} onClick={()=>onView('chart')}>Trade details</button>
            <button type="button" aria-pressed={notesOpen} onClick={()=>onView('chart-notes')}>Strategy notes</button>
          </div>}
        {!notesOpen&&<>
          <div className="review-field"><span>Strategy check</span><strong>Break &amp; retest · 2m</strong></div>
          <label>Direction<select value={form.position} onChange={e=>edit('position',e.target.value)}><option value="long">Long · buy to open</option><option value="short">Short · sell to open</option></select></label>
        </>}
        {details&&noteField}
        <details className="review-tag-picker"><summary>Tags
          <span className="review-selected-tags">{form.tags.length?form.tags.map(tag=><b key={tag}>{tag}</b>):'Choose tags'}<CaretDown size={13}/></span>
        </summary><div className="journal-tags" role="group" aria-label="Trade tags">{[...new Set([...JOURNAL_TAGS,...form.tags])].map(tag=><button type="button" key={tag} aria-pressed={form.tags.includes(tag)} onClick={()=>edit('tags',form.tags.includes(tag)?form.tags.filter(t=>t!==tag):[...form.tags,tag])}>{tag}</button>)}</div></details>
        {!details&&noteField}
        {notesOpen&&<fieldset className="review-assessment"><legend>Your assessment</legend>
          {REVIEW_ITEMS.map(([key,label])=><label key={key}><span>{label}</span><select value={form.review[key]===null?'unknown':String(form.review[key])}
            onChange={e=>edit('review',{...form.review,[key]:e.target.value==='unknown'?null:e.target.value==='true'})}><option value="unknown">Not reviewed</option><option value="true">Yes</option><option value="false">No</option></select></label>)}
        </fieldset>}
        {error&&<p role="alert">{error}</p>}
        <footer><span role="status" className={!dirty&&workspaceStatus==='saved'?'green':''}>{!dirty&&workspaceStatus==='saved'&&<CheckCircle size={16}/>} {dirty?'Unsaved edits':workspaceStatus==='saved'?'Saved':workspaceStatus==='error'||workspaceStatus==='conflict'?'Workspace needs attention':'Saving workspace…'}</span>
          {dirty&&<button type="button" className="button primary" disabled={workspaceStatus==='saving'} onClick={save}>Save trade</button>}
        </footer>
        {!details&&onEdit&&<button type="button" className="text-button review-edit" onClick={onEdit}><NotePencil size={15}/>Edit execution details</button>}
      </aside>
    </div>
    <section className="review-fills"><header><h3>Executions <small>(saved journal)</small></h3>
      {details&&onEdit&&<button type="button" className="button outline" onClick={onEdit}><NotePencil size={15}/>Edit execution details</button>}</header>
      {details&&<dl className="review-contract-facts">
        <div><dt>Option contract</dt><dd>{contract}</dd></div>
        <div><dt>Expiration</dt><dd>{trade.expiration}</dd></div>
        <div><dt>Multiplier</dt><dd>{trade.multiplier}</dd></div>
        <div><dt>Initial risk</dt><dd>{money(trade.risk)}</dd></div>
      </dl>}
      <div className="review-table-scroll"><table><thead><tr><th>Event</th><th>Local time ({zoneLabel})</th><th>Saved premium (USD/share)</th><th>Contracts</th><th>Source</th></tr></thead>
      <tbody>{fills.map(fill=><tr key={fill.event}><td><b className={'review-event '+fill.event.toLowerCase()}>{fill.event}</b><small>{fill.action}</small></td><td><time dateTime={fill.at}>{journalStamp(fill.at)}</time></td><td>{optionPremium(fill.price)}</td><td>{trade.quantity}</td><td>{trade.sourceLabel||source}{fill.order&&<small>Order {fill.order}</small>}</td></tr>)}</tbody></table></div>
    </section>
    <div className="review-record-foot"><ChartLine size={15}/>{details?<span>{trade.firm} · {trade.account}</span>:<span>{replay.history.status==='stale'?'Cached · ':''}{replay.history.provider||'Yahoo Finance'} · {trade.symbol} · {replay.frame} · U.S. regular session</span>}<span>{trade.exitAt?'Held '+duration(result.seconds):'Position open'}</span><span>Fees {money(trade.fees)}</span><span>Net P/L {money(result.net)}</span>{result.r!=null&&<span>Gross R {result.r.toFixed(2)}R</span>}
      {!details&&replay.history.fetchedAt&&<span>Fetched {journalStamp(replay.history.fetchedAt)} {zoneLabel}</span>}
      {!details&&<button type="button" className="text-button" onClick={replay.refresh} disabled={!replay.symbol||replay.history.status==='loading'}><ArrowClockwise size={14}/>Refresh history</button>}
    </div>
    {!details&&<details className="review-disclosure"><summary>Automatic strategy review</summary><JournalStrategyReview trade={trade} replay={replay}/></details>}
    <details className="review-disclosure"><summary>Option fill diagram</summary><JournalOptionFills trade={trade}/></details>
  </div>;
}
