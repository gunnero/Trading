import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {createPortfolioService} from '../server/portfolio.mjs';
import {instrumentSession,normalizeExchanges} from '../src/data/portfolio-sessions.mjs';
import {portfolioExposure,monthBounds,monthlyReturn,safeCsv,reportCsv} from '../src/data/portfolio-insights.mjs';
import {priceCrossed} from '../server/portfolio-alerts.mjs';

const NOW=Date.parse('2026-11-04T16:00:00Z'),day=86400000,at=s=>Date.parse(s),json=value=>Response.json(value);
const instrument={ticker:'AMD_US_EQ',name:'Advanced Micro Devices',currency:'USD',isin:'US0079031078'};
const catalog=[{...instrument,currencyCode:'USD',type:'STOCK',extendedHours:true,workingScheduleId:1,maxOpenQuantity:100000}];
const events=[['2026-11-03T21:00:00Z','CLOSE'],['2026-11-04T09:00:00Z','PRE_MARKET_OPEN'],['2026-11-04T14:30:00Z','OPEN'],['2026-11-04T21:00:00Z','CLOSE'],['2026-11-04T21:00:00Z','AFTER_HOURS_OPEN'],['2026-11-05T01:00:00Z','AFTER_HOURS_CLOSE'],['2026-11-05T01:00:00Z','OVERNIGHT_OPEN'],['2026-11-05T09:00:00Z','PRE_MARKET_OPEN']].map(([date,type])=>({date,type}));
const exchanges=[{id:1,name:'Fixture exchange',workingSchedules:[{id:1,timeEvents:events}]}];
const fill=(id=1)=>({order:{id,status:'FILLED',filledQuantity:2,quantity:2,side:'SELL',type:'MARKET',currency:'USD',instrument,createdAt:'2026-11-02T15:00:00Z'},fill:{id,type:'TRADE',filledAt:'2026-11-02T15:01:00Z',quantity:2,price:105,walletImpact:{currency:'USD',netValue:210,realisedProfitLoss:10,taxes:[{name:'FEE',currency:'USD',quantity:.1}]}}});
async function fixture(t){
 const directory=mkdtempSync(join(tmpdir(),'ob-insights-')),auth={encrypt:v=>v,decrypt:v=>v};let time=NOW,summaryValue=250,brokerId=101,quotePrice=100,quoteStatus='ok',quoteTime=null,quoteCurrency='USD',sourceSymbol='AMD',failures={},catalogValue=catalog,exchangeValue=exchanges;
 const calls=[],source={orders:{items:[fill()],nextPagePath:null},transactions:{items:[{reference:'deposit',dateTime:'2026-10-01T10:00:00Z',type:'DEPOSIT',currency:'USD',amount:200}],nextPagePath:null},dividends:{items:[{reference:'income1',paidOn:'2026-11-02T10:00:00Z',type:'ORDINARY',currency:'USD',amount:2,instrument}],nextPagePath:null}};
 const workspace={watchText:'###STOCKS,NASDAQ:AMD',levelText:'LVLS 2026-11-04\nAMD|4h|S 108-110|D 90-92'};
 const options={now:()=>time,workspace:()=>workspace,quote:async key=>{calls.push('quote:'+key);return {status:quoteStatus,quote:{price:quotePrice,currency:quoteCurrency,providerSymbol:sourceSymbol,observedAt:new Date(quoteTime??time).toISOString(),session:'Regular session'}};},fetcher:async(url,opts)=>{
   assert.equal(opts.method,'GET');const path=new URL(url).pathname;calls.push(path);
   if(failures[path])return new Response('private upstream text',{status:failures[path],headers:{'retry-after':'600'}});
   if(path.endsWith('/summary'))return json({id:brokerId,currency:'USD',totalValue:summaryValue,cash:{availableToTrade:50,reservedForOrders:0,inPies:0},investments:{currentValue:summaryValue-50,totalCost:200,unrealizedProfitLoss:summaryValue-250,realizedProfitLoss:10}});
   if(path.endsWith('/positions'))return json([{instrument,quantity:2,quantityAvailableForTrading:2,averagePricePaid:100,currentPrice:100,walletImpact:{currency:'USD',currentValue:200,totalCost:200,unrealizedProfitLoss:0}}]);
   if(path.endsWith('/metadata/instruments'))return json(catalogValue);
   if(path.endsWith('/metadata/exchanges'))return json(exchangeValue);
   if(path.includes('/history/'))return json(typeof source[path.split('/').at(-1)]==='function'?await source[path.split('/').at(-1)](url):source[path.split('/').at(-1)]);
   if(path.endsWith('/orders'))return json([]);throw Error('Unexpected fixture request '+path);
 }};
 let service=createPortfolioService(auth,directory,options);t.after(()=>{service.close();rmSync(directory,{recursive:true,force:true});});
 service.person({name:'Fixture One'},service.read().revision);service.account({personId:service.read().data.people[0].id,label:'Invest',platform:'Trading 212'},service.read().revision);const id=service.read().data.accounts[0].id;
 const credentials={apiKey:'fake-key-1234',apiSecret:'fake-secret-1234',environment:'demo',authorized:true};await service.connect(id,credentials,service.read().revision);
 return {get service(){return service;},id,source,calls,workspace,credentials,now:()=>time,advance:(ms=61000)=>time+=ms,setTime:v=>time=v,setValue:v=>summaryValue=v,setQuote:(value,options={})=>{quotePrice=value;quoteStatus=options.status||'ok';quoteTime=options.at??null;quoteCurrency=options.currency||'USD';sourceSymbol=options.symbol||'AMD';},fail:(path,status)=>failures[path]=status,setCatalog:v=>catalogValue=v,setExchanges:v=>exchangeValue=v,restart:()=>{service.close();service=createPortfolioService(auth,directory,options);},async second(){brokerId++;service.person({name:'Fixture Two'},service.read().revision);service.account({personId:service.read().data.people[1].id,label:'Second',platform:'Trading 212'},service.read().revision);const second=service.read().data.accounts.at(-1).id;await service.connect(second,credentials,service.read().revision);return second;}};
}
test('instrument schedules resolve regular, pre, after and overnight events without inventing hours outside coverage',()=>{
 const schedule=normalizeExchanges(exchanges)[1],item={...schedule,extendedHours:true};
 for(const [date,phase] of [['2026-11-04T08:00:00Z','closed'],['2026-11-04T10:00:00Z','pre'],['2026-11-04T14:30:00Z','regular'],['2026-11-04T21:00:00Z','post'],['2026-11-05T01:00:00Z','overnight']]){const now=at(date);assert.equal(instrumentSession(item,now,now).phase,phase);}
 assert.equal(instrumentSession({...item,extendedHours:false},NOW,NOW).phase,'regular');assert.equal(instrumentSession({...item,extendedHours:false},at('2026-11-04T22:00:00Z'),at('2026-11-04T22:00:00Z')).phase,'closed');
 assert.equal(instrumentSession(item,NOW-16*60000,NOW).phase,'unknown');assert.equal(instrumentSession(item,NOW+2*day,NOW+2*day).phase,'unknown');assert.equal(instrumentSession(item,NOW-2*day,NOW-2*day).phase,'unknown');
 assert.throws(()=>normalizeExchanges([{name:'x',workingSchedules:[{id:1,timeEvents:[{date:'2026-11-04 10:00',type:'OPEN'}]}]}]));
 assert.throws(()=>normalizeExchanges([{name:'x',workingSchedules:[{id:1,timeEvents:[{date:new Date(NOW).toISOString(),type:'UNKNOWN'}]}]}]));
 const dst=normalizeExchanges([{name:'DST fixture',workingSchedules:[{id:2,timeEvents:[{date:'2026-10-25T01:30:00+02:00',type:'OPEN'},{date:'2026-10-25T02:30:00+01:00',type:'CLOSE'}]}]}])[2];assert.equal(dst.events[1].at-dst.events[0].at,2*3600000);
});
test('metadata is shared with trading, exact instrument schedules survive restart and provider backoff never invents a status',async t=>{
 const f=await fixture(t);const h=await f.service.metadata.hours(f.id);assert.equal(h.items[0].exchange,'Fixture exchange');assert.equal(h.items[0].ticker,'AMD_US_EQ');assert.equal(f.service.trading.read(f.id).enabled,false);
 f.service.trading.configure(f.id,{enabled:true,authorized:true});await f.service.trading.search(f.id,'AMD');assert.equal(f.calls.filter(p=>p.endsWith('/metadata/instruments')).length,1);
 f.restart();await f.service.metadata.hours(f.id);assert.equal(f.calls.filter(p=>p.endsWith('/metadata/exchanges')).length,1);
 assert.deepEqual((await f.service.metadata.hours(f.id,'MISSING_US_EQ')).items,[]);
 f.advance(601000);f.fail('/api/v0/equity/metadata/exchanges',403);assert.deepEqual((await f.service.metadata.hours(f.id)).items,[]);f.restart();assert.match((await f.service.metadata.hours(f.id)).error,/Metadata/);assert.equal(f.calls.filter(p=>p.endsWith('/metadata/exchanges')).length,2);
 f.service.disconnect(f.id,f.service.read().revision);assert.deepEqual((await f.service.metadata.hours(f.id)).items,[]);
});
test('history listing metadata joins the exact instrument to its exchange and retains identity through restart',async t=>{
 const f=await fixture(t);f.setCatalog([{...catalog[0],shortName:'AMD'},{ticker:'EQACs_EQ',shortName:'EQAC',name:'Accumulating ETF',currencyCode:'USD',isin:'IE00BFZXGZ54',type:'ETF',workingScheduleId:5}]);
 f.setExchanges([{...exchanges[0],name:'NASDAQ'},{name:'SIX Swiss Exchange',workingSchedules:[{id:5,timeEvents:events}]}]);
 const rows=await f.service.metadata.historyListings(f.id);assert.equal(rows[0].exchange,'NASDAQ');assert.equal(rows[1].exchange,'SIX Swiss Exchange');assert.equal(rows[1].shortName,'EQAC');assert.equal(rows[1].isin,'IE00BFZXGZ54');
 f.restart();assert.deepEqual(await f.service.metadata.historyListings(f.id),rows);assert.equal(f.calls.filter(p=>p.endsWith('/metadata/instruments')).length,1);assert.equal(f.calls.filter(p=>p.endsWith('/metadata/exchanges')).length,1);
 f.advance(601000);f.fail('/api/v0/equity/metadata/exchanges',403);await assert.rejects(()=>f.service.metadata.historyListings(f.id));
});
test('exposure keeps share classes, instrument and account currencies separate, excludes demo and discloses missing values',()=>{
 const holding={ticker:'AMD_US_EQ',name:'AMD',instrumentCurrency:'USD',isin:'US0079031078',quantity:2,value:200};
 const account=(id,currency,holdings=[holding])=>({id,personId:id,platform:'Trading 212',environment:'live',label:'Invest',connected:true,snapshot:{currency,holdings,source:'api',fetchedAt:new Date(NOW).toISOString()}});
 const accounts=[account('a','USD'),account('b','USD'),account('c','EUR'),{...account('d','USD'),environment:'demo'},account('e','USD',[{...holding,ticker:'GOOG_US_EQ',isin:'US02079K1079',value:50},{...holding,ticker:'GOOGL_US_EQ',isin:'US02079K3059',value:100},{...holding,ticker:'X',value:null}]),{id:'missing'}];
 const result=portfolioExposure({accounts,people:[]}),usd=result.buckets.find(b=>b.currency==='USD');assert.equal(usd.rows.length,3);assert.equal(usd.rows[0].value,400);assert.equal(usd.rows[0].shared,true);assert.equal(usd.total,550);assert.equal(usd.missing,1);assert.equal(result.buckets.find(b=>b.currency==='EUR').total,200);assert.equal(result.demoAccounts,1);assert.equal(result.missingAccounts,1);
});
test('monthly returns remove funding, include balance effects, use actual historical bounds and label partial coverage',()=>{
 const bounds=monthBounds('2026-10','Europe/Skopje');assert.equal(bounds.to-bounds.from,31*day+3600000);
 const ledger={complete:true,coveredThrough:NOW,flows:[{at:bounds.from+day,type:'DEPOSIT',currency:'USD',amount:100}],values:[{at:bounds.from,value:100,currency:'USD'},{at:bounds.to-1,value:230,currency:'USD'},{at:NOW,value:999,currency:'USD'}]};
 let r=monthlyReturn(ledger,'USD',bounds,NOW);assert.equal(r.amount,30);assert.equal(r.coverage,'recorded');assert.equal(r.end.value,230);assert.ok(r.ratePercent>0);assert.equal(r.netFunding,100);
 r=monthlyReturn({...ledger,values:[{at:bounds.from+2*day,value:200,currency:'USD'},ledger.values[1]]},'USD',bounds,NOW);assert.equal(r.coverage,'partial');assert.equal(r.amount,30);
 assert.equal(monthlyReturn({...ledger,complete:false},'USD',bounds,NOW).amount,null);
 assert.equal(monthlyReturn({...ledger,flows:[{...ledger.flows[0],currency:'EUR'}]},'USD',bounds,NOW).amount,null);
 assert.equal(monthlyReturn({...ledger,flows:[{...ledger.flows[0],type:'TRANSFER'}]},'USD',bounds,NOW).amount,null);
 assert.equal(monthlyReturn({...ledger,values:[ledger.values[2]]},'USD',bounds,NOW).amount,null);assert.throws(()=>monthBounds('2026-13'));assert.throws(()=>monthBounds('2026-10','fake'));
});
test('price alerts baseline first, fire once only on fresh exact-symbol crossing, persist across restart and share activity unread state',async t=>{
 const f=await fixture(t);f.service.alerts.create({accountId:f.id,ticker:instrument.ticker,mode:'above',price:105});await f.service.alerts.check();assert.equal(f.service.activity.notifications().unread,0);
 f.advance();f.setQuote(106,{status:'stale'});await f.service.alerts.check();assert.equal(f.service.activity.notifications().unread,0);
 f.advance();f.setQuote(106,{symbol:'QQQ'});await f.service.alerts.check();assert.equal(f.service.activity.notifications().unread,0);
 f.advance();f.setQuote(106,{currency:'EUR'});await f.service.alerts.check();assert.equal(f.service.activity.notifications().unread,0);
 f.advance();f.setQuote(106,{at:NOW-3600000});await f.service.alerts.check();assert.equal(f.service.activity.notifications().unread,0);
 f.advance();f.setQuote(106);await f.service.alerts.check();const feed=f.service.activity.notifications();assert.equal(feed.unread,1);assert.equal(feed.items[0].kind,'price');assert.equal(feed.items[0].price,106);assert.equal(f.service.alerts.read().rules[0].enabled,false);
 f.restart();f.advance();await f.service.alerts.check();assert.equal(f.service.activity.notifications().unread,1);f.service.activity.markRead({through:feed.latestId});assert.equal(f.service.activity.notifications().unread,0);
 const rule=f.service.alerts.read().rules[0];f.service.alerts.update({id:rule.id,revision:rule.revision,action:'arm'});assert.throws(()=>f.service.alerts.update({id:rule.id,revision:rule.revision,action:'delete'}),/changed/);f.advance();await f.service.alerts.check();assert.equal(f.service.activity.notifications().unread,0);
});
test('saved zone alerts freeze exact levels and stop when disconnected; crossing gaps reset the baseline',async t=>{
 const f=await fixture(t);assert.throws(()=>f.service.alerts.create({accountId:f.id,ticker:'QQQ_US_EQ',mode:'above',price:1}));
 f.service.alerts.create({accountId:f.id,ticker:instrument.ticker,mode:'zone',zone:'0'});await f.service.alerts.check();f.workspace.levelText='LVLS 2026-11-04\nAMD|4h|S 200-202';f.advance();f.setQuote(109);await f.service.alerts.check();assert.match(f.service.activity.notifications().items[0].message,/108–110/);
 assert.equal(priceCrossed({mode:'zone',low:108,high:110},100,111),false);assert.equal(priceCrossed({mode:'below',price:100},101,100),true);
 f.service.alerts.create({accountId:f.id,ticker:instrument.ticker,mode:'above',price:120});f.advance();f.setQuote(119);await f.service.alerts.check();f.advance(31*60000);f.setQuote(121);await f.service.alerts.check();assert.equal(f.service.activity.notifications().unread,1);
 f.service.disconnect(f.id,f.service.read().revision);const calls=f.calls.length;f.advance();await f.service.alerts.check();assert.equal(f.calls.length,calls);
});
test('broker journal notes belong to an exact execution and account; revisions and imports preserve edits through restart',async t=>{
 const f=await fixture(t);await f.service.activity.sync(f.id);const second=await f.second();await f.service.activity.sync(second);
 assert.equal(f.service.reports.journal({account:f.id}).items[0].note.revision,0);
 const input={accountId:f.id,executionId:1,revision:0,reason:'Breakout',notes:'Waited for confirmation.'};f.service.reports.saveNote(input);assert.throws(()=>f.service.reports.saveNote(input),/changed/);assert.throws(()=>f.service.reports.saveNote({...input,executionId:999}),/not found/);
 f.restart();f.advance();await f.service.activity.sync(f.id);assert.equal(f.service.reports.journal({account:f.id}).items[0].note.reason,'Breakout');assert.equal(f.service.reports.journal({account:second}).items[0].note.reason,'');
 f.service.removeAccount(f.id,f.service.read().revision);assert.equal(f.service.reports.journal({account:f.id}).items.length,0);
});
test('reports publish complete dividend history, preserve prior published imports on permission errors and export originals without double deductions',async t=>{
 const f=await fixture(t);f.setTime(at('2026-11-01T00:00:00Z'));f.advance();f.setValue(250);await f.service.sync(f.id);f.setTime(NOW+100000);f.setValue(260);await f.service.sync(f.id);
 f.source.transactions.items.push({reference:'fee',dateTime:'2026-11-02T10:00:00Z',type:'FEE',currency:'USD',amount:-1});
 const params={month:'2026-11',timeZone:'Europe/Skopje'};const report=await f.service.reports.refresh(params),a=report.accounts[0];assert.equal(a.trades.length,1);assert.equal(a.income.length,1);assert.equal(a.income[0].amount,2);assert.equal(a.performance.amount,10);assert.equal(a.performance.coverage,'partial');assert.equal(a.trades[0].charges[0].amount,.1);
 const csv=reportCsv(report);assert.match(csv,/Execution charge/);assert.match(csv,/Cash movement/);assert.match(csv,/Distribution/);assert.match(csv,/Calculated MWRR/);
 f.advance(901000);f.fail('/api/v0/equity/history/dividends',403);await f.service.reports.refresh(params);assert.equal(f.service.reports.read(params).accounts[0].income.length,1);assert.ok(f.service.reports.read(params).accounts[0].warnings.some(w=>w.includes('History: Dividends')));
 f.restart();const calls=f.calls.length;await f.service.reports.syncIncome(f.id);assert.equal(f.calls.length,calls);
 assert.throws(()=>f.service.reports.read({month:'bad'}));assert.throws(()=>f.service.reports.read({month:'2099-01'}));
});
test('CSV escapes spreadsheet formulas, quotes and multiline notes while preserving numeric losses',()=>{
 const csv=safeCsv([['=HYPERLINK("https://example.com")','  +123','@SUM(A1)','-command','Line1\nLine2',-10,null]]);assert.match(csv,/"'=HYPERLINK/);assert.match(csv,/"'  \+123/);assert.match(csv,/"'@SUM/);assert.match(csv,/"-10"/);assert.match(csv,/Line1\nLine2/);assert.ok(csv.endsWith('\r\n'));
});
test('distribution pagination publishes atomically and resumes after restart without duplicates',async t=>{
 const f=await fixture(t),first=f.source.dividends.items[0],next='/equity/history/dividends?limit=50&cursor=123';
 f.source.dividends=async url=>new URL(url).searchParams.has('cursor')?{items:[first,{...first,reference:'income2',amount:3}],nextPagePath:null}:{items:[first],nextPagePath:next};
 await f.service.reports.syncIncome(f.id);assert.equal(f.service.reports.read({month:'2026-11'}).accounts[0].income.length,0);f.restart();f.advance();await f.service.reports.syncIncome(f.id);
 let report=f.service.reports.read({month:'2026-11'});assert.equal(report.accounts[0].income.length,2);assert.equal(report.accounts[0].income.reduce((n,r)=>n+r.amount,0),5);
 f.advance(901000);f.source.dividends={items:[first,{...first,reference:'bad',currency:'???'}],nextPagePath:null};await f.service.reports.syncIncome(f.id);report=f.service.reports.read({month:'2026-11'});assert.equal(report.accounts[0].income.length,2);assert.ok(report.accounts[0].warnings.some(w=>w.includes('currency')));
});
test('income responses arriving after disconnect cannot resurrect account data',async t=>{
 const f=await fixture(t);let release;f.source.dividends=()=>new Promise(resolve=>release=resolve);const pending=f.service.reports.syncIncome(f.id);while(!release)await new Promise(r=>setImmediate(r));f.service.disconnect(f.id,f.service.read().revision);release({items:[],nextPagePath:null});await pending;
 assert.equal(f.service.reports.read({month:'2026-11'}).accounts[0].incomeComplete,false);assert.equal(f.service.read().data.accounts[0].connected,false);
});
test('actual portfolio routes validate, create alerts and save execution notes through the existing write boundary',async t=>{
 const f=await fixture(t);await f.service.activity.sync(f.id);
 const server=createServer((req,res)=>f.service.middleware(req,res,()=>{res.statusCode=404;res.end();}));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const base='http://127.0.0.1:'+server.address().port+'/api/portfolio';
 const post=(path,body,headers={'content-type':'application/json','x-opening-bell-client':'web'})=>fetch(base+path,{method:'POST',headers,body:JSON.stringify(body)});
 assert.equal((await post('/insights/alerts',{accountId:f.id,ticker:instrument.ticker,mode:'above',price:150},{})).status,415);
 let response=await post('/insights/alerts',{accountId:f.id,ticker:instrument.ticker,mode:'above',price:150});assert.equal(response.status,200);assert.equal((await response.json()).rules.length,1);
 response=await fetch(base+`/accounts/${f.id}/hours`);assert.equal((await response.json()).items[0].ticker,instrument.ticker);
 response=await post('/journal/notes',{accountId:f.id,executionId:1,revision:0,reason:'Fixture',notes:'Saved via API'});assert.equal(response.status,200);
 assert.equal((await (await fetch(base+'/journal')).json()).items[0].note.notes,'Saved via API');
 assert.equal((await post('/journal/notes',{accountId:f.id,executionId:1,revision:0,reason:'x',notes:'x'})).status,409);
 response=await post('/insights/reports/refresh',{month:'2026-11'});assert.equal(response.status,200);assert.equal((await response.json()).accounts[0].income.length,1);
});
