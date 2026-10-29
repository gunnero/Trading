import {apiFetch} from './auth-client';
import {useEffect, useMemo, useState} from 'react';
import {PRIMARY_QUOTES, quoteKey} from './data/quotes.mjs';
import {overviewWatchlist} from './data/watchlist.mjs';
const empty={status:'loading',quote:null};
export function useMarketQuotes(watchlist,full=false,extra=[],active=true,includePrimary=true){
  const extraKey=extra.filter(Boolean).join(',');
  const keys=useMemo(()=>[...new Set([...(includePrimary?PRIMARY_QUOTES:[]),...extraKey.split(',').filter(Boolean),...(full?watchlist:overviewWatchlist(watchlist)).map(quoteKey)])],[watchlist,full,extraKey,includePrimary]);
  const keyString=keys.join(',');
  const [state,setState]=useState({});
  useEffect(()=>{
    if(!active)return;
    let cancelled=false,busy=false;const controller=new AbortController();
    async function refresh(){
      if(busy||document.hidden)return;busy=true;
      // Keep the primary instruments first. Each response updates the page independently.
      for(let offset=0;offset<keys.length&&!cancelled&&!document.hidden;offset+=8){
        const batch=keys.slice(offset,offset+8);
        try{
          const response=await apiFetch(`/api/market/quotes?${new URLSearchParams({symbols:batch.join(',')})}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(35000)])});
          if(!response.ok)throw new Error();const body=await response.json();if(!body.quotes)throw new Error();
          if(!cancelled)setState(s=>({...s,...Object.fromEntries(batch.map(k=>[k,body.quotes[k]||{status:'unavailable',quote:null}]))}));
        }catch{if(!cancelled)setState(s=>({...s,...Object.fromEntries(batch.map(k=>[k,s[k]?.quote?{...s[k],status:'stale',message:'Refresh unavailable. Showing the previous reading.'}:{status:'unavailable',quote:null,message:'Market data unavailable. Retrying automatically.'}]))}));}
      }
      busy=false;
    }
    refresh();const interval=setInterval(refresh,60000);document.addEventListener('visibilitychange',refresh);
    return()=>{cancelled=true;controller.abort();clearInterval(interval);document.removeEventListener('visibilitychange',refresh);};
  },[keyString,active]);
  return Object.fromEntries(keys.map(k=>[k,state[k]||empty]));
}
export function useMarketChart(symbol,timeframe,active=true){
  const key=`${symbol}:${timeframe}`;const [state,setState]=useState({key:null,status:'loading'});
  useEffect(()=>{
    if(!active){setState({key:null,status:'loading'});return;}
    if(!symbol)return;
    let cancelled=false,busy=false;const controller=new AbortController();
    async function refresh(){
      if(busy||document.hidden)return;busy=true;
      try{
        const response=await apiFetch(`/api/market/chart?${new URLSearchParams({symbol,interval:timeframe})}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(35000)])});
        if(!response.ok)throw new Error();const body=await response.json();
        if(!cancelled)setState({...body,key});
      }catch{if(!cancelled)setState(s=>s.key===key&&(s.candles||s.points)?{...s,status:'stale',message:'History refresh unavailable. Showing cached history.'}:{key,status:'unavailable',message:'Chart history unavailable. Retrying automatically.'});}finally{busy=false;}
    }
    refresh();const interval=setInterval(refresh,60000);document.addEventListener('visibilitychange',refresh);
    return()=>{cancelled=true;controller.abort();clearInterval(interval);document.removeEventListener('visibilitychange',refresh);};
  },[key,active]);
  return !symbol?{status:'unavailable',message:'Choose an instrument to open its chart.'}:state.key===key?state:{status:'loading'};
}
