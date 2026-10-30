import {PageHeader} from './PageHeader';
import {useDisplayTime} from './DisplayTime';
import {timeZones} from './data/display-time.mjs';
import {ChartLine,PlugsConnected,ShieldCheck,HardDrives,UserCircle,ArrowRight,DownloadSimple,Clock,SignOut,Tag,ArrowsLeftRight} from '@phosphor-icons/react';
import {useAuth} from './Auth';
import {GlobalChartSettings,useChartSettingsStore} from './ChartSettings';
import {SentimentConnection} from './SentimentConnection';
import {useFeed,useMinuteClock} from './Feeds';
import {sentimentDisplay,sentimentScore} from './data/sentiment.mjs';

import './settings.css';

const categories=[{id:'transfers',label:'Transfers & Costs',icon:ArrowsLeftRight},{id:'watchlist',label:'Watchlist',icon:Tag},{id:'charts',label:'Charts',icon:ChartLine},{id:'connections',label:'Connections',icon:PlugsConnected},{id:'account',label:'Account',icon:ShieldCheck},{id:'workspace',label:'Workspace',icon:HardDrives}];
export const settingsCategory=route=>{const id=route.split('/')[1];return categories.some(item=>item.id===id)?id:'charts';};
function Connections(){
  const {briefingTime,zoneLabel}=useDisplayTime();
  const feed=useFeed('/api/sentiment'),now=useMinuteClock(),state=sentimentDisplay(feed,now);
  return <>
    <section className="panel settings-card"><header><span className="settings-card-icon"><PlugsConnected size={23}/></span><div><h2>CNN Fear & Greed</h2><p>Manage the API connection and its automatic updates.</p></div></header>
      <SentimentConnection embedded onChange={feed.refresh}/>
      <div className="settings-source-status"><span className={state.warning?'amber':'green'}>{state.label}</span>{feed.data&&<p>Last available: <strong>{sentimentScore(feed.data.score)} · {feed.data.rating}</strong><br/>{briefingTime(feed.data.observedAt)} {zoneLabel} · {feed.source?.via?.name||feed.source?.name}</p>}{state.outdated&&<p className="amber">{state.detail}</p>}</div>
    </section>
    <section className="panel settings-card"><header><div><h2>Market data sources</h2><p>The desk currently uses these automatic sources.</p></div></header><dl className="settings-facts"><div><dt>Stocks, futures & charts</dt><dd>Yahoo Finance <small>Interim source · delays vary by instrument</small></dd></div><div><dt>U.S. 2-year yield</dt><dd>U.S. Treasury <small>Daily published observations</small></dd></div></dl></section>
  </>;
}
export function SettingsPage({category,transfersContent,watchlistContent,workspace,onAccount,onLogout,logoutBusy,logoutError}){
  const {settings,saveDefaults}=useChartSettingsStore(),{user,session}=useAuth();
  return <><PageHeader title="Settings" description="Manage your watchlist, charts, data connections and account in one place."/><div className={`settings-page${category==='watchlist'?' settings-watchlist-page':''}`}>

    <div className="settings-layout"><nav className="settings-nav" aria-label="Settings sections">{categories.map(({id,label,icon:Icon})=><a key={id} href={`#settings/${id}`} aria-current={category===id?'page':undefined}><Icon size={20}/><span>{label}</span><ArrowRight size={15}/></a>)}</nav>
      <div className="settings-content" key={category}>
        {category==='transfers'&&transfersContent}
        {category==='watchlist'&&watchlistContent}
        {category==='charts'&&<><GlobalChartSettings initial={settings.defaults} onSave={saveDefaults} embedded/><p className="settings-footnote">{Object.keys(settings.charts).length} saved chart {Object.keys(settings.charts).length===1?'setup':'setups'}. Each chart keeps its own view until you reset it or apply defaults to all charts.</p></>}
        {category==='connections'&&<Connections/>}
        {category==='account'&&<section className="panel settings-card"><header><UserCircle size={36}/><div><h2>{user.name}</h2><p>@{user.username} · Personal account</p></div></header><dl className="settings-facts"><div><dt>Email</dt><dd>{user.email}</dd></div><div><dt>Two-step verification</dt><dd className={user.mfaEnabled?'green':'amber'}>{user.mfaEnabled?'Enabled':'Not enabled'}</dd></div><div><dt>Signed-in sessions</dt><dd>{session.sessionCount}</dd></div></dl><p className="settings-card-description">Manage your password, authenticator, recovery codes and signed-in devices.</p><div className="account-actions"><button className="button primary" onClick={onAccount}>Manage account security<ArrowRight size={18}/></button><button className="button outline" disabled={logoutBusy} onClick={onLogout}><SignOut size={18}/>{logoutBusy?'Logging out…':'Log out'}</button></div>{logoutError&&<p className="auth-error" role="alert">{logoutError}</p>}</section>}
        {category==='workspace'&&<><section className="panel settings-card"><header><div><h2>Sidebar</h2><p>Choose what appears below Fear &amp; Greed.</p></div></header><label className="settings-net-toggle"><input type="checkbox" role="switch" checked={workspace.data.preferences.showTradingNet!==false} onChange={e=>{const showTradingNet=e.target.checked;workspace.update(current=>({...current,preferences:{...current.preferences,showTradingNet}}));}}/>Show Trading net</label><p className="settings-footnote">Saves automatically. Hiding this card keeps bank syncing and your saved transactions active.</p></section><SessionDisplay workspace={workspace}/><section className="panel settings-card"><header><HardDrives size={25}/><div><h2>Workspace backup</h2><p>Keep a copy of your saved trading workspace.</p></div></header><p className="settings-card-description">Includes watchlist, imported levels, chart settings, drawings, plans, journal trades, daily reviews and notes. Passwords, API keys and account recovery codes are excluded.</p><button className="button outline" onClick={workspace.backup}><DownloadSimple size={18}/>Download workspace backup</button></section></>}
      </div>
    </div>
  </div></>;
}

function SessionDisplay({workspace}){
  const {settings,zoneLabel,formatLabel,clockDate,clockTime}=useDisplayTime(),now=useMinuteClock();
  const zones=timeZones(settings.timeZone);
  const change=patch=>workspace.update(current=>({...current,displayTime:{...settings,...current.displayTime,...patch}}));
  return <section className="panel settings-card session-display-settings"><header><Clock size={25}/><div><h2>Session display</h2><p>Choose how times appear throughout your desk.</p></div></header>
    <dl className="settings-facts">
      <div><dt><label htmlFor="display-time-zone">Time zone</label></dt><dd><select id="display-time-zone" value={settings.timeZone} onChange={e=>change({timeZone:e.target.value})}>{zones.map(zone=><option key={zone} value={zone}>{zone.replaceAll('_',' ')}</option>)}</select><small>Daylight saving adjusts automatically</small></dd></div>
      <div><dt><label htmlFor="display-time-format">Time format</label></dt><dd><select id="display-time-format" value={settings.hourCycle} onChange={e=>change({hourCycle:e.target.value})}><option value="h23">24-hour · 16:30</option><option value="h12">12-hour · 4:30 PM</option></select></dd></div>
      <div><dt>Trading session</dt><dd>U.S. markets <small>Market schedules always follow New York exchange time</small></dd></div>
    </dl>
    <div className="session-display-preview" aria-live="polite"><span>YOUR CLOCK</span><strong>{clockTime(now)}</strong><small>{clockDate(now)} · {zoneLabel} · {formatLabel}</small></div>
    <p className="settings-footnote">Changes save automatically. Journal entry and import times still use Skopje, matching your broker records; trade review times follow your display setting.</p>
  </section>;
}
