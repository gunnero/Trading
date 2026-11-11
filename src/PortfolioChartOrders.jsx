import {useEffect,useRef,useState} from 'react';
import {apiFetch} from './auth-client';
import {useDisplayTime} from './DisplayTime';
import {chartOrderStatus} from './data/portfolio-chart-orders.mjs';

export function usePortfolioChartOrders(accountId,ticker,enabled){
  const key=accountId+'|'+ticker,[state,setState]=useState(null),[revision,setRevision]=useState(0),retry=useRef({key:null,until:0});
  useEffect(()=>{
    if(!enabled||!accountId||!ticker)return;
    if(retry.current.key!==key)retry.current={key,until:0};
    const controller=new AbortController();let busy=false,unauthorized=false,timer;
    const schedule=delay=>{clearTimeout(timer);timer=setTimeout(load,delay);};
    async function load(){
      if(busy||unauthorized||controller.signal.aborted)return;
      if(document.hidden){schedule(15000);return;}
      if(retry.current.until>Date.now()){schedule(retry.current.until-Date.now());return;}
      busy=true;setState(previous=>({...(previous?.key===key?previous:{}),key,loading:true}));
      try{
        const response=await apiFetch(`/api/portfolio/accounts/${encodeURIComponent(accountId)}/trading/chart-orders?`+new URLSearchParams({ticker}),{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(25000)])});
        const after=response.headers.get('retry-after'),wait=after?(Number.isFinite(Number(after))?Number(after)*1000:Date.parse(after)-Date.now()):0;
        const body=await response.json().catch(()=>{throw Object.assign(Error('Order refresh unavailable.'),{status:response.status,retryMs:Number.isFinite(wait)?wait:0});});
        if(!response.ok)throw Object.assign(Error(body.message||'Order refresh unavailable.'),{status:response.status,retryMs:Math.max(Number.isFinite(wait)?wait:0,Number.isFinite(body.retryAfterMs)?body.retryAfterMs:0)});
        if(body.ticker!==ticker||!Array.isArray(body.orders)||body.orders.length>1000)throw Error('The order response could not be matched to this holding.');
        if(!controller.signal.aborted)setState({key,data:body,loading:false,error:body.error||null});
      }catch(error){if(!controller.signal.aborted){
        unauthorized=!!error.auth||error.status===401;
        retry.current.until=Date.now()+Math.min(86400000,Math.max(15000,error.retryMs||0));
        setState(previous=>({key,data:unauthorized||[403,404].includes(error.status)?null:previous?.key===key?previous.data:null,loading:false,error:error.message||'Order refresh unavailable.'}));
      }}finally{busy=false;if(!controller.signal.aborted&&!unauthorized)schedule(Math.max(15000,retry.current.until-Date.now()));}
    }
    load();document.addEventListener('visibilitychange',load);
    return()=>{controller.abort();clearTimeout(timer);document.removeEventListener('visibilitychange',load);};
  },[key,enabled,revision]);
  const current=enabled&&state?.key===key?state:null,checkedAt=current?.data?.checkedAt;
  return {...current,loading:enabled&&(!current||current.loading),stale:!!current?.error||!Number.isFinite(checkedAt)||Date.now()-checkedAt>45000||checkedAt>Date.now()+5000,refresh:()=>setRevision(value=>value+1)};
}

const shares=value=>Number.isFinite(value)?new Intl.NumberFormat('en-US',{maximumFractionDigits:8}).format(value):'—';
const price=line=>new Intl.NumberFormat('en-US',{style:'currency',currency:line.currency,maximumFractionDigits:8}).format(line.value);
export function PortfolioChartOrders({state,lines,shown,onToggle,matched}){
  const {clockStamp,zoneLabel}=useDisplayTime();
  return <section className="pm-chart-orders" aria-label="Limit orders on chart">
    <div className="pm-chart-orders-heading"><label><input type="checkbox" checked={shown} onChange={event=>onToggle(event.target.checked)}/>Show limit orders</label><button className="text-button" disabled={state.loading} onClick={state.refresh}>{state.loading?'Checking orders…':'Refresh orders'}</button></div>
    {state.error&&<p role="status">Order refresh unavailable. {lines.length?'Showing last confirmed orders as references; their status may have changed.':'Orders will retry automatically.'}</p>}
    {!state.error&&state.loading&&!state.data&&<p role="status">Checking this account’s limit orders…</p>}
    {!matched&&<p>Order lines require a matching stock listing and price currency.</p>}
    {lines.length>0?<ul>{lines.map(line=><li key={line.id}><strong className={line.side==='BUY'?'green':'red'}>{line.side==='BUY'?'Buy':'Sell'} limit · {price(line)}</strong><span>{Number.isFinite(line.remainingQuantity)?`${shares(line.remainingQuantity)} shares remaining`:`${shares(line.quantity)} shares · fill quantity unavailable`}</span><small>#{line.id} · {chartOrderStatus(line)}</small></li>)}</ul>:state.data&&!state.error&&!state.loading&&matched?<p>No pending limit orders for this holding.</p>:null}
    {state.data?.checkedAt&&<small>{state.stale?'Last checked':'Checked'} {clockStamp(state.data.checkedAt)} {zoneLabel} · Trading 212 · updates every 15 seconds</small>}
    {state.data?.truncated&&<p>Showing the first 1,000 matching limit orders. See Trade / orders for the full account status.</p>}
    {lines.some(line=>line.unconfirmed)&&<p>Waiting for broker confirmation. An order missing from pending orders is not assumed filled or cancelled.</p>}
  </section>;
}
