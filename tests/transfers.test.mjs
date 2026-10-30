import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openTransfersStore} from '../server/transfers-store.mjs';
import {createNlbConnection,runNlb} from '../server/nlb-connection.mjs';
import {addMoney,normalizeExport,transferSummary,validateReview} from '../src/data/transfers.mjs';
const source={key:'account:fixture',label:'Test account',kind:'account',currency:'MKD'};
const row=(overrides={})=>({date:'2026-10-20',recipient:'Test broker',description:'Test funding',status:'Booked',amount:'-100.10',fee:'0.10',balance:'500.00',...overrides});
function temporary(){const directory=mkdtempSync(join(tmpdir(),'transfers-unit-'));return {directory,remove:()=>rmSync(directory,{recursive:true,force:true})};}
test('exact money, schema, missing values and currencies are preserved',()=>{
 assert.equal(addMoney('0.1','0.2'),'0.3');assert.equal(addMoney('9007199254740993.01','0.09'),'9007199254740993.1');
 const result=normalizeExport([row({amount:null,date:null,fee:null,balance:'0'})],source);assert.equal(result[0].amount,null);assert.equal(result[0].balance,'0');
 assert.throws(()=>normalizeExport([row({date:'2026-02-30'})],source));assert.throws(()=>normalizeExport([row({amount:100})],source));assert.throws(()=>normalizeExport([row()],{...source,currency:''}));assert.throws(()=>normalizeExport([row({surprise:'extra'})],source));
 const card=normalizeExport([{date:'2026-10-20',description:'Test',amount:'-49.00',currency:'USD'}],{...source,kind:'card'});assert.equal(card[0].currency,'USD');assert.equal(card[0].fee,null);assert.equal(card[0].balance,null);
 assert.throws(()=>validateReview({...result[0]}, {platform:'IBKR',activity:'deposit'}));
 assert.throws(()=>validateReview({...normalizeExport([row()],source)[0]}, {platform:'IBKR',activity:'withdrawal'}));
});
test('repeated imports retain identical legitimate purchases and saved reviews; updates and cross-source overlap are reviewed',()=>{
 const temp=temporary(),store=openTransfersStore(temp.directory);
 try{
  store.ingest([{source,rows:[row(),row()]}]);let snapshot=store.read();assert.equal(snapshot.data.rows.length,2);
  store.review(snapshot.data.rows[0].id,{platform:'IBKR',activity:'deposit'},true,snapshot.revision);
  store.ingest([{source,rows:[row(),row()]}]);snapshot=store.read();assert.equal(snapshot.data.rows.length,2);assert.equal(snapshot.data.rows.filter(r=>r.review).length,2);
  assert.equal(transferSummary(snapshot.data.rows)[0].deposit,'200.2');
  store.ingest([{source,rows:[row({status:'Reversed'}),row({status:'Reversed'})]}]);assert.equal(store.read().data.rows.filter(r=>r.review).length,0);
  store.ingest([{source:{...source,key:'account:other'},rows:[row()]}]);assert.equal(store.read().data.rows.find(r=>r.sourceKey==='account:other').review,null);assert.equal(store.read().data.rows.find(r=>r.sourceKey==='account:other').possibleDuplicate,true);
  const before=store.read();assert.throws(()=>store.ingest([{source,rows:[row({description:'Valid new row'})]},{source,rows:[row({amount:'NaN'})]}]));assert.deepEqual(store.read(),before);
  assert.throws(()=>store.review(before.data.rows[0].id,{activity:'exclude'},false,0),{status:409});
 }finally{store.close();temp.remove();}
});
test('totals distinguish costs, funding, withdrawals and currencies, survive restart and exclude unknown rows',()=>{
 const temp=temporary();let store=openTransfersStore(temp.directory);
 try{
  store.ingest([{source,rows:[row(),row({description:'Withdrawal',amount:'40.05'}),row({description:'Unknown',amount:'-300'})]},{source:{...source,key:'card:test',kind:'card'},rows:[{date:'2026-10-20',description:'Evaluation',amount:'-49',currency:'USD'}]}]);
  for(const entry of store.read().data.rows){if(entry.description==='Unknown')continue;const snapshot=store.read();store.review(entry.id,{platform:entry.kind==='card'?'Vanquish':'IBKR',activity:entry.kind==='card'?'cost':entry.amount.startsWith('-')?'deposit':'withdrawal'},false,snapshot.revision);}
  const totals=transferSummary(store.read().data.rows);assert.equal(totals.length,2);assert.equal(totals[0].netContributions,'60.05');assert.equal(totals[1].netContributions,'0');assert.equal(totals[1].netCosts,'49');assert.equal(totals[1].currency,'USD');
  const before=store.read();store.close();store=openTransfersStore(temp.directory);assert.deepEqual(store.read(),before);
 }finally{store.close();temp.remove();}
});
test('NLB bridge exposes only fixed reads, pauses on expiry, preserves data on partial failure and disconnects',async()=>{
 const temp=temporary(),calls=[];let expire=false,broken=false,erased=false;
 const run=async args=>{calls.push(args);if(args.includes('login'))return '';if(expire)throw Object.assign(Error('NLB approval is required.'),{auth:true});if(args.includes('list'))return args.includes('accounts')?'Accounts:\n123-1234567890-12MKD\n':'Cards:\n12345678/1234\n';if(broken&&args.includes('cards'))throw Error('network');return JSON.stringify(args.includes('cards')?[{date:'2026-10-20',description:'Vanquish test',amount:'-49',currency:'USD'}]:[row()]);};
 const service=createNlbConnection(temp.directory,{run,now:()=>new Date('2026-10-30T10:00:00Z'),removeSession:async()=>{erased=true;}});
 try{
  service.login('fixture-user');await service.wait();let state=service.store.read();assert.equal(state.data.sync.state,'connected');assert.equal(state.data.candidates.length,2);
  const sources=state.data.candidates.map(c=>({...c,label:'QA '+c.kind,currency:c.kind==='account'?'MKD':null,since:'2026-10-01'}));service.configure(sources,false,state.revision);service.sync();await service.wait();state=service.store.read();assert.equal(state.data.rows.length,2);assert.ok(state.data.sync.lastSuccess);
  assert.ok(calls.filter(a=>!a.includes('login')).every(a=>a.includes('--non-interactive')));assert.ok(calls.every(a=>!a.includes('payments')));
  const before=state.data.rows;broken=true;service.sync();await service.wait();assert.equal(service.store.read().data.sync.state,'unavailable');assert.deepEqual(service.store.read().data.rows,before);
  expire=true;service.sync();await service.wait();assert.equal(service.store.read().data.sync.state,'approval-required');assert.deepEqual(service.store.read().data.rows,before);
  await service.disconnect();assert.equal(erased,true);assert.equal(service.store.read().data.automatic,false);assert.deepEqual(service.store.read().data.rows,before);
 }finally{await service.close();temp.remove();}
});
test('hourly scheduling is opt-in, retries at most hourly and stops after authentication expires',async()=>{
 const temp=temporary();let clock=new Date('2026-10-30T10:00:00Z'),reads=0,expire=false;
 const run=async args=>{if(args.includes('login'))return '';if(args.includes('list'))return args.includes('accounts')?'123-1234567890-12MKD':'';reads++;if(expire)throw Object.assign(Error('NLB approval is required.'),{auth:true});return '[]';};
 const service=createNlbConnection(temp.directory,{run,now:()=>clock,removeSession:async()=>{}});
 try{
  service.login('fixture');await service.wait();const state=service.store.read();const sources=[{...state.data.candidates[0],label:'QA',currency:'MKD',since:'2026-10-01'}];service.configure(sources,false,state.revision);clock=new Date('2026-10-30T12:00:00Z');service.checkSchedule();assert.equal(reads,0);
  service.configure(sources,true,service.store.read().revision);service.checkSchedule();await service.wait();assert.equal(reads,1);service.checkSchedule();await service.wait();assert.equal(reads,1);
  expire=true;clock=new Date('2026-10-30T14:00:00Z');service.checkSchedule();await service.wait();assert.equal(reads,2);clock=new Date('2026-10-30T18:00:00Z');service.checkSchedule();await service.wait();assert.equal(reads,2);
 }finally{await service.close();temp.remove();}
});
test('changed amounts cannot silently reuse a repeat rule and double-count an amended record',()=>{
 const temp=temporary(),store=openTransfersStore(temp.directory);
 try{store.ingest([{source,rows:[row()]}]);const before=store.read();store.review(before.data.rows[0].id,{platform:'IBKR',activity:'deposit'},true,before.revision);store.ingest([{source,rows:[row({amount:'-110.10'})]}]);let state=store.read();assert.equal(state.data.rows.length,2);assert.equal(state.data.rows.filter(r=>r.review).length,0);assert.ok(state.data.rows.every(r=>r.possibleDuplicate));store.ingest([{source,rows:[row({amount:'-110.10'})]}]);assert.equal(store.read().data.rows.filter(r=>r.review).length,0);}finally{store.close();temp.remove();}
});
test('bank date ranges follow Skopje midnight and cover a long downtime from the last successful read',async()=>{
 const temp=temporary(),calls=[];const service=createNlbConnection(temp.directory,{now:()=>new Date('2026-10-30T23:30:00Z'),run:async args=>{calls.push(args);return '[]';},removeSession:async()=>{}});
 try{service.store.change(data=>({...data,sources:[{...source,id:'123-1234567890-12MKD',since:'2026-01-01',lastRead:'2026-06-01T22:30:00Z'}]}));service.sync();await service.wait();assert.equal(calls[0][calls[0].indexOf('--start')+1],'18.04.2026');assert.equal(calls.at(-1)[calls.at(-1).indexOf('--end')+1],'31.10.2026');}finally{await service.close();temp.remove();}
});
test('pinned CLI and its replacement parser work without contacting a bank',async()=>{
 const temp=temporary();
 try{
  assert.equal((await runNlb(['--version'])).trim(),'0.1.5');
  await assert.rejects(runNlb(['--profile','isolated-test-'+temp.directory.split('/').at(-1),'--non-interactive','accounts','list']),error=>error.auth===true);
  writeFileSync(join(temp.directory,'fixture.toml'),'name = "parser compatibility"\n[bank]\nenabled = false\n');
  const [{Effect,Config},ConfigFile,{NodeContext}]=await Promise.all([import('effect'),import('@effect/cli/ConfigFile'),import('@effect/platform-node')]);
  const value=await Effect.runPromise(Effect.gen(function*(){const provider=yield* ConfigFile.makeProvider('fixture',{searchPaths:[temp.directory],formats:['toml']});return yield* provider.load(Config.string('name'));}).pipe(Effect.provide(NodeContext.layer)));
  assert.equal(value,'parser compatibility');
 }finally{temp.remove();}
});
