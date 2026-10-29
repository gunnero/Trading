import {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,ArrowsClockwise,WarningCircle} from '@phosphor-icons/react';
import {createFeedCache} from './data/feed-cache.mjs';
import {briefingTime as marketTime} from './data/calendar.mjs';
export function useMinuteClock() {
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{const tick=()=>{if(!document.hidden)setNow(Date.now());};const timer=setInterval(tick,60000);document.addEventListener('visibilitychange',tick);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',tick);};},[]);
  return now;
}
const feeds=createFeedCache();
export const invalidateFeed=url=>feeds.invalidate(url);
export function useFeed(url,active=true) {
  const [state,setState]=useState({key:url,value:feeds.peek(url)||{status:'loading'}});
  const refreshRef=useRef(()=>{});
  useEffect(()=>{
    if(!url||!active){refreshRef.current=()=>{};return;}
    let cancelled=false,busy=false;
    async function request(force=false){
      if(cancelled||busy||document.hidden)return;
      busy=true;
      if(force)setState(s=>({key:url,value:{...(s.key===url?s.value:{status:'loading'}),refreshing:true}}));
      const value=await feeds.read(url,force);
      if(!cancelled)setState({key:url,value});
      busy=false;
    }
    refreshRef.current=()=>request(true);
    const onVisible=()=>request();
    request();const timer=setInterval(onVisible,10*60*1000);
    document.addEventListener('visibilitychange',onVisible);
    return()=>{cancelled=true;clearInterval(timer);document.removeEventListener('visibilitychange',onVisible);};
  },[url,active]);
  return {...(state.key===url?state.value:feeds.peek(url)||{status:'loading'}),refresh:()=>refreshRef.current()};
}
export function SourceLink({href,children}) {return <a className="source-link" href={href} target="_blank" rel="noopener noreferrer">{children}<ArrowUpRight size={14}/></a>;}
export function FeedStatus({feed,label,warning=false,checkedTime=false}) {
  const timestamp=checkedTime?(feed.checkedAt||feed.fetchedAt):feed.fetchedAt;
  return <div className="feed-status"><span className={feed.status === 'ok'&&!warning ? 'green' : 'amber'}>{label||(feed.status === 'loading' ? 'Connecting…' : feed.status === 'ok' ? feed.source?.delivery === 'daily' ? 'Automatic · daily snapshot' : 'Connected' : feed.status === 'stale' ? 'Last available reading' : 'Feed unavailable')}</span>{timestamp && <span>{checkedTime?'Source checked':'Fetched'} {marketTime(timestamp)} Skopje</span>}<button className="icon-button" title="Check source (cached requests may be reused)" aria-label="Refresh source" disabled={feed.status === 'loading' || feed.refreshing} onClick={feed.refresh}><ArrowsClockwise size={16}/></button></div>;
}
export function Unavailable({feed,children}) {return <div className="feed-empty" role="status"><WarningCircle size={22}/><strong>{feed.status === 'loading' ? 'Connecting to source…' : 'Reading unavailable'}</strong><p>{feed.status === 'loading' ? 'Checking the latest published data.' : children || feed.message || 'Open the source to check the latest update.'}</p></div>;}
