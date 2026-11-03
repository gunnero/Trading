import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openAuthStore} from '../server/auth.mjs';
import {createPortfolioService,normalizeTrading212} from '../server/portfolio.mjs';
import {normalizePortfolioSnapshot,portfolioStatus,portfolioTotals} from '../src/data/portfolio.mjs';

const summary={id:12345,currency:'EUR',totalValue:340,cash:{availableToTrade:10,reservedForOrders:20,inPies:10},investments:{currentValue:300,totalCost:320,unrealizedProfitLoss:-20,realizedProfitLoss:45}};
const positions=[{instrument:{ticker:'TEST_US_EQ',name:'Fixture company',currency:'USD',isin:'US1234567890'},quantity:2.12345678,averagePricePaid:180,currentPrice:170,walletImpact:{currency:'EUR',currentValue:300,totalCost:320,unrealizedProfitLoss:-20,fxImpact:3}}];
const snapshot={version:1,currency:'USD',accountValue:1100,cash:100,holdings:[{ticker:'TEST',name:'Fixture',quantity:2.5,value:1000,unrealized:100,cost:900}],sourceLabel:'Isolated screenshot fixture'};
const credentials={apiKey:'fixture-key-12345',apiSecret:'fixture-secret-67890',environment:'live',authorized:true};
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
function fixture(t,fetcher=async url=>json(url.endsWith('/summary')?summary:positions)){
  const directory=mkdtempSync(join(tmpdir(),'opening-bell-portfolio-')),auth=openAuthStore({directory});let time=Date.parse('2026-11-03T15:00:00Z');
  let service=createPortfolioService(auth,directory,{fetcher,now:()=>time});
  t.after(()=>{service.close();auth.close();rmSync(directory,{recursive:true,force:true});});
  service.person({name:'Fixture Person'},0);const personId=service.read().data.people[0].id;
  service.account({personId,platform:'Trading 212',label:'Invest'},1);const id=service.read().data.accounts[0].id;
  return {get service(){return service;},auth,directory,id,personId,advance:(ms=61000)=>time+=ms,revision:()=>service.read().revision,restart(){service.close();service=createPortfolioService(auth,directory,{fetcher,now:()=>time});}};
}
test('snapshots preserve fractional shares, negative returns, missing values and zero without inventing dates',()=>{
 const result=normalizePortfolioSnapshot(snapshot);assert.equal(result.observedAt,null);assert.equal(result.realized,null);assert.equal(result.holdings[0].price,null);assert.equal(result.holdings[0].quantity,2.5);
 assert.equal(normalizePortfolioSnapshot({...snapshot,cash:0}).cash,0);
 for(const value of [NaN,Infinity,'100'])assert.throws(()=>normalizePortfolioSnapshot({...snapshot,accountValue:value}));
 assert.throws(()=>normalizePortfolioSnapshot({...snapshot,holdings:[...snapshot.holdings,...snapshot.holdings]}),/Duplicate/);
 assert.throws(()=>normalizePortfolioSnapshot({...snapshot,observedAt:'tomorrow'}));
 assert.throws(()=>normalizePortfolioSnapshot({...snapshot,holdings:[{...snapshot.holdings[0],quantity:-1}]}));
});
test('broker parser separates instrument prices from wallet values and realized from unrealized returns',()=>{
 const result=normalizeTrading212(summary,positions,'2026-11-03T15:00:00Z');assert.equal(result.currency,'EUR');assert.equal(result.holdings[0].instrumentCurrency,'USD');assert.equal(result.holdings[0].value,300);assert.equal(result.holdings[0].price,170);assert.equal(result.unrealized,-20);assert.equal(result.realized,45);assert.equal(result.cash,40);assert.equal(result.totalReturn,null);assert.equal(result.observedAt,null);
 assert.throws(()=>normalizeTrading212(summary,[{...positions[0],walletImpact:{...positions[0].walletImpact,currency:'GBP'}}]));
 assert.throws(()=>normalizeTrading212(summary,[{...positions[0],quantity:undefined}]));
 assert.throws(()=>normalizeTrading212({...summary,cash:{}},positions));
});
test('people, accounts and snapshots persist without touching the general workspace; revision conflicts are atomic',t=>{
 const f=fixture(t);f.service.importSnapshot(f.id,snapshot,f.revision());const before=f.service.read();assert.throws(()=>f.service.account({personId:f.personId,label:'Changed',platform:'Other'},0,f.id),{status:409});assert.deepEqual(f.service.read(),before);
 assert.throws(()=>f.service.removePerson(f.personId,f.revision()),/accounts first/);f.restart();assert.deepEqual(f.service.read(),before);assert.equal(statSync(join(f.directory,'portfolio.sqlite')).mode&0o777,0o600);
});
test('account connection uses only fixed GET endpoints, encrypts credentials, and does not export them',async t=>{
 const calls=[];const f=fixture(t,async(url,options)=>{calls.push({url,options});return json(url.endsWith('/summary')?summary:positions);});
 await f.service.connect(f.id,credentials,f.revision());assert.equal(calls.length,2);
 for(const call of calls){assert.equal(call.options.method,'GET');assert.equal(call.options.redirect,'error');assert.ok(call.url.startsWith('https://live.trading212.com/api/v0/equity/'));assert.equal(call.options.headers.Authorization,'Basic '+Buffer.from(credentials.apiKey+':'+credentials.apiSecret).toString('base64'));}
 const result=f.service.read();assert.equal(result.data.accounts[0].connected,true);assert.equal(result.data.accounts[0].snapshot.holdings.length,1);
 assert.ok(!JSON.stringify(result).includes(credentials.apiSecret));f.restart();assert.equal(f.service.read().data.accounts[0].connected,true);
 assert.ok(!readFileSync(join(f.directory,'portfolio.sqlite')).includes(Buffer.from(credentials.apiSecret)));
});
test('owner authorization is required and arbitrary broker URLs cannot be supplied',async t=>{
 let calls=0;const f=fixture(t,async()=>{calls++;throw Error('should not fetch');});
 await assert.rejects(()=>f.service.connect(f.id,{...credentials,authorized:false},f.revision()),/authorized/);
 await assert.rejects(()=>f.service.connect(f.id,{...credentials,environment:'https://example.com'},f.revision()),/live or demo/);assert.equal(calls,0);
});
test('partial failures preserve the whole last successful snapshot and persisted backoff suppresses retries',async t=>{
 let broken=false,calls=0;const f=fixture(t,async url=>{calls++;if(broken&&url.endsWith('/positions'))return new Response('private upstream content',{status:429,headers:{'retry-after':'600'}});return json(url.endsWith('/summary')?{...summary,totalValue:broken?999:340}:positions);});
 await f.service.connect(f.id,credentials,f.revision());const old=f.service.read().data.accounts[0].snapshot;f.advance();broken=true;await f.service.sync(f.id);
 const saved=f.service.read().data.accounts[0];assert.deepEqual(saved.snapshot,old);assert.match(saved.error,/request limit/);assert.ok(!saved.error.includes('private'));assert.match(portfolioStatus(saved),/Stale/);
 const before=calls;f.restart();f.advance();await f.service.sync(f.id);assert.equal(calls,before);
});
test('malformed broker responses do not replace a valid snapshot and errors never echo credentials',async t=>{
 let broken=false;const f=fixture(t,async url=>{if(broken)throw Error(credentials.apiSecret);return json(url.endsWith('/summary')?summary:positions);});
 await f.service.connect(f.id,credentials,f.revision());f.advance();broken=true;await f.service.sync(f.id);assert.ok(!JSON.stringify(f.service.read()).includes(credentials.apiSecret));assert.equal(f.service.read().data.accounts[0].snapshot.accountValue,340);
});
test('disconnect during an in-flight read prevents response resurrection',async t=>{
 let release,wait=false;const f=fixture(t,async url=>{if(wait&&url.endsWith('/positions'))await new Promise(resolve=>{release=resolve;});return json(url.endsWith('/summary')?summary:positions);});
 await f.service.connect(f.id,credentials,f.revision());f.advance();wait=true;const pending=f.service.sync(f.id);while(!release)await new Promise(r=>setImmediate(r));
 f.service.disconnect(f.id,f.revision());release();await pending;const saved=f.service.read().data.accounts[0];assert.equal(saved.connected,false);assert.match(portfolioStatus(saved),/Disconnected/);
});
test('removing an account during a connection cannot recreate the account or its credentials',async t=>{
 let release;const f=fixture(t,async url=>{if(url.endsWith('/positions'))await new Promise(resolve=>{release=resolve;});return json(url.endsWith('/summary')?summary:positions);});
 const pending=f.service.connect(f.id,credentials,f.revision());while(!release)await new Promise(r=>setImmediate(r));f.service.removeAccount(f.id,f.revision());release();await assert.rejects(()=>pending,/not found/);assert.equal(f.service.read().data.accounts.length,0);
});
test('duplicate broker accounts cannot be counted twice, and demo/live accounts stay distinct',async t=>{
 const f=fixture(t);await f.service.connect(f.id,credentials,f.revision());
 f.service.account({personId:f.personId,platform:'Trading 212',label:'Second'},f.revision());const id=f.service.read().data.accounts.at(-1).id;
 await assert.rejects(()=>f.service.connect(id,credentials,f.revision()),/already tracked/);f.advance();await f.service.connect(id,{...credentials,environment:'demo'},f.revision());
 assert.equal(portfolioTotals(f.service.read().data.accounts)[0].value,340);
});
test('empty position arrays are valid full snapshots and remove closed holdings',async t=>{
 let empty=false;const f=fixture(t,async url=>json(url.endsWith('/summary')?summary:empty?[]:positions));await f.service.connect(f.id,credentials,f.revision());f.advance();empty=true;await f.service.sync(f.id);assert.deepEqual(f.service.read().data.accounts[0].snapshot.holdings,[]);
});
test('concurrent reads share the account retry window and malformed bodies never replace saved data',async t=>{
 let calls=0,broken=false;const f=fixture(t,async url=>{calls++;return broken?new Response('x'.repeat(2000001),{headers:{'content-type':'application/json'}}):json(url.endsWith('/summary')?summary:positions);});
 await f.service.connect(f.id,credentials,f.revision());f.advance();await Promise.all([f.service.sync(f.id),f.service.sync(f.id),f.service.sync(f.id)]);assert.equal(calls,4);
 f.advance();broken=true;await f.service.sync(f.id);assert.equal(f.service.read().data.accounts[0].snapshot.accountValue,340);assert.match(f.service.read().data.accounts[0].error,/complete account snapshot/);
});
test('manual imports cannot overwrite connected accounts and failed replacements preserve the saved connection',async t=>{
 let id=12345;const f=fixture(t,async url=>json(url.endsWith('/summary')?{...summary,id}:positions));await f.service.connect(f.id,credentials,f.revision());
 assert.throws(()=>f.service.importSnapshot(f.id,snapshot,f.revision()),/Disconnect/);f.advance();id=67890;
 await assert.rejects(()=>f.service.connect(f.id,credentials,f.revision()),/different account/);const saved=f.service.read().data.accounts[0];assert.equal(saved.connected,true);assert.equal(saved.snapshot.brokerId,'12345');
});
test('currency totals never mix USD/EUR or treat a missing account as zero',()=>{
 const totals=portfolioTotals([{snapshot:{currency:'USD',accountValue:100}},{snapshot:{currency:'EUR',accountValue:200}},{snapshot:{currency:'USD',accountValue:null}},{snapshot:null},{environment:'demo',snapshot:{currency:'USD',accountValue:900}}]);
 assert.deepEqual(totals,[{currency:'USD',value:100,known:1,accounts:2},{currency:'EUR',value:200,known:1,accounts:1}]);
});
