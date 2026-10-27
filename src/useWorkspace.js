import {apiFetch} from './auth-client';
import { useEffect, useRef, useState } from 'react';
import { parseWatchlist } from './data/market';
import {levelSnapshots} from './data/level-history.mjs';

export function useWorkspace() {
  const [data,setData]=useState(null),[status,setStatus]=useState('loading'),[error,setError]=useState('');
  const current=useRef({data:null,revision:0,saved:'',busy:false,blocked:false,timer:null,alive:true});
  const load=async(signal)=>{
    setStatus('loading');setError('');
    try {
      const response=await apiFetch('/api/workspace',{signal});
      if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw new Error('Cannot load your saved workspace. Start the Opening Bell server and retry.');
      const result=await response.json();
      if(result.data?.schemaVersion!==1||!Number.isSafeInteger(result.revision))throw new Error('Unrecognized saved workspace.');
      levelSnapshots(result.data);parseWatchlist(result.data.watchText,{allowEmpty:true});
      if(signal?.aborted||!current.current.alive)return;
      Object.assign(current.current,{data:result.data,revision:result.revision,saved:JSON.stringify(result.data),blocked:false});
      setData(result.data);setStatus('saved');
    }catch(e){if(signal?.aborted||!current.current.alive)return;setError(e.message);setStatus('error');}
  };
  async function save() {
    const state=current.current;
    if(state.busy||state.blocked||!state.data)return;
    const snapshot=state.data,serialized=JSON.stringify(snapshot);
    if(serialized===state.saved){setStatus('saved');return;}
    state.busy=true;setStatus('saving');setError('');
    try {
      const response=await apiFetch('/api/workspace',{method:'PUT',headers:{'Content-Type':'application/json','X-Opening-Bell-Client':'web'},body:JSON.stringify({revision:state.revision,data:snapshot}),signal:AbortSignal.timeout(15000)});
      let result;try{result=await response.json();}catch{throw new Error('The server did not confirm the save. Your edits remain in this tab.');}
      if(!response.ok)throw Object.assign(new Error(result.message||'The workspace could not be saved.'),{conflict:response.status===409});
      if(!Number.isSafeInteger(result.revision))throw new Error('The save response could not be verified.');
      state.revision=result.revision;state.saved=serialized;
      if(state.alive)setStatus(JSON.stringify(state.data)===serialized?'saved':'pending');
    }catch(e){state.blocked=true;state.authBlocked=!!e.auth;if(state.alive){setStatus(e.conflict?'conflict':'error');setError(e.message);}}
    finally{state.busy=false;if(state.alive&&!state.blocked&&JSON.stringify(state.data)!==state.saved)state.timer=setTimeout(save,100);}
  }
  function update(change) {
    const state=current.current;if(!state.data)return;
    const next=typeof change==='function'?change(state.data):{...state.data,...change};
    if(next===state.data)return;
    state.data=next;setData(next);clearTimeout(state.timer);
    if(!state.blocked){setStatus('pending');state.timer=setTimeout(save,400);}
  }
  useEffect(()=>{
    current.current.alive=true;
    const controller=new AbortController();load(controller.signal);
    const protect=event=>{const s=current.current;if(s.data&&JSON.stringify(s.data)!==s.saved){event.preventDefault();event.returnValue='';}};
    const resume=()=>{if(current.current.authBlocked){current.current.authBlocked=false;current.current.blocked=false;save();}};
    window.addEventListener('opening-bell:session-restored',resume);
    window.addEventListener('beforeunload',protect);
    return()=>{current.current.alive=false;controller.abort();clearTimeout(current.current.timer);window.removeEventListener('beforeunload',protect);window.removeEventListener('opening-bell:session-restored',resume);};
  },[]);
  function backup(){const blob=new Blob([JSON.stringify(current.current.data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`opening-bell-workspace-${new Date().toISOString().slice(0,10)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  return {data,status,error,update,backup,reload:()=>load(),retry:()=>{if(!current.current.data)load();else{current.current.blocked=false;save();}}};
}
