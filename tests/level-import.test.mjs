import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {mergeLevelSheets,parseLevels} from '../src/data/market.js';
import {entryState} from '../src/data/quotes.mjs';
import {evaluateRetest,topRetest} from '../src/data/retests.mjs';
import {initialWorkspace,openWorkspaceStore,validateWorkspace} from '../server/workspace.mjs';

const friday=readFileSync(new URL('../server/seed/levels.txt',import.meta.url),'utf8');
const monday='LVLS 2026-10-26\nQQQ|1HR|S 720-719\nKO|Daily|D 65-64';
const parse=merged=>parseLevels(merged.levelText,merged.levelSourceDates);
const savedFields=merged=>({levelText:merged.levelText,levelSourceDates:merged.levelSourceDates});

test('New daily rows replace whole instruments; every omitted Friday row survives exactly',()=>{
  const old=parseLevels(friday),merged=mergeLevelSheets(friday,monday),sheet=parse(merged);
  assert.equal(Object.keys(old.instruments).length,40);
  assert.deepEqual(merged.updated.map(i=>i.symbol),['QQQ']);assert.deepEqual(merged.added.map(i=>i.symbol),['KO']);assert.equal(merged.carried.length,39);
  assert.equal(Object.keys(sheet.instruments).length,41);
  assert.deepEqual(sheet.instruments.QQQ.zones,[{type:'S',low:719,high:720}]);
  assert.equal(sheet.instruments.QQQ.timeframe,'1 h');assert.equal(sheet.instruments.QQQ.sourceDate,'2026-10-26');assert.equal(sheet.instruments.QQQ.carriedForward,false);
  for(const item of merged.carried){
    assert.deepEqual(sheet.instruments[item.symbol],{...old.instruments[item.symbol],carriedForward:true});
    const row=friday.split('\n').find(line=>line.startsWith(item.symbol+'|'));assert.ok(merged.levelText.split('\n').includes(row));
  }
  assert.equal(sheet.instruments.NQ.futures,true);assert.deepEqual(sheet.instruments.NOW.zones.find(z=>z.type==='G'),{type:'G',low:171.58,high:171.58});
});

test('Repeated omissions preserve each original date, and returning instruments replace their previous row',()=>{
  const mon=mergeLevelSheets(friday,monday),tue=mergeLevelSheets(mon.levelText,'LVLS 2026-10-27\nSPY|4h|D 770-768',mon.levelSourceDates),sheet=parse(tue);
  assert.equal(sheet.instruments.NVDA.sourceDate,'2026-10-23');assert.equal(sheet.instruments.QQQ.sourceDate,'2026-10-26');assert.equal(sheet.instruments.SPY.sourceDate,'2026-10-27');
  const wed=mergeLevelSheets(tue.levelText,'LVLS 2026-10-28\nNVDA|1h|S 240-239',tue.levelSourceDates),returned=parse(wed).instruments.NVDA;
  assert.equal(returned.carriedForward,false);assert.equal(returned.sourceDate,'2026-10-28');assert.equal(returned.zones.length,1);assert.equal(returned.timeframe,'1 h');
  const again=mergeLevelSheets(wed.levelText,'LVLS 2026-10-28\nNVDA|1h|S 240-239',wed.levelSourceDates);assert.deepEqual(savedFields(again),savedFields(wed));
});

test('Older, empty, duplicate, malformed and changed-asset imports cannot drop or misidentify an instrument',()=>{
  for(const text of ['LVLS 2026-10-22\nQQQ|4h|S 720-719','LVLS 2026-10-26','LVLS 2026-10-26\nQQQ|4h|S 720-719\nQQQ|4h|D 700-699','LVLS 2026-10-26\nQQQ|4h|bad','LVLS 2026-10-26\nNQ|30min|S 30000-29900'])assert.throws(()=>mergeLevelSheets(friday,text));
});

test('Carry-forward provenance survives SQLite restart and revision conflicts without disturbing other saved work',t=>{
  const directory=mkdtempSync(join(tmpdir(),'opening-bell-levels-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  let store=openWorkspaceStore({directory});const before=store.read(),merged=mergeLevelSheets(before.data.levelText,monday);
  const saved=store.save({...before.data,...savedFields(merged)},before.revision);
  assert.deepEqual(saved.data.watchText,before.data.watchText);assert.deepEqual(saved.data.preferences,before.data.preferences);assert.deepEqual(saved.data.plans,before.data.plans);
  store.close();store=openWorkspaceStore({directory});t.after(()=>store.close());assert.deepEqual(store.read(),saved);
  assert.equal(parseLevels(store.read().data.levelText,store.read().data.levelSourceDates).instruments.NQ.sourceDate,'2026-10-23');
  assert.throws(()=>store.save(before.data,before.revision),e=>e.status===409);assert.deepEqual(store.read(),saved);
});

test('Workspace validates source dates and keeps legacy single-date sheets readable',()=>{
  const legacy=initialWorkspace();assert.equal(parseLevels(validateWorkspace(legacy).levelText).instruments.QQQ.sourceDate,'2026-10-23');
  for(const levelSourceDates of [null,[],{QQQ:'2026-02-30'},{QQQ:'2026-10-24'},{QQQ:42},{UNKNOWN:'2026-10-23'}])assert.throws(()=>validateWorkspace({...legacy,levelSourceDates}),e=>e.status===400);
});

test('A newer combined header never makes carried levels eligible for same-session comparisons or Top/Hot',()=>{
  const sheet=parse(mergeLevelSheets(friday,monday)),entry={symbol:'NVDA',group:'STOCKS'},data={status:'ok',quote:{sessionDate:'2026-10-26',price:211.95},bars:[]};
  const state=entryState(entry,sheet,data);assert.equal(state.label,'Dated levels');assert.equal(state.location,null);assert.match(state.reason,/Carried forward.*2026-10-23/);
  const setup=evaluateRetest(sheet.instruments.NVDA,sheet.date,data);assert.equal(setup.stage,'dated');assert.equal(topRetest([setup]),null);
  assert.equal(evaluateRetest(sheet.instruments.QQQ,sheet.date,data).stage,'waiting-break');
});
