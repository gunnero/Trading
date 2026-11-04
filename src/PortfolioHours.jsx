import {useEffect,useId,useRef,useState} from 'react';
import {X,Clock} from '@phosphor-icons/react';
import {activityRequest} from './PortfolioNotifications';
import {instrumentSession,SESSION_EVENTS} from './data/portfolio-sessions.mjs';
import {useDisplayTime} from './DisplayTime';
import './portfolio-insights.css';

export function usePortfolioHours(accountId,connected,ticker=''){
  const [saved,setSaved]=useState(null),[now,setNow]=useState(Date.now());
  const key=accountId+':'+ticker;
  useEffect(()=>{
    let active=true,busy=false;const ac=new AbortController();
    const refresh=async()=>{if(!connected||!accountId||busy||document.hidden)return;busy=true;try{const data=await activityRequest(`accounts/${accountId}/hours${ticker?'?ticker='+encodeURIComponent(ticker):''}`,undefined,ac.signal);if(active)setSaved({key,data});}catch(e){if(active&&!ac.signal.aborted)setSaved({key,data:{items:[],fetchedAt:null,error:e.message}});}finally{busy=false;}};
    refresh();const timer=setInterval(()=>{setNow(Date.now());refresh();},60000),clock=setInterval(()=>setNow(Date.now()),15000);
    document.addEventListener('visibilitychange',refresh);return()=>{active=false;ac.abort();clearInterval(timer);clearInterval(clock);document.removeEventListener('visibilitychange',refresh);};
  },[key,accountId,connected,ticker]);
  return {data:connected&&saved?.key===key?saved.data:null,now,connected};
}
export function StockHours({accountId,connected,ticker,name}){const hours=usePortfolioHours(accountId,connected,ticker);return <HoursButton hours={hours} ticker={ticker} name={name}/>;}
export function HoursButton({hours,ticker,name}){
  const [open,setOpen]=useState(false),item=hours.data?.items.find(i=>i.ticker===ticker),session=instrumentSession(item,hours.data?.fetchedAt,hours.now);
  return <><button type="button" className={`pi-hours pi-session-${session.phase}`} onClick={()=>setOpen(true)} aria-label={`${name}: ${session.label}. View trading hours`}><i aria-hidden="true"/>{session.label}</button>{open&&<HoursDialog item={item} hours={hours} session={session} name={name} onClose={()=>setOpen(false)}/>}</>;
}
function HoursDialog({item,hours,session,name,onClose}){
  const ref=useRef(),id=useId(),{journalStamp,zoneLabel}=useDisplayTime();
  useEffect(()=>{const trigger=document.activeElement;ref.current.showModal();return()=>{if(trigger?.isConnected)trigger.focus();};},[]);
  const events=item?.events||[],previous=events.filter(e=>e.at<=hours.now).at(-1),upcoming=events.filter(e=>e.at>hours.now).slice(0,16);
  return <dialog ref={ref} className="modal pi-hours-dialog" aria-labelledby={id} onCancel={e=>{e.preventDefault();e.stopPropagation();onClose();}} onClick={e=>{if(e.target===e.currentTarget){e.stopPropagation();onClose();}}}><div className="modal-inner"><header className="modal-header"><div><span className="eyebrow">TRADING HOURS · {zoneLabel}</span><h2 id={id}>{name}</h2></div><button className="icon-button" aria-label="Close trading hours" onClick={onClose}><X size={22}/></button></header>
    <p className={`pi-hours pi-session-${session.phase}`}><i/>{session.label}</p>
    {session.next&&<p><Clock size={16}/> Next: {SESSION_EVENTS[session.next.type]} · {journalStamp(session.next.at)}</p>}
    {hours.data?.error&&<p role="status" className="amber">{hours.data.error}</p>}
    {session.phase==='unknown'&&<p>{!hours.connected?'Connect this account to read its instrument schedule.':'A current schedule covering this time is not available. Check Metadata read permission on the Trading 212 key.'}</p>}
    {item&&<><p>{item.exchange||'Exchange not supplied'} · {item.extendedHours?'Extended-hours eligible':'Regular session only'}</p><h3>Broker schedule</h3><ul className="pi-hours-events">{[previous,...upcoming].filter(Boolean).map((e,i)=><li key={e.at+e.type}><span>{SESSION_EVENTS[e.type]}{i===0&&previous?' · latest event':''}</span><time>{journalStamp(e.at)}</time></li>)}</ul></>}
    <p className="pi-help">Scheduled hours from Trading 212. Halts and individual order acceptance are not monitored. Choose the trading session in the order ticket. Eligible market orders can include extended sessions; hours alone do not confirm that an order will fill.</p>
    <p className="pi-help">{hours.data?.fetchedAt?`Checked ${journalStamp(hours.data.fetchedAt)}. `:''}<a href="https://docs.trading212.com/api/instruments" target="_blank" rel="noreferrer">Trading 212 metadata ↗</a></p>
  </div></dialog>;
}
