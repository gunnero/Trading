import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DEFAULT_DISPLAY_TIME,createDisplayTime,validateDisplayTime,timeZones} from '../src/data/display-time.mjs';
import {marketSession,tradingDay} from '../src/data/market-session.mjs';
import {localStamp,localToInstant} from '../src/data/journal.mjs';
import {openWorkspaceStore,initialWorkspace,validateWorkspace} from '../server/workspace.mjs';

test('Old workspaces retain Skopje 24h; invalid display preferences cannot be saved',()=>{
 assert.equal(validateWorkspace(initialWorkspace()).displayTime,undefined);
 assert.deepEqual(createDisplayTime().settings,DEFAULT_DISPLAY_TIME);
 assert.ok(timeZones().includes('Europe/Skopje'));assert.ok(timeZones().includes('UTC'));
 for(const value of [null,[],{}, {timeZone:'Mars/Olympus',hourCycle:'h23'}, {timeZone:'UTC',hourCycle:'h24'}, {timeZone:'UTC',hourCycle:12}, {timeZone:55,hourCycle:'h12'}]){
  assert.throws(()=>validateDisplayTime(value));
  assert.throws(()=>validateWorkspace({...initialWorkspace(),displayTime:value}),e=>e.status===400);
 }
 assert.deepEqual(validateDisplayTime({timeZone:'Asia/Kathmandu',hourCycle:'h12',market:'UK'}),{timeZone:'Asia/Kathmandu',hourCycle:'h12'});
});
test('Display settings survive database reopen, preserving other saved data and revision checks',()=>{
 const directory=mkdtempSync(join(tmpdir(),'opening-bell-display-'));let store;
 try{store=openWorkspaceStore({directory});const before=store.read(),displayTime={timeZone:'America/New_York',hourCycle:'h12'};
  const saved=store.save({...before.data,displayTime},before.revision);store.close();store=openWorkspaceStore({directory});assert.deepEqual(store.read(),saved);
  const {displayTime:actual,...rest}=saved.data;assert.deepEqual(actual,displayTime);assert.deepEqual(rest,before.data);
  assert.throws(()=>store.save({...before.data,displayTime},before.revision),e=>e.status===409);
 }finally{store?.close();rmSync(directory,{recursive:true,force:true});}
});
test('12h covers noon and midnight; 24h never formats midnight as 24:00',()=>{
 const twelve=createDisplayTime({timeZone:'UTC',hourCycle:'h12'}),twentyFour=createDisplayTime({timeZone:'UTC',hourCycle:'h23'});
 assert.equal(twelve.clockTime('2026-10-29T00:00Z'),'12:00 AM');assert.equal(twelve.clockTime('2026-10-29T12:00Z'),'12:00 PM');
 assert.equal(twelve.clockTime('2026-10-29T16:30:05Z',true),'04:30:05 PM');assert.equal(twentyFour.clockTime('2026-10-29T00:00Z'),'00:00');
});
test('Display conversion handles independent European/U.S. DST and fractional offsets',()=>{
 const skopje=createDisplayTime(),ny=createDisplayTime({timeZone:'America/New_York',hourCycle:'h23'}),nepal=createDisplayTime({timeZone:'Asia/Kathmandu',hourCycle:'h23'});
 assert.equal(skopje.clockTime(tradingDay('2026-10-23').open),'15:30');
 assert.equal(skopje.clockTime(tradingDay('2026-10-26').open),'14:30');
 assert.equal(skopje.clockTime(tradingDay('2026-11-02').open),'15:30');
 assert.equal(ny.clockTime(tradingDay('2026-11-02').open),'09:30');
 assert.equal(nepal.journalStamp('2026-10-29T20:00:05Z'),'2026-10-30 · 01:45:05');
 const tokyo=createDisplayTime({timeZone:'Asia/Tokyo',hourCycle:'h23'});
 assert.equal(tokyo.clockRange('2026-10-29T13:30Z','2026-10-29T20:00Z'),'22:30–05:00 (+1 day)');
});
test('Timed events change day in the selected zone; date-only events and Treasury observations retain their dates',()=>{
 for(const zone of ['Pacific/Kiritimati','Pacific/Pago_Pago']){
  const f=createDisplayTime({timeZone:zone,hourCycle:'h12'});
  assert.equal(f.eventDisplayDate({calendarDate:'2026-10-29'}),'Oct 29');
  assert.equal(f.quoteStamp({sessionDate:'2026-10-29'}),'2026-10-29 · daily');
 }
 const f=createDisplayTime({timeZone:'Asia/Tokyo',hourCycle:'h12'});
 assert.equal(f.eventDisplayDate({date:'2026-10-29T20:00Z'}),'Oct 30');
 assert.match(f.windowReference({date:'2026-10-29',window:'after'}),/Oct 30.*05:00 AM.*Tokyo/);
});
test('Time display changes cannot alter exchange status, broker-input instants or strategy boundaries',()=>{
 const now='2026-10-29T20:00Z',session=marketSession(now),tradeAt=localToInstant('2026-10-27T16:12:23');
 for(const timeZone of ['UTC','America/New_York','Europe/Skopje','Asia/Tokyo']){
  const f=createDisplayTime({timeZone,hourCycle:'h12'});f.clockStamp(now);f.journalStamp(tradeAt);
  assert.deepEqual(marketSession(now),session);assert.equal(localStamp(tradeAt),'2026-10-27T16:12:23');
 }
});
