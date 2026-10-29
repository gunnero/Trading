import test from 'node:test';
import assert from 'node:assert/strict';
import {parseComponents,parseHistory,COMPONENT_IDS} from '../server/sentiment-details.mjs';
const now=Date.parse('2026-10-29T20:00Z');
const payload=(key,rows)=>({success:true,status:'ok',data:{index:'CNN Fear & Greed (US stocks)',source:'CNN Business',count:rows.length,[key]:rows},meta:{timestamp:new Date(now).toISOString()}});
const component=(indicator,score=35)=>({indicator,score,rating:'fear'});
test('seven sentiment components exclude the two moving-average references and never borrow request timestamps',()=>{
 const raw=payload('components',[...COMPONENT_IDS.map(id=>component(id)),component('market_momentum_sp125'),component('market_volatility_vix_50')]);
 const result=parseComponents(raw,now);assert.equal(result.components.length,7);assert.equal(result.observedAt,null);assert.ok(result.components.every(c=>c.observedAt===null));
 raw.data.components[0].score=0;assert.equal(parseComponents(raw,now).components[0].score,0);
 raw.data.components=raw.data.components.slice(0,1);raw.data.count=1;assert.equal(parseComponents(raw,now).components.length,1);
});
test('malformed components, duplicate identities and wrong market envelopes are rejected',()=>{
 for(const edit of [r=>r.data.components[0].score=101,r=>r.data.components[0].score='35',r=>r.data.components[0].rating='buy',r=>r.data.count=9,r=>r.data.index='Crypto',r=>r.success=false,r=>r.data.updated='2026-10-30T20:00Z']){
  const raw=payload('components',[component(COMPONENT_IDS[0])]);edit(raw);assert.throws(()=>parseComponents(raw,now));
 }
 assert.throws(()=>parseComponents(payload('components',[component(COMPONENT_IDS[0]),component(COMPONENT_IDS[0])]),now));
});
test('history keeps published dates, gaps and latest same-day snapshot; zero is valid',()=>{
 const raw=payload('history',[{date:'2026-10-29T16:00:00Z',score:34.6,rating:'fear'},{date:'2026-10-23T00:00:00Z',score:0,rating:'extreme fear'},{date:'2026-10-29T00:00:00Z',score:33,rating:'fear'}]);
 const rows=parseHistory(raw,now).points;assert.deepEqual(rows.map(r=>r.date),['2026-10-23','2026-10-29']);assert.equal(rows[0].score,0);assert.equal(rows[1].score,34.6);
});
test('history rejects future, ambiguous and conflicting timestamps and incomplete arrays',()=>{
 const row={date:'2026-10-28T00:00:00Z',score:30,rating:'fear'};
 for(const date of ['2026-10-30T00:00:00Z','2026-10-28','2026-02-30T00:00:00Z','broken'])assert.throws(()=>parseHistory(payload('history',[{...row,date}]),now));
 assert.throws(()=>parseHistory(payload('history',[row,{...row,score:31}]),now));
 const raw=payload('history',[row]);raw.data.count=2;assert.throws(()=>parseHistory(raw,now));assert.deepEqual(parseHistory(payload('history',[]),now).points,[]);
});
