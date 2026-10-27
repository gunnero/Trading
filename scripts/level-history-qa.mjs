import {testFetch as fetch} from '../tests/fixtures/auth.mjs';
import {chromium,expect} from '@playwright/test';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {testRuntime} from './qa-runtime.mjs';
import {mockMarket} from '../tests/fixtures/market.mjs';
import {importLevelList} from '../src/data/level-history.mjs';

const launch={headless:true},exe='/home/gunner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',libs='/home/gunner/.cache/mediahub/browser-libs/root/usr/lib/x86_64-linux-gnu';
if(existsSync(exe))launch.executablePath=exe;if(existsSync(libs))launch.env={...process.env,LD_LIBRARY_PATH:libs};
const runtime=await testRuntime(),browser=await chromium.launch(launch),page=await browser.newPage({viewport:{width:1488,height:1100},reducedMotion:'reduce'}),errors=[],checks=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',req=>{if(req.url().includes('/api/market/'))requests.push(new URL(req.url()));});
const mark=text=>{checks.push(text);console.log('PASS '+text);},read=async()=>await(await fetch(runtime.url+'/api/workspace')).json();
const saved=()=>expect(page.locator('.workspace-save-status')).toContainText('Workspace saved');
const card=symbol=>page.locator(`[data-level-symbol="${symbol}"]`),dialog=()=>page.getByRole('dialog');
const close=()=>page.getByRole('button',{name:'Close dialog',exact:true}).click();
async function levels(){await expect(page.locator('.topbar')).toBeVisible();if(await page.getByRole('button',{name:'Open navigation',exact:true}).isVisible())await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Key levels',exact:true}).click();}
async function daily(text){await page.getByRole('button',{name:'Import levels',exact:true}).first().click();await page.getByLabel('Level sheet').fill(text);await dialog().getByRole('button',{name:'Import levels',exact:true}).click();await saved();}
try{
  await mockMarket(page);await page.route('**/api/briefing/**',route=>route.fulfill({status:503,json:{status:'unavailable',message:'Isolated QA'}}));
  await page.goto(runtime.url);await expect(page.locator('.topbar')).toBeVisible();const before=await read();await levels();
  await expect(page.getByLabel('Level list date').locator('option')).toHaveCount(1);await expect(page.getByLabel('Compare levels with')).toBeDisabled();
  expect((await read()).revision).toBe(before.revision);
  await daily('LVLS 2026-10-26\nQQQ|30min|S 725.42-723.71|D 705-704\nTESTX|4h|S 110-109');
  await daily('LVLS 2026-10-27\nNQ|1h|S 30100-30000|FUT');
  await expect(page.getByLabel('Level list date').locator('option')).toHaveCount(3);
  const current=await read();expect(current.data.levelHistory.map(x=>x.date)).toEqual(['2026-10-26','2026-10-23']);
  for(const key of ['plans','preferences','watchText','chartDrawings','chartSettings'])expect(current.data[key]).toEqual(before.data[key]);
  await page.getByLabel('Compare levels with').selectOption('2026-10-23');
  await expect(page.locator('.level-comparison-summary')).toContainText('2 changed · 38 unchanged · 1 added · 0 missing');
  await expect(card('QQQ').locator('.level-zone-removed')).toHaveCount(6);await expect(card('QQQ')).toContainText('704.00–705.00');
  await expect(card('QQQ').locator('.level-card-date')).toContainText('Carried forward');await expect(card('QQQ').locator('time')).toHaveAttribute('datetime','2026-10-26');
  await expect(card('NQ')).toContainText('Timeframe or asset type changed');await expect(card('TESTX')).toContainText('Added instrument');
  await page.screenshot({path:'docs/qa/level-history-desktop.png'});
  mark('Daily imports save real dated snapshots; comparison shows exact zone additions/removals, carried dates and timeframe changes');

  await page.getByLabel('Level list date').selectOption('2026-10-26');await expect(page.locator('.level-comparison-summary')).toContainText('1 changed · 39 unchanged · 1 added');
  await page.getByLabel('Level list date').selectOption('2026-10-23');await expect(page.getByLabel('Compare levels with')).toHaveValue('');
  await expect(page.locator('.level-history-notice')).toContainText('Historical levels are read-only');
  await expect(card('QQQ').locator('.level-row')).toHaveCount(7);await expect(card('TESTX')).toHaveCount(0);
  await page.getByLabel('Compare levels with').selectOption('2026-10-26');await expect(card('TESTX')).toContainText('Missing from selected list');await expect(card('TESTX').getByRole('button')).toHaveCount(0);
  await page.getByLabel('Compare levels with').selectOption('');
  const setupRequests=()=>requests.filter(u=>u.pathname.endsWith('/setup')||u.pathname.endsWith('/level-history')).length;
  const requestCount=setupRequests();
  await card('QQQ').getByRole('button',{name:'Open QQQ historical levels',exact:true}).click();await expect(dialog()).toContainText('original supplied roles');
  await expect(dialog().getByRole('img',{name:/QQQ Yahoo Finance 4h/})).toBeVisible();await expect(dialog().locator('.retest-panel')).toHaveCount(0);await expect(dialog().getByLabel('Level setup confirmation interval')).toHaveCount(0);
  expect(setupRequests()).toBe(requestCount);await close();await expect(card('QQQ').getByRole('button',{name:'Open QQQ historical levels',exact:true})).toBeFocused();
  await card('NQ').getByRole('button',{name:'View chart for NQ',exact:true}).click();await expect(dialog()).toContainText('historical level reference');await expect(dialog().getByRole('img',{name:/NQ Yahoo Finance 4h/})).toBeVisible();await close();
  expect(setupRequests()).toBe(requestCount);expect(await read()).toEqual(current);
  mark('Date switching and historical stock/futures charts preserve the active workspace and run no archive setup or auto-flip requests');

  await page.getByRole('button',{name:'Back to latest',exact:true}).click();await expect(card('QQQ').locator('.level-row')).toHaveCount(2);
  await card('QQQ').getByRole('button',{name:'View setup for QQQ',exact:true}).click();await expect(dialog().locator('.retest-panel')).toBeVisible();await close();
  await runtime.stop();await runtime.start();await page.reload();await levels();await expect(page.getByLabel('Level list date').locator('option')).toHaveCount(3);
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Back up workspace',exact:true}).click();const download=await downloadPromise;
  expect(JSON.parse(readFileSync(await download.path(),'utf8')).levelHistory).toEqual(current.data.levelHistory);
  mark('Latest setup access returns normally, and historical lists survive restart and appear in workspace backups');

  await page.setViewportSize({width:390,height:844});await page.getByLabel('Level list date').selectOption('2026-10-26');await page.getByLabel('Compare levels with').selectOption('2026-10-23');await page.getByLabel('Search levels').fill('QQQ');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.locator('.level-history-controls').scrollIntoViewIfNeeded();await page.screenshot({path:'docs/qa/level-history-mobile.png'});
  await card('QQQ').getByRole('button',{name:'View chart for QQQ',exact:true}).click();await expect(dialog().getByRole('img',{name:/QQQ Yahoo Finance 4h/})).toBeVisible();expect(await dialog().evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(false);await close();
  expect((await read()).revision).toBe(current.revision);
  mark('Mobile date selection, comparison and archived charts fit the viewport without changing saved data');

  let next=current.data;
  for(const date of ['2026-10-28','2026-10-29','2026-10-30'])next=importLevelList(next,`LVLS ${date}\nQQQ|4h|D 706-705`);
  const response=await fetch(runtime.url+'/api/workspace',{method:'PUT',headers:{'Content-Type':'application/json','X-Opening-Bell-Client':'web'},body:JSON.stringify({revision:current.revision,data:next})});expect(response.ok).toBe(true);
  await page.reload();await levels();await expect(page.getByLabel('Level list date').locator('option')).toHaveCount(5);
  expect(await page.getByLabel('Level list date').locator('option').allTextContents()).not.toContain('Oct 23, 2026');
  await page.getByLabel('Search levels').fill('NVDA');await expect(card('NVDA').locator('time')).toHaveAttribute('datetime','2026-10-23');await expect(card('NVDA')).toContainText('Carried forward');
  mark('The sixth dated list rolls off the oldest snapshot while keeping older carried-forward levels active');
  expect(errors).toEqual([]);writeFileSync('docs/qa/level-history-checks.json',JSON.stringify({result:'passed',checks,errors},null,2)+'\n');
}catch(error){await page.screenshot({path:'docs/qa/level-history-failure.png',fullPage:true});throw error;}finally{await browser.close();await runtime.close();}
