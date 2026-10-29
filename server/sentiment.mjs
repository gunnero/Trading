export const HOURLY_SENTIMENT_SOURCE={name:'CNN Fear & Greed',url:'https://edition.cnn.com/markets/fear-and-greed',delivery:'hourly',via:{name:'Hourly community mirror',url:'https://github.com/chirag127/fear-greed-index-api'}};
export const HOURLY_SENTIMENT_URL='https://raw.githubusercontent.com/chirag127/fear-greed-index-api/main/data/latest.json';
const KEY='sentiment:cnn-hourly-mirror-v1',DAY=86400000;

export function parseHourlySentiment(raw,parseSnapshot,now=Date.now()){
  // Never use the combined headline/asOf or the crypto/India series. Only this
  // CNN-specific snapshot preserves its original rating and observation time.
  const cnn=raw?.cnn,mirroredAt=Date.parse(raw?.updated),observedAt=Date.parse(cnn?.timestamp);
  if(raw?.sources?.cnn?.ok!==true||!cnn||typeof cnn.timestamp!=='string'||!/[T ].*(?:Z|[+-]\d\d:\d\d)$/.test(cnn.timestamp)||!Number.isFinite(mirroredAt)||!Number.isFinite(observedAt)||mirroredAt>now+300000||observedAt>mirroredAt+300000)throw Error('The hourly mirror has no valid CNN snapshot.');
  return {...parseSnapshot({fear_and_greed:{score:cnn.value,rating:cnn.rating,timestamp:cnn.timestamp,previous_close:cnn.previousClose,previous_1_week:cnn.previous1Week,previous_1_month:cnn.previous1Month,previous_1_year:cnn.previous1Year}}),mirroredAt:new Date(mirroredAt).toISOString()};
}

export function ageChecked(result,now){
  if(!result.data)return result;
  const age=now-Date.parse(result.data.observedAt),fetchedAge=now-Date.parse(result.fetchedAt);
  if(!Number.isFinite(age)||age < -300000||age>7*DAY||!Number.isFinite(fetchedAge)||fetchedAge>=DAY)return {...result,status:'unavailable',data:null,message:'No recent, valid CNN snapshot is available.'};
  if(age>4*DAY)return {...result,status:'stale',message:'This reading is over four days old. Waiting for an updated source snapshot.'};
  return result;
}

export function createSentimentService({fetcher,now,timeoutMs,cache,onCache,parseSnapshot,archive,api=async()=>null}){
  let pending;
  async function hourly(){
    const old=cache.get(KEY),checkedAt=new Date(now()).toISOString();
    if(old?.retryAt>now())return ageChecked({...old.result,source:HOURLY_SENTIMENT_SOURCE},now());
    let result,ttl=10*60000,retryMs=0;
    try{
      const response=await fetcher(HOURLY_SENTIMENT_URL,{headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
      if(!response.ok){
        const value=response.headers.get('retry-after');
        retryMs=value?(/^\d+$/.test(value)?Number(value)*1000:Date.parse(value)-now()):0;
        throw Error(`The hourly CNN mirror is unavailable (HTTP ${response.status}).`);
      }
      const reader=response.body.getReader(),chunks=[];let length=0;
      while(true){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>2_000_000){await reader.cancel();throw Error('The hourly CNN snapshot is too large.');}chunks.push(value);}
      const data=parseHourlySentiment(JSON.parse(Buffer.concat(chunks).toString('utf8')),parseSnapshot,now());
      const candidate=ageChecked({status:'ok',source:HOURLY_SENTIMENT_SOURCE,fetchedAt:checkedAt,checkedAt,data},now());
      if(!candidate.data)throw Error(candidate.message);
      if(old&&ageChecked(old.result,now()).data&&Date.parse(data.observedAt)<Date.parse(old.result.data.observedAt))throw Error('The mirror returned an older snapshot; keeping the newer cached reading.');
      result=candidate;
    }catch(error){
      const previous=old&&ageChecked(old.result,now());
      result={status:previous?.data?'stale':'unavailable',source:HOURLY_SENTIMENT_SOURCE,fetchedAt:previous?.data?previous.fetchedAt:null,checkedAt,data:previous?.data||null,message:error.message};
      ttl=Math.max(5*60000,Number.isFinite(retryMs)?retryMs:0);
    }
    if(cache.size>=128&&!cache.has(KEY))cache.delete(cache.keys().next().value);
    cache.set(KEY,{result,retryAt:now()+ttl});onCache(cache);return result;
  }
  async function get(){
    if(pending)return pending;
    pending=(async()=>{
      const results=(await Promise.all([api(),hourly(),archive()])).filter(Boolean);
      // Compare the CNN observation times, never fetch/run timestamps. Keep
      // complete snapshots together; comparisons and score share one source.
      const usable=results.map(r=>ageChecked(r,now())).filter(r=>r.data).sort((a,b)=>Date.parse(b.data.observedAt)-Date.parse(a.data.observedAt)||(a.status==='ok'?0:1)-(b.status==='ok'?0:1));
      return usable[0]||{status:'unavailable',source:HOURLY_SENTIMENT_SOURCE,fetchedAt:null,checkedAt:new Date(now()).toISOString(),data:null,message:'No recent CNN snapshot is available from either automatic source. Retrying automatically.'};
    })();
    try{return await pending;}finally{pending=null;}
  }
  return {get};
}
