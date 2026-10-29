import {mockMarket} from '../tests/fixtures/market.mjs';
if(!process.env.OPENING_BELL_TEST_URL)throw new Error('Use npm run test:clock for an isolated workspace.');
import {chromium,expect} from '@playwright/test';
import {existsSync,writeFileSync} from 'node:fs';
const executable='/home/gunner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const libs='/home/gunner/.cache/mediahub/browser-libs/root/usr/lib/x86_64-linux-gnu';
const launch={headless:true};
if(process.env.OPENING_BELL_BROWSER)launch.executablePath=process.env.OPENING_BELL_BROWSER;
else if(existsSync(executable))launch.executablePath=executable;
if(existsSync(libs))launch.env={...process.env,LD_LIBRARY_PATH:[libs,process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')};
const browser=await chromium.launch(launch);
const page=await browser.newPage({viewport:{width:1488,height:1058},reducedMotion:'reduce'});
const errors=[],checks=[];let writes=0;
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
page.on('request',request=>{if(request.method()==='PUT')writes++;});
const sidebar=page.locator('.market-clock-sidebar'),compact=page.locator('.market-clock-compact');
const mark=text=>{checks.push(text);console.log('PASS '+text);};
async function time(value){await page.clock.setSystemTime(new Date(value));await page.evaluate(()=>window.dispatchEvent(new Event('focus')));}
async function snap(name){await page.evaluate(async()=>{await document.fonts.ready;});await page.screenshot({path:`docs/qa/${name}.png`,fullPage:false});}
async function noOverflow(){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);}
try{
 // Let lazy authenticated app loading finish before pausing browser timers.
 await page.clock.setFixedTime(new Date('2026-10-24T21:31:00Z'));
 // Keep unrelated public feeds deterministic; the exchange clock needs no network feed.
 await page.route(/\/api\/(sentiment|calendar|news)(?:\?|$)/,route=>route.fulfill({json:{status:'unavailable',data:null,message:'Isolated clock verification'}}));
 await mockMarket(page);await page.goto(process.env.OPENING_BELL_TEST_URL);await expect(sidebar).toBeVisible();
 await page.clock.install({time:new Date('2026-10-24T21:30:00Z')});await page.clock.pauseAt(new Date('2026-10-24T21:31:00Z'));
 await expect(sidebar.locator('.market-clock-state')).toHaveText('Weekend');
 await expect(sidebar.locator('.market-clock-date')).toHaveText('Sat, 24 Oct 2026');
 await expect(sidebar.locator('.market-clock-time')).toHaveText('23:31:00');
 await expect(sidebar.locator('.market-clock-opening')).toContainText('Mon 26 Oct · 14:30');
 await expect(sidebar.locator('.market-clock-next')).toContainText('Mon 26 Oct · 09:00');
 await snap('market-clock-weekend-fixture');await noOverflow();
 await page.clock.runFor(1000);await expect(sidebar.locator('.market-clock-time')).toHaveText('23:31:01');
 mark('Sidebar shows the current Skopje date, second clock, weekend status and next regular/pre-market opening');
 await sidebar.focus();await page.keyboard.press('Space');
 const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
 await expect(dialog).toContainText('Next trading day');await expect(dialog.locator('.market-hours-sessions')).toContainText('09:00–14:30');
 await expect(dialog.locator('.market-hours-sessions')).toContainText('14:30–21:00');
 await expect(dialog.locator('.market-hours-sessions')).toContainText('21:00–01:00 (+1 day)');
 await expect(dialog.locator('.market-hours-options')).toContainText('14:30–21:15');
 await expect(dialog).toContainText('venue and broker');
 await expect(dialog.getByRole('link',{name:'NYSE calendar & hours'})).toHaveAttribute('href','https://www.nyse.com/trade/hours-calendars');
 await snap('market-hours-weekend-fixture');await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
 mark('Keyboard-accessible session details show local extended hours, next-day rollover and separate options hours');
 await time('2026-10-26T13:29:59Z');await expect(sidebar.locator('.market-clock-state')).toHaveText('Pre-market');await expect(sidebar.locator('.market-clock-next')).toContainText('in 0m 1s');
 await page.clock.runFor(1000);await expect(sidebar.locator('.market-clock-state')).toHaveText('Market open');await expect(sidebar.locator('.market-clock-next')).toContainText('Market closes');
 await expect(sidebar.locator('.market-clock-time')).toHaveText('14:30:00');
 await time('2026-10-26T19:59:59Z');await page.clock.runFor(1000);await expect(sidebar.locator('.market-clock-state')).toHaveText('After-hours');
 await time('2026-10-27T00:00:00Z');await expect(sidebar.locator('.market-clock-state')).toHaveText('Market closed');
 mark('Clock ticks automatically through opening, closing and the end of after-hours');
 await time('2026-11-26T15:00:00Z');await expect(sidebar.locator('.market-clock-state')).toHaveText('Market holiday');await expect(sidebar).toContainText('Thanksgiving');await expect(sidebar.locator('.market-clock-opening')).toContainText('Fri 27 Nov · 15:30');
 await time('2026-11-27T17:59:59Z');await expect(sidebar).toContainText('Early-close session');await expect(sidebar.locator('.market-clock-next')).toContainText('Early close');
 await page.clock.runFor(1000);await expect(sidebar.locator('.market-clock-state')).toHaveText('After-hours');await sidebar.click();
 await expect(dialog.locator('.market-hours-sessions')).toContainText('15:30–19:00');await expect(dialog.locator('.market-hours-sessions')).toContainText('19:00–23:00');await expect(dialog.locator('.market-hours-options')).toContainText('15:30–19:15');
 await snap('market-hours-early-close-fixture');await page.keyboard.press('Escape');
 mark('Holidays and early closes change the actual session state, countdown and timetable');
 await time('2026-10-23T22:30:00Z');await expect(sidebar.locator('.market-clock-state')).toHaveText('After-hours');await expect(sidebar.locator('.market-clock-date')).toHaveText('Sat, 24 Oct 2026');
 await time('2026-10-30T21:00:00Z');await expect(sidebar.locator('.market-clock-opening')).toContainText('Mon 02 Nov · 15:30');
 mark('Local midnight preserves the US session; future opening uses its own DST offset');
 await time('2026-10-24T21:31:00Z');
 for(const width of [1488,1200,1024,800,390,360]){
  await page.setViewportSize({width,height:900});await noOverflow();
  if(width<=950){await expect(compact).toBeVisible();await expect(compact.locator('.market-clock-time')).toBeVisible();await compact.click();}
  else{await expect(compact).toBeHidden();await sidebar.click();}
  await expect(dialog).toBeVisible();await noOverflow();await expect(dialog.locator('.market-hours-sessions')).toBeVisible();
  if(width===390)await snap('market-hours-mobile-fixture');
  await page.keyboard.press('Escape');
  if(width<=760){
   await page.getByRole('button',{name:'Open navigation',exact:true}).click();await expect(sidebar).toBeVisible();
   await page.getByRole('navigation').getByRole('button',{name:'News',exact:true}).click();await expect(page.locator('.sidebar')).not.toHaveClass(/is-open/);
   await expect(compact).toBeVisible();if(width===390)await snap('market-clock-mobile-fixture');
  }
 }
 mark('Status, local time and session details remain visible at desktop, tablet and 360/390px mobile widths');
 await time('2029-01-02T15:00:00Z');await expect(compact.locator('.market-clock-state')).toHaveText('Schedule unknown');await compact.click();await expect(dialog).toContainText('published calendar needs an update');await expect(dialog.locator('.market-hours-sessions')).toHaveCount(0);await page.keyboard.press('Escape');
 mark('Dates outside published coverage show an unknown schedule instead of invented hours');
 expect(errors).toEqual([]);expect(writes).toBe(0);mark('No browser errors or workspace writes');
 writeFileSync('docs/qa/market-clock-checks.json',JSON.stringify({result:'passed',checks,errors,workspaceWrites:writes},null,2)+'\n');
}catch(error){await snap('market-clock-failure');writeFileSync('docs/qa/market-clock-checks.json',JSON.stringify({result:'failed',checks,errors,error:error.message},null,2)+'\n');throw error;}finally{await browser.close();}
