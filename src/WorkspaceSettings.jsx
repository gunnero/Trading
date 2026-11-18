import {useMemo} from 'react';
import {CheckCircle, Clock, DownloadSimple, WarningCircle} from '@phosphor-icons/react';
import {useDisplayTime} from './DisplayTime';
import {useMinuteClock} from './Feeds';
import {timeZones} from './data/display-time.mjs';
import './workspace-settings.css';

const saveStates = {
  saved: 'Saved automatically',
  pending: 'Unsaved changes',
  saving: 'Saving…',
  loading: 'Loading…',
  conflict: 'Save conflict',
  error: 'Save failed'
};

export function WorkspaceSaveBadge({status}) {
  const needsAttention = status === 'conflict' || status === 'error';
  const Icon = needsAttention ? WarningCircle : status === 'saved' ? CheckCircle : Clock;
  return <span role="status" className="workspace-save-badge" data-state={status}>
    <Icon size={16} weight={status === 'saved' ? 'fill' : 'regular'} aria-hidden="true"/>
    {saveStates[status]}
  </span>;
}

function SessionDisplay({update}) {
  const {settings, clockDate, clockTime} = useDisplayTime();
  const now = useMinuteClock();
  const zones = useMemo(() => timeZones(settings.timeZone), [settings.timeZone]);
  function change(patch) {
    update(current => ({...current, displayTime: {...settings, ...current.displayTime, ...patch}}));
  }

  return <section className="workspace-panel" aria-labelledby="session-display-heading">
    <h2 id="session-display-heading">Session display</h2>
    <dl className="workspace-display-fields">
      <div>
        <dt><label htmlFor="display-time-zone">Time zone</label></dt>
        <dd><select id="display-time-zone" value={settings.timeZone} onChange={event => change({timeZone: event.target.value})}>
          {zones.map(zone => <option key={zone} value={zone}>{zone.replaceAll('_', ' ')}</option>)}
        </select></dd>
      </div>
      <div>
        <dt><label htmlFor="display-time-format">Time format</label></dt>
        <dd><select id="display-time-format" value={settings.hourCycle} onChange={event => change({hourCycle: event.target.value})}>
          <option value="h23">24-hour</option><option value="h12">12-hour</option>
        </select></dd>
      </div>
      <div>
        <dt>Trading session</dt>
        <dd className="workspace-market-session">U.S. markets <small>New York exchange time</small></dd>
      </div>
    </dl>
    <div className="session-display-preview">
      <span>Live preview</span>
      <time dateTime={new Date(now).toISOString()}>{clockDate(now)} <strong>{clockTime(now)}</strong></time>
      <small>Daylight saving adjusts automatically.</small>
    </div>
    <p className="workspace-note">Journal entries and imports use Skopje time. Trade reviews use your display settings.</p>
  </section>;
}

export function WorkspaceSettings({workspace}) {
  function setTradingNet(showTradingNet) {
    workspace.update(current => ({...current, preferences: {...current.preferences, showTradingNet}}));
  }

  return <>
    <section className="workspace-panel" aria-labelledby="workspace-sidebar-heading">
      <h2 id="workspace-sidebar-heading">Sidebar</h2>
      <div className="workspace-switch-row">
        <div>
          <label htmlFor="workspace-trading-net">Show Trading net</label>
          <p id="workspace-net-help">Show the net balance below Fear &amp; Greed. Bank sync and ledger history stay active when hidden.</p>
        </div>
        <input id="workspace-trading-net" type="checkbox" role="switch" aria-describedby="workspace-net-help"
          checked={workspace.data.preferences?.showTradingNet !== false} onChange={event => setTradingNet(event.target.checked)}/>
      </div>
    </section>
    <SessionDisplay update={workspace.update}/>
    <section className="workspace-panel workspace-backup" aria-labelledby="workspace-backup-heading">
      <h2 id="workspace-backup-heading">Workspace backup</h2>
      <ul><li>Includes your watchlist, imported levels, drawings, chart settings, plans, journal trades, reviews and notes.</li></ul>
      <button type="button" className="button primary" onClick={workspace.backup}><DownloadSimple size={18}/>Download workspace backup</button>
      <p className="workspace-note">Bank ledger and portfolio records have their own exports. Credentials are excluded.</p>
    </section>
  </>;
}
