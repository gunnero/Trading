import {useCallback,useEffect,useRef,useState} from 'react';
import {activityRequest} from './PortfolioNotifications';
export const portfolioMoney=(value,currency)=>Number.isFinite(value)&&currency?new Intl.NumberFormat('en-US',{style:'currency',currency,maximumFractionDigits:2}).format(value):'—';
export const portfolioNumber=value=>Number.isFinite(value)?new Intl.NumberFormat('en-US',{maximumFractionDigits:8}).format(value):'—';
export const portfolioPercent=value=>Number.isFinite(value)?`${value>0?'+':''}${value.toFixed(2)}%`:'—';
export const portfolioTone=value=>value>0?'green':value<0?'red':'';
const readResource=(path,signal)=>activityRequest(path,undefined,signal);
export function usePortfolioResource(path,interval=60000,read=readResource){
  const [saved,setSaved]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),active=useRef(false),sequence=useRef(0),controller=useRef(null);
  const refresh=useCallback(async()=>{
    if(!path){setBusy(false);return;}
    const seq=++sequence.current;controller.current?.abort();const ac=new AbortController();controller.current=ac;setBusy(true);
    const publish=data=>{if(active.current&&seq===sequence.current){setSaved({path,data});setError('');}};
    try{publish(await read(path,ac.signal,publish));}
    catch(e){if(active.current&&!ac.signal.aborted&&seq===sequence.current)setError(e.message);}
    finally{if(active.current&&seq===sequence.current)setBusy(false);}
  },[path,read]);
  useEffect(()=>{active.current=true;setError('');refresh();const visible=()=>{if(!document.hidden)refresh();},timer=setInterval(visible,interval);document.addEventListener('visibilitychange',visible);return()=>{active.current=false;sequence.current++;controller.current?.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visible);};},[refresh,interval]);
  return {data:saved?.path===path?saved.data:null,error,busy,refresh};
}
export function downloadPortfolioCsv(csv,name){const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

export function usePortfolioSettings(account,refresh){
  const [draft,setDraft]=useState(account.settings),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{if(!dirty)setDraft(account.settings);},[account.settings,dirty]);
  const edit=(key,value)=>{setDirty(true);setDraft(d=>({...d,[key]:value}));};
  async function save(patch){
    setBusy(true);setError('');
    try{
      const result=await activityRequest('insights/planning',{accountId:account.id,revision:draft.revision,...patch});
      setDraft(result.accounts.find(a=>a.id===account.id).settings);
      await refresh();
      setDirty(false);
    }catch(e){
      setError(e.message);
      await refresh();
    }finally{setBusy(false);}
  }
  const reload=()=>{setDraft(account.settings);setDirty(false);setError('');};
  return {draft,edit,save,busy,error,dirty,reload};
}
