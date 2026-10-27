import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeedService, parseCalendar, parseSentiment, parseNews, normalizeSymbols, feedMiddleware, SOURCES } from '../server/feeds.mjs';
import { parsePlanningCalendar } from '../server/feeds.mjs';
import { marketDay, weekRange, periodRange, validateRange, eventDay, briefingTime, eventDisplayDate, nextHighImpact } from '../src/data/calendar.mjs';

test('Skopje uses 24-hour time across the European and US DST changes, including midnight dates',()=>{
 const clock=date=>briefingTime(date,{month:undefined,day:undefined});
 assert.equal(clock('2026-10-23T12:30:00Z'),'14:30');
 assert.equal(clock('2026-10-29T12:30:00Z'),'13:30');
 assert.equal(clock('2026-11-06T13:30:00Z'),'14:30');
 assert.equal(clock('2026-10-28T18:00:00Z'),'19:00');
 assert.equal(clock('2026-10-28T23:00:00Z'),'00:00');
 assert.equal(eventDisplayDate({date:'2026-10-28T23:30:00Z',calendarDate:'2026-10-28'}),'Oct 29');
 assert.equal(eventDisplayDate({date:null,calendarDate:'2026-10-28'}),'Oct 28');
});
test('Next high impact skips earlier low/medium, past, cancelled and untimed events and advances with time',()=>{
 const now=Date.parse('2026-10-24T12:00:00Z');
 const event=(id,minutes,extra={})=>({id,date:new Date(now+minutes*60000).toISOString(),impact:'High',...extra});
 const events=[event('later',120),event('low',2,{impact:'Low'}),event('cancelled',3,{status:'cancelled'}),event('medium',4,{impact:'Medium'}),event('past',-2),event('untimed',5,{date:null}),event('next',60,{status:'estimated'})];
 assert.equal(nextHighImpact(events,now).id,'next');
 assert.equal(nextHighImpact(events,now+61*60000).id,'later');
 assert.equal(nextHighImpact(events,now+121*60000),null);
 assert.equal(nextHighImpact(undefined,now),null);
 assert.equal(events[0].id,'later');
});

test('Calendar civil dates support Sunday weeks, year rollover, leap dates and New York DST',()=>{
 assert.equal(marketDay('2026-11-01T03:30:00Z'),'2026-10-31');
 assert.equal(marketDay('2026-11-01T05:30:00Z'),'2026-11-01');
 assert.deepEqual(periodRange('nextweek','2026-10-24'),{from:'2026-10-25',to:'2026-10-31'});
 assert.deepEqual(weekRange('2026-11-04'),{from:'2026-11-01',to:'2026-11-07'});
 assert.deepEqual(periodRange('nextmonth','2026-12-24'),{from:'2027-01-01',to:'2027-01-31'});
 assert.deepEqual(periodRange('month','2028-02-20'),{from:'2028-02-01',to:'2028-02-29'});
 for(const range of [{from:'2026-02-30',to:'2026-03-01'},{from:'2026-11-07',to:'2026-11-01'},{from:'2026-01-01',to:'2027-01-01'},{from:'https://example.com',to:'2026-11-07'},{from:'2026-11-01'}])assert.throws(()=>validateRange(range));
});
const futureRange={from:'2026-11-01',to:'2026-11-07'};
const planningEvent=(id,date='2026-11-06',extra={})=>({id,name:'Jobs report',country:'US',category:'economic-indicators',date,release_at_utc:`${date}T13:30:00Z`,time_precision:'minute',impact:'high',status:'confirmed',...extra});
const planningPage=(range,events,total=events.length)=>({...range,events,total});
test('Future events preserve exact times, date-only schedules, zero values, estimates and source credit',()=>{
 const raw=planningPage(futureRange,[planningEvent('jobs','2026-11-06',{actual:0,prior:1,unit:'%',source_url:'https://www.bls.gov/',source_name:'BLS'}),planningEvent('tentative','2026-11-03',{release_at_utc:null,time_precision:'date',status:'estimated',source_url:'javascript:alert(1)'}),planningEvent('holiday','2026-11-01',{release_at_utc:null,time_precision:'date',all_day:true,category:'market-holidays'}),planningEvent('foreign','2026-11-02',{country:'GB'})]);
 const {events}=parsePlanningCalendar(raw,futureRange);
 assert.equal(events.length,3);assert.equal(events[0].impact,'Holiday');assert.equal(events[0].date,null);assert.equal(eventDay(events[0]),'2026-11-01');assert.equal(events[0].timeLabel,'All day');
 assert.equal(events[1].timeLabel,'Tentative');assert.equal(events[1].date,null);assert.equal(events[1].status,'estimated');assert.equal(events[1].sourceUrl,null);
 assert.equal(events[2].date,'2026-11-06T13:30:00.000Z');assert.equal(events[2].actual,'0');assert.equal(events[2].forecast,null);assert.equal(events[2].unit,'%');assert.equal(events[2].sourceName,'BLS');
 assert.throws(()=>parsePlanningCalendar({...raw,total:10},futureRange));
 assert.throws(()=>parsePlanningCalendar(planningPage(futureRange,[planningEvent('bad','2026-10-28')]),futureRange));
 assert.throws(()=>parsePlanningCalendar(planningPage(futureRange,[planningEvent('same'),planningEvent('same')]),futureRange));
});
test('Date-range service loads future weeks automatically, caches separately and completes pagination',async()=>{
 const calls=[];
 const service=createFeedService({now:()=>Date.parse('2026-10-24T20:00:00Z'),fetcher:async input=>{
  const url=new URL(input);calls.push(url);
  assert.equal(url.origin,'https://www.financecalendar.com');assert.equal(url.searchParams.get('country'),'US');
  const range={from:url.searchParams.get('from'),to:url.searchParams.get('to')};
  const offset=Number(url.searchParams.get('offset'));
  return Response.json(planningPage(range,[planningEvent(String(offset),range.from)],2));
 }});
 const [first,concurrent]=await Promise.all([service.get('calendar',futureRange),service.get('calendar',futureRange)]);
 assert.equal(first.status,'ok');assert.equal(first.data.events.length,2);assert.deepEqual(first,concurrent);assert.equal(calls.length,2);
 assert.equal(calls[1].searchParams.get('offset'),'1');await service.get('calendar',futureRange);assert.equal(calls.length,2);
 await service.get('calendar',{from:'2026-10-25',to:'2026-10-31'});assert.equal(calls.length,4);
 await assert.rejects(service.get('calendar',{from:'2026-11-01',to:'bad'}));assert.equal(calls.length,4);
});
test('Current week reuses Forex Factory; wrong-week exports do not masquerade as current coverage',async()=>{
 let calls=0;
 const service=createFeedService({now:()=>Date.parse('2026-10-24T20:00:00Z'),fetcher:async()=>{calls++;return Response.json([{title:'Release',country:'USD',date:'2026-10-20T08:30:00-04:00',impact:'Low'}]);}});
 const result=await service.get('calendar',{from:'2026-10-18',to:'2026-10-24'});
 assert.equal(result.source.name,'Forex Factory');assert.equal(result.data.events.length,1);
 const today=await service.get('calendar',{from:'2026-10-24',to:'2026-10-24'});assert.equal(today.data.events.length,0);assert.equal(calls,1);
 const fallback=createFeedService({now:()=>Date.parse('2026-10-24T20:00:00Z'),fetcher:async url=>url===SOURCES.calendar.feed?Response.json([{title:'Old',country:'USD',date:'2026-10-10T08:30:00-04:00'}]):Response.json(planningPage({from:'2026-10-18',to:'2026-10-24'},[]))});
 assert.equal((await fallback.get('calendar',{from:'2026-10-18',to:'2026-10-24'})).source.name,'Finance Calendar');
});
test('Future calendar rejects partial responses and never reuses a different week during an outage',async()=>{
 let time=Date.parse('2026-10-24T20:00:00Z'),fail=false;
 const service=createFeedService({now:()=>time,fetcher:async()=>fail?new Response('',{status:429,headers:{'Retry-After':'1200'}}):Response.json(planningPage(futureRange,[planningEvent('jobs')]))});
 const first=await service.get('calendar',futureRange);fail=true;time+=11*60000;
 const stale=await service.get('calendar',futureRange);assert.equal(stale.status,'stale');assert.equal(stale.fetchedAt,first.fetchedAt);
 const other=await service.get('calendar',{from:'2026-11-08',to:'2026-11-14'});assert.equal(other.status,'unavailable');assert.equal(other.data,null);
 const partial=createFeedService({fetcher:async()=>Response.json(planningPage(futureRange,[],3))});
 assert.equal((await partial.get('calendar',futureRange)).status,'unavailable');
});
const rawCalendar=[{title:'CPI m/m',country:'USD',date:'2026-10-23T08:30:00-04:00',impact:'High',forecast:'0.3%',previous:'0.2%'},{title:'EU CPI',country:'EUR',date:'2026-10-23T08:00:00+02:00',impact:'High'},{title:'Fed speech',country:'USD',date:'2026-11-02T09:00:00-05:00',impact:'Low'}];
const rss=`<?xml version="1.0"?><rss><channel><item><title>Fed &amp; rates</title><link>https://finance.yahoo.com/news/fed.html?.tsrc=rss</link><pubDate>Fri, 23 Oct 2026 17:00:00 GMT</pubDate></item><item><title>Duplicate</title><link>https://finance.yahoo.com/news/fed.html</link><pubDate>Fri, 23 Oct 2026 17:00:00 GMT</pubDate></item><item><title>Unsafe</title><link>javascript:alert(1)</link><pubDate>Fri, 23 Oct 2026 17:00:00 GMT</pubDate></item><item><title>Missing date</title><link>https://example.com</link></item></channel></rss>`;
test('Calendar excludes non-US rows, handles DST offsets, and leaves absent actuals empty',()=>{
 const {events}=parseCalendar(rawCalendar);assert.equal(events.length,2);assert.ok(events.every(x=>x.country==='US'&&x.currency==='USD'));assert.equal(events[0].date,'2026-10-23T12:30:00.000Z');assert.equal(events[1].date,'2026-11-02T14:00:00.000Z');assert.equal(events[0].actual,null);assert.equal(events[1].forecast,null);assert.throws(()=>parseCalendar({}));assert.throws(()=>parseCalendar([{title:'Bad date',country:'USD',date:'TBD'}]));
});
test('CNN zero is a valid reading; missing, NaN and out-of-range readings are rejected',()=>{
 assert.equal(parseSentiment({fear_and_greed:{score:0,rating:'extreme fear',timestamp:'2026-10-23T15:00:00Z',previous_close:0}}).previousClose,0);
 for(const value of [null,NaN,101,-1,'50'])assert.throws(()=>parseSentiment({fear_and_greed:{score:value,rating:'fear',timestamp:'2026-10-23'}}));
 assert.throws(()=>parseSentiment({fear_and_greed:{score:50,rating:'unknown',timestamp:'2026-10-23'}}));
});
test('Automatic CNN archive preserves published score, comparisons, timestamp and attribution',async()=>{
 let calls=0;const time=Date.parse('2026-10-24T12:00:00Z');
 const raw={fear_and_greed:{score:20.98,rating:'extreme fear',timestamp:'2026-10-23T23:59:44Z',previous_close:19.81,previous_1_week:22.07,previous_1_month:32.54}};
 const cache=new Map([['sentiment:',{retryAt:time+86400000,result:{status:'unavailable',data:null,message:'Old direct CNN failure'}}]]);
 const service=createFeedService({now:()=>time,cache,fetcher:async url=>{calls++;assert.equal(url,SOURCES.sentiment.feed);assert.equal(new URL(url).hostname,'raw.githubusercontent.com');return new Response(JSON.stringify(raw));}});
 const [first,second]=await Promise.all([service.get('sentiment'),service.get('sentiment')]);
 assert.equal(calls,2);assert.deepEqual(first,second);assert.equal(first.status,'ok');assert.equal(first.data.score,20.98);assert.equal(first.data.observedAt,'2026-10-23T23:59:44.000Z');assert.equal(first.data.previousClose,19.81);assert.equal(first.source.delivery,'daily');assert.equal(first.source.via.url,'https://github.com/whit3rabbit/fear-greed-data');assert.equal(first.source.feed,undefined);
});
test('Successful downloads cannot disguise old or future CNN readings; weekends remain usable',async()=>{
 const time=Date.parse('2026-10-26T12:00:00Z');
 for(const [age,status] of [[3*86400000,'ok'],[5*86400000,'stale'],[8*86400000,'unavailable'],[-3600000,'unavailable']]){
  const service=createFeedService({now:()=>time,fetcher:async()=>new Response(JSON.stringify({fear_and_greed:{score:0,rating:'extreme fear',timestamp:new Date(time-age).toISOString()}}))});
  const result=await service.get('sentiment');assert.equal(result.status,status);if(status==='unavailable')assert.equal(result.data,null);else assert.equal(result.data.score,0);
 }
});
test('CNN age is checked on cache hits and archive outages retain the original observation',async()=>{
 let time=Date.parse('2026-10-26T12:00:00Z'),fail=false,calls=0;
 const observedAt=new Date(time-4*86400000+15*60000).toISOString();
 const service=createFeedService({now:()=>time,fetcher:async()=>{calls++;if(fail)throw new Error('Archive offline');return new Response(JSON.stringify({fear_and_greed:{score:40,rating:'fear',timestamp:observedAt}}));}});
 const first=await service.get('sentiment');assert.equal(first.status,'ok');time+=30*60000;assert.equal((await service.get('sentiment')).status,'stale');assert.equal(calls,3);
 fail=true;time+=60*60000;const retained=await service.get('sentiment');assert.equal(retained.status,'stale');assert.equal(retained.data.observedAt,observedAt);assert.equal(retained.fetchedAt,first.fetchedAt);
 time+=25*3600000;assert.equal((await service.get('sentiment')).data,null);
});
test('RSS decoding, safe article links, deduplication and economic topic filtering',()=>{
 const articles=parseNews(rss);assert.equal(articles.length,1);assert.equal(articles[0].title,'Fed & rates');assert.equal(articles[0].economy,true);assert.equal(articles[0].url,'https://finance.yahoo.com/news/fed.html');assert.throws(()=>parseNews('<html>Unavailable</html>'));assert.throws(()=>parseNews('<!DOCTYPE rss><rss/>'));assert.deepEqual(parseNews('<rss><channel/></rss>'),[]);
});
test('Only bounded stock-symbol queries accepted',()=>{
 assert.deepEqual(normalizeSymbols('SPY,QQQ,SPY'),['QQQ','SPY']);for(const input of ['','https://example.com','NQ1!','NVDA&url=x','SPY\nX'])assert.throws(()=>normalizeSymbols(input));
});
test('Failed source is unavailable, with no fabricated score and no retry storm',async()=>{
 let calls=0;const service=createFeedService({fetcher:async()=>{calls++;return new Response('blocked',{status:418});}});
 const [a,b]=await Promise.all([service.get('sentiment'),service.get('sentiment')]);assert.equal(a.status,'unavailable');assert.equal(a.data,null);assert.equal(a.fetchedAt,null);assert.deepEqual(a,b);await service.get('sentiment');assert.equal(calls,2);
});
test('Cache retains original timestamp on failed refresh and expires stale data',async()=>{
 let time=Date.parse('2026-10-24T12:00:00Z'),fail=false,calls=0;
 const service=createFeedService({now:()=>time,fetcher:async()=>{calls++;if(fail)throw new Error('offline');return new Response(JSON.stringify(rawCalendar));}});
 const first=await service.get('calendar');await service.get('calendar');assert.equal(calls,1);fail=true;time+=11*60000;
 const stale=await service.get('calendar');assert.equal(stale.status,'stale');assert.equal(stale.fetchedAt,first.fetchedAt);assert.notEqual(stale.checkedAt,first.checkedAt);time+=25*60*60000;const expired=await service.get('calendar');assert.equal(expired.status,'unavailable');assert.equal(expired.data,null);
});
test('API rejects mutation methods, unknown routes and unsafe symbols before fetching',async()=>{
 let calls=0;const middleware=feedMiddleware({get:async(kind,symbols)=>{normalizeSymbols(symbols);calls++;return {status:'ok'};}});
 for(const [url,method,expected] of [['/api/calendar','POST',405],['/api/bad','GET',404],['/api/news?symbols=http%3A%2F%2Fbad','GET',400]]){
  const res={setHeader(){},end(body){this.body=body;}};await middleware({url,method},res,()=>{});assert.equal(res.statusCode,expected);
 }assert.equal(calls,0);
});
test('Rate-limit Retry-After and persisted cache survive service recreation',async()=>{
 let time=Date.parse('2026-10-24T12:00:00Z'),calls=0,persisted;
 const cache=new Map();
 const service=createFeedService({now:()=>time,cache,onCache:map=>{persisted=JSON.stringify([...map]);},fetcher:async()=>{calls++;return new Response('limited',{status:429,headers:{'Retry-After':'3600'}});}});
 await service.get('calendar');time+=6*60000;await service.get('calendar');assert.equal(calls,1);
 const restored=createFeedService({now:()=>time,cache:new Map(JSON.parse(persisted)),fetcher:async()=>{throw new Error('Should not fetch during backoff');}});
 assert.equal((await restored.get('calendar')).status,'unavailable');
 time+=60*60000;await service.get('calendar');assert.equal(calls,2);
});
