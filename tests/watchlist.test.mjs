import test from 'node:test';
import assert from 'node:assert/strict';
import {initialWorkspace,validateWorkspace} from '../server/workspace.mjs';
import {parseWatchlist} from '../src/data/market.js';
import {readWatchlist,newWatchEntry,serializeWatchlist,addWatchEntry,removeWatchEntry} from '../src/data/watchlist.mjs';

test('Editing preserves listing identity, futures notation, groups and order',()=>{
  const original=initialWorkspace(),entries=readWatchlist(original.watchText);
  assert.deepEqual(readWatchlist(serializeWatchlist(entries)),entries);
  const entry=newWatchEntry({symbol:' brk.b ',exchange:'nyse',group:'STOCKS'});
  const added=addWatchEntry(original,entry),removed=removeWatchEntry(added,'CME_MINI:NQ1!');
  assert.equal(entry.id,'NYSE:BRK.B');
  assert.deepEqual(readWatchlist(removed.watchText),[...entries.filter(e=>e.id!=='CME_MINI:NQ1!'),entry]);
  assert.throws(()=>addWatchEntry(added,entry),/already in your watchlist/);
  assert.equal(removeWatchEntry(added,'NYSE:MISSING'),added);
  assert.throws(()=>newWatchEntry({symbol:'AAPL,NYSE:KO',exchange:'NASDAQ',group:'STOCKS'}));
  assert.throws(()=>newWatchEntry({symbol:'QQQ',exchange:'BITSTAMP',group:'FUND'}));
});

test('Removal clears a removed Custom choice but preserves charts, plans, levels and other preferences; undo reinserts only that symbol',()=>{
  const original=initialWorkspace();
  original.preferences={...original.preferences,symbol:'SPY',customSymbol:'NASDAQ:NVDA',focus:'custom',setupInterval:'2m'};
  original.chartDrawings={saved:'drawings'};original.chartSettings={saved:'settings'};original.plans=[{saved:'plan'}];
  const entries=readWatchlist(original.watchText),index=entries.findIndex(e=>e.id==='NASDAQ:NVDA'),entry=entries[index];
  const removed=removeWatchEntry(original,entry.id);
  assert.equal(removed.preferences.customSymbol,'');assert.equal(removed.preferences.focus,'SPY');assert.equal(removed.preferences.setupInterval,'2m');
  for(const field of ['levelText','chartDrawings','chartSettings','plans'])assert.equal(removed[field],original[field]);
  const other=newWatchEntry({symbol:'KO',exchange:'NYSE',group:'STOCKS'}),restored=addWatchEntry(addWatchEntry(removed,other),entry,index);
  assert.deepEqual(readWatchlist(restored.watchText),[...entries,other]);assert.equal(restored.preferences.focus,'SPY');
});

test('An empty saved watchlist is valid and can be repopulated; empty imports still reject',()=>{
  const original={...initialWorkspace(),watchText:'###STOCKS,NASDAQ:NVDA'};
  const empty=removeWatchEntry(original,'NASDAQ:NVDA');
  assert.deepEqual(readWatchlist(validateWorkspace(empty).watchText),[]);
  assert.throws(()=>parseWatchlist(''),/empty/);
  const entry=newWatchEntry({symbol:'TLT',exchange:'NASDAQ',group:'FUND'});
  assert.deepEqual(readWatchlist(addWatchEntry(empty,entry).watchText),[entry]);
});
