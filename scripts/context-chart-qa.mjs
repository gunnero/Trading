import {testFetch as fetch} from '../tests/fixtures/auth.mjs';
if(!process.env.OPENING_BELL_TEST_URL)throw new Error('Use the isolated QA runner.');
import {chromium,expect} from '@playwright/test';
import {existsSync,writeFileSync} from 'node:fs';
import {mockMarket} from '../tests/fixtures/market.mjs';
import {parseLevels,zoneName,zoneText} from '../src/data/market.js';
const launch={headless:true},exe='/home/gunner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',libs='/home/gunner/.cache/mediahub/browser-libs/root/usr/lib/x86_64-linux-gnu';
if(existsSync(exe))launch.executablePath=exe;if(existsSync(libs))launch.env={...process.env,LD_LIBRARY_PATH:libs};
const browser=await chromium.launch(launch),page=await browser.newPage({viewport:{width:1488,height:1058},reducedMotion:'reduce'});
const checks=[],errors=[];let writes=0;
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='PUT')writes++;});
const mark=s=>{checks.push(s);console.log('PASS '+s);};
const base=process.env.OPENING_BELL_TEST_URL,before=await(await fetch(`${base}/api/workspace`)).json();
async function levels(region){const button=region.getByRole('button',{name:'Levels',exact:true});if(await button.getAttribute('aria-expanded')!=='true')await button.click();}
try{
 // Inspect rendered canvas labels as well as the accessible level list.
 await page.addInitScript(()=>{window.chartLabels=[];const fillText=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(value,...args){window.chartLabels.push(String(value));return fillText.call(this,value,...args);};});
 await mockMarket(page);await page.goto(base);await expect(page.getByRole('img',{name:/QQQ Yahoo Finance 4h/})).toBeVisible();
 for(const label of ['NQ','ES','VIX','US 10Y','US 2Y']){
  await page.getByRole('button',{name:`Open ${label} chart`,exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await expect(dialog.getByRole('heading',{name:`${label} chart`,exact:true})).toBeVisible();await expect(dialog.locator('.price-chart[role="img"]')).toBeVisible();
  if(label==='US 2Y'){await expect(dialog).toContainText('Daily data only');await expect(dialog.locator('.price-chart[role="img"]')).toHaveAttribute('aria-label',/published observations/);await expect(dialog.getByRole('button',{name:'4h',exact:true})).toHaveCount(0);}else{await expect(dialog.getByRole('button',{name:'4h',exact:true})).toHaveAttribute('aria-pressed','true');await dialog.getByRole('button',{name:'D',exact:true}).click();await expect(dialog.locator('.price-chart[role="img"]')).toHaveAttribute('aria-label',new RegExp(label+' Yahoo Finance D'));}
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(page.getByRole('tab',{name:/QQQ/})).toHaveAttribute('aria-selected','true');await expect(page.getByRole('button',{name:'4h',exact:true})).toHaveAttribute('aria-pressed','true');
 }
 mark('All five cards open source charts; daily Treasury and default 4h controls match their data');
 const imported=parseLevels(before.data.levelText);
 for(const symbol of ['NQ','ES']){
  await page.getByRole('button',{name:`Open ${symbol} chart`,exact:true}).click();const dialog=page.getByRole('dialog'),instrument=imported.instruments[symbol];
  await levels(dialog);await expect(dialog.locator('.chart-level-panel')).toContainText(instrument.timeframe);await expect(dialog.locator('time')).toHaveAttribute('datetime',imported.date);
  await dialog.getByRole('button',{name:'Fit all levels',exact:true}).click();await expect(dialog.locator('.price-chart[role="img"]')).toHaveAttribute('aria-label',new RegExp(`${instrument.zones.length} of ${instrument.zones.length} imported reference levels in view`));
  await expect.poll(()=>page.evaluate(()=>window.chartLabels.some(text=>text.startsWith('Supply  '))&&window.chartLabels.some(text=>text.startsWith('Demand  ')))).toBe(true);
  await dialog.locator('.context-levels-details summary').click();const list=dialog.getByRole('list',{name:`${symbol} imported levels`});await expect(list.getByRole('listitem')).toHaveCount(instrument.zones.length);
  for(const zone of instrument.zones)await expect(list).toContainText(`${zoneName(zone.type)}${zoneText(zone)}`);
  await dialog.getByRole('button',{name:'2m',exact:true}).click();await levels(dialog);await dialog.getByRole('button',{name:'Fit all levels',exact:true}).click();await expect(dialog.locator('.price-chart[role="img"]')).toHaveAttribute('aria-label',new RegExp(`${symbol} Yahoo Finance 2m.*${instrument.zones.length} of ${instrument.zones.length}`));await expect(dialog.locator('.chart-level-panel')).toContainText(instrument.timeframe);
  await page.keyboard.press('Escape');await page.evaluate(()=>{window.chartLabels=[];});
 }
 mark('Saved NQ/ES reference bands render in supply/demand colors, fit all zones and retain original prices/timeframes');
 let replacement={...before,data:{...before.data,levelText:'LVLS 2026-10-22\nNQ|1h|S 29250-29245|D 29200-29195|G 29235-29235|FUT\nES|4h|S 7700-7690'}};
 await expect(page.locator('.workspace-save-status')).toContainText('Workspace saved');await page.route('**/api/workspace',route=>{if(route.request().method()==='PUT')replacement={...replacement,data:route.request().postDataJSON().data,revision:replacement.revision+1};return route.fulfill({json:replacement});});await page.reload();await page.getByRole('button',{name:'Open NQ chart',exact:true}).click();
 await levels(page.getByRole('dialog'));await expect(page.getByRole('dialog').locator('.chart-level-panel')).toContainText('1 h');await expect(page.getByRole('dialog').locator('time')).toHaveAttribute('datetime','2026-10-22');await expect(page.getByRole('dialog').locator('.context-levels-date-note')).toContainText('Oct 23, 2026');
 await levels(page.getByRole('dialog'));await page.getByRole('dialog').getByRole('button',{name:'Fit all levels',exact:true}).click();await expect(page.getByRole('dialog').locator('.price-chart[role="img"]')).toHaveAttribute('aria-label',/3 of 3 imported reference levels/);await expect.poll(()=>page.evaluate(()=>window.chartLabels.includes('Gap  29,235.00'))).toBe(true);
 await page.getByRole('dialog').getByRole('button',{name:'ES',exact:true}).click();await levels(page.getByRole('dialog'));await expect(page.getByRole('dialog')).toContainText('No supplied levels for this chart.');await expect(page.getByRole('dialog').locator('.price-chart[role="img"]')).not.toHaveAttribute('aria-label',/imported reference levels/);
 await page.getByRole('dialog').getByRole('button',{name:'VIX',exact:true}).click();await expect(page.getByRole('dialog').locator('.price-chart[role="img"]')).toHaveAttribute('aria-label',/VIX Yahoo/);await expect(page.getByRole('dialog').locator('.context-levels-toolbar')).toHaveCount(0);
 await page.keyboard.press('Escape');await expect(page.locator('.workspace-save-status')).toContainText('Workspace saved');await page.unroute('**/api/workspace');await page.reload();mark('Current workspace overrides bundled levels; differing dates are labeled and no levels leak to other instruments');
 const trigger=page.getByRole('button',{name:'Open NQ chart',exact:true});await trigger.focus();await page.keyboard.press('Enter');await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('dialog').getByRole('button',{name:'US 10Y',exact:true}).click();await expect(page.getByRole('dialog').locator('.price-chart[role="img"]')).toHaveAttribute('aria-label',/percent/);await page.keyboard.press('Escape');await expect(trigger).toBeFocused();mark('Keyboard opening, indicator switching, percentage units and focus return');
 let release;const held=new Promise(r=>release=r);await page.route('**/api/market/chart?symbol=ES&interval=*',async route=>{await held;await route.fallback();});
 await trigger.click();await page.getByRole('dialog').getByRole('button',{name:'ES',exact:true}).click();await expect(page.getByRole('dialog').getByText('Loading chart…')).toBeVisible();await expect(page.getByRole('dialog').locator('.price-chart[role="img"]')).toHaveCount(0);await page.getByRole('dialog').getByRole('button',{name:'VIX',exact:true}).click();release();await expect(page.getByRole('dialog').locator('.price-chart[role="img"]')).toHaveAttribute('aria-label',/VIX Yahoo/);await page.keyboard.press('Escape');mark('Loading and canceled requests never show another indicator’s chart');
 await page.route('**/api/market/chart?symbol=NQ&interval=*',route=>route.fulfill({json:{status:'unavailable',message:'History unavailable during test outage.'}}));await trigger.click();await expect(page.getByRole('dialog').getByText('Chart unavailable',{exact:true})).toBeVisible();await expect(page.getByRole('dialog').locator('.price-chart[role="img"]')).toHaveCount(0);await page.keyboard.press('Escape');
 await page.route('**/api/market/chart?symbol=US2Y&interval=D',route=>route.fulfill({json:{status:'stale',message:'Cached source history.',quote:{price:4.69,provider:'U.S. Treasury',kind:'treasury',sessionDate:'2026-10-23',change:.04},points:[{date:'2026-10-22',price:4.65},{date:'2026-10-23',price:4.69}]}}));
 await page.getByRole('button',{name:'Open US 2Y chart',exact:true}).click();await expect(page.getByRole('dialog').locator('.notice[role="status"]')).toContainText('Cached / old history');await expect(page.getByRole('dialog').locator('.price-chart[role="img"]')).toBeVisible();await page.keyboard.press('Escape');mark('Unavailable and cached daily histories remain explicit without synthetic fallback');
 await page.unroute('**/api/market/chart?symbol=NQ&interval=*');
 for(const width of [1024,390,360]){
  await page.setViewportSize({width,height:844});await page.getByRole('button',{name:'Open NQ chart',exact:true}).click();await expect(page.getByRole('dialog').locator('.price-chart[role="img"]')).toBeVisible();await levels(page.getByRole('dialog'));await page.getByRole('dialog').getByRole('button',{name:'Fit all levels',exact:true}).click();await page.getByRole('dialog').locator('.context-levels-details summary').click();
  const fit=await page.getByRole('dialog').evaluate(d=>({outside:d.getBoundingClientRect().right>innerWidth,overflow:d.scrollWidth>d.clientWidth+1}));expect(fit).toEqual({outside:false,overflow:false});await page.screenshot({path:`docs/qa/context-chart-${width}-fixture.png`,fullPage:true});await page.keyboard.press('Escape');
 }
 expect(errors).toEqual([]);expect(writes).toBeGreaterThan(0);await expect(page.locator('.workspace-save-status')).toContainText('Workspace saved');const after=await(await fetch(`${base}/api/workspace`)).json();expect(after.data.levelText).toEqual(before.data.levelText);expect(after.data.plans).toEqual(before.data.plans);expect(after.data.preferences).toEqual(before.data.preferences);mark('Tablet/mobile fit, no browser errors; context chart views save without modifying imported levels, plans or the primary selection');
 writeFileSync('docs/qa/context-chart-checks.json',JSON.stringify({result:'passed',checks,errors,writes},null,2)+'\n');
}catch(e){await page.screenshot({path:'docs/qa/context-chart-failure.png',fullPage:true});throw e;}finally{await browser.close();}
