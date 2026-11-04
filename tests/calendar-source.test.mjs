import test from 'node:test';
import assert from 'node:assert/strict';
import {createCalendarService,parseFutureCalendar} from '../server/calendar.mjs';
import {createFeedService,SOURCES} from '../server/feeds.mjs';
import {addDays,marketDay,nextHighImpact} from '../src/data/calendar.mjs';
const at=Date.parse('2026-11-04T20:00:00Z'),from=addDays(marketDay(at),-90);
const row=(id,date='2026-11-10T13:30:00Z',extra={})=>({calendar_event_id:id,release:id,name:'CPI',announcement_datetime:Date.parse(date)/1000,announcement_datetime_utc:date,release_date_confirmed:true,time_announced:true,event_importance:'high',source:'BLS',source_url:'https://www.bls.gov/',reference_period:'October 2026',value_unit:'%YoY',...extra});
const snapshot=(rows=[row('cpi')],extra={})=>({currency:'USD',start_date:from,history_start_date:'2026-07-27',history_truncated:false,data_quality:{row_count:rows.length,latest_available_date:'2027-12-28'},data:rows,...extra});
const weekly={status:'ok',source:{name:'Forex Factory',url:'https://www.forexfactory.com/calendar'},fetchedAt:new Date(at).toISOString(),data:{coverageStart:'2026-11-01T12:00:00Z',coverageEnd:'2026-11-06T20:00:00Z',events:[{id:'claims',title:'Claims',country:'US',date:'2026-11-05T13:30:00Z',impact:'High',forecast:'220K'}]}};
test('Free future calendar preserves exact timing, date-only records, sources, impact and estimates without inventing values',()=>{
 const parsed=parseFutureCalendar(snapshot([row('cpi'),row('date','2026-11-12T05:00:00Z',{time_announced:false,announcement_date:'2026-11-12',release_date_confirmed:false,source_attribution:'BLS attribution',source_license:'Public domain',source_url:'javascript:alert(1)'}),row('assumed','2026-11-13T13:30:00Z',{release_time_assumed:true}),row('cancelled','2026-11-14T13:30:00Z',{status:'cancelled'})]),from);
 assert.equal(parsed.events[0].date,'2026-11-10T13:30:00.000Z');assert.equal(parsed.events[0].impact,'High');assert.equal(parsed.events[0].period,'October 2026');assert.equal(parsed.events[0].unit,'%YoY');assert.equal(parsed.events[0].sourceUrl,'https://www.bls.gov/');
 for(const e of parsed.events){assert.equal(e.actual,null);assert.equal(e.previous,null);assert.equal(e.forecast,null);}
 assert.equal(parsed.events[1].date,null);assert.equal(parsed.events[1].calendarDate,'2026-11-12');assert.equal(parsed.events[1].status,'estimated');assert.deepEqual(parsed.events[1].credits,['BLS attribution','Public domain']);assert.equal(parsed.events[1].sourceUrl,null);assert.equal(parsed.events[2].date,null);assert.equal(parsed.events[3].status,'cancelled');
 assert.equal(nextHighImpact(parsed.events,Date.parse('2026-11-11')),null);
});
test('Calendar rejects wrong currency, partial snapshots, duplicate identities and conflicting timestamps',()=>{
 for(const raw of [snapshot([],{currency:'EUR'}),snapshot([],{start_date:'2026-01-01'}),snapshot([],{data_quality:{row_count:9,latest_available_date:'2027-12-28'}}),snapshot([row('same'),row('same')]),snapshot([row('bad','2026-11-10T13:30:00Z',{announcement_datetime:1})])])assert.throws(()=>parseFutureCalendar(raw,from));
});
test('All date ranges share one bounded 30-minute provider snapshot; new service reuses persisted cache',async()=>{
 let calls=0;const cache=new Map();const fetcher=async(url,options)=>{calls++;assert.equal(new URL(url).hostname,'api.fxmacrodata.com');assert.equal(new URL(url).searchParams.get('start_date'),from);assert.equal(options.redirect,'error');return Response.json(snapshot([row('nov'),row('dec','2026-12-04T13:30:00Z')]));};
 const service=createCalendarService({getWeekly:async()=>weekly,fetcher,now:()=>at,cache});
 const [nov,dec]=await Promise.all([service.get({from:'2026-11-08',to:'2026-11-14'}),service.get({from:'2026-12-01',to:'2026-12-31'})]);
 assert.equal(calls,1);assert.equal(nov.data.events[0].id,'fxmacro:nov');assert.equal(dec.data.events[0].id,'fxmacro:dec');assert.equal(nov.status,'ok');assert.equal(nov.data.partialCoverage,false);
 const restored=createCalendarService({getWeekly:async()=>weekly,fetcher:()=>{throw Error('must reuse cache');},now:()=>at+10*60000,cache:new Map(JSON.parse(JSON.stringify([...cache])))});assert.equal((await restored.get({from:'2026-11-08',to:'2026-11-14'})).data.events.length,1);
});
test('Upcoming spans use Forex Factory for current week and free future dates without duplicating releases or losing forecasts',async()=>{
 let calls=0;const service=createFeedService({now:()=>at,fetcher:async url=>{calls++;return url===SOURCES.calendar.feed?Response.json([{country:'USD',title:'Claims',date:'2026-11-05T08:30:00-05:00',impact:'High',forecast:'220K'}]):Response.json(snapshot([row('claims','2026-11-05T13:30:00Z'),row('cpi')]));}});
 const data=await service.get('calendar',{from:'2026-11-04',to:'2026-11-17'});assert.equal(calls,2);assert.equal(data.status,'ok');assert.equal(data.data.events.length,2);assert.equal(data.data.events[0].forecast,'220K');assert.equal(data.sources.length,2);assert.equal(nextHighImpact(data.data.events,at).title,'Claims');
});
test('Future provider failure retains actual available week as partial; does not imply future coverage',async()=>{
 let calls=0;const service=createCalendarService({getWeekly:async()=>weekly,now:()=>at,fetcher:async()=>{calls++;return new Response('',{status:429,headers:{'Retry-After':'3600'}});}});
 const partial=await service.get({from:'2026-11-04',to:'2026-11-17'});assert.equal(partial.data.partialCoverage,true);assert.equal(partial.data.events.length,1);assert.equal(partial.data.coverageEnd,'2026-11-07');assert.match(partial.message,/Partial schedule/);assert.equal(partial.data.missingDates[0],'2026-11-08');
 const other=await service.get({from:'2026-12-01',to:'2026-12-31'});assert.equal(other.status,'unavailable');assert.equal(other.data,null);assert.equal(calls,1);
});
test('Stale free schedules preserve observation time, expire after one day, and honor retry windows across ranges',async()=>{
 let time=at,fail=false,calls=0;const cache=new Map();const service=createCalendarService({getWeekly:async()=>weekly,now:()=>time,cache,fetcher:async()=>{calls++;return fail?new Response('',{status:429,headers:{'Retry-After':'7200'}}):Response.json(snapshot());}});
 const range={from:'2026-11-08',to:'2026-11-14'},first=await service.get(range);fail=true;time+=31*60000;
 const stale=await service.get(range);assert.equal(stale.status,'stale');assert.equal(stale.fetchedAt,first.fetchedAt);time+=31*60000;await service.get(range);assert.equal(calls,2);
 time+=25*60*60000;const expired=await service.get(range);assert.equal(expired.status,'unavailable');assert.equal(expired.data,null);
});
test('Unavailable/wrong-week exports fall back to the free schedule; unknown history is explicit',async()=>{
 const service=createCalendarService({getWeekly:async()=>({...weekly,data:{...weekly.data,coverageStart:'2026-10-25T12:00:00Z'}}),now:()=>at,fetcher:async()=>Response.json(snapshot([row('claims','2026-11-05T13:30:00Z')]))});
 const thisWeek=await service.get({from:'2026-11-01',to:'2026-11-07'});assert.equal(thisWeek.source.name,'FXMacroData');assert.equal(thisWeek.data.events.length,1);
 const history=await service.get({from:'2026-06-01',to:'2026-06-30'});assert.equal(history.status,'unavailable');assert.equal(history.data,null);
 await assert.rejects(service.get({from:'bad',to:'2026-11-07'}));
});
