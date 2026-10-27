import {testFetch as fetch} from '../tests/fixtures/auth.mjs';
if(!process.env.OPENING_BELL_TEST_URL)throw new Error('Use the isolated QA runner.');
import {chromium,expect} from '@playwright/test';
import {existsSync,writeFileSync} from 'node:fs';
import {mockMarket} from '../tests/fixtures/market.mjs';
import {readWatchlist} from '../src/data/watchlist.mjs';
const launch={headless:true},exe='/home/gunner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',libs='/home/gunner/.cache/mediahub/browser-libs/root/usr/lib/x86_64-linux-gnu';
if(existsSync(exe))launch.executablePath=exe;if(existsSync(libs))launch.env={...process.env,LD_LIBRARY_PATH:libs};
const browser=await chromium.launch(launch),page=await browser.newPage({viewport:{width:1488,height:1100},reducedMotion:'reduce'}),base=process.env.OPENING_BELL_TEST_URL,errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));const mark=s=>{checks.push(s);console.log('PASS '+s);};
const read=async()=>await(await fetch(base+'/api/workspace')).json(),before=await read();
const save=()=>expect(page.locator('.workspace-save-status')).toContainText('Workspace saved');
const row=id=>page.locator(`[data-watchlist-id="${id}"]`);
async function navigate(){await expect(page.locator('.topbar')).toBeVisible();if(await page.getByRole('button',{name:'Open navigation',exact:true}).isVisible())await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.getByRole('button',{name:'Watchlist',exact:true}).click();}
async function add(symbol,exchange='NASDAQ',group='STOCKS'){
  await page.getByRole('button',{name:'Add symbol',exact:true}).click();const d=page.getByRole('dialog');
  await d.getByRole('textbox',{name:'Ticker symbol'}).fill(symbol);await d.getByRole('combobox',{name:'Asset type'}).selectOption(group);await d.getByRole('combobox',{name:'Exchange',exact:true}).selectOption(exchange);await d.getByRole('button',{name:'Add to watchlist',exact:true}).click();
}
try{
  await mockMarket(page);await page.route('**/api/briefing/**',route=>route.fulfill({status:503,json:{status:'unavailable',message:'Isolated test'}}));await page.goto(base);await navigate();
  await expect(page.locator('.sidebar-footer')).toHaveCount(0);await expect(page.getByRole('button',{name:'Add symbol',exact:true})).toBeVisible();expect((await read()).revision).toBe(before.revision);mark('Watchlist has add/import controls and the sidebar imported-count footer is removed');
  await add('ko','NYSE');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(row('NYSE:KO')).toContainText('100.00');await save();
  await page.reload();await navigate();await expect(row('NYSE:KO')).toBeVisible();expect(readWatchlist((await read()).data.watchText).at(-1)).toMatchObject({id:'NYSE:KO',group:'STOCKS',symbol:'KO'});mark('Adding a symbol loads its quote and persists the exact listing after reload');
  const revision=(await read()).revision;await add('KO','NYSE');await expect(page.getByRole('alert')).toContainText('already in your watchlist');expect((await read()).revision).toBe(revision);
  await page.getByRole('textbox',{name:'Ticker symbol'}).fill('BAD/TICKER');await page.getByRole('button',{name:'Add to watchlist',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Enter a ticker');await page.getByRole('button',{name:'Cancel',exact:true}).click();mark('Duplicate and invalid symbols show errors without writing the workspace');
  await add('BRK.B','NYSE');await save();await add('TLT','NASDAQ','FUND');await save();expect(readWatchlist((await read()).data.watchText).at(-1).group).toBe('FUND');await expect(row('NYSE:BRK.B')).toBeVisible();mark('Class-share tickers and fund asset types preserve their listing and group');
  await page.getByRole('textbox',{name:'Search watchlist'}).fill('NVDA');await row('NASDAQ:NVDA').getByRole('button',{name:'NVDA',exact:true}).click();await page.getByRole('button',{name:'Use as Custom',exact:true}).click();await save();await navigate();
  const preRemove=(await read()).data;await row('NASDAQ:NVDA').getByRole('button',{name:'Remove NASDAQ:NVDA from watchlist'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(row('NASDAQ:NVDA')).toHaveCount(0);await expect(page.getByRole('button',{name:'Undo',exact:true})).toBeFocused();await save();
  let data=(await read()).data;expect(data.preferences.customSymbol).toBe('');expect(data.preferences.focus).toBe(data.preferences.symbol);for(const field of ['levelText','plans','chartDrawings','chartSettings'])expect(data[field]).toEqual(preRemove[field]);
  await page.getByRole('button',{name:'Undo',exact:true}).press('Enter');await expect(row('NASDAQ:NVDA')).toHaveCount(1);await save();expect(readWatchlist((await read()).data.watchText)).toEqual(readWatchlist(preRemove.watchText));mark('Remove does not open company details, clears a removed Custom selection, preserves saved work, and supports keyboard Undo');
  await row('NYSE:KO').getByRole('button',{name:'Remove NYSE:KO from watchlist'}).click();await save();await page.reload();await navigate();await expect(row('NYSE:KO')).toHaveCount(0);mark('Removal persists after refresh');
  await page.locator('.watchlist-panel').screenshot({path:'docs/qa/watchlist-management-desktop.png'});
  await page.setViewportSize({width:390,height:844});await page.getByRole('textbox',{name:'Search watchlist'}).fill('BRK.B');await expect(row('NYSE:BRK.B').getByRole('button',{name:'Remove NYSE:BRK.B from watchlist'})).toBeInViewport();expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.locator('.watchlist-panel').screenshot({path:'docs/qa/watchlist-management-mobile.png'});await page.getByRole('button',{name:'Add symbol',exact:true}).click();await expect(page.getByRole('textbox',{name:'Ticker symbol'})).toBeFocused();expect(await page.getByRole('dialog').evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(false);await page.getByRole('dialog').screenshot({path:'docs/qa/watchlist-add-mobile.png'});await page.getByRole('button',{name:'Cancel',exact:true}).click();mark('Add controls, dialog and sticky remove button fit mobile without page overflow');
  // Seed only the isolated runtime to exercise removing the final symbol.
  await save();const current=await read(),response=await fetch(base+'/api/workspace',{method:'PUT',headers:{'Content-Type':'application/json','X-Opening-Bell-Client':'web',Origin:base},body:JSON.stringify({revision:current.revision,data:{...current.data,watchText:'###STOCKS,NYSE:KO'}})});expect(response.status).toBe(200);
  await page.reload();await navigate();await row('NYSE:KO').getByRole('button',{name:'Remove NYSE:KO from watchlist'}).click();await expect(page.getByRole('heading',{name:'Your watchlist is empty'})).toBeVisible();await save();await page.reload();await navigate();await expect(page.getByRole('heading',{name:'Your watchlist is empty'})).toBeVisible();await add('KO','NYSE');await save();await expect(row('NYSE:KO')).toHaveCount(1);mark('The final symbol can be removed, an empty watchlist reloads safely, and symbols can be added again');
  await page.goto(base+'#overview');await expect(row('NYSE:KO')).toContainText('100.00');mark('Overview follows the remaining watchlist symbols and loads their quotes');
  expect(errors).toEqual([]);writeFileSync('docs/qa/watchlist-management-checks.json',JSON.stringify({result:'passed',checks,errors},null,2)+'\n');
}catch(e){await page.screenshot({path:'docs/qa/watchlist-management-failure.png',fullPage:true});throw e;}finally{await browser.close();}
