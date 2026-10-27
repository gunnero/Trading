import test from 'node:test';
import assert from 'node:assert/strict';
import {marketSession,tradingDay,exchangeInstant,clockDate,clockTime,clockRange,until} from '../src/data/market-session.mjs';

test('Stock sessions change exactly at pre-market, opening, closing and after-hours boundaries',()=>{
  for(const [time,state] of [['07:59:59','closed'],['08:00:00','pre'],['13:29:59','pre'],['13:30:00','open'],['19:59:59','open'],['20:00:00','after'],['23:59:59','after']]) {
    assert.equal(marketSession(`2026-10-23T${time}Z`).state,state,time);
  }
  assert.equal(marketSession('2026-10-24T00:00:00Z').state,'closed');
  // It is Saturday locally, but Friday's US after-hours session is still running.
  assert.equal(marketSession('2026-10-23T22:30:00Z').state,'after');
  assert.equal(clockDate('2026-10-23T22:30:00Z'),'Sat, 24 Oct 2026');
});

test('Weekends and exchange holidays skip to the next real trading day',()=>{
  const weekend=marketSession('2026-10-24T21:00:00Z');
  assert.equal(weekend.state,'weekend');assert.equal(weekend.nextOpen,'2026-10-26T13:30:00.000Z');
  assert.equal(clockTime(weekend.nextOpen),'14:30');
  const holiday=marketSession('2026-11-26T15:00:00Z');
  assert.equal(holiday.state,'holiday');assert.equal(holiday.detail,'Thanksgiving');
  assert.equal(holiday.nextOpen,'2026-11-27T14:30:00.000Z');
  const goodFriday=marketSession('2026-04-03T14:00:00Z');
  assert.equal(goodFriday.state,'holiday');assert.equal(goodFriday.nextOpen,'2026-04-06T13:30:00.000Z');
  // These are bond/federal holidays, not equity-market holidays.
  assert.equal(tradingDay('2026-10-12').kind,'session');assert.equal(tradingDay('2026-11-11').kind,'session');
});

test('Early closes shorten both regular and extended stock sessions and eligible options reference hours',()=>{
  const day=tradingDay('2026-11-27');
  assert.equal(day.early,true);assert.equal(day.close,'2026-11-27T18:00:00.000Z');
  assert.equal(day.post,'2026-11-27T22:00:00.000Z');assert.equal(day.optionsClose,'2026-11-27T18:15:00.000Z');
  assert.equal(marketSession('2026-11-27T17:59:59Z').state,'open');
  assert.equal(marketSession('2026-11-27T18:00:00Z').state,'after');
  assert.equal(marketSession('2026-11-27T22:00:00Z').state,'closed');
  assert.equal(marketSession('2026-12-24T18:01:00Z').state,'after');
  assert.equal(marketSession('2026-12-24T22:00:00Z').nextOpen,'2026-12-28T14:30:00.000Z');
});

test('Skopje opening times follow both countries’ DST changes and future target-date offsets',()=>{
  for(const [day,expected] of [['2026-03-06','15:30'],['2026-03-09','14:30'],['2026-03-30','15:30'],['2026-10-23','15:30'],['2026-10-26','14:30'],['2026-11-02','15:30']]) {
    assert.equal(clockTime(exchangeInstant(day,9,30)),expected,day);
  }
  const friday=marketSession('2026-10-30T23:00:00Z');
  assert.equal(friday.nextOpen,'2026-11-02T14:30:00.000Z');assert.equal(clockTime(friday.nextOpen),'15:30');
  const day=tradingDay('2026-10-23');assert.equal(clockRange(day.close,day.post),'22:00–02:00 (+1 day)');
  assert.equal(clockTime('2026-10-23T22:00:00Z',true),'00:00:00');
});

test('Observed holidays, year boundaries and calendar coverage never invent an opening',()=>{
  assert.equal(tradingDay('2026-07-03').kind,'holiday');
  assert.equal(tradingDay('2027-06-18').kind,'holiday');
  assert.equal(tradingDay('2027-12-24').kind,'holiday');
  assert.equal(tradingDay('2027-12-31').kind,'session');
  assert.equal(tradingDay('2028-07-03').early,true);
  const last=marketSession('2028-12-31T15:00:00Z');assert.equal(last.state,'weekend');assert.equal(last.nextOpen,null);
  const unknown=marketSession('2029-01-02T15:00:00Z');assert.equal(unknown.state,'unknown');assert.equal(unknown.schedule,null);assert.equal(unknown.transition,null);
  assert.equal(marketSession('2025-12-30T15:00:00Z').state,'unknown');
});

test('Session transitions and countdowns remain accurate without negative values',()=>{
  const pre=marketSession('2026-10-26T13:29:59Z');assert.equal(pre.transition.label,'Market opens');assert.equal(until(pre.transition.at,pre.now),'0m 1s');
  const open=marketSession('2026-10-26T13:30:00Z');assert.equal(open.transition.label,'Market closes');assert.equal(until(open.transition.at,open.now),'6h 30m');
  assert.equal(until(pre.transition.at,open.now+5000),'0m 0s');
  assert.equal(until('2026-10-26T13:30:00Z','2026-10-24T13:30:00Z'),'2d 0h 0m');
});
