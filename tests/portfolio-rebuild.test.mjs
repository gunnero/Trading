import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {portfolioLedger,rebuildPortfolioValues} from '../src/data/portfolio-rebuild.mjs';
import {createPortfolioRebuild,dividendHistoryPath} from '../server/portfolio-rebuild.mjs';
import {accountPerformance} from '../src/data/portfolio-history.mjs';
import {createPortfolioFunding} from '../server/portfolio-funding.mjs';
import {parsePortfolioPrices,resolveSymbol,createMarketService} from '../server/market-data.mjs';
import {yahooPayload} from './fixtures/market.mjs';
const time=s=>Date.parse(s),day=86400000,NOW=time('2026-10-23T22:00Z');
const instrument={ticker:'AMD_US_EQ',name:'Advanced Micro Devices',currency:'USD',isin:'US0079031078'};
const trade=(id,side,quantity,netValue,filledAt)=>({order:{id,side,status:'FILLED',instrument},fill:{id,type:'TRADE',quantity,filledAt,walletImpact:{netValue,currency:'USD'}}});
function ledgerInput(){return {snapshot:{source:'api',brokerId:'1',currency:'USD',cash:863,accountValue:1093,fetchedAt:new Date(NOW).toISOString(),holdings:[{ticker:'AMD_US_EQ',quantity:2}]},transactions:[{reference:'deposit',type:'DEPOSIT',currency:'USD',amount:1000,dateTime:'2026-10-20T12:00Z'},{reference:'interest',type:'INTEREST_ON_FREE_CASH',currency:'USD',amount:1,dateTime:'2026-10-23T12:00Z'}],dividends:[{reference:'div',currency:'USD',amount:2,paidOn:'2026-10-22T12:00Z'}],orders:[trade(1,'BUY',5,500,'2026-10-20T14:00Z'),trade(2,'SELL',3,360,'2026-10-22T14:00Z')]};}
const priceHistory=()=>({currency:'USD',points:[{at:time('2026-10-20T20:00Z'),value:100},{at:time('2026-10-21T20:00Z'),value:110},{at:time('2026-10-22T20:00Z'),value:120},{at:time('2026-10-23T20:00Z'),value:115}]});
test('rebuild includes buys, sales, dividends and interest and reconciles current cash and shares',()=>{
 const ledger=portfolioLedger(ledgerInput()),points=rebuildPortfolioValues(ledger,{'AMD_US_EQ':priceHistory()},'USD');assert.deepEqual(points.map(p=>p.value),[1000,1050,1102,1093]);assert.ok(points.every(p=>p.estimated));assert.equal(ledger.cash,863);
});
test('incomplete holdings, cash, currencies, duplicates and corporate actions prevent publication',()=>{
 for(const change of [i=>i.snapshot.cash++,i=>i.snapshot.holdings[0].quantity++,i=>i.orders[0].fill.type='STOCK_SPLIT',i=>i.orders.push(i.orders[0]),i=>i.orders[0].fill.walletImpact.currency='EUR',i=>i.transactions[0].type='TRANSFER',i=>i.dividends[0].currency='EUR']){const input=ledgerInput();change(input);assert.throws(()=>portfolioLedger(input));}
 const input=ledgerInput();input.orders.shift();assert.throws(()=>portfolioLedger(input),/sales exceed/);
});
test('future activity cannot contaminate the anchored reconstruction',()=>{
 const input=ledgerInput();input.transactions.push({reference:'future',dateTime:'2026-10-24T10:00Z',amount:999,currency:'USD',type:'DEPOSIT'});input.orders.push(trade(99,'BUY',100,9999,'2026-10-24T14:00Z'));
 assert.equal(portfolioLedger(input).cash,863);assert.equal(portfolioLedger(input).instruments.length,1);
});
test('missing daily prices or FX never substitute zeros; no prices after a valuation are used',()=>{
 const ledger=portfolioLedger(ledgerInput());assert.throws(()=>rebuildPortfolioValues(ledger,{},'USD'),/unavailable/);
 for(const history of [{...priceHistory(),currency:'EUR'},{currency:'USD',points:[{at:NOW,value:100}]},{currency:'USD',points:[{at:NOW-20*day,value:100}]}])assert.throws(()=>rebuildPortfolioValues(ledger,{'AMD_US_EQ':history},'USD'));
});
test('dividend pagination accepts only the fixed endpoint with constrained cursors',()=>{
 assert.equal(dividendHistoryPath('/api/v0/equity/history/dividends?cursor=12&limit=50'),'/equity/history/dividends?limit=50&cursor=12');
 for(const path of ['/equity/history/orders?limit=50','https://bad.test/equity/history/dividends?limit=50','/equity/history/dividends?url=x','/equity/history/dividends?limit=50&limit=1',undefined])assert.throws(()=>dividendHistoryPath(path));
});
function fixture(t,{disk=false}={}){
 const dir=disk?mkdtempSync(join(tmpdir(),'portfolio-resume-')):null,file=dir?join(dir,'fixture.sqlite'):':memory:';let db=new DatabaseSync(file);t.after(()=>{db.close();if(dir)rmSync(dir,{recursive:true,force:true});});const input=ledgerInput();let now=NOW,generation='one';const a={environment:'demo',snapshot:input.snapshot},calls=[];const source={bad:false,hold:false};
 const options={now:()=>now,credential:()=>({generation}),decode:()=>({}),account:()=>a,isClosed:()=>false,request:async path=>{calls.push(path);if(source.hold)return {items:[],nextPagePath:'/equity/history/orders?cursor=1&limit=50'};return {items:path.includes('/orders')?input.orders:path.includes('/transactions')?input.transactions:input.dividends,nextPagePath:null};},prices:async key=>{assert.equal(key,'NASDAQ:AMD');if(source.bad)throw Error('prices unavailable');return priceHistory();}};
 let service=createPortfolioRebuild(db,options);
 return {get db(){return db;},options,a,input,source,calls,get service(){return service;},advance:()=>now+=61000,restart:(reopen=false)=>{if(reopen){db.close();db=new DatabaseSync(file);}service=createPortfolioRebuild(db,options);},connect:()=>generation='two'};
}
test('scan persists progress, publishes atomically and keeps a prior chart during a failed retry',async t=>{
 const f=fixture(t);f.service.start('a',{});await f.service.sync('a');assert.equal(f.service.read('a').status,'loading');assert.equal(f.service.values('a').length,0);assert.equal(f.calls.length,3);
 f.restart();f.advance();await f.service.sync('a');assert.equal(f.service.read('a').status,'ready');assert.equal(f.service.values('a').length,4);const old=f.service.values('a');
 f.advance();f.a.snapshot.fetchedAt=new Date(f.options.now()).toISOString();f.service.start('a',{});await f.service.sync('a');f.advance();f.source.bad=true;await f.service.sync('a');assert.equal(f.service.read('a').status,'paused');assert.deepEqual(f.service.values('a'),old);
});
test('repeated cursors and changed credential generation stop incomplete reconstruction',async t=>{
 const f=fixture(t);f.source.hold=true;f.service.start('a',{});await f.service.sync('a');assert.equal(f.service.read('a').status,'blocked');assert.equal(f.service.values('a').length,0);
 f.advance();f.advance();f.advance();f.advance();f.advance();f.advance();f.a.snapshot.fetchedAt=new Date(f.options.now()).toISOString();f.source.hold=false;f.service.start('a',{});f.connect();await f.service.sync('a');assert.equal(f.service.read('a').status,'unavailable');assert.match(f.service.read('a').message,/connection changed/);
});
test('reconstruction expands return history with estimated daily baselines; deposits remain excluded',()=>{
 const now=time('2026-10-23T22:00Z'),valuations=[{at:now-day-2*3600000,value:1000,estimated:true},{at:now,value:1550}],flows=[{at:now-10*day,amount:1000,currency:'USD',type:'DEPOSIT'},{at:now-3600000,amount:500,currency:'USD',type:'DEPOSIT'}];
 const result=accountPerformance(valuations,flows,'USD','1D',now);assert.equal(result.amount,50);assert.equal(result.estimated,true);assert.equal(result.coverage,'sampled');assert.ok(result.ratePercent>0&&result.ratePercent<5);
});
test('funding merges older estimates but never replaces or extends beyond actual recorded balances',async t=>{
 const f=fixture(t);const funding=createPortfolioFunding(f.db,{...f.options,historicalValues:()=>[{at:NOW-day,value:1000,estimated:true},{at:NOW,value:9999,estimated:true},{at:NOW+day,value:99999,estimated:true}]});funding.record('a',f.a.snapshot);await funding.sync('a');const result=funding.read('a','MAX');assert.deepEqual(result.valuePoints.map(p=>p.value),[1000,1093]);assert.equal(result.amount,93);assert.equal(result.reconstructedFrom,NOW-day);assert.equal(result.recordedFrom,NOW);
});
function pricesPayload(){const payload=yahooPayload('AMD'),r=payload.chart.result[0];r.meta.dataGranularity='1d';r.timestamp=['2026-10-20','2026-10-21'].map(d=>time(d+'T13:30Z')/1000);r.indicators.quote[0]={open:[50,52],close:[51,53],low:[49,51],high:[52,54],volume:[10,20]};r.indicators.adjclose=[{adjclose:[10,11]}];r.events={splits:{one:{date:time('2026-10-21T13:30Z')/1000,numerator:2,denominator:1}}};return payload;}
test('daily prices undo split-adjusted closes without using dividend-adjusted prices or future candles',()=>{
 const result=parsePortfolioPrices(pricesPayload(),resolveSymbol('NASDAQ:AMD'),NOW);assert.deepEqual(result.points.map(p=>p.value),[102,53]);assert.equal(result.points[0].at,time('2026-10-20T20:00Z'));
 assert.equal(parsePortfolioPrices(pricesPayload(),resolveSymbol('NASDAQ:AMD'),time('2026-10-21T15:00Z')).points.length,1);
 const bad=pricesPayload();bad.chart.result[0].meta.dataGranularity='3mo';assert.throws(()=>parsePortfolioPrices(bad,resolveSymbol('NASDAQ:AMD'),NOW));
});
test('daily price service uses fixed Yahoo daily history, a bounded shared cache and fails on source outage',async()=>{
 const calls=[],service=createMarketService({now:()=>NOW,fetcher:async url=>{calls.push(url);return new Response(JSON.stringify(pricesPayload()),{headers:{'content-type':'application/json'}});}});
 assert.equal((await service.portfolioPrices('NASDAQ:AMD',NOW-10*day,NOW)).points.length,2);await service.portfolioPrices('NASDAQ:AMD',NOW-10*day,NOW);assert.equal(calls.length,1);const url=new URL(calls[0]);assert.equal(url.host,'query1.finance.yahoo.com');assert.equal(url.searchParams.get('interval'),'1d');assert.equal(url.searchParams.get('events'),'splits');
 const failed=createMarketService({now:()=>NOW,fetcher:async()=>new Response('',{status:429})});await assert.rejects(()=>failed.portfolioPrices('NASDAQ:AMD',NOW-10*day,NOW),/unavailable/);
});

test('unfilled order identifiers cannot overwrite an execution with the same numeric identifier',async t=>{
 const f=fixture(t);f.input.orders.push({order:{id:1,status:'CANCELLED',side:'BUY',instrument}});f.service.start('a',{});await f.service.sync('a');f.advance();await f.service.sync('a');assert.equal(f.service.read('a').status,'ready');assert.equal(f.service.values('a').at(-1).value,1093);
});

test('eleven saved pages survive a failed next request, process restart and resume without rereading',async t=>{
 const f=fixture(t,{disk:true}),paths=[];let outage=true;
 f.options.request=async path=>{
   paths.push(path);
   if(path.includes('/orders')){
     const page=Number(new URL(path,'https://fixture.test').searchParams.get('cursor')||0);
     if(page===11&&outage)throw Object.assign(Error('Broker temporarily unavailable'),{retryMs:180000});
     return {items:page===0?f.input.orders:[{order:{id:100+page,status:'CANCELLED'}}],nextPagePath:page<11?`/equity/history/orders?cursor=${page+1}&limit=50`:null};
   }
   return {items:path.includes('/transactions')?f.input.transactions:f.input.dividends,nextPagePath:null};
 };
 f.restart();f.service.start('a',{});
 for(let i=0;i<4;i++){await f.service.sync('a');f.advance();}
 const paused=f.service.read('a');assert.equal(paused.pages,11);assert.equal(paused.records,12);assert.equal(paused.status,'paused');assert.equal(paused.canResume,true);assert.equal(paused.historyComplete,false);
 const saved=f.db.prepare('SELECT state FROM portfolio_rebuild_state').get().state,scan=JSON.parse(saved).scan;
 f.restart(true);assert.equal(f.db.prepare('SELECT state FROM portfolio_rebuild_state').get().state,saved);
 await f.service.sync('a');assert.equal(paths.length,12);assert.throws(()=>f.service.start('a',{}),/retry window/);
 outage=false;f.advance();f.advance();f.advance();
 // Resuming accepts an old anchor rather than requiring a new account snapshot.
 f.service.start('a',{});assert.equal(JSON.parse(f.db.prepare('SELECT state FROM portfolio_rebuild_state').get().state).scan,scan);
 await f.service.sync('a');f.advance();await f.service.sync('a');
 assert.equal(f.service.read('a').status,'ready');assert.equal(f.service.read('a').pages,14);assert.equal(f.service.read('a').records,16);assert.equal(paths.length,15);assert.equal(new Set(paths.slice(0,11)).size,11);assert.equal(paths[11],paths[12]);assert.equal(f.service.values('a').at(-1).value,1093);
});

test('paused price requests retry automatically after backoff without rereading broker pages',async t=>{
 const f=fixture(t);f.service.start('a',{});await f.service.sync('a');f.advance();f.source.bad=true;await f.service.sync('a');const calls=f.calls.length;
 assert.equal(f.service.read('a').status,'paused');f.source.bad=false;await f.service.sync('a');assert.equal(f.service.read('a').status,'paused');f.advance();await f.service.sync('a');assert.equal(f.service.read('a').status,'ready');assert.equal(f.calls.length,calls);
});

test('corporate-action blockers retain a complete import; legacy failures resume calculation without a broker reread',async t=>{
 const f=fixture(t);f.input.orders[0].fill.type='STOCK_SPLIT';f.service.start('a',{});await f.service.sync('a');f.advance();await f.service.sync('a');
 const blocked=f.service.read('a');assert.equal(blocked.status,'blocked');assert.equal(blocked.stage,'validation');assert.equal(blocked.pages,3);assert.equal(blocked.records,5);assert.equal(blocked.historyComplete,true);assert.equal(blocked.canResume,true);assert.match(blocked.message,/corporate actions/);assert.deepEqual(blocked.points,[]);
 const old=JSON.parse(f.db.prepare('SELECT state FROM portfolio_rebuild_state').get().state);old.status='unavailable';old.retryAt=0;delete old.stage;f.db.prepare('UPDATE portfolio_rebuild_state SET state=?').run(JSON.stringify(old));
 f.restart();f.service.start('a',{});await f.service.sync('a');assert.equal(f.calls.length,3);assert.equal(f.service.read('a').status,'blocked');assert.equal(f.service.read('a').pages,3);assert.deepEqual(f.service.values('a'),[]);
 // A changed connection must never resume another credential generation's scan.
 f.connect();assert.equal(f.service.read('a').canResume,false);f.a.snapshot.fetchedAt=new Date(f.options.now()).toISOString();f.service.start('a',{});assert.equal(f.service.read('a').pages,0);assert.notEqual(JSON.parse(f.db.prepare('SELECT state FROM portfolio_rebuild_state').get().state).scan,old.scan);
});

test('a malformed page rolls back its rows and cursor together, then resumes that page only',async t=>{
 const f=fixture(t);let invalid=true;f.options.request=async path=>{
   f.calls.push(path);return path.includes('/orders')?{items:f.input.orders,nextPagePath:null}:path.includes('/transactions')?{items:invalid?[f.input.transactions[0],{amount:123}]:f.input.transactions,nextPagePath:null}:{items:f.input.dividends,nextPagePath:null};
 };f.restart();f.service.start('a',{});await f.service.sync('a');assert.equal(f.service.read('a').status,'blocked');assert.equal(f.service.read('a').pages,1);assert.equal(f.service.read('a').records,2);
 invalid=false;f.restart();f.service.start('a',{});await f.service.sync('a');f.advance();await f.service.sync('a');assert.equal(f.service.read('a').status,'ready');assert.equal(f.calls.filter(path=>path.includes('/orders')).length,1);assert.equal(f.service.read('a').records,5);
});

test('completed instrument prices survive a later price failure and disk restart',async t=>{
 const f=fixture(t,{disk:true}),keys=[];let outage=true;
 f.input.orders.push({...trade(5,'BUY',1,100,'2026-10-20T15:00Z'),order:{id:5,side:'BUY',status:'FILLED',instrument:{ticker:'TSLA_US_EQ',name:'Tesla',currency:'USD',isin:'US88160R1014'}}});f.input.snapshot.cash-=100;f.input.snapshot.holdings.push({ticker:'TSLA_US_EQ',quantity:1});
 f.options.prices=async key=>{keys.push(key);if(key==='NASDAQ:TSLA'&&outage)throw Error('Price service unavailable');return key==='NASDAQ:AMD'?priceHistory():{...priceHistory(),points:priceHistory().points.map(p=>({...p,value:100}))};};
 f.restart();f.service.start('a',{});await f.service.sync('a');f.advance();await f.service.sync('a');assert.equal(f.service.read('a').status,'paused');assert.equal(f.service.read('a').priced,1);
 f.restart(true);outage=false;f.advance();await f.service.sync('a');assert.equal(f.service.read('a').status,'ready');assert.deepEqual(keys,['NASDAQ:AMD','NASDAQ:TSLA','NASDAQ:TSLA']);assert.equal(f.calls.length,3);assert.equal(f.service.values('a').at(-1).value,1093);
});
