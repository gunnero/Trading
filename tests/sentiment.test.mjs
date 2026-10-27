import test from 'node:test';
import assert from 'node:assert/strict';
import {createFeedService,parseSentiment,SOURCES} from '../server/feeds.mjs';
import {HOURLY_SENTIMENT_URL,HOURLY_SENTIMENT_SOURCE,parseHourlySentiment} from '../server/sentiment.mjs';
import {sentimentDisplay,sentimentScore} from '../src/data/sentiment.mjs';
import {SENTIMENT_NOW,hourlySentiment,dailySentiment} from './fixtures/sentiment.mjs';
const payloadFor=url=>url===HOURLY_SENTIMENT_URL?hourlySentiment():dailySentiment();
const fetcher=async url=>Response.json(payloadFor(url));

test('Hourly snapshot preserves CNN-specific observation, rating and comparisons, excluding other markets and run dates',()=>{
 const raw=hourlySentiment(),data=parseHourlySentiment(raw,parseSentiment,SENTIMENT_NOW);
 assert.deepEqual(data,{score:21.37,rating:'extreme fear',observedAt:'2026-10-26T14:05:00.000Z',previousClose:20.98,previousWeek:20.8,previousMonth:36.94,mirroredAt:'2026-10-26T14:10:00.000Z'});
 raw.cnn.value=0;raw.cnn.previousClose=0;delete raw.cnn.previous1Week;assert.equal(parseHourlySentiment(raw,parseSentiment,SENTIMENT_NOW).previousClose,0);assert.equal(parseHourlySentiment(raw,parseSentiment,SENTIMENT_NOW).previousWeek,null);
 for(const edit of [r=>{r.cnn=null;},r=>{r.sources.cnn.ok=false;},r=>{r.cnn.timestamp='2026-10-26';},r=>{r.cnn.value='21';},r=>{r.cnn.value=101;},r=>{r.cnn.rating='crypto fear';},r=>{r.updated='2026-10-27T14:00Z';},r=>{r.cnn.timestamp='2026-10-26T14:20Z';}]){const item=hourlySentiment();edit(item);assert.throws(()=>parseHourlySentiment(item,parseSentiment,SENTIMENT_NOW));}
});

test('Automatic feed chooses the newest CNN observation, with complete source attribution and shared requests',async()=>{
 const urls=[],service=createFeedService({now:()=>SENTIMENT_NOW,fetcher:async(url,options)=>{urls.push(url);if(url===HOURLY_SENTIMENT_URL)assert.equal(options.redirect,'error');return fetcher(url);}});
 const [a,b]=await Promise.all([service.get('sentiment'),service.get('sentiment')]);assert.deepEqual(a,b);assert.equal(urls.length,2);assert.ok(urls.includes(SOURCES.sentiment.feed));assert.equal(a.status,'ok');assert.equal(a.data.score,21.37);assert.equal(a.data.previousClose,20.98);assert.equal(a.source.delivery,'hourly');assert.equal(a.source.via.url,HOURLY_SENTIMENT_SOURCE.via.url);assert.equal(a.source.feed,undefined);
 await service.get('sentiment');assert.equal(urls.length,2);
});

test('Newer archive wins over an hourly mirror; fetch and publication dates cannot override CNN observation dates',async()=>{
 const archive=dailySentiment();archive.fear_and_greed.timestamp='2026-10-26T14:12Z';archive.fear_and_greed.score=22;
 const result=await createFeedService({now:()=>SENTIMENT_NOW,fetcher:async url=>Response.json(url===HOURLY_SENTIMENT_URL?hourlySentiment():archive)}).get('sentiment');assert.equal(result.data.score,22);assert.equal(result.source.delivery,'daily');assert.equal(result.data.previousClose,archive.fear_and_greed.previous_close);
});

test('Hourly outages use the daily backup; invalid future/old/crypto-only snapshots never replace it',async()=>{
 for(const scenario of ['offline','crypto','future','old','cnn-failed','oversize']){
  const service=createFeedService({now:()=>SENTIMENT_NOW,fetcher:async url=>{
   if(url!==HOURLY_SENTIMENT_URL)return Response.json(dailySentiment());
   if(scenario==='offline')throw Error('Offline');if(scenario==='oversize')return new Response('x'.repeat(2_000_001));
   const data=hourlySentiment();if(scenario==='crypto')delete data.cnn;
   if(scenario==='cnn-failed')data.sources.cnn.ok=false;
   if(scenario==='future'){data.cnn.timestamp='2026-10-27T14:05Z';data.updated='2026-10-27T14:10Z';}
   if(scenario==='old')data.cnn.timestamp='2026-10-18T14:05Z';
   return Response.json(data);
  }});
  const result=await service.get('sentiment');assert.equal(result.source.delivery,'daily',scenario);assert.equal(result.data.observedAt,'2026-10-23T23:59:44.000Z',scenario);
 }
});

test('Hourly refresh uses a ten-minute cache and keeps the newer cached reading through source failure or regression',async()=>{
 let time=SENTIMENT_NOW,mode='ok',hourlyCalls=0,dailyCalls=0;
 const service=createFeedService({now:()=>time,fetcher:async url=>{
  if(url!==HOURLY_SENTIMENT_URL){dailyCalls++;return Response.json(dailySentiment());}hourlyCalls++;
  if(mode==='offline')throw Error('Offline');const item=hourlySentiment();if(mode==='older')item.cnn.timestamp='2026-10-23T21:00Z';return Response.json(item);
 }});
 const first=await service.get('sentiment');time+=9*60000;await service.get('sentiment');assert.equal(hourlyCalls,1);
 time+=2*60000;mode='offline';const stale=await service.get('sentiment');assert.equal(stale.status,'stale');assert.deepEqual(stale.data,first.data);assert.equal(stale.fetchedAt,first.fetchedAt);assert.notEqual(stale.checkedAt,first.checkedAt);assert.equal(dailyCalls,1);
 time+=6*60000;mode='older';const kept=await service.get('sentiment');assert.equal(kept.data.score,21.37);assert.equal(kept.fetchedAt,first.fetchedAt);assert.match(kept.message,/older snapshot/);
 time+=25*3600000;mode='offline';const expired=await service.get('sentiment');assert.equal(expired.source.delivery,'daily');assert.notEqual(expired.data.observedAt,first.data.observedAt);
});

test('Provider backoff survives restart and does not stop the independent daily source',async()=>{
 const cache=new Map();let time=SENTIMENT_NOW,hourlyCalls=0,dailyCalls=0;
 const fetcher=async url=>{if(url===HOURLY_SENTIMENT_URL){hourlyCalls++;return new Response('Rate limited',{status:429,headers:{'Retry-After':'3600'}});}dailyCalls++;return Response.json(dailySentiment());};
 await createFeedService({cache,fetcher,now:()=>time}).get('sentiment');time+=30*60000;
 const restarted=createFeedService({cache:new Map(JSON.parse(JSON.stringify([...cache]))),fetcher,now:()=>time});await restarted.get('sentiment');assert.equal(hourlyCalls,1);assert.equal(dailyCalls,1);
 time+=31*60000;await restarted.get('sentiment');assert.equal(hourlyCalls,2);assert.equal(dailyCalls,2);
});

test('Both unavailable sources give an honest empty state; no score is generated',async()=>{
 const result=await createFeedService({now:()=>SENTIMENT_NOW,fetcher:async()=>new Response('',{status:403})}).get('sentiment');assert.equal(result.status,'unavailable');assert.equal(result.data,null);assert.equal(result.fetchedAt,null);
});

test('Market-hours freshness changes without a new download and respects weekends, holidays and DST',()=>{
 const feed={status:'ok',source:HOURLY_SENTIMENT_SOURCE,data:{observedAt:'2026-10-26T14:05Z'}};
 assert.equal(sentimentDisplay(feed,SENTIMENT_NOW).label,'Hourly snapshot');
 assert.equal(sentimentDisplay(feed,Date.parse('2026-10-26T15:36Z')).label,'Delayed snapshot');
 const friday={...feed,data:{observedAt:'2026-10-23T23:59:44Z'}};
 assert.equal(sentimentDisplay(friday,Date.parse('2026-10-24T14:00Z')).warning,false);
 assert.equal(sentimentDisplay(friday,Date.parse('2026-10-26T13:29Z')).warning,false);
 assert.equal(sentimentDisplay(friday,Date.parse('2026-10-26T13:30Z')).label,'Awaiting market update');
 const november={...feed,data:{observedAt:'2026-11-02T14:00Z'}};
 assert.equal(sentimentDisplay(november,Date.parse('2026-11-02T14:29Z')).warning,false);
 assert.equal(sentimentDisplay(november,Date.parse('2026-11-02T14:30Z')).label,'Awaiting market update');
 assert.equal(sentimentDisplay({...feed,data:{observedAt:'2026-11-25T23:59Z'}},Date.parse('2026-11-26T16:00Z')).warning,false);
 assert.equal(sentimentDisplay({...feed,source:{delivery:'daily'}},SENTIMENT_NOW).label,'Daily backup');
 assert.equal(sentimentDisplay({...feed,status:'stale',message:'Offline'},SENTIMENT_NOW).label,'Cached snapshot');
 assert.equal(sentimentScore(21.37),'21.37');assert.equal(sentimentScore(0),'0.00');assert.equal(sentimentScore(null),'—');
});

test('Outdated readings stay outdated after close and over the weekend; closing snapshots do not age while the market is closed',()=>{
 const feed={status:'ok',source:HOURLY_SENTIMENT_SOURCE,data:{observedAt:'2026-10-23T13:00Z'}};
 for(const when of ['2026-10-23T20:01Z','2026-10-24T14:00Z','2026-10-26T13:29Z'])assert.equal(sentimentDisplay(feed,Date.parse(when)).outdated,true,when);
 const midday={...feed,data:{observedAt:'2026-10-23T16:00Z'}};
 assert.equal(sentimentDisplay(midday,Date.parse('2026-10-24T14:00Z')).label,'Delayed snapshot');
 const close={...feed,data:{observedAt:'2026-10-23T20:00Z'}};
 for(const when of ['2026-10-24T14:00Z','2026-10-26T13:29Z'])assert.notEqual(sentimentDisplay(close,Date.parse(when)).outdated,true);
 assert.equal(sentimentDisplay(close,Date.parse('2026-10-26T13:30Z')).outdated,true);
});
