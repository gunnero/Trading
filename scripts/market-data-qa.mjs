if(!process.env.OPENING_BELL_TEST_URL)throw new Error('Use the isolated QA runner.');
import {chromium,expect} from '@playwright/test';
import {existsSync,writeFileSync} from 'node:fs';
import {mockMarket,fixtureQuote} from '../tests/fixtures/market.mjs';
const launch={headless:true};
const executable='/home/gunner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',libs='/home/gunner/.cache/mediahub/browser-libs/root/usr/lib/x86_64-linux-gnu';
if(existsSync(executable))launch.executablePath=executable;
if(existsSync(libs))launch.env={...process.env,LD_LIBRARY_PATH:libs};
const browser=await chromium.launch(launch),page=await browser.newPage({viewport:{width:1488,height:1058},reducedMotion:'reduce'});
const errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
const mark=s=>{checks.push(s);console.log('PASS '+s);};
try{
 await mockMarket(page);await page.goto(process.env.OPENING_BELL_TEST_URL);
 await expect(page.getByRole('img',{name:/QQQ Yahoo Finance 4h/})).toBeVisible();await expect(page.getByRole('tab',{name:/QQQ/})).toContainText('707.85');
 await expect(page.locator('.market-data-caption')).toContainText('22:00');await expect(page.locator('.macro-strip')).toContainText('10 min delayed');await expect(page.locator('.macro-strip')).toContainText('Daily par yield');
 expect(await page.locator('body').innerText()).not.toMatch(/Sample prices|Sample chart|Sample watchlist|SAMPLE SESSION/);
 await page.getByRole('button',{name:'Source & delays'}).click();await expect(page.getByRole('dialog')).toContainText('pre-market and after-hours chart prices');await expect(page.getByRole('dialog')).toContainText('Options bid/ask and Greeks');await page.keyboard.press('Escape');mark('Actual quote UI, source timestamps, delays and options limitations');
 // Hold one request while changing symbol again. No old chart may appear under the new heading.
 let release;const held=new Promise(r=>release=r);
 await page.route('**/api/market/chart?symbol=SPY&interval=4h',async route=>{await held;await route.fallback();});
 await page.getByRole('tab',{name:/SPY/}).click();await expect(page.getByRole('heading',{name:'Loading Yahoo chart…'})).toBeVisible();await expect(page.getByRole('img',{name:/QQQ Yahoo/})).toHaveCount(0);
 await page.getByRole('tab',{name:/QQQ/}).click();release();await expect(page.getByRole('img',{name:/QQQ Yahoo Finance 4h/})).toBeVisible();await expect(page.getByRole('img',{name:/SPY Yahoo/})).toHaveCount(0);mark('Pending chart responses cannot leak across symbols');
 await page.route('**/api/market/quotes?*',route=>{const keys=new URL(route.request().url()).searchParams.get('symbols').split(',');return route.fulfill({json:{quotes:Object.fromEntries(keys.map(k=>[k,{...fixtureQuote(k),status:'stale',message:'Cached during test outage.'}]))}});});
 await page.reload();await expect(page.getByRole('tab',{name:/QQQ/})).toContainText('Cached / old quote');await expect(page.getByRole('button',{name:'Review QQQ plan'})).toBeDisabled();await expect(page.locator('.market-data-caption')).toContainText('Cached / old reading');await page.screenshot({path:'docs/qa/market-data-stale.png',fullPage:true});mark('Stale prices remain visibly dated and pause scenario comparisons');
 await page.route('**/api/market/**',route=>route.fulfill({json:route.request().url().includes('/quotes?')?{quotes:Object.fromEntries(new URL(route.request().url()).searchParams.get('symbols').split(',').map(k=>[k,{status:'unavailable',quote:null,message:'Test outage'}]))}:{status:'unavailable',quote:null,message:'History source unavailable.'}}));
 await page.reload();await expect(page.getByRole('heading',{name:'Chart unavailable'})).toBeVisible();await expect(page.getByRole('tab',{name:/QQQ/})).toContainText('—');await expect(page.getByRole('tab',{name:/QQQ/})).not.toContainText('707.85');await expect(page.getByRole('img',{name:/Yahoo Finance/})).toHaveCount(0);await expect(page.getByRole('button',{name:'Review QQQ plan'})).toBeDisabled();await page.screenshot({path:'docs/qa/market-data-unavailable.png',fullPage:true});mark('Provider outage leaves unavailable prices and chart, with no synthetic fallback');
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();expect(errors).toEqual([]);mark('Failure states fit mobile with no uncaught exceptions');
 writeFileSync('docs/qa/market-data-checks.json',JSON.stringify({result:'passed',checks,errors},null,2)+'\n');
}catch(e){await page.screenshot({path:'docs/qa/market-data-failure.png',fullPage:true});throw e;}finally{await browser.close();}
