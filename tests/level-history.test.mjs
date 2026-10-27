import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseLevels} from '../src/data/market.js';
import {importLevelList,levelSnapshots,validateLevelHistory,compareLevelInstruments} from '../src/data/level-history.mjs';
import {initialWorkspace,validateWorkspace,openWorkspaceStore} from '../server/workspace.mjs';

test('First import archives the effective previous list, and same-day corrections retain one snapshot per date',()=>{
  const original=initialWorkspace(),backup=structuredClone(original);
  let next=importLevelList(original,'LVLS 2026-10-26\nQQQ|1h|D 705-704');
  assert.deepEqual(original,backup);
  assert.deepEqual(levelSnapshots(original).map(x=>x.date),['2026-10-23']);
  assert.equal(next.levelHistory[0].levelText,original.levelText);
  const monday=structuredClone(next);
  next=importLevelList(next,'LVLS 2026-10-26\nQQQ|1h|D 706-705');
  assert.equal(next.levelHistory.length,1);
  assert.deepEqual(next.levelHistory,monday.levelHistory);
  next=importLevelList(next,'LVLS 2026-10-27\nNQ|30min|S 30100-30000|FUT');
  assert.deepEqual(levelSnapshots(next).map(x=>x.date),['2026-10-27','2026-10-26','2026-10-23']);
  const archived=parseLevels(next.levelHistory[0].levelText,next.levelHistory[0].levelSourceDates);
  assert.equal(archived.instruments.QQQ.zones[0].high,706);
  assert.equal(archived.instruments.NQ.sourceDate,'2026-10-23');
  for(const key of ['plans','preferences','watchText'])assert.deepEqual(next[key],original[key]);
});

test('Rolling five-date retention skips absent days and never expires carried instruments',()=>{
  let value=initialWorkspace();
  for(const date of ['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-11-02'])value=importLevelList(value,`LVLS ${date}\nQQQ|4h|D 706-705`);
  assert.deepEqual(levelSnapshots(value).map(x=>x.date),['2026-11-02','2026-10-30','2026-10-29','2026-10-28','2026-10-27']);
  assert.equal(parseLevels(value.levelText,value.levelSourceDates).instruments.NQ.sourceDate,'2026-10-23');
  assert.throws(()=>importLevelList(value,'LVLS 2026-10-29\nQQQ|4h|D 706-705'),/older/);
  assert.deepEqual(validateWorkspace(value),value);
});

test('History rejects inconsistent dates, unordered/duplicate snapshots and invalid provenance',()=>{
  const next=importLevelList(initialWorkspace(),'LVLS 2026-10-26\nQQQ|4h|D 706-705'),entry=next.levelHistory[0];
  for(const history of [null,{},[entry,entry],Array(5).fill(entry),[{...entry,date:'2026-10-22'}],[{...entry,levelSourceDates:{QQQ:'2026-10-26'}}],[{...entry,levelText:'invalid'}]])assert.throws(()=>validateWorkspace({...next,levelHistory:history}));
  assert.throws(()=>validateLevelHistory([entry],'2026-10-23'));
  assert.throws(()=>validateWorkspace({...next,levelHistory:[{...entry,levelText:'x'.repeat(200001)}]}));
  assert.equal(Object.hasOwn(validateWorkspace(initialWorkspace()),'levelHistory'),false);
});

test('Comparison identifies actual zone/role/timeframe changes separately from re-issued dates',()=>{
  const old=parseLevels('LVLS 2026-10-23\nQQQ|4h|S 710-709|D 700-699').instruments.QQQ;
  const unchanged=parseLevels('LVLS 2026-10-26\nQQQ|4h|D 699-700|S 709-710').instruments.QQQ;
  assert.equal(compareLevelInstruments(unchanged,old).status,'unchanged');
  const changed=parseLevels('LVLS 2026-10-26\nQQQ|1h|D 710-709|D 700-699').instruments.QQQ;
  const diff=compareLevelInstruments(changed,old);
  assert.equal(diff.status,'changed');assert.equal(diff.metadataChanged,true);
  assert.deepEqual(diff.added,[{type:'D',low:709,high:710}]);assert.deepEqual(diff.removed,[{type:'S',low:709,high:710}]);
  assert.equal(compareLevelInstruments(changed,undefined).status,'added');
  assert.equal(compareLevelInstruments(undefined,old).status,'removed');
  assert.equal(compareLevelInstruments({...old,timeframe:'Daily'},old).status,'changed');
});

test('History persists atomically with current levels across restart and revision conflicts',t=>{
  const directory=mkdtempSync(join(tmpdir(),'opening-bell-history-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  let store=openWorkspaceStore({directory}),first=store.read();
  const saved=store.save(importLevelList(first.data,'LVLS 2026-10-26\nQQQ|1h|D 705-704'),first.revision);
  assert.throws(()=>store.save(importLevelList(first.data,'LVLS 2026-10-27\nQQQ|1h|D 706-705'),first.revision),e=>e.status===409);
  store.close();store=openWorkspaceStore({directory});assert.deepEqual(store.read(),saved);store.close();
});
