import test from 'node:test';
import assert from 'node:assert/strict';
import {journalBroker,brokerWorkspace} from '../src/data/journal-brokers.mjs';
test('broker journal identities do not combine Vanquish, Trading 212, IBKR or unknown imports',()=>{
  const firms=['Vanquish','Vanquish Trader','IBKR','Interactive Brokers','Trading212','Trading 212','Another broker'];
  assert.deepEqual(firms.map(firm=>journalBroker({firm})),['trades','trades','ibkr','ibkr','broker','broker','other']);
});
test('editing the Vanquish subset preserves other journals and unrelated workspace state',()=>{
  let data={preferences:{symbol:'QQQ'},journal:{version:1,trades:[{id:'v',firm:'Vanquish',notes:''},{id:'i',firm:'IBKR',notes:'Keep IBKR'},{id:'t',firm:'Trading212',notes:'Keep Trading 212'}]}};
  const before=structuredClone(data),workspace={data,update:fn=>{data=fn(data);}};
  const subset=brokerWorkspace(workspace,'trades');assert.equal(subset.data.journal.trades.length,1);
  subset.update(current=>({...current,journal:{version:1,trades:current.journal.trades.map(t=>({...t,notes:'Updated Vanquish'}))}}));
  assert.equal(data.journal.trades.find(t=>t.id==='v').notes,'Updated Vanquish');
  for(const id of ['i','t'])assert.deepEqual(data.journal.trades.find(t=>t.id===id),before.journal.trades.find(t=>t.id===id));
  assert.deepEqual(data.preferences,before.preferences);
});
