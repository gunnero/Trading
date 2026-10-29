import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {openAuthStore,authMiddleware} from '../server/auth.mjs';
import {createSentimentConnection,parseOanorSentiment,OANOR_URL,OANOR_SOURCE} from '../server/sentiment-connection.mjs';
import {createFeedService} from '../server/feeds.mjs';
import {sentimentDisplay} from '../src/data/sentiment.mjs';
import {SENTIMENT_NOW,hourlySentiment,dailySentiment} from './fixtures/sentiment.mjs';
import {HOURLY_SENTIMENT_URL} from '../server/sentiment.mjs';

const KEY='fixture-only-oanor-key-not-a-real-secret';
const snapshot=()=>({success:true,status:'ok',data:{index:'CNN Fear & Greed (US stocks)',source:'CNN Business',score:30.12,rating:'fear',updated:'2026-10-26T14:13:00+00:00',previous_close:20.98,week_ago:20.8,month_ago:36.94},meta:{timestamp:'2026-10-26T14:15:00Z'}});
function setup(t,fetcher=async()=>Response.json(snapshot())){
  const directory=mkdtempSync(join(tmpdir(),'ob-sentiment-connection-'));let time=SENTIMENT_NOW;
  const account=openAuthStore({directory,now:()=>time}),options={fetcher,now:()=>time};
  const service=createSentimentConnection(account,options);
  t.after(()=>{account.close();rmSync(directory,{recursive:true,force:true});});
  return {service,account,directory,options,now:()=>time,advance:n=>{time+=n;}};
}

test('Oanor parser uses the CNN observation, original rating and complete comparisons',()=>{
  const raw=snapshot();assert.deepEqual(parseOanorSentiment(raw),{score:30.12,rating:'fear',observedAt:'2026-10-26T14:13:00.000Z',previousClose:20.98,previousWeek:20.8,previousMonth:36.94,previousYear:null});
  raw.data.year_ago=64.2;assert.equal(parseOanorSentiment(raw).previousYear,64.2);
  delete raw.data.week_ago;raw.data.previous_close=0;assert.equal(parseOanorSentiment(raw).previousWeek,null);assert.equal(parseOanorSentiment(raw).previousClose,0);
  for(const edit of [r=>{r.success=false;},r=>{r.data.index='Crypto Fear & Greed';},r=>{r.data.source='Alternative.me';},r=>{r.data.updated='2026-10-26';},r=>{r.data.score=101;},r=>{r.data.score='30';},r=>{r.data.rating='uncertain';}]){const value=snapshot();edit(value);assert.throws(()=>parseOanorSentiment(value));}
});

test('Key is checked on the fixed HTTPS host and stored encrypted, separate from TOTP and workspace data',async t=>{
  let calls=0;const a=setup(t,async(url,options)=>{calls++;assert.equal(url,OANOR_URL);assert.equal(options.redirect,'error');assert.equal(options.headers['x-oanor-key'],KEY);return Response.json(snapshot());});
  assert.equal(await a.service.get(),null);assert.equal(a.service.status().configured,false);
  const status=await a.service.connect(KEY);assert.equal(status.configured,true);assert.equal(status.reading.score,30.12);assert.equal(JSON.stringify(status).includes(KEY),false);
  const stored=a.account.db.prepare('SELECT * FROM sentiment_provider').get();assert.notEqual(stored.credential,KEY);assert.equal(a.account.decrypt(stored.credential,'sentiment-oanor'),KEY);assert.throws(()=>a.account.decrypt(stored.credential));
  const totp=a.account.encrypt('TOTP fixture');assert.equal(a.account.decrypt(totp),'TOTP fixture');assert.throws(()=>a.account.decrypt(totp,'sentiment-oanor'));
  assert.equal(JSON.stringify(stored).includes(KEY),false);assert.equal(JSON.stringify(a.service.status()).includes(KEY),false);
  const restored=createSentimentConnection(a.account,a.options);assert.equal((await restored.get()).data.score,30.12);assert.equal(calls,1);
  a.account.db.exec('PRAGMA wal_checkpoint(FULL)');assert.equal(readFileSync(join(a.directory,'auth.sqlite')).includes(Buffer.from(KEY)),false);
});

test('Automatic resolver selects newest complete snapshot across API, hourly and daily sources',async t=>{
  const a=setup(t);await a.service.connect(KEY);
  const combined=createFeedService({now:a.now,sentimentApi:a.service.get,fetcher:async url=>Response.json(url===HOURLY_SENTIMENT_URL?hourlySentiment():dailySentiment())});
  const reading=await combined.get('sentiment');assert.equal(reading.source.delivery,'api');assert.equal(reading.data.score,30.12);assert.equal(reading.data.previousMonth,36.94);
  assert.equal(sentimentDisplay(reading,a.now()).label,'API snapshot');assert.equal(sentimentDisplay(reading,Date.parse('2026-10-26T14:34Z')).outdated,true);
  a.service.disconnect();const fallback=await combined.get('sentiment');assert.equal(fallback.source.delivery,'hourly');assert.equal(await a.service.get(),null);
});

test('API polling coalesces, preserves observations on errors/regression, and persists provider backoff',async t=>{
  let calls=0,mode='ok';const a=setup(t,async()=>{calls++;if(mode==='rate')return new Response('private upstream body '+KEY,{status:429,headers:{'Retry-After':'3600'}});const raw=snapshot();if(mode==='older')raw.data.updated='2026-10-23T23:59Z';return Response.json(raw);});
  await a.service.connect(KEY);a.advance(10*60000+1);
  await Promise.all([a.service.get(),a.service.get()]);assert.equal(calls,2);
  a.advance(10*60000+1);mode='older';let result=await a.service.get();assert.equal(result.status,'stale');assert.equal(result.data.observedAt,'2026-10-26T14:13:00.000Z');assert.match(result.message,/older snapshot/);
  a.advance(5*60000+1);mode='rate';result=await a.service.get();const fetchedAt=result.fetchedAt;assert.equal(result.status,'stale');assert.equal(JSON.stringify(result).includes(KEY),false);
  const restored=createSentimentConnection(a.account,a.options);a.advance(30*60000);await restored.get();assert.equal(calls,4);await assert.rejects(restored.connect(KEY),/retry delay/);assert.equal(calls,4);
  a.advance(31*60000);await restored.get();assert.equal(calls,5);assert.equal((await restored.get()).fetchedAt,fetchedAt);
  a.advance(25*3600000);assert.equal((await restored.get()).data,null);
});

test('Malformed, failed, future and oversized responses never save a new key or expose secrets',async t=>{
  for(const mode of ['network','invalid','future','old','oversize','401']){
    await t.test(mode,async t=>{
      const a=setup(t,async()=>{if(mode==='network')throw Error('request failed '+KEY);if(mode==='oversize')return new Response('x'.repeat(65537),{headers:{'Content-Type':'application/json'}});if(mode==='401')return new Response(KEY,{status:401});const raw=snapshot();if(mode==='invalid')raw.data.index='crypto';if(mode==='future')raw.data.updated='2026-10-27T14:13Z';if(mode==='old')raw.data.updated='2026-10-18T14:13Z';return Response.json(raw);});
      await assert.rejects(a.service.connect(KEY),e=>!e.message.includes(KEY));assert.equal(a.service.status().configured,false);
      await assert.rejects(a.service.connect('bad\nkey'),/valid API key/);
    });
  }
});

test('A disconnected key cannot repopulate the cache after its in-flight request completes',async t=>{
  let release,calls=0;const a=setup(t,async()=>{if(calls++)await new Promise(r=>{release=r;});return Response.json(snapshot());});
  await a.service.connect(KEY);a.advance(10*60000+1);const pending=a.service.get();a.service.disconnect();release();assert.equal(await pending,null);assert.equal(a.service.status().configured,false);
});

test('Connection endpoints require owner session, exact origin and CSRF, and never return the saved credential',async t=>{
  const a=setup(t),gate=authMiddleware(a.account),server=createServer((req,res)=>gate(req,res,()=>a.service.middleware(req,res,()=>res.end())));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const origin=`http://127.0.0.1:${server.address().port}`,url=origin+'/api/settings/sentiment';
  assert.equal((await fetch(url)).status,401);
  const session=a.account.newSession();
  // Use the configured cookie name, without mocking the authentication gate.
  const {authConfig}=await import('../server/auth.mjs');
  const headers={Cookie:authConfig().cookieName+'='+session.token,Origin:origin,'Content-Type':'application/json','X-Opening-Bell-Client':'web'};
  assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({apiKey:KEY})})).status,403);
  headers['X-CSRF-Token']=a.account.csrf(session.row.id);
  assert.equal((await fetch(url,{method:'POST',headers:{...headers,Origin:'https://other.example'},body:JSON.stringify({apiKey:KEY})})).status,403);
  const response=await fetch(url,{method:'POST',headers,body:JSON.stringify({apiKey:KEY})});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.text()).includes(KEY),false);
  const status=await fetch(url,{headers});assert.equal(status.status,200);assert.equal((await status.text()).includes(KEY),false);
  assert.equal((await fetch(url,{method:'DELETE',headers})).status,200);assert.equal(a.service.status().configured,false);
});

const detailRaw=kind=>({success:true,status:'ok',data:{index:'CNN Fear & Greed (US stocks)',source:'CNN Business',count:1,...(kind==='components'?{components:[{indicator:'stock_price_strength',score:32.2,rating:'fear'}]}:{history:[{date:'2026-10-23T00:00:00Z',score:20.98,rating:'extreme fear'}]})}});
test('details use the saved encrypted key, bounded fixed endpoints, independent persistent caches and no fabricated timestamps',async t=>{
 const urls=[];const a=setup(t,async(url,options)=>{urls.push(url);assert.equal(options.headers['x-oanor-key'],KEY);assert.equal(options.redirect,'error');return Response.json(url===OANOR_URL?snapshot():detailRaw(url.endsWith('components')?'components':'history'));});
 assert.equal((await a.service.details()).data.components.status,'unavailable');assert.equal(urls.length,0);
 await a.service.connect(KEY);a.advance(30001);
 const [x,y]=await Promise.all([a.service.details(),a.service.details()]);assert.deepEqual(x,y);assert.equal(urls.length,3);assert.equal(x.data.components.data.observedAt,null);assert.equal(x.data.history.data.points[0].date,'2026-10-23');assert.ok(urls.includes(OANOR_URL.replace('/index','/history?limit=365')));
 const restored=createSentimentConnection(a.account,a.options);await restored.details();assert.equal(urls.length,3);
 a.advance(31*60000);await restored.details();assert.equal(urls.length,4);
 assert.equal(JSON.stringify(x).includes(KEY),false);a.service.disconnect();assert.equal(a.account.db.prepare('SELECT count(*) AS n FROM sentiment_provider_details').get().n,0);
});
test('detail provider failure retains matching cached data, persists backoff and expires old snapshots',async t=>{
 let fail=false,calls=0;const a=setup(t,async url=>{calls++;if(fail)return new Response(KEY,{status:429,headers:{'Retry-After':'3600'}});return Response.json(url===OANOR_URL?snapshot():detailRaw(url.endsWith('components')?'components':'history'));});
 await a.service.connect(KEY);a.advance(30001);const first=await a.service.details();a.advance(31*60000);fail=true;const stale=await a.service.details();assert.equal(stale.data.components.status,'stale');assert.equal(stale.data.components.fetchedAt,first.data.components.fetchedAt);assert.equal(JSON.stringify(stale).includes(KEY),false);
 const n=calls;await createSentimentConnection(a.account,a.options).details();assert.equal(calls,n);
 a.advance(25*3600000);const expired=await a.service.details();assert.equal(expired.data.components.data,null);assert.equal(expired.data.history.data,null);
});
test('disconnect prevents in-flight details from restoring a removed connection',async t=>{
 let release;const a=setup(t,async url=>{if(url!==OANOR_URL)await new Promise(r=>{release=r;});return Response.json(url===OANOR_URL?snapshot():detailRaw('components'));});
 await a.service.connect(KEY);a.advance(30001);const pending=a.service.details();a.service.disconnect();release();assert.equal((await pending).status,'unavailable');assert.equal(a.account.db.prepare('SELECT count(*) AS n FROM sentiment_provider_details').get().n,0);
});
test('details route is owner-only, read-only and does not expose credentials',async t=>{
 const a=setup(t),gate=authMiddleware(a.account),server=createServer((req,res)=>gate(req,res,()=>a.service.middleware(req,res,()=>res.end())));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const origin=`http://127.0.0.1:${server.address().port}`,url=origin+'/api/sentiment/details';assert.equal((await fetch(url)).status,401);
 const session=a.account.newSession(),{authConfig}=await import('../server/auth.mjs');const headers={Cookie:authConfig().cookieName+'='+session.token,Origin:origin,'X-CSRF-Token':a.account.csrf(session.row.id)};
 const response=await fetch(url,{headers});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.text()).includes(KEY),false);
 assert.equal((await fetch(url,{method:'POST',headers})).status,405);assert.equal((await fetch(url,{headers:{...headers,Origin:'https://other.example'}})).status,403);
});
