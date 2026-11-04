import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createTradePrice} from '../server/portfolio-trade-price.mjs';
import {createPortfolioTrading} from '../server/portfolio-trading.mjs';
import {cashOrderQuantity,orderPercentage,roundedOrderQuantity,orderQuantityPrecision} from '../src/data/portfolio-order-size.mjs';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
import {portfolioOrderLevels} from '../src/data/portfolio-order-levels.mjs';
const input={side:'BUY',type:'LIMIT',ticker:'AMD_US_EQ',quantity:2.5,limitPrice:100,timeValidity:'DAY'};
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());let at=1000000,generation='first',closed=false;
 const a={platform:'Trading 212',environment:'demo',snapshot:{source:'api',brokerId:'123',currency:'USD'}},calls=[];
 const source={cash:1000,available:3,currency:'USD',max:50,extendedHours:true,write:null,read:null,delay:null};
 const fetcher=async(url,options)=>{const path=new URL(url).pathname.replace('/api/v0','');calls.push({url,path,...options});assert.equal(new URL(url).origin,'https://'+a.environment+'.trading212.com');assert.equal(options.redirect,'error');
  if(options.method!=='GET'){if(source.delay)await source.delay;if(source.write)return source.write(path,options);if(options.method==='DELETE')return new Response(null,{status:200});const d=JSON.parse(options.body);return json({id:75,ticker:d.ticker,side:d.quantity<0?'SELL':'BUY',type:path.endsWith('/limit')?'LIMIT':'MARKET',quantity:d.quantity,extendedHours:d.extendedHours,status:'NEW',filledQuantity:0});}
  if(source.read){const result=source.read(path);if(result)return result;}
  if(path==='/equity/account/summary')return json({id:123,currency:'USD',cash:{availableToTrade:source.cash}});
  if(path==='/equity/positions')return json([{instrument:{ticker:'AMD_US_EQ',currency:'USD'},quantity:5,quantityAvailableForTrading:source.available,currentPrice:100,averagePricePaid:95,walletImpact:{totalCost:475,unrealizedProfitLoss:25,currency:'USD',currentValue:500}}]);
  if(path==='/equity/metadata/instruments')return json([{ticker:'AMD_US_EQ',name:'Advanced Micro Devices',type:'STOCK',currencyCode:source.currency,maxOpenQuantity:source.max,extendedHours:source.extendedHours}]);
  const order={id:75,ticker:'AMD_US_EQ',side:'BUY',type:'LIMIT',quantity:2.5,status:'NEW'};
  if(path==='/equity/orders')return json([order]);if(path==='/equity/orders/75')return json(order);throw Error('Unexpected endpoint '+path);
 };
 const options={marketPrice:createTradePrice({now:()=>at,workspace:()=>({watchText:source.watchText||''}),quote:async key=>source.quote?.(key,at)}),now:()=>at,credential:()=>({generation}),decode:()=>({environment:a.environment,apiKey:'fake-key',apiSecret:'fake-secret'}),account:id=>{if(id!=='a'&&id!=='b')throw Error('unknown account');return a;},isClosed:()=>closed,fetcher};
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
 const f=fixture(t);f.enable();for(const quantity of [0,-1,NaN,Infinity,'1',.000000001,1000000.0000001])await assert.rejects(()=>f.service.preview('a',{...input,quantity}));
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
test('broker problem details survive rejection and restart without resending or changing quantity',async t=>{
 for(const wrapped of [false,true]){
  const f=fixture(t);f.enable();const review=await f.service.preview('a',{...input,type:'MARKET',quantity:1.23456789});
  const problem={type:'/api-errors/quantity-precision-mismatch',title:'Error while placing the order',status:400,detail:'invalid quantity precision 4'};
  f.source.write=()=>new Response(JSON.stringify(wrapped?{success:false,error:problem}:problem),{status:400,headers:{'content-type':'application/problem+json'}});
  const result=await f.service.submit('a',{token:review.token,confirmed:true});
  assert.equal(result.state,'REJECTED');assert.equal(result.brokerCode,'quantity-precision-mismatch');assert.equal(result.brokerStatus,400);assert.match(result.message,/invalid quantity precision 4/);
  assert.equal(JSON.parse(f.writes()[0].body).quantity,1.2345);f.restart();assert.equal(f.service.read('a').attempts[0].message,result.message);
  assert.equal((await f.service.submit('a',{token:review.token,confirmed:true})).message,result.message);assert.equal(f.writes().length,1);assert.equal(f.service.read('a').blocked,false);
 }
});
test('broker rejection exposes only bounded text fields and redacts credentials',async t=>{
 const f=fixture(t);f.enable();const review=await f.service.preview('a',input);
 f.source.write=()=>json({code:'InsufficientFunds',message:'Available cash too low. fake-key fake-secret '+Buffer.from('fake-key:fake-secret').toString('base64')+' authorization=hidden '+ 'a'.repeat(700),secret:'private upstream',stack:'private stack'},400);
 const result=await f.service.submit('a',{token:review.token,confirmed:true});assert.match(result.message,/Available cash too low/);assert.equal(result.brokerCode,'InsufficientFunds');
 assert.doesNotMatch(JSON.stringify(result),/fake-key|fake-secret|ZmFrZS1rZXk6ZmFrZS1zZWNyZXQ=|hidden|private upstream|private stack/);assert.ok(result.message.length<650);assert.match(result.message,/redacted/);
});
function savedPrecision(f,{precision=2,account='a',generation='first',type='MARKET',side='BUY',ticker='AMD_US_EQ',extendedHours=false,brokerCode='quantity-precision-mismatch',message}={}){
 const detail={action:'ORDER',ticker,type,side,extendedHours,brokerStatus:400,brokerCode,message:message??`Trading 212 rejected this order: invalid quantity precision ${precision} (code: quantity-precision-mismatch)`};
 f.db.prepare('INSERT INTO portfolio_order_attempts VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(),account,generation,1,'REJECTED',JSON.stringify(detail));
}
test('reported FB quantity is rounded down at review, disclosed, and sent exactly once without changing holdings',async t=>{
 const f=fixture(t);f.enable();f.source.read=path=>path.endsWith('/instruments')?json([{ticker:'FB_US_EQ',name:'Meta Platforms',type:'STOCK',currencyCode:'USD'}]):path.endsWith('/positions')?json([{instrument:{ticker:'FB_US_EQ',currency:'USD'},quantity:5.60285878,quantityAvailableForTrading:5.60285878,currentPrice:100}]):null;
 const review=await f.service.preview('a',{...input,ticker:'FB_US_EQ',type:'MARKET',quantity:0.9972397});
 assert.equal(review.quantity,0.9972);assert.equal(review.requestedQuantity,0.9972397);assert.equal(review.quantityPrecision,4);assert.equal(review.currentShares,5.60285878);assert.equal(f.writes().length,0);
 await f.service.submit('a',{token:review.token,confirmed:true,quantity:.9972397});assert.equal(JSON.parse(f.writes()[0].body).quantity,.9972);
 f.restart();await f.service.submit('a',{token:review.token,confirmed:true});assert.equal(f.writes().length,1);
});
test('decimal steps preserve exact boundaries and never round above shares or cash, including whole shares',()=>{
 assert.equal(roundedOrderQuantity(.9972397),'0.9972');assert.equal(roundedOrderQuantity(.0001),'0.0001');assert.equal(roundedOrderQuantity(.00009999),'');assert.equal(roundedOrderQuantity(1.001,3),'1.001');
 for(const precision of [0,1,2,3,4])for(const amount of [.0001,.29,.9972397,3.01234567,5.60285878,12345.6789]){
  const shares=Number(roundedOrderQuantity(amount,precision));assert.ok(shares<=amount);assert.equal(Number(shares.toFixed(precision)),shares);
  for(const percent of [25,50,75,100]){const qty=Number(orderPercentage({side:'BUY',percent,availableCash:amount,price:123.45,precision}));assert.ok(qty*123.45<=amount*percent/100+1e-12);}
 }
 assert.equal(cashOrderQuantity(199,100,0),'1');assert.equal(roundedOrderQuantity(1.9999,0),'1');assert.equal(roundedOrderQuantity(.9,0),'');
 for(const precision of [-1,9,NaN,'4'])assert.equal(roundedOrderQuantity(1,precision),'');
});
test('broker precision survives restart beyond recent activity and applies only to its exact connection and order scope',async t=>{
 const f=fixture(t);f.enable();savedPrecision(f);for(let i=0;i<35;i++)savedPrecision(f,{ticker:'OTHER_US_EQ',precision:0});f.restart();
 const order={...input,type:'MARKET',quantity:1.23456789};assert.equal((await f.service.preview('a',order)).quantity,1.23);
 for(const changed of [{side:'SELL'},{type:'LIMIT'},{extendedHours:true}])assert.equal((await f.service.preview('a',{...order,...changed})).quantity,1.2345);
 f.service.configure('b',{enabled:true,authorized:true});assert.equal((await f.service.preview('b',order)).quantity,1.2345);
 assert.equal(orderQuantityPrecision(f.service.read('a').quantityRules,order),2);f.connect();f.enable();f.advance();assert.deepEqual(f.service.read('a').quantityRules,[]);assert.equal((await f.service.preview('a',order)).quantity,1.2345);
});
test('a stricter broker rejection changes only a new review and never retries the rejected order',async t=>{
 const f=fixture(t);f.enable();const order={...input,type:'MARKET',quantity:1.23456789};const review=await f.service.preview('a',order);
 f.source.write=()=>json({type:'/api-errors/quantity-precision-mismatch',detail:'invalid quantity precision 2'},400);
 const result=await f.service.submit('a',{token:review.token,confirmed:true});assert.equal(result.state,'REJECTED');assert.equal(result.quantity,1.2345);assert.equal(JSON.parse(f.writes()[0].body).quantity,1.2345);
 f.restart();await f.service.submit('a',{token:review.token,confirmed:true});assert.equal(f.writes().length,1);
 const adjusted=await f.service.preview('a',order);assert.equal(adjusted.quantity,1.23);assert.equal(adjusted.requestedQuantity,1.23456789);assert.equal(f.writes().length,1);
});
test('legacy reviews and precision changes require a new review instead of silently resizing on submit',async t=>{
 const f=fixture(t);f.enable();const review=await f.service.preview('a',{...input,type:'MARKET',quantity:1.2345});
 f.db.prepare('UPDATE portfolio_order_attempts SET detail=? WHERE token=?').run(JSON.stringify({...review,quantity:1.23456789}),review.token);
 await assert.rejects(()=>f.service.submit('a',{token:review.token,confirmed:true}),/precision changed/);
 const next=await f.service.preview('a',{...input,type:'MARKET',quantity:1.2345});savedPrecision(f,{precision:0});
 await assert.rejects(()=>f.service.submit('a',{token:next.token,confirmed:true}),/precision changed/);assert.equal(f.writes().length,0);
});
test('precision rules ignore unrelated errors and client hints; known whole-share limits apply to cash and shares',async t=>{
 const f=fixture(t);f.enable();savedPrecision(f,{brokerCode:'other-code'});savedPrecision(f,{message:'invalid quantity precision 0'});savedPrecision(f,{precision:9});
 assert.deepEqual(f.service.read('a').quantityRules,[]);let review=await f.service.preview('a',{...input,type:'MARKET',quantity:1.23456789,quantityPrecision:8});assert.equal(review.quantity,1.2345);
 savedPrecision(f,{precision:0});review=await f.service.preview('a',{...input,type:'MARKET',cashAmount:199});assert.equal(review.quantity,1);assert.equal(review.estimate,100);
 await assert.rejects(()=>f.service.preview('a',{...input,type:'MARKET',quantity:.99}),/1 share sizing step/);
 await assert.rejects(()=>f.service.preview('a',{...input,type:'MARKET',cashAmount:99}),/1 share sizing step/);assert.equal(f.writes().length,0);
});
test('full available sell rounds down, retains the fractional balance and leaves limit price precision unchanged',async t=>{
 const f=fixture(t);f.enable();f.source.available=3.01234567;
 const qty=Number(orderPercentage({side:'SELL',percent:100,availableShares:f.source.available}));const review=await f.service.preview('a',{...input,side:'SELL',quantity:qty,limitPrice:100.123456});
 assert.equal(review.quantity,3.0123);assert.equal(review.availableShares,3.01234567);assert.equal(review.remainingShares,5-3.0123);assert.equal(review.limitPrice,100.123456);
 await f.service.submit('a',{token:review.token,confirmed:true});const sent=JSON.parse(f.writes()[0].body);assert.equal(sent.quantity,-3.0123);assert.equal(sent.limitPrice,100.123456);
});
test('invalid, oversized and interrupted error bodies preserve a definite rejection without leaking payloads',async t=>{
 for(const response of [()=>new Response('<html>private upstream</html>',{status:400}),()=>json(null,400),()=>json(['private upstream'],400),()=>new Response('{bad private upstream',{status:400,headers:{'content-type':'application/json'}}),()=>json({detail:'private upstream '.repeat(2000)},400),()=>json({detail:'<html>private upstream</html>'},400),()=>new Response(new ReadableStream({start(controller){controller.error(Error('interrupted'));}}),{status:400,headers:{'content-type':'application/json'}})]){
  const f=fixture(t);f.enable();const review=await f.service.preview('a',input);f.source.write=response;
  const result=await f.service.submit('a',{token:review.token,confirmed:true});assert.equal(result.state,'REJECTED');assert.equal(result.brokerStatus,400);assert.doesNotMatch(result.message,/private upstream|interrupted/);assert.equal(f.writes().length,1);
 }
});
test('concurrent submissions, disconnect and disable are blocked while a write is pending',async t=>{
 const f=fixture(t);f.enable();const review=await f.service.preview('a',input);let release;f.source.delay=new Promise(r=>release=r);
 const task=f.service.submit('a',{token:review.token,confirmed:true});await new Promise(r=>setImmediate(r));assert.equal(f.writes().length,1);
 await assert.rejects(()=>f.service.submit('a',{token:review.token,confirmed:true}),/already running/);assert.throws(()=>f.service.assertIdle('a'));assert.throws(()=>f.service.configure('a',{enabled:false}));release();await task;assert.equal(f.writes().length,1);
});
test('process interruption converts in-flight attempt to unknown on restart',async t=>{
 const f=fixture(t);f.enable();const review=await f.service.preview('a',input);f.db.prepare("UPDATE portfolio_order_attempts SET state='SENDING' WHERE token=?").run(review.token);f.restart();assert.equal(f.service.read('a').blocked,true);await assert.rejects(()=>f.service.preview('a',input),/uncertain/);assert.equal(f.writes().length,0);
});
test('background monitor never retries uncertain submissions and skips an active user operation',async t=>{
 const f=fixture(t);f.enable();const review=await f.service.preview('a',input);let release;f.source.delay=new Promise(r=>release=r);
 f.source.write=()=>{throw Error('lost response');};const sending=f.service.submit('a',{token:review.token,confirmed:true});await new Promise(r=>setImmediate(r));const count=f.calls.length;
 await f.service.monitor('a');assert.equal(f.calls.length,count);release();assert.equal((await sending).state,'UNKNOWN');
 f.advance();await f.service.monitor('a');assert.equal(f.writes().length,1);assert.equal(f.service.read('a').blocked,true);f.restart();f.advance();await f.service.monitor('a');assert.equal(f.writes().length,1);assert.equal(f.service.read('a').blocked,true);
});
test('background broker rate-limit backoff survives restart and does not permit order writes',async t=>{
 const f=fixture(t);f.enable();f.source.read=path=>path==='/equity/orders'?new Response('{}',{status:429,headers:{'content-type':'application/json','retry-after':'300'}}):null;
 await f.service.monitor('a');assert.match(f.service.tracking('a').error,/rate limiting/);const count=f.calls.length;f.restart();f.advance(120000);await f.service.monitor('a');assert.equal(f.calls.length,count);f.advance(181000);await f.service.monitor('a');assert.equal(f.calls.length,count+1);assert.equal(f.writes().length,0);
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
 const position=await f.service.position('a','AMD_US_EQ');assert.deepEqual(position,{ticker:'AMD_US_EQ',currency:'USD',instrumentCurrency:'USD',shares:5,availableShares:3,value:500,price:100,priceQuote:{source:'Trading 212',observedAt:null,checkedAt:1000000,validUntil:1065000,session:null,delayMinutes:null},averagePrice:95,cost:475,unrealized:25,unrealizedPercent:25/475*100,availableCash:1000,checkedAt:1000000});
 await f.service.preview('a',{...input,side:'SELL',quantity:3});assert.equal(f.calls.filter(c=>c.path==='/equity/positions').length,1);assert.equal(f.writes().length,0);
 f.advance(6000);f.source.available=1.12345678;assert.equal((await f.service.position('a','AMD_US_EQ')).availableShares,1.12345678);
 await assert.rejects(()=>f.service.preview('a',{...input,side:'SELL',quantity:3}),/available/);assert.equal(f.writes().length,0);
});
test('unheld instruments have zero positions while missing existing fields stay unknown',async t=>{
 const f=fixture(t);f.enable();f.source.read=path=>path.endsWith('/positions')?json([]):null;
 assert.deepEqual(await f.service.position('a','AMD_US_EQ'),{ticker:'AMD_US_EQ',currency:'USD',instrumentCurrency:'USD',shares:0,availableShares:0,value:0,price:null,priceQuote:null,averagePrice:null,cost:0,unrealized:null,unrealizedPercent:null,availableCash:1000,checkedAt:1000000});
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
 assert.deepEqual([25,50,75,100].map(p=>size(3.01234567,p)),['0.753','1.5061','2.2592','3.0123']);
 assert.equal(size(5.60285878,100),'5.6028');assert.equal(size(1.123456789,100),'1.1234');assert.equal(size(1e-8,100),'');assert.equal(size(1e-8,25),'');assert.equal(size(0.000000019,100),'');
 for(const amount of [0,null,undefined,NaN,-1,Infinity,'3'])assert.equal(size(amount,100),'');
 for(const percent of [0,10,101,'25'])assert.equal(size(3,percent),'');assert.equal(size(1000001,100),'');
});
test('buy percentages use available cash and chosen price without rounding above the budget',()=>{
 const size=(cash,price,percent=100)=>orderPercentage({side:'BUY',availableCash:cash,price,percent});
 assert.deepEqual([25,50,75,100].map(p=>size(1000,99,p)),['2.5252','5.0505','7.5757','10.101']);
 assert.equal(size(0.3,0.1),'3');assert.equal(size(100,300),'0.3333');assert.equal(size(1000000,1e7),'0.1');
 for(const price of [0,null,undefined,NaN,-1,Infinity,'100'])assert.equal(size(1000,price),'');assert.equal(size(0,100),'');
});

test('cash amount sizes down to four decimals and a reviewed quantity never resizes on submit',async t=>{
 const f=fixture(t);f.enable();
 assert.equal(cashOrderQuantity(100,300),'0.3333');assert.equal(cashOrderQuantity(0.3,0.1),'3');
 for(const amount of [null,0,-1,'100',Infinity,NaN])assert.equal(cashOrderQuantity(amount,100),'');
 let review=await f.service.preview('a',{...input,type:'MARKET',cashAmount:125,quantity:999});
 assert.equal(review.quantity,1.25);assert.equal(review.requestedCashAmount,125);assert.equal(review.remainingShares,6.25);assert.equal(review.remainingCash,875);
 f.advance(6000);f.source.read=path=>path.endsWith('/positions')?json([{instrument:{ticker:'AMD_US_EQ',currency:'USD'},quantity:5,quantityAvailableForTrading:3,currentPrice:120}]):null;
 await f.service.submit('a',{token:review.token,confirmed:true,cashAmount:999});assert.equal(JSON.parse(f.writes()[0].body).quantity,1.25);
 f.advance();f.source.read=path=>path.endsWith('/positions')?json([]):null;
 await assert.rejects(()=>f.service.preview('a',{...input,type:'MARKET',cashAmount:100}),/current market reference price/);
 review=await f.service.preview('a',{...input,cashAmount:100,limitPrice:300});assert.equal(review.quantity,0.3333);assert.ok(review.estimate<=100);
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


test('extended market sessions are immutable per reviewed buy and sell, survive restart and are not changed by submit fields',async t=>{
 for(const side of ['BUY','SELL']){
  const f=fixture(t);f.enable();assert.equal((await f.service.search('a','AMD')).items[0].extendedHours,true);
  const review=await f.service.preview('a',{...input,type:'MARKET',side,quantity:1,extendedHours:true});assert.equal(review.extendedHours,true);assert.equal(f.writes().length,0);
  f.restart();const result=await f.service.submit('a',{token:review.token,confirmed:true,extendedHours:false});assert.equal(result.state,'ACCEPTED');assert.equal(result.order.extendedHours,true);
  assert.deepEqual(JSON.parse(f.writes()[0].body),{ticker:'AMD_US_EQ',quantity:side==='SELL'?-1:1,extendedHours:true});
  await f.service.submit('a',{token:review.token,confirmed:true});assert.equal(f.writes().length,1);
 }
});
test('regular-session reviews and legacy prepared orders never silently opt into extended sessions',async t=>{
 const f=fixture(t);f.enable();
 for(const legacy of [false,true]){
  const review=await f.service.preview('a',{...input,type:'MARKET',extendedHours:false});assert.equal(review.extendedHours,false);
  if(legacy){const row=f.db.prepare('SELECT detail FROM portfolio_order_attempts WHERE token=?').get(review.token),detail=JSON.parse(row.detail);delete detail.extendedHours;f.db.prepare('UPDATE portfolio_order_attempts SET detail=? WHERE token=?').run(JSON.stringify(detail),review.token);f.restart();}
  assert.equal((await f.service.submit('a',{token:review.token,confirmed:true,extendedHours:true})).state,'ACCEPTED');assert.equal(JSON.parse(f.writes().at(-1).body).extendedHours,false);
 }
});
test('ineligible stocks, unknown eligibility, limit sessions and malformed flags cannot request extended execution',async t=>{
 const f=fixture(t);f.enable();
 for(const extendedHours of ['true',1,null,{}])await assert.rejects(()=>f.service.preview('a',{...input,type:'MARKET',extendedHours}),/valid trading session/);
 await assert.rejects(()=>f.service.preview('a',{...input,extendedHours:true}),/market orders only/);
 for(const eligible of [false,undefined]){f.source.extendedHours=eligible;f.restart();await assert.rejects(()=>f.service.preview('a',{...input,type:'MARKET',extendedHours:true}),/eligible/);assert.equal((await f.service.preview('a',{...input,type:'MARKET',extendedHours:false})).extendedHours,false);}
 assert.equal(f.writes().length,0);
});
test('broker session mismatch is uncertain and cannot be retried automatically',async t=>{
 const f=fixture(t);f.enable();const review=await f.service.preview('a',{...input,type:'MARKET',extendedHours:true});
 f.source.write=()=>json({id:75,ticker:'AMD_US_EQ',side:'BUY',type:'MARKET',quantity:2.5,status:'NEW',extendedHours:false});
 const result=await f.service.submit('a',{token:review.token,confirmed:true});assert.equal(result.state,'UNKNOWN');assert.equal(f.service.read('a').blocked,true);
 await f.service.submit('a',{token:review.token,confirmed:true});assert.equal(f.writes().length,1);
});

test('submit refuses a reviewed extended order if refreshed broker eligibility is withdrawn',async t=>{
 const f=fixture(t);f.enable();await f.service.search('a','AMD');f.advance(590000);
 const review=await f.service.preview('a',{...input,type:'MARKET',extendedHours:true});f.source.extendedHours=false;f.advance(11000);
 await assert.rejects(()=>f.service.submit('a',{token:review.token,confirmed:true}),/eligible/);assert.equal(f.writes().length,0);
});

const marketResult=(symbol,at,price=200)=>({status:'ok',fetchedAt:new Date(at).toISOString(),quote:{provider:'Yahoo Finance',providerSymbol:symbol,kind:'equity',currency:'USD',exchangeName:'NMS',instrumentType:'EQUITY',price,observedAt:new Date(at-60000).toISOString(),sessionType:'post',delayMinutes:null}});
test('unheld stock market quotes size cash and percentages without chart prices; confirmed shares never resize',async t=>{
 const f=fixture(t);f.enable();f.source.read=path=>path.endsWith('/positions')?json([]):null;let price=200;const keys=[];
 f.source.quote=(key,at)=>{keys.push(key);return marketResult('AMD',at,price);};
 const position=await f.service.position('a','AMD_US_EQ');assert.equal(position.price,200);assert.equal(position.shares,0);assert.equal(position.value,0);assert.equal(position.priceQuote.source,'Yahoo Finance');assert.equal(position.priceQuote.observedAt,940000);assert.equal(position.priceQuote.session,'After-hours');assert.equal(position.averagePrice,null);
 assert.equal(orderPercentage({side:'BUY',percent:50,availableCash:position.availableCash,price:position.price}),'2.5');
 const review=await f.service.preview('a',{...input,type:'MARKET',cashAmount:125,limitPrice:1,price:1,referencePrice:1});assert.equal(review.quantity,0.625);assert.equal(review.referencePrice,200);assert.equal(review.limitPrice,null);assert.equal(review.priceQuote.source,'Yahoo Finance');
 price=210;f.advance(6000);await f.service.submit('a',{token:review.token,confirmed:true});assert.deepEqual(JSON.parse(f.writes()[0].body),{ticker:'AMD_US_EQ',quantity:0.625,extendedHours:false});assert.deepEqual(keys,['NASDAQ:AMD','NASDAQ:AMD','NASDAQ:AMD']);
});
test('market quote loss or a higher estimate blocks submission of a priced review before writing',async t=>{
 const f=fixture(t);f.enable();f.source.read=path=>path.endsWith('/positions')?json([]):null;f.source.quote=(key,at)=>marketResult('AMD',at);
 const review=await f.service.preview('a',{...input,type:'MARKET',cashAmount:1000});
 f.source.quote=()=>({status:'unavailable'});await assert.rejects(()=>f.service.submit('a',{token:review.token,confirmed:true}),/reference price is unavailable/);assert.equal(f.writes().length,0);
 f.source.quote=(key,at)=>marketResult('AMD',at,201);await assert.rejects(()=>f.service.submit('a',{token:review.token,confirmed:true}),/Not enough available cash/);assert.equal(f.writes().length,0);
 f.source.quote=()=>{throw Error('provider outage');};assert.equal((await f.service.position('a','AMD_US_EQ')).price,null);
 await assert.rejects(()=>f.service.preview('a',{...input,type:'MARKET',cashAmount:100,limitPrice:1}),/reference price is unavailable/);
 assert.equal((await f.service.preview('a',{...input,limitPrice:50})).referencePrice,50);
});
test('broker-held prices take priority and missing quote observation time remains explicit',async t=>{
 const f=fixture(t);f.enable();f.source.quote=()=>{assert.fail('Held stock should use broker price');};
 const position=await f.service.position('a','AMD_US_EQ');assert.equal(position.price,100);assert.equal(position.priceQuote.source,'Trading 212');assert.equal(position.priceQuote.observedAt,null);
});
test('trade quote lookup verifies exact listing, class, currency, freshness and source metadata',async()=>{
 const at=Date.parse('2026-11-04T05:00:00Z'),instrument={ticker:'MSFT_US_EQ',currency:'USD',type:'STOCK',isin:'US5949181045'};
 let watchText='###STOCKS,NASDAQ:MSFT',response=marketResult('MSFT',at),calls=0;
 const read=createTradePrice({now:()=>at,workspace:()=>({watchText}),quote:async key=>{calls++;assert.equal(key,'NASDAQ:MSFT');return response;}});
 assert.equal((await read(instrument)).price,200);
 watchText='###ETF,NASDAQ:QQQ';assert.equal(await read(instrument),null);assert.equal(calls,1);
 watchText='###STOCKS,NASDAQ:MSFT,NYSE:MSFT';assert.equal(await read(instrument),null);assert.equal(calls,1);
 watchText='###STOCKS,NASDAQ:MSFT';
 for(const patch of [{currency:'EUR'},{providerSymbol:'QQQ'},{providerSymbol:'MSFT.L'},{exchangeName:'LSE'},{instrumentType:'ETF'},{kind:'future'},{provider:'Other'},{price:0},{price:NaN},{observedAt:null},{observedAt:new Date(at+60000).toISOString()},{observedAt:new Date(at-4*86400000).toISOString()},{sessionType:'unknown'}]){response={...marketResult('MSFT',at),quote:{...marketResult('MSFT',at).quote,...patch}};assert.equal(await read(instrument),null,JSON.stringify(patch));}
 for(const patch of [{status:'stale'},{status:'unavailable'},{fetchedAt:null},{fetchedAt:new Date(at-65000).toISOString()},{fetchedAt:new Date(at+60000).toISOString()}]){response={...marketResult('MSFT',at),...patch};assert.equal(await read(instrument),null);}
 response=marketResult('MSFT',at);response.quote.sessionType='regular';response.quote.observedAt=new Date(at-9*3600000).toISOString();const close=await read(instrument);assert.equal(close.priceQuote.session,'Regular session');assert.equal(close.priceQuote.observedAt,at-9*3600000);
 assert.equal(await read({...instrument,ticker:'MSFT_GB_EQ'}),null);assert.equal(await read({...instrument,currency:'EUR'}),null);
});
test('account reconnection during a market quote lookup invalidates position and review',async t=>{
 for(const action of ['position','preview']){
  const f=fixture(t);f.enable();f.source.read=path=>path.endsWith('/positions')?json([]):null;
  f.source.quote=(key,at)=>{f.connect();return marketResult('AMD',at);};await assert.rejects(()=>action==='position'?f.service.position('a','AMD_US_EQ'):f.service.preview('a',{...input,type:'MARKET',cashAmount:100}),/connection/);assert.equal(f.writes().length,0);
 }
});
