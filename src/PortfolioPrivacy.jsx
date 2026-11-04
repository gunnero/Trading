import {useSyncExternalStore} from 'react';
import {EyeSlash} from '@phosphor-icons/react';
import './portfolio-privacy.css';

const key='opening-bell.portfolio-view.v1';
const defaults={hideNames:false,hideBalances:false,filter:'all',account:null};
const id=value=>typeof value==='string'&&value.length<=100?value:null;
function read(){
  try{const value=JSON.parse(localStorage.getItem(key));return {...defaults,hideNames:value?.hideNames===true,hideBalances:value?.hideBalances===true,filter:id(value?.filter)||'all',account:id(value?.account)};}catch{return {...defaults};}
}
let saved=read(),storageFailed=false;
const listeners=new Set();
const emit=()=>listeners.forEach(listener=>listener());
if(typeof window!=='undefined')window.addEventListener('storage',event=>{if(event.key===key||event.key===null){saved=read();storageFailed=false;emit();}});
function update(patch){
  saved={...saved,...patch};
  try{localStorage.setItem(key,JSON.stringify(saved));storageFailed=false;}catch{storageFailed=true;}
  emit();
}
const subscribe=listener=>{listeners.add(listener);return()=>listeners.delete(listener);};
const snapshot=()=>saved;
function alias(value,prefix){
  // Opaque, stable display aliases; never include initials or a name fragment.
  let hash=2166136261;for(const c of String(value||''))hash=Math.imul(hash^c.charCodeAt(0),16777619);
  return `${prefix} ${(hash>>>0).toString(36).toUpperCase().padStart(7,'0').slice(-5)}`;
}
export function usePortfolioPrivacy(){
  const prefs=useSyncExternalStore(subscribe,snapshot,snapshot),privateMode=prefs.hideNames||prefs.hideBalances;
  return {...prefs,privateMode,storageFailed,update,
    person:name=>prefs.hideNames?alias(name,'Person'):name,
    label:(label,accountId)=>prefs.hideNames?alias(accountId||label,'Account'):label,
    money:(value,currency)=>prefs.hideBalances?'••••':Number.isFinite(value)&&currency?new Intl.NumberFormat('en-US',{style:'currency',currency,maximumFractionDigits:2}).format(value):'—',
    number:value=>prefs.hideBalances?'••••':Number.isFinite(value)?new Intl.NumberFormat('en-US',{maximumFractionDigits:8}).format(value):'—',
  };
}
export function PortfolioPrivacyControls(){
  const p=usePortfolioPrivacy();
  return <div className="portfolio-privacy" aria-label="Portfolio privacy"><div><EyeSlash size={18}/><strong>Privacy</strong><button className="button outline" aria-pressed={p.hideNames} onClick={()=>p.update({hideNames:!p.hideNames})}>Hide names</button><button className="button outline" aria-pressed={p.hideBalances} onClick={()=>p.update({hideBalances:!p.hideBalances})}>Hide balances</button></div><p>{p.storageFailed?'This browser could not save your preferences. They apply until the page closes.':'Remembered on this browser.'}{p.privateMode?' Show names and balances to trade, edit private details or export.':''}</p></div>;
}
