import {apiFetch} from './auth-client';
import {useEffect,useMemo,useState} from 'react';
import {chartableEntry,stockEntry} from './data/instruments.mjs';
import {matchingInstrument} from './data/market.js';
import {LEVEL_FRAMES} from './data/zone-roles.mjs';
import {quoteKey} from './data/quotes.mjs';
import {evaluateRetest,topRetest} from './data/retests.mjs';

// Include the primary/custom instruments in the same scan; only stocks/ADRs can win Top/Hot.
export function useRetestScan(watchlist,sheet,interval,customKey,active=true){
  const entries=useMemo(()=>{
    const primary=[{id:'NASDAQ:QQQ',symbol:'QQQ',exchange:'NASDAQ',group:'FUND'},{id:'AMEX:SPY',symbol:'SPY',exchange:'AMEX',group:'FUND'}];
    const list=[...primary,...watchlist.filter(e=>stockEntry(e)||e.id===customKey&&chartableEntry(e))];
    return [...new Map(list.map(e=>[quoteKey(e),e])).values()];
  },[watchlist,customKey]);
  const key=JSON.stringify([entries.map(e=>[e.id,e.group]),sheet,interval]),[state,setState]=useState({key:null,status:'loading',results:[]});
  useEffect(()=>{
    if(!active){setState({key:null,status:'paused',results:[]});return;}
    let cancelled=false,busy=false;const controller=new AbortController();
    async function refresh(){
      if(busy||document.hidden)return;busy=true;
      const results=[],eligible=entries.filter(e=>matchingInstrument(e,sheet));
      if(!cancelled)setState(s=>s.key===key?{...s,refreshing:true}:{key,status:'loading',results:[],progress:0,total:eligible.length});
      let index=0;
      async function worker(){
        while(index<entries.length&&!cancelled&&!document.hidden){
          const entry=entries[index++],instrument=matchingInstrument(entry,sheet),symbol=quoteKey(entry),frame=interval==='source'?LEVEL_FRAMES[instrument?.timeframe]:interval;
          const sourceDate=instrument?.sourceDate||sheet.date;
          let data;
          if(instrument&&frame){
            try{
              const response=await apiFetch('/api/market/setup?'+new URLSearchParams({symbol,interval:frame,from:sourceDate}),{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(35000)])});
              if(!response.ok)throw Error();data=await response.json();
              if(data.symbol!==symbol||data.timeframe!==frame||data.from!==sourceDate)throw Error();
            }catch{data={status:'unavailable',timeframe:frame};}
          }
          results.push({...evaluateRetest(instrument,sourceDate,data),entry,key:symbol});
          if(!cancelled&&results.length%3===0)setState(s=>s.key===key?{...s,progress:results.filter(r=>r.stage!=='no-levels').length}:s);
        }
      }
      await Promise.all([worker(),worker(),worker()]);
      if(!cancelled&&!document.hidden&&results.length===entries.length)setState({key,status:'ready',results,updatedAt:new Date().toISOString(),total:eligible.length,progress:eligible.length,refreshing:false});
      busy=false;
    }
    const onVisibility=()=>{if(document.hidden)setState({key:null,status:'loading',results:[]});else refresh();};
    refresh();const timer=setInterval(refresh,60000);document.addEventListener('visibilitychange',onVisibility);
    return()=>{cancelled=true;controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',onVisibility);};
  },[key,active]);
  const current=state.key===key?state:{status:'loading',results:[]},stocks=current.results.filter(r=>stockEntry(r.entry));
  return {...current,top:topRetest(stocks),stocks,byKey:Object.fromEntries(current.results.map(r=>[r.key,r])),eligible:stocks.filter(r=>r.stage!=='no-levels').length};
}
