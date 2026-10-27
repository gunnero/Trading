import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {emptyJournal,validateTrade,validateJournal,localToInstant,localStamp,parseJournalImport,planJournalImport,tradeResult,journalStats} from '../src/data/journal.mjs';
import {initialWorkspace,openWorkspaceStore} from '../server/workspace.mjs';
import {journalDraftsMiddleware} from '../server/journal-drafts.mjs';
import {fixture,screenshotFixtures} from './fixtures/journal.mjs';
test('Three screenshot round trips reconcile to 307 gross, preserve unknown fees and unreviewed conditions',()=>{
 const rows=screenshotFixtures(),stats=journalStats(rows);assert.deepEqual(rows.map(t=>tradeResult(t).gross),[54,188,65]);assert.deepEqual(rows.map(t=>tradeResult(t).seconds),[168,640,93]);assert.equal(stats.gross,307);assert.equal(stats.net,null);assert.equal(stats.missingFees,3);assert.equal(stats.winRate,100);assert.equal(stats.profitFactor,null);assert.deepEqual(Object.values(rows[0].review),[null,null,null,null]);assert.equal(rows[0].risk,null);assert.equal(stats.series[0].cumulative,307);
});
test('Net uses explicit fees only; gross statistics exclude opens and keep zero/losses; R needs supplied risk',()=>{
 const a=fixture({fees:4,risk:30}),b=fixture({id:'loss',entryPrice:2.96,exitPrice:2.42,fees:0}),c=fixture({id:'flat',exitPrice:2.42,fees:0}),d=fixture({id:'open',exitPrice:null,exitAt:null});
 assert.equal(tradeResult(a).net,50);assert.equal(tradeResult(a).r,1.8);assert.equal(tradeResult(d).gross,null);const stats=journalStats([a,b,c,d]);assert.equal(stats.gross,0);assert.equal(stats.net,-4);assert.equal(stats.profitFactor,1);assert.equal(stats.closed,3);assert.equal(stats.open,1);assert.equal(stats.breakeven,1);assert.ok(Math.abs(stats.winRate-100/3)<1e-10);
 assert.equal(tradeResult(fixture({position:'short',entryPrice:2.96,exitPrice:2.42})).gross,54);assert.equal(tradeResult(fixture({position:'short'})).returnPct,null);
});
test('Skopje conversion follows DST, preserves seconds and rejects nonexistent or ambiguous wall times',()=>{
 assert.equal(localToInstant('2026-10-26T16:19:54'),'2026-10-26T15:19:54.000Z');assert.equal(localToInstant('2026-10-23T16:19:54'),'2026-10-23T14:19:54.000Z');assert.equal(localStamp('2026-10-26T23:30:00Z'),'2026-10-27T00:30:00');assert.throws(()=>localToInstant('2026-03-29T02:30'));assert.throws(()=>localToInstant('2026-10-25T02:30'));assert.throws(()=>localToInstant('2026-02-30T12:00'));
});
test('Duplicate imports are skipped by actual execution identity; conflicting IDs and duplicate persisted trades fail',()=>{
 const a=fixture(),copy={...a,id:'other',fees:10};assert.deepEqual(planJournalImport([a],[copy]),{added:[],duplicates:1});assert.equal(planJournalImport([],[a,copy]).added.length,1);assert.equal(planJournalImport([a],[{...a,id:'account-two',account:'Other'}]).added.length,1);assert.throws(()=>planJournalImport([a],[{...a,quantity:2}]),/different values/);assert.throws(()=>validateJournal({version:1,trades:[a,copy]}),/already/);const identified={...a,entryOrderId:'buy-1',exitOrderId:'sell-1'},separate={...identified,id:'separate',entryOrderId:'buy-2',exitOrderId:'sell-2'};assert.equal(planJournalImport([identified],[separate]).added.length,1);assert.throws(()=>planJournalImport([a],[{...identified,id:'identified'}]),/order IDs/);
});
test('Invalid contracts, quantities, timestamps, close pairs and financial fields fail without coercion',()=>{
 for(const patch of [{quantity:1.5},{quantity:'1'},{entryPrice:NaN},{entryPrice:1.123456},{fees:-1},{risk:0},{exitAt:null},{exitAt:'2026-10-26T14:00:00Z'},{entryAt:'2026-10-26T16:19:54'},{expiration:'2026-10-25'},{expiration:'2026-02-30'},{review:{break:'true'}},{optionType:'spread'},{multiplier:0},{symbol:'<script>'}])assert.throws(()=>fixture(patch));
 assert.equal(fixture({exitPrice:0}).exitPrice,0);assert.equal(fixture({notes:'<script>plain text</script>'}).notes,'<script>plain text</script>');
});
test('Reviewed imports enforce USD, bounded count, explicit schema and independent source metadata',()=>{
 const packet={format:'opening-bell-journal-v1',currency:'USD',label:'Reviewed fixture',trades:screenshotFixtures()};assert.equal(parseJournalImport(JSON.stringify(packet)).trades.length,3);assert.throws(()=>parseJournalImport(JSON.stringify({...packet,currency:'EUR'})),/USD/);assert.throws(()=>parseJournalImport(JSON.stringify({...packet,trades:[]})));assert.throws(()=>parseJournalImport('invalid'));
});
test('Journal saves survive restart and revision conflicts while existing workspace fields remain intact',t=>{
 const directory=mkdtempSync(join(tmpdir(),'journal-test-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));let store=openWorkspaceStore({directory}),before=store.read();const saved=store.save({...before.data,journal:{version:1,trades:screenshotFixtures()}},before.revision);assert.equal(saved.data.levelText,before.data.levelText);assert.deepEqual(saved.data.plans,before.data.plans);assert.throws(()=>store.save({...before.data,journal:emptyJournal()},before.revision),e=>e.status===409);store.close();store=openWorkspaceStore({directory});assert.deepEqual(store.read(),saved);store.close();
});
test('Private draft staging reads bounded valid files, ignores symlinks and never saves workspace data',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'journal-drafts-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));mkdirSync(join(directory,'journal-drafts'));const raw=JSON.stringify({format:'opening-bell-journal-v1',currency:'USD',label:'Fixture',trades:[fixture()]});writeFileSync(join(directory,'journal-drafts','valid.json'),raw);writeFileSync(join(directory,'journal-drafts','invalid.json'),'invalid');symlinkSync(join(directory,'journal-drafts','valid.json'),join(directory,'journal-drafts','link.json'));
 const middleware=journalDraftsMiddleware(directory),server=createServer((req,res)=>middleware(req,res,()=>{res.writeHead(404);res.end();}));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const url=`http://127.0.0.1:${server.address().port}/api/journal/drafts`,r=await fetch(url),data=await r.json();assert.equal(data.drafts.length,1);assert.equal(data.drafts[0].id,'valid');assert.equal(r.headers.get('cache-control'),'no-store');assert.ok(data.message);assert.equal((await fetch(url,{method:'POST'})).status,405);
});
