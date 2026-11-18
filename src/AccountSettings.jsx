import {useRef,useState} from 'react';
import {DeviceMobile,Laptop,LockKey,ShieldCheck} from '@phosphor-icons/react';
import {Password,useAuth} from './Auth';
import {authRequest} from './auth-client';
import {useDisplayTime} from './DisplayTime';
import './account-security.css';

function SecurityRow({icon:Icon,title,description,label,value,tone,action,selected,disabled,onSelect}){
  return <div className="security-row">
    <div className="security-method"><span className="security-icon"><Icon size={27}/></span><div><h3>{title}</h3><p>{description}</p></div></div>
    <div className="security-status"><small>{label}</small><strong className={tone}>{value}</strong></div>
    <button type="button" className="button primary" aria-pressed={selected} disabled={disabled} onClick={onSelect}>{action}</button>
  </div>;
}

export function AccountSettings({workspace}){
  const {user,session,accept,signOut}=useAuth();
  const {clockDate,clockTime,zoneLabel}=useDisplayTime();
  const [selected,select]=useState(null),[password,setPassword]=useState(''),[code,setCode]=useState('');
  const [nextPassword,setNextPassword]=useState(''),[repeat,setRepeat]=useState('');
  const [enrollment,setEnrollment]=useState(null),[recovery,setRecovery]=useState(null);
  const [notice,setNotice]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const form=useRef(null);
  const mfa=user.mfaEnabled;
  const blocked=busy||!!enrollment||!!recovery;
  const canVerify=!!selected&&!!password&&(!mfa||!!code.trim())&&(selected!=='password'||(nextPassword.length>=15&&!!repeat));
  const count=session.recoveryCodesRemaining;
  const remaining=Number.isInteger(count)?count===1?'1 unused code':count+' unused codes':'Count unavailable';
  const verifyLabel=selected==='password'?'Update password':selected==='recovery-codes'?'Replace recovery codes':selected==='totp/start'?'Continue to setup':'Verify identity';

  function clearFields(){
    setPassword('');setCode('');setNextPassword('');setRepeat('');
  }
  function choose(kind){
    select(kind);setError('');setNotice('');setNextPassword('');setRepeat('');
    form.current?.querySelector('#account-password')?.focus();
  }
  function cancel(){
    clearFields();select(null);setEnrollment(null);setError('');setNotice('');
  }
  async function submit(event){
    event.preventDefault();
    if(busy||(!enrollment&&!canVerify))return;
    setError('');setNotice('');
    if(selected==='password'&&nextPassword!==repeat){setError('The new passwords do not match.');return;}
    setBusy(true);
    try{
      const kind=enrollment?'totp/confirm':selected;
      const payload=enrollment?{code:code.trim()}:{password,code:code.trim()};
      if(kind==='password')payload.newPassword=nextPassword;
      const result=await authRequest(kind,payload);
      clearFields();
      if(kind==='totp/start'){setEnrollment(result);return;}
      const {recoveryCodes,...profile}=result;
      if(profile.authenticated)accept(profile);
      setEnrollment(null);select(null);setRecovery(recoveryCodes||null);
      setNotice(kind==='password'?'Password changed. Other sessions have been signed out.':kind==='totp/confirm'?'Two-step verification enabled.':'New recovery codes generated.');
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function logout(all){
    if(workspace.status!=='saved'&&!confirm('There are unsaved changes. Sign out and discard those unsaved changes?'))return;
    setBusy(true);setError('');
    try{await signOut(all);}catch(e){setError(e.message);setBusy(false);}
  }
  function downloadCodes(){
    const text=['Trading Desk recovery codes',user.email,'Each code works once with your password. Keep this file private.','',...recovery,''].join('\n');
    const url=URL.createObjectURL(new Blob([text],{type:'text/plain'}));
    const link=document.createElement('a');link.href=url;link.download='trading-desk-recovery-codes.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <section className="security-page" aria-labelledby="account-title">
    <header className="security-heading"><h2 id="account-title">Account &amp; security</h2><p>Private access to your workspace.</p></header>
    <section className="security-identity"><h3>Account identity</h3><div><strong>{user.name}</strong><span>{user.email} · @{user.username}</span></div></section>
    <div className="security-methods">
      <SecurityRow icon={LockKey} title="Password" description="Keep your workspace secure with a strong password." label="Last changed"
        value={Number.isFinite(session.passwordChangedAt)?clockDate(session.passwordChangedAt):'Date unavailable'} action="Change password" selected={selected==='password'} disabled={blocked} onSelect={()=>choose('password')}/>
      <SecurityRow icon={DeviceMobile} title="Two-step verification" description="Confirm your sign-in with an authenticator app." label="Status"
        value={mfa?'Enabled':'Off'} tone={mfa?'green':'amber'} action={mfa?'Manage authenticator':'Set up two-step verification'} selected={selected==='totp/start'} disabled={blocked} onSelect={()=>choose('totp/start')}/>
      <SecurityRow icon={ShieldCheck} title="Recovery" description="Use a recovery code if you lose access to your authenticator." label="Recovery codes"
        value={mfa?remaining:'Set up two-step verification first'} tone={mfa&&count>0?'green':undefined} action="Generate new codes" selected={selected==='recovery-codes'} disabled={blocked||!mfa} onSelect={()=>choose('recovery-codes')}/>
    </div>

    {notice&&<p className="auth-notice" role="status">{notice}</p>}
    {recovery?<section className="security-verify account-recovery">
      <h3>Save these recovery codes</h3><p>Each code works once with your password. Download or copy them before you leave this page.</p>
      <div>{recovery.map(item=><code key={item}>{item}</code>)}</div>
      <button className="button primary" onClick={downloadCodes}>Download recovery codes</button>
      <button className="button outline" onClick={()=>{setRecovery(null);setNotice('Recovery codes saved. Keep them somewhere private.');}}>I have saved my codes</button>
    </section>:enrollment?<section className="security-verify account-enrollment">
      <h3>Add Trading Desk to your authenticator</h3><p>Scan this QR code with your authenticator app, then enter its six-digit code.</p>
      <img src={enrollment.qr} width="240" height="240" alt="Authenticator enrollment QR code"/>
      <details><summary>Enter the key manually</summary><code>{enrollment.secret}</code></details>
      <form onSubmit={submit}><label className="auth-field"><span>Authenticator code</span><input autoFocus autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={e=>setCode(e.target.value)}/></label>
        <button className="button primary" disabled={busy||code.length!==6} type="submit">{busy?'Checking…':'Enable two-step verification'}</button>
        <button className="button outline" disabled={busy} type="button" onClick={cancel}>Cancel</button></form>
    </section>:<section className="security-verify">
      <header><div><h3>Verify your identity to make changes</h3><p>{selected==='password'?'Use 15–128 characters for your new password. Other sessions will be signed out.':
        selected==='recovery-codes'?'Replacing your codes invalidates the previous set and signs out other sessions.':
        selected==='totp/start'?(mfa?'Verify your current credentials to set up a replacement authenticator.':'Enter your password to set up your authenticator.'):
        'Choose a change above, then enter your current credentials.'}</p></div>
        {selected&&<button className="text-button" disabled={busy} onClick={cancel}>Cancel</button>}</header>
      <form ref={form} onSubmit={submit} className="security-fields">
        <Password id="account-password" label="Current password" value={password} onChange={e=>setPassword(e.target.value)} maxLength={128} required/>
        {mfa&&<label className="auth-field"><span>Authenticator or recovery code</span><input autoComplete="one-time-code" maxLength={50} required value={code} onChange={e=>setCode(e.target.value)}/></label>}
        {selected==='password'&&<div className="security-new-password">
          <Password id="account-new-password" label="New password" autoComplete="new-password" value={nextPassword} onChange={e=>setNextPassword(e.target.value)} minLength={15} maxLength={128} required/>
          <Password id="account-repeat-password" label="Confirm new password" autoComplete="new-password" value={repeat} onChange={e=>setRepeat(e.target.value)} minLength={15} maxLength={128} required/>
        </div>}
        <button className="button primary" type="submit" disabled={busy||!canVerify}>{busy?'Checking…':verifyLabel}</button>
      </form>
    </section>}
    {error&&<p role="alert" className="auth-error">{error}</p>}

    <section className="security-sessions" aria-labelledby="security-sessions-title">
      <h3 id="security-sessions-title">Sessions</h3><p>Stay signed in for 30 days from sign-in, including after closing your browser.</p>
      <table><thead><tr><th scope="col">Session</th><th scope="col">Started</th><th scope="col">Details</th><th scope="col" aria-label="Actions"/></tr></thead>
        <tbody><tr><th scope="row"><Laptop size={22}/>Current browser</th><td>{Number.isFinite(session.startedAt)?`${clockDate(session.startedAt)}, ${clockTime(session.startedAt)} · ${zoneLabel}`:'—'}</td><td><span className="security-device">This device</span></td><td><button className="button outline" disabled={busy} onClick={()=>logout(false)}>Sign out</button></td></tr>
        <tr><th scope="row"><ShieldCheck size={22}/>All sessions</th><td>—</td><td>{session.sessionCount} active {session.sessionCount===1?'session':'sessions'}</td><td><button className="button outline" disabled={busy} onClick={()=>logout(true)}>Sign out all devices</button></td></tr></tbody>
      </table>
    </section>
  </section>;
}
