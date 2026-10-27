import {chromium,expect} from '@playwright/test';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {testRuntime} from './qa-runtime.mjs';
import {mockMarket,fixtureQuote,premarketPayload,PRE_NOW} from '../tests/fixtures/market.mjs';
import {mockBriefing} from '../tests/fixtures/briefing.mjs';
import {testFetch} from '../tests/fixtures/auth.mjs';
import {importLevelList} from '../src/data/level-history.mjs';
import {parseYahoo,resolveSymbol} from '../server/market-data.mjs';

const runtime=await testRuntime(),launch={headless:true};
const executable='/home/gunner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',libs='/home/gunner/.cache/mediahub/browser-libs/root/usr/lib/x86_64-linux-gnu';
if(existsSync(executable))launch.executablePath=executable;
if(existsSync(libs))launch.env={...process.env,LD_LIBRARY_PATH:libs};
let browser;const errors=[],checks=[];mkdirSync('docs/qa',{recursive:true});
const mark=text=>{checks.push(text);console.log('PASS '+text);};
try{
 const read=async()=>await (await testFetch(runtime.url+'/api/workspace')).json(),original=await read();
 const data=importLevelList(original.data,'LVLS 2026-10-26\nQQQ|30min|S 709-708|D 702-700\nSPY|30min|S 768-765|D 755-750');
 const saved=await testFetch(runtime.url+'/api/workspace',{method:'PUT',headers:{'Content-Type':'application/json','X-Opening-Bell-Client':'web'},body:JSON.stringify({data,revision:original.revision})});expect(saved.ok).toBe(true);const before=await read();
 browser=await chromium.launch(launch);const page=await browser.newPage({viewport:{width:1488,height:1100},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
 await page.clock.install({time:new Date(PRE_NOW)});await mockMarket(page);await mockBriefing(page);
 const body=premarketPayload(),asset=resolveSymbol('QQQ'),pre=parseYahoo(body,asset,PRE_NOW,{extended:true}),regular=parseYahoo(body,asset,PRE_NOW);let mode='pre';
 await page.route('**/api/market/quotes?*',route=>{
  const keys=new URL(route.request().url()).searchParams.get('symbols').split(',');
  return route.fulfill({json:{quotes:Object.fromEntries(keys.map(key=>[key,key==='QQQ'?{status:'ok',fetchedAt:new Date(PRE_NOW).toISOString(),quote:mode==='pre'?pre:regular}:fixtureQuote(key)]))}});
 });
 await page.goto(runtime.url);await expect(page.locator('.retest-panel .scenario-status')).toHaveText('Today’s levels ready');
 await expect(page.getByRole('tab',{name:/^QQQ/})).toContainText('708.34');await expect(page.getByRole('tab',{name:/^QQQ/})).toContainText('Testing supply');
 await expect(page.locator('.market-data-caption')).toContainText('Pre-market chart price · level context only');await expect(page.locator('.market-data-caption')).toContainText('13:25');
 await expect(page.locator('.retest-panel')).toContainText('14:30 Skopje');await expect(page.locator('.retest-panel')).toContainText('No new import is needed');
 await expect(page.locator('main > .notice')).toHaveCount(0);await expect(page.getByRole('img',{name:/QQQ Yahoo Finance 4h/})).toBeVisible();await expect(page.locator('.chart-footnote').first()).toContainText('Regular session');
 await page.locator('.workspace-grid').first().screenshot({path:'docs/qa/premarket-desktop.png'});
 mark('Today’s levels use the real-shaped pre-market observation, with bar time and regular-session strategy wait');
 await page.getByRole('button',{name:'Source & delays'}).click();await expect(page.getByRole('dialog')).toContainText('pre-market and after-hours chart prices');await expect(page.getByRole('dialog')).toContainText('regular-session candles only');await page.keyboard.press('Escape');
 await page.setViewportSize({width:390,height:844});await page.locator('.retest-panel').scrollIntoViewIfNeeded();await expect(page.locator('.retest-panel')).toBeInViewport();expect(await page.locator('.retest-panel').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'docs/qa/premarket-mobile.png'});
 mark('Pre-market scope, opening time and waiting explanation fit desktop and mobile');
 mode='missing';await page.setViewportSize({width:1488,height:1100});await page.reload();await expect(page.locator('.retest-panel .scenario-status')).toHaveText('Today’s levels ready');await expect(page.locator('main > .notice')).toContainText("Today's levels are ready");await expect(page.locator('main > .notice')).toContainText('Oct 23, 2026');await expect(page.locator('.market-data-caption')).toContainText('Regular session quote');await expect(page.getByRole('button',{name:'Review QQQ plan',exact:true})).toBeDisabled();
 mark('Absent pre-market bars retain Friday’s dated close, pause comparisons and never ask to re-import today’s levels');
 await page.clock.setSystemTime(new Date('2026-10-26T13:31Z'));await page.reload();await expect(page.locator('.retest-panel')).toContainText("Waiting for today's regular-session candles");await expect(page.locator('.retest-panel')).not.toContainText('starting at');
 await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Key levels',exact:true}).click();await page.getByRole('button',{name:'View setup for QQQ',exact:true}).click();await expect(page.getByRole('dialog').locator('.retest-panel')).toContainText('Today’s levels ready');await expect(page.getByRole('dialog')).toContainText('Waiting for today’s price');await page.keyboard.press('Escape');
 mark('The opening transition and Key levels setup both explain pending regular data without a false dated-level warning');
 const after=await read();expect(after.revision).toBe(before.revision);expect(after.data).toEqual(before.data);expect(errors).toEqual([]);
 mark('Read-only checks leave saved levels, settings and drawings unchanged; no browser errors');
 writeFileSync('docs/qa/premarket-checks.json',JSON.stringify({result:'passed',checks,errors},null,2)+'\n');
}finally{await browser?.close();await runtime.close();}
