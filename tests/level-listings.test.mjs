import test from 'node:test';
import assert from 'node:assert/strict';
import {initialWorkspace} from '../server/workspace.mjs';
import {parseLevels,parseWatchlist} from '../src/data/market.js';
import {levelDestination} from '../src/data/level-listings.mjs';
import {resolveSymbol,supportsSetup} from '../server/market-data.mjs';

const data=initialWorkspace(),sheet=parseLevels(data.levelText),watchlist=parseWatchlist(data.watchText);
test('Every stock/fund in the supplied sheet resolves to an exact listing with setup support',()=>{
  const instruments=Object.values(sheet.instruments).filter(item=>!item.futures),before=structuredClone({sheet,watchlist});assert.equal(instruments.length,33);
  for(const item of instruments){
    const target=levelDestination(item,watchlist);assert.equal(target.kind,'setup',item.symbol);assert.equal(target.entry.symbol,item.symbol);assert.equal(supportsSetup(target.entry.id,'2m'),true);assert.equal(resolveSymbol(target.entry.id).kind,'equity');
  }
  assert.deepEqual({sheet,watchlist},before);
  assert.equal(levelDestination(sheet.instruments.XLP,watchlist).entry.group,'FUND');assert.equal(levelDestination(sheet.instruments.SKHY,watchlist).entry.group,'DEPOSITARY RECEIPT');
});
test('Saved listings take precedence, ambiguous venues require a choice, and unknown names never get a guessed mapping',()=>{
  const override=parseWatchlist('###STOCKS,NYSE:NVDA');assert.equal(levelDestination(sheet.instruments.NVDA,override).entry.id,'NYSE:NVDA');
  const ambiguous=[...override,...parseWatchlist('###STOCKS,NASDAQ:NVDA')];assert.equal(levelDestination(sheet.instruments.NVDA,ambiguous).kind,'choose');
  const unknown={...sheet.instruments.NVDA,symbol:'UNKNOWN'};assert.equal(levelDestination(unknown,watchlist).kind,'unavailable');
  assert.equal(levelDestination(unknown,parseWatchlist('###STOCKS,OTHER:UNKNOWN')).kind,'unavailable');
});
test('Futures route to charts/details without borrowing stock or spot-crypto identities',()=>{
  for(const symbol of ['NQ','ES'])assert.equal(levelDestination(sheet.instruments[symbol],watchlist).kind,'chart');
  assert.equal(levelDestination(sheet.instruments.GC,watchlist).entry.id,'COMEX:GC1!');
  assert.equal(levelDestination(sheet.instruments.BTC,watchlist).kind,'unavailable');
  assert.equal(levelDestination({...sheet.instruments.NVDA,futures:true},watchlist).kind,'unavailable');
  assert.equal(levelDestination({...sheet.instruments.NQ,futures:false},watchlist).kind,'unavailable');
});
