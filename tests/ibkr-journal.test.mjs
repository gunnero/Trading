import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {openAuthStore,authMiddleware,authConfig} from '../server/auth.mjs';
import {createIbkrJournal} from '../server/ibkr-journal.mjs';
import {FLEX_BASE,flexInstant,flexXml,parseFlexReport,mergeFills,matchFills} from '../server/ibkr-flex.mjs';
import {validateJournal,tradeResult} from '../src/data/journal.mjs';
import {execution,report,accepted,FLEX_TOKEN,FLEX_CONFIG} from './fixtures/ibkr-flex.mjs';

const parse=(rows,kind='activity')=>parseFlexReport(report(rows,kind),FLEX_CONFIG,kind).fills;
const exit=(overrides={})=>execution({ibExecID:'002.01',ibOrderID:'101',quantity:'-1',buySell:'SELL',openCloseIndicator:'C',dateTime:'20261124;105215',tradePrice:'2.80',ibCommission:'-0.50',...overrides});
function setup(t,fetcher){
  const directory=mkdtempSync(join(tmpdir(),'desk-ibkr-'));let clock=Date.parse('2026-11-24T16:00Z');
  const account=openAuthStore({directory}),options={fetcher:fetcher|| (async url=>new Response(url.includes('SendRequest')?accepted:report())),now:()=>clock,delay:async()=>{}};
  const service=createIbkrJournal(account,options);
  t.after(async()=>{service.close();await service.settled();account.close();rmSync(directory,{recursive:true,force:true});});
  return {service,account,directory,options,advance:()=>clock+=16*60000};
}
test('report timestamps preserve seconds and use the configured report timezone through DST',()=>{
  assert.equal(flexInstant('20261124;104615','America/New_York'),'2026-11-24T15:46:15.000Z');
  assert.equal(flexInstant('20261024;104615','America/New_York'),'2026-10-24T14:46:15.000Z');
  assert.equal(flexInstant('20261027;164615','Europe/Skopje'),'2026-10-27T15:46:15.000Z');
  assert.throws(()=>flexInstant('20261101;013000','America/New_York'),/ambiguous/);
  assert.throws(()=>flexInstant('20260308;023000','America/New_York'),/nonexistent/);
  assert.throws(()=>flexInstant('20261124;1046','UTC'),/seconds/);
});
test('FIFO matches partial exits, accounts/contracts and short options with exact timestamps and allocated fees',()=>{
  const fills=mergeFills([],parse([execution(),exit(),exit({ibExecID:'003.01',quantity:'-2',tradePrice:'2.00',ibCommission:'-1',dateTime:'20261124;110000'})]));
  const result=matchFills(fills);assert.equal(result.journal.trades.length,2);assert.equal(result.unmatched.length,0);
  assert.deepEqual(result.journal.trades.map(t=>t.quantity),[1,2]);assert.deepEqual(result.journal.trades.map(t=>t.fees),[1,2]);
  assert.deepEqual(result.journal.trades.map(t=>tradeResult(t).gross),[46,-68]);validateJournal(result.journal);
  const partial=matchFills(fills.slice(0,2)).journal.trades;assert.equal(partial.find(t=>!t.exitAt).quantity,2);
  const short=matchFills(mergeFills([],parse([execution({buySell:'SELL',quantity:'-3'}),exit({buySell:'BUY',quantity:'3',tradePrice:'1'})]))).journal.trades[0];
  assert.equal(short.position,'short');assert.equal(tradeResult(short).gross,402);
  const missing=matchFills(parse([exit(),exit({conid:'999',ibExecID:'different'})]));assert.equal(missing.journal.trades.length,0);assert.equal(missing.unmatched.length,2);
});
test('execution identity distinguishes identical fills and rejects changed prices while activity fees win',()=>{
  const a=parse([execution(),execution({ibExecID:'001.02'})]);const merged=mergeFills(a,a);assert.equal(merged.length,2);validateJournal(matchFills(merged).journal);
  assert.throws(()=>mergeFills(a,parse([execution({tradePrice:'2.50'})])),/changed/);
  const confirmation=parse([execution({ibCommission:'-2'})],'confirmation');assert.equal(mergeFills(a,confirmation)[0].fees,1.5);
  assert.equal(mergeFills(confirmation,a)[0].fees,1.5);
});
test('incomplete opening history never creates a partial FIFO basis; a later backfill resolves it',()=>{
  const incomplete=mergeFills([],parse([execution(),exit({quantity:'-4'})]));
  assert.equal(matchFills(incomplete).journal.trades.length,0);assert.equal(matchFills(incomplete).unmatched[0].quantity,4);
  const filled=mergeFills(incomplete,parse([execution({ibExecID:'000.01',quantity:'1',dateTime:'20261124;103000'})]));
  assert.equal(matchFills(filled).unmatched.length,0);assert.equal(matchFills(filled).journal.trades.length,2);
});
test('scheduled sync runs without any journal or settings read and stops after disconnect',async t=>{
  let calls=0;const a=setup(t,async url=>{calls++;return new Response(url.includes('SendRequest')?accepted:report());});
  a.service.start(FLEX_CONFIG);await a.service.settled();assert.equal(calls,2);
  a.service.tick();assert.equal(calls,2);a.advance();a.service.tick();await a.service.settled();assert.equal(calls,4);
  a.service.disconnect();a.advance();a.service.tick();assert.equal(calls,4);
});
test('missing fees remain unknown; malformed, unsupported and corrected option reports are not silently imported',()=>{
  assert.equal(parse([execution({ibCommission:undefined})])[0].fees,null);
  assert.equal(parse([execution({ibCommissionCurrency:'EUR'})])[0].fees,null);
  assert.equal(parseFlexReport(report([execution({assetCategory:'STK'})]),FLEX_CONFIG).skipped,1);
  for(const change of [{currency:'EUR'},{ibExecID:undefined},{openCloseIndicator:undefined},{levelOfDetail:'ORDER'},{origTradeID:'42'},{transactionType:'BookTrade'},{quantity:'1.5'},{tradePrice:'NaN'},{dateTime:'bad'},{putCall:'X'},{ibCommission:'1'}])assert.throws(()=>parse([execution(change)]));
  assert.throws(()=>parseFlexReport(report([], 'activity',{accountId:'other'}),FLEX_CONFIG),/account/);
  assert.throws(()=>parseFlexReport(report().replace('count="1"','count="2"'),FLEX_CONFIG),/incomplete/);
  assert.throws(()=>flexXml('<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]><x>&x;</x>'),/XML/);
  assert.throws(()=>flexXml('<broken>'),/XML/);
});
test('Trade Confirmation field aliases and codes normalize to the same activity execution identity',()=>{
  const confirmation=execution({tradePrice:undefined,price:'2.34',ibExecID:undefined,execID:'001.01',ibOrderID:undefined,orderID:'100',openCloseIndicator:undefined,code:'O;P',ibCommission:undefined,commission:'-1.50',ibCommissionCurrency:undefined,commissionCurrency:'USD',taxes:undefined,tax:'0'});
  const fills=parse([confirmation],'confirmation');assert.equal(fills[0].fees,1.5);assert.equal(fills[0].openClose,'O');
  assert.equal(mergeFills(fills,parse([execution()])).length,1);
  for(const code of ['A;C','Ep','Ex;C','Ca;O','Co;O','O;C'])assert.throws(()=>parse([{...confirmation,code}],'confirmation'));
});
test('automatic connection encrypts its token, uses only the fixed endpoint and survives restart/disconnect',async t=>{
  const urls=[],a=setup(t,async(url,options)=>{urls.push(url);assert.equal(options.redirect,'error');assert.ok(options.headers['User-Agent']);return new Response(url.includes('SendRequest')?accepted:report());});
  a.service.start(FLEX_CONFIG);await a.service.settled();assert.equal(a.service.status().configured,true);assert.equal(a.service.read().journal.trades.length,1);
  assert.ok(urls.every(url=>url.startsWith(FLEX_BASE)));assert.equal(JSON.stringify(a.service.read()).includes(FLEX_TOKEN),false);
  a.account.db.exec('PRAGMA wal_checkpoint(FULL)');assert.equal(readFileSync(join(a.directory,'auth.sqlite')).includes(Buffer.from(FLEX_TOKEN)),false);
  assert.throws(()=>a.service.start(),/wait/);
  const restored=createIbkrJournal(a.account,a.options);assert.equal(restored.read().journal.trades.length,1);assert.throws(()=>restored.start(),/wait/);
  a.advance();restored.start();await restored.settled();assert.equal(restored.read().journal.trades.length,1);
  restored.disconnect();assert.equal(restored.status().configured,false);assert.equal(restored.read().journal.trades.length,1);restored.close();
});
test('bad credentials, provider errors, oversized reports and failed replacements preserve trades and conceal upstream secrets',async t=>{
  let mode='ok';const a=setup(t,async url=>{
    if(mode==='network')throw Error(FLEX_TOKEN);
    if(mode==='oversize')return new Response('x'.repeat(8_000_001));
    if(mode==='token')return new Response(`<FlexStatementResponse><Status>Fail</Status><ErrorCode>1012</ErrorCode><ErrorMessage>${FLEX_TOKEN}</ErrorMessage></FlexStatementResponse>`);
    return new Response(url.includes('SendRequest')?accepted:report());
  });
  a.service.start(FLEX_CONFIG);await a.service.settled();const original=a.service.read().journal;
  for(mode of ['network','oversize','token']){a.advance();a.service.start({...FLEX_CONFIG,token:'999999999999'});await a.service.settled();assert.equal(a.service.status().configured,true);assert.deepEqual(a.service.read().journal,original);assert.equal(a.service.status().state,'error');assert.equal(JSON.stringify(a.service.status()).includes(FLEX_TOKEN),false);}
});
test('notes use revision checks and survive sync, partial closure and reconnect',async t=>{
  let rows=[execution()];const a=setup(t,async url=>new Response(url.includes('SendRequest')?accepted:report(rows)));
  a.service.start(FLEX_CONFIG);await a.service.settled();let data=a.service.read(),trade=data.journal.trades[0];
  const input={id:trade.id,revision:data.revision,notes:'Waited for retest',tags:['Followed plan'],review:{break:true},risk:null};
  a.service.saveNote(input);assert.throws(()=>a.service.saveNote(input),/changed/);
  rows.push(exit());a.advance();a.service.start();await a.service.settled();data=a.service.read();assert.equal(data.journal.trades.length,2);assert.ok(data.journal.trades.every(t=>t.notes===input.notes));
  assert.throws(()=>a.service.start({...FLEX_CONFIG,accountId:'UOTHER'}),/wait/);a.advance();assert.throws(()=>a.service.start({...FLEX_CONFIG,accountId:'UOTHER'}),/identity/);
});
test('owner authentication, origin and CSRF gate all connection and note mutations',async t=>{
  const a=setup(t),gate=authMiddleware(a.account),server=createServer((req,res)=>gate(req,res,()=>a.service.middleware(req,res,()=>{res.statusCode=404;res.end();})));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const origin=`http://127.0.0.1:${server.address().port}`,endpoint=origin+'/api/settings/ibkr-journal';
  assert.equal((await fetch(endpoint)).status,401);assert.equal((await fetch(origin+'/api/journal/ibkr')).status,401);
  const session=a.account.newSession(),headers={Cookie:authConfig().cookieName+'='+session.token,Origin:origin,'Content-Type':'application/json','X-Opening-Bell-Client':'web'};
  assert.equal((await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(FLEX_CONFIG)})).status,403);
  headers['X-CSRF-Token']=a.account.csrf(session.row.id);
  assert.equal((await fetch(endpoint,{method:'POST',headers:{...headers,Origin:'https://other.invalid'},body:JSON.stringify(FLEX_CONFIG)})).status,403);
  assert.equal((await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(FLEX_CONFIG)})).status,202);await a.service.settled();
  const result=await(await fetch(origin+'/api/journal/ibkr',{headers})).json();assert.equal(result.journal.trades.length,1);assert.equal(JSON.stringify(result).includes(FLEX_TOKEN),false);
});
