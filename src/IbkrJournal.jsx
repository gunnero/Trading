import {useEffect,useRef,useState} from 'react';
import {journalBroker} from './data/journal-brokers.mjs';
import {PageHeader} from './PageHeader';
import {JournalTrades} from './TradeJournal';
import {ibkrRequest,IbkrConnection} from './IbkrConnection';
import {useDisplayTime} from './DisplayTime';

export default function IbkrJournal({workspace,nav,tradeId,onClearTrade}){
  const [data,setData]=useState(null),[error,setError]=useState(''),[saving,setSaving]=useState(false),[connection,setConnection]=useState(false);
  const {journalStamp,zoneLabel}=useDisplayTime(),busy=useRef(false);
  useEffect(()=>{let alive=true;const poll=()=>{if(busy.current)return;ibkrRequest('/api/journal/ibkr').then(value=>{if(alive&&!busy.current)setData(old=>old?.revision>value.revision?old:value);}).catch(e=>{if(alive)setError(e.message);});};poll();const timer=setInterval(poll,5000);return()=>{alive=false;clearInterval(timer);};},[]);
  const legacy=(workspace.data.journal?.trades||[]).filter(t=>journalBroker(t)==='ibkr');
  const combined=data?{version:1,trades:[...data.journal.trades,...legacy]}:null;
  async function update(change){
    busy.current=true;setSaving(true);setError('');
    try{
      const current={...workspace.data,journal:combined},next=change(current);
      const modified=next.journal.trades.filter(t=>JSON.stringify(t)!==JSON.stringify(combined.trades.find(old=>old.id===t.id)));
      if(modified.length!==1||next.journal.trades.length!==combined.trades.length)throw Error('IBKR executions are managed by sync. Only notes, tags and strategy review can be edited.');
      const t=modified[0];if(legacy.some(old=>old.id===t.id)){workspace.update(current=>({...current,journal:{...current.journal,trades:current.journal.trades.map(old=>old.id===t.id?t:old)}}));return;}setData(await ibkrRequest('/api/journal/ibkr/notes',{id:t.id,revision:data.revision,notes:t.notes,tags:t.tags,review:t.review,risk:t.risk}));
    }catch(e){setError(e.message);throw e;}finally{busy.current=false;setSaving(false);}
  }
  const info=<>
    <div className="ibkr-status"><strong>IBKR · USD options</strong> · {data?.syncing?'Syncing…':data?.configured?'Automatic sync every 15 minutes':'Not connected'}
      {data?.lastSuccess&&<> · Last sync {journalStamp(data.lastSuccess)} {zoneLabel}</>}
      <p>FIFO by reported time within each account and contract; same-second ties use execution ID. Open records mean no closing fill has been matched; they do not verify current broker positions. Stock/futures trades and option exercise, assignment or expiration processing are not supported.</p>
      {data?.message&&<p role="status" className="amber">{data.message}</p>}
      {data?.skipped>0&&<p>{data.skipped} non-option report rows excluded from this options journal.</p>}
      {data?.coverage?.length>0&&<p>Latest Activity report: {data.coverage.map(c=>`${c.from} – ${c.to}`).join(', ')}. Previously saved executions are retained.</p>}
      {!!data?.unmatched?.length&&<details><summary>{data.unmatched.length} unmatched closing fills — extend your report history</summary>{data.unmatched.map(f=><p key={f.executionId}>{f.symbol} · {f.quantity} contracts · {journalStamp(f.at)} {zoneLabel} · execution {f.executionId}</p>)}</details>}
      <button type="button" className="text-button" aria-expanded={connection} onClick={()=>setConnection(!connection)}>IBKR connection settings</button>
    </div>
    {connection&&<IbkrConnection/>}{error&&<p className="amber" role="alert">{error}</p>}
  </>;
  if(!data)return <div className="journal-page jt-page"><PageHeader title="IBKR journal" description="Your IBKR option trades and review notes."/>{nav}{info}<p role="status">Loading IBKR journal…</p></div>;
  const adapter={data:{...workspace.data,journal:combined},status:saving?'saving':'saved',update};
  return <JournalTrades workspace={adapter} nav={nav} tradeId={tradeId} onClearTrade={onClearTrade} managed onConnect={()=>setConnection(true)} title="IBKR journal" extra={info}/>;
}
