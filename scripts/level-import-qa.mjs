import {testFetch as fetch} from '../tests/fixtures/auth.mjs';
import {chromium,expect} from '@playwright/test';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {testRuntime} from './qa-runtime.mjs';
import {mockMarket,fixtureQuote} from '../tests/fixtures/market.mjs';
import {parseLevels} from '../src/data/market.js';

const launch={headless:true},exe='/home/gunner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',libs='/home/gunner/.cache/mediahub/browser-libs/root/usr/lib/x86_64-linux-gnu';
if(existsSync(exe))launch.executablePath=exe;if(existsSync(libs))launch.env={...process.env,LD_LIBRARY_PATH:libs};
const runtime=await testRuntime(),browser=await chromium.launch(launch),page=await browser.newPage({viewport:{width:1488,height:1100},reducedMotion:'reduce'}),errors=[],checks=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',req=>{if(req.url().includes('/api/market/'))requests.push(new URL(req.url()));});
const mark=text=>{checks.push(text);console.log('PASS '+text);},read=async()=>await(await fetch(runtime.url+'/api/workspace')).json();
const saved=()=>expect(page.locator('.workspace-save-status')).toContainText('Workspace saved');
const nav=async name=>{if(await page.getByRole('button',{name:'Open navigation',exact:true}).isVisible())await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name,exact:true}).click();};
const openImport=async text=>{await page.getByRole('button',{name:'Import levels',exact:true}).first().click();await expect(page.getByLabel('Level sheet')).toHaveValue('');await page.getByLabel('Level sheet').fill(text);};
const submit=()=>page.getByRole('dialog').getByRole('button',{name:'Import levels',exact:true}).click();
const monday='LVLS 2026-10-26\nQQQ|1HR|S 720-719\nKO|Daily|D 65-64';
try{
  await mockMarket(page);
  // A Monday quote must not make carried Friday levels count as newly dated levels.
  await page.route('**/api/market/quotes?*',route=>{const symbols=new URL(route.request().url()).searchParams.get('symbols').split(',');return route.fulfill({json:{quotes:Object.fromEntries(symbols.map(symbol=>{const result=fixtureQuote(symbol);if(result.quote)result.quote.sessionDate='2026-10-26';return [symbol,result];}))}});});
  await page.route('**/api/market/setup?*',route=>{const u=new URL(route.request().url()),symbol=u.searchParams.get('symbol'),result=fixtureQuote(symbol);if(result.quote)result.quote.sessionDate='2026-10-26';return route.fulfill({json:{...result,symbol,timeframe:u.searchParams.get('interval'),from:u.searchParams.get('from'),bars:[]}});});
  await page.route('**/api/briefing/**',route=>route.fulfill({status:503,json:{status:'unavailable',message:'Isolated QA'}}));
  await page.goto(runtime.url+'/#levels');await expect(page.getByRole('heading',{name:'Key levels',exact:true})).toBeVisible();const before=await read();
  await openImport(monday);await expect(page.getByLabel('Level import preview')).toContainText('1 updated · 1 added · 39 carried forward');
  await page.getByText('Instruments kept from earlier lists',{exact:true}).click();await expect(page.getByLabel('Level import preview')).toContainText('NQ · FUT');
  expect((await read()).revision).toBe(before.revision);await page.getByRole('dialog').screenshot({path:'docs/qa/level-import-preview.png'});
  await submit();await saved();let current=await read(),sheet=parseLevels(current.data.levelText,current.data.levelSourceDates);
  expect(Object.keys(sheet.instruments)).toHaveLength(41);expect(sheet.instruments.QQQ.zones).toEqual([{type:'S',low:719,high:720}]);expect(sheet.instruments.NVDA.sourceDate).toBe('2026-10-23');
  for(const field of ['watchText','plans','preferences','chartDrawings','chartSettings'])expect(current.data[field]).toEqual(before.data[field]);
  mark('Daily import previews and saves whole-row replacements, additions and 39 preserved instruments without disturbing other work');
  await runtime.stop();await runtime.start();await page.reload();await nav('Key levels');await page.getByLabel('Search levels').fill('NVDA');await expect(page.locator('.level-focus-name')).toContainText('Carried forward');await expect(page.locator('.level-focus-name time')).toHaveAttribute('datetime','2026-10-23');
  expect((await read()).data.levelSourceDates).toEqual(current.data.levelSourceDates);mark('Carry-forward dates and levels survive server restart and browser reload');
  await nav('Overview');await page.getByRole('tab',{name:/SPY/}).click();await expect(page.locator('.notice')).toContainText('Carried-forward levels dated Oct 23, 2026');await expect(page.getByRole('button',{name:'Review SPY plan'})).toBeDisabled();
  await page.locator('section[aria-label="SPY chart"]').getByRole('button',{name:'Levels',exact:true}).click();await expect(page.getByLabel('Chart levels settings')).toContainText('Carried forward from 2026-10-23');await expect(page.getByRole('img',{name:/SPY Yahoo Finance 4h/})).toBeVisible();
  await expect.poll(()=>requests.some(u=>u.pathname.endsWith('level-history')&&u.searchParams.get('symbol')==='SPY'&&u.searchParams.get('from')==='2026-10-23')).toBe(true);
  await page.getByRole('button',{name:'Open NQ chart',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Levels',exact:true}).click();await expect(page.getByRole('dialog').getByLabel('Chart levels settings')).toContainText('Carried forward from 2026-10-23');await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await nav('Watchlist');await page.getByLabel('Search watchlist').fill('NVDA');await expect(page.locator('[data-watchlist-id="NASDAQ:NVDA"]')).toContainText('Dated levels');await page.getByRole('button',{name:'NVDA',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('Carried forward · 2026-10-23');await page.getByRole('button',{name:'Close dialog',exact:true}).click();await saved();
  mark('Main, futures and company charts show original dates; source-history requests and comparisons use per-instrument provenance');
  await openImport('LVLS 2026-10-27\nTSLA|4h|D 345-343');await expect(page.getByLabel('Level import preview')).toContainText('1 updated · 0 added · 40 carried forward');await submit();await saved();
  current=await read();expect(current.data.levelSourceDates.QQQ).toBe('2026-10-26');expect(current.data.levelSourceDates.NVDA).toBe('2026-10-23');expect(current.data.levelSourceDates.TSLA).toBe('2026-10-27');
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Back up workspace',exact:true}).click();const download=await downloadPromise;expect(JSON.parse(readFileSync(await download.path(),'utf8')).levelSourceDates).toEqual(current.data.levelSourceDates);
  mark('Successive omissions keep different source dates, and workspace backups include provenance');
  await openImport(monday);await submit();await expect(page.getByRole('alert')).toContainText('older than your saved');await page.getByRole('button',{name:'Close dialog',exact:true}).click();expect((await read()).revision).toBe(current.revision);
  await page.setViewportSize({width:390,height:844});await openImport('LVLS 2026-10-28\nQQQ|30min|S 730-729');await page.getByText('Instruments kept from earlier lists',{exact:true}).click();
  expect(await page.getByRole('dialog').evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(false);await page.getByRole('dialog').getByRole('button',{name:'Import levels',exact:true}).scrollIntoViewIfNeeded();await expect(page.getByRole('dialog').getByRole('button',{name:'Import levels',exact:true})).toBeInViewport();await page.getByRole('dialog').screenshot({path:'docs/qa/level-import-mobile.png'});await page.getByRole('button',{name:'Close dialog',exact:true}).click();expect((await read()).revision).toBe(current.revision);
  mark('Older lists are rejected; mobile preview scrolls correctly and cancel leaves saved data unchanged');
  expect(errors).toEqual([]);writeFileSync('docs/qa/level-import-checks.json',JSON.stringify({result:'passed',checks,errors},null,2)+'\n');
}catch(error){await page.screenshot({path:'docs/qa/level-import-failure.png',fullPage:true});throw error;}finally{await browser.close();await runtime.close();}
