import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createPortfolioTrading} from '../server/portfolio-trading.mjs';
import {cashOrderQuantity,orderPercentage} from '../src/data/portfolio-order-size.mjs';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
import {portfolioOrderLevels} from '../src/data/portfolio-order-levels.mjs';
const input={side:'BUY',type:'LIMIT',ticker:'AMD_US_EQ',quantity:2.5,limitPrice:100,timeValidity:'DAY'};
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());let at=1000000,generation='first',closed=false;
 const a={platform:'Trading 212',environment:'demo',snapshot:{source:'api',brokerId:'123',currency:'USD'}},calls=[];
 const source={cash:1000,available:3,currency:'USD',max:50,write:null,read:null,delay:null};
 const fetcher=async(url,options)=>{const path=new URL(url).pathname.replace('/api/v0','');calls.push({url,path,...options});assert.equal(new URL(url).origin,'https://'+a.environment+'.trading212.com');assert.equal(options.redirect,'error');
  if(options.method!=='GET'){if(source.delay)await source.delay;if(source.write)return source.write(path,options);if(options.method==='DELETE')return new Response(null,{status:200});const d=JSON.parse(options.body);return json({id:75,ticker:d.ticker,side:d.quantity<0?'SELL':'BUY',type:path.endsWith('/limit')?'LIMIT':'MARKET',quantity:d.quantity,status:'NEW',filledQuantity:0});}
  if(source.read){const result=source.read(path);if(result)return result;}
  if(path==='/equity/account/summary')return json({id:123,currency:'USD',cash:{availableToTrade:source.cash}});
  if(path==='/equity/positions')return json([{instrument:{ticker:'AMD_US_EQ',currency:'USD'},quantity:5,quantityAvailableForTrading:source.available,currentPrice:100,averagePricePaid:95,walletImpact:{totalCost:475,unrealizedProfitLoss:25,currency:'USD',currentValue:500}}]);
  if(path==='/equity/metadata/instruments')return json([{ticker:'AMD_US_EQ',name:'Advanced Micro Devices',type:'STOCK',currencyCode:source.currency,maxOpenQuantity:source.max}]);
  const order={id:75,ticker:'AMD_US_EQ',side:'BUY',type:'LIMIT',quantity:2.5,status:'NEW'};
  if(path==='/equity/orders')return json([order]);if(path==='/equity/orders/75')return json(order);throw Error('Unexpected endpoint '+path);
 };
 const options={now:()=>at,credential:()=>({generation}),decode:()=>({environment:a.environment,apiKey:'fake-key',apiSecret:'fake-secret'}),account:id=>{if(id!=='a'&&id!=='b')throw Error('unknown account');return a;},isClosed:()=>closed,fetcher};
 let service=createPortfolioTrading(db,options);
 return {get service(){return service;},source,calls,db,a,advance:(ms=61000)=>at+=ms,connect:()=>generation='second',enable:()=>service.configure('a',{enabled:true,authorized:true}),writes:()=>calls.filter(c=>c.method!=='GET'),restart:()=>service=createPortfolioTrading(db,options),close:()=>closed=true};
}
test('trading defaults disabled; explicit authorization is separate per account and connection',async t=>{
 const f=fixture(t);assert.equal(f.service.read('a').enabled,false);await assert.rejects(()=>f.service.preview('a',input),/Enable trading/);assert.equal(f.calls.length,0);
 assert.throws(()=>f.service.configure('a',{enabled:true}),/authorizes/);f.enable();assert.equal(f.service.read('a').enabled,true);assert.equal(f.service.read('b').enabled,false);f.connect();assert.equal(f.service.read('a').enabled,false);assert.equal(f.writes().length,0);
});
test('review is immutable, confirm sends one exact order, repeated token never resends across restart',async t=>{
 const f=fixture(t);f.enable();const review=await f.service.preview('a',input);assert.equal(f.writes().length,0);assert.equal(review.estimate,250);
 await assert.rejects(()=>f.service.submit('a',{token:review.token}),/confirm/);await assert.rejects(()=>f.service.submit('b',{token:review.token,confirmed:true}),/Enable trading/);
 const result=await f.service.submit('a',{token:review.token,confirmed:true,quantity:999,ticker:'OTHER'});assert.equal(result.state,'ACCEPTED');assert.deepEqual(JSON.parse(f.writes()[0].body),{ticker:'AMD_US_EQ',quantity:2.5,limitPrice:100,timeValidity:'DAY'});
 f.restart();assert.equal((await f.service.submit('a',{token:review.token,confirmed:true})).order.id,75);assert.equal(f.writes().length,1);
});
test('SELL uses negative broker quantity and available shares rather than total position',async t=>{
 const f=fixture(t);f.enable();await assert.rejects(()=>f.service.preview('a',{...input,side:'SELL',quantity:4}),/available/);
 const review=await f.service.preview('a',{...input,side:'SELL',type:'MARKET',quantity:1.25});await f.service.submit('a',{token:review.token,confirmed:true});assert.deepEqual(JSON.parse(f.writes()[0].body),{ticker:'AMD_US_EQ',quantity:-1.25,extendedHours:false});
});
test('invalid quantities, currencies, prices, cash and instrument identities never send orders',async t=>{
 const f=fixture(t);f.enable();for(const quantity of [0,-1,NaN,Infinity,'1',.000000001,1.123456789])await assert.rejects(()=>f.service.preview('a',{...input,quantity}));
 for(const limitPrice of [0,-1,NaN,'100'])await assert.rejects(()=>f.service.preview('a',{...input,limitPrice}));
 await assert.rejects(()=>f.service.preview('a',{...input,ticker:'https://bad.test'}),/exact stock/);await assert.rejects(()=>f.service.preview('a',{...input,quantity:11}),/cash/);await assert.rejects(()=>f.service.preview('a',{...input,quantity:49}),/maximum position/);
 f.source.currency='EUR';f.connect();f.enable();f.advance();await assert.rejects(()=>f.service.preview('a',input),/currency/);assert.equal(f.writes().length,0);
});
test('expired, replaced and disabled reviews cannot send; confirmation rechecks cash',async t=>{
 const f=fixture(t);f.enable();let review=await f.service.preview('a',input);f.advance();await assert.rejects(()=>f.service.submit('a',{token:review.token,confirmed:true}),/expired/);
 review=await f.service.preview('a',input);f.advance(6000);f.source.cash=1;await assert.rejects(()=>f.service.submit('a',{token:review.token,confirmed:true}),/cash/);f.source.cash=1000;f.advance();
 review=await f.service.preview('a',input);await f.service.preview('a',input);await assert.rejects(()=>f.service.submit('a',{token:review.token,confirmed:true}),/review/);
 review=await f.service.preview('a',input);f.service.configure('a',{enabled:false});await assert.rejects(()=>f.service.submit('a',{token:review.token,confirmed:true}),/Enable/);assert.equal(f.writes().length,0);
});
test('network uncertainty is persisted and blocks repeats until explicitly checked in broker',async t=>{
 const f=fixture(t);f.enable();const review=await f.service.preview('a',input);f.source.write=()=>{throw Error('socket lost after send');};
 assert.equal((await f.service.submit('a',{token:review.token,confirmed:true})).state,'UNKNOWN');f.restart();assert.equal(f.service.read('a').blocked,true);assert.equal((await f.service.submit('a',{token:review.token,confirmed:true})).state,'UNKNOWN');assert.equal(f.writes().length,1);
 await assert.rejects(()=>f.service.preview('a',input),/uncertain/);assert.throws(()=>f.service.acknowledge('a',{token:review.token}),/Confirm/);f.service.acknowledge('a',{token:review.token,checkedBroker:true});assert.equal(f.service.read('a').blocked,false);
});
test('definite broker rejections and unmatched replies have distinct safe outcomes',async t=>{
 for(const status of [400,401,403,429,500]){const f=fixture(t);f.enable();const review=await f.service.preview('a',input);f.source.write=()=>json({secret:'private upstream'},status);const result=await f.service.submit('a',{token:review.token,confirmed:true});assert.equal(result.state,status===500?'UNKNOWN':'REJECTED');assert.ok(!result.message.includes('private'));assert.equal(f.writes().length,1);}
 const f=fixture(t);f.enable();const review=await f.service.preview('a',input);f.source.write=()=>json({id:75,ticker:'OTHER',side:'BUY',type:'LIMIT',quantity:2.5,status:'NEW'});assert.equal((await f.service.submit('a',{token:review.token,confirmed:true})).state,'UNKNOWN');
});
test('concurrent submissions, disconnect and disable are blocked while a write is pending',async t=>{
 const f=fixture(t);f.enable();const review=await f.service.preview('a',input);let release;f.source.delay=new Promise(r=>release=r);
 const task=f.service.submit('a',{token:review.token,confirmed:true});await new Promise(r=>setImmediate(r));assert.equal(f.writes().length,1);
 await assert.rejects(()=>f.service.submit('a',{token:review.token,confirmed:true}),/already running/);assert.throws(()=>f.service.assertIdle('a'));assert.throws(()=>f.service.configure('a',{enabled:false}));release();await task;assert.equal(f.writes().length,1);
});
test('process interruption converts in-flight attempt to unknown on restart',async t=>{
 const f=fixture(t);f.enable();const review=await f.service.preview('a',input);f.db.prepare("UPDATE portfolio_order_attempts SET state='SENDING' WHERE token=?").run(review.token);f.restart();assert.equal(f.service.read('a').blocked,true);await assert.rejects(()=>f.service.preview('a',input),/uncertain/);assert.equal(f.writes().length,0);
});
test('cancellation is separately reviewed and confirmed, with no assumed final fill outcome',async t=>{
 const f=fixture(t);f.enable();const review=await f.service.preview('a',{action:'CANCEL',orderId:75});assert.equal(f.writes().length,0);const result=await f.service.submit('a',{token:review.token,confirmed:true});assert.equal(f.writes()[0].method,'DELETE');assert.equal(f.writes()[0].path,'/equity/orders/75');assert.match(result.message,/Cancellation requested/);assert.match(result.message,/fill/);
});
test('pending value orders from broker app remain readable and missing orders are not called filled',async t=>{
 const f=fixture(t);f.enable();f.source.read=path=>path==='/equity/orders'?json([{id:77,ticker:'AMD_US_EQ',side:'BUY',type:'MARKET',strategy:'VALUE',value:100,status:'NEW'}]):null;
 assert.equal((await f.service.pending('a')).orders[0].value,100);f.source.read=path=>path==='/equity/orders/75'?json({},404):null;await assert.rejects(()=>f.service.preview('a',{action:'CANCEL',orderId:75}));assert.equal(f.writes().length,0);
});

test('live environment requires its own explicit enablement and routes only to the live broker host',async t=>{
 const f=fixture(t);f.a.environment='live';assert.equal(f.service.read('a').enabled,false);f.enable();const review=await f.service.preview('a',input);assert.equal(review.environment,'live');await f.service.submit('a',{token:review.token,confirmed:true});assert.ok(f.writes()[0].url.startsWith('https://live.trading212.com/api/v0/equity/orders/'));
});

test('current holding distinguishes owned shares/value from available shares and reuses a fresh read for review',async t=>{
 const f=fixture(t);await assert.rejects(()=>f.service.position('a','AMD_US_EQ'),/Enable/);assert.equal(f.calls.length,0);f.enable();
 const position=await f.service.position('a','AMD_US_EQ');assert.deepEqual(position,{ticker:'AMD_US_EQ',currency:'USD',instrumentCurrency:'USD',shares:5,availableShares:3,value:500,price:100,averagePrice:95,cost:475,unrealized:25,unrealizedPercent:25/475*100,availableCash:1000,checkedAt:1000000});
 await f.service.preview('a',{...input,side:'SELL',quantity:3});assert.equal(f.calls.filter(c=>c.path==='/equity/positions').length,1);assert.equal(f.writes().length,0);
 f.advance(6000);f.source.available=1.12345678;assert.equal((await f.service.position('a','AMD_US_EQ')).availableShares,1.12345678);
 await assert.rejects(()=>f.service.preview('a',{...input,side:'SELL',quantity:3}),/available/);assert.equal(f.writes().length,0);
});
test('unheld instruments have zero positions while missing existing fields stay unknown',async t=>{
 const f=fixture(t);f.enable();f.source.read=path=>path.endsWith('/positions')?json([]):null;
 assert.deepEqual(await f.service.position('a','AMD_US_EQ'),{ticker:'AMD_US_EQ',currency:'USD',instrumentCurrency:'USD',shares:0,availableShares:0,value:0,price:null,averagePrice:null,cost:0,unrealized:null,unrealizedPercent:null,availableCash:1000,checkedAt:1000000});
 f.advance();f.source.read=path=>path.endsWith('/positions')?json([{instrument:{ticker:'AMD_US_EQ',currency:'EUR'},quantity:5,quantityAvailableForTrading:6,currentPrice:100,averagePricePaid:95,walletImpact:{totalCost:475,unrealizedProfitLoss:25,currency:'EUR',currentValue:500}}]):null;
 const missing=await f.service.position('a','AMD_US_EQ');assert.equal(missing.shares,5);for(const key of ['availableShares','value','price'])assert.equal(missing[key],null);
 f.advance();f.source.read=path=>path.endsWith('/positions')?json([{instrument:{ticker:'AMD_US_EQ'}}]):null;
 const partial=await f.service.position('a','AMD_US_EQ');for(const key of ['shares','availableShares','value','price'])assert.equal(partial[key],null);
});
test('position reads reject wrong identities, unknown instruments, malformed data and expired permissions',async t=>{
 const f=fixture(t);f.enable();await assert.rejects(()=>f.service.position('a','OTHER_US_EQ'),/exact stock/);await assert.rejects(()=>f.service.position('a','https://elsewhere.test'),/valid broker/);
 f.source.read=path=>path.endsWith('/summary')?json({id:999,currency:'USD',cash:{availableToTrade:1000}}):null;await assert.rejects(()=>f.service.position('a','AMD_US_EQ'),/identity/);
 f.advance();f.source.read=path=>path.endsWith('/positions')?json({items:[]}):null;await assert.rejects(()=>f.service.position('a','AMD_US_EQ'),/shares/);
 f.connect();await assert.rejects(()=>f.service.position('a','AMD_US_EQ'),/Enable/);assert.equal(f.writes().length,0);
});
test('position reads never overlap an order write and refresh after its outcome',async t=>{
 const f=fixture(t);f.enable();const review=await f.service.preview('a',input);let release;f.source.delay=new Promise(r=>release=r);
 const submission=f.service.submit('a',{token:review.token,confirmed:true});await new Promise(r=>setImmediate(r));
 await assert.rejects(()=>f.service.position('a','AMD_US_EQ'),/operation/);release();await submission;f.source.available=1;
 assert.equal((await f.service.position('a','AMD_US_EQ')).availableShares,1);assert.equal(f.calls.filter(c=>c.path==='/equity/positions').length,2);assert.equal(f.writes().length,1);
});
test('sell percentages floor fractional shares and never include reserved shares',()=>{
 const size=(availableShares,percent)=>orderPercentage({side:'SELL',availableShares,percent});
 assert.deepEqual([25,50,75,100].map(p=>size(3.01234567,p)),['0.75308641','1.50617283','2.25925925','3.01234567']);
 assert.equal(size(5.60285878,100),'5.60285878');assert.equal(size(1.123456789,100),'1.12345678');assert.equal(size(1e-8,100),'0.00000001');assert.equal(size(1e-8,25),'');assert.equal(size(0.000000019,100),'0.00000001');
 for(const amount of [0,null,undefined,NaN,-1,Infinity,'3'])assert.equal(size(amount,100),'');
 for(const percent of [0,10,101,'25'])assert.equal(size(3,percent),'');assert.equal(size(1000001,100),'');
});
test('buy percentages use available cash and chosen price without rounding above the budget',()=>{
 const size=(cash,price,percent=100)=>orderPercentage({side:'BUY',availableCash:cash,price,percent});
 assert.deepEqual([25,50,75,100].map(p=>size(1000,99,p)),['2.52525252','5.05050505','7.57575757','10.1010101']);
 assert.equal(size(0.3,0.1),'3');assert.equal(size(100,300),'0.33333333');assert.equal(size(1000000,1e7),'0.1');
 for(const price of [0,null,undefined,NaN,-1,Infinity,'100'])assert.equal(size(1000,price),'');assert.equal(size(0,100),'');
});

test('cash amount sizes down to eight decimals and a reviewed quantity never resizes on submit',async t=>{
 const f=fixture(t);f.enable();
 assert.equal(cashOrderQuantity(100,300),'0.33333333');assert.equal(cashOrderQuantity(0.3,0.1),'3');
 for(const amount of [null,0,-1,'100',Infinity,NaN])assert.equal(cashOrderQuantity(amount,100),'');
 let review=await f.service.preview('a',{...input,type:'MARKET',cashAmount:125,quantity:999});
 assert.equal(review.quantity,1.25);assert.equal(review.requestedCashAmount,125);assert.equal(review.remainingShares,6.25);assert.equal(review.remainingCash,875);
 f.advance(6000);f.source.read=path=>path.endsWith('/positions')?json([{instrument:{ticker:'AMD_US_EQ',currency:'USD'},quantity:5,quantityAvailableForTrading:3,currentPrice:120}]):null;
 await f.service.submit('a',{token:review.token,confirmed:true,cashAmount:999});assert.equal(JSON.parse(f.writes()[0].body).quantity,1.25);
 f.advance();f.source.read=path=>path.endsWith('/positions')?json([]):null;
 await assert.rejects(()=>f.service.preview('a',{...input,type:'MARKET',cashAmount:100}),/current broker price/);
 review=await f.service.preview('a',{...input,cashAmount:100,limitPrice:300});assert.equal(review.quantity,0.33333333);assert.ok(review.estimate<=100);
 await assert.rejects(()=>f.service.preview('a',{...input,cashAmount:1001}),/cash/);
});
test('sell review uses proportional account cost, remaining total shares and available cash',async t=>{
 const f=fixture(t);f.enable();let review=await f.service.preview('a',{...input,side:'SELL',quantity:2,limitPrice:90});
 assert.equal(review.currentShares,5);assert.equal(review.remainingShares,3);assert.equal(review.remainingCash,1180);assert.equal(review.estimatedProfit,-10);assert.equal(review.estimatedProfitPercent,-10/190*100);
 review=await f.service.preview('a',{...input,side:'SELL',cashAmount:250});assert.equal(review.quantity,2.5);assert.equal(review.estimatedProfit,12.5);
 await assert.rejects(()=>f.service.preview('a',{...input,side:'SELL',cashAmount:400}),/available/);
 f.advance();f.source.read=path=>path.endsWith('/positions')?json([{instrument:{ticker:'AMD_US_EQ',currency:'USD'},quantity:5,quantityAvailableForTrading:3,currentPrice:100,averagePricePaid:95,walletImpact:{currency:'EUR',totalCost:475,unrealizedProfitLoss:25}}]):null;
 review=await f.service.preview('a',{...input,side:'SELL'});assert.equal(review.estimatedProfit,null);assert.equal(review.estimatedProfitPercent,null);
 const position=await f.service.position('a','AMD_US_EQ');assert.equal(position.averagePrice,95);assert.equal(position.unrealized,null);assert.equal(position.unrealizedPercent,null);assert.equal(f.writes().length,0);
});
const trackedOrder=(status='NEW',filledQuantity=0)=>({id:75,ticker:'AMD_US_EQ',side:'BUY',type:'LIMIT',quantity:2.5,status,filledQuantity});
test('automatic tracking follows partial fills through confirmed history, refreshes balances once per change and survives restart',async t=>{
 const f=fixture(t);f.enable();let stage=0;
 f.source.read=path=>path==='/equity/orders'?json(stage===0?[trackedOrder()]:stage===1?[trackedOrder('PARTIALLY_FILLED',1)]:[]):path==='/equity/history/orders'?json({items:[{order:trackedOrder('FILLED',2.5)},{order:trackedOrder('PARTIALLY_FILLED',1)}],nextPagePath:null}):null;
 let data=await f.service.pending('a');assert.equal(data.orders[0].status,'NEW');assert.equal(data.revision,0);
 const calls=f.calls.length;await f.service.pending('a');assert.equal(f.calls.length,calls);
 f.advance(15000);stage=1;data=await f.service.pending('a');assert.equal(data.orders[0].status,'PARTIALLY_FILLED');assert.equal(data.orders[0].filledQuantity,1);assert.equal(data.revision,1);assert.equal(data.syncedRevision,1);assert.equal(f.calls.filter(c=>c.path.endsWith('/positions')).length,1);
 f.restart();f.advance(15000);stage=2;data=await f.service.pending('a');assert.equal(data.orders[0].status,'FILLED');assert.equal(data.orders[0].filledQuantity,2.5);assert.equal(data.revision,2);assert.equal(data.syncedRevision,2);
 f.advance();data=await f.service.pending('a');assert.equal(data.revision,2);assert.equal(f.calls.filter(c=>c.path.endsWith('/positions')).length,2);assert.equal(f.writes().length,0);
});
test('disappearance, denied history and mismatched history IDs never imply a fill',async t=>{
 const f=fixture(t);f.enable();await f.service.pending('a');f.advance();
 f.source.read=path=>path==='/equity/orders'?json([]):path==='/equity/history/orders'?json({},403):null;
 let data=await f.service.pending('a');assert.equal(data.orders[0].status,'NEW');assert.equal(data.orders[0].awaitingHistory,true);assert.match(data.historyError,/History: Orders/);assert.equal(data.revision,0);
 f.advance();f.source.read=path=>path==='/equity/orders'?json([]):path==='/equity/history/orders'?json({items:[{order:{...trackedOrder('FILLED',2.5),ticker:'MSFT_US_EQ'}}],nextPagePath:null}):null;
 data=await f.service.pending('a');assert.equal(data.orders[0].status,'NEW');assert.match(data.historyError,/identity/);assert.equal(data.revision,0);
 f.advance();f.source.read=path=>path==='/equity/orders'?json([]):path==='/equity/history/orders'?json({items:[{order:{...trackedOrder('FILLED',2.5),id:99}}],nextPagePath:null}):null;
 data=await f.service.pending('a');assert.equal(data.orders[0].awaitingHistory,true);assert.equal(data.revision,0);assert.equal(f.writes().length,0);
});
test('terminal cancellations and rejections reconcile without fabricating fills; cancellation can lose a race to a fill',async t=>{
 for(const status of ['CANCELLED','REJECTED','FILLED']){
  const f=fixture(t);f.enable();const review=await f.service.preview('a',{action:'CANCEL',orderId:75});await f.service.submit('a',{token:review.token,confirmed:true});
  f.source.read=path=>path==='/equity/orders'?json([]):path==='/equity/history/orders'?json({items:[{order:trackedOrder(status,status==='FILLED'?2.5:0)}],nextPagePath:null}):null;
  const data=await f.service.pending('a');assert.equal(data.orders[0].status,status);assert.equal(data.orders[0].filledQuantity,status==='FILLED'?2.5:0);assert.equal(data.syncedRevision,data.revision);assert.equal(f.writes().length,1);assert.equal(f.writes()[0].method,'DELETE');
 }
});
test('tracking follows safe resumable history cursors and retains a failed balance refresh for retry',async t=>{
 const f=fixture(t);f.enable();await f.service.pending('a');f.advance();let historyCalls=0,broken=true;
 f.source.read=path=>path==='/equity/orders'?json([]):path==='/equity/history/orders'?(++historyCalls===1?json({items:[],nextPagePath:'/api/v0/equity/history/orders?cursor=12&limit=50'}):json({items:[{order:trackedOrder('FILLED',2.5)}],nextPagePath:null})):path.endsWith('/positions')&&broken?json({},502):null;
 await f.service.pending('a');f.restart();f.advance(20000);let data=await f.service.pending('a');assert.equal(data.orders[0].status,'FILLED');assert.equal(data.syncedRevision,0);assert.match(data.balanceError,/waiting/);assert.ok(f.calls.some(c=>c.url.endsWith('?limit=50&cursor=12')));
 broken=false;f.advance(15000);data=await f.service.pending('a');assert.equal(data.syncedRevision,data.revision);assert.equal(data.balanceError,null);assert.equal(f.writes().length,0);
});
test('tracking backoff persists and old connection orders cannot leak into a reconnected account',async t=>{
 const f=fixture(t);f.enable();await f.service.pending('a');f.advance();f.source.read=path=>path==='/equity/orders'?json({},429):null;
 let data=await f.service.pending('a');assert.match(data.error,/rate limiting/);const calls=f.calls.length;f.restart();f.advance(15000);data=await f.service.pending('a');assert.equal(f.calls.length,calls);assert.equal(data.orders[0].id,75);
 f.connect();await assert.rejects(()=>f.service.pending('a'),/Enable/);f.enable();f.source.read=path=>path==='/equity/orders'?json([]):null;data=await f.service.pending('a');assert.deepEqual(data.orders,[]);assert.equal(data.syncedRevision,0);
});
test('saved chart level choices require the correct listing and currency and preserve zone edges and source dates',()=>{
 const instrument={ticker:'AMD_US_EQ',currency:'USD',isin:'US0079031078'},sheet={date:'2026-11-04',instruments:{AMD:{futures:false,timeframe:'4h',sourceDate:'2026-11-03',zones:[{type:'S',low:101,high:105},{type:'D',low:95,high:95},{type:'G',low:90,high:92}]},QQQ:{futures:false,zones:[{type:'D',low:400,high:410}]}}};
 const levels=portfolioOrderLevels(instrument,'USD',sheet);assert.equal(levels.listing,'NASDAQ:AMD');assert.equal(levels.date,'2026-11-03');assert.equal(levels.timeframe,'4h');assert.deepEqual(levels.options.map(o=>o.price),[101,105,95,90,92]);
 assert.equal(portfolioOrderLevels({...instrument,ticker:'NFLX_US_EQ',isin:''},'USD',sheet),null);
 assert.equal(portfolioOrderLevels(instrument,'EUR',sheet),null);assert.equal(portfolioOrderLevels({...instrument,isin:'wrong'},'USD',sheet),null);
 assert.equal(portfolioOrderLevels(instrument,'USD',{...sheet,instruments:{AMD:{...sheet.instruments.AMD,futures:true}}}),null);
});

test('accepted attempts from the previous release resume tracking while uncertain attempts never get matched by guesswork',async t=>{
 const f=fixture(t);f.enable();const review=await f.service.preview('a',input);await f.service.submit('a',{token:review.token,confirmed:true});
 f.db.exec('DELETE FROM portfolio_tracked_orders; DELETE FROM portfolio_order_tracking;');f.restart();
 f.source.read=path=>path==='/equity/orders'?json([]):path==='/equity/history/orders'?json({items:[{order:trackedOrder('FILLED',2.5)}],nextPagePath:null}):null;
 const data=await f.service.pending('a');assert.equal(data.orders[0].status,'FILLED');assert.equal(data.syncedRevision,data.revision);assert.equal(f.writes().length,1);
 f.db.exec('DELETE FROM portfolio_tracked_orders; DELETE FROM portfolio_order_tracking;');f.db.prepare("UPDATE portfolio_order_attempts SET state='UNKNOWN' WHERE token=?").run(review.token);
 assert.deepEqual((await f.service.pending('a')).orders,[]);assert.equal(f.service.read('a').blocked,true);assert.equal(f.writes().length,1);
});
test('untrusted history cursors never leave the broker allowlist and repeated pages stay unresolved',async t=>{
 for(const nextPagePath of ['https://attacker.invalid/collect','/api/v0/equity/history/orders?limit=50&cursor=1&token=bad','/api/v0/equity/history/orders?limit=50']){
  const f=fixture(t);f.enable();await f.service.pending('a');f.advance();f.source.read=path=>path==='/equity/orders'?json([]):path==='/equity/history/orders'?json({items:[],nextPagePath}):null;
  const data=await f.service.pending('a');assert.ok(data.historyError);assert.equal(data.orders[0].status,'NEW');assert.equal(data.orders[0].awaitingHistory,true);assert.equal(f.calls.filter(c=>c.path==='/equity/history/orders').length,1);assert.equal(f.writes().length,0);
 }
});
