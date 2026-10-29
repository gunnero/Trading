import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sessionResults,sessionAccount,sessionDates,defaultSessionDay,sessionAdherence,saveSessionNote,validateSessionReviews} from '../src/data/session-review.mjs';
import {reviewTrade,tradeLevelContext} from '../src/data/journal-review.mjs';
import {openWorkspaceStore,validateWorkspace,initialWorkspace} from '../server/workspace.mjs';
import {fixture} from './fixtures/journal.mjs';
import {reviewDay,reviewTrades,reviewHistory,reviewLevels,reviewPlan} from './fixtures/session-review.mjs';

test('Daily results use New York exit dates; checks and tags use entry dates across accounts',()=>{
  const trades=reviewTrades(),s=sessionResults(trades,reviewDay);
  assert.equal(s.entries.length,4);assert.equal(s.closed.length,4);assert.equal(s.open.length,1);
  assert.equal(s.stats.gross,78);assert.equal(s.stats.missingFees,4);assert.equal(s.stats.net,null);assert.equal(s.stats.winRate,75);
  assert.deepEqual(s.tags,[{label:'Early entry',count:1},{label:'Followed plan',count:1}]);
  const account=sessionResults(trades,reviewDay,sessionAccount(trades[0]));assert.equal(account.stats.gross,58);assert.equal(account.closed.length,3);
  assert.deepEqual(sessionDates(trades),[reviewDay,'2026-10-23']);
  assert.equal(defaultSessionDay(trades,Date.parse('2026-10-24T12:00:00Z')),'2026-10-23');
  assert.equal(defaultSessionDay([],Date.parse('2026-10-27T01:00:00Z')),reviewDay);
  assert.equal(sessionResults(trades,'2026-10-27').stats.closed,0);
});
test('Local midnight and daylight-saving offsets never shift the U.S. trading date',()=>{
  for(const [entryAt,exitAt,day] of [['2026-10-26T23:59:00+01:00','2026-10-27T00:05:00+01:00','2026-10-26'],['2026-11-01T01:30:00-04:00','2026-11-01T01:30:00-05:00','2026-11-01']]){
    const trade=fixture({entryAt,exitAt,expiration:'2026-11-02',fees:2});const s=sessionResults([trade],day);
    assert.equal(s.entries.length,1);assert.equal(s.closed.length,1);assert.equal(s.stats.net,52);
  }
  const overnight=fixture({entryAt:'2026-10-26T18:00:00Z',exitAt:'2026-10-27T14:00:00Z',expiration:'2026-10-30'});
  assert.equal(sessionResults([overnight],reviewDay).stats.closed,0);assert.equal(sessionResults([overnight],'2026-10-27').entries.length,0);
});
test('Six-rule aggregation excludes unknown/outside entries from fully checked ratio and ignores profits or manual tags',()=>{
  const entries=sessionResults(reviewTrades(),reviewDay).entries,workspace={levelText:reviewLevels};
  const rows=Object.fromEntries(entries.map(t=>[t.id,{status:'done',review:reviewTrade(t,t.symbol==='AMD'?reviewHistory():{status:'unavailable'},tradeLevelContext(t,workspace))}]));
  const a=sessionAdherence(entries,rows);assert.equal(a.matched,1);assert.equal(a.missed,1);assert.equal(a.incomplete,1);assert.equal(a.outside,1);assert.equal(a.complete,2);assert.equal(a.matchRate,50);
  const retest=a.rules.find(r=>r.id==='retest');assert.deepEqual([retest.met,retest.missed,retest.unknown],[1,1,2]);
  const pending=sessionAdherence(entries,{});assert.equal(pending.loading,4);assert.equal(pending.matchRate,null);assert.equal(pending.rules.every(r=>r.unknown===4),true);
  rows.matched.cached=true;assert.equal(sessionAdherence(entries,rows).cached,1);
  assert.deepEqual(sessionAdherence(entries.map(t=>({...t,exitPrice:999,tags:['Chased entry']})),rows),sessionAdherence(entries,rows));
});
test('Daily notes are bounded, sanitized, editable and removable without changing other dates',()=>{
  const a=saveSessionNote(undefined,reviewDay,'lesson','Wait for a closed retest.');
  const b=saveSessionNote(a,'2026-10-27','mistakes','<script>literal text</script>');
  assert.equal(a.days.length,1);assert.equal(b.days.length,2);
  assert.equal(saveSessionNote(b,reviewDay,'lesson','').days.length,1);
  assert.deepEqual(validateSessionReviews({version:1,days:[{date:reviewDay,lesson:'x',ignored:'field'}]}).days[0],{date:reviewDay,wentWell:'',mistakes:'',lesson:'x',nextSession:''});
  for(const value of [null,{},[],{version:2,days:[]},{version:1,days:[{date:'2026-02-30'}]},{version:1,days:[{date:reviewDay},{date:reviewDay}]},{version:1,days:[{date:reviewDay,lesson:2}]},{version:1,days:[{date:reviewDay,lesson:'x'.repeat(2001)}]}])assert.throws(()=>validateSessionReviews(value));
  assert.throws(()=>saveSessionNote(a,reviewDay,'unexpected','x'));
  assert.throws(()=>validateWorkspace({...initialWorkspace(),sessionReviews:{version:1,days:[{date:'invalid'}]}}),e=>e.status===400);
});
test('Old workspaces and plans stay unchanged; daily notes survive SQLite reopen and revision conflicts',t=>{
  const directory=mkdtempSync(join(tmpdir(),'opening-bell-review-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  assert.equal(validateWorkspace(initialWorkspace()).sessionReviews,undefined);
  let store=openWorkspaceStore({directory});const original=store.read();
  const data={...original.data,plans:[reviewPlan],journal:{version:1,trades:reviewTrades()},sessionReviews:saveSessionNote(undefined,reviewDay,'lesson','Wait for confirmation.')};
  const saved=store.save(data,original.revision);assert.equal(saved.data.sessionReviews.days[0].lesson,'Wait for confirmation.');
  assert.throws(()=>store.save(data,original.revision),e=>e.status===409);
  store.close();store=openWorkspaceStore({directory});assert.deepEqual(store.read(),saved);assert.deepEqual(store.read().data.plans,[reviewPlan]);store.close();
});
