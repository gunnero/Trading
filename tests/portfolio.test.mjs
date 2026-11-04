import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openAuthStore} from '../server/auth.mjs';
import {createPortfolioService,normalizeTrading212} from '../server/portfolio.mjs';
import {normalizePortfolioSnapshot,portfolioStatus,portfolioTotals,portfolioPerformance,portfolioReturnTotals} from '../src/data/portfolio.mjs';
import {portfolioListing,portfolioAverageLine} from '../src/data/portfolio-listings.mjs';

const summary={id:12345,currency:'EUR',totalValue:340,cash:{availableToTrade:10,reservedForOrders:20,inPies:10},investments:{currentValue:300,totalCost:320,unrealizedProfitLoss:-20,realizedProfitLoss:45}};
const positions=[{instrument:{ticker:'TEST_US_EQ',name:'Fixture company',currency:'USD',isin:'US1234567890'},quantity:2.12345678,averagePricePaid:180,currentPrice:170,walletImpact:{currency:'EUR',currentValue:300,totalCost:320,unrealizedProfitLoss:-20,fxImpact:3}}];
const snapshot={version:1,currency:'USD',accountValue:1100,cash:100,holdings:[{ticker:'TEST',name:'Fixture',quantity:2.5,value:1000,unrealized:100,cost:900}],sourceLabel:'Isolated screenshot fixture'};
const credentials={apiKey:'fixture-key-12345',apiSecret:'fixture-secret-67890',environment:'live',authorized:true};
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
test('returns separate open percentage, combined trading amount and a supplied total percentage',()=>{
 assert.deepEqual(portfolioPerformance({unrealized:100,cost:1000,realized:200,totalReturn:350,returnPercent:42}),{open:100,openPercent:10,trading:300,reported:350,reportedPercent:42});
 assert.deepEqual(portfolioPerformance({unrealized:-20,cost:320,realized:45}),{open:-20,openPercent:-6.25,trading:25,reported:null,reportedPercent:null});
 assert.equal(portfolioPerformance({unrealized:0,cost:100,realized:0}).openPercent,0);
 for(const cost of [0,null,undefined,-1,'100'])assert.equal(portfolioPerformance({unrealized:20,cost,realized:2}).openPercent,null);
 assert.equal(portfolioPerformance({unrealized:20,cost:100}).trading,null);
 assert.equal(portfolioPerformance(null).open,null);
});
test('aggregate open returns weight actual costs, preserve currency and disclose incomplete coverage',()=>{
 const a=(currency,unrealized,cost,environment='live')=>({environment,snapshot:{currency,unrealized,cost}});
 const totals=portfolioReturnTotals([a('USD',10,100),a('USD',20,400),a('EUR',-5,50),a('USD',999,1,'demo'),{snapshot:null}]);
 assert.equal(totals[0].percent,6);assert.equal(totals[0].open,30);assert.equal(totals[1].percent,-10);
 const incomplete=portfolioReturnTotals([a('USD',10,100),a('USD',20,null),a('USD',null,0)])[0];
 assert.equal(incomplete.percent,null);assert.equal(incomplete.open,30);assert.equal(incomplete.known,2);assert.equal(incomplete.accounts,3);
});
test('holding chart matches reject other currencies and conflicting identifiers, retain share classes and support the FB rename',()=>{
 const h={ticker:'FB_US_EQ',instrumentCurrency:'USD',isin:'US30303M1027'};
 assert.equal(portfolioListing(h).id,'NASDAQ:META');
 assert.equal(portfolioListing({...h,ticker:'AMD_US_EQ'}),null);
 assert.equal(portfolioListing({...h,instrumentCurrency:'EUR'}),null);
 assert.equal(portfolioListing({ticker:'SPCX_US_EQ',instrumentCurrency:'USD'}),null);
 assert.equal(portfolioListing({ticker:'GOOG_US_EQ',instrumentCurrency:'USD'}).symbol,'GOOG');
 assert.equal(portfolioListing({ticker:'GOOGL_US_EQ',instrumentCurrency:'USD',isin:'US02079K1079'}),null);
 assert.equal(portfolioListing({ticker:'AMD_DE_EQ',instrumentCurrency:'USD'}),null);
});
test('average overlays need the instrument currency and exact chart symbol, independent of account currency',()=>{
 const h={ticker:'AMD_US_EQ',instrumentCurrency:'USD',averagePrice:90},entry=portfolioListing(h),q={providerSymbol:'AMD',currency:'USD'};
 assert.equal(portfolioAverageLine(h,q,entry).value,90);
 assert.equal(portfolioAverageLine({...h,averagePrice:null},q,entry),null);
 assert.equal(portfolioAverageLine(h,{...q,currency:'EUR'},entry),null);
 assert.equal(portfolioAverageLine(h,{...q,providerSymbol:'AAPL'},entry),null);
 assert.equal(portfolioAverageLine(h,{},entry),null);
});
test('Netflix and QQQ select their own chart identities, and exact watchlist tickers match automatically',()=>{
 const entry=(symbol,exchange='NASDAQ',group='STOCKS')=>({id:`${exchange}:${symbol}`,symbol,ticker:symbol,exchange,group});
 const qqq=entry('QQQ','NASDAQ','FUND'),msft=entry('MSFT'),ko=entry('KO','NYSE'),brk=entry('BRK.B','NYSE');
 const holding=(ticker,extra={})=>({ticker:ticker+'_US_EQ',instrumentCurrency:'USD',...extra});
 assert.equal(portfolioListing(holding('NFLX',{isin:'US64110L1061'}),[qqq]).id,'NASDAQ:NFLX');
 assert.equal(portfolioListing(holding('QQQ')).group,'FUND');assert.equal(portfolioListing(holding('SPY')).id,'NYSEARCA:SPY');
 assert.equal(portfolioListing(holding('MSFT'),[qqq,msft]).id,'NASDAQ:MSFT');
 assert.equal(portfolioListing(holding('KO'),[qqq,ko]).id,'NYSE:KO');
 assert.equal(portfolioListing(holding('BRK.B'),[brk]).id,'NYSE:BRK.B');assert.equal(portfolioListing(holding('BRK'),[brk]),null);
 assert.equal(portfolioListing(holding('MSFT'),[qqq]),null);
 assert.equal(portfolioListing(holding('MSFT'),[msft,entry('MSFT','NYSE')]),null);
 assert.equal(portfolioListing(holding('MSFT',{instrumentCurrency:'EUR'}),[msft]),null);
 assert.equal(portfolioListing(holding('NFLX',{isin:'US0079031078'}),[entry('NFLX')]),null);
 assert.equal(portfolioListing(holding('MSFT',{isin:'US0079031078'}),[msft]),null);
 assert.equal(portfolioListing({ticker:'MSFT_DE_EQ',instrumentCurrency:'USD'},[msft]),null);
 assert.equal(portfolioListing(holding('MSFT'),[entry('MSFT','XETR')]),null);
});
function fixture(t,fetcher=async url=>json(url.endsWith('/summary')?summary:positions)){
  const directory=mkdtempSync(join(tmpdir(),'opening-bell-portfolio-')),auth=openAuthStore({directory});let time=Date.parse('2026-11-03T15:00:00Z');
  let service=createPortfolioService(auth,directory,{fetcher,now:()=>time});
  t.after(()=>{service.close();auth.close();rmSync(directory,{recursive:true,force:true});});
  service.person({name:'Fixture Person'},0);const personId=service.read().data.people[0].id;
  service.account({personId,platform:'Trading 212',label:'Invest'},1);const id=service.read().data.accounts[0].id;
  return {get service(){return service;},auth,directory,id,personId,advance:(ms=61000)=>time+=ms,revision:()=>service.read().revision,restart(){service.close();service=createPortfolioService(auth,directory,{fetcher,now:()=>time});}};
}
test('failed holding reads retain JSON errors and correlate safe diagnostics without exposing account data',async t=>{
 let broken=false;
 const f=fixture(t,async url=>{
   if(url.endsWith('/instruments'))return json([{ticker:'TEST_US_EQ',name:'Fixture company',type:'STOCK',currencyCode:'USD'}]);
   if(broken&&url.endsWith('/summary'))return new Response('private upstream body',{status:429,headers:{'retry-after':'90'}});
   return json(url.endsWith('/summary')?summary:positions);
 });
 await f.service.connect(f.id,credentials,f.revision());f.service.trading.configure(f.id,{enabled:true,authorized:true});broken=true;
 const logs=[];t.mock.method(console,'warn',value=>logs.push(JSON.parse(value)));
 const req={method:'GET',url:`/api/portfolio/accounts/${f.id}/trading/position?ticker=TEST_US_EQ`,headers:{'cf-ray':'abc123-TEST'}},headers={};let body;
 const res={setHeader:(key,value)=>headers[key]=value,end:value=>body=JSON.parse(value)};
 await f.service.middleware(req,res,()=>assert.fail('Unexpected fallthrough'));
 assert.equal(res.statusCode,502);assert.match(headers['Content-Type'],/application\/json/);assert.match(headers['X-Opening-Bell-Request-Id'],/^[a-f0-9-]{36}$/);
 assert.match(body.message,/rate limiting/);assert.equal(body.retryAfterMs,90000);
 assert.deepEqual(logs,[{event:'holding_refresh_failed',requestId:headers['X-Opening-Bell-Request-Id'],status:502,upstreamStatus:429,stage:'balances',ray:'abc123-TEST'}]);
 for(const secret of [credentials.apiKey,credentials.apiSecret,f.id,'TEST_US_EQ','private upstream body'])assert.ok(!JSON.stringify({body,logs}).includes(secret));
});
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

test('confirmed execution refreshes the persisted account snapshot and survives service restart',async t=>{
 let filled=false;
 const f=fixture(t,async(url,options)=>{
  assert.equal(options.method,'GET');
  if(url.endsWith('/summary'))return json({...summary,cash:{availableToTrade:filled?20:10,reservedForOrders:20,inPies:10}});
  if(url.endsWith('/positions'))return json(filled?[]:positions);
  if(url.endsWith('/equity/orders'))return json(filled?[]:[{id:75,ticker:'TEST_US_EQ',type:'MARKET',side:'SELL',quantity:2.12345678,status:'NEW',filledQuantity:0}]);
  if(url.includes('/history/orders?'))return json({items:[{order:{id:75,ticker:'TEST_US_EQ',type:'MARKET',side:'SELL',quantity:2.12345678,status:'FILLED',filledQuantity:2.12345678}}],nextPagePath:null});
  throw Error('Unexpected endpoint');
 });
 await f.service.connect(f.id,credentials,f.revision());f.service.trading.configure(f.id,{enabled:true,authorized:true});
 await f.service.trading.pending(f.id);const before=f.service.read();assert.equal(before.data.accounts[0].snapshot.holdings.length,1);
 filled=true;f.advance(15000);const tracked=await f.service.trading.pending(f.id);assert.equal(tracked.orders[0].status,'FILLED');assert.equal(tracked.balanceError,null);
 const refreshed=f.service.read();assert.ok(refreshed.revision>before.revision);assert.equal(refreshed.data.accounts[0].snapshot.holdings.length,0);assert.equal(refreshed.data.accounts[0].snapshot.cash,50);
 f.restart();assert.deepEqual(f.service.read(),refreshed);assert.equal((await f.service.trading.pending(f.id)).orders[0].status,'FILLED');
});
