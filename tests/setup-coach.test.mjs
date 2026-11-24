import assert from 'node:assert/strict';
import test from 'node:test';
import {evaluateRetest} from '../src/data/retests.mjs';
import {explainSetup} from '../src/data/setup-explanation.mjs';
import {coachAccount, journalCoach} from '../src/data/journal-coach.mjs';

const day = '2026-11-24';
const start = Date.parse(day + 'T14:30:00Z') / 1000;
const zone = {type:'S', low:100, high:101};
const instrument = {symbol:'QQQ', sourceDate:day, zones:[zone], timeframe:'4 h'};
const bar = (offset, close, low = close - .1, extra = {}) => ({
  sessionDate:day, open:close - .1, close, low, high:close + .1,
  end:start + offset * 120, closed:true, indicators:{ema9:101.1, ema21:100.9, vwap:101}, ...extra,
});
const breakBars = [bar(1, 100.5), bar(2, 101.4)];
const retest = bar(3, 101.35, 100.95);
function evaluate(bars, overrides = {}) {
  return evaluateRetest(instrument, day, {
    status:'ok', timeframe:'2m', quote:{sessionDate:day, price:101.35},
    through:bars.at(-1)?.end, bars, ...overrides,
  });
}
const states = explanation => Object.fromEntries(explanation.checks.map(check => [check.id, check.state]));

test('Explain this setup distinguishes a completed break, a developing retest and missing inputs', () => {
  const waiting = explainSetup(evaluate([...breakBars, {...retest, closed:false}]));
  assert.match(waiting.summary, /closed above supply.*hasn’t confirmed/);
  assert.deepEqual(states(waiting), {break:'passed', retest:'pending', ema:'pending', vwap:'pending', timing:'pending', location:'passed'});
  const missing = explainSetup(evaluate([], {status:'insufficient', message:'Missing regular-session candles'}));
  assert.match(missing.summary, /Missing regular-session candles/);
  assert.ok(missing.checks.every(check => check.state === 'unavailable'));
  const missingVwap = {...retest, indicators:{...retest.indicators, vwap:null}};
  assert.deepEqual(states(explainSetup(evaluate([...breakBars, missingVwap]))), {
    break:'passed', retest:'passed', ema:'passed', vwap:'unavailable', timing:'passed', location:'passed',
  });
});

test('the explanation keeps historical retest evidence when the timing or quote rule subsequently fails', () => {
  const confirmed = [...breakBars, retest];
  const nowInside = explainSetup(evaluate(confirmed, {quote:{sessionDate:day, price:100.9}}));
  assert.equal(states(nowInside).retest, 'passed');
  assert.equal(states(nowInside).location, 'failed');
  assert.match(nowInside.summary, /returned to the broken edge/);
  const expired = explainSetup(evaluate([...confirmed, bar(4, 101.4), bar(5, 101.4), bar(6, 101.4)]));
  assert.equal(states(expired).retest, 'passed');
  assert.equal(states(expired).timing, 'failed');
  assert.match(expired.summary, /aged out/);
  const bearish = evaluateRetest({symbol:'QQQ', sourceDate:day, zones:[{type:'D', low:100, high:101}]}, day, {
    status:'ok', quote:{sessionDate:day, price:99.7},
    bars:[bar(1, 100.5), bar(2, 99.7), {...bar(3, 99.7), high:100.2}].map(b => ({...b, indicators:{ema9:99.8, ema21:100, vwap:100.1}})),
  });
  assert.match(explainSetup(bearish).summary, /closed below demand/);
  assert.equal(states(explainSetup(bearish)).retest, 'passed');
});

const checks = {break:true, retest:true, ema:true, vwap:true};
const trade = (id, extra = {}) => ({
  id, firm:'Vanquish', account:'Main', entryAt:day+'T15:00:00Z', exitAt:day+'T16:00:00Z',
  entryPrice:2, exitPrice:3, quantity:1, multiplier:100, position:'long', fees:null,
  notes:'', tags:[], review:{}, ...extra,
});
const now = Date.parse(day+'T18:00:00Z');

test('Journal Coach shows exclusive groups, sample counts and gross comparison from recorded evidence', () => {
  const trades = [
    trade('tag', {tags:['Followed plan'], notes:'I waited for the confirming close.'}),
    trade('checks', {review:checks}),
    trade('both', {tags:['Early entry','Chased entry'], exitPrice:1.5}),
    trade('chase', {tags:['Chased entry'], exitPrice:2}),
    trade('mixed', {tags:['Early entry','Followed plan']}),
    trade('conflict', {tags:['Followed plan'], review:{retest:false}}),
    trade('unknown', {notes:'I did not enter early. Notes are not tags.'}),
    trade('open', {exitAt:null, tags:['Followed plan']}),
    trade('future', {exitAt:'2026-11-25T15:00:00Z', tags:['Followed plan']}),
    trade('older', {exitAt:'2026-10-25T19:00:00Z', tags:['Followed plan']}),
  ];
  const result = journalCoach(trades, {period:'7', now});
  assert.equal(result.total, 7);
  assert.deepEqual(result.counts, {followed:2, early:2, other:1, mixed:2});
  assert.equal(result.early, 1);
  assert.equal(result.chased, 2);
  assert.equal(result.partitions[0].average, 100);
  assert.equal(result.partitions[1].average, -25);
  assert.equal(result.partitions[1].flat, 1);
  assert.equal(result.partitions[0].notes[0].id, 'tag');
  assert.match(result.improvement.reason, /2 of 2 .* Chased entry/);
  assert.match(result.improvement.action, /broken edge/);
  assert.equal(journalCoach(trades, {period:'all', now}).total, 8);
});

test('Journal Coach respects account and Skopje exit dates and avoids an improvement based on empty data', () => {
  const main = trade('main', {review:{retest:false}});
  const other = trade('other', {account:'Other', exitAt:'2026-11-17T23:15:00Z'});
  const before = trade('before', {account:'Other', exitAt:'2026-11-17T22:45:00Z'});
  assert.match(journalCoach([main, other], {now, account:coachAccount(main)}).improvement.reason, /1 of 1/);
  assert.equal(journalCoach([main, other, before], {now, period:'7', account:coachAccount(other)}).total, 1);
  assert.equal(journalCoach([main], {now, account:coachAccount(other)}).improvement, null);
});
