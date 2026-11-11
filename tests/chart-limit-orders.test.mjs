import test from 'node:test';
import assert from 'node:assert/strict';
import {chartLimitOrders,limitOrderLabel,limitOrderDescription,layoutLimitOrders} from '../src/data/chart-limit-orders.mjs';

const order=(id,value,extra={})=>({id,side:'BUY',value,currency:'USD',remainingQuantity:1.23456789,status:'NEW',...extra});

test('chart references reject invalid prices and completed orders without inventing unreported quantities',()=>{
  const input=[order('valid',500),order('unknown',450,{remainingQuantity:null}),order('invalid',NaN),order('zero',0),order('negative',-1),order('string','500'),order('side',500,{side:'OTHER'}),...['FILLED','CANCELLED','REJECTED','REPLACED','EXPIRED'].map(status=>order(status,500,{status}))];
  const lines=chartLimitOrders(input);
  assert.deepEqual(lines.map(line=>line.id),['valid','unknown']);
  assert.equal(lines[1].remainingQuantity,null);
  assert.equal(input[0].color,undefined);
  assert.match(limitOrderDescription(lines[1]),/remaining shares unknown/);
  assert.deepEqual(chartLimitOrders(null),[]);
});

test('order labels retain exact price, remaining precision and uncertain/cancelling/partial states',()=>{
  const partial=chartLimitOrders([order('partial',0.12345678,{status:'PARTIALLY_FILLED',side:'SELL'})])[0];
  assert.match(limitOrderLabel(partial),/SELL LIMIT 0\.12345678 USD\n1\.23456789 sh left · Partial/);
  assert.match(limitOrderDescription(partial),/Partially filled/);
  assert.match(limitOrderDescription(order('cancel',500,{status:'CANCELLING'})),/Cancelling/);
  assert.match(limitOrderLabel(order('stale',500,{stale:true,unconfirmed:true})),/Unconfirmed · cached/);
});

test('same-price and nearby orders keep exact lines while labels avoid each other and the average-price label',()=>{
  const lines=chartLimitOrders([order('a',100),order('b',100,{side:'SELL'}),order('c',100.01),order('d',99.99)]);
  const reserved=[{top:50,bottom:74}],layout=layoutLimitOrders(lines,{min:90,max:110,top:0,bottom:240,reserved});
  assert.equal(layout.length,4);
  assert.equal(layout.find(line=>line.id==='a').y,120);
  assert.equal(layout.find(line=>line.id==='b').y,120);
  const centers=layout.map(line=>line.labelY).sort((a,b)=>a-b);
  assert.ok(centers.every(center=>center!==null));
  assert.ok(centers.every((center,index)=>index===0||center-centers[index-1]>=36));
  assert.ok(centers.every(center=>center+16+4<=50||center-16>=78));
  assert.deepEqual(reserved,[{top:50,bottom:74}]);
});

test('dense and manual ranges retain all visible price lines without overlapping or out-of-bounds labels',()=>{
  const lines=chartLimitOrders(Array.from({length:15},(_,i)=>order(String(i),100+i/100)));
  const layout=layoutLimitOrders(lines,{min:99,max:101,top:5,bottom:152});
  assert.equal(layout.length,15);
  const centers=layout.filter(line=>line.labelY!==null).map(line=>line.labelY).sort((a,b)=>a-b);
  assert.ok(centers.length>0&&centers.length<15);
  assert.ok(centers.every(center=>center-16>=5&&center+16<=152));
  assert.ok(centers.every((center,index)=>index===0||center-centers[index-1]>=36));
  assert.deepEqual(layoutLimitOrders(lines,{min:150,max:200,top:0,bottom:150}),[]);
  assert.deepEqual(layoutLimitOrders(lines,{min:100,max:100,top:0,bottom:150}),[]);
});
