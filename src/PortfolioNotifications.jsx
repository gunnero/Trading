import {usePortfolioPrivacy} from './PortfolioPrivacy';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Bell,X} from '@phosphor-icons/react';
import {apiFetch} from './auth-client';
import {orderStatusLabel} from './data/portfolio-activity.mjs';
import './portfolio-activity.css';

export async function activityRequest(path,body,signal){
  const response=await apiFetch('/api/portfolio'+(path?'/'+path:''),{signal:signal||AbortSignal.timeout(15000),...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Opening-Bell-Client':'web'},body:JSON.stringify(body)})});
  const result=await response.json();if(!response.ok)throw Error(result.message||'Activity could not be loaded.');return result;
}
export function usePortfolioNotifications(){
  const [feed,setFeed]=useState(null),[notice,setNotice]=useState(null),[error,setError]=useState('');
  const active=useRef(false),latest=useRef(null),sequence=useRef(0),busy=useRef(false);
  const accept=useCallback(data=>{
    if(!active.current)return;
    if(latest.current!==null&&data.latestId>latest.current){const event=data.items.find(item=>!item.read&&item.eventId>latest.current);if(event)setNotice(event);}
    latest.current=Math.max(latest.current||0,data.latestId);setFeed(data);setError('');
  },[]);
  const refresh=useCallback(async()=>{
    if(busy.current||document.hidden)return;busy.current=true;const seq=++sequence.current;
    try{const data=await activityRequest('notifications');if(seq===sequence.current)accept(data);}
    catch(e){if(active.current&&seq===sequence.current)setError(e.message);}
    finally{busy.current=false;}
  },[accept]);
  const markRead=useCallback(async through=>{
    const seq=++sequence.current,data=await activityRequest('notifications/read',{through});
    if(seq===sequence.current){accept(data);setNotice(item=>item?.eventId<=through?null:item);}
  },[accept]);
  useEffect(()=>{active.current=true;refresh();const timer=setInterval(refresh,15000),visible=()=>{if(!document.hidden)refresh();};document.addEventListener('visibilitychange',visible);return()=>{active.current=false;sequence.current++;clearInterval(timer);document.removeEventListener('visibilitychange',visible);};},[refresh]);
  return {feed,notice,error,refresh,markRead,dismiss:()=>setNotice(null)};
}
export function PortfolioNotice({event,onOpen,onDismiss}){
  const privacy=usePortfolioPrivacy();
  if(!event)return null;
  return <div className="pa-notice" role="status"><Bell size={20}/><div><strong>{event.name||event.ticker} · {event.kind==='price'?'Price alert':orderStatusLabel(event.status)}</strong><span>{event.kind==='price'&&!privacy.privateMode?event.message+' · ':''}{privacy.person(event.person)} · {privacy.label(event.accountLabel,event.accountId)}{event.environment==='demo'?' · DEMO':''}</span></div><button className="text-button" onClick={onOpen}>View activity</button><button className="icon-button" onClick={onDismiss} aria-label={event.kind==='price'?'Dismiss price notification':'Dismiss order notification'}><X size={18}/></button></div>;
}
