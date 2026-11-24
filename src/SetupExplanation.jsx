import {useState} from 'react';
import {CaretDown, ListChecks} from '@phosphor-icons/react';
import {useDisplayTime} from './DisplayTime';
import {explainSetup} from './data/setup-explanation.mjs';
import './setup-explanation.css';

const status = {passed:'Passed', failed:'Failed', pending:'Pending', unavailable:'Unavailable'};

export function SetupExplanation({symbol, result}) {
  const {clockStamp, zoneLabel} = useDisplayTime();
  const [open, setOpen] = useState(false);
  const explanation = open ? explainSetup(result) : null;
  const stamp = seconds => clockStamp(seconds * 1000) + ' ' + zoneLabel;
  const meta = [
    result?.timeframe ? `${result.timeframe} confirmation` : 'Setup confirmation',
    result?.levelDate ? `Levels ${result.levelDate}` : '',
    result?.sessionDate ? `Quote session ${result.sessionDate}` : '',
    result?.through ? `Candles through ${stamp(result.through)}` : '',
  ].filter(Boolean);

  return <details className="setup-explain" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><ListChecks size={17}/> <span>Explain this setup</span><CaretDown className="setup-explain-chevron" size={14}/></summary>
    {explanation && <section aria-label={`${symbol} setup explanation`} className="setup-explain-body">
      <p className="setup-explain-lead">{explanation.summary}</p>
      <p className="setup-explain-meta">{meta.join(' · ')} · Yahoo Finance</p>
      <dl className="setup-explain-rules">{explanation.checks.map(check => <div key={check.id} className="setup-explain-rule">
        <dt>{check.label}</dt>
        <dd><strong className={`setup-explain-state ${check.state}`}>{status[check.state]}</strong>
          {check.detail && <span>{check.detail}{check.at && <> {stamp(check.at)}.</>}</span>}</dd>
      </div>)}</dl>
    </section>}
  </details>;
}
