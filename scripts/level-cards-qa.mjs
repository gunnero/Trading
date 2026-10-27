import {testFetch as fetch} from '../tests/fixtures/auth.mjs';
import {chromium,expect} from '@playwright/test';
import {existsSync,writeFileSync} from 'node:fs';
import {testRuntime} from './qa-runtime.mjs';
import {mockMarket} from '../tests/fixtures/market.mjs';
import {parseLevels} from '../src/data/market.js';

const launch={headless:true},exe='/home/gunner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',libs='/home/gunner/.cache/mediahub/browser-libs/root/usr/lib/x86_64-linux-gnu';
if(existsSync(exe))launch.executablePath=exe;if(existsSync(libs))launch.env={...process.env,LD_LIBRARY_PATH:libs};
const runtime=await testRuntime(),browser=await chromium.launch(launch),page=await browser.newPage({viewport:{width:1488,height:1100},reducedMotion:'reduce'}),errors=[],checks=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',req=>{if(req.url().includes('/api/market/'))requests.push(new URL(req.url()));});
const mark=text=>{checks.push(text);console.log('PASS '+text);},read=async()=>await(await fetch(runtime.url+'/api/workspace')).json();
const saved=()=>expect(page.locator('.workspace-save-status')).toContainText('Workspace saved');
const card=symbol=>page.locator(`[data-level-symbol="${symbol}"]`),dialog=()=>page.getByRole('dialog');
const close=()=>page.getByRole('button',{name:'Close dialog',exact:true}).click();
async function levels(){if(await page.getByRole('button',{name:'Open navigation',exact:true}).isVisible())await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Key levels',exact:true}).click();}
try{
  await mockMarket(page);await page.route('**/api/briefing/**',route=>route.fulfill({status:503,json:{status:'unavailable',message:'Isolated QA'}}));
  await page.goto(runtime.url);await expect(page.locator('.topbar')).toBeVisible();const before=await read();await levels();
  await expect(page.locator('.level-card-date time')).toHaveCount(40);expect(await page.locator('.level-card-date time').evaluateAll(nodes=>nodes.every(n=>n.dateTime==='2026-10-23'))).toBe(true);
  await expect(page.getByRole('button',{name:/^View setup for /})).toHaveCount(33);
  await page.locator('.levels-page').screenshot({path:'docs/qa/clickable-level-cards-desktop.png'});
  await card('NQ').getByRole('button',{name:'Open NQ chart',exact:true}).focus();await page.keyboard.press('Enter');await expect(dialog()).toContainText('NQ chart');await expect(dialog().getByRole('img',{name:/NQ Yahoo Finance 4h/})).toBeVisible();await page.keyboard.press('Escape');await expect(card('NQ').getByRole('button',{name:'Open NQ chart',exact:true})).toBeFocused();
  await card('ES').getByRole('button',{name:'View chart for ES',exact:true}).click();await expect(dialog().getByRole('img',{name:/ES Yahoo Finance 4h/})).toBeVisible();await close();
  await card('BTC').getByRole('button',{name:'Open BTC details',exact:true}).click();await expect(dialog()).toContainText('no confirmed market-data mapping');await expect(dialog()).toContainText('80,120.00–81,070.00');await close();
  mark('Every card displays its source date; NQ/ES open real chart views by keyboard or action, and unmapped futures remain explicit');
  const instruments=Object.values(parseLevels(before.data.levelText).instruments).filter(i=>!i.futures);
  for(const item of instruments){
    await card(item.symbol).getByRole('button',{name:`View setup for ${item.symbol}`,exact:true}).click();
    await expect(dialog().getByRole('heading',{name:`${item.symbol} setup`,exact:true})).toBeVisible();
    await expect(dialog().getByRole('img',{name:new RegExp(`${item.symbol} Yahoo Finance 4h`)})).toBeVisible();
    await expect(dialog().getByLabel('Level setup confirmation interval')).toHaveValue('2m');
    await expect(dialog().locator('.retest-panel')).not.toContainText('Checking candles');
    await close();
  }
  expect((await read()).revision).toBe(before.revision);expect((await read()).data).toEqual(before.data);
  for(const symbol of ['NASDAQ:SKHY','NYSEARCA:XLP','NASDAQ:MRNA','NASDAQ:ZS','NASDAQ:COST','NYSE:UNH','NYSE:LLY','NASDAQ:CSX'])expect(requests.some(u=>u.pathname.endsWith('/setup')&&u.searchParams.get('symbol')===symbol)).toBe(true);
  mark('All 33 stocks, ADRs and funds open independent setup charts using their exact listings without changing watchlist or main preferences');
  await card('MRNA').getByRole('button',{name:'Open MRNA setup',exact:true}).click();await expect(dialog().getByRole('img',{name:/MRNA Yahoo Finance 4h/})).toBeVisible();
  await dialog().getByLabel('Level setup confirmation interval').selectOption('5m');await expect.poll(()=>requests.some(u=>u.pathname.endsWith('/setup')&&u.searchParams.get('symbol')==='NASDAQ:MRNA'&&u.searchParams.get('interval')==='5m')).toBe(true);
  await dialog().getByRole('button',{name:'15m',exact:true}).click();await expect(dialog().getByRole('img',{name:/MRNA Yahoo Finance 15m/})).toBeVisible();await dialog().getByRole('button',{name:'Levels',exact:true}).click();await expect(dialog().getByLabel('Chart levels settings')).toContainText('2026-10-23');
  await dialog().screenshot({path:'docs/qa/level-setup-desktop.png'});await close();await saved();let current=await read();expect(current.data.watchText).toBe(before.data.watchText);expect(current.data.preferences).toEqual(before.data.preferences);expect(current.data.chartSettings.intervals['NASDAQ:MRNA']).toBe('15m');
  await page.reload();await levels();await card('MRNA').getByRole('button',{name:'View setup for MRNA',exact:true}).click();await expect(dialog().getByRole('img',{name:/MRNA Yahoo Finance 15m/})).toBeVisible();await expect(dialog().getByLabel('Level setup confirmation interval')).toHaveValue('2m');
  await expect(dialog().getByRole('button',{name:'Review MRNA plan',exact:true})).toBeEnabled();await dialog().getByRole('button',{name:'Review MRNA plan',exact:true}).click();await expect(dialog()).toContainText('MRNA session plan');
  await dialog().getByLabel('Option structure').selectOption('Long call');await dialog().getByLabel('Planned expiration').fill('2026-10-30');await dialog().getByRole('button',{name:'Save draft plan',exact:true}).click();await saved();current=await read();expect(current.data.plans[0].marketKey).toBe('NASDAQ:MRNA');expect(current.data.plans[0].marketQuote.provider).toBe('Yahoo Finance');expect(current.data.watchText).toBe(before.data.watchText);
  mark('Setup confirmation stays independent of chart settings; chart settings persist and drafts freeze the correct non-watchlist stock');
  await page.setViewportSize({width:390,height:844});await card('NVDA').scrollIntoViewIfNeeded();await card('NVDA').screenshot({path:'docs/qa/level-card-mobile.png'});await card('NVDA').getByRole('button',{name:'View setup for NVDA',exact:true}).click();await expect(dialog().getByRole('img',{name:/NVDA Yahoo Finance 4h/})).toBeVisible();expect(await dialog().evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(false);
  const icons=await dialog().locator('.chart-header-icons').boundingBox(),intervals=await dialog().locator('.compact-chart-header>.segmented').boundingBox();expect(icons.y+icons.height).toBeLessThanOrEqual(intervals.y);
  await dialog().screenshot({path:'docs/qa/level-setup-mobile.png'});await dialog().getByRole('button',{name:'Review NVDA plan',exact:true}).scrollIntoViewIfNeeded();await expect(page.getByRole('button',{name:'Close dialog',exact:true})).toBeInViewport();await close();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);mark('Mobile cards, charts, setup controls and sticky close remain usable without horizontal overflow');
  await page.setViewportSize({width:1488,height:1100});await page.getByRole('button',{name:'Import levels',exact:true}).first().click();await page.getByLabel('Level sheet').fill('LVLS 2026-10-26\nQQQ|30min|S 720-719\nTESTX|4h|S 110-109');await dialog().getByRole('button',{name:'Import levels',exact:true}).click();await saved();
  await expect(card('QQQ').locator('time')).toHaveAttribute('datetime','2026-10-26');await expect(card('MRNA').locator('.level-card-date')).toContainText('Carried forward');await expect(card('MRNA').locator('time')).toHaveAttribute('datetime','2026-10-23');
  await card('TESTX').getByRole('button',{name:'Set up listing for TESTX',exact:true}).click();await expect(dialog()).toContainText('does not specify an exchange');await dialog().getByRole('button',{name:'Add listing & open setup',exact:true}).click();await expect(dialog().getByRole('textbox',{name:'Ticker symbol'})).toHaveValue('TESTX');await expect(dialog().getByRole('combobox',{name:'Exchange',exact:true})).toHaveValue('');await dialog().getByRole('combobox',{name:'Exchange',exact:true}).selectOption('NYSE');await dialog().getByRole('button',{name:'Add & open setup',exact:true}).click();await expect(dialog().getByRole('heading',{name:'TESTX setup',exact:true})).toBeVisible();await close();await saved();expect((await read()).data.watchText).toContain('NYSE:TESTX');
  mark('New imports update only supplied dates; carried dates stay visible and unknown symbols require an explicit exchange selection');
  expect(errors).toEqual([]);writeFileSync('docs/qa/level-cards-checks.json',JSON.stringify({result:'passed',checks,errors},null,2)+'\n');
}catch(error){await page.screenshot({path:'docs/qa/level-cards-failure.png',fullPage:true});throw error;}finally{await browser.close();await runtime.close();}
