import {useEffect, useMemo, useState} from 'react';
import {ArrowRight, Lightbulb, Notebook} from '@phosphor-icons/react';
import {PageHeader} from './PageHeader';
import {useMinuteClock} from './Feeds';
import {journalBroker} from './data/journal-brokers.mjs';
import {journalDay, money} from './data/journal.mjs';
import {coachAccount, journalCoach} from './data/journal-coach.mjs';
import {ibkrRequest} from './IbkrConnection';
import './journal-coach.css';

const sourceNames = {trades: 'Vanquish', ibkr: 'IBKR', broker: 'Trading 212', other: 'Other imports'};
const emptyTrades = [];
const dateFormat = new Intl.DateTimeFormat('en-GB', {day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'});
const dateLabel = day => dateFormat.format(new Date(day + 'T12:00:00Z'));

function NoteList({groups, broker, onTrade}) {
  const notes = groups.filter(group => group.notes.length);
  if (!notes.length) return <p className="coach-muted">There are no saved notes for these closed trades.</p>;
  return <div className="coach-note-groups">
    {notes.map(group => <details className="coach-note-group" key={group.id}>
      <summary>{group.label} <span className="coach-muted">· {group.notes.length} of {group.count} with notes</span></summary>
      <ul>{group.notes.slice(0, 5).map(trade => <li key={trade.id}>
        <div><strong>{trade.symbol} · {trade.optionType}</strong><time dateTime={trade.exitAt}>Closed {dateLabel(journalDay(trade.exitAt))}</time></div>
        <p>{trade.notes}</p>
        {['trades', 'ibkr'].includes(broker) && <button className="text-button" onClick={() => onTrade(broker + '/' + encodeURIComponent(trade.id))}>Open trade <ArrowRight size={14}/></button>}
      </li>)}</ul>
      {group.notes.length > 5 && <p className="coach-muted">Showing the latest 5. More notes are available in the journal.</p>}
    </details>)}
  </div>;
}

export default function JournalCoach({workspace, nav, onTab}) {
  const now = useMinuteClock();
  const [broker, setBroker] = useState('trades');
  const [period, setPeriod] = useState('30');
  const [account, setAccount] = useState('');
  const [ibkr, setIbkr] = useState(null);
  const [issue, setIssue] = useState('');
  const [reload, setReload] = useState(0);
  const saved = workspace.data.journal?.trades || emptyTrades;

  useEffect(() => {
    if (broker !== 'ibkr') return;
    let alive = true;
    ibkrRequest('/api/journal/ibkr').then(value => {
      if (alive) {setIbkr(value); setIssue('');}
    }).catch(() => {if (alive) setIssue('Synced IBKR trades could not be read.');});
    return () => {alive = false;};
  }, [broker, reload]);

  const trades = useMemo(() => {
    const local = saved.filter(trade => journalBroker(trade) === broker);
    if (broker !== 'ibkr') return local;
    return [...new Map([...local, ...(ibkr?.journal?.trades || [])].map(trade => [trade.id, trade])).values()];
  }, [broker, saved, ibkr]);
  const accounts = useMemo(() => [...new Map(trades.map(trade => [coachAccount(trade), trade.account])).entries()], [trades]);
  const scope = accounts.some(([key]) => key === account) ? account : '';
  const result = useMemo(() => journalCoach(trades, {period, account: scope, now}), [trades, period, scope, now]);
  const relevant = result.partitions.slice(0, 2);
  const hasUnclassified = result.counts.other + result.counts.mixed > 0;
  const loading = broker === 'ibkr' && !ibkr && !issue;
  const source = broker === 'ibkr' ? 'Saved and synced IBKR option records'
    : broker === 'broker' ? 'Saved Trading 212 option imports' : `Saved ${sourceNames[broker]} option records`;

  return <div className="journal-page jt-page">
    <PageHeader title="Journal Coach" description="Compare how you entered completed trades and choose one improvement for next week."/>
    {nav}
    <div className="journal-coach">
      <section className="coach-card coach-controls" aria-label="Journal Coach filters">
        <label>Journal<select value={broker} onChange={event => {
          setBroker(event.target.value);
          setAccount('');
          setIbkr(null);
          setIssue('');
        }}>{Object.entries(sourceNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Period<select value={period} onChange={event => setPeriod(event.target.value)}>
          <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="all">All time</option>
        </select></label>
        {accounts.length > 0 && <label>Account<select value={scope} onChange={event => setAccount(event.target.value)}>
          <option value="">All accounts in this journal</option>{accounts.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>}
        {broker === 'ibkr' && <button className="button outline" disabled={loading} onClick={() => setReload(value => value + 1)}>Reload saved IBKR records</button>}
        <p className="coach-muted">{source} · {result.from ? `${dateLabel(result.from)} – ${dateLabel(result.to)}` : `Through ${dateLabel(result.to)}`} · Skopje exit dates</p>
      </section>

      {loading ? <p role="status" className="coach-muted">Reading the IBKR journal…</p> : <>
        {broker === 'ibkr' && issue && <p className="coach-muted" role="status">{issue} Showing {ibkr ? 'the last loaded records' : 'local imports only'}.</p>}
        {broker === 'ibkr' && ibkr?.message && <p className="coach-muted" role="status">{ibkr.message}</p>}
        {broker === 'ibkr' && ibkr?.unmatched?.length > 0 && <p className="coach-muted">{ibkr.unmatched.length} unmatched closing fills are outside this comparison.</p>}
        <section className="coach-card" aria-label="Entry comparison">
          <header className="coach-heading"><h2>Entry comparison</h2><span>{result.total} closed {result.total === 1 ? 'trade' : 'trades'}</span></header>
          <div className="coach-comparison">
            {relevant.map(group => <section key={group.id} aria-label={group.label}>
              <h3>{group.label}</h3>
              <strong className="coach-count">{group.count}</strong>
              <p>{group.count ? `${group.wins} ${group.wins === 1 ? 'win' : 'wins'} · ${group.losses} ${group.losses === 1 ? 'loss' : 'losses'} · ${group.flat} flat` : 'No trades in this group'}</p>
              <p className="coach-muted">Average gross P/L <strong>{money(group.average)}</strong></p>
            </section>)}
          </div>
          {hasUnclassified && <p className="coach-muted">{result.counts.other} other or unclassified · {result.counts.mixed} conflicting. Excluded from the two groups above.</p>}
          {result.counts.early > 0 && <p className="coach-muted">Early entry {result.early} · Chased entry {result.chased}. A trade with both tags counts once in the group.</p>}
          <details className="coach-method"><summary>How trades are grouped</summary>
            <p>“Followed rules” uses the Followed plan tag or four saved entry checks marked yes. “Early or chased” uses those saved tags. Conflicting tags or checks are counted separately. Free-text notes provide context. Outcomes use gross USD P/L before fees, and the two groups are descriptive.</p>
          </details>
          {!result.total && <p className="coach-muted">Choose another period or journal to review closed trades.</p>}
        </section>

        {result.improvement && <section className="coach-card coach-next" aria-label="One improvement for next week">
          <Lightbulb size={22}/>
          <div><h2>One improvement for next week</h2><p className="coach-action">{result.improvement.action}</p>
            <p className="coach-muted">{result.improvement.reason}</p><p>{result.improvement.measure}</p></div>
        </section>}
        <section className="coach-card" aria-label="Trade notes">
          <header className="coach-heading"><h2><Notebook size={18}/> Trade notes</h2><span>Saved observations</span></header>
          <NoteList groups={result.partitions} broker={broker} onTrade={onTab}/>
        </section>
      </>}
    </div>
  </div>;
}
