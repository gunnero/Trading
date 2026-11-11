import test from 'node:test';
import assert from 'node:assert/strict';
import {createBalanceReader} from '../server/portfolio-balance-reads.mjs';
const summary='/equity/account/summary',positions='/equity/positions';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(){
  let at=1000000;const calls=[],waits=[],source={request:async path=>path===summary?{cash:1000}:[]};
  const reader=createBalanceReader({now:()=>at,wait:async ms=>{assert.ok(ms<=5000);waits.push(ms);at+=ms;},request:async(path,secret,options)=>{calls.push({path,at,secret});return source.request(path,secret,options);}});
  return {reader,calls,waits,source,now:()=>at,advance:ms=>at+=ms};
}
test('concurrent account readers share one summary/positions pair and a five-second cache',async()=>{
  const f=fixture(),hold=deferred();f.source.request=async path=>{if(path===summary)await hold.promise;return path===summary?{cash:1000}:[];};
  const first=f.reader.read('a','g1','secret'),second=f.reader.read('a','g1','secret');hold.resolve();
  const [a,b]=await Promise.all([first,second]);assert.equal(a,b);assert.equal(f.calls.length,2);
  f.advance(4999);assert.equal(await f.reader.read('a','g1','secret'),a);assert.equal(f.calls.length,2);
  f.advance(1);await f.reader.read('a','g1','secret');assert.equal(f.calls.length,4);
});
test('post-order invalidation retains endpoint deadlines and never returns pre-order balances',async()=>{
  const f=fixture();await f.reader.read('a','g1','secret');f.reader.invalidate('a');
  f.source.request=async path=>path===summary?{cash:500}:[];
  const fresh=await f.reader.read('a','g1','secret');assert.equal(fresh.summary.cash,500);assert.deepEqual(f.waits,[5000]);
  assert.equal(f.calls.filter(c=>c.path===summary)[1].at-f.calls[0].at,5000);
});
test('in-flight snapshot invalidated by an order cannot publish its old values or satisfy new reads',async()=>{
  const f=fixture(),hold=deferred();let old=true;
  f.source.request=async path=>{const value=old?1000:500;if(path===summary&&old)await hold.promise;return path===summary?{cash:value}:[];};
  const first=f.reader.read('a','g1','secret');const stale=assert.rejects(first,error=>error.status===409);
  f.reader.invalidate('a');old=false;const next=f.reader.read('a','g1','secret');hold.resolve();await stale;
  const result=await next;assert.equal(result.summary.cash,500);assert.equal(f.calls.filter(c=>c.path===summary).length,2);assert.equal(f.calls.filter(c=>c.path===positions).length,1);
  assert.equal(await f.reader.read('a','g1','secret'),result);
});
test('provider backoff stops all callers without sleeping for minutes, even after invalidation',async()=>{
  const f=fixture();f.source.request=async()=>{throw Object.assign(Error('upstream limit'),{status:502,upstreamStatus:429,retryMs:300000});};
  await assert.rejects(f.reader.read('a','g1','secret'),e=>e.status===429&&e.retryMs===300000);
  for(let i=0;i<3;i++){f.advance(1000);f.reader.invalidate('a');await assert.rejects(f.reader.read('a','g1','secret'),e=>e.status===429&&e.retryMs===300000-(i+1)*1000);}
  assert.equal(f.calls.length,1);assert.deepEqual(f.waits,[]);
  f.advance(297000);f.source.request=async path=>path===summary?{cash:800}:[];assert.equal((await f.reader.read('a','g1','secret')).summary.cash,800);
});
test('accounts are independent and reconnects retain rate deadlines but never reuse another generation',async()=>{
  const f=fixture();f.source.request=async(path,secret)=>path===summary?{account:secret}:[];
  const a=await f.reader.read('a','g1','first');const b=await f.reader.read('b','g1','second');assert.equal(b.summary.account,'second');assert.deepEqual(f.waits,[]);
  const reconnect=await f.reader.read('a','g2','replacement');assert.equal(reconnect.summary.account,'replacement');assert.notEqual(reconnect,a);assert.deepEqual(f.waits,[5000]);
});
test('a positions limit preserves its endpoint deadline and does not return a partial snapshot',async()=>{
  const f=fixture();f.source.request=async path=>{if(path===positions)throw Object.assign(Error('limited'),{status:502,upstreamStatus:429,retryMs:60000});return {cash:1000};};
  await assert.rejects(f.reader.read('a','g1','secret'),e=>e.status===429);
  f.advance(1000);await assert.rejects(f.reader.read('a','g1','secret'),e=>e.status===429&&e.retryMs===59000);
  assert.equal(f.calls.filter(c=>c.path===summary).length,1);
  assert.equal(f.calls.filter(c=>c.path===positions).length,1);
});
test('normal endpoint spacing starts at response completion and successful reset headers can extend it',async()=>{
  const f=fixture();let calls=0;
  f.source.request=async(path,secret,{onReadResponse})=>{if(path===summary){calls++;f.advance(1200);onReadResponse(new Response('',{headers:calls===2?{'x-ratelimit-remaining':'0','x-ratelimit-reset':String(Math.ceil((f.now()+20000)/1000))}:{}}));return {cash:1000};}return [];};
  await f.reader.read('a','g1','secret');f.reader.invalidate('a');await f.reader.read('a','g1','secret');
  assert.equal(f.calls.filter(c=>c.path===summary)[1].at-f.calls[0].at,6200);assert.deepEqual(f.waits,[5000]);
  f.reader.invalidate('a');await assert.rejects(f.reader.read('a','g1','secret'),e=>e.status===429&&e.retryMs===20600);assert.equal(calls,2);
});
