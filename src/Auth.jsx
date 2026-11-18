import {createContext,useContext,useEffect,useRef,useState} from 'react';
import {LockKey} from '@phosphor-icons/react';
import {authRequest,setSessionToken,sessionToken} from './auth-client';
import {AccessScreen} from './AccessScreen';
import './auth.css';

const AuthContext=createContext(null);
export const useAuth=()=>useContext(AuthContext);
let initialActivation=new URLSearchParams(location.hash.slice(1)).get('activate');
if(initialActivation)history.replaceState(null,'',location.pathname+location.search+'#overview');
function LockScreen({children}){
  const ref=useRef(null);
  useEffect(()=>{ref.current.showModal();const dialog=ref.current,old=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{dialog.close();document.body.style.overflow=old;};},[]);
  return <dialog ref={ref} className="auth-lock" aria-label="Sign in to unlock your workspace" onCancel={event=>event.preventDefault()}>{children}</dialog>;
}
export function AuthGate({children}){
  const [session,setSession]=useState(null),[checking,setChecking]=useState(true),[everSigned,setEverSigned]=useState(false),[activation,setActivation]=useState(initialActivation),[connectionError,setConnectionError]=useState('');
  const channel=useRef(null),current=useRef(null),lastActivity=useRef(0),lastSigned=useRef(null),epoch=useRef(0);
  function accept(result){if(!result.authenticated&&current.current?.authenticated)epoch.current++;setSessionToken(result.authenticated?result.csrf:null);current.current=result;setSession(result);setChecking(false);setConnectionError('');if(result.authenticated){lastSigned.current=result;setEverSigned(true);if(!initialActivation)setActivation(null);}}
  async function check(){const version=epoch.current;try{const result=await authRequest('session');if(version===epoch.current)accept(result);}catch{setChecking(false);if(!current.current?.authenticated)setConnectionError('Cannot connect to the private account service. Please retry.');}}
  useEffect(()=>{
    let alive=true;const version=epoch.current;authRequest('session').then(result=>{if(alive&&epoch.current===version)accept(result);}).catch(()=>{if(alive){setChecking(false);setConnectionError('Cannot connect to the private account service. Please retry.');}});
    const lock=()=>{epoch.current++;setSessionToken(null);current.current={authenticated:false,configured:true};setSession(current.current);};
    const activate=()=>{const token=new URLSearchParams(location.hash.slice(1)).get('activate');if(token){initialActivation=token;history.replaceState(null,'',location.pathname+location.search+'#overview');setActivation(token);}};
    const visible=()=>{if(!document.hidden)check();};
    const timer=setInterval(visible,60000);document.addEventListener('visibilitychange',visible);window.addEventListener('opening-bell:session-expired',lock);window.addEventListener('pageshow',visible);window.addEventListener('hashchange',activate);
    if('BroadcastChannel' in window){channel.current=new BroadcastChannel('opening-bell-account');channel.current.onmessage=event=>{if(event.data==='logout'){lock();setEverSigned(false);}else if(event.data==='login')check();};}
    const activity=event=>{
      if(!event.isTrusted||document.hidden||!current.current?.authenticated||!sessionToken()||Date.now()-lastActivity.current<60000)return;
      lastActivity.current=Date.now();const version=epoch.current;authRequest('activity',{}).then(result=>{if(alive&&version===epoch.current&&current.current?.authenticated)accept(result);}).catch(()=>check());
    };
    const events=['pointerdown','keydown','wheel'];for(const event of events)window.addEventListener(event,activity,{passive:true});
    return()=>{alive=false;clearInterval(timer);document.removeEventListener('visibilitychange',visible);window.removeEventListener('opening-bell:session-expired',lock);window.removeEventListener('pageshow',visible);window.removeEventListener('hashchange',activate);channel.current?.close();for(const event of events)window.removeEventListener(event,activity);};
  },[]);
  const signedIn=!!session?.authenticated&&!activation;
  const authenticated=result=>{initialActivation=null;epoch.current++;accept(result);setActivation(null);channel.current?.postMessage('login');window.dispatchEvent(new Event('opening-bell:session-restored'));};
  async function signOut(all=false){await authRequest(all?'logout-all':'logout',{});setSessionToken(null);channel.current?.postMessage('logout');location.reload();}
  const form=<AccessScreen key={activation||'desk'} activation={activation} onAuthenticated={authenticated} locked={everSigned} configured={session?.configured!==false} connectionError={connectionError} onRetry={check}/>;
  if(checking)return <div className="workspace-loading"><LockKey size={32}/><p>Checking private access…</p></div>;
  return <AuthContext.Provider value={{user:session?.user||lastSigned.current?.user,session:session?.authenticated?session:lastSigned.current,accept:authenticated,signOut}}>
    {everSigned&&<div hidden={!signedIn} inert={!signedIn||undefined}>{children}</div>}
    {!signedIn&&(everSigned?<LockScreen>{form}</LockScreen>:form)}
  </AuthContext.Provider>;
}
