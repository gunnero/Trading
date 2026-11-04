import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {activityDateBounds} from '../src/data/portfolio-activity.mjs';
import {createPortfolioActivity,normalizeActivityPage} from '../server/portfolio-activity.mjs';
import {orderView} from '../server/portfolio-trading.mjs';
import {createPortfolioService} from '../server/portfolio.mjs';
import {openAuthStore} from '../server/auth.mjs';

const NOW=Date.parse('2026-11-04T12:00:00Z'),FIRST='/equity/history/orders?limit=50',NEXT='/equity/history/orders?limit=50&cursor=5';
const order=(id=1,status='FILLED',filledQuantity=2)=>({id,status,filledQuantity,quantity:2,side:'SELL',type:'MARKET',currency:'USD',instrument:{ticker:'AMD_US_EQ',name:'Advanced Micro Devices',currency:'USD'},createdAt:'2026-11-03T22:00:00Z'});
const execution=(id=1,overrides={})=>({order:order(),fill:{id,type:'TRADE',filledAt:'2026-11-03T23:30:00Z',quantity:1,price:105,walletImpact:{currency:'EUR',realisedProfitLoss:0,netValue:99,taxes:[{name:'CURRENCY_CONVERSION_FEE',currency:'EUR',quantity:.15},{name:'FINRA_FEE',currency:'USD',quantity:.01}]},...overrides}});
const page=(items,nextPagePath=null)=>({items,nextPagePath});
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());let time=NOW,closed=false;
 const accounts=['a','b'].map((id,i)=>({id,personId:'p'+i,label:'Invest',platform:'Trading 212',environment:i?'demo':'live',snapshot:{source:'api',brokerId:String(i+10)}}));
 const people=[{id:'p0',name:'Person One'},{id:'p1',name:'Person Two'}],credentials=new Map(accounts.map(a=>[a.id,{generation:'g1'}]));
 const calls=[],source={read:async()=>page([execution()])};
 const options={now:()=>time,credential:id=>credentials.get(id),decode:()=>({environment:'demo',apiKey:'fake',apiSecret:'fake'}),account:id=>accounts.find(a=>a.id===id),accounts:()=>({people,accounts}),isClosed:()=>closed,orderView,request:async path=>{calls.push(path);return source.read(path);}};
 let service=createPortfolioActivity(db,options);
 return {db,accounts,credentials,calls,source,get service(){return service;},advance:(ms=61000)=>time+=ms,now:()=>time,restart:()=>service=createPortfolioActivity(db,options),close:()=>closed=true};
}
test('execution data preserves individual fills, missing versus zero, and separate price/fee/P&L currencies',()=>{
 const result=normalizeActivityPage(page([execution(),execution(2,{walletImpact:null}),{order:order(),fill:{type:'STOCK_SPLIT'}}]),NOW,orderView);
 assert.equal(result.fills.length,2);assert.equal(result.fills[0].realized,0);assert.equal(result.fills[0].priceCurrency,'USD');assert.equal(result.fills[0].currency,'EUR');assert.deepEqual(result.fills[0].charges.map(c=>c.currency),['EUR','USD']);assert.equal(result.fills[1].charges,null);assert.equal(result.fills[1].realized,null);
 assert.equal(normalizeActivityPage(page([execution(3,{walletImpact:{currency:'USD',taxes:[]}})]),NOW,orderView).fills[0].charges.length,0);
 for(const item of [execution(1,{id:NaN}),execution(1,{filledAt:'tomorrow'}),execution(1,{quantity:0}),execution(1,{walletImpact:{taxes:[{name:'FEE',quantity:2}]}})])assert.throws(()=>normalizeActivityPage(page([item]),NOW,orderView));
 assert.throws(()=>normalizeActivityPage(page([], 'https://evil.example/steal'),NOW,orderView));
});
test('date filters include the whole local day, DST boundaries and exclude the following midnight',()=>{
 for(const [day,hours] of [['2026-03-29',23],['2026-10-25',25]]){const b=activityDateBounds(day,day);assert.equal(b.to-b.from,hours*3600000);}
 const b=activityDateBounds('2026-11-04','2026-11-04');assert.equal(new Date(b.from).toISOString(),'2026-11-03T23:00:00.000Z');assert.equal(new Date(b.to).toISOString(),'2026-11-04T23:00:00.000Z');
 for(const args of [['2026-02-30',''],['2026-11-05','2026-11-04'],['','','Bad/Zone']])assert.throws(()=>activityDateBounds(...args));
});
test('history imports without old alerts, resumes pagination across restart and deduplicates exact executions',async t=>{
 const f=fixture(t);f.source.read=async path=>path===FIRST?page([execution()],NEXT):page([execution(),execution(2)]);
 await f.service.sync('a');assert.equal(f.service.read().total,1);assert.equal(f.service.read().statuses[0].complete,false);assert.equal(f.service.notifications().unread,0);
 f.restart();await f.service.sync('a');assert.equal(f.calls.length,1);f.advance(31000);await f.service.sync('a');assert.deepEqual(f.calls,[FIRST,NEXT]);assert.equal(f.service.read().total,2);assert.equal(f.service.read().statuses[0].complete,true);
 f.advance();await f.service.sync('a');assert.equal(f.calls.at(-1),FIRST);assert.equal(f.service.read().total,2);f.advance(31000);await f.service.sync('a');assert.equal(f.calls.length,3);assert.equal(f.service.notifications().unread,0);
});
test('new executions and tracked transitions notify once across restart; read marks cannot swallow a newer event',async t=>{
 const f=fixture(t);await f.service.sync('a');f.advance();f.source.read=async()=>page([execution(2,{filledAt:new Date(f.now()).toISOString()})]);await f.service.sync('a');
 // Same order was already terminal in imported history: no duplicate alert.
 assert.equal(f.service.notifications().unread,0);
 const first=orderView(order(2,'NEW',0)),partial=orderView(order(2,'PARTIALLY_FILLED',1)),full=orderView(order(2,'FILLED',2));
 f.service.observe('a','g1',first,null,true);f.service.observe('a','g1',partial,first,true);const through=f.service.notifications().latestId;
 f.restart();f.service.observe('a','g1',partial,first,true);assert.equal(f.service.notifications().unread,1);
 f.service.observe('a','g1',full,partial,true);f.service.markRead({through});assert.equal(f.service.notifications().unread,1);
 const newFill=execution(3,{filledAt:new Date(f.now()).toISOString()});newFill.order=order(3);f.source.read=async()=>page([newFill]);f.advance();await f.service.sync('a');assert.equal(f.service.notifications().unread,2);
 f.service.observe('a','g1',orderView(newFill.order),null,true);assert.equal(f.service.notifications().unread,2);
 assert.throws(()=>f.service.markRead({through:'1'}));
});
test('filters isolate person/account, search escapes SQL wildcards, local execution dates and pagination',async t=>{
 const f=fixture(t);f.source.read=async path=>path===FIRST?page(Array.from({length:50},(_,i)=>execution(i+1)),NEXT):page([execution(51)]);
 await f.service.sync('a');f.advance(31000);await f.service.sync('a');await f.service.sync('b');
 assert.equal(f.service.read({person:'p0'}).total,51);assert.equal(f.service.read({account:'b'}).total,50);assert.equal(f.service.read({person:'p0',account:'b'}).total,0);
 assert.equal(f.service.read({stock:'AMD'}).total,101);assert.equal(f.service.read({stock:'Advanced Micro'}).total,101);assert.equal(f.service.read({stock:'%'}).total,0);
 assert.equal(f.service.read({from:'2026-11-04',to:'2026-11-04'}).total,101);assert.equal(f.service.read({from:'2026-11-03',to:'2026-11-03'}).total,0);
 const first=f.service.read({account:'a'}),last=f.service.read({account:'a',offset:50});assert.equal(first.items.length,50);assert.equal(first.more,true);assert.equal(last.items.length,1);assert.equal(last.more,false);assert.equal(last.items[0].id,1);
 assert.throws(()=>f.service.read({kind:'passwords'}));assert.throws(()=>f.service.read({offset:-1}));assert.throws(()=>f.service.read({from:'nonsense'}));
});
test('late partial observations cannot regress a filled order or create an alert; absent fill quantities retain the known amount',t=>{
 const f=fixture(t),partial=orderView(order(1,'PARTIALLY_FILLED',1)),full=orderView(order(1,'FILLED',undefined));full.filledQuantity=null;
 f.service.observe('a','g1',partial,null,true);f.service.observe('a','g1',full,partial,true);f.service.observe('a','g1',partial,null,true);
 const saved=f.service.read({kind:'orders'}).items[0];assert.equal(saved.status,'FILLED');assert.equal(saved.filledQuantity,1);assert.equal(saved.awaitingHistory,false);assert.equal(f.service.notifications().unread,2);
});
test('history failures retain imported data, enforce persistent backoff, reject cursor loops and malformed batches atomically',async t=>{
 const f=fixture(t);await f.service.sync('a');f.advance();f.source.read=async()=>{throw Object.assign(Error('Denied'),{historyPermission:true});};await f.service.sync('a');assert.match(f.service.read().statuses[0].error,/History: Orders/);f.restart();f.advance();await f.service.sync('a');assert.equal(f.calls.length,2);assert.equal(f.service.read().total,1);
 const b=fixture(t);b.source.read=async()=>page([execution()],FIRST);await b.service.sync('a');assert.equal(b.service.read().total,0);assert.match(b.service.read().statuses[0].error,/repeated/);
 const c=fixture(t);c.source.read=async()=>page([execution(),execution(2,{quantity:0})]);await c.service.sync('a');assert.equal(c.service.read().total,0);
});
test('disconnects stop reads; reconnecting the same broker preserves records; changed identities hide them and deletion purges',async t=>{
 const f=fixture(t);await f.service.sync('a');f.service.observe('a','g1',orderView(order(2)),null,true);f.credentials.delete('a');f.advance();await f.service.sync('a');assert.equal(f.calls.length,1);assert.equal(f.service.read().total,1);assert.equal(f.service.notifications().unread,1);
 f.credentials.set('a',{generation:'g2'});assert.equal(f.service.read().total,1);f.accounts[0].snapshot.brokerId='999';assert.equal(f.service.read().total,0);assert.equal(f.service.notifications().unread,0);f.service.remove('a');assert.equal(f.db.prepare('SELECT count(*) n FROM portfolio_activity_fills').get().n,0);
});
test('late history responses after disconnect or shutdown do not write records',async t=>{
 for(const close of [false,true]){const f=fixture(t);let release;f.source.read=()=>new Promise(r=>release=r);const work=f.service.sync('a');if(close)f.close();else f.credentials.delete('a');release(page([execution()]));await work;assert.equal(f.service.read().total,0);}
});
test('background cycle tracks and refreshes without a browser and continues after disabling trading',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'opening-bell-activity-')),auth=openAuthStore({directory:dir});let at=NOW,status='NEW',fills=0,revision=0;const calls=[];
 const summary=()=>({id:123,currency:'USD',totalValue:1000,cash:{availableToTrade:1000-fills*100,reservedForOrders:0,inPies:0},investments:{currentValue:fills*100,totalCost:fills*95,unrealizedProfitLoss:fills*5,realizedProfitLoss:0}});
 const json=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
 const options={now:()=>at,fetcher:async(url,request)=>{assert.equal(request.method||'GET','GET');calls.push(url);if(url.endsWith('/summary'))return json(summary());if(url.endsWith('/positions'))return json([]);if(url.endsWith('/equity/orders'))return json(status==='FILLED'?[]:[order(1,status,fills)]);if(url.includes('/history/orders'))return json(page(status==='FILLED'?[{...execution(),order:order(1,status,fills)}]:[]));throw Error('Unexpected '+url);}};
 let service=createPortfolioService(auth,dir,options);t.after(()=>{service.close();auth.close();rmSync(dir,{recursive:true,force:true});});service.person({name:'Background fixture'},revision++);service.account({personId:service.read().data.people[0].id,platform:'Trading 212',label:'Invest'},revision++);const id=service.read().data.accounts[0].id;
 await service.connect(id,{environment:'demo',apiKey:'fixture-key-12345',apiSecret:'fixture-secret-67890',authorized:true},revision);service.trading.configure(id,{enabled:true,authorized:true});await service.monitor();assert.equal(service.activity.read({kind:'orders'}).items[0].status,'NEW');
 service.trading.configure(id,{enabled:false});status='PARTIALLY_FILLED';fills=1;at+=61000;await service.monitor();assert.equal(service.activity.notifications().unread,1);assert.equal(service.read().data.accounts[0].snapshot.cash,900);
 service.close();service=createPortfolioService(auth,dir,options);status='FILLED';fills=2;at+=61000;await service.monitor();assert.equal(service.activity.notifications().unread,2);assert.equal(service.read().data.accounts[0].snapshot.cash,800);assert.equal(service.activity.read().total,1);
 service.disconnect(id,service.read().revision);const count=calls.length;at+=61000;await service.monitor();assert.equal(calls.length,count);assert.ok(calls.every(url=>url.startsWith('https://demo.trading212.com/api/v0/')));
});
