import {useEffect, useRef, useState} from 'react';
import {ArrowRight, ArrowUpRight, CalendarBlank, ChatCircleText, Clock, Sparkle} from '@phosphor-icons/react';
import {PageHeader} from './PageHeader';
import {useDisplayTime} from './DisplayTime';
import {apiFetch} from './auth-client';
import './desk-assistant.css';

const suggestions = [
  'What economic releases are on today?',
  'Which watchlist companies report earnings this week?',
  'Which of my holdings report earnings this week?',
  'What are my saved SPY and QQQ levels?',
  'Show my QQQ trades tagged Early entry',
];

async function request(path, data, signal) {
  const response = await apiFetch('/api/desk/' + path, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(55_000)]) : AbortSignal.timeout(55_000),
    ...(data ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)} : {}),
  });
  const output = await response.json();
  if (!response.ok) throw Error(output.message || 'DESK is temporarily unavailable.');
  return output;
}

function externalLink(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function SourceCards({sources}) {
  const {clockStamp, zoneLabel} = useDisplayTime();
  return <div className="desk-ai-sources">
    {sources.map(source => {
      const href = externalLink(source.href);
      return <section className="desk-ai-card" key={source.id} id={'desk-source-' + source.id} aria-label={source.title}>
        <header>
          <h2>{source.title}</h2>
          <a href={'#' + source.route} className="desk-ai-link">Open in DESK <ArrowRight size={15}/></a>
        </header>
        <div className="desk-ai-attribution">
          {href ? <a href={href} target="_blank" rel="noreferrer">{source.source} <ArrowUpRight size={12}/></a> : <span>{source.source}</span>}
          {source.asOf && <span>Retrieved {clockStamp(source.asOf)} {zoneLabel}</span>}
          {source.status === 'partial' && <span className="desk-ai-warning">Cached or incomplete</span>}
          {source.status === 'unavailable' && <span className="desk-ai-warning">Unavailable</span>}
        </div>
        {source.message && <p className="desk-ai-muted">{source.message}</p>}
        {!!source.rows.length && <ul>{source.rows.map((row, index) => {
          const link = externalLink(row.href);
          return <li key={index}>
            {link ? <a href={link} target="_blank" rel="noreferrer">{row.title} <ArrowUpRight size={13}/></a> : row.route ? <a href={'#' + row.route}>{row.title}</a> : <strong>{row.title}</strong>}
            <span>{row.detail}</span>
          </li>;
        })}</ul>}
        {source.limited && <p className="desk-ai-muted">More records may be available in the source page.</p>}
      </section>;
    })}
  </div>;
}

function AiSummary({data}) {
  const answer = data.answer;
  if (!answer && !data.aiError) return null;
  return <section className="desk-ai-card desk-ai-model" aria-label="OpenAI summary" aria-live="polite">
    <header><h2><Sparkle size={18}/> OpenAI summary</h2>{answer?.cached && <span>Cached</span>}</header>
    {data.aiError && <p className="desk-ai-warning">{data.aiError}</p>}
    {answer && <>
      <p className="desk-ai-model-text">{answer.text}</p>
      {!!answer.sourceIds.length && <div className="desk-ai-citations" aria-label="Cited sources">
        {data.sources.filter(source => answer.sourceIds.includes(source.id)).map(source => <button key={source.id} type="button" className="button secondary" onClick={() => {
          const card = document.getElementById('desk-source-' + source.id);
          card?.querySelector('a')?.focus({preventScroll: true});
          card?.scrollIntoView({block: 'start'});
        }}>{source.title}</button>)}
      </div>}
    </>}
  </section>;
}

export function DailyBriefing() {
  const {clockStamp, zoneLabel} = useDisplayTime();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(null);

  async function load(ai = false) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError('');
    try {
      const updated = await request('briefing', ai ? {ai: true} : null, controller.signal);
      if (!controller.signal.aborted) setData(updated);
    } catch (err) {
      if (!controller.signal.aborted) setError(err.message || 'The briefing could not be loaded.');
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  }

  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 10 * 60_000);
    return () => {
      clearInterval(timer);
      active.current?.abort();
      active.current = null;
    };
  }, []);

  return <div className="desk-ai-page">
    <PageHeader title="Daily Session Briefing" description="U.S. releases, watchlist earnings, headlines, sentiment and your saved levels."
      actions={<><a className="button secondary" href="#ask"><ChatCircleText size={17}/> Ask DESK</a><button className="button secondary" disabled={busy} onClick={() => void load()}>Refresh briefing</button></>}/>
    <div className="desk-ai-content">
      {busy && <p role="status" className="desk-ai-muted">{data ? 'Updating briefing…' : 'Loading today’s sources…'}</p>}
      {error && <p role="alert" className="desk-ai-warning">{error}{data && ' Showing the last loaded briefing.'}</p>}
      {data && <>
        <section className="desk-ai-session desk-ai-card" aria-label="U.S. session schedule">
          <div className="desk-ai-session-icon"><CalendarBlank size={23}/></div>
          <div><div className="desk-ai-muted">U.S. session · {data.day}</div><h2>{data.session.label}</h2><p>{data.session.schedule}</p>
            {data.session.nextOpen && <p>Next regular open · {clockStamp(data.session.nextOpen)} {zoneLabel}</p>}
            <p className="desk-ai-muted"><Clock size={14}/> Updated {clockStamp(data.generatedAt)} {zoneLabel}</p>
          </div>
        </section>
        <AiSummary data={data}/>
        {data.aiAvailable && <div className="desk-ai-action">
          <button className="button secondary" type="button" disabled={busy} onClick={() => void load(true)}><Sparkle size={17}/> Summarize with OpenAI</button>
          <span className="desk-ai-muted">Shares these market sources and displayed levels with OpenAI.</span>
        </div>}
        <SourceCards sources={data.sources}/>
      </>}
    </div>
  </div>;
}

export function AskDesk({aiAvailable}) {
  const [question, setQuestion] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [useAi, setUseAi] = useState(false);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(null);
  const input = useRef(null);

  useEffect(() => () => active.current?.abort(), []);

  async function ask(event) {
    event.preventDefault();
    const prompt = question.trim();
    if (!prompt || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError('');
    setData(null);
    setSubmitted(prompt);
    try {
      const next = await request('ask', {question: prompt, ai: aiAvailable && useAi === true}, controller.signal);
      if (!controller.signal.aborted) setData(next);
    } catch (err) {
      if (!controller.signal.aborted) setError(err.message || 'The question could not be answered.');
    } finally {
      active.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return <div className="desk-ai-page">
    <PageHeader title="Ask DESK" description="Ask about your trading session, saved levels or journal."
      actions={<a className="button secondary" href="#markets/session"><CalendarBlank size={17}/> Daily briefing</a>}/>
    <div className="desk-ai-content">
      <form className="desk-ai-composer desk-ai-card" onSubmit={ask}>
        <label htmlFor="desk-question">What would you like to look up?</label>
        <textarea id="desk-question" ref={input} rows={3} maxLength={600} value={question} onChange={event => setQuestion(event.target.value)} placeholder="Ask about upcoming earnings, a level, or a journal tag." required/>
        <div className="desk-ai-ask-actions">
          <div>
            {aiAvailable ? <>
              <label className="desk-ai-checkbox"><input type="checkbox" checked={useAi} onChange={event => setUseAi(event.target.checked)}/> Use OpenAI to summarize</label>
              {useAi && <p className="desk-ai-muted">Shares your question and selected sources with OpenAI. Journal and holdings lookups stay inside DESK.</p>}
            </> : <span className="desk-ai-muted">Source lookup · OpenAI isn’t connected</span>}
          </div>
          <button className="button primary" type="submit" disabled={!question.trim() || busy}><ArrowRight size={17}/> Ask</button>
        </div>
        <div className="desk-ai-suggestions" aria-label="Example questions">
          {suggestions.map(prompt => <button key={prompt} type="button" onClick={() => {setQuestion(prompt); input.current?.focus();}}>{prompt}</button>)}
        </div>
      </form>
      {busy && <p role="status" className="desk-ai-muted">Looking up your DESK sources…</p>}
      {error && <p role="alert" className="desk-ai-warning">{error}</p>}
      {data && <section className="desk-ai-results" aria-label="Answer" aria-live="polite">
        <p className="desk-ai-question">{submitted}</p>
        {data.localOnly && <p className="desk-ai-muted">Private lookup inside DESK.</p>}
        {data.topic === 'general' && !data.answer && <p className="desk-ai-muted">Try a question about earnings, headlines, economic releases, sentiment, levels or journal tags. Here is today’s session context.</p>}
        {['events', 'briefing', 'general'].includes(data.topic) && <p className="desk-ai-muted">{data.session.schedule}</p>}
        <AiSummary data={data}/>
        <SourceCards sources={data.sources}/>
      </section>}
    </div>
  </div>;
}

export function AskDeskPage() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    request('status', null, controller.signal).then(data => setAvailable(data.aiAvailable)).catch(() => {});
    return () => controller.abort();
  }, []);
  return <AskDesk aiAvailable={available}/>;
}
