import {createContext,useContext,useEffect,useRef,useState} from 'react';
import {Bell,LockKey,ShieldCheck,Eye,EyeSlash,SignOut,X} from '@phosphor-icons/react';
import {authRequest,setSessionToken,sessionToken} from './auth-client';
import './auth.css';

const AuthContext=createContext(null);
export const useAuth=()=>useContext(AuthContext);
let initialActivation=new URLSearchParams(location.hash.slice(1)).get('activate');
if(initialActivation)history.replaceState(null,'',location.pathname+location.search+'#overview');
function Password({label='Password',value,onChange,autoComplete='current-password',id='login-password',...rest}){
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
    <div className="auth-brand"><Bell size={27}/><span>OPENING BELL<small>Your private trading desk</small></span><LockKey size={19}/></div>
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

export function AccountDialog({onClose,workspace}){
  const {user,session,accept,signOut}=useAuth(),ref=useRef(null);
  const [password,setPassword]=useState(''),[code,setCode]=useState(''),[nextPassword,setNextPassword]=useState(''),[repeat,setRepeat]=useState(''),[enrollment,setEnrollment]=useState(null),[recovery,setRecovery]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{const trigger=document.activeElement,dialog=ref.current,overflow=document.body.style.overflow;document.body.style.overflow='hidden';dialog.showModal();return()=>{dialog.close();document.body.style.overflow=overflow;if(trigger?.isConnected)trigger.focus({preventScroll:true});};},[]);
  async function action(kind){
    if(busy)return;setBusy(true);setError('');setNotice('');
    try{
      if(kind==='password'&&nextPassword!==repeat)throw Error('The new passwords do not match.');
      const result=await authRequest(kind,{password,code:code.trim(),...(kind==='password'?{newPassword:nextPassword}:{})});
      if(kind==='totp/start'){setEnrollment(result);setCode('');}
      else{if(result.authenticated)accept(result);setEnrollment(null);setRecovery(result.recoveryCodes||null);setPassword('');setCode('');setNextPassword('');setRepeat('');setNotice(kind==='password'?'Password changed. Other sessions have been signed out.':'Two-step verification is enabled. Save your recovery codes below.');}
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function logout(all){
    if(workspace.status!=='saved'&&!confirm('There are unsaved changes. Sign out and discard those unsaved changes?'))return;
    setBusy(true);setError('');try{await signOut(all);}catch(e){setError(e.message);setBusy(false);}
  }
  function downloadCodes(){const url=URL.createObjectURL(new Blob([`Opening Bell recovery codes\n${user.email}\nEach code works once with your password. Keep this file private.\n\n${recovery.join('\n')}\n`],{type:'text/plain'})),link=document.createElement('a');link.href=url;link.download='opening-bell-recovery-codes.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  return <dialog ref={ref} className="modal account-modal" aria-labelledby="account-title" onCancel={onClose}><div className="modal-inner">
    <header className="modal-header"><div><span className="eyebrow">PRIVATE ACCESS</span><h2 id="account-title">Account & security</h2></div><button className="icon-button" aria-label="Close account settings" onClick={onClose}><X size={22}/></button></header>
    <div className="account-profile"><ShieldCheck size={29}/><div><strong>{user.name}</strong><span>{user.email}</span><small>@{user.username}</small></div></div>
    <p className={`account-security-state ${user.mfaEnabled?'green':'amber'}`}>{user.mfaEnabled?'Two-step verification enabled':'Two-step verification is off'}<small>{user.mfaEnabled?'Your password and an authenticator or recovery code are required at sign-in.':'Enable it before this app goes public.'}</small></p>
    {notice&&<p className="auth-notice" role="status">{notice}</p>}{error&&<p className="auth-error" role="alert">{error}</p>}
    {recovery?<section className="account-recovery"><h3>Save these recovery codes</h3><p>Each code works once with your password if you lose your authenticator. These codes are shown only now.</p><div>{recovery.map(code=><code key={code}>{code}</code>)}</div><button className="button primary" onClick={downloadCodes}>Download recovery codes</button><button className="button outline" onClick={()=>{setRecovery(null);setNotice('Recovery codes saved. Keep them somewhere private.');}}>I have saved my codes</button></section>:enrollment?<section className="account-enrollment"><h3>Add Opening Bell to your authenticator</h3><p>Scan this QR code with your authenticator app, then enter its six-digit code.</p><img src={enrollment.qr} width="240" height="240" alt="Authenticator enrollment QR code"/><details><summary>Enter the key manually</summary><code>{enrollment.secret}</code></details><form onSubmit={e=>{e.preventDefault();action('totp/confirm');}}><label className="auth-field"><span>Authenticator code</span><input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={e=>setCode(e.target.value)}/></label><button className="button primary" type="submit" disabled={busy}>{busy?'Checking…':'Enable two-step verification'}</button><button className="button outline" type="button" onClick={()=>setEnrollment(null)}>Cancel</button></form></section>:<>
      <section className="account-section"><h3>Verify your identity to make changes</h3><Password id="account-password" label="Current password" value={password} onChange={e=>setPassword(e.target.value)} maxLength={128}/>{user.mfaEnabled&&<label className="auth-field"><span>Authenticator or recovery code</span><input autoComplete="one-time-code" maxLength={50} value={code} onChange={e=>setCode(e.target.value)}/></label>}
        <div className="account-actions"><button className="button primary" disabled={busy||!password} onClick={()=>action('totp/start')}>{user.mfaEnabled?'Replace authenticator':'Set up two-step verification'}</button>{user.mfaEnabled&&<button className="button outline" disabled={busy||!password} onClick={()=>action('recovery-codes')}>Replace recovery codes</button>}</div>
      </section>
      <details className="account-section"><summary>Change password</summary><form onSubmit={e=>{e.preventDefault();action('password');}}><Password id="account-new-password" label="New password" autoComplete="new-password" value={nextPassword} onChange={e=>setNextPassword(e.target.value)} minLength={15} maxLength={128} required/><Password id="account-repeat-password" label="Confirm new password" autoComplete="new-password" value={repeat} onChange={e=>setRepeat(e.target.value)} minLength={15} maxLength={128} required/><button className="button outline" disabled={busy||!password} type="submit">Change password</button><p className="auth-hint">15–128 characters. Other signed-in devices will be signed out.</p></form></details>
    </>}
    <section className="account-section"><h3>Sessions</h3><p>{session.sessionCount} active {session.sessionCount===1?'session':'sessions'}. Stay signed in for 30 days from sign-in, including after closing your browser. Signing out or changing account security ends sessions earlier.</p><div className="account-actions"><button className="button outline" disabled={busy} onClick={()=>logout(false)}><SignOut size={18}/>Sign out</button><button className="text-button" disabled={busy} onClick={()=>logout(true)}>Sign out all devices</button></div></section>
  </div></dialog>;
}
