import {useState} from 'react';
import {Eye,EyeSlash} from '@phosphor-icons/react';

export function Password({label='Password',value,onChange,autoComplete='current-password',id='login-password',...rest}){
  const [show,setShow]=useState(false);
  return <label className="auth-field" htmlFor={id}><span>{label}</span><span className="auth-password"><input id={id} type={show?'text':'password'} autoComplete={autoComplete} value={value} onChange={onChange} {...rest}/><button type="button" className="icon-button" aria-label={show?`Hide ${label.toLowerCase()}`:`Show ${label.toLowerCase()}`} aria-pressed={show} onClick={()=>setShow(v=>!v)}>{show?<EyeSlash size={19}/>:<Eye size={19}/>}</button></span></label>;
}
