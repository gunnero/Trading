import {useEffect,useState} from 'react';
import {apiFetch} from './auth-client';
import {useDisplayTime} from './DisplayTime';
import './ibkr-journal.css';

export async function ibkrRequest(path,body,method=body===undefined?'GET':'POST'){
  const response=await apiFetch(path,{method,headers:{'Content-Type':'application/json','X-Opening-Bell-Client':'web'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});
  const data=await response.json();if(!response.ok)throw Error(data.message||'IBKR journal unavailable.');return data;
}
const endpoint='/api/settings/ibkr-journal';
export function IbkrConnection(){
  const {journalStamp,zoneLabel}=useDisplayTime();
  const [state,setState]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[token,setToken]=useState(''),[confirmed,setConfirmed]=useState(false);
  const [form,setForm]=useState({activityQueryId:'',confirmationQueryId:'',accountId:'',timeZone:'America/New_York'});
  useEffect(()=>{let alive=true;const read=()=>ibkrRequest(endpoint).then(data=>{if(alive)setState(data);}).catch(e=>{if(alive)setError(e.message);});read();const timer=setInterval(read,3000);return()=>{alive=false;clearInterval(timer);};},[]);
  useEffect(()=>{if(state?.config)setForm(state.config);},[JSON.stringify(state?.config)]);
  const edit=(key,value)=>{setForm(f=>({...f,[key]:value}));setConfirmed(false);};
  async function action(kind){
    setBusy(true);setError('');
    try{setState(await ibkrRequest(kind==='sync'?'/api/journal/ibkr/sync':endpoint,kind==='disconnect'?undefined:kind==='sync'?{}:{...form,token},kind==='disconnect'?'DELETE':'POST'));}
    catch(e){setError(e.message);}finally{setToken('');setBusy(false);}
  }
  const waiting=busy||state?.syncing,next=state?.nextAt&&Date.parse(state.nextAt)>Date.now();
  return <section className="ibkr-connection connection-settings-card" aria-labelledby="ibkr-connection-title">
    <header><h3 id="ibkr-connection-title">IBKR journal connection</h3><span role="status">{state?.syncing?'Syncing reports…':state?.configured?'Connected':state?'Not connected':'Checking connection…'}</span></header>
    <p>Automatically import USD option executions into the separate IBKR journal every 15 minutes, including while the desk is closed. Reports can lag executions; this is not a live trading feed.</p>
    <details><summary>Set up IBKR Flex reports</summary>
      <ol><li>In IBKR Client Portal, open Performance & Reports → Flex Queries and enable Flex Web Service. Create a token with an expiry suitable for ongoing sync.</li>
        <li>Create an <strong>Activity Flex Query</strong> in XML format. Choose Trades → Executions only, and a rolling period covering your entries and exits (for example, Last 365 Calendar Days). Filter to USD options.</li>
        <li>Include Account ID, Asset Class, Currency, Conid, Underlying Symbol, Expiry, Strike, Put/Call, Multiplier, Quantity, Trade Price, Date/Time (or Trade Date and Trade Time), Buy/Sell, Open/Close Indicator, IB Order ID, IB Execution ID, IB Commission, IB Commission Currency, Taxes, Transaction Type, Notes/Codes and Original Trade ID.</li>
        <li>Use yyyyMMdd dates and HHmmss times with a semicolon separator. Select the report’s actual timezone below; it is independent of your desk display timezone.</li>
        <li>Optionally create a separate <strong>Trade Confirmation Flex Query</strong>, XML, Execution detail, with equivalent fields (Price, Commission, Commission Currency, Tax, Code, Order ID and Exec ID), canceled trades and audit fields included, and a rolling recent period for newer fills. The Activity query reconciles the final fees.</li></ol>
      <p>Matching uses FIFO within each account and option contract. Missing opening history excludes the affected contract from totals until backfilled. Corrections and exercise/assignment events need review. Missing USD fee information stays unknown. This does not add stock prices at fill time.</p>
      <a href="https://www.ibkrguides.com/clientportal/performanceandstatements/flex-web-service.htm" target="_blank" rel="noreferrer">IBKR Flex Web Service instructions ↗</a>
    </details>
    {state?.lastSuccess&&<p>Last successful sync: {journalStamp(state.lastSuccess)} {zoneLabel} · {state.executionCount} executions · {state.tradeCount} matched/open records.</p>}
    {state?.nextAt&&<p className="small-copy">Next automatic attempt: {journalStamp(state.nextAt)} {zoneLabel}.</p>}
    {state?.message&&<p role="status" className="amber">{state.message}</p>}
    <form onSubmit={e=>{e.preventDefault();action('connect');}}>
      <div className="ibkr-fields">
        <label>Flex Web Service token<input type="password" autoComplete="off" spellCheck={false} value={token} onChange={e=>setToken(e.target.value.trim())} required pattern="[0-9]{10,128}" maxLength={128} disabled={waiting}/></label>
        <label>Activity Query ID<input value={form.activityQueryId} onChange={e=>edit('activityQueryId',e.target.value.trim())} required pattern="[0-9]{1,20}" maxLength={20} disabled={waiting}/></label>
        <label>Trade Confirmation Query ID (optional)<input value={form.confirmationQueryId} onChange={e=>edit('confirmationQueryId',e.target.value.trim())} pattern="[0-9]{1,20}" maxLength={20} disabled={waiting}/></label>
        <label>IBKR account ID<input value={form.accountId} onChange={e=>edit('accountId',e.target.value.trim())} required maxLength={32} disabled={waiting||state?.executionCount>0}/></label>
        <label>IBKR report timezone<select value={form.timeZone} onChange={e=>edit('timeZone',e.target.value)} disabled={waiting||state?.executionCount>0}>{['America/New_York','Europe/Skopje','Europe/London','UTC'].map(zone=><option key={zone}>{zone}</option>)}</select></label>
      </div>
      <label className="ibkr-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} required disabled={waiting}/>I checked that this is the timezone used in my IBKR reports.</label>
      <p className="small-copy">The token stays encrypted on the server, outside journal and workspace exports. Enter it here, not in chat. Disconnecting keeps imported trades and notes. One IBKR account is supported by this connection.</p>
      <div className="connection-actions"><button className="button primary" type="submit" disabled={waiting||next||!confirmed||!token}>{state?.configured?'Replace connection & sync':'Connect & sync'}</button>
        {state?.configured&&<><button className="button outline" type="button" disabled={waiting||next} onClick={()=>action('sync')}>Sync now</button><button className="text-button" type="button" disabled={waiting} onClick={()=>{if(confirm('Disconnect IBKR automatic sync? Imported trades and notes will remain.'))action('disconnect');}}>Disconnect</button></>}
      </div>
    </form>
    {error&&<p role="alert" className="amber">{error}</p>}
  </section>;
}
