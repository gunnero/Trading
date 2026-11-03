import test from 'node:test';
import {Readable} from 'node:stream';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openAuthStore} from '../server/auth.mjs';
import {createPortfolioService} from '../server/portfolio.mjs';
import {fundingHistoryPath,normalizeFundingHistory} from '../server/portfolio-funding.mjs';
import {accountPerformance,portfolioRangeStart,realizedPerformance,realizedChartPoints} from '../src/data/portfolio-history.mjs';

const NOW=Date.parse('2026-11-03T16:00Z'),DAY=86400000;
const transaction=(reference,amount,type='DEPOSIT',dateTime='2026-10-01T15:00Z',currency='USD')=>({reference,amount,type,dateTime,currency});
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const credentials={apiKey:'fixture-key-12345',apiSecret:'fixture-secret-67890',environment:'live',authorized:true};
function fixture(t,fetcher){
 const directory=mkdtempSync(join(tmpdir(),'opening-bell-funding-')),auth=openAuthStore({directory});let time=NOW;
 const summary={id:12345,currency:'USD',totalValue:1250,cash:{availableToTrade:250,reservedForOrders:0,inPies:0},investments:{currentValue:1000,totalCost:900,unrealizedProfitLoss:100,realizedProfitLoss:50}},calls=[];
 const request=async(url,options)=>{calls.push({url,options});return url.includes('/history/transactions')?fetcher(url,options):json(url.endsWith('/summary')?summary:url.includes('/history/orders')?{items:[],nextPagePath:null}:[]);};
 let service=createPortfolioService(auth,directory,{fetcher:request,now:()=>time});
 service.person({name:'Funding Fixture'},0);service.account({personId:service.read().data.people[0].id,platform:'Trading 212',label:'Invest'},1);const id=service.read().data.accounts[0].id;
 t.after(()=>{service.close();auth.close();rmSync(directory,{recursive:true,force:true});});
 return {get service(){return service;},id,calls,summary,connect:()=>service.connect(id,credentials,service.read().revision),advance:ms=>time+=ms,restart(){service.close();service=createPortfolioService(auth,directory,{fetcher:request,now:()=>time});}};
}
const rows=items=>normalizeFundingHistory({items,nextPagePath:null},NOW).rows;
test('account-wide return removes funding and preserves effects of dividends, interest, fees and withdrawals',()=>{
 const movements=rows([transaction('deposit',1000),transaction('withdrawal',-100,'WITHDRAW'),transaction('interest',10,'INTEREST_ON_FREE_CASH'),transaction('fee',-5,'FEE')]);
 const p=accountPerformance([{at:NOW,value:1250}],movements,'USD','MAX',NOW);
 assert.equal(p.accountValue,1250);assert.equal(p.netDeposits,900);assert.equal(p.amount,350);assert.equal(p.ratePercent,null);
 assert.equal(accountPerformance([{at:NOW,value:850}],movements,'USD','MAX',NOW).amount,-50);
 const positiveWithdrawal=movements.map(t=>t.type==='WITHDRAW'?{...t,amount:100}:t);
 assert.equal(accountPerformance([{at:NOW,value:1250}],positiveWithdrawal,'USD','MAX',NOW).amount,350);
});
test('deposits during a period cannot look like profit, and incomplete periods show no made-up change',()=>{
 const movements=rows([transaction('new',500,'DEPOSIT','2026-11-03T15:00Z'),transaction('old',1000)]);
 const valuations=[{at:NOW-DAY-60000,value:1100},{at:NOW,value:1625}];
 const p=accountPerformance(valuations,movements,'USD','1D',NOW);assert.equal(p.amount,25);assert.equal(p.netDeposits,1500);assert.equal(p.totalReturn,125);assert.equal(p.points[0].value,0);
 for(const range of ['1W','1M','3M','YTD','1Y']){const p=accountPerformance(valuations,movements,'USD',range,NOW);assert.equal(p.amount,null);assert.equal(p.coverage,'partial');assert.deepEqual(p.points,[]);}
 assert.equal(accountPerformance(valuations,movements,'USD','MAX',NOW).amount,125);
 assert.equal(new Date(portfolioRangeStart('3M',Date.parse('2026-05-31T15:30Z'))).toISOString(),'2026-02-28T15:30:00.000Z');
 assert.equal(portfolioRangeStart('YTD',NOW),Date.parse('2026-01-01T00:00Z'));
});
test('foreign funding, ambiguous transfers, unknown movements and missing deposits are withheld',()=>{
 for(const items of [[transaction('eur',1000,'DEPOSIT',undefined,'EUR')],[transaction('dep',1000),transaction('transfer',50,'TRANSFER')],[transaction('dep',1000),transaction('unknown',10,'UNKNOWN')],[]]){
   const p=accountPerformance([{at:NOW,value:1250}],rows(items),'USD','MAX',NOW);assert.equal(p.amount,null);assert.equal(p.netDeposits,null);assert.ok(p.reason);
 }
});
test('transaction cursors stay on fixed read-only endpoint and validate types, timestamps and required fields',()=>{
 assert.equal(fundingHistoryPath('/api/v0/equity/history/transactions?cursor=abc-123&limit=50'),'/equity/history/transactions?limit=50&cursor=abc-123');
 for(const path of ['https://evil.invalid/equity/history/transactions?limit=50','//evil.invalid/equity/history/transactions?limit=50','/equity/history/orders?limit=50','/equity/history/transactions?cursor=a&cursor=b','/equity/history/transactions?limit=51','/equity/history/transactions?limit=50&url=evil','/equity/history/transactions?cursor=a#x','/equity/history/transactions?time=nonsense'])assert.throws(()=>fundingHistoryPath(path));
 for(const item of [transaction('id',-10),transaction('id',NaN),transaction('id',10,'DEPOSIT','2026-12-01T00:00Z'),transaction('id',10,'DEPOSIT','2026-11-03T15:00'),{amount:10}])assert.throws(()=>normalizeFundingHistory({items:[item],nextPagePath:null},NOW));
 assert.throws(()=>normalizeFundingHistory({items:[]},NOW));
});
test('resumable funding scan only publishes complete history, deduplicates references and survives restart',async t=>{
 const f=fixture(t,async url=>url.includes('cursor=b')?json({items:[transaction('d',1000),transaction('w',100,'WITHDRAW')],nextPagePath:'/api/v0/equity/history/transactions?cursor=c&limit=50'}):url.includes('cursor=c')?json({items:[transaction('interest',5,'INTEREST_ON_FREE_CASH')],nextPagePath:null}):json({items:[transaction('d',1000)],nextPagePath:'/api/v0/equity/history/transactions?cursor=b&limit=50'}));
 await f.connect();await f.service.funding.sync(f.id);let p=f.service.history.read(f.id,'MAX').accountReturn;assert.equal(p.amount,null);assert.equal(p.pages,2);
 f.restart();f.advance(61000);await f.service.funding.sync(f.id);p=f.service.history.read(f.id,'MAX').accountReturn;assert.equal(p.amount,350);assert.equal(p.netDeposits,900);assert.equal(p.updating,false);assert.equal(p.to,NOW);
 for(const call of f.calls){assert.equal(call.options.method,'GET');assert.equal(call.options.redirect,'error');assert.ok(call.url.startsWith('https://live.trading212.com/api/v0/equity/'));}
 const count=f.calls.length;await f.service.funding.sync(f.id);assert.equal(f.calls.length,count);assert.ok(!JSON.stringify(p).includes(credentials.apiSecret));
 f.restart();assert.equal(f.service.history.read(f.id,'MAX').accountReturn.amount,350);
});
test('newer balances wait for funding coverage so an unimported deposit cannot inflate return',async t=>{
 let items=[transaction('d',1000)];const f=fixture(t,async()=>json({items,nextPagePath:null}));await f.connect();await f.service.funding.sync(f.id);
 f.advance(61000);f.summary.totalValue=1750;await f.service.sync(f.id);
 assert.equal(f.service.history.read(f.id,'MAX').accountReturn.amount,250);assert.equal(f.service.history.read(f.id,'MAX').accountReturn.accountValue,1250);
 items.push(transaction('new',500,'DEPOSIT','2026-11-03T16:00:30Z'));await f.service.funding.sync(f.id);
 const p=f.service.history.read(f.id,'MAX').accountReturn;assert.equal(p.amount,250);assert.equal(p.netDeposits,1500);assert.equal(p.accountValue,1750);assert.equal(p.to,NOW+61000);
 f.restart();assert.equal(f.service.history.read(f.id,'MAX').accountReturn.amount,250);
});
test('funding permission failures keep holdings connected and preserve the last reconciled return',async t=>{
 let mode='denied';const f=fixture(t,async()=>mode==='denied'?new Response('',{status:403}):mode==='cycle'?json({items:[transaction('fake',999)],nextPagePath:'/equity/history/transactions?limit=50'}):json({items:[transaction('d',1000)],nextPagePath:null}));
 await f.connect();await f.service.funding.sync(f.id);assert.match(f.service.history.read(f.id,'MAX').accountReturn.error,/History: Transactions/);assert.equal(f.service.read().data.accounts[0].connected,true);assert.equal(f.service.read().data.accounts[0].error,null);
 mode='ok';f.advance(301000);await f.service.funding.sync(f.id);assert.equal(f.service.history.read(f.id,'MAX').accountReturn.amount,250);
 mode='cycle';f.advance(61000);await f.service.funding.sync(f.id);const p=f.service.history.read(f.id,'MAX').accountReturn;assert.equal(p.amount,250);assert.match(p.error,/repeated/);
});
test('disconnect/delete races cannot publish funding results; identity changes clear old funding and valuations',async t=>{
 for(const action of ['disconnect','removeAccount']){
   let release;const held=new Promise(r=>release=r),f=fixture(t,async()=>{await held;return json({items:[transaction('d',1000)],nextPagePath:null});});await f.connect();const pending=f.service.funding.sync(f.id);
   f.service[action](f.id,f.service.read().revision);release();await pending;
   if(action==='disconnect')assert.equal(f.service.history.read(f.id,'MAX').accountReturn.amount,null);else assert.throws(()=>f.service.history.read(f.id),/not found/);
 }
 const f=fixture(t,async()=>json({items:[transaction('d',1000)],nextPagePath:null}));await f.connect();await f.service.funding.sync(f.id);f.service.disconnect(f.id,f.service.read().revision);f.service.importSnapshot(f.id,{version:1,currency:'USD',holdings:[]},f.service.read().revision);f.summary.id=67890;f.advance(61000);await f.connect();assert.equal(f.service.history.read(f.id,'MAX').accountReturn.amount,null);
});
test('realized graph starts at zero, ends at check time and only changes at actual executions',()=>{
 const result=realizedPerformance([{at:NOW-1000,pnl:20},{at:NOW-500,pnl:-5}],'1D',NOW),points=realizedChartPoints(result);
 assert.deepEqual(points,[{at:NOW-DAY,value:0},{at:NOW-1000,value:20},{at:NOW-500,value:15},{at:NOW,value:15}]);assert.deepEqual(realizedChartPoints({amount:null}),[]);
});

test('the existing history sync route loads independent funding and order histories together',async t=>{
 const f=fixture(t,async()=>json({items:[transaction('d',1000)],nextPagePath:null}));await f.connect();
 const req=Readable.from([Buffer.from(JSON.stringify({range:'MAX'}))]);Object.assign(req,{method:'POST',url:`/api/portfolio/accounts/${f.id}/history/sync`,headers:{'content-type':'application/json','x-opening-bell-client':'web'}});
 let result;await f.service.middleware(req,{setHeader(){},end(body){result=JSON.parse(body);}},()=>assert.fail('Unexpected next'));
 assert.equal(result.accountReturn.amount,250);assert.equal(result.realized.amount,0);assert.ok(f.calls.some(c=>c.url.includes('/history/transactions')));assert.ok(f.calls.some(c=>c.url.includes('/history/orders')));
});
