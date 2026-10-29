import {testFetch as fetch} from '../tests/fixtures/auth.mjs';
import {chromium,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {testRuntime} from './qa-runtime.mjs';
import {mockMarket,indicatorFixture} from '../tests/fixtures/market.mjs';
import {mockBriefing} from '../tests/fixtures/briefing.mjs';
import {parseLevels} from '../src/data/market.js';
const runtime=await testRuntime(),browser=await chromium.launch({headless:true,executablePath:'/home/gunner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',env:{...process.env,LD_LIBRARY_PATH:'/home/gunner/.cache/mediahub/browser-libs/root/usr/lib/x86_64-linux-gnu'}}),page=await browser.newPage({viewport:{width:1488,height:1100}});
const errors=[],checks=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/market/'))requests.push(new URL(r.url()));});
const read=async()=>await(await fetch(runtime.url+'/api/workspace')).json(),mark=s=>{checks.push(s);console.log('PASS '+s);};
const focus=()=>page.locator('.level-focus'),dialog=()=>page.getByRole('dialog'),close=()=>dialog().getByRole('button',{name:'Close dialog',exact:true}).click();
async function pick(symbol){await page.getByLabel('Search levels').fill(symbol);await page.getByRole('button',{name:`Select ${symbol} levels`,exact:true}).click();await expect(focus()).toHaveAttribute('data-level-symbol',symbol);}
async function chart(symbol,frame='4h'){await expect(focus().getByRole('img',{name:new RegExp(`${symbol} Yahoo Finance ${frame}`)})).toBeVisible();}
try{
 await mockMarket(page);await mockBriefing(page);
 const cache=new Map();await page.route('**/api/market/chart?*',route=>{const u=new URL(route.request().url()),s=u.searchParams.get('symbol'),f=u.searchParams.get('interval'),k=s+f;if(!cache.has(k))cache.set(k,indicatorFixture(s,f));return route.fulfill({json:cache.get(k)});});
 await page.goto(runtime.url+'/#levels');await chart('QQQ');const before=await read();await expect(page.locator('.topbar')).toHaveCount(0);await expect(page.locator('.market-groups')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Select QQQ levels',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.getByRole('button',{name:'Select SPY levels',exact:true})).toBeVisible();
 await page.getByRole('button',{name:/more instruments/}).click();await expect(page.getByRole('button',{name:/^Select .* levels$/})).toHaveCount(40);await page.getByRole('button',{name:'Show focus list',exact:true}).click();await expect(page.getByRole('button',{name:/^Select .* levels$/})).toHaveCount(6);
 await page.getByLabel('Search levels').fill('NOTSUPPLIED');await expect(page.getByRole('heading',{name:'No matching levels'})).toBeVisible();await page.getByRole('button',{name:'Clear search'}).click();await chart('QQQ');
 await expect.poll(()=>requests.filter(u=>u.pathname.endsWith('/quotes')).length).toBe(0);
 await focus().getByRole('button',{name:'Show all 7 levels'}).click();await expect(focus().locator('.level-row')).toHaveCount(7);await expect(focus().locator('.level-card-date time')).toHaveAttribute('datetime','2026-10-23');await focus().getByRole('button',{name:'Hide all 7 levels'}).click();
 const instruments=Object.values(parseLevels(before.data.levelText).instruments).filter(i=>!i.futures);
 for(const item of instruments){await pick(item.symbol);await chart(item.symbol);await expect(focus().getByRole('button',{name:`Open setup for ${item.symbol}`,exact:true})).toBeVisible();}
 for(const symbol of ['NQ','ES','RTY','CL','GC']){await pick(symbol);await chart(symbol);await expect(focus()).toContainText('Contract basis may differ');await expect(focus()).toContainText('Distances paused');}
 await pick('BTC');await expect(focus()).toContainText('No verified chart mapping');await expect(focus().locator('.price-chart')).toHaveCount(0);
 expect((await read()).revision).toBe(before.revision);expect((await read()).data).toEqual(before.data);
 mark('All 33 stock/fund/ADR listings and five mapped futures load inline charts; unsupported futures stay explicit; browsing/search/reading do not write the workspace or fetch all quotes');
 await pick('MRNA');await chart('MRNA');await focus().getByRole('button',{name:'Open setup for MRNA',exact:true}).click();await expect(dialog().getByRole('heading',{name:'MRNA setup',exact:true})).toBeVisible();await expect(dialog().getByLabel('Level setup confirmation interval')).toHaveValue('2m');await close();
 await focus().getByRole('button',{name:'15m',exact:true}).click();await chart('MRNA','15m');await focus().getByRole('button',{name:'Drawing tools',exact:true}).click();await focus().getByRole('button',{name:'Horizontal level',exact:true}).click();await focus().locator('.drawing-surface').click({position:{x:130,y:140}});await expect(focus().locator('.drawing-shape')).toHaveCount(1);await expect(page.locator('.workspace-save-status')).toContainText('Workspace saved');
 await page.reload();await pick('MRNA');await chart('MRNA','15m');await expect(focus().locator('.drawing-shape')).toHaveCount(1);await focus().getByRole('button',{name:'Reset view',exact:true}).click();await expect(focus().locator('.drawing-shape')).toHaveCount(1);await expect(page.locator('.workspace-save-status')).toContainText('Workspace saved');
 let current=await read();expect(current.data.chartSettings.intervals['NASDAQ:MRNA']).toBe('15m');expect(current.data.watchText).toBe(before.data.watchText);expect(current.data.preferences).toEqual(before.data.preferences);
 mark('Open setup retains the independent strategy review; chart interval and drawings persist on reload, Reset keeps drawings, main focus remains unchanged');
 // Delayed responses must not retain the former instrument's chart.
 await pick('QQQ');await chart('QQQ');let pending;
 await page.route('**/api/market/chart?symbol=SPY&interval=4h',route=>{pending=route;});
 await page.getByLabel('Search levels').fill('SPY');await expect.poll(()=>!!pending).toBe(true);await expect(focus()).toHaveAttribute('data-level-symbol','SPY');await expect(focus().locator('.price-chart')).toHaveCount(0);await expect(focus()).toContainText('Loading chart');await pending.fulfill({json:indicatorFixture('SPY','4h')});await chart('SPY');await page.unroute('**/api/market/chart?symbol=SPY&interval=4h');
 // Cached quotes can be displayed, but may not drive distances or setup claims.
 await page.route('**/api/market/chart?symbol=QQQ&interval=4h',r=>r.fulfill({json:{...indicatorFixture('QQQ','4h'),status:'stale'}}));await pick('QQQ');await chart('QQQ');await expect(focus()).toContainText('Cached / old quote');await expect(focus()).toContainText('Distances paused');await page.unroute('**/api/market/chart?symbol=QQQ&interval=4h');
 mark('Switching symbols hides prior history while loading; stale quotes keep their chart but pause distances');
 await pick('NVDA');await chart('NVDA');
 for(const width of [1717,1488,1024,820,390,320]){
  await page.setViewportSize({width,height:1100});await page.getByLabel('Search levels').fill('');await page.getByRole('button',{name:'Select QQQ levels',exact:true}).click();await chart('QQQ');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  const search=page.getByLabel('Search levels'),label=page.locator('.levels-search'),a=await search.boundingBox(),b=await label.boundingBox();expect(a.y).toBeGreaterThanOrEqual(b.y);expect(a.y+a.height).toBeLessThanOrEqual(b.y+b.height+1);
  await page.evaluate(()=>document.fonts.ready);await page.locator('.levels-page').screenshot({path:`docs/qa/level-focus-final-${width}.png`});
 }
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'More navigation',exact:true}).click();await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Key levels',exact:true}).click();await expect(page).toHaveURL(/#levels$/);
 await pick('NVDA');await chart('NVDA');await focus().getByRole('button',{name:'Open setup for NVDA',exact:true}).click();await expect(dialog().getByRole('img',{name:/NVDA Yahoo Finance 4h/})).toBeVisible();expect(await dialog().evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);await close();
 await page.setViewportSize({width:1488,height:1100});await page.getByRole('button',{name:'Import levels',exact:true}).click();await page.getByLabel('Level sheet').fill('LVLS 2026-10-26\nQQQ|30min|S 720-719\nTESTX|4h|S 110-109');await dialog().getByRole('button',{name:'Import levels',exact:true}).click();await expect(page.locator('.workspace-save-status')).toContainText('Workspace saved');await pick('QQQ');await expect(focus()).toContainText('Levels 2026-10-26; quote session 2026-10-23.');await expect(focus()).toContainText('Distances paused');
 await pick('TESTX');await expect(focus()).toContainText('Listing needed');await expect(focus().locator('.price-chart')).toHaveCount(0);await focus().getByRole('button',{name:'Set up listing for TESTX',exact:true}).click();await dialog().getByRole('button',{name:'Add listing & open setup',exact:true}).click();await expect(dialog().getByRole('textbox',{name:'Ticker symbol'})).toHaveValue('TESTX');await expect(dialog().getByRole('combobox',{name:'Exchange',exact:true})).toHaveValue('');await dialog().getByRole('combobox',{name:'Exchange',exact:true}).selectOption('NYSE');await dialog().getByRole('button',{name:'Add & open setup',exact:true}).click();await expect(dialog().getByRole('heading',{name:'TESTX setup',exact:true})).toBeVisible();await close();await expect(page.locator('.workspace-save-status')).toContainText('Workspace saved');expect((await read()).data.watchText).toContain('NYSE:TESTX');
 mark('Desktop, tablet and phone layouts fit; navigation and setup dialog remain accessible');
 expect(errors).toEqual([]);writeFileSync('docs/qa/level-cards-checks.json',JSON.stringify({result:'passed',checks,errors},null,2)+'\n');
}catch(e){await page.screenshot({path:'docs/qa/level-cards-failure.png',fullPage:true});throw e;}finally{await browser.close();await runtime.close();}
