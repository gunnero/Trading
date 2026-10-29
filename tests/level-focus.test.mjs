import test from 'node:test';
import assert from 'node:assert/strict';
import {levelChartKey,nearestLevelZones,zoneDistance} from '../src/data/level-focus.mjs';
import {levelDestination} from '../src/data/level-listings.mjs';

test('focus charts keep exact stock identities and use only verified futures mappings',()=>{
 for(const [symbol,key] of [['NQ','NQ'],['ES','ES'],['CL','NYMEX:CL1!'],['GC','COMEX:GC1!'],['RTY','CME_MINI:RTY1!'],['BTC',null],['YM',null]]){
  const instrument={symbol,futures:true};assert.equal(levelChartKey(instrument,levelDestination(instrument,[])),key);
 }
 for(const [symbol,key] of [['QQQ','QQQ'],['SPY','SPY'],['MRNA','NASDAQ:MRNA'],['ZZTEST',null]]){
  const instrument={symbol,futures:false};assert.equal(levelChartKey(instrument,levelDestination(instrument,[])),key);
 }
 assert.equal(levelChartKey({symbol:'ABC'},{kind:'choose',entries:[]}),null);
 assert.equal(levelChartKey(null,{}),null);
});
test('nearest zones measure the nearest edge, including zero distance inside a zone, without changing imports',()=>{
 const zones=[{type:'S',low:20,high:22},{type:'S',low:12,high:13},{type:'D',low:7,high:9},{type:'D',low:4,high:5},{type:'G',low:10,high:10}];
 const original=structuredClone(zones);
 assert.deepEqual(nearestLevelZones(zones,'S',11),[zones[1],zones[0]]);
 assert.deepEqual(nearestLevelZones(zones,'D',11),[zones[2],zones[3]]);
 assert.equal(zoneDistance(zones[1],12.5),0);assert.equal(zoneDistance(zones[1],13),0);assert.equal(zoneDistance(zones[1],15),2);
 assert.equal(zoneDistance(zones[1],null),null);assert.equal(zoneDistance(zones[1],NaN),null);
 assert.deepEqual(nearestLevelZones(zones,'S',null),[zones[1],zones[0]]);assert.deepEqual(nearestLevelZones(zones,'D',null),[zones[2],zones[3]]);
 assert.deepEqual(zones,original);
});
