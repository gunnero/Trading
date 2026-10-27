import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {openWorkspaceStore,initialWorkspace,validateWorkspace,workspaceMiddleware} from '../server/workspace.mjs';
function temp(t){const directory=mkdtempSync(join(tmpdir(),'opening-bell-test-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));return directory;}
const plan={id:'test-plan',symbol:'QQQ',scenario:'rejection',scenarioTitle:'Supply rejection',strategy:'Long put',expiration:'2026-10-30',budget:'150',thesis:'Wait for a rejection.',notes:'Saved across restarts.',sessionDate:'2026-10-23',priceMode:'sample'};
test('Workspace survives database close/reopen, preserving imports, plans, preferences and manual reading',t=>{
 const directory=temp(t);let store=openWorkspaceStore({directory});const first=store.read();assert.equal(first.revision,0);assert.equal(first.data.preferences.timeframe,'4h');
 const data={...first.data,watchText:'###FUND,NASDAQ:QQQ,AMEX:SPY',plans:[plan],preferences:{symbol:'SPY',timeframe:'15m'},manualSentiment:{score:42,rating:'Fear',date:'2026-10-23'}};
 const saved=store.save(data,0);assert.equal(saved.revision,1);store.close();store=openWorkspaceStore({directory});assert.deepEqual(store.read(),saved);store.close();
});
test('Concurrent workspaces reject stale updates without losing the saved document',t=>{
 const directory=temp(t);const a=openWorkspaceStore({directory}),b=openWorkspaceStore({directory});const before=a.read();const saved=a.save({...before.data,plans:[plan]},before.revision);
 assert.throws(()=>b.save({...before.data,plans:[]},before.revision),e=>e.status===409);assert.deepEqual(b.read(),saved);a.close();b.close();
});
test('Invalid level sheets, duplicate plans and bogus financial values never replace saved state',t=>{
 const store=openWorkspaceStore({directory:temp(t)});const before=store.read();
 for(const data of [{...before.data,levelText:'LVLS 2026-02-30\nQQQ|4h|S 800-700'},{...before.data,plans:[plan,plan]},{...before.data,plans:[{...plan,budget:'NaN'}]},{...before.data,manualSentiment:{score:101,date:'2026-10-23',rating:'Fear'}},{...before.data,preferences:{symbol:'BTC',timeframe:'4h'}}])assert.throws(()=>store.save(data,0));
 assert.deepEqual(store.read(),before);store.close();
});
test('Schema normalizes manual timestamps and drops unrecognized top-level fields',()=>{
 const data=validateWorkspace({...initialWorkspace(),ignored:'not stored',manualSentiment:{score:0,rating:'Extreme fear',date:'2026-10-23',observedAt:'bogus'}});assert.equal(data.ignored,undefined);assert.equal(data.manualSentiment.observedAt,'2026-10-23T12:00:00.000Z');assert.equal(data.manualSentiment.score,0);
});
test('HTTP save validates origin, content type, revision and response status',async t=>{
 const store=openWorkspaceStore({directory:temp(t)});const middleware=workspaceMiddleware(store);const server=createServer((req,res)=>middleware(req,res,()=>{res.writeHead(404);res.end();}));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));store.close();});
 const url=`http://127.0.0.1:${server.address().port}/api/workspace`,origin=new URL(url).origin;
 const first=await(await fetch(url)).json();const body=JSON.stringify({revision:first.revision,data:{...first.data,plans:[plan]}});const headers={'Content-Type':'application/json','X-Opening-Bell-Client':'web',Origin:origin};
 assert.equal((await fetch(url,{method:'PUT',body,headers:{...headers,Origin:'https://unrelated.example'}})).status,403);
 assert.equal((await fetch(url,{method:'PUT',body,headers:{...headers,Origin:'null'}})).status,403);
 assert.equal((await fetch(url,{method:'PUT',body,headers:{'Content-Type':'text/plain'}})).status,415);
 assert.equal((await fetch(url,{method:'PUT',body,headers:{...headers,'Content-Type':'application/json-bogus'}})).status,415);
 assert.equal((await fetch(url,{method:'PUT',body:'x'.repeat(3_000_001),headers})).status,413);
 assert.equal((await fetch(url,{method:'PUT',body:'not json',headers})).status,400);
 assert.equal((await fetch(url,{method:'DELETE'})).status,405);
 assert.equal((await fetch(url,{method:'PUT',body,headers})).status,200);
 assert.equal((await fetch(url,{method:'PUT',body,headers})).status,409);
 const after=await(await fetch(url)).json();assert.deepEqual(after.data.plans,[plan]);assert.equal(after.revision,1);
});
