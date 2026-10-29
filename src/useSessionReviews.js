import {useEffect,useMemo,useState} from 'react';
import {apiFetch} from './auth-client';
import {readWatchlist} from './data/watchlist.mjs';
import {tradeListings} from './data/journal-chart.mjs';
import {replayDates,tradeLevelContext,reviewTrade} from './data/journal-review.mjs';

// One request per exact listing and entry date, with at most two in flight.
// Reuse the trade dialog's checks; outcomes and personal notes never grade entries.
export function useSessionReviews(trades,workspace){
  const signature=JSON.stringify(trades.map(t=>[t.id,t.symbol,t.entryAt,t.optionType,t.position]));
  const levelsSignature=JSON.stringify([workspace.levelText,workspace.levelSourceDates,workspace.levelHistory]);
  const jobs=useMemo(()=>{
    const watchlist=readWatchlist(workspace.watchText);
    return trades.map(trade=>{
      const listings=tradeListings(trade.symbol,watchlist),symbol=listings.length===1?listings[0].id:null;
      const levels=tradeLevelContext(trade,workspace),initial=reviewTrade(trade,{status:'unavailable'},levels);
      const dates=replayDates({...trade,exitAt:null});
      const message=!listings.length?'No verified underlying listing is available.':listings.length>1?'Multiple listings match this symbol; choose the listing in its trade review.':null;
      return {trade,symbol,levels,dates,message,initial,key:symbol?JSON.stringify([symbol,dates.from,dates.to]):null};
    });
  },[signature,workspace.watchText,levelsSignature]);
  const [retry,setRetry]=useState(0),[response,setResponse]=useState(null);
  useEffect(()=>{
    const controller=new AbortController();let cancelled=false;
    const rows={},groups=new Map();
    for(const job of jobs){
      if(!job.symbol||job.initial.status==='outside-session')rows[job.trade.id]={status:'done',review:job.initial,message:job.message};
      else{rows[job.trade.id]={status:'loading'};groups.set(job.key,[...(groups.get(job.key)||[]),job]);}
    }
    setResponse({jobs,rows});
    const pending=[...groups.values()];let index=0;
    async function worker(){
      while(!cancelled&&index<pending.length){
        const batch=pending[index++],job=batch[0];let history;
        try{
          const r=await apiFetch(`/api/market/trade-history?${new URLSearchParams({symbol:job.symbol,interval:'2m',from:job.dates.from,to:job.dates.to})}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(35000)])});
          history=await r.json();if(!r.ok)throw Error(history.message||'Dated history is unavailable.');
          if(history.symbol!==job.symbol)throw Error('The source did not return the requested listing.');
        }catch(error){history={status:'unavailable',message:error.name==='TimeoutError'?'History request timed out. Recheck when the source is available.':error.message};}
        if(cancelled)return;
        const next=Object.fromEntries(batch.map(item=>[item.trade.id,{status:'done',review:reviewTrade(item.trade,history,item.levels),cached:history.status==='stale',message:history.message||null}]));
        setResponse(current=>current?.jobs===jobs?{jobs,rows:{...current.rows,...next}}:current);
      }
    }
    Promise.all([worker(),worker()]);
    return()=>{cancelled=true;controller.abort();};
  },[jobs,retry]);
  return {results:response?.jobs===jobs?response.rows:{},refresh:()=>setRetry(n=>n+1)};
}
