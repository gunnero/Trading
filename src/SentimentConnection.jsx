import {useDisplayTime} from './DisplayTime';
import {useEffect,useState} from 'react';
import {apiFetch} from './auth-client';
import {SourceLink,invalidateFeed} from './Feeds';

import {sentimentScore} from './data/sentiment.mjs';

const ENDPOINT='/api/settings/sentiment';
export function SentimentConnection({onChange,embedded=false}){
  const {briefingTime,zoneLabel}=useDisplayTime();
  const [open,setOpen]=useState(embedded),[connection,setConnection]=useState(null),[key,setKey]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  useEffect(()=>{
    if(!open){setKey('');return;}
    const controller=new AbortController();
    apiFetch(ENDPOINT,{signal:controller.signal}).then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.message);if(!controller.signal.aborted)setConnection(data);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
    return()=>controller.abort();
  },[open]);
  async function update(event,disconnect=false){
    event.preventDefault();setBusy(true);setError('');setNotice('');
    try{
      const response=await apiFetch(ENDPOINT,{method:disconnect?'DELETE':'POST',headers:{'Content-Type':'application/json','X-Opening-Bell-Client':'web'},...(!disconnect?{body:JSON.stringify({apiKey:key.trim()})}:{}),signal:AbortSignal.timeout(20000)});
      const data=await response.json();if(!response.ok)throw Error(data.message||'Could not update the connection.');
      setConnection(data);
      setNotice(disconnect?'Disconnected. Automatic community snapshots remain available.':`Key verified. Provider returned ${sentimentScore(data.reading.score)} · ${data.reading.rating}, observed ${briefingTime(data.reading.observedAt)} ${zoneLabel}. The card checks this reading’s age.`);
      invalidateFeed('/api/sentiment');invalidateFeed('/api/sentiment/details');
      onChange();
    }catch(e){setError(e.message);}finally{setKey('');setBusy(false);}
  }
  const content=<div>
      <p>{connection?.configured?'Oanor key saved. Checks every 10 minutes.':'Connect Oanor’s Stock Market Fear & Greed API to check for newer CNN readings.'}</p>
      <SourceLink href="https://www.oanor.dev/api/stockfeargreed-api">Oanor API · activate Free plan</SourceLink>
      {!connection?.configured && <ol className="sentiment-setup-steps"><li>Activate this API’s Free plan in Oanor.</li><li>Create a live key with GET access and copy the full key, not the shortened Prefix.</li><li>Paste it below, then click Connect & check.</li></ol>}
      <p className="small-copy" id="sentiment-key-help">Enter your key only in this field, not in chat. It stays encrypted on this server and is excluded from workspace exports. No paid plan is needed for the scheduled checks.</p>
      {connection===null&&!error?<p role="status">Checking connection…</p>:<form onSubmit={update}>
        <label>{connection?.configured?'Replace API key':'API key'}<input type="password" name="sentiment-api-key" aria-describedby="sentiment-key-help" autoComplete="off" spellCheck={false} autoCapitalize="none" minLength={16} maxLength={512} required value={key} disabled={busy} onChange={e=>setKey(e.target.value)}/></label>
        <div className="sentiment-connection-actions"><button className="button" disabled={busy||!key.trim()} type="submit">{busy?'Checking…':'Connect & check'}</button>{connection?.configured&&<button className="text-button" disabled={busy} type="button" onClick={event=>update(event,true)}>Disconnect</button>}</div>
      </form>}
      {notice&&<p className="small-copy" role="status">{notice}</p>}
      {connection?.message&&<p className="small-copy amber">{connection.message}</p>}
      {error&&<p className="small-copy amber" role="alert">{error}</p>}
    </div>;
  return embedded?<section className="sentiment-connection embedded" aria-label="CNN API connection">{content}</section>:<details className="sentiment-connection" open={open} onToggle={event=>setOpen(event.currentTarget.open)}><summary>CNN API connection</summary>{open&&content}</details>;
}
