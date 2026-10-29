import {testFetch as fetch} from '../tests/fixtures/auth.mjs';
import {chromium,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {testRuntime} from './qa-runtime.mjs';
import {mockMarket} from '../tests/fixtures/market.mjs';
import {mockBriefing} from '../tests/fixtures/briefing.mjs';
import {importLevelList} from '../src/data/level-history.mjs';
const runtime=await testRuntime(),browser=await chromium.launch({headless:true,executablePath:'/home/gunner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',env:{...process.env,LD_LIBRARY_PATH:'/home/gunner/.cache/mediahub/browser-libs/root/usr/lib/x86_64-linux-gnu'}}),page=await browser.newPage({viewport:{width:1488,height:1100}}),errors=[],checks=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/market/'))requests.push(new URL(r.url()));});
const mark=s=>{checks.push(s);console.log('PASS '+s);},read=async()=>await(await fetch(runtime.url+'/api/workspace')).json(),focus=()=>page.locator('.level-focus'),dialog=()=>page.getByRole('dialog');
const saved=()=>expect(page.locator('.workspace-save-status')).toContainText('Workspace saved'),close=()=>dialog().getByRole('button',{name:'Close dialog',exact:true}).click();
async function pick(symbol){await page.getByLabel('Search levels').fill(symbol);await page.getByRole('button',{name:`Select ${symbol} levels`,exact:true}).click();await expect(focus()).toHaveAttribute('data-level-symbol',symbol);}
async function daily(text){await page.getByRole('button',{name:'Import levels',exact:true}).click();await page.getByLabel('Level sheet').fill(text);await dialog().getByRole('button',{name:'Import levels',exact:true}).click();await saved();}
try{
 await mockMarket(page);await mockBriefing(page);await page.goto(runtime.url+'/#levels');await expect(focus().locator('.price-chart')).toBeVisible();const before=await read();
 await expect(page.getByLabel('Level list date').locator('option')).toHaveCount(1);await expect(page.getByLabel('Compare levels with')).toBeDisabled();
 await daily('LVLS 2026-10-26\nQQQ|30min|S 725.42-723.71|D 705-704\nTESTX|4h|S 110-109');await daily('LVLS 2026-10-27\nNQ|1h|S 30100-30000|FUT');
 const current=await read();expect(current.data.levelHistory.map(x=>x.date)).toEqual(['2026-10-26','2026-10-23']);for(const key of ['plans','preferences','watchText','chartDrawings','chartSettings'])expect(current.data[key]).toEqual(before.data[key]);
 await page.getByLabel('Compare levels with').selectOption('2026-10-23');await expect(page.locator('.level-comparison-summary')).toContainText('2 changed · 38 unchanged · 1 added · 0 missing');
 await expect(focus().locator('.level-zone-removed')).toHaveCount(6);await expect(focus()).toContainText('704.00–705.00');await expect(focus().locator('.level-card-date')).toContainText('Carried forward');await expect(focus().locator('.level-card-date time')).toHaveAttribute('datetime','2026-10-26');
 await pick('NQ');await expect(focus()).toContainText('Timeframe or asset type changed');await pick('TESTX');await expect(focus()).toContainText('Added instrument');
 await page.getByLabel('Search levels').fill('');await page.getByRole('button',{name:'Select QQQ levels',exact:true}).click();await page.screenshot({path:'docs/qa/level-history-desktop.png'});
 mark('Imports retain dated snapshots and carried source dates; comparison preserves exact added/removed zones and timeframe changes');
 await page.getByLabel('Level list date').selectOption('2026-10-26');await expect(page.locator('.level-comparison-summary')).toContainText('1 changed · 39 unchanged · 1 added');
 await page.getByLabel('Level list date').selectOption('2026-10-23');await expect(page.getByLabel('Compare levels with')).toHaveValue('');await expect(page.locator('.level-history-notice')).toContainText('Historical levels are read-only');
 await page.getByLabel('Compare levels with').selectOption('2026-10-26');await pick('TESTX');await expect(focus()).toContainText('Missing from selected list');await expect(focus().locator('.level-row')).toHaveCount(1);await expect(focus().locator('.level-focus-open')).toHaveCount(0);await expect(focus().locator('.price-chart')).toHaveCount(0);
 await page.getByLabel('Compare levels with').selectOption('');await pick('QQQ');await expect(focus().locator('.price-chart')).toBeVisible();await expect(focus()).toContainText('Historical reference');
 const automated=()=>requests.filter(u=>u.pathname.endsWith('/setup')||u.pathname.endsWith('/level-history')).length,count=automated();
 await pick('NQ');await expect(focus().getByRole('img',{name:/NQ Yahoo Finance 4h/})).toBeVisible();await focus().getByRole('button',{name:'Open reference for NQ'}).click();await expect(dialog()).toContainText('historical level reference');await close();
 await pick('QQQ');await focus().getByRole('button',{name:'Open reference for QQQ'}).click();await expect(dialog()).toContainText('original supplied roles');await expect(dialog().locator('.retest-panel')).toHaveCount(0);await expect(dialog().getByLabel('Level setup confirmation interval')).toHaveCount(0);await close();
 expect(automated()).toBe(count);expect(await read()).toEqual(current);
 mark('Historical and comparison-only entries remain references; archive charts and dialogs run no setup or auto-flip requests and make no writes');
 await page.getByRole('button',{name:'Back to latest'}).click();await focus().getByRole('button',{name:'Show all 2 levels'}).click();await expect(focus().locator('.level-row')).toHaveCount(2);await focus().getByRole('button',{name:'Open setup for QQQ'}).click();await expect(dialog().locator('.retest-panel')).toBeVisible();await close();
 await runtime.stop();await runtime.start();await page.reload();await expect(page.getByLabel('Level list date').locator('option')).toHaveCount(3);
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Back up workspace',exact:true}).click();const download=await downloadPromise;expect(JSON.parse(readFileSync(await download.path(),'utf8')).levelHistory).toEqual(current.data.levelHistory);
 await page.setViewportSize({width:390,height:844});await page.getByLabel('Level list date').selectOption('2026-10-26');await page.getByLabel('Compare levels with').selectOption('2026-10-23');await pick('QQQ');expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);await page.screenshot({path:'docs/qa/level-history-mobile.png'});
 await focus().getByRole('button',{name:'Open reference for QQQ'}).click();await expect(dialog().getByRole('img',{name:/QQQ Yahoo Finance 4h/})).toBeVisible();expect(await dialog().evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);await close();expect((await read()).revision).toBe(current.revision);
 mark('Latest setup access, history persistence, backups and mobile archive/comparison controls remain available');
 let next=current.data;for(const date of ['2026-10-28','2026-10-29','2026-10-30'])next=importLevelList(next,`LVLS ${date}\nQQQ|4h|D 706-705`);
 const response=await fetch(runtime.url+'/api/workspace',{method:'PUT',headers:{'Content-Type':'application/json','X-Opening-Bell-Client':'web'},body:JSON.stringify({revision:current.revision,data:next})});expect(response.ok).toBe(true);
 await page.reload();await expect(page.getByLabel('Level list date').locator('option')).toHaveCount(5);expect(await page.getByLabel('Level list date').locator('option').allTextContents()).not.toContain('Oct 23, 2026');await pick('NVDA');await expect(focus()).toContainText('Carried forward');await expect(focus().locator('.level-focus-name time')).toHaveAttribute('datetime','2026-10-23');
 mark('Five-list retention never expires an instrument’s older carried-forward levels');
 expect(errors).toEqual([]);writeFileSync('docs/qa/level-history-checks.json',JSON.stringify({result:'passed',checks,errors},null,2)+'\n');
}catch(e){await page.screenshot({path:'docs/qa/level-history-failure.png',fullPage:true});throw e;}finally{await browser.close();await runtime.close();}
