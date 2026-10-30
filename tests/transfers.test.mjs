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
 const run=async args=>{calls.push(args);if(args.includes('login'))return '';if(expire)throw Object.assign(Error('NLB approval is required.'),{auth:true});if(args.includes('list'))return args.includes('accounts')?'Accounts:\n123-1234567890-12MKD\n':'Cards:\n12345678/1234\n';if(broken&&args.includes('cards'))throw Error('network');return args.includes('cards')?'20.10.2026\t21.10.2026\tVanquish test\t-49,00 USD\t-2.700,00 MKD\t1.000,00 MKD':JSON.stringify([row()]);};
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
test('three currency accounts and multiple cards save together; source cap is explicit and atomic',async()=>{
 const temp=temporary(),service=createNlbConnection(temp.directory,{run:async()=>{throw Error('No bank calls permitted');},removeSession:async()=>{}});
 try{
  const sources=Array.from({length:7},(_,i)=>({kind:i<3?'account':'card',id:'fictional-source-'+i,label:'QA source '+i,currency:i<3?['MKD','EUR','USD'][i]:null,since:'2026-10-01'}));
  service.store.change(data=>({...data,candidates:sources}));service.configure(sources.slice(0,5),false,service.store.read().revision);assert.equal(service.store.read().data.sources.length,5);
  service.configure(sources.slice(0,6),false,service.store.read().revision);const saved=service.store.read();assert.equal(saved.data.sources.length,6);
  assert.throws(()=>service.configure(sources,false,saved.revision),/between 1 and 6/);assert.deepEqual(service.store.read(),saved);
 }finally{await service.close();temp.remove();}
});
test('Vanquish Opis matches changing prefixes across three cards and ignores unrelated activity',async()=>{
 const {descriptionPlatform,tradingRows}=await import('../src/data/transfers.mjs');
 const temp=temporary(),store=openTransfersStore(temp.directory);
 try{
  const cards=Array.from({length:3},(_,i)=>({...source,kind:'card',key:'card:fixture-'+i}));
  store.ingest(cards.map((source,i)=>({source,rows:[{date:'2026-10-20',description:`REF-${i} ${i===1?'vanquish   trader':'VANQUISH TRADER'}`,amount:'-49',currency:'USD'},{date:'2026-10-20',description:'Unrelated shop',amount:'-20',currency:'USD'}]})));
  const selected=tradingRows(store.read().data.rows);assert.equal(selected.length,3);assert.ok(selected.every(row=>row.review?.activity==='cost'&&row.review.automatic));assert.equal(transferSummary(selected)[0].netCosts,'147');
  const excluded=selected[0];store.review(excluded.id,{platform:'Vanquish',activity:'exclude'},false,store.read().revision);
  assert.equal(tradingRows(store.read().data.rows).find(row=>row.id===excluded.id).review.activity,'exclude');
  assert.equal(descriptionPlatform({description:'VANQUISH TRADERX'}),'');assert.equal(descriptionPlatform({recipient:'VANQUISH TRADER',description:'Unrelated'}),'');assert.equal(descriptionPlatform({description:'Interactive Brokers'}),'');
  store.ingest([{source:cards[0],rows:[{date:'2026-10-21',description:'REF-REFUND VANQUISH TRADER',amount:'49',currency:'USD'}]}]);assert.equal(tradingRows(store.read().data.rows).find(row=>row.amount==='49').review,null);
  assert.equal(tradingRows([{kind:'card',date:'2026-10-20',amount:'-49',currency:'USD',description:'OLD-REF VANQUISH TRADER',review:null}])[0].review.activity,'cost');
 }finally{store.close();temp.remove();}
});

test('Vanquish account charges count automatically while exclusions and ambiguous records remain protected',async()=>{
 const {tradingRows}=await import('../src/data/transfers.mjs');
 const row={id:'fixture',kind:'account',date:'2026-10-26',description:'REF VANQUISH TRADER',amount:'-2155',currency:'MKD',fee:'0',review:null};
 assert.equal(tradingRows([row])[0].review.activity,'cost');
 assert.equal(transferSummary(tradingRows([row]))[0].netCosts,'2155');
 for(const extra of [{possibleDuplicate:true},{possibleChange:true},{amount:null},{currency:null},{amount:'49'}])assert.equal(tradingRows([{...row,...extra}])[0].review,null);
 assert.equal(tradingRows([{...row,review:{platform:'',activity:'exclude'}}])[0].review.activity,'exclude');
});

test('installment purchases count once without merging separate or ambiguous purchases',async()=>{
 const {groupInstallments}=await import('../src/data/transfers.mjs');
 const row={kind:'card',sourceKey:'card:fixture',date:'2026-09-14',description:'MIAMI VANQUISH TRADER 2/6',amount:'-59.4',currency:'USD',fee:null,review:{platform:'Vanquish',activity:'cost'}};
 const rows=[{...row,id:'a'},{...row,id:'b',description:'MIAMI VANQUISH TRADER 3/6'}];
 const before=JSON.stringify(rows),groups=groupInstallments(rows);assert.equal(groups.length,1);assert.equal(groups[0].amount,'-59.4');assert.equal(groups[0].rawAmount,'-118.8');assert.equal(groups[0].children.length,2);assert.equal(groups[0].installmentCount,6);assert.equal(JSON.stringify(rows),before);
 assert.equal(transferSummary(rows)[0].netCosts,'59.4');assert.equal(transferSummary(rows)[0].count,1);
 assert.equal(transferSummary([rows[0],{...rows[1],review:{platform:'',activity:'exclude'}}])[0].netCosts,'59.4');
 for(const extra of [{sourceKey:'card:other'},{date:'2026-08-20'},{amount:'-79.2'},{currency:'EUR'},{description:'MIAMI VANQUISH TRADER 3/12'},{description:'MIAMI VANQUISH TRADER 2/6'}])assert.equal(groupInstallments([rows[0],{...rows[1],...extra}]).length,2);
 assert.equal(groupInstallments([rows[0]])[0].children,undefined);
});
test('scan checkpoints survive failure and restart, resume across sources, and commit all occurrences once',async()=>{
 const temp=temporary(),calls=[];let failRead=true;
 const sources=[{...source,id:'fixture-a',since:'2026-08-01'},{...source,key:'account:b',id:'fixture-b',since:'2026-10-01'}];
 const run=async args=>{const start=args[args.indexOf('--start')+1];calls.push([args[args.indexOf('transactions')+1],start]);if(start==='31.08.2026'&&failRead)throw Error('network');return JSON.stringify([row()]);};
 let service=createNlbConnection(temp.directory,{run,now:()=>new Date('2026-10-30T10:00:00Z')});
 try{
  service.store.change(data=>({...data,sources}));service.sync();await service.wait();let saved=service.store.read().data;
  assert.equal(saved.sync.state,'unavailable');assert.equal(saved.scan.next,'2026-08-31');assert.equal(saved.scan.batches[0].rows.length,1);assert.equal(saved.rows.length,0);
  await service.close();failRead=false;calls.length=0;service=createNlbConnection(temp.directory,{run,now:()=>new Date('2026-10-30T11:00:00Z')});service.sync();await service.wait();saved=service.store.read().data;
  assert.equal(calls[0][1],'31.08.2026');assert.ok(!calls.some(call=>call[1]==='01.08.2026'));assert.equal(saved.scan,null);assert.equal(saved.sync.state,'connected');
  // Four account-a windows and one account-b window: repeated original dates across booking windows retain occurrences.
  assert.equal(saved.rows.length,5);assert.ok(saved.sync.lastSuccess);
 }finally{await service.close();temp.remove();}
});
test('invalid scan sections never advance checkpoints; history changes invalidate saved scan cursors',async()=>{
 const temp=temporary();let reads=0;
 const service=createNlbConnection(temp.directory,{run:async()=>++reads===1?'[]':'[{"unexpected":true}]',now:()=>new Date('2026-10-30T10:00:00Z')});
 try{
  const configured={...source,id:'fixture',since:'2026-08-01'};service.store.change(data=>({...data,sources:[configured],candidates:[configured]}));service.sync();await service.wait();
  let state=service.store.read();assert.equal(state.data.scan.next,'2026-08-31');assert.equal(state.data.scan.batches[0].rows.length,0);assert.equal(state.data.rows.length,0);
  service.configure([{...configured,label:'New label'}],false,state.revision);assert.ok(service.store.read().data.scan);
  service.configure([{...configured,since:'2026-04-24'}],false,service.store.read().revision);assert.equal(service.store.read().data.scan,null);
 }finally{await service.close();temp.remove();}
});

test('full bank card table preserves actual domestic charges and excludes account settlement duplication',async()=>{
 const {parseNlbCardTable}=await import('../server/nlb-card-export.mjs');const {tradingRows,bankMkdCoverage}=await import('../src/data/transfers.mjs');
 const rows=parseNlbCardTable('20.10.2026\t21.10.2026\tVANQUISH TRADER\t-49,00 USD\t-2.700,25 MKD\t9.007.199.254.740.993,01 MKD\n');
 assert.equal(rows[0].settlementAmount,'-2700.25');assert.equal(rows[0].bookingDate,'2026-10-21');assert.equal(rows[0].amount,'-49');
 assert.throws(()=>parseNlbCardTable('20.10.2026\tBad\tVANQUISH TRADER\t-49 USD\t-2700 MKD\t0 MKD'));
 assert.throws(()=>parseNlbCardTable('20.10.2026\t21.10.2026\tVANQUISH TRADER\t-49 USD\t2700 MKD\t0 MKD'));
 const temp=temporary(),store=openTransfersStore(temp.directory);try{
  const card={...source,kind:'card',key:'card:test'};store.ingest([{source:card,rows}]);let before=store.read();
  const {settlementAmount,bookingDate,...legacy}=rows[0];store.ingest([{source:card,rows:[legacy]}]);assert.equal(store.read().data.rows.length,1);assert.equal(store.read().data.rows[0].settlementAmount,'-2700.25');
  const selected=tradingRows([...store.read().data.rows,{...before.data.rows[0],id:'account',kind:'account',currency:'MKD',amount:'-2700.25'}]);
  assert.deepEqual(bankMkdCoverage(selected),{amount:'2700.25',known:1,total:1,fullAmount:'2700.25',remaining:'0',remainingCount:0,calculated:false});
 }finally{store.close();temp.remove();}
});
test('old card imports backfill domestic amounts once then use the regular overlap',async()=>{
 const temp=temporary(),calls=[];const card={...source,kind:'card',key:'card:test',id:'test',since:'2026-08-01',lastRead:'2026-10-29T00:00:00Z'};
 const service=createNlbConnection(temp.directory,{run:async args=>{calls.push(args);return '';},now:()=>new Date('2026-10-30T10:00:00Z')});
 try{service.store.change(data=>({...data,sources:[card]}));service.sync();await service.wait();assert.equal(calls[0][calls[0].indexOf('--start')+1],'01.08.2026');assert.ok(calls.every(args=>args.at(-1)==='tab'));assert.equal(service.store.read().data.sources[0].cardFormat,2);calls.length=0;service.sync();await service.wait();assert.equal(calls[0][calls[0].indexOf('--start')+1],'15.09.2026');}finally{await service.close();temp.remove();}
});

test('full MKD cost includes unbooked equal installments without counting the purchase twice',async()=>{
 const {bankMkdCoverage}=await import('../src/data/transfers.mjs');
 const row={kind:'card',sourceKey:'card:fixture',date:'2026-10-01',description:'VANQUISH TRADER 1/6',amount:'-100',currency:'USD',settlementAmount:'-918',review:{platform:'Vanquish',activity:'cost'}};
 const result=bankMkdCoverage([row]);assert.equal(result.amount,'918');assert.equal(result.fullAmount,'5508');assert.equal(result.remaining,'4590');assert.equal(result.remainingCount,5);assert.equal(result.calculated,true);
 const second={...row,description:'VANQUISH TRADER 2/6'};const next=bankMkdCoverage([row,second]);assert.equal(next.fullAmount,'5508');assert.equal(next.amount,'1836');assert.equal(next.remaining,'3672');
 assert.equal(bankMkdCoverage([row,{...second,settlementAmount:'-919'}]).fullAmount,'5513');
 for(const other of [{...second,settlementAmount:null},row])assert.equal(bankMkdCoverage([row,other]).fullAmount,null);
 const complete=bankMkdCoverage(Array.from({length:6},(_,i)=>({...row,description:`VANQUISH TRADER ${i+1}/6`,settlementAmount:i===5?'-919':'-918'})));assert.equal(complete.fullAmount,'5509');assert.equal(complete.remaining,'0');assert.equal(complete.calculated,false);
});
