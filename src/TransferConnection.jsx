import {ArrowClockwise,Bank,CaretRight,Database,DeviceMobile,LockKey,ShieldCheck} from '@phosphor-icons/react';
import {MAX_BANK_SOURCES,validDay} from './data/transfers.mjs';
import {useDisplayTime} from './DisplayTime';

function scanWindows(scan){
  if(!validDay(scan?.today)||!Array.isArray(scan.batches)||!Number.isInteger(scan.index))return null;
  let done=0,total=0;
  for(const [index,batch] of scan.batches.entries()){
    if(!validDay(batch.start))return null;
    const first=Date.parse(batch.start),days=(Date.parse(scan.today)-first)/86400000+1;
    const windows=Math.max(0,Math.ceil(days/30));
    total+=windows;
    if(index<scan.index)done+=windows;
    else if(index===scan.index&&validDay(scan.next))done+=Math.min(windows,Math.max(0,Math.ceil((Date.parse(scan.next)-first)/(30*86400000))));
  }
  return {done,total};
}

export function TransferConnection({data,busy,running,showSources,onSources,onSync,onAutomatic,children}){
  const {clockStamp,zoneLabel}=useDisplayTime(),{sync,scan}=data;
  const connected=sync.state==='connected';
  const stateLabel={connected:'Connected',disconnected:'Disconnected',syncing:'Reading transactions',connecting:'Connecting',unavailable:'Read unavailable','approval-required':'Approval required'}[sync.state]||'Status unavailable';
  const windows=scanWindows(scan);
  const canConfigure=data.sources.length>0&&data.sources.every(source=>data.candidates?.some(item=>item.kind===source.kind&&item.id===source.id));
  return <section className="panel transfer-connection" aria-label="NLB bank connection">
    <div className="bank-controls">
      <div className="bank-brand"><Bank aria-hidden="true"/><div><h3>NLB Klik</h3><span className={connected?'green':''}>{stateLabel}</span></div></div>
      <div className="bank-last"><small>Last completed sync</small><strong>{sync.lastSuccess?clockStamp(sync.lastSuccess)+' · '+zoneLabel:'No completed sync'}</strong></div>
      <button className="bank-sources" aria-label="Manage sources" aria-expanded={showSources} disabled={busy||running||!data.candidates?.length} onClick={onSources}><span><b>Source settings</b><small>Read-only accounts and cards</small></span><CaretRight/></button>
      <button className="button outline" disabled={busy||running||!data.sources.length||['disconnected','approval-required'].includes(sync.state)} onClick={onSync}><ArrowClockwise/>{running?'Working…':scan?'Resume sync':'Sync now'}</button>
      <label className="bank-hourly">Automatic hourly reads<input type="checkbox" role="switch" checked={data.automatic} disabled={busy||running||!canConfigure||showSources} onChange={e=>onAutomatic(e.target.checked)}/></label>
    </div>
    <div className="bank-facts">
      <span><Database/>Sources <b>{data.sources.length} / {MAX_BANK_SOURCES}</b></span>
      <span role="status" className="bank-progress">{windows?<><progress max={windows.total||1} value={windows.done}/>{windows.done} of {windows.total} windows read{!running&&' · Resume available'}</>:sync.message||stateLabel}</span>
      <span><LockKey/>Signed in</span><span><ShieldCheck/>Authenticator verified</span>
      <span><DeviceMobile/>{sync.state==='approval-required'||sync.state==='connecting'?'Phone approval pending':'Phone approval at login'}</span>
    </div>
    {scan&&<p className="transfer-note">{scan.savedAt?'Progress saved '+clockStamp(scan.savedAt)+' · '+zoneLabel+'. ':''}Totals update when the full scan completes.</p>}
    {children}
  </section>;
}
