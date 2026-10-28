import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewTrade,tradeLevelContext,tradeDirection,replayDates} from '../src/data/journal-review.mjs';
import {fixture} from './fixtures/journal.mjs';
const day='2026-10-26',start=Date.parse(day+'T13:30:00Z')/1000;
const bar=(i,close=99.5,low=close-.2,high=close+.2)=>({timestamp:start+i*120,end:start+(i+1)*120,start,sessionEnd:start+23400,sessionDate:day,date:day,complete:true,partial:false,volume:100,ohlc:[close-.05,close,low,high]});
const bull=()=>[...Array.from({length:25},(_,i)=>bar(i)),bar(25,101.4,101.1,101.6),bar(26,101.3,100.8,101.5)];
const context=()=>({status:'ok',day,instrument:{symbol:'AMD',sourceDate:day,timeframe:'4 h',futures:false,zones:[{type:'S',low:100,high:101}]}});
const history=rows=>({status:'ok',symbol:'NASDAQ:AMD',timeframe:'2m',observedThrough:start+23400,candles:rows});
const trade=(rows=bull(),patch={})=>fixture({entryAt:new Date((rows.at(-1).end+23)*1000).toISOString(),exitAt:new Date((rows.at(-1).end+300)*1000).toISOString(),...patch});
const get=(result,id)=>result.checks.find(c=>c.id===id);
test('A closed bullish break and separate retest automatically match all six rules with EMA/VWAP',()=>{
  const rows=bull(),saved=trade(rows),levels=context(),copy=structuredClone({rows,saved,levels});
  const result=reviewTrade(saved,history(rows),levels);
  assert.equal(result.status,'matched');assert.equal(result.passed,6);assert.equal(result.unknown,0);
  assert.equal(result.pattern.breakAt,rows[25].end);assert.equal(result.pattern.confirmedAt,rows[26].end);
  assert.equal(result.through,rows[26].end);assert.ok(result.reference.ema9>result.reference.ema21);
  assert.deepEqual({rows,saved,levels},copy);
  assert.equal(reviewTrade(saved,{...history(rows),status:'stale'},levels).passed,6);
});
test('Put/short directions mirror calls, without treating every option buy as bullish',()=>{
  const rows=bull().map(c=>({...c,ohlc:[200-c.ohlc[0],200-c.ohlc[1],200-c.ohlc[3],200-c.ohlc[2]]}));
  const levels={...context(),instrument:{...context().instrument,zones:[{type:'D',low:99,high:100}]}};
  for(const patch of [{optionType:'PUT'},{optionType:'CALL',position:'short'}])assert.equal(reviewTrade(trade(rows,patch),history(rows),levels).passed,6);
  assert.equal(tradeDirection(trade(bull(),{optionType:'PUT',position:'short'})),'bullish');
  assert.equal(reviewTrade(trade(rows),history(rows),levels).checks.find(c=>c.id==='break').passed,false);
});
test('An eligible zone is not hidden by a narrower failed candidate at the same retest',()=>{
  const levels=context();levels.instrument.zones.unshift({type:'S',low:100.8,high:101});
  const result=reviewTrade(trade(),history(bull()),levels);
  assert.equal(result.status,'matched');assert.equal(result.pattern.zone.low,100);
});
test('A profitable exit and future candles cannot turn an early entry into a confirmed retest',()=>{
  const rows=bull(),early=trade(rows,{entryAt:new Date((rows[26].timestamp+23)*1000).toISOString()});
  const before=reviewTrade(early,history(rows),context());
  assert.equal(get(before,'break').passed,true);assert.equal(get(before,'retest').passed,false);assert.equal(get(before,'timing').passed,false);
  const future=rows.map((c,i)=>i===26?{...c,ohlc:[400,500,300,600]}:c);future.push(bar(27,900,800,1000));
  const after=reviewTrade({...early,exitPrice:99,reportedPnl:99999,review:{break:true,retest:true,ema:true,vwap:true}},history(future),context());
  assert.deepEqual(after,before);
});
test('Missing bars, a developing last bar and old observation cutoffs remain unknown',()=>{
  const rows=bull(),saved=trade(rows);
  for(const source of [history(rows.filter((_,i)=>i!==12)),history(rows.map((c,i)=>i===26?{...c,complete:false}:c)),{...history(rows),observedThrough:Date.parse(saved.entryAt)/1000-1}]){
    const result=reviewTrade(saved,source,context());assert.equal(result.unknown,6);assert.equal(result.failed,0);
  }
  const missingVolume=rows.map((c,i)=>i===3?{...c,volume:null}:c);
  assert.equal(get(reviewTrade(saved,history(missingVolume),context()),'vwap').passed,null);
  assert.equal(reviewTrade(saved,{...history(rows),symbol:'NASDAQ:QQQ'},context()).unknown,6);
});
test('Wicks, equality and the breakout candle itself do not satisfy the retest rule',()=>{
  for(const replacement of [bar(25,101,99,102),bar(25,100.5,99,102)]){
    const rows=[...bull().slice(0,25),replacement];assert.equal(get(reviewTrade(trade(rows),history(rows),context()),'break').passed,false);
  }
  const rows=[...bull().slice(0,25),bar(25,101.4,100.5,101.6)];assert.equal(get(reviewTrade(trade(rows),history(rows),context()),'retest').passed,false);
  const equal=[...bull().slice(0,26),bar(26,101,100.8,101.5)];assert.equal(get(reviewTrade(trade(equal),history(equal),context()),'retest').passed,false);
});
test('Expired confirmations, chasing and an opposite EMA/VWAP explain separate failures',()=>{
  const rows=bull();for(let i=27;i<=29;i++)rows.push(bar(i,101.4,101.2,101.6));
  assert.equal(get(reviewTrade(trade(rows),history(rows),context()),'timing').passed,false);
  const chasing=[...bull(),bar(27,103,102.8,103.2)];assert.equal(get(reviewTrade(trade(chasing),history(chasing),context()),'location').passed,false);
  const stretched=[...bull().slice(0,26)];for(let i=26;i<=39;i++)stretched.push(bar(i,101.4,101.2,101.6));
  assert.equal(get(reviewTrade(trade(stretched),history(stretched),context()),'retest').passed,false);
  const overhead=bull().map((c,i)=>i<20?{...c,ohlc:[105,105,104.8,105.2]}:c);
  const conflict=reviewTrade(trade(overhead),history(overhead),context());
  assert.equal(get(conflict,'ema').passed,false);assert.equal(get(conflict,'vwap').passed,false);
});
test('Pre-market and entries before the first close never receive a regular-session match',()=>{
  const pre=reviewTrade(trade(bull(),{entryAt:day+'T13:20:00Z'}),history(bull()),context());assert.equal(pre.status,'outside-session');assert.equal(pre.passed,0);
  const first=reviewTrade(trade(bull(),{entryAt:day+'T13:30:23Z'}),history(bull()),context());assert.equal(get(first,'break').passed,false);assert.equal(get(first,'ema').passed,null);
});
test('Only the matching dated stock level sheet is used; missing or carried sheets never borrow current zones',()=>{
  const saved=trade(),current='LVLS 2026-10-28\nAMD|4h|S 400-401',old='LVLS 2026-10-26\nAMD|4h|S 100-101';
  const workspace={levelText:current,levelHistory:[{date:day,levelText:old,levelSourceDates:{AMD:day}}]};
  const levels=tradeLevelContext(saved,workspace);assert.equal(levels.status,'ok');assert.equal(levels.instrument.zones[0].low,100);
  assert.equal(tradeLevelContext(saved,{levelText:current}).status,'missing');
  const carried=tradeLevelContext(saved,{levelText:old,levelSourceDates:{AMD:'2026-10-23'}});assert.equal(carried.status,'dated');
  const result=reviewTrade(saved,history(bull()),carried);assert.equal(result.unknown,4);assert.equal(result.passed,2);
  assert.deepEqual(replayDates(saved),{day,from:'2026-10-19',to:day});
});
