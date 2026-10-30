import test from 'node:test';
import assert from 'node:assert/strict';
import {GRID_DEFAULTS,gridEntries,gridHistory,validateGrid} from '../src/data/chart-grid.mjs';
import {initialWorkspace,validateWorkspace} from '../server/workspace.mjs';
const stock=(symbol,group='STOCKS',exchange='NASDAQ')=>({symbol,group,exchange,id:`${exchange}:${symbol}`});
const nvda=stock('NVDA'),amd=stock('AMD'),qqq=stock('QQQ','FUND'),future=stock('NQ','FUTURES','CME');
test('watchlist keeps exact eligible listings; scanner ranks only qualifying results and retains pins',()=>{
 const other=stock('NVDA','STOCKS','NYSE'),watchlist=[qqq,nvda,amd,future,other];
 const scan={stocks:[{key:amd.id,entry:amd,stage:'waiting-retest'},{key:nvda.id,entry:nvda,stage:'confirmed'},{key:other.id,entry:other,stage:'stale'}]};
 assert.deepEqual(gridEntries(watchlist,scan,'watchlist',[]).remaining,[qqq,nvda,amd,other]);
 const result=gridEntries(watchlist,scan,'scanner',['QQQ']);
 assert.deepEqual(result.pinned,[qqq]);assert.deepEqual(result.remaining,[nvda,amd]);
 assert.deepEqual(gridEntries(watchlist,{stocks:[]},'scanner',[]).remaining,[]);
 assert.deepEqual(gridEntries([amd],scan,'watchlist',[nvda.id]).pinned,[]);
});
test('session crop preserves warmed-up indicator alignment and source candles unchanged',()=>{
 const history={candles:[{date:'2026-10-22',timestamp:1},{date:'2026-10-23',timestamp:2},{date:'2026-10-23',timestamp:3,partial:true}],indicators:{series:{ema9:[50,51,52],vwap:[null,51,52]},sessions:['a','b','b']}};
 const cropped=gridHistory(history,'session');
 assert.equal(cropped.candles.length,2);assert.deepEqual(cropped.indicators.series.ema9,[51,52]);assert.deepEqual(cropped.indicators.sessions,['b','b']);assert.equal(cropped.candles.at(-1).partial,true);assert.equal(history.candles.length,3);
 assert.equal(gridHistory(history,'history').candles.length,3);assert.deepEqual(gridHistory({},'session').candles,[]);
});
test('workspace saves grid preferences without changing other chart/strategy settings; invalid scopes rejected',()=>{
 const original=initialWorkspace(),grid={...GRID_DEFAULTS,view:'grid',pins:['QQQ',nvda.id]},saved=validateWorkspace({...original,preferences:{...original.preferences,chartGrid:grid}});
 assert.deepEqual(saved.preferences.chartGrid,grid);assert.equal(saved.preferences.timeframe,'4h');assert.equal(validateWorkspace(original).preferences.chartGrid,undefined);
 for(const change of [{interval:'1m'},{pins:['CME:NQ']},{pins:['QQQ','QQQ']},{pins:Array.from({length:7},(_,i)=>`NASDAQ:A${i}`)},{mode:'live'},{range:'future'},{view:'invalid'}])assert.throws(()=>validateGrid({...grid,...change}));
});
