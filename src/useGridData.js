import {useEffect,useState} from 'react';
import {marketFeed} from './market-feed';
export function useGridData(keys,interval,feed=marketFeed){
  const identity=JSON.stringify([keys,interval,feed.id]);
  const [state,setState]=useState({identity:null,data:{}});
  useEffect(()=>{
    let cancelled=false,busy=false;const controller=new AbortController();
    async function refresh(){
      if(busy||document.hidden)return;busy=true;let index=0;
      async function worker(){
        while(index<keys.length&&!cancelled&&!document.hidden){
          const key=keys[index++];let result;
          try{result=await feed.chart(key,interval,AbortSignal.any([controller.signal,AbortSignal.timeout(35000)]));}
          catch{result={status:'unavailable',message:'Source unavailable. Retrying automatically.'};}
          if(!cancelled)setState(previous=>{
            const data=previous.identity===identity?previous.data:{},prior=data[key];
            const next=result.status==='unavailable'&&prior?.candles?.length?{...prior,status:'stale',message:'Refresh unavailable. Cached history shown.'}:result;
            return {identity,data:{...data,[key]:next}};
          });
        }
      }
      try{await Promise.all([worker(),worker(),worker()]);}finally{busy=false;}
    }
    refresh();const timer=setInterval(refresh,feed.refreshMs);document.addEventListener('visibilitychange',refresh);
    return()=>{cancelled=true;controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};
  },[identity,feed]);
  return state.identity===identity?state.data:{};
}
