import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarRows,calendarDays,impactMatches,supplied,releaseCountdown} from '../src/data/economic-calendar.mjs';
import {nextHighImpact} from '../src/data/calendar.mjs';
const range={from:'2026-10-25',to:'2026-10-31'},now=Date.parse('2026-10-29T22:37:00Z');
test('range and upcoming filters keep source civil dates, date-only events, zero actuals and order',()=>{
 const rows=[{id:1,title:'After midnight locally',date:'2026-10-29T23:30:00Z',calendarDate:'2026-10-29',actual:0},{id:2,title:'Past',date:'2026-10-28T12:00:00Z'},{id:3,title:'Tentative',calendarDate:'2026-10-30'},{id:4,title:'Other range',calendarDate:'2026-11-02'}];
 assert.deepEqual(calendarRows(rows,range,now,true).map(e=>e.id),[1,3]);assert.equal(supplied(0),true);assert.equal(supplied(''),false);assert.equal(supplied(null),false);
});
test('weekday view retains weekends containing holiday events and the current weekend day',()=>{
 assert.deepEqual(calendarDays(range,[], '2026-10-29'),['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30']);
 assert.ok(calendarDays(range,[{calendarDate:'2026-10-25'}],'2026-10-31').includes('2026-10-25'));assert.ok(calendarDays(range,[],'2026-10-31').includes('2026-10-31'));
});
test('high + medium and exclusive filters do not relabel source impact',()=>{
 const events=['High','Medium','Low','Holiday','Other'].map(impact=>({impact}));
 assert.deepEqual(events.filter(e=>impactMatches(e,'important')).map(e=>e.impact),['High','Medium']);assert.equal(events.filter(e=>impactMatches(e,'all')).length,5);assert.deepEqual(events.filter(e=>impactMatches(e,'Holiday')),[{impact:'Holiday'}]);
});
test('countdown rolls forward without promoting cancelled or untimed events',()=>{
 const events=[{id:1,impact:'High',date:'2026-10-29T22:38:00Z',status:'cancelled'},{id:2,impact:'High',calendarDate:'2026-10-30'},{id:3,impact:'High',date:'2026-11-02T15:00:00Z'}];
 assert.equal(nextHighImpact(events,now).id,3);assert.equal(nextHighImpact(events,Date.parse('2026-11-02T15:01:00Z')),null);assert.equal(releaseCountdown('2026-11-02T15:00:00Z',now),'in 3d 16h');assert.equal(releaseCountdown('2026-10-29T22:37:01Z',now),'in 1m');
});
