import {randomUUID} from 'node:crypto';
import {parseSentiment} from './feeds.mjs';
import {ageChecked} from './sentiment.mjs';

export const OANOR_SOURCE={name:'CNN Fear & Greed',url:'https://edition.cnn.com/markets/fear-and-greed',delivery:'api',via:{name:'Oanor API',url:'https://www.oanor.dev/api/stockfeargreed-api'}};
export const OANOR_URL='https://api.oanor.com/stockfeargreed-api/v1/index';
const PURPOSE='sentiment-oanor',TTL=10*60000;
const fail=(status,message,retryMs=0)=>Object.assign(new Error(message),{status,retryMs});

export function parseOanorSentiment(raw){
  const data=raw?.data;
  if(raw?.success!==true||raw.status!=='ok'||data?.index!=='CNN Fear & Greed (US stocks)'||data.source!=='CNN Business'||typeof data.updated!=='string'||!/[T ].*(?:Z|[+-]\d\d:\d\d)$/.test(data.updated))throw Error('Invalid CNN snapshot.');
  // meta.timestamp is a request time, not the underlying CNN observation.
  return parseSentiment({fear_and_greed:{score:data.score,rating:data.rating,timestamp:data.updated,previous_close:data.previous_close,previous_1_week:data.week_ago,previous_1_month:data.month_ago}});
}

export function createSentimentConnection(account,{fetcher=fetch,now=Date.now,timeoutMs=12000}={}){
  const db=account.db;
  db.exec(`CREATE TABLE IF NOT EXISTS sentiment_provider(id INTEGER PRIMARY KEY CHECK(id=1),credential TEXT NOT NULL,revision TEXT NOT NULL,result TEXT NOT NULL,retry_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sentiment_provider_control(id INTEGER PRIMARY KEY CHECK(id=1),retry_at INTEGER NOT NULL);
    INSERT OR IGNORE INTO sentiment_provider_control VALUES(1,0);`);
  const row=()=>db.prepare('SELECT * FROM sentiment_provider WHERE id=1').get();
  const blockedUntil=()=>db.prepare('SELECT retry_at FROM sentiment_provider_control WHERE id=1').get().retry_at;
  const backoff=until=>db.prepare('UPDATE sentiment_provider_control SET retry_at=max(retry_at,?) WHERE id=1').run(until);
  const cached=record=>{try{return ageChecked(JSON.parse(record.result),now());}catch{return null;}};
  let pending=null,changing=false;
  function status(){const record=row(),result=record&&cached(record);return {configured:!!record,provider:OANOR_SOURCE.via.name,checkedAt:result?.checkedAt||null,observationAt:result?.data?.observedAt||null,status:result?.status||'not-configured',message:result?.message||null};}
  async function check(key){
    const checkedAt=new Date(now()).toISOString();
    try{
      const response=await fetcher(OANOR_URL,{headers:{Accept:'application/json','x-oanor-key':key},redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
      if(!response.ok){
        const value=response.headers.get('retry-after'),retry=value?(/^\d+$/.test(value)?Number(value)*1000:Date.parse(value)-now()):0;
        const message=response.status===401?'Oanor rejected this key. Check the key and try again.':response.status===402?'Activate the Free plan for the Stock Market Fear & Greed API in Oanor.':response.status===429?'Oanor’s request limit was reached. Automatic checks will wait before retrying.':'The Oanor source is unavailable. Please try again later.';
        throw fail(400,message,Math.max([401,402].includes(response.status)?60000:300000,Number.isFinite(retry)?retry:0));
      }
      if(!response.headers.get('content-type')?.includes('application/json'))throw Error('Invalid format.');
      const reader=response.body.getReader(),chunks=[];let size=0;
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();throw Error('Response too large.');}chunks.push(value);}
      const data=parseOanorSentiment(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      const result=ageChecked({status:'ok',source:OANOR_SOURCE,data,fetchedAt:checkedAt,checkedAt},now());
      if(!result.data)throw Error('Invalid observation date.');
      return result;
    }catch(error){
      // Never expose upstream response bodies or fetch errors: either could
      // contain the credential. Only our fixed messages leave this module.
      if(error.status)throw error;
      throw fail(502,'Oanor did not return a valid, recent CNN reading. The saved connection has not been replaced.',300000);
    }
  }
  async function get(){
    const record=row();if(!record)return null;
    if(pending?.revision===record.revision)return pending.promise;
    const old=cached(record);
    if(Math.max(record.retry_at,blockedUntil())>now())return old;
    const promise=(async()=>{
      let result,retryAt=now()+TTL;
      try{
        result=await check(account.decrypt(record.credential,PURPOSE));
        if(old?.data&&Date.parse(result.data.observedAt)<Date.parse(old.data.observedAt))throw fail(502,'The provider returned an older snapshot. Keeping the newer saved observation.',300000);
      }catch(error){
        const checkedAt=new Date(now()).toISOString();
        result={status:old?.data?'stale':'unavailable',source:OANOR_SOURCE,data:old?.data||null,fetchedAt:old?.data?old.fetchedAt:null,checkedAt,message:error.status?error.message:'The saved API connection could not be read. Reconnect it in Market briefing.'};
        retryAt=now()+Math.max(300000,error.retryMs||0);
      }
      // A response from a removed/replaced key cannot restore its data.
      if(row()?.revision!==record.revision)return null;
      db.prepare('UPDATE sentiment_provider SET result=?,retry_at=? WHERE id=1 AND revision=?').run(JSON.stringify(result),retryAt,record.revision);
      if(result.status!=='ok')backoff(retryAt);
      return result;
    })();
    pending={revision:record.revision,promise};
    try{return await promise;}finally{if(pending?.promise===promise)pending=null;}
  }
  async function connect(key){
    if(typeof key!=='string'||!/^\S{16,512}$/.test(key)||/[^\x21-\x7e]/.test(key))throw fail(400,'Enter a valid API key (16–512 characters, without spaces).');
    if(changing)throw fail(409,'A connection check is already running.');
    if(blockedUntil()>now())throw fail(429,'Please wait before checking the provider again. Its retry delay is still active.');
    changing=true;backoff(now()+30000);
    try{
      const result=await check(key);
      db.prepare('INSERT INTO sentiment_provider VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET credential=excluded.credential,revision=excluded.revision,result=excluded.result,retry_at=excluded.retry_at').run(account.encrypt(key,PURPOSE),randomUUID(),JSON.stringify(result),now()+TTL);
      return {...status(),reading:result.data};
    }catch(error){backoff(now()+Math.max(30000,error.retryMs||0));throw error;}finally{changing=false;}
  }
  function disconnect(){if(changing)throw fail(409,'Wait for the connection check to finish.');db.prepare('DELETE FROM sentiment_provider').run();return status();}
  // Mount only after the existing owner/session, same-origin and CSRF gate.
  async function middleware(req,res,next){
    if(new URL(req.url,'http://localhost').pathname!=='/api/settings/sentiment')return next();
    res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
    try{
      if(req.method==='GET'){res.end(JSON.stringify(status()));return;}
      if(req.method==='DELETE'){res.end(JSON.stringify(disconnect()));return;}
      if(req.method!=='POST'){res.setHeader('Allow','GET, POST, DELETE');throw fail(405,'Method not supported.');}
      if(req.headers['content-type']?.split(';')[0]!=='application/json'||req.headers['x-opening-bell-client']!=='web')throw fail(415,'Use a JSON app request.');
      let length=0;const chunks=[];
      for await(const chunk of req){length+=chunk.length;if(length>4096)throw fail(413,'Request too large.');chunks.push(chunk);}
      let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fail(400,'Invalid request.');}
      res.end(JSON.stringify(await connect(data?.apiKey)));
    }catch(error){res.statusCode=error.status||500;res.end(JSON.stringify({message:error.status?error.message:'The connection could not be updated.'}));}
  }
  return {get,connect,disconnect,status,middleware};
}
