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
import {parsePortfolioPrices,resolveSymbol,resolvePortfolioPriceSymbol,supportsChart,createMarketService} from '../server/market-data.mjs';
import {portfolioHistoryListing,portfolioCatalogListing,portfolioListing} from '../src/data/portfolio-listings.mjs';
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
 return {get db(){return db;},options,a,input,source,calls,get service(){return service;},advance:(ms=61000)=>now+=ms,restart:(reopen=false)=>{if(reopen){db.close();db=new DatabaseSync(file);}service=createPortfolioRebuild(db,options);},connect:()=>generation='two'};
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

const vuaa={ticker:'VUAAl_EQ',isin:'IE00BFMXXD54',instrumentCurrency:'USD'};
const eqac={ticker:'EQACs_EQ',isin:'IE00BFZXGZ54',instrumentCurrency:'USD'};
test('Swiss accumulating EQAC is identified by broker ID, ISIN and USD without changing chart or trade mappings',()=>{
 assert.equal(portfolioHistoryListing(eqac).id,'SIX:EQAC');
 for(const change of [{isin:''},{isin:'IE0032077012'},{instrumentCurrency:'CHF'},{instrumentCurrency:'EUR'},{ticker:'EQACl_EQ'},{ticker:'EQAC_US_EQ'},{ticker:'EQACS_EQ'}])assert.equal(portfolioHistoryListing({...eqac,...change}),null);
 assert.equal(portfolioListing(eqac),null);assert.equal(resolveSymbol('SIX:EQAC'),null);assert.equal(supportsChart('SIX:EQAC','D'),false);
});
test('broker catalog automatically resolves supported exact listings without using the watchlist',()=>{
 const catalog=[{ticker:eqac.ticker,shortName:'EQAC',isin:eqac.isin,currencyCode:'USD',type:'ETF',exchange:'SIX Swiss Exchange'},
  {ticker:'MSFT_US_EQ',shortName:'MSFT',isin:'US5949181045',currencyCode:'USD',type:'STOCK',exchange:'NASDAQ'}];
 assert.equal(portfolioCatalogListing(eqac,catalog).id,'SIX:EQAC');
 const h={ticker:'MSFT_US_EQ',isin:'US5949181045',instrumentCurrency:'USD'};
 assert.deepEqual(portfolioCatalogListing(h,catalog).providerCheck,{exchange:'NASDAQ',currency:'USD',type:'EQUITY'});
 for(const change of [{isin:'US5949181046'},{currencyCode:'CHF'},{type:'WARRANT'},{exchange:'Unknown'},{shortName:'QQQ'},{shortName:'EQAC.SW'}])assert.equal(portfolioCatalogListing(eqac,[{...catalog[0],...change}]),null);
 assert.equal(portfolioCatalogListing(eqac,[catalog[0],catalog[0]]),null);
 assert.equal(portfolioCatalogListing({...eqac,isin:''},catalog),null);
 assert.equal(portfolioCatalogListing(eqac,[{...catalog[0],exchange:'London Stock Exchange'}]),null);
 for(const exchange of ['constructor','__proto__','toString']){
  assert.equal(portfolioCatalogListing(eqac,[{...catalog[0],exchange}]),null);
  assert.equal(resolvePortfolioPriceSymbol(exchange+':TEST',{exchange,currency:'USD',type:'ETF'}),null);
 }
});
test('historical listings identify USD London VUAA and NYSE Visa without borrowing another share class',()=>{
 assert.equal(portfolioHistoryListing(vuaa).id,'LSE:VUAA');
 assert.equal(portfolioHistoryListing({ticker:'V_US_EQ',isin:'US92826C8394',instrumentCurrency:'USD'}).id,'NYSE:V');
 assert.equal(portfolioHistoryListing({ticker:'V_US_EQ',isin:'WRONG',instrumentCurrency:'USD'}),null);
 for(const change of [{isin:''},{isin:'WRONG'},{instrumentCurrency:'GBP'},{instrumentCurrency:'GBp'},{instrumentCurrency:'EUR'},{ticker:'VUAGl_EQ'},{ticker:'VUAAd_EQ'},{ticker:'VUAA'},{ticker:'VUAAL_EQ'}])
  assert.equal(portfolioHistoryListing({...vuaa,...change}),null);
 assert.equal(portfolioListing(vuaa),null);assert.equal(resolveSymbol('LSE:VUAA'),null);assert.equal(supportsChart('LSE:VUAA','D'),false);
 assert.equal(resolvePortfolioPriceSymbol('LSE:VUAG'),null);assert.equal(resolvePortfolioPriceSymbol('XETR:VUAA'),null);
});
function londonPayload(dates=['2026-10-20T07:00Z','2026-10-21T07:00Z']){
 const payload=pricesPayload(),r=payload.chart.result[0];
 Object.assign(r.meta,{symbol:'VUAA.L',currency:'USD',exchangeName:'LSE',instrumentType:'ETF',exchangeTimezoneName:'Europe/London'});
 delete r.meta.currentTradingPeriod;delete r.events;
 r.timestamp=dates.map(d=>time(d)/1000);const closes=dates.map((_,i)=>100+i);
 r.indicators.quote[0]={open:closes,close:closes,low:closes,high:closes};return payload;
}
function swissPayload(dates){const p=londonPayload(dates);Object.assign(p.chart.result[0].meta,{symbol:'EQAC.SW',exchangeName:'EBS',exchangeTimezoneName:'Europe/Zurich'});return p;}
test('Swiss daily history verifies exchange, currency and type and respects local dates and different US/European DST dates',()=>{
 const asset=resolvePortfolioPriceSymbol('SIX:EQAC'),p=swissPayload(['2026-07-03T07:00Z','2026-10-26T08:00Z','2026-11-02T08:00Z']),cutoff=time('2026-11-02T21:00Z');
 assert.deepEqual(parsePortfolioPrices(p,asset,cutoff).points.map(p=>new Date(p.at).toISOString()),['2026-07-03T20:00:00.000Z','2026-10-26T20:00:00.000Z','2026-11-02T21:00:00.000Z']);
 assert.equal(parsePortfolioPrices(p,asset,cutoff-1).points.length,2);
 for(const meta of [{symbol:'EQAC.MI'},{currency:'CHF'},{currency:'EUR'},{exchangeName:'LSE'},{instrumentType:'EQUITY'},{exchangeTimezoneName:'Europe/London'}]){const bad=swissPayload();Object.assign(bad.chart.result[0].meta,meta);assert.throws(()=>parsePortfolioPrices(bad,asset,NOW));}
 p.chart.result[0].meta.currentTradingPeriod={regular:{end:cutoff/1000+3600}};assert.equal(parsePortfolioPrices(p,asset,cutoff+7200000).points.length,2);
});
test('catalog-derived history checks identity again even when the raw Yahoo response is cached',async()=>{
 const calls=[],p=swissPayload(),check={exchange:'SIX',currency:'USD',type:'ETF'},service=createMarketService({now:()=>NOW,fetcher:async url=>{calls.push(url);return new Response(JSON.stringify(p));}});
 p.chart.result[0].meta.symbol='TEST.SW';
 assert.equal(resolvePortfolioPriceSymbol('SIX:TEST'),null);assert.equal(resolvePortfolioPriceSymbol('SIX:TEST',check).symbol,'TEST.SW');
 assert.equal((await service.portfolioPrices('SIX:TEST',NOW-10*day,NOW,check)).points.length,2);
 await service.portfolioPrices('SIX:TEST',NOW-10*day,NOW,check);assert.equal(calls.length,1);assert.equal(new URL(calls[0]).pathname,'/v8/finance/chart/TEST.SW');
 for(const bad of [{...check,currency:'CHF'},{...check,exchange:'LSE'},{...check,type:'EQUITY'}])await assert.rejects(()=>service.portfolioPrices('SIX:TEST',NOW-10*day,NOW,bad));
 const us=pricesPayload();Object.assign(us.chart.result[0].meta,{symbol:'MSFT',exchangeName:'NMS',exchangeTimezoneName:'America/New_York',instrumentType:'EQUITY'});
 const svc=createMarketService({now:()=>NOW,fetcher:async()=>new Response(JSON.stringify(us))});
 await svc.portfolioPrices('NASDAQ:MSFT',NOW-10*day,NOW,{exchange:'NASDAQ',currency:'USD',type:'EQUITY'});
 await assert.rejects(()=>svc.portfolioPrices('NYSE:MSFT',NOW-10*day,NOW,{exchange:'NYSE',currency:'USD',type:'EQUITY'}),/identity/);
});
test('missing provider listings are distinguishable from temporary outages',async()=>{
 const missing=createMarketService({now:()=>NOW,fetcher:async()=>new Response('',{status:404})});
 await assert.rejects(()=>missing.portfolioPrices('SIX:EQAC',NOW-10*day,NOW),e=>e.status===404);
 const wrong=swissPayload();wrong.chart.result[0].meta.currency='CHF';const mismatch=createMarketService({now:()=>NOW,fetcher:async()=>new Response(JSON.stringify(wrong))});
 await assert.rejects(()=>mismatch.portfolioPrices('SIX:EQAC',NOW-10*day,NOW),e=>e.status===422);
});
test('London daily history uses the account valuation time across DST without US holiday filtering or future values',()=>{
 const asset=resolvePortfolioPriceSymbol('LSE:VUAA');
 const dates=['2026-07-03T07:00Z','2026-10-23T07:00Z','2026-10-26T08:00Z','2026-11-02T08:00Z']; // July 3 is a US holiday, not a London holiday.
 const payload=londonPayload(dates),cutoff=time('2026-11-02T21:00Z');
 const history=parsePortfolioPrices(payload,asset,cutoff);
 assert.deepEqual(history.points.map(p=>new Date(p.at).toISOString()),['2026-07-03T20:00:00.000Z','2026-10-23T20:00:00.000Z','2026-10-26T20:00:00.000Z','2026-11-02T21:00:00.000Z']);
 assert.deepEqual(history.points.map(p=>p.value),[100,101,102,103]); // Never the dividend-adjusted series.
 assert.equal(parsePortfolioPrices(payload,asset,cutoff-1).points.length,3);
 assert.equal(parsePortfolioPrices(payload,asset,time('2026-11-02T10:00Z')).points.length,3);
 payload.chart.result[0].meta.currentTradingPeriod={regular:{end:time('2026-11-02T22:00Z')/1000}};
 assert.equal(parsePortfolioPrices(payload,asset,cutoff).points.length,3); // A supplied later session end is respected.
 assert.equal(parsePortfolioPrices(payload,asset,cutoff+2*3600000).points.length,3); // Never backdate a later close into an earlier account value.
});
test('London daily history rejects a different symbol, currency, exchange, instrument or ambiguous daily bar',()=>{
 const asset=resolvePortfolioPriceSymbol('LSE:VUAA');
 for(const meta of [{symbol:'VUAG.L'},{currency:'GBp'},{currency:'EUR'},{exchangeName:'GER'},{instrumentType:'EQUITY'},{exchangeTimezoneName:'America/New_York'},{dataGranularity:'1h'}]){
  const payload=londonPayload();Object.assign(payload.chart.result[0].meta,meta);assert.throws(()=>parsePortfolioPrices(payload,asset,NOW));
 }
 assert.throws(()=>parsePortfolioPrices(londonPayload(['2026-10-20T07:00Z','2026-10-20T07:00Z']),asset,NOW),/Duplicate/);
 const missing=londonPayload();missing.chart.result[0].indicators.quote[0].close=[null,null];assert.throws(()=>parsePortfolioPrices(missing,asset,NOW),/No completed/);
});
test('London USD history uses the fixed provider and shared cache without enabling arbitrary overseas listings',async()=>{
 const calls=[],service=createMarketService({now:()=>NOW,fetcher:async url=>{calls.push(url);return new Response(JSON.stringify(londonPayload()),{headers:{'content-type':'application/json'}});}});
 const history=await service.portfolioPrices('LSE:VUAA',NOW-10*day,NOW);assert.equal(history.currency,'USD');assert.equal(history.points.length,2);
 await service.portfolioPrices('LSE:VUAA',NOW-10*day,NOW);assert.equal(calls.length,1);
 const url=new URL(calls[0]);assert.equal(url.host,'query1.finance.yahoo.com');assert.equal(url.pathname,'/v8/finance/chart/VUAA.L');assert.equal(url.searchParams.get('interval'),'1d');assert.equal(url.searchParams.get('events'),'splits');
 await assert.rejects(()=>service.portfolioPrices('LSE:VUAG',NOW-10*day,NOW),/unsupported/);assert.equal(calls.length,1);
});
test('a saved price-listing blocker resumes with retained imports, anchor and earlier prices after restart',async t=>{
 const f=fixture(t,{disk:true}),visa={ticker:'V_US_EQ',name:'Visa',currency:'USD',isin:'US92826C8394'};
 // Retain the original AMD position and add two independent USD listings.
 f.input.orders.push({...trade(3,'BUY',1,100,'2026-10-20T14:00Z'),order:{id:3,side:'BUY',status:'FILLED',instrument:{...vuaa,currency:'USD',name:'USD fund'}}},
  {...trade(4,'BUY',1,100,'2026-10-20T14:00Z'),order:{id:4,side:'BUY',status:'FILLED',instrument:visa}});
 f.input.snapshot.cash-=200;f.input.snapshot.holdings.push({ticker:vuaa.ticker,quantity:1},{ticker:visa.ticker,quantity:1});
 f.service.start('a',{});await f.service.sync('a');
 const saved=JSON.parse(f.db.prepare('SELECT state FROM portfolio_rebuild_state').get().state);
 saved.status='blocked';saved.stage='prices';saved.retryAt=null;saved.priced=1;saved.message='No verified historical price listing';
 f.db.prepare('UPDATE portfolio_rebuild_state SET state=?').run(JSON.stringify(saved));
 f.db.prepare('INSERT INTO portfolio_rebuild_items VALUES(?,?,?,?,?)').run('a',saved.scan,'prices','AMD_US_EQ',JSON.stringify(priceHistory()));
 const oldRows=f.db.prepare('SELECT * FROM portfolio_rebuild_items ORDER BY kind,item_id').all(),priceCalls=[];
 f.options.prices=async key=>{priceCalls.push(key);assert.ok(['LSE:VUAA','NYSE:V'].includes(key));return priceHistory();};
 f.restart(true);f.service.start('a',{});await f.service.sync('a');
 assert.deepEqual(priceCalls,['LSE:VUAA','NYSE:V']);assert.equal(f.calls.length,3);assert.equal(f.service.read('a').status,'ready');assert.equal(f.service.read('a').pages,3);assert.equal(f.service.read('a').anchorAt,saved.anchor.fetchedAt);
 const rows=f.db.prepare('SELECT * FROM portfolio_rebuild_items ORDER BY kind,item_id').all();for(const row of oldRows)assert.deepEqual(rows.find(r=>r.kind===row.kind&&r.item_id===row.item_id),row);
 assert.deepEqual(f.service.values('a').map(p=>p.value),[1000,1070,1142,1123]);
 f.restart(true);assert.equal(f.service.read('a').status,'ready');assert.equal(f.service.values('a').at(-1).value,1123);
});

function addHolding(f,ticker,isin='',name=ticker){
 const id=f.input.orders.length+10;
 f.input.orders.push({...trade(id,'BUY',1,100,'2026-10-20T14:00Z'),order:{id,side:'BUY',status:'FILLED',instrument:{ticker,isin,name,currency:'USD'}}});
 f.input.snapshot.cash-=100;f.input.snapshot.holdings.push({ticker,quantity:1});
}
test('24 instruments progress in bounded batches without minute waits and resume saved prices after restart',async t=>{
 const f=fixture(t,{disk:true}),keys=[];
 f.input.transactions[0].amount+=3000;f.input.snapshot.cash+=3000;
 const listings=Array.from({length:23},(_,i)=>{const symbol='FIX'+i;addHolding(f,symbol+'_US_EQ');return {id:'NASDAQ:'+symbol,symbol,ticker:symbol,exchange:'NASDAQ',group:'STOCKS'};});
 f.options.prices=async key=>{keys.push(key);return priceHistory();};f.restart();
 f.service.start('a',{listings});await f.service.sync('a');const anchor=f.service.read('a').anchorAt;
 for(let batch=1;batch<=12;batch++){
  const wait=f.service.read('a').retryAt-f.options.now();assert.equal(wait,1000);
  await f.service.sync('a');assert.equal(keys.length,(batch-1)*2,'deadline prevents early requests');
  f.advance(wait);await f.service.sync('a');assert.equal(keys.length,batch*2);assert.equal(f.service.read('a').priced,batch*2);
  if(batch===3)f.restart(true);
 }
 assert.equal(f.service.read('a').status,'ready');assert.equal(f.service.read('a').anchorAt,anchor);assert.equal(f.calls.length,3);
 assert.equal(new Set(keys).size,24);assert.equal(f.options.now()-NOW,12000);assert.equal(f.service.read('a').retryAt,null);
});
test('broker-page spacing and provider retry deadlines still apply to fast price batches',async t=>{
 const f=fixture(t,{disk:true});let page=0;
 f.options.request=async path=>{f.calls.push(path);return {items:[],nextPagePath:'/equity/history/orders?cursor='+(++page)+'&limit=50'};};
 f.restart();f.service.start('a',{});await f.service.sync('a');assert.equal(f.calls.length,3);assert.equal(f.service.read('a').retryAt-NOW,60000);
 f.advance(1000);await f.service.sync('a');assert.equal(f.calls.length,3);
 f.service.remove('a');f.options.request=async path=>({items:path.includes('/orders')?f.input.orders:path.includes('/transactions')?f.input.transactions:f.input.dividends,nextPagePath:null});
 let priceCalls=0;f.options.prices=async()=>{priceCalls++;throw Object.assign(Error('Rate limited'),{status:429,retryMs:300000});};f.restart();
 f.service.start('a',{});await f.service.sync('a');f.advance(1000);await f.service.sync('a');const paused=f.service.read('a');
 assert.equal(paused.status,'paused');assert.equal(paused.retryAt-f.options.now(),300000);
 f.restart(true);f.advance(299999);await f.service.sync('a');assert.equal(priceCalls,1);
 f.options.prices=async()=>{priceCalls++;return priceHistory();};f.restart();f.advance(1);await f.service.sync('a');assert.equal(priceCalls,2);assert.equal(f.service.read('a').status,'ready');
});
test('all missing listings are reported together while supported instruments after them still get saved',async t=>{
 const f=fixture(t,{disk:true});addHolding(f,'UNKNOWN_US_EQ');addHolding(f,eqac.ticker,eqac.isin);addHolding(f,'SECOND_US_EQ');addHolding(f,'TSLA_US_EQ','US88160R1014');
 const prices=[];f.options.prices=async key=>{prices.push(key);return priceHistory();};f.restart();f.service.start('a',{});await f.service.sync('a');f.advance();await f.service.sync('a');
 let r=f.service.read('a');assert.equal(r.status,'loading');assert.equal(r.priced,2);assert.deepEqual(r.listingChecks.filter(i=>i.status==='unmatched').map(i=>i.ticker),['UNKNOWN_US_EQ','SECOND_US_EQ']);
 f.restart(true);f.advance();await f.service.sync('a');r=f.service.read('a');assert.equal(r.status,'blocked');assert.equal(r.priced,3);assert.equal(r.instruments,5);assert.deepEqual(prices,['NASDAQ:AMD','SIX:EQAC','NASDAQ:TSLA']);assert.equal(f.calls.length,3);assert.equal(r.points.length,0);
 const rows=f.db.prepare('SELECT * FROM portfolio_rebuild_items ORDER BY kind,item_id').all(),anchor=r.anchorAt;
 f.service.start('a',{listings:['UNKNOWN','SECOND'].map(symbol=>({id:'NASDAQ:'+symbol,symbol,ticker:symbol,exchange:'NASDAQ',group:'STOCKS'}))});await f.service.sync('a');
 assert.equal(f.service.read('a').status,'ready');assert.equal(f.service.read('a').anchorAt,anchor);assert.equal(f.calls.length,3);assert.deepEqual(prices.slice(3),['NASDAQ:UNKNOWN','NASDAQ:SECOND']);
 for(const row of rows)assert.deepEqual(f.db.prepare('SELECT * FROM portfolio_rebuild_items WHERE account_id=? AND scan=? AND kind=? AND item_id=?').get(row.account_id,row.scan,row.kind,row.item_id),row);
});
test('automatic catalog matching runs once in a separate pass and persists across restart without rereading trades',async t=>{
 const f=fixture(t,{disk:true});addHolding(f,'MSFT_US_EQ','US5949181045');let catalogs=0;const prices=[];
 f.options.readListings=async()=>{catalogs++;return [{ticker:'MSFT_US_EQ',shortName:'MSFT',isin:'US5949181045',currencyCode:'USD',type:'STOCK',exchange:'NASDAQ'}];};
 f.options.prices=async(key,from,to,expected)=>{prices.push(key);if(key==='NASDAQ:MSFT')assert.deepEqual(expected,{exchange:'NASDAQ',currency:'USD',type:'EQUITY'});return priceHistory();};
 f.restart();f.service.start('a',{});await f.service.sync('a');f.advance();await f.service.sync('a');assert.equal(catalogs,1);assert.equal(prices.length,0);assert.equal(f.service.read('a').stage,'listings');
 f.restart(true);f.advance();await f.service.sync('a');assert.equal(catalogs,1);assert.equal(f.calls.length,3);assert.equal(f.service.read('a').status,'ready');assert.deepEqual(prices,['NASDAQ:AMD','NASDAQ:MSFT']);
});
test('metadata denial still saves supported prices and retry can resolve the remaining listing',async t=>{
 const f=fixture(t);addHolding(f,'MSFT_US_EQ','US5949181045');let denied=true;
 f.options.readListings=async()=>{if(denied)throw Object.assign(Error('denied'),{status:403});return [{ticker:'MSFT_US_EQ',shortName:'MSFT',isin:'US5949181045',currencyCode:'USD',type:'STOCK',exchange:'NASDAQ'}];};f.options.prices=async()=>priceHistory();
 f.restart();f.service.start('a',{});await f.service.sync('a');f.advance();await f.service.sync('a');f.advance();await f.service.sync('a');
 assert.equal(f.service.read('a').status,'blocked');assert.equal(f.service.read('a').priced,1);assert.match(f.service.read('a').listingMessage,/Metadata/);
 denied=false;f.service.start('a',{});await f.service.sync('a');f.advance();await f.service.sync('a');assert.equal(f.service.read('a').status,'ready');assert.equal(f.service.read('a').listingMessage,null);assert.equal(f.calls.length,3);
});
test('a per-instrument source failure cannot prevent later instruments from being priced',async t=>{
 const f=fixture(t,{disk:true});addHolding(f,eqac.ticker,eqac.isin);addHolding(f,'TSLA_US_EQ','US88160R1014');let missing=true;const keys=[];
 f.options.prices=async key=>{keys.push(key);if(missing&&key==='SIX:EQAC')throw Object.assign(Error('Source has no history for SIX:EQAC'),{status:404});return priceHistory();};f.restart();f.service.start('a',{});await f.service.sync('a');f.advance();await f.service.sync('a');
 assert.equal(f.service.read('a').listingChecks.find(i=>i.ticker===eqac.ticker).status,'unavailable');assert.equal(f.service.read('a').status,'loading');f.restart(true);f.advance();await f.service.sync('a');assert.equal(f.service.read('a').priced,2);assert.equal(f.service.read('a').status,'blocked');assert.equal(f.service.values('a').length,0);
 missing=false;f.service.start('a',{});await f.service.sync('a');assert.equal(f.service.read('a').status,'ready');assert.deepEqual(keys,['NASDAQ:AMD','SIX:EQAC','NASDAQ:TSLA','SIX:EQAC']);assert.equal(f.calls.length,3);
});
test('a changed connection during catalog lookup cannot commit old identities or issue price requests',async t=>{
 const f=fixture(t);addHolding(f,'MSFT_US_EQ','US5949181045');f.options.readListings=async()=>{f.connect();return [];};f.restart();f.service.start('a',{});await f.service.sync('a');f.advance();await f.service.sync('a');
 const state=JSON.parse(f.db.prepare('SELECT state FROM portfolio_rebuild_state').get().state);assert.equal(state.catalogChecked,undefined);assert.equal(state.priced,0);
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
 const f=fixture(t);f.input.orders[0].fill.type='STOCK_TRANSFER';f.service.start('a',{});await f.service.sync('a');f.advance();await f.service.sync('a');
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

// Synthetic quantities/costs: a paired replacement must not become a cash trade.
function splitFixture(ratio=10){
 const stock={ticker:'NFLX_US_EQ',name:'Netflix',currency:'USD',isin:'US64110L1061'},at='2025-11-17T08:30:00Z';
 const execution=(id,side,quantity,netValue,filledAt)=>{const row=trade(id,side,quantity,netValue,filledAt);row.order.instrument={...stock};return row;};
 const sell=execution(2,'SELL',-.25,250,at),buy=execution(3,'BUY',.25*ratio,250,at);
 sell.fill={...sell.fill,type:'STOCK_SPLIT',price:1000};buy.fill={...buy.fill,type:'STOCK_SPLIT',price:1000/ratio};
 const input={snapshot:{source:'api',brokerId:'1',currency:'USD',cash:1025,accountValue:1025,fetchedAt:'2025-11-20T22:00:00Z',holdings:[]},transactions:[{reference:'deposit',type:'DEPOSIT',currency:'USD',amount:1000,dateTime:'2025-11-14T12:00:00Z'}],dividends:[],orders:[execution(1,'BUY',.25,250,'2025-11-14T15:00:00Z'),buy,sell,execution(4,'SELL',.25*ratio,275,'2025-11-19T15:00:00Z')]};
 const history={currency:'USD',shareBasis:'historical',splitAdjustments:[{at:time('2025-11-17T14:30:00Z'),ratio}],points:['14','17','18','19','20'].map((d,i)=>({at:time(`2025-11-${d}T21:00:00Z`),value:[1000,1000/ratio,1080/ratio,1100/ratio,1110/ratio][i]}))};
 return {input,history};
}
test('paired forward and reverse splits preserve cash and valuation before subsequent sales',()=>{
 for(const ratio of [10,.1]){
  const {input,history}=splitFixture(ratio),ledger=portfolioLedger(input);
  assert.equal(ledger.cash,1025);assert.equal(ledger.splits.length,1);assert.equal(ledger.events.filter(e=>e.split).length,1);assert.equal(ledger.events.find(e=>e.split).cash,0);
  const points=rebuildPortfolioValues(ledger,{NFLX_US_EQ:history},'USD');assert.deepEqual(points.map(p=>p.value),[1000,1000,1000,1000,1020,1025,1025]);
 }
});
test('a split also reconciles an open holding and repeated splits',()=>{
 const {input,history}=splitFixture();input.orders.pop();input.snapshot.cash=750;input.snapshot.holdings=[{ticker:'NFLX_US_EQ',quantity:2.5}];
 const sell=structuredClone(input.orders[2]),buy=structuredClone(input.orders[1]);
 sell.fill={...sell.fill,id:5,quantity:-2.5,price:100,filledAt:'2025-11-18T08:30:00Z'};buy.fill={...buy.fill,id:6,quantity:5,price:50,filledAt:sell.fill.filledAt};input.orders.push(sell,buy);input.snapshot.holdings[0].quantity=5;
 history.splitAdjustments.push({at:time('2025-11-18T14:30:00Z'),ratio:2});history.points.slice(2).forEach(p=>p.value/=2);
 const ledger=portfolioLedger(input);assert.equal(ledger.splits.length,2);assert.deepEqual(rebuildPortfolioValues(ledger,{NFLX_US_EQ:history},'USD').map(p=>p.value),[1000,1000,1000,1000,1020,1025,1027.5]);
});
test('eight-decimal fractional split shares tolerate cent-rounded cost records without changing cash',()=>{
 const {input,history}=splitFixture();
 for(const row of input.orders){row.fill.quantity=Math.sign(row.fill.quantity)*(row.fill.id===1||row.fill.id===2?.01234567:.1234567);row.fill.walletImpact.netValue=row.fill.id===4?13.58:12.35;}
 input.snapshot.cash=1001.23;
 const ledger=portfolioLedger(input),values=rebuildPortfolioValues(ledger,{NFLX_US_EQ:history},'USD');
 assert.ok(Math.abs(ledger.cash-1001.23)<1e-9);assert.ok(Math.abs(values[0].value-values[3].value)<1e-9);assert.ok(Math.abs(values.at(-1).value-1001.23)<1e-9);
});
test('unpaired, ambiguous, mismatched or partial replacements cannot publish split history',()=>{
 for(const change of [
  i=>i.orders.splice(1,1),i=>i.orders[1].fill.filledAt='2025-11-17T08:31:00Z',i=>i.orders[1].fill.price=101,
  i=>i.orders[1].fill.walletImpact.netValue=251,i=>i.orders[1].fill.quantity=-2.5,i=>i.orders[2].fill.quantity=.25,
  i=>i.orders[1].order.status='PARTIALLY_FILLED',i=>i.orders[1].order.instrument.isin='DIFFERENT',
  i=>{i.orders[0].fill.quantity=.5;},i=>i.orders.push({...structuredClone(i.orders[1]),fill:{...i.orders[1].fill,id:5}}),
  i=>i.orders[2].fill.type='STOCK_TRANSFER',i=>i.orders[1].fill.walletImpact.currency='EUR'
 ]){const {input}=splitFixture();change(input);assert.throws(()=>portfolioLedger(input));}
});
test('split dates, ratios and historical price basis must agree with the price source',()=>{
 for(const change of [h=>delete h.splitAdjustments,h=>h.splitAdjustments=[],h=>h.shareBasis='adjusted',h=>h.splitAdjustments[0].ratio=2,h=>h.splitAdjustments[0].at+=day,h=>h.splitAdjustments.push({...h.splitAdjustments[0]})]){
  const {input,history}=splitFixture();change(history);assert.throws(()=>rebuildPortfolioValues(portfolioLedger(input),{NFLX_US_EQ:history},'USD'),/split date or ratio/);
 }
 const {input,history}=splitFixture();history.points.splice(1,1);assert.throws(()=>rebuildPortfolioValues(portfolioLedger(input),{NFLX_US_EQ:history},'USD'),/price after the stock split/);
});
test('future split rows do not enter an older anchor, and intraday replacements remain unsupported',()=>{
 const {input}=splitFixture();input.snapshot.fetchedAt='2025-11-14T22:00:00Z';input.snapshot.cash=750;input.snapshot.holdings=[{ticker:'NFLX_US_EQ',quantity:.25}];assert.equal(portfolioLedger(input).splits.length,0);
 const current=splitFixture();current.input.orders[1].fill.filledAt=current.input.orders[2].fill.filledAt='2025-11-17T16:00:00Z';assert.throws(()=>rebuildPortfolioValues(portfolioLedger(current.input),{NFLX_US_EQ:current.history},'USD'),/split date or ratio/);
});
test('split-adjusted Yahoo prices and broker share replacements produce no artificial split-day loss',()=>{
 const {input,history}=splitFixture(),payload=yahooPayload('NFLX'),r=payload.chart.result[0];
 r.meta.dataGranularity='1d';r.timestamp=['14','17','18','19','20'].map(d=>time(`2025-11-${d}T14:30:00Z`)/1000);
 const closes=[100,100,108,110,111];r.indicators.quote[0]={open:closes,close:closes,low:closes,high:closes,volume:closes.map(()=>100)};
 r.events={splits:{one:{date:history.splitAdjustments[0].at/1000,numerator:10,denominator:1}}};
 const parsed=parsePortfolioPrices(payload,resolveSymbol('NASDAQ:NFLX'),time(input.snapshot.fetchedAt));assert.equal(parsed.points[0].value,1000);assert.equal(parsed.shareBasis,'historical');assert.deepEqual(parsed.splitAdjustments,history.splitAdjustments);
 assert.deepEqual(rebuildPortfolioValues(portfolioLedger(input),{NFLX_US_EQ:parsed},'USD').map(p=>p.value),[1000,1000,1000,1000,1020,1025,1025]);
});
test('a saved legacy split blocker resumes after restart without reading broker pages again',async t=>{
 const f=fixture(t,{disk:true}),{input,history}=splitFixture();Object.assign(f.input,input);f.a.snapshot=input.snapshot;f.options.now=()=>time(input.snapshot.fetchedAt);let verified=false,priceCalls=0;
 f.options.prices=async key=>{assert.equal(key,'NASDAQ:NFLX');priceCalls++;return verified?history:{...history,splitAdjustments:[]};};
 f.restart();f.service.start('a',{});await f.service.sync('a');
 const saved=JSON.parse(f.db.prepare('SELECT state FROM portfolio_rebuild_state').get().state);saved.status='blocked';saved.stage='validation';saved.retryAt=null;f.db.prepare('UPDATE portfolio_rebuild_state SET state=?').run(JSON.stringify(saved));
 f.restart(true);f.service.start('a',{});await f.service.sync('a');assert.equal(f.service.read('a').status,'blocked');assert.equal(f.service.read('a').priced,0);assert.match(f.service.read('a').message,/split date or ratio/);
 verified=true;f.restart(true);f.service.start('a',{});await f.service.sync('a');
 assert.equal(f.calls.length,3);assert.equal(priceCalls,2);assert.equal(f.service.read('a').status,'ready');assert.equal(f.service.read('a').pages,3);assert.equal(f.service.read('a').anchorAt,input.snapshot.fetchedAt);assert.equal(f.service.read('a').from,time('2025-11-14T21:00:00Z'));assert.equal(f.service.values('a').at(-1).value,1025);
 f.restart(true);assert.equal(f.service.read('a').status,'ready');assert.equal(f.service.values('a').length,7);
});
