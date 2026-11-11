const fail=(status,message,extra={})=>Object.assign(Error(message),{status,...extra});
const paths=[['/equity/account/summary',5000],['/equity/positions',1000]];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// Summary and positions have separate broker limits, shared by every reader
// of an account. Invalidating values must never discard those rate deadlines.
export function createBalanceReader({now=Date.now,request,wait=sleep}){
  const accounts=new Map();
  const state=id=>{if(!accounts.has(id))accounts.set(id,{epoch:0,deadlines:new Map(),cache:null,pending:null});return accounts.get(id);};
  function invalidate(id){const s=state(id);s.epoch++;s.cache=null;}
  async function read(id,generation,secret){
    const s=state(id),cached=s.cache;
    if(cached?.generation===generation&&cached.epoch===s.epoch&&now()-cached.at<5000)return cached;
    if(s.pending){
      if(s.pending.generation===generation&&s.pending.epoch===s.epoch)return s.pending.promise;
      // A pre-order read may finish, but cannot satisfy a post-order refresh.
      try{await s.pending.promise;}catch{}
      return read(id,generation,secret);
    }
    const epoch=s.epoch,job={epoch,generation};
    job.promise=(async()=>{
      const values=[];let at;
      const backoff=Math.max(0,...s.deadlines.values())-now();
      if(backoff>5000)throw fail(429,'Account refresh is waiting for the broker retry window. The order status is unchanged; balances will retry automatically.',{retryMs:backoff,upstreamStatus:s.retryStatus??null});
      for(const [path,period] of paths){
        const remaining=Math.max(0,(s.deadlines.get(path)||0)-now());
        if(remaining>5000)throw fail(429,'Trading 212 is pausing account refreshes. The order status is unchanged; balances will retry automatically.',{retryMs:remaining,upstreamStatus:429});
        if(remaining)await wait(remaining);
        if(epoch!==s.epoch)throw fail(409,'Balances changed during this refresh. Checking the latest account values.');
        if(at===undefined)at=now();
        s.deadlines.set(path,now()+period);
        try{values.push(await request(path,secret,{onReadResponse:response=>{
          const remaining=response.headers.get('x-ratelimit-remaining'),reset=response.headers.get('x-ratelimit-reset');
          if(remaining!==null&&Number.isFinite(Number(remaining))&&Number(remaining)<=0&&reset!==null&&Number.isFinite(Number(reset)))s.deadlines.set(path,Math.max(s.deadlines.get(path),Math.min(now()+86400000,Math.ceil(Number(reset)*1000))));
        }}));}
        catch(error){
          if(Number.isFinite(error.retryMs)){s.deadlines.set(path,Math.max(s.deadlines.get(path),now()+error.retryMs));s.retryStatus=error.upstreamStatus??null;}
          if(error.upstreamStatus===429)throw fail(429,'Trading 212’s request limit was reached. Account refresh will retry automatically; the order status is unchanged.',{retryMs:Math.max(period,error.retryMs||60000),upstreamStatus:429});
          throw error;
        }finally{s.deadlines.set(path,Math.max(s.deadlines.get(path),now()+period));}
        if(epoch!==s.epoch)throw fail(409,'Balances changed during this refresh. Checking the latest account values.');
      }
      const fresh={at,summary:values[0],positions:values[1],generation,epoch};s.cache=fresh;return fresh;
    })();
    s.pending=job;
    try{return await job.promise;}finally{if(s.pending===job)s.pending=null;}
  }
  return {read,invalidate,remove:id=>accounts.delete(id)};
}
