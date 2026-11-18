import {openWatchlist} from '../tests/fixtures/navigation.mjs';
import {testFetch as fetch} from '../tests/fixtures/auth.mjs';
if(!process.env.OPENING_BELL_TEST_URL)throw Error('Use the isolated QA runner.');
import {chromium,expect} from '@playwright/test';
import {existsSync,writeFileSync} from 'node:fs';
import {mockMarket,indicatorFixture} from '../tests/fixtures/market.mjs';
import {companyFixture} from '../tests/fixtures/company.mjs';
const launch={headless:true},executable='/home/gunner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',libs='/home/gunner/.cache/mediahub/browser-libs/root/usr/lib/x86_64-linux-gnu';
if(existsSync(executable))launch.executablePath=executable;if(existsSync(libs))launch.env={...process.env,LD_LIBRARY_PATH:libs};
const browser=await chromium.launch(launch),page=await browser.newPage({viewport:{width:1488,height:1058},reducedMotion:'reduce'}),url=process.env.OPENING_BELL_TEST_URL;
const errors=[],checks=[];page.on('pageerror',e=>{errors.push(e.message);console.error('BROWSER ERROR',e.stack);});const mark=s=>{checks.push(s);console.log('PASS '+s);};
const dialog=page.getByRole('dialog'),tab=name=>dialog.getByRole('tab',{name,exact:true}),before=await(await fetch(url+'/api/workspace')).json();
let mode='ok',newsMode='ok',release;const held=new Promise(r=>release=r);
try{
 await mockMarket(page);
 await page.route('**/api/market/chart?*',route=>{const u=new URL(route.request().url());return route.fulfill({json:indicatorFixture(u.searchParams.get('symbol'),u.searchParams.get('interval'))});});
 await page.route('**/api/company?*',async route=>{const key=new URL(route.request().url()).searchParams.get('symbol');if(mode==='pending'&&key==='NASDAQ:NVDA')await held;return route.fulfill({json:mode==='unavailable'?{symbol:key,status:'unavailable',message:'Test company source outage.'}:{...companyFixture(key),status:mode==='stale'?'stale':'ok',...(mode==='stale'?{message:'Cached during test outage.'}:{})}});});
 await page.route('**/api/news?symbols=NVDA',route=>{
  const articles=Array.from({length:7},(_,i)=>({id:`news-${i}`,title:`NVIDIA company headline for test ${i+1}`,publisher:'Example publisher',publishedAt:'2026-10-24T20:00:00Z',url:`https://example.com/story-${i}`}));
  return route.fulfill({json:{status:newsMode,fetchedAt:newsMode==='unavailable'?null:'2026-10-24T23:00:00Z',data:newsMode==='unavailable'?null:{articles}}});
 });
 await page.goto(url);await page.getByRole('button',{name:'NVDA',exact:true}).click();await expect(dialog).toContainText('NVIDIA Corporation');await expect(dialog.getByRole('img',{name:/NVDA Yahoo Finance 4h/})).toBeVisible();
 const chart=dialog.locator('.company-chart .price-chart');
 await expect(dialog.getByRole('region',{name:'Account holding'})).toHaveCount(0);
 await expect(dialog.getByRole('button',{name:/^(Buy|Sell)$/})).toHaveCount(0);
 await expect(dialog.locator('.chart-tool-label').filter({hasText:'Navigation'})).toBeVisible();
 await expect(dialog.getByLabel('Latest overlay readings')).toContainText('EMA 9');
 const sidebar=await page.locator('.sidebar').boundingBox(),desktop=await dialog.boundingBox();
 expect(desktop.x).toBeGreaterThanOrEqual(sidebar.x+sidebar.width);
 expect(desktop.width).toBeGreaterThan(1150);
 for(const width of [320,390,820,1100,1240,1488]){
  await page.setViewportSize({width,height:1058});
  await expect.poll(()=>dialog.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
  expect((await chart.boundingBox()).height).toBeGreaterThanOrEqual(320);
 }
 await expect(dialog).toContainText('Nov 17, 2026');await expect(dialog).toContainText('211.26–212.71');await expect(dialog).toContainText('Break & retest');
 await page.screenshot({path:'docs/qa/company-overview.png',fullPage:true});mark('Watchlist opens the correct company, real-chart component, levels, strategy and earnings');
 await dialog.getByRole('button',{name:'2m',exact:true}).click();await expect(dialog.getByRole('img',{name:/NVDA Yahoo Finance 2m/})).toBeVisible();await dialog.getByRole('button',{name:'Chart navigation',exact:true}).click();await dialog.getByRole('button',{name:'Zoom in',exact:true}).click();
 await tab('Financials').click();await expect(dialog).toContainText('USD 5T');await expect(dialog).toContainText('Balance sheet & cash flow');await expect(dialog).toContainText('16.97%');await expect(dialog).toContainText('USD 0');await expect(dialog).toContainText('Non-GAAP');await dialog.getByRole('button',{name:'Quarterly',exact:true}).click();await expect(dialog).toContainText('2Q2027');
 await dialog.getByRole('button',{name:'Cash flow',exact:true}).click();await expect(dialog.locator('.company-statement-body')).toContainText('No quarterly cash flow history supplied');await expect(dialog.locator('.company-statement-body')).toContainText('USD 0');await dialog.getByRole('button',{name:'Balance sheet',exact:true}).click();await expect(dialog.locator('.company-statement-body')).toContainText('16.97%');await dialog.getByRole('button',{name:'Income statement',exact:true}).click();await dialog.getByRole('button',{name:'Annual',exact:true}).click();const income=dialog.getByRole('region',{name:'Reported income statements'});
 await expect(dialog.locator('.company-financial-summary dd.green').filter({hasText:'44.8%'})).toBeVisible();
 await expect(dialog.locator('.company-financial-summary dd.red')).toHaveText('-3.1%');
 await expect(income.getByRole('row',{name:/^Revenue/})).toContainText('215,000');
 await expect(income.getByRole('row',{name:/Gross profit/}).getByRole('cell')).toHaveText(['—','—','—','—']);
 await expect(income.getByRole('row',{name:/Net income/}).getByRole('cell')).toHaveText(['120,000','0.008','0','-300']);
 await expect(dialog.locator('.company-history')).toContainText('USD millions');
 await expect(dialog.getByRole('heading',{name:'Fund information'})).toHaveCount(0);
 for(const width of [320,390,768,1100,1488]){
  await page.setViewportSize({width,height:1058});
  await expect.poll(()=>dialog.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
  if(width===320){
   const rowLabel=income.getByRole('rowheader',{name:'Revenue',exact:true});
   const left=(await rowLabel.boundingBox()).x;
   await income.evaluate(node=>{node.scrollLeft=node.scrollWidth;});
   expect(await income.evaluate(node=>node.scrollLeft)).toBeGreaterThan(0);
   expect(Math.abs((await rowLabel.boundingBox()).x-left)).toBeLessThan(2);
  }
 }
 expect((await dialog.boundingBox()).x).toBeGreaterThanOrEqual(sidebar.x+sidebar.width);
 await expect(dialog).toContainText('As of Oct 15, 2026');
 await page.screenshot({path:'docs/qa/company-financials.png',fullPage:true});mark('Financials preserve zero values, percent scales, report periods, fiscal history and earnings basis');
 await expect(page.locator('.workspace-save-status')).toContainText('Workspace saved');const beforeEarnings=await(await fetch(url+'/api/workspace')).json();
 await tab('Financials').focus();await page.keyboard.press('ArrowRight');await expect(tab('Earnings')).toBeFocused();await expect(tab('Earnings')).toHaveAttribute('aria-selected','true');
 await expect(dialog.getByRole('heading',{name:'Earnings history',exact:true})).toBeVisible();await expect(dialog).toContainText('7 available quarters');await expect(dialog).toContainText('not the company’s full lifetime history');
 const earningsTable=dialog.getByRole('region',{name:'Previous earnings reports',exact:true});await expect(earningsTable.locator('tbody tr')).toHaveCount(7);expect((await dialog.boundingBox()).x).toBeGreaterThanOrEqual(sidebar.x+sidebar.width);
 await expect(earningsTable.getByRole('columnheader',{name:'Status',exact:true})).toBeVisible();
 await expect(earningsTable.getByRole('rowheader',{name:'Q2 2027',exact:true})).toBeVisible();
 await expect(earningsTable).toContainText('Pending');await expect(earningsTable).toContainText('+50.00%');
 await expect(dialog.getByRole('img',{name:/Actual versus estimated EPS/})).toBeVisible();await dialog.evaluate(el=>el.scrollTop=0);await page.screenshot({path:'docs/qa/company-earnings-desktop.png'});
 await dialog.getByLabel('EPS basis',{exact:true}).selectOption('gaap');await expect(dialog.locator('.company-earnings-summary')).toContainText('1.55');await expect(dialog.locator('.company-earnings-summary')).toContainText('Miss');await expect(earningsTable).toContainText('60B USD');
 await dialog.getByLabel('Fiscal year',{exact:true}).selectOption('2025');await expect(earningsTable.locator('tbody tr')).toHaveCount(4);await expect(dialog.locator('.company-chart-empty')).toContainText('No reported revenue');await expect(earningsTable).not.toContainText('Q2 2027');await dialog.getByLabel('Fiscal year',{exact:true}).selectOption('all');await expect(dialog.getByRole('img',{name:/Reported revenue by fiscal/})).toBeVisible();
 for(const width of [820,390,320]){await page.setViewportSize({width,height:900});await dialog.evaluate(el=>el.scrollTop=0);await expect.poll(()=>dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await expect(tab('Earnings')).toBeVisible();await page.screenshot({path:`docs/qa/company-earnings-${width}.png`});}
 expect(await(await fetch(url+'/api/workspace')).json()).toEqual(beforeEarnings);await page.setViewportSize({width:1488,height:1058});mark('Earnings tab supports keyboard navigation, all available quarters, separate accounting bases, year filters, chart and mobile tables');
 await tab('News').click();
 const headlines=dialog.getByRole('region',{name:'NVDA news'}),stories=headlines.locator('.company-news-article');
 await expect(headlines.getByRole('heading',{name:'NVDA headlines'})).toBeVisible();
 await expect(stories).toHaveCount(5);
 await expect(stories.first()).toContainText('Latest headline');
 await expect(stories.first()).toHaveAttribute('href','https://example.com/story-0');
 await headlines.getByRole('button',{name:'Show more'}).click();await expect(stories).toHaveCount(7);
 newsMode='stale';await headlines.getByRole('button',{name:'Refresh headlines'}).click();
 await expect(headlines).toContainText('Showing cached headlines');await expect(stories).toHaveCount(7);
 newsMode='unavailable';await headlines.getByRole('button',{name:'Retry'}).click();
 await expect(stories).toHaveCount(0);await expect(headlines).toContainText('Headlines temporarily unavailable');
 newsMode='ok';await headlines.getByRole('button',{name:'Retry'}).click();
 await expect(stories).toHaveCount(7);await expect(headlines.getByRole('button',{name:'Retry'})).toHaveCount(0);
 await headlines.getByRole('button',{name:'Show less'}).click();await expect(stories).toHaveCount(5);
 await expect(dialog.getByRole('combobox',{name:'News symbol'})).toHaveCount(0);
 mark('Company News preserves ticker scope, publisher links, headline pagination, cached timestamps and retry recovery');
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(page.getByRole('button',{name:'NVDA',exact:true})).toBeFocused();
 await expect(page.locator('.workspace-save-status')).toContainText('Workspace saved');const afterDetail=await(await fetch(url+'/api/workspace')).json();expect(afterDetail.data.preferences).toEqual(before.data.preferences);expect(afterDetail.data.levelText).toEqual(before.data.levelText);expect(afterDetail.data.plans).toEqual(before.data.plans);expect(afterDetail.data.chartSettings.intervals['NASDAQ:NVDA']).toBe('2m');mark('Closing returns keyboard focus; company chart settings persist without changing the selected trading instrument');
 mode='pending';await page.getByRole('button',{name:'NVDA',exact:true}).click();await expect(dialog).toContainText('Loading company snapshot');await page.keyboard.press('Escape');await page.getByRole('textbox',{name:'Search watchlist'}).fill('AMD');await page.getByRole('button',{name:'AMD',exact:true}).click();release();await expect(dialog).toContainText('Advanced Micro Devices');await expect(dialog).not.toContainText('NVIDIA Corporation');await page.keyboard.press('Escape');mark('Late company responses cannot leak into a different ticker');
 mode='unavailable';await page.getByRole('textbox',{name:'Search watchlist'}).fill('COIN');await page.getByRole('button',{name:'COIN',exact:true}).click();await expect(dialog).toContainText('Test company source outage');await expect(dialog.getByRole('img',{name:/COIN Yahoo Finance 4h/})).toBeVisible();await expect(dialog).toContainText('No matching levels');await tab('Financials').click();await expect(dialog.getByRole('heading',{name:'Financials unavailable'})).toBeVisible();await tab('Earnings').click();await expect(dialog.getByRole('heading',{name:'Earnings unavailable'})).toBeVisible();await page.keyboard.press('Escape');
 mode='stale';await page.getByRole('textbox',{name:'Search watchlist'}).fill('TSLA');await page.getByRole('button',{name:'TSLA',exact:true}).click();await expect(dialog).toContainText('Cached snapshot');await expect(dialog).toContainText('Latest listed earnings date');await page.setViewportSize({width:390,height:844});
 await expect.poll(()=>dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:'docs/qa/company-mobile.png',fullPage:true});await tab('Financials').click();await expect.poll(()=>dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:'docs/qa/company-financials-mobile.png',fullPage:true});await page.keyboard.press('Escape');mark('Source outages keep charts usable; cached snapshots and financial tables fit mobile');
 await page.setViewportSize({width:1488,height:1058});mode='ok';await openWatchlist(page);await page.getByRole('textbox',{name:'Search watchlist'}).fill('QQQ');await page.getByRole('button',{name:'QQQ',exact:true}).click();await expect(dialog).toContainText('Invesco QQQ Trust');await expect(dialog.getByRole('region',{name:'Account holding'})).toHaveCount(0);await tab('Financials').click();await expect(dialog).toContainText('Fund information');await expect(dialog).toContainText('0.2%');await expect(dialog.getByRole('group',{name:'Financial statement'})).toHaveCount(0);await expect(dialog.locator('.company-fund-summary')).toContainText('Net assets');await expect(dialog.getByRole('heading',{name:'Valuation',exact:true})).toHaveCount(0);await tab('Earnings').click();await expect(dialog).toContainText('Earnings reports do not apply to this fund');await page.keyboard.press('Escape');
 await page.getByRole('textbox',{name:'Search watchlist'}).fill('TSM');await page.getByRole('button',{name:'TSM',exact:true}).click();await tab('Financials').click();await expect(dialog).toContainText('Financial statements: TWD');await expect(dialog).toContainText('TWD 302B');await expect(dialog.locator('.company-history')).toContainText('TWD millions');
 await tab('Earnings').click();await expect(dialog.getByRole('heading',{name:'Revenue · TWD billions'})).toBeVisible();
 await expect(earningsTable).toContainText('60B TWD');await expect(dialog.locator('.company-earnings-chart').last().locator('.company-eps-legend')).not.toContainText('Estimate');mark('Funds get fund-specific metrics; ADR statements preserve their reporting currency');
 await dialog.getByRole('button',{name:'Use as Custom',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.getByLabel('Custom watchlist stock')).toHaveValue('NYSE:TSM');await expect(page.locator('.workspace-save-status')).toContainText('Workspace saved');expect(errors).toEqual([]);mark('Explicit Custom action opens and saves the chosen listing; no uncaught browser exceptions');
 writeFileSync('docs/qa/company-checks.json',JSON.stringify({result:'passed',checks,errors},null,2)+'\n');
}catch(e){await page.screenshot({path:'docs/qa/company-failure.png',fullPage:true});throw e;}finally{await browser.close();}
