import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openAuthStore} from '../server/auth.mjs';
import {createPortfolioService} from '../server/portfolio.mjs';
import {orderHistoryPath,normalizeOrderHistory} from '../server/portfolio-history.mjs';
import {portfolioRangeStart,sampledPerformance,realizedPerformance} from '../src/data/portfolio-history.mjs';
import {portfolioListing,portfolioHoldingLabel} from '../src/data/portfolio-listings.mjs';

const NOW=Date.parse('2026-11-03T16:00Z');
const fill=(id,pnl,at='2026-11-03T15:00Z',currency='USD')=>({order:{side:'SELL',status:'FILLED',ticker:'TEST_US_EQ'},fill:{id,filledAt:at,quantity:1,type:'TRADE',walletImpact:{currency,realisedProfitLoss:pnl}}});
const summary={id:12345,currency:'USD',totalValue:1100,cash:{availableToTrade:100,reservedForOrders:0,inPies:0},investments:{currentValue:1000,totalCost:900,unrealizedProfitLoss:100,realizedProfitLoss:50}};
const credentials={apiKey:'fixture-key-12345',apiSecret:'fixture-secret-67890',environment:'live',authorized:true};
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
function fixture(t,fetcher,options={}){
 const directory=mkdtempSync(join(tmpdir(),'opening-bell-history-')),auth=openAuthStore({directory});let time=NOW;
 const calls=[];const request=async(url,options)=>{calls.push({url,options});return url.includes('/history/')?fetcher(url,options):json(url.endsWith('/summary')?summary:[]);};
 let service=createPortfolioService(auth,directory,{fetcher:request,now:()=>time,...options});
 service.person({name:'History Fixture'},0);service.account({personId:service.read().data.people[0].id,platform:'Trading 212',label:'Invest'},1);const id=service.read().data.accounts[0].id;
 t.after(()=>{service.close();auth.close();rmSync(directory,{recursive:true,force:true});});
 return {get service(){return service;},id,calls,connect:()=>service.connect(id,credentials,service.read().revision),advance:ms=>time+=ms,restart(){service.close();service=createPortfolioService(auth,directory,{fetcher:request,now:()=>time,...options});}};
}
test('SoFi uses its company name and current ticker while preserving the broker identity',()=>{
 const row={ticker:'IPOE_US_EQ',name:'SoFi Technologies',isin:'US83406F1021',instrumentCurrency:'USD'};
 assert.equal(portfolioListing(row).id,'NASDAQ:SOFI');assert.deepEqual(portfolioHoldingLabel(row),{name:'SoFi Technologies',symbol:'SOFI',brokerId:'IPOE_US_EQ'});
 assert.equal(portfolioListing({...row,isin:'US0000000000'}),null);
 assert.equal(portfolioHoldingLabel({name:'Unmapped Company',ticker:'ODD_US_EQ',instrumentCurrency:'USD'}).symbol,null);
});
test('rolling periods handle month ends, leap years and exact elapsed day/week windows',()=>{
 assert.equal(new Date(portfolioRangeStart('1M',Date.parse('2024-03-31T15:30Z'))).toISOString(),'2024-02-29T15:30:00.000Z');
 assert.equal(new Date(portfolioRangeStart('1Y',Date.parse('2024-02-29T15:30Z'))).toISOString(),'2023-02-28T15:30:00.000Z');
 assert.equal(portfolioRangeStart('1D',NOW),NOW-86400000);assert.equal(portfolioRangeStart('1W',NOW),NOW-7*86400000);assert.throws(()=>portfolioRangeStart('ALL',NOW));
});
test('open plus sold periods use P/L deltas, do not count deposits, and expose partial/missing baselines',()=>{
 const from=NOW-86400000,rows=[{at:from-60000,pnl:100},{at:NOW-3600000,pnl:130},{at:NOW,pnl:120}];
 const p=sampledPerformance(rows,'1D',NOW);assert.equal(p.amount,20);assert.equal(p.coverage,'sampled');assert.equal(p.points.at(-1).value,20);
 assert.equal(sampledPerformance(rows,'MAX',NOW).amount,120);
 assert.equal(sampledPerformance(rows.slice(1),'1D',NOW).coverage,'partial');assert.equal(sampledPerformance(rows.slice(1),'1D',NOW).amount,-10);
 assert.equal(sampledPerformance(rows.slice(-1),'1D',NOW).amount,null);
 assert.equal(sampledPerformance([],'MAX',NOW).amount,null);
 assert.equal(sampledPerformance([{at:from-3*86400000,pnl:10},...rows.slice(1)],'1D',NOW).coverage,'partial');
});
test('realized period sums retain negative/zero values, exact boundaries and missing results',()=>{
 const rows=[{at:NOW-86400000-1,pnl:999},{at:NOW-86400000,pnl:10},{at:NOW-10,pnl:-12},{at:NOW,pnl:0}];
 assert.equal(realizedPerformance(rows,'1D',NOW).amount,-2);assert.equal(realizedPerformance([], '1D',NOW).amount,0);
 assert.equal(realizedPerformance([...rows,{at:NOW,pnl:null}],'1D',NOW).amount,null);
});
test('history cursors cannot redirect credentials or change endpoints, and malformed fills fail closed',()=>{
 assert.equal(orderHistoryPath('/api/v0/equity/history/orders?cursor=123&limit=50'),'/equity/history/orders?limit=50&cursor=123');
 for(const path of ['https://evil.invalid/api/v0/equity/history/orders?limit=50','//evil.invalid/equity/history/orders?limit=50','/api/v0/equity/orders?limit=50','/api/v0/equity/history/orders?cursor=1&cursor=2','/api/v0/equity/history/orders?limit=100','/api/v0/equity/history/orders?limit=50&url=evil','/api/v0/equity/history/orders?cursor=1#evil'])assert.throws(()=>orderHistoryPath(path));
 const p=normalizeOrderHistory({items:[fill(1,-10),fill(2,0)],nextPagePath:null},NOW);assert.equal(p.rows[0].pnl,-10);assert.equal(p.rows[1].pnl,0);
 assert.equal(normalizeOrderHistory({items:[fill(1,null)],nextPagePath:null},NOW).rows[0].pnl,null);
 assert.throws(()=>normalizeOrderHistory({items:[]},NOW));assert.throws(()=>normalizeOrderHistory({items:[fill(Number.MAX_SAFE_INTEGER+1,2)],nextPagePath:null},NOW));
 assert.throws(()=>normalizeOrderHistory({items:[{order:{side:'SELL',status:'FILLED'}}],nextPagePath:null},NOW));
});
test('paginated history resumes after restart, deduplicates fills and publishes only complete scans',async t=>{
 const f=fixture(t,async url=>url.includes('cursor=2')?json({items:[fill(1,25),fill(2,-10)],nextPagePath:'/api/v0/equity/history/orders?cursor=3&limit=50'}):url.includes('cursor=3')?json({items:[fill(3,0)],nextPagePath:null}):json({items:[fill(1,25)],nextPagePath:'/api/v0/equity/history/orders?cursor=2&limit=50'}));
 await f.connect();await f.service.history.sync(f.id);let p=f.service.history.read(f.id,'MAX');assert.equal(p.realized.amount,null);assert.equal(p.realized.pages,2);assert.equal(p.sampled.amount,150);
 f.restart();f.advance(61000);await f.service.history.sync(f.id);p=f.service.history.read(f.id,'MAX');assert.equal(p.realized.amount,15);assert.equal(p.realized.count,3);assert.equal(p.realized.updating,false);assert.equal(p.realized.status,'ready');
 for(const call of f.calls){assert.equal(call.options.method,'GET');assert.equal(call.options.redirect,'error');assert.ok(call.url.startsWith('https://live.trading212.com/api/v0/equity/'));}
 const calls=f.calls.length;await f.service.history.sync(f.id);assert.equal(f.calls.length,calls);assert.ok(!JSON.stringify(p).includes(credentials.apiSecret));
 f.restart();assert.equal(f.service.history.read(f.id,'MAX').realized.amount,15);
});
test('history permission failures preserve holdings and connection; old complete history survives refresh failures',async t=>{
 let mode='denied';const f=fixture(t,async()=>mode==='denied'?new Response('',{status:403}):mode==='bad'?json({items:[fill(2,999)],nextPagePath:'https://evil.invalid/'}):json({items:[fill(1,20)],nextPagePath:null}));
 await f.connect();await f.service.history.sync(f.id);assert.match(f.service.history.read(f.id).realized.error,/History: Orders/);assert.equal(f.service.read().data.accounts[0].error,null);assert.equal(f.service.read().data.accounts[0].connected,true);
 mode='ok';f.advance(301000);await f.service.history.sync(f.id);assert.equal(f.service.history.read(f.id,'MAX').realized.amount,20);
 mode='bad';f.advance(901000);await f.service.history.sync(f.id);const p=f.service.history.read(f.id,'MAX');assert.equal(p.realized.amount,20);assert.ok(p.realized.error);assert.equal(f.service.read().data.accounts[0].snapshot.accountValue,1100);
});
test('disconnect or account deletion during a history read cannot repopulate saved results',async t=>{
 let release;const held=new Promise(r=>release=r);const f=fixture(t,async()=>{await held;return json({items:[fill(1,10)],nextPagePath:null});});await f.connect();const request=f.service.history.sync(f.id);
 f.service.removeAccount(f.id,f.service.read().revision);release();await request;assert.equal(f.service.read().data.accounts.length,0);assert.throws(()=>f.service.history.read(f.id),/not found/);
});
test('different wallet currencies and missing realized results never become guessed totals',async t=>{
 const f=fixture(t,async()=>json({items:[fill(1,10),fill(2,20,'2026-11-03T15:00Z','EUR')],nextPagePath:null}));await f.connect();await f.service.history.sync(f.id);const p=f.service.history.read(f.id,'MAX');assert.equal(p.realized.amount,null);assert.equal(p.realized.mixedCurrencies,true);
});
test('disconnecting during a pending scan stops progress and prevents the late response from publishing',async t=>{
 let release;const held=new Promise(r=>release=r);const f=fixture(t,async()=>{await held;return json({items:[fill(1,10)],nextPagePath:null});});await f.connect();const request=f.service.history.sync(f.id);
 assert.equal(f.service.history.read(f.id).realized.updating,true);f.service.disconnect(f.id,f.service.read().revision);release();await request;
 const p=f.service.history.read(f.id,'MAX');assert.equal(p.realized.updating,false);assert.equal(p.realized.amount,null);assert.equal(p.sampled.amount,150);
});
test('snapshot history keeps genuine timestamps and balances across refresh/restart without workspace edits',async t=>{
 const f=fixture(t,async()=>json({items:[],nextPagePath:null}));await f.connect();f.advance(16*60000);summary.investments.unrealizedProfitLoss=125;
 try{await f.service.sync(f.id);assert.equal(f.service.history.read(f.id).sampled.amount,25);f.restart();assert.equal(f.service.history.read(f.id).sampled.amount,25);assert.equal(f.service.history.read(f.id,'MAX').sampled.amount,175);}finally{summary.investments.unrealizedProfitLoss=100;}
});
test('background sampling records combined P/L without a browser and stops after disconnect',async t=>{
 t.mock.timers.enable({apis:['setInterval']});
 const f=fixture(t,async()=>json({items:[],nextPagePath:null}),{background:true});await f.connect();
 f.advance(900001);summary.investments.unrealizedProfitLoss=120;
 try{
   t.mock.timers.tick(900000);for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));
   assert.equal(f.service.history.read(f.id).sampled.amount,20);assert.equal(f.calls.length,4);
   f.service.disconnect(f.id,f.service.read().revision);f.advance(900001);t.mock.timers.tick(900000);for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));assert.equal(f.calls.length,4);
 }finally{summary.investments.unrealizedProfitLoss=100;}
});
test('reconnecting a different broker after a manual import cannot inherit the prior account history',async t=>{
 const f=fixture(t,async()=>json({items:[fill(1,20)],nextPagePath:null}));await f.connect();await f.service.history.sync(f.id);
 f.service.disconnect(f.id,f.service.read().revision);
 f.service.importSnapshot(f.id,{version:1,currency:'USD',holdings:[]},f.service.read().revision);
 f.advance(901000);summary.id=54321;
 try{await f.connect();const p=f.service.history.read(f.id,'MAX');assert.equal(p.realized.amount,null);assert.equal(p.sampled.points.length,1);assert.equal(p.trackingFrom,NOW+901000);}finally{summary.id=12345;}
});
