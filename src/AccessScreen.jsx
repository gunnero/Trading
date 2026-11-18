import {useRef,useState} from 'react';
import {ArrowLeft,ChartBar,Clock,Key,LockKey,Plugs,ShieldCheck,Stack,UserPlus,WarningCircle} from '@phosphor-icons/react';
import {authRequest} from './auth-client';
import {Password} from './Password';
import './access-screen.css';

const panels={
  credentials:{title:'Welcome back',hint:'Sign in to your Trading Desk workspace.',icon:LockKey,action:'Sign in'},
  verification:{title:'Verify your sign-in',hint:'Enter the 6-digit code from your authenticator app.',icon:ShieldCheck,action:'Verify'},
  recovery:{title:'Sign in with a recovery code',hint:'Use a saved recovery code with the password you just entered.',icon:Key,action:'Sign in'},
  activate:{title:'Activate your workspace',hint:'Choose a password for your private owner account.',icon:UserPlus,action:'Activate workspace'},
  expired:{title:'Session expired',hint:'Sign in again to continue. Your unsaved edits are kept in this tab.',icon:Clock},
  invitation:{title:'Owner activation required',hint:'Open your private owner activation link to set a password for this workspace.',icon:UserPlus},
  offline:{title:'Connection unavailable',icon:Plugs},
};

function VerificationCode({value,onChange,...props}){
  const [selection,setSelection]=useState({start:0,end:0});
  function readSelection(event){
    const {selectionStart:start,selectionEnd:end}=event.currentTarget;
    setSelection({start,end});
  }
  function placeCaret(event){
    const input=event.currentTarget;
    if(!event.detail||input.selectionStart!==input.selectionEnd)return;
    const cells=Array.from(input.parentElement.querySelectorAll('[data-digit]'));
    const index=cells.findIndex(cell=>event.clientX<cell.getBoundingClientRect().right);
    const offset=Math.min(index===-1?6:index,value.length);
    input.setSelectionRange(offset,offset);
    readSelection(event);
  }
  return <div className="access-code">
    <span className="access-code-slots">
      {Array.from({length:6},(_,index)=>{
        const active=selection.start===selection.end ? index===Math.min(selection.start,5) :
          index>=selection.start&&index<selection.end;
        return <span key={index} data-digit="" className={active?'active':undefined} aria-hidden="true">{value[index]}</span>;
      })}
      <input {...props} aria-label="Authenticator code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
        value={value} onSelect={readSelection} onClick={placeCaret}
        onChange={event=>onChange(event.target.value.replace(/[^0-9]/g,''))} required autoFocus/>
    </span>
  </div>;
}

export function AccessScreen({activation,onAuthenticated,locked=false,configured=true,onRetry,connectionError}){
  const [step,setStep]=useState(locked?'expired':'credentials');
  const [identifier,setIdentifier]=useState(''),[password,setPassword]=useState('');
  const [confirmation,setConfirmation]=useState(''),[code,setCode]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[invalidField,setInvalidField]=useState('');
  const form=useRef(null);
  const view=connectionError?'offline':activation?'activate':!configured?'invitation':step;
  const {title,hint,icon:Icon,action}=panels[view];
  const verifying=view==='verification'||view==='recovery';
  function changeStep(next){
    setCode('');setError('');setInvalidField('');setStep(next);
    if(next==='credentials')setPassword('');
  }
  function reportInvalid(event){
    event.preventDefault();
    const first=event.currentTarget.querySelector(':invalid');
    if(event.target!==first)return;
    const message=first.validity.valueMissing?{
      username:'Enter your email or username.',password:'Enter your password.',confirmation:'Confirm your password.',
      code:view==='verification'?'Enter your 6-digit authenticator code.':'Enter your saved recovery code.',
    }[first.name]:null;
    setInvalidField(first.name);setError(message||first.validationMessage);
    first.focus();
  }
  async function submit(event){
    event.preventDefault();
    if(busy)return;
    if(view==='activate'&&password!==confirmation){
      setInvalidField('confirmation');setError('The passwords do not match.');form.current.elements.confirmation.focus();return;
    }
    setBusy(true);setError('');setInvalidField('');
    try{
      let data={identifier,password};
      if(view==='activate')data={token:activation,password};
      else if(view==='credentials')data.step='credentials';
      else data.code=code.trim();
      const result=await authRequest(view==='activate'?'setup':'login',data);
      if(view==='credentials'&&result.next==='verification'&&result.authenticated===false){
        changeStep('verification');return;
      }
      if(result.authenticated!==true)throw Error('Sign-in did not complete. Try again.');
      setPassword('');setConfirmation('');setCode('');onAuthenticated(result);
    }catch(cause){
      setError(cause.name==='TimeoutError'?'The sign-in request timed out. Please try again.':cause.message);
      if(verifying){setCode('');form.current?.elements.code?.focus();}
    }finally{setBusy(false);}
  }
  function fieldProps(name){
    return {name,'aria-invalid':invalidField===name||undefined,'aria-describedby':invalidField===name?'access-error':undefined};
  }
  const message=error&&<p className="access-error" role="alert" id="access-error"><WarningCircle size={16}/>{error}</p>;
  return <section className="auth-screen access-screen" aria-labelledby="access-title">
    <div className="access-shell">
      <header className="access-masthead"><div className="access-brand"><ChartBar size={26} weight="fill"/>Trading Desk</div><h1>A secure way back to your desk</h1></header>
      <section className={`auth-card access-card access-${view}`} aria-labelledby="access-title" key={view}>
        <header className="access-heading"><span className="access-icon"><Icon size={26}/></span><div><h2 id="access-title">{title}</h2><p>{connectionError||hint}</p></div></header>
        {view==='offline'||view==='invitation'?<button className="button outline access-action" type="button" onClick={onRetry}>{view==='offline'?'Retry connection':'Check activation'}</button>:
          view==='expired'?<button className="button primary access-action" type="button" autoFocus onClick={()=>changeStep('credentials')}>Sign in</button>:
          <form ref={form} onSubmit={submit} onInvalid={reportInvalid} onChange={()=>{if(error){setError('');setInvalidField('');}}}>
            {view==='credentials'&&<>
              <label className="auth-field"><span>Email or username</span><input {...fieldProps('username')} autoComplete="username" autoCapitalize="none" spellCheck={false}
                value={identifier} onChange={e=>setIdentifier(e.target.value)} maxLength={254} placeholder="Enter your email or username" required autoFocus/></label>
              {invalidField==='username'&&message}
              <Password {...fieldProps('password')} value={password} onChange={e=>setPassword(e.target.value)} placeholder="Enter your password" maxLength={128} required/>
            </>}
            {view==='activate'&&<>
              <Password {...fieldProps('password')} label="Create password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="new-password"
                minLength={15} maxLength={128} placeholder="Create a password" required autoFocus/>
              <p className="access-hint">Use 15–128 characters.</p>
              <Password {...fieldProps('confirmation')} id="confirm-password" label="Confirm password" value={confirmation} onChange={e=>setConfirmation(e.target.value)}
                autoComplete="new-password" maxLength={128} placeholder="Confirm your password" required/>
            </>}
            {view==='verification'&&<VerificationCode {...fieldProps('code')} value={code} onChange={setCode}/>}
            {view==='recovery'&&<label className="auth-field"><span>Recovery code</span><input {...fieldProps('code')} autoComplete="one-time-code" autoCapitalize="none" spellCheck={false}
              value={code} onChange={e=>setCode(e.target.value)} maxLength={50} placeholder="Enter your recovery code" required autoFocus/></label>}
            {invalidField!=='username'&&message}
            <div className="access-form-actions">
              {view==='activate'&&<span className="access-private"><Stack size={17}/>Private owner activation</span>}
              <button className="button primary access-submit" type="submit" disabled={busy}>{busy?'Checking…':action}</button>
            </div>
            {verifying&&<><button type="button" className="access-link" disabled={busy} onClick={()=>changeStep(view==='verification'?'recovery':'verification')}>{view==='verification'?'Use recovery code':'Use authenticator code'}</button>
              <div className="access-back"><button type="button" className="access-link" disabled={busy} onClick={()=>changeStep('credentials')}><ArrowLeft size={16}/>Back to sign in</button></div></>}
            {view==='credentials'&&<details className="access-help"><summary>Need help signing in?</summary><p>You can use a saved recovery code at the verification step. For a forgotten password, use a private owner recovery link created on the server. Sign-in lasts up to 30 days on this browser.</p></details>}
          </form>}
      </section>
    </div>
  </section>;
}
