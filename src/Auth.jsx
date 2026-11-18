import {createContext,useContext,useEffect,useRef,useState} from 'react';
import {ChartBar,LockKey,ShieldCheck,Eye,EyeSlash} from '@phosphor-icons/react';
import {authRequest,setSessionToken,sessionToken} from './auth-client';
import './auth.css';

const AuthContext=createContext(null);
export const useAuth=()=>useContext(AuthContext);
let initialActivation=new URLSearchParams(location.hash.slice(1)).get('activate');
if(initialActivation)history.replaceState(null,'',location.pathname+location.search+'#overview');
export function Password({label='Password',value,onChange,autoComplete='current-password',id='login-password',...rest}){
  const [show,setShow]=useState(false);
  return <label className="auth-field" htmlFor={id}><span>{label}</span><span className="auth-password"><input id={id} type={show?'text':'password'} autoComplete={autoComplete} value={value} onChange={onChange} {...rest}/><button type="button" className="icon-button" aria-label={show?`Hide ${label.toLowerCase()}`:`Show ${label.toLowerCase()}`} aria-pressed={show} onClick={()=>setShow(v=>!v)}>{show?<EyeSlash size={19}/>:<Eye size={19}/>}</button></span></label>;
}
function AuthScreen({activation,onAuthenticated,locked=false,configured=true,onRetry,connectionError}){
  const [identifier,setIdentifier]=useState(''),[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState(''),[code,setCode]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(event){
    event.preventDefault();if(busy)return;
    if(activation&&password!==confirmation){setError('The passwords do not match.');return;}
    setBusy(true);setError('');
    try{const result=await authRequest(activation?'setup':'login',activation?{token:activation,password}:{identifier,password,code:code.trim()});setPassword('');setConfirmation('');setCode('');initialActivation=null;onAuthenticated(result);}
    catch(error){setError(error.name==='TimeoutError'?'The sign-in request timed out. Please try again.':error.message);setCode('');}finally{setBusy(false);}
  }
  return <section className="auth-screen"><div className="auth-card">
    <div className="auth-brand"><ChartBar size={30} weight="fill"/><span>Trading Desk<small>Your private trading desk</small></span><LockKey size={19}/></div>
    <div className="auth-intro"><span className="eyebrow">PRIVATE WORKSPACE</span><h1>{activation?'Set up your account':locked?'Your desk is locked':'Welcome back.'}</h1><p>{activation?'Choose a unique password, then add two-step verification to protect your desk.':locked?'Sign in again to continue. Unsaved edits are kept in this tab.':'Sign in to your charts, watchlist and trading plans.'}</p></div>
    {connectionError?<div className="auth-message" role="alert"><p>{connectionError}</p><button className="button primary" onClick={onRetry}>Retry connection</button></div>:!configured&&!activation?<div className="auth-message"><ShieldCheck size={27}/><h2>Owner activation required</h2><p>Your workspace is protected. Open the private activation link created on this computer to set your password.</p><p className="muted">There is no public registration.</p><button className="button outline" onClick={onRetry}>Check activation</button></div>:<form onSubmit={submit}>
      {!activation&&<label className="auth-field"><span>Email or username</span><input name="username" autoComplete="username" autoCapitalize="none" spellCheck="false" value={identifier} onChange={e=>setIdentifier(e.target.value)} maxLength={254} required autoFocus/></label>}
      <Password label={activation?'Create password':'Password'} value={password} onChange={e=>setPassword(e.target.value)} autoComplete={activation?'new-password':'current-password'} minLength={activation?15:undefined} maxLength={128} required autoFocus={!!activation}/>
      {activation?<><p className="auth-hint">15–128 characters. A unique passphrase or a password manager works well.</p><Password id="confirm-password" label="Confirm password" value={confirmation} onChange={e=>setConfirmation(e.target.value)} autoComplete="new-password" maxLength={128} required/></>:<label className="auth-field"><span>Authenticator or recovery code <small>if enabled</small></span><input name="code" autoComplete="one-time-code" autoCapitalize="none" spellCheck="false" value={code} onChange={e=>setCode(e.target.value)} maxLength={50} placeholder="6-digit code or a saved recovery code"/></label>}
      {error&&<p className="auth-error" role="alert">{error}</p>}
      <button className="button primary auth-submit" disabled={busy} type="submit">{busy?'Checking securely…':activation?'Activate account':'Sign in'}<LockKey size={18}/></button>
      {!activation&&<p className="auth-hint">Stay signed in on this browser for 30 days, including after closing it.</p>}
      {!activation&&<details className="auth-help"><summary>Need help signing in?</summary><p>Use a saved recovery code if you cannot access your authenticator. If you have forgotten your password, use a private owner recovery link created on the server. Email resets are not enabled.</p></details>}
    </form>}
    <div className="auth-footer"><ShieldCheck size={16}/><span>Private access · no public sign-up</span></div>
  </div></section>;
}
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
  const authenticated=result=>{epoch.current++;accept(result);setActivation(null);channel.current?.postMessage('login');window.dispatchEvent(new Event('opening-bell:session-restored'));};
  async function signOut(all=false){await authRequest(all?'logout-all':'logout',{});setSessionToken(null);channel.current?.postMessage('logout');location.reload();}
  const form=<AuthScreen activation={activation} onAuthenticated={authenticated} locked={everSigned} configured={session?.configured!==false} connectionError={connectionError} onRetry={check}/>;
  if(checking)return <div className="workspace-loading"><LockKey size={32}/><p>Checking private access…</p></div>;
  return <AuthContext.Provider value={{user:session?.user||lastSigned.current?.user,session:session?.authenticated?session:lastSigned.current,accept:authenticated,signOut}}>
    {everSigned&&<div hidden={!signedIn} inert={!signedIn||undefined}>{children}</div>}
    {!signedIn&&(everSigned?<LockScreen>{form}</LockScreen>:form)}
  </AuthContext.Provider>;
}
