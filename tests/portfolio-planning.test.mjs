import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPortfolioService} from '../server/portfolio.mjs';
import {allocationPlan,contributionBreakdown,performanceIndex,drawdownSummary,benchmarkComparison,annualTotals} from '../src/data/portfolio-planning.mjs';
import {parseBenchmarkPrices,resolveSymbol} from '../server/market-data.mjs';
import {reportCsv} from '../src/data/portfolio-insights.mjs';
const day=86400000,now=Date.parse('2026-11-04T16:00:00Z'),instrument={ticker:'AMD_US_EQ',name:'AMD',currency:'USD',isin:'US0079031078'};
async function fixture(t){
 const directory=mkdtempSync(join(tmpdir(),'ob-planning-')),auth={encrypt:v=>v,decrypt:v=>v};let time=now,price=100,failSync=false,block=null,release=null;
 const calls=[],source={orders:{items:[],nextPagePath:null},transactions:{items:[{reference:'d',dateTime:'2025-01-01T10:00:00Z',type:'DEPOSIT',amount:1000,currency:'USD'}],nextPagePath:null},dividends:{items:[],nextPagePath:null}};
 const options={now:()=>time,workspace:()=>({watchText:'###STOCKS,NASDAQ:AMD'}),company:async key=>({status:'ok',fetchedAt:new Date(time).toISOString(),data:{earnings:{dates:['2025-01-01','2026-11-10'],estimated:true},exDividend:'2026-11-20',dividendDate:'2026-12-01'}}),benchmarkPrices:async()=>({currency:'USD',points:[{at:time-day,value:100},{at:time,value:110}]}),fetcher:async(url,opts)=>{
  calls.push({url,method:opts.method,body:opts.body});const path=new URL(url).pathname;
  if(path.endsWith('/summary')){if(failSync)return new Response('',{status:503});if(block){const wait=block;block=null;await wait;}return Response.json({id:123,currency:'USD',totalValue:800+2*price,cash:{availableToTrade:800,reservedForOrders:0,inPies:0},investments:{currentValue:2*price,totalCost:200,unrealizedProfitLoss:2*price-200,realizedProfitLoss:0}});}
  if(path.endsWith('/positions'))return Response.json([{instrument,quantity:2,quantityAvailableForTrading:2,averagePricePaid:100,currentPrice:price,walletImpact:{currency:'USD',currentValue:price*2,totalCost:200,unrealizedProfitLoss:price*2-200}}]);
  if(path.endsWith('/instruments'))return Response.json([{...instrument,currencyCode:'USD',type:'STOCK',extendedHours:true}]);
  if(path.includes('/history/'))return Response.json(typeof source[path.split('/').at(-1)]==='function'?source[path.split('/').at(-1)](url):source[path.split('/').at(-1)]);
  if(path.endsWith('/orders'))return Response.json([]);
  if(opts.method==='POST'){const b=JSON.parse(opts.body);return Response.json({id:42,instrument,quantity:Math.abs(b.quantity),side:b.quantity>0?'BUY':'SELL',type:path.endsWith('limit')?'LIMIT':'MARKET',status:'NEW',extendedHours:b.extendedHours});}
  throw Error('Unexpected fixture request');
 }};
 let service=createPortfolioService(auth,directory,options);t.after(()=>{service.close();rmSync(directory,{recursive:true,force:true});});
 service.person({name:'Test person'},service.read().revision);service.account({personId:service.read().data.people[0].id,label:'Test Invest',platform:'Trading 212'},service.read().revision);const id=service.read().data.accounts[0].id;
 await service.connect(id,{apiKey:'fake-key-1234',apiSecret:'fake-secret-1234',environment:'demo',authorized:true},service.read().revision);
 return {id,calls,source,get service(){return service;},advance:(v=61000)=>time+=v,price:v=>price=v,fail:v=>failSync=v,restart(){service.close();service=createPortfolioService(auth,directory,options);},block(){block=new Promise(r=>release=r);},release(){release();},save(patch){return service.planning.save({accountId:id,revision:service.planning.settings(id).revision,...patch});}};
}
test('settings persist per broker account, reject invalid targets and preserve revisions',async t=>{
 const f=await fixture(t);f.save({maxOrderValue:250,concentrationPercent:15,targets:{AMD_US_EQ:50,CASH:50}});f.restart();const a=f.service.planning.read().accounts[0];assert.equal(a.settings.maxOrderValue,250);assert.equal(a.plan.rows[0].delta,300);assert.equal(a.plan.rows[0].shares,3);
 assert.throws(()=>f.service.planning.save({accountId:f.id,revision:0,maxOrderValue:null}),/changed/);
 for(const patch of [{maxOrderValue:-1},{maxOrderValue:'100'},{staleMinutes:5},{healthEnabled:'true'},{targets:{AMD_US_EQ:70}},{targets:{__bad:100}},{targets:[100]},{concentrationPercent:101}])assert.throws(()=>f.save(patch));
 assert.equal(f.calls.filter(c=>c.method!=='GET').length,0);f.service.removeAccount(f.id,f.service.read().revision);assert.equal(f.service.planning.read().accounts.length,0);
});
test('health and concentration notify once per incident across restarts, recover and re-arm on fresh data only',async t=>{
 const f=await fixture(t);f.save({concentrationPercent:15});f.service.planning.check();assert.equal(f.service.activity.notifications().unread,1);assert.equal(f.service.activity.notifications().items[0].kind,'concentration');
 f.restart();f.service.planning.check();assert.equal(f.service.activity.notifications().unread,1);
 f.advance(31*60000);f.service.planning.check();assert.equal(f.service.activity.notifications().unread,2);f.restart();f.service.planning.check();assert.equal(f.service.activity.notifications().unread,2);
 await f.service.sync(f.id);f.service.planning.check();assert.equal(f.service.activity.notifications().unread,3);assert.match(f.service.activity.notifications().items[0].name,/restored/);
 f.price(20);f.advance();await f.service.sync(f.id);f.service.planning.check();f.price(100);f.advance();await f.service.sync(f.id);f.service.planning.check();assert.equal(f.service.activity.notifications().unread,4);
 f.service.disconnect(f.id,f.service.read().revision);f.advance(60*60000);f.service.planning.check();assert.equal(f.service.activity.notifications().unread,4);
});
test('order-value limits apply to both sides and fresh submit prices; tightening after review blocks writes',async t=>{
 const f=await fixture(t);f.service.trading.configure(f.id,{enabled:true,authorized:true});f.save({maxOrderValue:150});
 const order={side:'BUY',type:'MARKET',ticker:instrument.ticker,quantity:1};
 for(const side of ['BUY','SELL'])await assert.rejects(f.service.trading.preview(f.id,{...order,side,quantity:2}),/maximum order value/);
 const review=await f.service.trading.preview(f.id,order);assert.equal(review.maxOrderValue,150);f.price(160);await assert.rejects(f.service.trading.submit(f.id,{token:review.token,confirmed:true}),/maximum order value/);assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
 f.price(100);f.advance(6000);const next=await f.service.trading.preview(f.id,order);f.save({maxOrderValue:50});await assert.rejects(f.service.trading.submit(f.id,{token:next.token,confirmed:true}),/maximum order value/);
 f.save({maxOrderValue:100});const limit=await f.service.trading.preview(f.id,{...order,type:'LIMIT',limitPrice:100});await f.service.trading.submit(f.id,{token:limit.token,confirmed:true});assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
 assert.throws(()=>f.service.planning.orderLimit(f.id,null,'USD'),/current broker price/);assert.throws(()=>f.service.planning.orderLimit(f.id,10,'EUR'),/matching/);
});
test('settings cannot change during an in-flight order review',async t=>{
 const f=await fixture(t);f.service.trading.configure(f.id,{enabled:true,authorized:true});f.block();const review=f.service.trading.preview(f.id,{side:'BUY',type:'LIMIT',ticker:instrument.ticker,quantity:1,limitPrice:100});await Promise.resolve();assert.throws(()=>f.save({maxOrderValue:1}),/order operation/);f.release();await review;
});
test('allocation refuses incomplete or unreconciled values and never mixes price currencies',()=>{
 const s={accountValue:1000,cash:800,currency:'USD',holdings:[{ticker:'A',name:'A',value:200,price:100,instrumentCurrency:'USD'}]};
 assert.equal(allocationPlan(s,{A:50,CASH:50}).rows[0].shares,3);assert.match(allocationPlan({...s,cash:0}).reason,/reconcile/);assert.ok(allocationPlan({...s,holdings:[{value:null}]}).reason);
 assert.equal(allocationPlan({...s,holdings:[{...s.holdings[0],instrumentCurrency:'EUR'}]},{A:50,CASH:50}).rows[0].shares,null);
 assert.match(allocationPlan(s,{REMOVED:100}).reason,/no longer held/);
});
const ledger=(values,flows=[])=>({complete:true,coveredThrough:100*day,values:values.map((value,i)=>({at:(i+1)*day,value,currency:'USD'})),flows});
test('linked returns neutralize deposits and withdrawals, compound gains, disclose estimates, and reject gaps in funding semantics',()=>{
 const l=ledger([100,150,180,90],[{at:2*day,amount:50,type:'DEPOSIT',currency:'USD'},{at:4*day,amount:90,type:'WITHDRAW',currency:'USD'}]),p=performanceIndex(l,'USD');assert.ok(Math.abs(p.ratePercent-20)<1e-8);assert.equal(drawdownSummary(p.points).maxPercent,0);
 assert.equal(performanceIndex({...l,complete:false},'USD').points.length,0);
 assert.match(performanceIndex({...l,flows:[{at:2*day,amount:50,type:'TRANSFER',currency:'USD'}]},'USD').reason,/unsupported/);
 assert.match(performanceIndex({...l,flows:[{at:2*day,amount:50,type:'DEPOSIT',currency:'EUR'}]},'USD').reason,/Foreign/);
 const estimated=ledger([100,120]);estimated.values[0].estimated=true;assert.equal(performanceIndex(estimated,'USD').estimated,true);
 const mid=performanceIndex(ledger([100,210],[{at:1.5*day,amount:100,type:'DEPOSIT',currency:'USD'}]),'USD');assert.ok(Math.abs(mid.ratePercent-100*10/150)<1e-8);
});
test('drawdown records peak to trough, recovery duration and ongoing underwater time',()=>{
 const points=[100,120,90,100,120,110].map((value,i)=>({at:i*day,value})),d=drawdownSummary(points);
 assert.equal(d.maxPercent,-25);assert.equal(d.peakAt,day);assert.equal(d.troughAt,2*day);assert.equal(d.recoveredAt,4*day);assert.equal(d.recoveryDays,3);assert.equal(d.underwaterDays,1);assert.ok(Math.abs(d.currentPercent+100/12)<1e-8);
});
test('benchmark pairs overlapping close dates without backfilling, rejects currency mismatches and supports adjusted closes only',()=>{
 const l=ledger([100,110,121]),prices={currency:'USD',points:[{at:day,value:50},{at:2*day,value:51},{at:3*day,value:52}]};const c=benchmarkComparison(l,'USD',prices);assert.ok(Math.abs(c.ratePercent-21)<1e-8);assert.ok(Math.abs(c.benchmarkPercent-4)<1e-8);assert.equal(c.points.length,3);
 assert.equal(benchmarkComparison(l,'EUR',prices).points.length,0);assert.equal(benchmarkComparison(l,'USD',{...prices,points:[{at:50*day,value:50}]}).points.length,0);
 const payload={chart:{result:[{meta:{symbol:'SPY',currency:'USD',instrumentType:'ETF',dataGranularity:'1d'},timestamp:[Date.parse('2026-11-02T14:30:00Z')/1000],indicators:{adjclose:[{adjclose:[123]}]}}]}};
 assert.equal(parseBenchmarkPrices(payload,resolveSymbol('SPY'),now).points[0].value,123);payload.chart.result[0].meta.currency='EUR';assert.throws(()=>parseBenchmarkPrices(payload,resolveSymbol('SPY'),now));
});
test('contributions include closed stocks, separate currencies, and withhold totals when sell results are missing',()=>{
 const result=contributionBreakdown({currency:'USD',holdings:[{ticker:'A',name:'A',unrealized:20}]},{complete:false,items:[{ticker:'A',name:'A',currency:'USD',side:'SELL',realized:10},{ticker:'B',name:'B',currency:'EUR',side:'SELL',realized:-5},{ticker:'C',name:'C',currency:'USD',side:'SELL',realized:null}]});
 assert.equal(result.rows[0].total,30);assert.equal(result.rows.find(r=>r.ticker==='B').total,-5);assert.equal(result.rows.find(r=>r.ticker==='C').total,null);assert.equal(result.complete,false);
});
test('holdings calendar uses exact listings, skips past dates and retains estimate/source timestamps',async t=>{
 const f=await fixture(t);const c=await f.service.planning.calendar({account:f.id});assert.equal(c.items[0].listing,'NASDAQ:AMD');assert.equal(c.items[0].events.length,3);assert.equal(c.items[0].events[0].estimated,true);assert.equal(c.items[0].status,'ok');assert.ok(c.items[0].fetchedAt);await assert.rejects(f.service.planning.calendar({account:f.id,offset:-1}));
});
test('annual report covers all execution pages and local year boundaries, keeps currencies and export coverage',async t=>{
 const f=await fixture(t),fill=(id,filledAt)=>({order:{id,instrument,side:'SELL',quantity:1,filledQuantity:1,type:'MARKET',status:'FILLED',createdAt:filledAt},fill:{id,type:'TRADE',quantity:1,price:110,filledAt,walletImpact:{currency:'USD',netValue:110,realisedProfitLoss:10,taxes:[{name:'FEE',quantity:.5,currency:'EUR'}]}}});
 const rows=Array.from({length:55},(_,i)=>fill(i+1,'2026-10-01T10:00:00Z'));rows.push(fill(100,'2025-12-31T23:30:00Z'),fill(101,'2025-12-31T22:30:00Z'));
 f.source.orders=url=>new URL(url).searchParams.has('cursor')?{items:rows.slice(50),nextPagePath:null}:{items:rows.slice(0,50),nextPagePath:'/api/v0/equity/history/orders?limit=50&cursor=123'};
 await f.service.activity.sync(f.id);f.advance(31000);await f.service.activity.sync(f.id);await f.service.funding.sync(f.id);await f.service.reports.syncIncome(f.id);
 const report=f.service.reports.read({year:'2026',timeZone:'Europe/Skopje'}),a=report.accounts[0];assert.equal(a.trades.length,56);assert.equal(a.trades.some(t=>t.id===101),false);assert.ok(a.warnings.length);assert.match(reportCsv(report),/Annual accountant export/);assert.match(reportCsv(report),/Execution charge/);assert.match(reportCsv(report),/Account ID/);
 const totals=annualTotals(a);assert.equal(totals.currencies.find(c=>c.currency==='USD').realized,560);assert.equal(totals.currencies.find(c=>c.currency==='EUR').charges,28);
 for(const filters of [{year:'no'},{year:'2026',month:'2026-01'},{year:'2027'}])assert.throws(()=>f.service.reports.read(filters));
});
test('performance refresh resumes funding history and compares only supported matching ranges',async t=>{
 const f=await fixture(t);let p=await f.service.planning.performance({account:f.id,range:'MAX',benchmark:'SPY'});assert.ok(p.index.reason);f.advance(day);f.price(150);await f.service.sync(f.id);p=await f.service.planning.performance({account:f.id,range:'1M',benchmark:'SPY'});assert.ok(Math.abs(p.index.ratePercent-10)<1e-8);assert.equal(p.index.reason,null);assert.equal(p.comparison.points.length,2);assert.equal(p.drawdown.maxPercent,0);
 for(const filters of [{range:'INVALID',benchmark:'SPY'},{range:'MAX',benchmark:'BTC'}])await assert.rejects(f.service.planning.performance({account:f.id,...filters}),/supported range/);
});

test('empty initial account observations start the comparison at the first positive valuation',()=>{const l=ledger([0,100,110]);const p=performanceIndex(l,'USD');assert.equal(p.start,2*day);assert.ok(Math.abs(p.ratePercent-10)<1e-8);const c=benchmarkComparison(l,'USD',{currency:'USD',points:[{at:day,value:40},{at:2*day,value:50},{at:3*day,value:55}]});assert.equal(c.benchmarkStart,2*day);assert.ok(Math.abs(c.benchmarkPercent-10)<1e-8);});
