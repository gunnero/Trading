import {apiFetch} from './auth-client';
import {useEffect,useState} from 'react';
import {matchingInstrument} from './data/market.js';
import {quoteKey} from './data/quotes.mjs';
import {LEVEL_FRAMES} from './data/zone-roles.mjs';
import {evaluateRetest} from './data/retests.mjs';

// Shared by company details and the level library's independent setup dialog.
export function useStockSetup(entry,sheet,interval,enabled=true){
  const symbol=quoteKey(entry),instrument=enabled?matchingInstrument(entry,sheet):null,frame=interval==='source'?LEVEL_FRAMES[instrument?.timeframe]:interval;
  const sourceDate=instrument?.sourceDate||sheet.date;
  const key=JSON.stringify([symbol,instrument,sourceDate,frame]),[state,setState]=useState({key:null});
  useEffect(()=>{
    if(!instrument||!frame)return;
    const controller=new AbortController();let busy=false;
    async function load(){
      if(busy||document.hidden)return;busy=true;let data;
      try{
        const response=await apiFetch('/api/market/setup?'+new URLSearchParams({symbol,interval:frame,from:sourceDate}),{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(35000)])});
        if(!response.ok)throw Error();data=await response.json();
        if(data.symbol!==symbol||data.timeframe!==frame||data.from!==sourceDate)throw Error();
      }catch{data={status:'unavailable',timeframe:frame};}
      if(!controller.signal.aborted)setState({key,data});busy=false;
    }
    load();const timer=setInterval(load,60000);document.addEventListener('visibilitychange',load);
    return()=>{controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',load);};
  },[key]);
  return evaluateRetest(instrument,sourceDate,state.key===key?state.data:{status:'loading',timeframe:frame});
}
