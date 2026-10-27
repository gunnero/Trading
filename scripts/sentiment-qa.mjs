import {chromium,expect} from '@playwright/test';
import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {testRuntime} from './qa-runtime.mjs';
import {testFetch} from '../tests/fixtures/auth.mjs';
import {mockMarket} from '../tests/fixtures/market.mjs';
import {mockBriefing} from '../tests/fixtures/briefing.mjs';
import {SENTIMENT_NOW,hourlySentiment,dailySentiment} from '../tests/fixtures/sentiment.mjs';
import {parseSentiment,SOURCES} from '../server/feeds.mjs';
import {HOURLY_SENTIMENT_SOURCE,parseHourlySentiment} from '../server/sentiment.mjs';
import {OANOR_SOURCE} from '../server/sentiment-connection.mjs';

const runtime=await testRuntime(),launch={headless:true};
const executable='/home/gunner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',libs='/home/gunner/.cache/mediahub/browser-libs/root/usr/lib/x86_64-linux-gnu';
if(existsSync(executable))launch.executablePath=executable;
if(existsSync(libs))launch.env={...process.env,LD_LIBRARY_PATH:libs};
let browser;const errors=[],checks=[];mkdirSync('docs/qa',{recursive:true});
const mark=text=>{checks.push(text);console.log('PASS '+text);};
try{
 const before=await (await testFetch(runtime.url+'/api/workspace')).json();
 browser=await chromium.launch(launch);const page=await browser.newPage({viewport:{width:1488,height:1100},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
 await page.clock.install({time:new Date(SENTIMENT_NOW)});await mockMarket(page);await mockBriefing(page);
 let result={status:'ok',source:HOURLY_SENTIMENT_SOURCE,fetchedAt:new Date(SENTIMENT_NOW).toISOString(),checkedAt:new Date(SENTIMENT_NOW).toISOString(),data:parseHourlySentiment(hourlySentiment(),parseSentiment,SENTIMENT_NOW)},calls=0;
 await page.route('**/api/sentiment',route=>{calls++;return route.fulfill({json:result});});
 const card=page.getByRole('region',{name:'CNN Fear and Greed'}),overview=page.locator('.overview-sentiment');
 await page.goto(runtime.url+'/#briefing');await expect(card.locator('.sentiment-value>strong')).toHaveText('21.37');await expect(card.locator('.sentiment-history')).toContainText('20.98');await expect(card.locator('.reading-date')).toContainText('15:05 Skopje');await expect(card.locator('.feed-status')).toContainText(/Source checked Oct 26.*15:15 Skopje/);await expect(card).toContainText('Hourly CNN snapshot');await expect(card).toContainText('not a real-time feed');await expect(card.getByRole('meter')).toHaveAttribute('aria-valuenow','21.37');await expect(card.getByRole('button',{name:'Enter a CNN reading'})).toHaveCount(0);
 mark('Hourly source, two-decimal score, exact comparisons and separate reading/check times render correctly');
 const oldCalls=calls;result={...result,data:{...result.data,score:22.15,observedAt:'2026-10-26T14:14:00Z'}};
 await page.clock.fastForward(600001);await expect.poll(()=>calls).toBeGreaterThan(oldCalls);await expect(card.locator('.sentiment-value>strong')).toHaveText('22.15');
 await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Overview',exact:true}).click();await expect(overview).toContainText('22.15 / 100');await expect(overview).toContainText('15:14');
 mark('Ten-minute refresh updates the reading automatically and shares it with Overview');
 result={...result,data:{...result.data,observedAt:'2026-10-26T11:25:46Z'}};await page.reload();await expect(overview).toContainText('Awaiting market update');await expect(overview.locator('strong')).toHaveText('Current reading unavailable');await overview.click();await expect(card.locator('.feed-status')).toContainText('Awaiting market update');await expect(card).toContainText('Current reading unavailable');await expect(card).toContainText('Last available snapshot');await expect(card.getByRole('meter')).toHaveCount(0);await expect(card.locator('.reading-date')).toContainText('12:25');
 result={...result,data:{...result.data,observedAt:'2026-10-26T14:05:00Z'}};await page.clock.setSystemTime(new Date('2026-10-26T16:00Z'));await page.reload();await expect(card.locator('.feed-status')).toContainText('Delayed snapshot');await expect(card).toContainText('over 90 minutes');
 mark('Pre-open readings and delayed intraday observations cannot look current merely because they were fetched today');
 result={...result,source:SOURCES.sentiment,data:parseSentiment(dailySentiment())};await page.clock.setSystemTime(new Date('2026-10-24T12:00Z'));await page.reload();await expect(card).toContainText('Daily CNN backup');await expect(card.locator('.feed-status')).toContainText('Daily backup');await expect(card.locator('.sentiment-value>strong')).toHaveText('20.98');
 result={...result,source:HOURLY_SENTIMENT_SOURCE,status:'stale',message:'The hourly source is offline.'};await page.reload();await expect(card.locator('.feed-status')).toContainText('Cached snapshot');await expect(card).toContainText('hourly source is offline');await expect(card.getByRole('meter')).toHaveCount(0);await expect(card).toContainText('Last available snapshot');
 result={status:'unavailable',source:HOURLY_SENTIMENT_SOURCE,data:null,message:'No recent CNN snapshot is available.'};await page.reload();await expect(card.getByRole('meter')).toHaveCount(0);await expect(card).toContainText('Reading unavailable');
 mark('Daily backup, cached outages and complete source failure remain explicit without fabricated readings');
 if(existsSync('docs/qa/sentiment-source-latest.json')){
  result=JSON.parse(readFileSync('docs/qa/sentiment-source-latest.json','utf8'));await page.clock.setSystemTime(new Date(result.checkedAt));await page.reload();await expect(card.locator('.sentiment-value>strong')).toHaveText(result.data.score.toFixed(2));await expect(card).toContainText('Current reading unavailable');await card.screenshot({path:'docs/qa/sentiment-hourly-current.png'});
  await page.setViewportSize({width:390,height:844});await card.scrollIntoViewIfNeeded();expect(await card.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await card.screenshot({path:'docs/qa/sentiment-hourly-mobile.png'});
  mark('Verified public-source reading fits the desktop and phone card with visible observation date and source lag');
 }
 // Provider setup uses isolated mocked upstream responses; no real key or
 // subscription is created by browser QA. Backend credential storage/auth has
 // independent tests against a real temporary SQLite store and session gate.
 await page.clock.setSystemTime(new Date(SENTIMENT_NOW));
 const apiReading={score:30.12,rating:'fear',observedAt:'2026-10-26T14:13:00Z',previousClose:20.98,previousWeek:20.8,previousMonth:36.94};
 let configured=false,rejectKey=true;
 await page.route('**/api/settings/sentiment',async route=>{
  const request=route.request(),method=request.method();
  if(method==='POST'){
   expect(request.headers()['x-csrf-token']).toBeTruthy();
   if(rejectKey)return route.fulfill({status:400,json:{message:'Oanor rejected this key.'}});
   expect(request.postDataJSON().apiKey).toBe('isolated-browser-fixture-key');configured=true;
   result={status:'ok',source:OANOR_SOURCE,data:apiReading,checkedAt:new Date(SENTIMENT_NOW).toISOString(),fetchedAt:new Date(SENTIMENT_NOW).toISOString()};
  }else if(method==='DELETE'){
   configured=false;result={status:'ok',source:HOURLY_SENTIMENT_SOURCE,data:parseHourlySentiment(hourlySentiment(),parseSentiment,SENTIMENT_NOW),fetchedAt:new Date(SENTIMENT_NOW).toISOString()};
  }
  return route.fulfill({json:{configured,provider:'Oanor API',...(configured?{reading:apiReading}:{})}});
 });
 await page.reload();await card.getByRole('button',{name:'Manage CNN connection'}).click();
 const connection=page.getByRole('region',{name:'CNN API connection'});
 await connection.getByLabel('API key',{exact:true}).fill('isolated-browser-fixture-key');await connection.getByRole('button',{name:'Connect & check'}).click();
 await expect(connection.getByRole('alert')).toHaveText('Oanor rejected this key.');await expect(connection.getByLabel('API key',{exact:true})).toHaveValue('');
 rejectKey=false;await connection.getByLabel('API key',{exact:true}).fill('isolated-browser-fixture-key');await connection.getByRole('button',{name:'Connect & check'}).click();
 await expect(connection).toContainText('Key verified.');await expect(page.locator('.settings-source-status')).toContainText('30.12');await expect(connection.getByLabel('Replace API key')).toHaveValue('');await expect(page.locator('.settings-source-status')).toContainText('API snapshot');
 expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain('isolated-browser-fixture-key');
 await page.locator('.settings-content').screenshot({path:'docs/qa/sentiment-api-connection-mobile.png'});expect(await page.locator('.settings-content').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await page.setViewportSize({width:1488,height:1100});await page.locator('.settings-content').screenshot({path:'docs/qa/sentiment-api-connection-desktop.png'});
 await connection.getByRole('button',{name:'Disconnect',exact:true}).click();await expect(connection).toContainText('Disconnected.');await page.goto(runtime.url+'/#briefing');await expect(card).toContainText('Hourly CNN snapshot');
 mark('Private API setup handles rejected/successful keys, clears the input, renders the actual response and disconnects without losing fallback data');
 const after=await (await testFetch(runtime.url+'/api/workspace')).json();expect(after.data).toEqual(before.data);expect(after.revision).toBe(before.revision);expect(errors).toEqual([]);
 writeFileSync('docs/qa/sentiment-hourly-checks.json',JSON.stringify({result:'passed',checks,errors},null,2)+'\n');
}finally{await browser?.close();await runtime.close();}
