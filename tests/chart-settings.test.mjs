import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CHART_DEFAULTS,readChartSettings,chartConfig,validateChartSettings} from '../src/data/chart-settings.mjs';
import {initialWorkspace,openWorkspaceStore,validateWorkspace} from '../server/workspace.mjs';
const settings=()=>({defaults:structuredClone(CHART_DEFAULTS),charts:{},intervals:{QQQ:'4h'}});
test('Legacy workspaces inherit their selected timeframe without a write and keep drawings',()=>{
 const data={...initialWorkspace(),preferences:{symbol:'SPY',timeframe:'2m'},chartDrawings:{}};const before=structuredClone(data),s=readChartSettings(data);
 assert.equal(s.intervals.SPY,'2m');assert.equal(chartConfig(s,'NQ|4h').enabled.ema,true);assert.equal(chartConfig(s,'NQ|4h').panel,null);assert.deepEqual(data,before);assert.equal(validateWorkspace(data).chartSettings,undefined);
});
test('Indicator choices, panel, visibility, time/price ranges and per-listing timeframes survive a restart',t=>{
 const directory=mkdtempSync(join(tmpdir(),'chart-settings-test-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));let store=openWorkspaceStore({directory});const before=store.read(),s=settings();
 s.charts['NASDAQ:NVDA|2m']={...chartConfig(s,'NASDAQ:NVDA|2m'),enabled:{...CHART_DEFAULTS.enabled,ema:false},panel:'navigation',timeRange:{start:30,end:85},priceRange:{min:198.5,max:224.25},drawingsVisible:false};s.intervals['NASDAQ:NVDA']='2m';
 const saved=store.save({...before.data,chartSettings:s},before.revision);store.close();store=openWorkspaceStore({directory});assert.deepEqual(store.read(),saved);assert.equal(store.read().data.levelText,before.data.levelText);store.close();
});
test('Invalid scopes, timeframes, non-finite ranges, reversed bounds and indicator types reject the whole save',()=>{
 for(const alter of [s=>s.defaults.enabled.ema='yes',s=>s.defaults.drawingColor='url(foo)',s=>s.intervals.US2Y='2m',s=>s.intervals['SPOT:BTC']='4h',s=>s.charts['QQQ|7m']=chartConfig(s,'QQQ|4h'),s=>s.charts['QQQ|4h']={...chartConfig(s,'QQQ|4h'),panel:'arbitrary'},s=>s.charts['QQQ|4h']={...chartConfig(s,'QQQ|4h'),timeRange:{start:20,end:20}},s=>s.charts['QQQ|4h']={...chartConfig(s,'QQQ|4h'),priceRange:{min:Infinity,max:4}},s=>s.charts['QQQ|4h']={...chartConfig(s,'QQQ|4h'),priceRange:{min:5,max:2}}]){
  const s=settings();alter(s);assert.throws(()=>validateWorkspace({...initialWorkspace(),chartSettings:s}),e=>e.status===400);
 }
 const s=settings();s.charts['US2Y|D']={...chartConfig(s,'US2Y|D'),priceRange:{min:-1,max:0}};assert.equal(validateChartSettings(s).charts['US2Y|D'].priceRange.max,0);
});
