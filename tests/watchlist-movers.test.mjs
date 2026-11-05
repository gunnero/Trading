import test from 'node:test';
import assert from 'node:assert/strict';
import {filterWatchlist,watchlistMove} from '../src/data/watchlist.mjs';
const entry=(symbol,group='STOCKS',exchange='NASDAQ')=>({id:`${exchange}:${symbol}`,symbol,group,exchange});
const entries=[entry('FIRST'),entry('DOWN'),entry('UP'),entry('FLAT'),entry('STALE'),entry('MISSING'),entry('LAST')];
const reading=(changePercent,status='ok',change=1)=>({status,quote:{changePercent,change}});
const quotes={'NASDAQ:FIRST':reading(1,'ok',999),'NASDAQ:DOWN':reading(-15),'NASDAQ:UP':reading(12),'NASDAQ:FLAT':reading(0),'NASDAQ:STALE':reading(80,'stale'),'NASDAQ:MISSING':{status:'unavailable'},'NASDAQ:LAST':reading(-20)};
const names=rows=>rows.map(r=>r.symbol);
test('Biggest move compares absolute source percentages across the full list before a compact limit',()=>{
 const original=structuredClone(entries);
 assert.deepEqual(names(filterWatchlist(entries,quotes).slice(0,5)),['LAST','DOWN','UP','FIRST','FLAT']);
 assert.deepEqual(entries,original);
 assert.equal(filterWatchlist(entries,quotes)[0],entries.at(-1));
});
test('Direction filters exclude stale or absent changes and preserve valid zero readings',()=>{
 assert.deepEqual(names(filterWatchlist(entries,quotes,{movement:'Gainers'})),['UP','FIRST']);
 assert.deepEqual(names(filterWatchlist(entries,quotes,{movement:'Losers'})),['LAST','DOWN']);
 assert.deepEqual(names(filterWatchlist(entries,quotes,{movement:'Unchanged'})),['FLAT']);
 for(const value of [undefined,null,NaN,Infinity,'12'])assert.equal(watchlistMove(entries[0],{'NASDAQ:FIRST':reading(value)}),null);
 assert.equal(watchlistMove(entries[0],{'NASDAQ:FIRST':reading(5,'loading')}),null);
});
test('Signed sort keeps missing/stale last; equal moves retain saved order; no source values are changed',()=>{
 assert.deepEqual(names(filterWatchlist(entries,quotes,{sort:'Top gainers'})),['UP','FIRST','FLAT','DOWN','LAST','STALE','MISSING']);
 assert.deepEqual(names(filterWatchlist(entries,quotes,{sort:'Top losers'})),['LAST','DOWN','FLAT','FIRST','UP','STALE','MISSING']);
 assert.deepEqual(names(filterWatchlist(entries,quotes,{sort:'Default'})),names(entries));
 assert.deepEqual(names(filterWatchlist(entries.slice(0,3),{'NASDAQ:FIRST':reading(2),'NASDAQ:DOWN':reading(-2),'NASDAQ:UP':reading(2)})),['FIRST','DOWN','UP']);
 assert.equal(quotes['NASDAQ:DOWN'].quote.changePercent,-15);
});
test('Search, asset and movement filters combine, preserving exact listings and QQQ quote aliases',()=>{
 const funds=[entry('QQQ','FUND'),entry('QQQ','FUND','AMEX'),entry('NVDA'),entry('ES1!','FUTURES','CME_MINI')];
 const data={QQQ:reading(-4),'NASDAQ:NVDA':reading(10),'CME_MINI:ES1!':reading(2)};
 assert.deepEqual(filterWatchlist(funds,data,{query:' nasdaq ',group:'FUND',movement:'Losers'}),[funds[0]]);
 assert.deepEqual(filterWatchlist(funds,data,{group:'FUND',movement:'Gainers'}),[]);
 assert.deepEqual(names(filterWatchlist(funds,data,{sort:'Symbol'})),['ES1!','NVDA','QQQ','QQQ']);
 assert.deepEqual(filterWatchlist([],{}),[]);
});
