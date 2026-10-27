import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openWorkspaceStore,initialWorkspace,validateWorkspace} from '../server/workspace.mjs';
import {validateDrawings,timeIndex,indexTime,MAX_DRAWINGS} from '../src/data/drawings.mjs';
const line={id:'my-line',type:'trend',color:'#efbd4e',points:[{time:1792758600,price:701.15},{time:1792845000,price:712.55}]};
test('Drawings survive a workspace restart without modifying imported levels or preferences',t=>{
 const directory=mkdtempSync(join(tmpdir(),'opening-bell-drawings-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));let store=openWorkspaceStore({directory});const before=store.read();
 const saved=store.save({...before.data,chartDrawings:{'QQQ|4h':[line],'NASDAQ:NVDA|2m':[{id:'note',type:'text',color:'#73b8ff',points:[line.points[0]],text:'Wait <not markup>'}]}},before.revision);
 store.close();store=openWorkspaceStore({directory});assert.deepEqual(store.read(),saved);assert.equal(saved.data.levelText,before.data.levelText);assert.deepEqual(saved.data.preferences,before.data.preferences);store.close();
});
test('Invalid coordinates, scopes, duplicate identifiers and drawing limits reject the whole save',()=>{
 for(const chartDrawings of [null,[],{'QQQ|3m':[line]},{'SPOT:QQQ|4h':[line]},{'QQQ|4h':[line,line]},{'QQQ|4h':[{...line,color:'url(https://bad.example)'}]},{'QQQ|4h':[{...line,points:[{time:1,price:Infinity},line.points[1]]}]},{'QQQ|4h':[{...line,points:[line.points[0]]}]},{'QQQ|4h':[{...line,type:'text',points:[line.points[0]],text:''}]},{'QQQ|4h':Array.from({length:MAX_DRAWINGS+1},(_,i)=>({...line,id:String(i)}))}])assert.throws(()=>validateWorkspace({...initialWorkspace(),chartDrawings}),e=>e.status===400);
 assert.equal(validateWorkspace(initialWorkspace()).chartDrawings,undefined);assert.equal(validateDrawings({'US2Y|D':[{id:'zero',type:'horizontal',color:'#e8edf0',points:[{time:123,price:0}]}]})['US2Y|D'][0].points[0].price,0);
});
test('Anchors retain source times across rolling history and missing anchors do not clamp to another candle',()=>{
 const times=[100,200,500,600];assert.equal(timeIndex(times,200),1);assert.equal(timeIndex(times,350),1.5);assert.equal(indexTime(times,1.5),350);assert.equal(timeIndex([200,500,600,900],200),0);assert.equal(timeIndex([200,500,600],100),null);assert.equal(timeIndex(times,700),null);assert.equal(timeIndex([100],100),0);assert.equal(indexTime([100],50),100);
});
