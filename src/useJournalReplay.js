import {useEffect,useMemo,useState} from 'react';
import {apiFetch} from './auth-client';
import {parseWatchlist} from './data/market';
import {tradeListings,executionMarkers} from './data/journal-chart.mjs';
import {replayDates,tradeLevelContext,reviewTrade} from './data/journal-review.mjs';

function useDatedHistory(symbol,frame,dates,retry,enabled=true){
  const [response,setResponse]=useState(null),key=JSON.stringify([symbol,frame,dates?.from,dates?.to]);
  useEffect(()=>{
    if(!symbol||!dates||!enabled)return;
    const controller=new AbortController();let cancelled=false;
    setResponse({key,status:'loading'});
    apiFetch(`/api/market/trade-history?${new URLSearchParams({symbol,interval:frame,from:dates.from,to:dates.to})}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(35000)])})
      .then(async r=>{const data=await r.json();if(!r.ok)throw Error(data.message||'History unavailable.');if(!cancelled)setResponse({...data,key});})
      .catch(e=>{if(!cancelled)setResponse({key,status:'unavailable',message:e.name==='TimeoutError'?'The history request timed out. Try again.':e.message});});
    return()=>{cancelled=true;controller.abort();};
  },[key,retry,enabled]);
  return response?.key===key?response:{key,status:'loading'};
}
export function useJournalReplay(trade,workspace,chartVisible){
  const listings=useMemo(()=>trade?tradeListings(trade.symbol,parseWatchlist(workspace.watchText,{allowEmpty:true})):[],[trade?.symbol,workspace.watchText]);
  const [choice,setChoice]=useState(''),[frame,setFrame]=useState('2m'),[retry,setRetry]=useState(0);
  const symbol=listings.length===1?listings[0].id:listings.find(row=>row.id===choice)?.id;
  const dates=useMemo(()=>trade?replayDates(trade):null,[trade?.entryAt,trade?.exitAt]);
  const reviewHistory=useDatedHistory(symbol,'2m',dates,retry);
  const alternative=useDatedHistory(symbol,frame,dates,retry,chartVisible&&frame!=='2m');
  const history=frame==='2m'?reviewHistory:alternative;
  const levels=useMemo(()=>trade?tradeLevelContext(trade,workspace):null,[trade?.entryAt,trade?.symbol,workspace.levelText,workspace.levelSourceDates,workspace.levelHistory]);
  const review=useMemo(()=>trade?reviewTrade(trade,symbol?reviewHistory:{status:'unavailable'},levels):null,[trade,reviewHistory,levels,symbol]);
  const candles=useMemo(()=>(history.candles||[]).flatMap((c,i)=>c.sessionDate>=dates?.day&&c.sessionDate<=dates?.to?[{...c,indicators:Object.fromEntries(Object.entries(history.indicators?.series||{}).map(([name,values])=>[name,values[i]??null]))}]:[]),[history,dates]);
  const markers=useMemo(()=>trade?executionMarkers(trade,candles,history.observedThrough??0):[],[trade,candles,history.observedThrough]);
  return {listings,choice,setChoice,symbol,dates,frame,setFrame,refresh:()=>setRetry(n=>n+1),history,reviewHistory,review,levels,candles,markers};
}
