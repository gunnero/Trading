import test from 'node:test';
import assert from 'node:assert/strict';
import {levelChartKey,nearestLevelZones,zoneDistance,levelRoleRows} from '../src/data/level-focus.mjs';
import {levelDestination} from '../src/data/level-listings.mjs';
import {applyZoneRoles} from '../src/data/zone-roles.mjs';

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
const imported={symbol:'QQQ',sourceDate:'2026-11-04',timeframe:'4 h',zones:[{type:'S',low:710,high:711},{type:'D',low:704,high:705},{type:'G',low:701,high:702}]};
const bars=[{end:100,close:712,closed:true,sessionDate:'2026-11-04'},{end:200,close:713,closed:true,sessionDate:'2026-11-05'},{end:300,close:690,closed:false,sessionDate:'2026-11-05'}];
const confirmed={status:'ok',date:imported.sourceDate,through:200,bars,instrument:applyZoneRoles(imported,bars)};
test('role details preserve imports, distinguish latest flip from checked close, and leave gaps unclassified',()=>{
 const before=structuredClone(imported),rows=levelRoleRows(imported,confirmed);
 assert.equal(rows[0].zone.type,'S');assert.equal(rows[0].type,'D');assert.equal(rows[0].evidence.close,712);assert.equal(rows[0].status,'Role changed');
 assert.equal(rows[1].type,'D');assert.equal(rows[1].evidence.close,713);assert.equal(rows[1].status,'Role confirmed');
 assert.equal(rows[2].type,'G');assert.equal(rows[2].evidence,null);assert.equal(rows[2].label,'Gap (reference)');
 assert.deepEqual(imported,before);assert.equal(levelRoleRows(imported,{...confirmed,status:'stale'})[0].status,'Cached confirmation');
});
test('role details never borrow confirmation from another listing, source date, archive, or unavailable history',()=>{
 for(const roles of [null,{...confirmed,date:'2026-11-03'},{...confirmed,instrument:{...confirmed.instrument,symbol:'SPY'}},...['loading','unsupported','insufficient','unavailable'].map(status=>({...confirmed,status}))]){
  const row=levelRoleRows(imported,roles)[0];assert.equal(row.evidence,null);assert.equal(row.type,'S');
 }
 for(const reference of ['Historical reference','Extended-session reference','Comparison only']){
  const row=levelRoleRows(imported,confirmed,reference)[0];assert.equal(row.status,reference);assert.equal(row.evidence,null);assert.equal(row.type,'S');
 }
});
test('role details exclude developing, before-sheet and beyond-confirmation candles',()=>{
 for(const invalid of [{...bars[0],closed:false},{...bars[0],sessionDate:'2026-11-03'},{...bars[0],end:201}]){
  const row=levelRoleRows(imported,{...confirmed,bars:[invalid]})[0];assert.equal(row.evidence,null);assert.equal(row.type,'S');
 }
 assert.deepEqual(nearestLevelZones(imported.zones,'G',703),[imported.zones[2]]);
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
