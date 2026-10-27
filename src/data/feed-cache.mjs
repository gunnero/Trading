import {apiFetch} from '../auth-client.js';
const TTL=10*60*1000;
// Shared across mounted cards/panels; one request per URL, even on StrictMode mounts.
export function createFeedCache(fetcher=(...args)=>apiFetch(...args),now=Date.now){
  const cache=new Map(),pending=new Map();
  const peek=url=>cache.get(url)?.value;
  async function read(url,force=false){
    if(pending.has(url))return pending.get(url);
    const saved=cache.get(url);
    if(!force&&saved&&now()-saved.at<TTL)return saved.value;
    const request=(async()=>{
      let value;
      try{
        const response=await fetcher(url,{signal:AbortSignal.timeout(35000)});
        if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw Error('The briefing service is unavailable.');
        value=await response.json();
        if(!['ok','stale','unavailable'].includes(value.status))throw Error('The source returned an unreadable response.');
      }catch(error){
        const previous=peek(url),age=now()-Date.parse(previous?.fetchedAt);
        const usable=previous?.data&&age>=0&&age<24*60*60*1000;
        value={...(usable?previous:{}),status:usable?'stale':'unavailable',message:error.message};
      }
      if(cache.size>=128&&!cache.has(url))cache.delete(cache.keys().next().value);
      cache.set(url,{at:now(),value});
      return value;
    })();
    pending.set(url,request);
    try{return await request;}finally{pending.delete(url);}
  }
  return {peek,read};
}
