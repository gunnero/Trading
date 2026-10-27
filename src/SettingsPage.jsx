import {useEffect,useState} from 'react';
import {ChartLine,PlugsConnected,ShieldCheck,HardDrives,UserCircle,ArrowRight,DownloadSimple,Clock,SignOut} from '@phosphor-icons/react';
import {useAuth} from './Auth';
import {GlobalChartSettings,useChartSettingsStore} from './ChartSettings';
import {SentimentConnection} from './SentimentConnection';
import {useFeed,useMinuteClock} from './Feeds';
import {sentimentDisplay,sentimentScore} from './data/sentiment.mjs';
import {briefingTime} from './data/calendar.mjs';
import './settings.css';

const categories=[{id:'charts',label:'Charts',icon:ChartLine},{id:'connections',label:'Connections',icon:PlugsConnected},{id:'account',label:'Account',icon:ShieldCheck},{id:'workspace',label:'Workspace',icon:HardDrives}];
const currentCategory=()=>{const id=location.hash.split('/')[1];return categories.some(item=>item.id===id)?id:'charts';};
function Connections(){
  const feed=useFeed('/api/sentiment'),now=useMinuteClock(),state=sentimentDisplay(feed,now);
  return <>
    <section className="panel settings-card"><header><span className="settings-card-icon"><PlugsConnected size={23}/></span><div><h2>CNN Fear & Greed</h2><p>Manage the API connection and its automatic updates.</p></div></header>
      <SentimentConnection embedded onChange={feed.refresh}/>
      <div className="settings-source-status"><span className={state.warning?'amber':'green'}>{state.label}</span>{feed.data&&<p>Last available: <strong>{sentimentScore(feed.data.score)} · {feed.data.rating}</strong><br/>{briefingTime(feed.data.observedAt)} Skopje · {feed.source?.via?.name||feed.source?.name}</p>}{state.outdated&&<p className="amber">{state.detail}</p>}</div>
    </section>
    <section className="panel settings-card"><header><div><h2>Market data sources</h2><p>The desk currently uses these automatic sources.</p></div></header><dl className="settings-facts"><div><dt>Stocks, futures & charts</dt><dd>Yahoo Finance <small>Interim source · delays vary by instrument</small></dd></div><div><dt>U.S. 2-year yield</dt><dd>U.S. Treasury <small>Daily published observations</small></dd></div></dl></section>
  </>;
}
export function SettingsPage({workspace,onAccount,onLogout,logoutBusy,logoutError}){
  const [category,setCategory]=useState(currentCategory),{settings,saveDefaults}=useChartSettingsStore(),{user,session}=useAuth();
  useEffect(()=>{const change=()=>setCategory(currentCategory());window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[]);
  return <div className="settings-page">
    <div className="settings-intro"><span className="eyebrow">PERSONAL WORKSPACE</span><h2>Workspace settings</h2><p>Manage your charts, data connections and account in one place.</p></div>
    <div className="settings-layout"><nav className="settings-nav" aria-label="Settings sections">{categories.map(({id,label,icon:Icon})=><a key={id} href={`#settings/${id}`} aria-current={category===id?'page':undefined}><Icon size={20}/><span>{label}</span><ArrowRight size={15}/></a>)}</nav>
      <div className="settings-content" key={category}>
        {category==='charts'&&<><GlobalChartSettings initial={settings.defaults} onSave={saveDefaults} embedded/><p className="settings-footnote">{Object.keys(settings.charts).length} saved chart {Object.keys(settings.charts).length===1?'setup':'setups'}. Each chart keeps its own view until you reset it or apply defaults to all charts.</p></>}
        {category==='connections'&&<Connections/>}
        {category==='account'&&<section className="panel settings-card"><header><UserCircle size={36}/><div><h2>{user.name}</h2><p>@{user.username} · Personal account</p></div></header><dl className="settings-facts"><div><dt>Email</dt><dd>{user.email}</dd></div><div><dt>Two-step verification</dt><dd className={user.mfaEnabled?'green':'amber'}>{user.mfaEnabled?'Enabled':'Not enabled'}</dd></div><div><dt>Signed-in sessions</dt><dd>{session.sessionCount}</dd></div></dl><p className="settings-card-description">Manage your password, authenticator, recovery codes and signed-in devices.</p><div className="account-actions"><button className="button primary" onClick={onAccount}>Manage account security<ArrowRight size={18}/></button><button className="button outline" disabled={logoutBusy} onClick={onLogout}><SignOut size={18}/>{logoutBusy?'Logging out…':'Log out'}</button></div>{logoutError&&<p className="auth-error" role="alert">{logoutError}</p>}</section>}
        {category==='workspace'&&<><section className="panel settings-card"><header><Clock size={25}/><div><h2>Session display</h2><p>Your market clock and briefing timestamps.</p></div></header><dl className="settings-facts"><div><dt>Time zone</dt><dd>Europe/Skopje <small>Daylight saving adjusts automatically</small></dd></div><div><dt>Time format</dt><dd>24-hour</dd></div><div><dt>Trading session</dt><dd>U.S. markets</dd></div></dl></section><section className="panel settings-card"><header><HardDrives size={25}/><div><h2>Workspace backup</h2><p>Keep a copy of your saved trading workspace.</p></div></header><p className="settings-card-description">Includes watchlist, imported levels, chart settings, drawings, plans, journal trades and notes. Passwords, API keys and account recovery codes are excluded.</p><button className="button outline" onClick={workspace.backup}><DownloadSimple size={18}/>Download workspace backup</button></section></>}
      </div>
    </div>
  </div>;
}
