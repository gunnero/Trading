import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFeedCache} from '../src/data/feed-cache.mjs';

test('concurrent cards share a request; fresh remounts reuse it, explicit refresh checks the source',async()=>{
  let calls=0,release,time=Date.parse('2026-10-25T12:00:00Z');
  const feed={status:'ok',data:{score:21},fetchedAt:new Date(time).toISOString()};
  const cache=createFeedCache(async()=>{calls++;await new Promise(resolve=>{release=resolve;});return Response.json(feed);},()=>time);
  const a=cache.read('/sentiment'),b=cache.read('/sentiment');assert.equal(calls,1);release();
  assert.deepEqual(await a,feed);assert.deepEqual(await b,feed);
  await cache.read('/sentiment');assert.equal(calls,1);
  const forced=cache.read('/sentiment',true);assert.equal(calls,2);release();await forced;
  time+=10*60*1000;const expired=cache.read('/sentiment');assert.equal(calls,3);release();await expired;
});

test('range caches remain independent and an outage only retains dated matching data',async()=>{
  let fail=false,time=Date.parse('2026-10-25T12:00:00Z');
  const cache=createFeedCache(async url=>{if(fail)throw Error('Offline');return Response.json({status:'ok',data:{range:url},fetchedAt:new Date(time).toISOString()});},()=>time);
  await cache.read('/calendar?week=1');fail=true;
  const freshRange=await cache.read('/calendar?week=2');assert.equal(freshRange.status,'unavailable');assert.equal(freshRange.data,undefined);
  const stale=await cache.read('/calendar?week=1',true);assert.equal(stale.status,'stale');assert.equal(stale.data.range,'/calendar?week=1');
  time+=24*60*60*1000;const expired=await cache.read('/calendar?week=1');assert.equal(expired.status,'unavailable');assert.equal(expired.data,undefined);
});
