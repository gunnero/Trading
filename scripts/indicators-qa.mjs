import {testFetch as fetch} from '../tests/fixtures/auth.mjs';
if(!process.env.OPENING_BELL_TEST_URL)throw new Error('Use the isolated QA runner.');
import {chromium,expect} from '@playwright/test';
import {existsSync,writeFileSync} from 'node:fs';
import {mockMarket,indicatorFixture} from '../tests/fixtures/market.mjs';
const launch={headless:true},exe='/home/gunner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',libs='/home/gunner/.cache/mediahub/browser-libs/root/usr/lib/x86_64-linux-gnu';
if(existsSync(exe))launch.executablePath=exe;if(existsSync(libs))launch.env={...process.env,LD_LIBRARY_PATH:libs};
const browser=await chromium.launch(launch),page=await browser.newPage({viewport:{width:1488,height:1058},reducedMotion:'reduce'}),base=process.env.OPENING_BELL_TEST_URL;
const before=await(await fetch(base+'/api/workspace')).json(),errors=[],checks=[];let writes=0,mode='ok';
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='PUT')writes++;});const mark=s=>{checks.push(s);console.log('PASS '+s);};
async function openPanel(region){const button=region.getByRole('button',{name:'Indicators',exact:true});if(await button.getAttribute('aria-expanded')!=='true')await button.click();}
try{
 await page.addInitScript(()=>{window.ribbonFills=[];const fill=CanvasRenderingContext2D.prototype.fill;CanvasRenderingContext2D.prototype.fill=function(...args){if(String(this.fillStyle).startsWith('rgba('))window.ribbonFills.push(this.fillStyle);return fill.apply(this,args);};});
 await mockMarket(page);const fixtures=new Map();
 await page.route('**/api/market/chart?*',route=>{
  const u=new URL(route.request().url()),symbol=u.searchParams.get('symbol'),frame=u.searchParams.get('interval');if(symbol==='US2Y')return route.fallback();
  const key=symbol+':'+frame;if(!fixtures.has(key))fixtures.set(key,indicatorFixture(symbol,frame));const value=structuredClone(fixtures.get(key));
  if(mode==='daily-unavailable'){value.indicators.dailyStatus='unavailable';for(const k of ['pdh','pdl','pdc','sma20','sma50','sma100','sma200'])value.indicators.series[k].fill(null);}
  if(mode==='stale')value.indicators.dailyStatus='stale';
  return route.fulfill({json:value});
 });
 await page.goto(base);const main=page.getByRole('region',{name:'QQQ chart',exact:true}),chart=main.locator('.price-chart');await expect(chart).toHaveAttribute('aria-label',/9 EMA.*21 EMA.*Session VWAP.*200 SMA/);
 await openPanel(main);await expect(main.locator('.chart-indicator-options input:checked')).toHaveCount(9);await expect(main.locator('.chart-indicator-options input:disabled')).toHaveCount(0);
 await expect.poll(()=>page.evaluate(()=>window.ribbonFills.some(c=>c.startsWith('rgba(8, 153, 129'))&&window.ribbonFills.some(c=>c.startsWith('rgba(242, 54, 69')))).toBe(true);
 await main.getByRole('checkbox',{name:/9 \/ 21 EMA ribbon/}).uncheck();await expect(chart).not.toHaveAttribute('aria-label',/9 EMA/);await main.getByRole('checkbox',{name:/9 \/ 21 EMA ribbon/}).check();
 const high=main.getByRole('checkbox',{name:/Previous day high/});await high.focus();await page.keyboard.press('Space');await expect(chart).not.toHaveAttribute('aria-label',/Previous day high/);await page.keyboard.press('Space');await expect(chart).toHaveAttribute('aria-label',/Previous day high/);
 await main.getByRole('checkbox',{name:'Fit indicators',exact:true}).check();await page.screenshot({path:'docs/qa/indicators-settings-fixture.png',fullPage:true});mark('All nine overlay controls default on, both ribbon fills render, and keyboard toggles update the chart');
 await page.getByRole('button',{name:'Open NQ chart',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog.locator('.price-chart')).toHaveAttribute('aria-label',/NQ Yahoo.*200 SMA/);
 for(const frame of ['2m','5m','15m','30m','1h','4h','D','W','M']){
  await dialog.getByRole('button',{name:frame,exact:true}).click();await expect(dialog.locator('.price-chart')).toHaveAttribute('aria-label',new RegExp(`NQ Yahoo Finance ${frame}.*200 SMA`));
  await openPanel(dialog);if(['D','W','M'].includes(frame)){await expect(dialog).toContainText('VWAP: intraday charts only');await expect(dialog.locator('.price-chart')).not.toHaveAttribute('aria-label',/Session VWAP/);}
  else await expect(dialog.locator('.price-chart')).toHaveAttribute('aria-label',/Session VWAP/);
 }
 await dialog.getByRole('button',{name:'VIX',exact:true}).click();await openPanel(dialog);await expect(dialog).toContainText('VWAP: no traded volume');await expect(dialog.locator('.price-chart')).toHaveAttribute('aria-label',/200 SMA/);await expect(dialog.locator('.price-chart')).not.toHaveAttribute('aria-label',/Session VWAP/);
 await dialog.getByRole('button',{name:'US 2Y',exact:true}).click();await expect(dialog.locator('.chart-overlay-controls')).toHaveCount(0);await page.keyboard.press('Escape');mark('All nine candle intervals retain indicators; VWAP is absent on D/W/M and non-volume indices');
 for(const state of ['daily-unavailable','stale']){
  mode=state;await expect(page.locator('.workspace-save-status')).toContainText('Workspace saved');await page.reload();await expect(page.getByRole('region',{name:'QQQ chart',exact:true}).locator('.price-chart')).toHaveAttribute('aria-label',/9 EMA.*Session VWAP/);
  await expect(page.locator('.chart-indicator-status')).toContainText(state==='stale'?'Daily indicators: cached / old':'Daily indicators unavailable');
  if(state==='daily-unavailable')await expect(page.getByRole('region',{name:'QQQ chart',exact:true}).locator('.price-chart')).not.toHaveAttribute('aria-label',/200 SMA/);
 }
 mark('Daily-history outages and stale data are explicit without hiding candles, EMA or valid VWAP');mode='ok';await expect(page.locator('.workspace-save-status')).toContainText('Workspace saved');await page.reload();
 for(const width of [1024,390,360]){
  await page.setViewportSize({width,height:844});await page.getByRole('button',{name:'Open NQ chart',exact:true}).click();await expect(dialog.locator('.price-chart')).toHaveAttribute('aria-label',/200 SMA/);await openPanel(dialog);await dialog.getByRole('checkbox',{name:'Fit indicators',exact:true}).check();
  await dialog.screenshot({path:`docs/qa/indicators-${width}-fixture.png`});await openPanel(dialog);await expect(dialog.locator('.chart-indicator-options input:checked')).toHaveCount(9);
  expect(await dialog.evaluate(d=>({overflow:d.scrollWidth>d.clientWidth+1,outside:d.getBoundingClientRect().right>innerWidth}))).toEqual({overflow:false,outside:false});await page.keyboard.press('Escape');
 }
 expect(errors).toEqual([]);expect(writes).toBeGreaterThan(0);await expect(page.locator('.workspace-save-status')).toContainText('Workspace saved');const after=await(await fetch(base+'/api/workspace')).json();expect(after.data.levelText).toEqual(before.data.levelText);expect(after.data.plans).toEqual(before.data.plans);mark('Responsive indicator controls fit tablet/mobile and persist without modifying levels or plans');
 writeFileSync('docs/qa/indicators-browser-checks.json',JSON.stringify({result:'passed',checks,errors,writes},null,2)+'\n');
}catch(error){await page.screenshot({path:'docs/qa/indicators-failure.png',fullPage:true});throw error;}finally{await browser.close();}
