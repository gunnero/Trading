import {chromium,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {testRuntime} from './qa-runtime.mjs';
import {testFetch} from '../tests/fixtures/auth.mjs';
import {mockMarket} from '../tests/fixtures/market.mjs';
import {mockBriefing} from '../tests/fixtures/briefing.mjs';
import {eventDay} from '../src/data/calendar.mjs';
const runtime=await testRuntime(),dir='docs/qa/economic-calendar';mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/home/gunner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',env:{...process.env,LD_LIBRARY_PATH:'/home/gunner/.cache/mediahub/browser-libs/root/usr/lib/x86_64-linux-gnu'}});
const checks=[],errors=[],requests=[],now='2026-10-29T22:37:00Z';
const mark=message=>{checks.push(message);console.log('PASS '+message);};
const event=(id,title,date,impact,actual=null,forecast=null,previous=null,extra={})=>({id,title,date,impact,actual,forecast,previous,country:'US',...extra});
const events=[
 event('mon','Treasury auction','2026-10-26T15:30:00Z','Low'),
 event('tue','CB Consumer Confidence','2026-10-27T14:00:00Z','High','91.7','81.2'),
 event('wed','Federal Funds Rate','2026-10-28T18:00:00Z','High','4.00%','4.00%'),
 event('weds','FOMC Statement','2026-10-28T18:00:00Z','High'),
 event('wedp','FOMC Press Conference','2026-10-28T18:30:00Z','High'),
 event('gdp','Advance GDP q/q','2026-10-29T12:30:00Z','High','3.4%','3.2%','2.2%'),
 event('pce','Core PCE Price Index m/m','2026-10-29T12:30:00Z','High','0.3%','0.3%','0.3%'),
 event('claims','Unemployment Claims','2026-10-29T12:30:00Z','High','194K','198K','195K'),
 event('price','Advance GDP Price Index q/q','2026-10-29T12:30:00Z','Medium','2.3%','3.2%','6.1%'),
 event('zero','Zero-valued release','2026-10-29T14:00:00Z','Low',0,0,0),
 event('holiday','Holiday fixture',null,'Holiday',null,null,null,{calendarDate:'2026-10-29',timeLabel:'All day'}),
 event('unrated','Unrated fixture',null,'Other',null,null,null,{calendarDate:'2026-10-29',timeLabel:'Tentative'}),
 event('friday','Employment Cost Index q/q','2026-10-30T12:30:00Z','Medium',null,'0.8%','0.9%'),
 event('cancelled','Cancelled release','2026-10-30T13:00:00Z','High',null,null,null,{status:'cancelled'}),
 event('next','ISM Manufacturing PMI','2026-11-02T15:00:00Z','High',null,null,'54.5'),
 event('same','Same-time release','2026-11-02T15:00:00Z','High',null,0,0),
 event('roll','Late auction','2026-11-03T23:30:00Z','Medium',null,null,null,{timeRole:'auction-close',status:'estimated',dataStale:true,sourceName:'Fixture Treasury',sourceUrl:'https://home.treasury.gov/',note:'Source note retained',credits:['Publisher credit retained']}),
 event('weekend','Daylight saving time shift',null,'Holiday',null,null,null,{calendarDate:'2026-11-01',timeLabel:'All day'}),
 event('later','Later release','2026-11-10T14:00:00Z','High')];
let mode='ok';
try {
 const page=await browser.newPage({viewport:{width:1485,height:1231},reducedMotion:'reduce'});await page.clock.install({time:new Date(now)});
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r));
 await mockMarket(page);await mockBriefing(page);
 await page.route(/\/api\/calendar(?:\?|$)/,async route=>{
  const url=new URL(route.request().url()),from=url.searchParams.get('from'),to=url.searchParams.get('to');
  if(mode==='slow')await new Promise(resolve=>setTimeout(resolve,1200));
  const rows=events.filter(e=>eventDay(e)>=from&&eventDay(e)<=to&&(mode!=='partial'||eventDay(e)<='2026-10-31')).map(e=>mode==='partial'&&e.id==='friday'?{...e,impact:'High'}:e);
  return route.fulfill({json:{status:mode==='unavailable'?'unavailable':mode==='stale'?'stale':'ok',source:{name:'Calendar fixture',url:'https://www.forexfactory.com/calendar'},fetchedAt:now,data:mode==='unavailable'?null:{events:mode==='empty'?[]:rows,planning:from>='2026-11-01',...(mode==='partial'?{partialCoverage:true,coverageStart:from,coverageEnd:'2026-10-31'}:{})},message:mode==='partial'?'Partial schedule: available through Oct 31. Future source temporarily unavailable.':mode==='stale'?'Cached schedule · provider reconnecting':mode==='unavailable'?'Source temporarily unavailable':null}});
 });
 const read=async()=>await(await testFetch(runtime.url+'/api/workspace')).json(),before=await read();
 await page.goto(runtime.url+'/#briefing');
 await expect(page.getByRole('heading',{name:'Economic Calendar',exact:true,level:1})).toBeVisible();await expect(page.locator('.eco-next h2')).toHaveText('ISM Manufacturing PMI');
 await page.locator('.eco-next-heading').click();
 await expect(page.locator('.eco-countdown strong')).toHaveText('in 3d 16h');await expect(page.locator('.eco-next-heading time')).toContainText('16:00');
 await expect(page.locator('.eco-table .eco-event-row')).toHaveCount(14);await expect(page.locator('.eco-mini-days button')).toHaveCount(7);await expect(page.locator('.eco-week-grid')).toHaveCount(0);await page.locator('.eco-next-heading').click();
 await expect(page.locator('.eco-date-heading')).toContainText(['Mon, 26 Oct 2026','Tue, 27 Oct 2026','Wed, 28 Oct 2026','Thu, 29 Oct 2026','Fri, 30 Oct 2026']);
 expect(requests.some(r=>new URL(r.url()).pathname.startsWith('/api/market/'))).toBe(false);expect((await read()).revision).toBe(before.revision);
 await expect(page.locator('.topbar')).toHaveCount(0);await expect(page.locator('.market-groups')).toHaveCount(0);
 mark('Old #briefing route opens dedicated Calendar without market polling or passive writes; next high independent of Today and cancelled releases');
 await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:dir+'/desktop.png',fullPage:true});
 let box=await page.locator('.economic-page').boundingBox();await page.setViewportSize({width:Math.round(1485-box.width+1163),height:1231});box=await page.locator('.economic-page').boundingBox();await page.screenshot({path:dir+'/reference-size.png',clip:{x:box.x-24,y:box.y-24,width:1211,height:1231}});
 const table=page.locator('.eco-table'),legend=page.getByLabel('Economic impact legend');
 for(const impact of ['Low','Medium','High','Holiday']){await legend.getByRole('button',{name:`${impact} only`,exact:true}).click();await expect(page.getByLabel('Event impact')).toHaveValue(impact);expect((await table.locator('.eco-impact').allTextContents()).every(x=>x===impact)).toBe(true);await expect(page.locator('.eco-next h2')).toHaveText('ISM Manufacturing PMI');}
 await page.getByLabel('Event impact').selectOption('Other');await expect(table).toContainText('Tentative');
 await page.getByLabel('Event impact').selectOption('Low');await expect(table.locator('.eco-event-row').filter({hasText:'Zero-valued release'}).locator('td.eco-actual')).toHaveText('0');
 await legend.getByRole('button',{name:'High only',exact:true}).focus();await page.keyboard.press('Space');await expect(page.getByLabel('Event impact')).toHaveValue('High');
 await page.getByLabel('Event impact').selectOption('important');await expect(table.locator('.eco-event-row')).toHaveCount(10);await legend.getByRole('button',{name:'All',exact:true}).click();await expect(table.locator('.eco-event-row')).toHaveCount(14);
 mark('Exclusive impact filters, keyboard selection, High + Medium, missing values, zero actual and all-day/tentative timing');
 const period=page.getByLabel('Calendar period');await period.getByRole('button',{name:'Next week',exact:true}).click();await expect(table).toContainText('Late auction');await expect(page.locator('.eco-mini-days button').first()).toHaveAttribute('aria-label','View economic releases for 2026-11-01');
 await expect(table).toContainText('Nov 4 · 00:30');await table.getByText('Release details').click();await expect(table).toContainText('Source note retained');await expect(table).toContainText('Publisher credit retained');await expect(table).toContainText('Estimated schedule');
 await page.getByRole('button',{name:'View economic releases for 2026-11-03'}).click();await expect(page.locator('#eco-table-title')).toHaveText('Tue, 3 Nov 2026');await expect(table.locator('.eco-event-row')).toHaveCount(1);await expect(page.locator('#eco-table-title')).toBeFocused();
 await page.getByRole('button',{name:'Go to next week'}).click();await expect(table).toContainText('Later release');await expect(page.locator('.eco-next h2')).toHaveText('ISM Manufacturing PMI');await page.getByRole('button',{name:'Go to previous week'}).click();await expect(table).toContainText('Late auction');
 await page.getByRole('button',{name:'Choose dates'}).click();await page.getByLabel('Start date',{exact:true}).fill('2026-11-03');await page.getByLabel('End date',{exact:true}).fill('2026-11-01');await page.getByRole('button',{name:'Apply dates'}).click();await expect(page.getByRole('alert')).toContainText('Choose valid');await page.getByLabel('End date',{exact:true}).fill('2026-11-10');await page.getByRole('button',{name:'Apply dates'}).click();await expect(table).toContainText('Later release');await expect(table).not.toContainText('ISM Manufacturing PMI');
 await period.getByRole('button',{name:'Upcoming',exact:true}).click();await expect(table).not.toContainText('Advance GDP');await expect(table).toContainText('ISM Manufacturing PMI');
 mark('Automatic next/following week, weekend events, day drill-down, custom validation, upcoming and midnight rollover retain notes and source dates');
 mode='slow';await period.getByRole('button',{name:'Next month',exact:true}).click();await expect(page.locator('.eco-table .eco-event-row')).toHaveCount(0);await expect(page.locator('.eco-releases')).toContainText('Connecting to source');await expect(table).toContainText('Later release');mode='ok';
 await page.reload();await expect(page.locator('h1')).toHaveText('Economic Calendar');expect(page.url()).toContain('#markets/calendar');
 mode='stale';await page.getByRole('button',{name:'Refresh source'}).click();await expect(page.locator('.calendar-warning')).toContainText('provider reconnecting');await expect(table.locator('.eco-event-row')).toHaveCount(14);
 mode='unavailable';await page.getByRole('button',{name:'Refresh source'}).click();await expect(page.locator('.eco-releases')).toContainText('Source temporarily unavailable');await expect(table).toHaveCount(0);
 mode='empty';await page.getByRole('button',{name:'Refresh source'}).click();await expect(page.locator('.eco-releases')).toContainText('No matching events');
 mode='ok';await page.getByRole('button',{name:'Refresh source'}).click();await expect(table.locator('.eco-event-row')).toHaveCount(14);
 mark('Changing date ranges hides old rows while loading; empty/unavailable/cached states stay explicit; refresh preserves route');
 mode='partial';await page.locator('.eco-next-heading').click();await page.getByRole('button',{name:'Refresh upcoming schedule'}).click();await expect(page.locator('.eco-next h2')).toHaveText('Employment Cost Index q/q');await expect(page.locator('.eco-next-heading')).toContainText('Partial coverage');await expect(page.locator('.eco-next-warning')).toContainText('Future source temporarily unavailable');await page.locator('.eco-next-heading').click();
 await page.goto(runtime.url+'/#overview');await expect(page.locator('.overview-next-impact')).toContainText('Partial coverage');await expect(page.locator('.overview-next-impact')).toContainText('Employment Cost Index');await page.locator('.overview-next-impact').click();await expect(table).toContainText('Employment Cost Index');await expect(table).not.toContainText('ISM Manufacturing PMI');await expect(page.locator('.calendar-warning')).toContainText('Partial schedule');
 mode='ok';await page.locator('.eco-next-heading').click();await page.getByRole('button',{name:'Refresh upcoming schedule'}).click();await expect(page.locator('.eco-next h2')).toHaveText('ISM Manufacturing PMI');await page.locator('.eco-next-heading').click();await period.getByRole('button',{name:'This week',exact:true}).click();await page.getByRole('button',{name:'Refresh source'}).click();await expect(table.locator('.eco-event-row')).toHaveCount(14);
 mark('A future-provider outage keeps available current-week releases and next high impact with explicit partial coverage; recovery restores future events');
 const requestCount=requests.filter(r=>new URL(r.url()).pathname==='/api/calendar').length;await page.clock.fastForward(600001);await expect.poll(()=>requests.filter(r=>new URL(r.url()).pathname==='/api/calendar').length).toBeGreaterThan(requestCount);mark('Selected schedule and independent next-release feed refresh automatically after ten minutes');
 const current=await read();expect(current.revision).toBe(before.revision);
 const changed=await testFetch(runtime.url+'/api/workspace',{method:'PUT',headers:{'Content-Type':'application/json','X-Opening-Bell-Client':'web'},body:JSON.stringify({revision:current.revision,data:{...current.data,displayTime:{timeZone:'America/New_York',hourCycle:'h12'}}})});expect(changed.ok).toBeTruthy();
 await page.reload();await expect(page.locator('.eco-next-heading time')).toContainText('10:00 AM');await expect(page.locator('.page-header-description')).toContainText('New York · 12h');await expect(page.locator('.eco-table')).toContainText('08:30 AM');
 mark('Saved New York / 12-hour setting updates release, countdown and clock displays without changing U.S. date grouping');
 for(const width of [1485,1024,820,390,320]){
  await page.setViewportSize({width,height:1231});await page.evaluate(()=>window.scrollTo(0,0));
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await expect(page.locator('.eco-next')).toBeVisible();await expect(page.locator('.eco-releases')).toBeVisible();
  await page.screenshot({path:dir+`/width-${width}.png`,fullPage:true});
 }
 await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Markets',exact:true}).click();await expect(page.locator('h1')).toHaveText('Economic Calendar');
 await page.getByRole('button',{name:'Open navigation'}).click();await expect(page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Markets',exact:true})).toBeVisible();await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Markets',exact:true}).click();
 await page.clock.setSystemTime(new Date('2026-11-02T15:01:00Z'));await page.clock.fastForward(60001);await expect(page.locator('.eco-next h2')).toHaveText('Later release');await expect(page.locator('#eco-table-title')).toHaveText('This week');await expect(page.locator('.eco-date-heading').first()).toContainText('Sun, 1 Nov 2026');mark('Countdown advances to the next release and current week rolls forward as time passes');
 expect(errors).toEqual([]);mark('Desktop/tablet/390/320px layout, drawer and header navigation work without horizontal overflow or runtime errors');
 writeFileSync(dir+'/checks.json',JSON.stringify({result:'passed',checks,errors,ownerDataUsed:false},null,2));
} finally {await browser.close();await runtime.close();}
