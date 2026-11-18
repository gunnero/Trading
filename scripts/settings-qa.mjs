import {chromium,expect} from '@playwright/test';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {testRuntime} from './qa-runtime.mjs';
import {testFetch} from '../tests/fixtures/auth.mjs';
import {mockMarket} from '../tests/fixtures/market.mjs';
import {mockBriefing} from '../tests/fixtures/briefing.mjs';

const runtime=await testRuntime();
const browser=await chromium.launch({headless:true,executablePath:'/home/gunner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',env:{...process.env,LD_LIBRARY_PATH:'/home/gunner/.cache/mediahub/browser-libs/root/usr/lib/x86_64-linux-gnu'}});
const checks=[],errors=[],dir='docs/qa/settings';mkdirSync(dir,{recursive:true});
const mark=message=>{checks.push(message);console.log('PASS '+message);};
try{
 const page=await browser.newPage({viewport:{width:1488,height:956},reducedMotion:'reduce'});
 page.on('pageerror',e=>errors.push(e.message));await mockMarket(page);await mockBriefing(page);
 const requests=[];page.on('request',r=>requests.push(new URL(r.url()).pathname));
 const read=async()=>await(await testFetch(runtime.url+'/api/workspace')).json(),before=await read();
 await page.goto(runtime.url+'/#settings/charts');await expect(page.getByRole('heading',{name:'Chart defaults',exact:true})).toBeVisible();
 expect(requests.some(path=>path.startsWith('/api/market/'))).toBe(false);expect((await read()).revision).toBe(before.revision);
 const footer=page.locator('.sidebar-account-area'),footerBox=await footer.boundingBox();expect(footerBox.y+footerBox.height).toBeGreaterThan(954);expect(footerBox.y+footerBox.height).toBeLessThanOrEqual(956);
 await expect(footer.getByRole('button',{name:'Log out',exact:true})).toBeInViewport();await expect(page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Chart settings'})).toHaveCount(0);
 await page.screenshot({path:dir+'/charts-desktop.png'});await page.locator('.sidebar').screenshot({path:dir+'/sidebar-after.png'});
 mark('Settings loads directly without market/chart polling or workspace writes; account and visible Log out sit at the sidebar bottom');
 const save=()=>expect(page.locator('.workspace-save-status')).toContainText('Workspace saved');
 const preview=page.getByRole('img',{name:'Illustrative 4h candlestick chart'});
 await expect(preview).toBeVisible();await preview.focus();await page.keyboard.press('ArrowLeft');await expect(page.locator('.cd-reading')).toContainText('Close');
 await page.getByRole('checkbox',{name:'Hover readings'}).uncheck();await expect(page.locator('.cd-reading')).toHaveCount(0);
 const levels=page.getByRole('checkbox',{name:'Show imported levels'});
 await levels.uncheck();await expect(preview.locator('[data-overlay="levels"]')).toHaveCount(0);await levels.check();
 await page.getByRole('button',{name:'Daily SMA 20/50/100/200'}).click();await page.getByRole('checkbox',{name:'50 SMA · 1D',exact:true}).uncheck();
 expect(await page.getByRole('checkbox',{name:'Daily SMA 20/50/100/200'}).evaluate(el=>el.indeterminate)).toBe(true);
 await expect(preview.locator('[data-overlay="sma50"]')).toHaveCount(0);await expect(preview.locator('[data-overlay="sma20"]')).toHaveCount(1);
 await page.getByLabel('Default drawing color').selectOption({label:'Violet'});await expect(preview.locator('[data-overlay="drawing"]')).toHaveAttribute('stroke','#713bdd');
 const drawings=page.getByRole('checkbox',{name:'Show saved drawings'});await drawings.uncheck();await expect(preview.locator('[data-overlay="drawing"]')).toHaveCount(0);await drawings.check();
 for(const frame of ['2m','5m','15m','30m','1h','D','W','M','4h']){
   await page.getByLabel('Default chart timeframe').selectOption(frame);
   const plot=page.getByRole('img',{name:'Illustrative '+frame+' candlestick chart'});await expect(plot).toBeVisible();
   await expect(plot.locator('[data-overlay="vwap"]')).toHaveCount(['D','W','M'].includes(frame)?0:1);
 }
 await page.getByText('Saved chart setups',{exact:true}).click();await expect(page.locator('.cd-saved')).toHaveAttribute('open','');
 expect((await read()).revision).toBe(before.revision);
 mark('All nine preview intervals, overlay switches, drawing color, mixed indicator states and saved setups work without saving edits');
 await page.getByLabel('Default chart timeframe').selectOption('5m');await page.getByRole('checkbox',{name:'9 / 21 EMA ribbon',exact:true}).uncheck();await page.getByRole('button',{name:'Save defaults',exact:true}).click();await save();
 await page.reload();await expect(page.getByLabel('Default chart timeframe')).toHaveValue('5m');await expect(page.getByRole('checkbox',{name:'9 / 21 EMA ribbon',exact:true})).not.toBeChecked();expect(page.url()).toContain('#settings/charts');
 const saved=await read();expect(saved.data.chartSettings.defaults.enabled.sma50).toBe(false);expect(saved.data.chartSettings.defaults.enabled.sma20).toBe(true);expect(saved.data.chartSettings.defaults.drawingColor).toBe('#713bdd');expect(saved.data.levelText).toBe(before.data.levelText);expect(saved.data.plans).toEqual(before.data.plans);expect(saved.data.chartDrawings).toEqual(before.data.chartDrawings);
 await page.getByRole('button',{name:'Apply to all charts',exact:true}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();expect((await read()).revision).toBe(saved.revision);
 await page.getByRole('button',{name:'Restore app defaults',exact:true}).click();await page.getByRole('button',{name:'Confirm reset',exact:true}).click();await save();await expect(page.getByLabel('Default chart timeframe')).toHaveValue('4h');expect((await read()).data.chartDrawings).toEqual(before.data.chartDrawings);
 mark('Chart defaults persist after refresh; apply/reset require confirmation and preserve imported data and drawings');
 const settingsNav=page.getByRole('navigation',{name:'Settings sections'});
 await settingsNav.getByRole('link',{name:'Connections'}).click();
 const statusTable=page.getByRole('table',{name:'Data source status'});
 const setupButton=page.getByRole('button',{name:'Connection settings',exact:true});
 const openKey=page.getByLabel('API key',{exact:true});
 await expect(statusTable.getByRole('rowheader')).toHaveCount(6);
 await expect(statusTable.getByRole('button',{name:'CNN Fear & Greed',exact:true})).toHaveAttribute('aria-expanded','true');
 await expect(openKey).toHaveCount(0);await setupButton.click();await openKey.fill('isolated-unsaved-key-fixture');
 await settingsNav.getByRole('link',{name:'Account & security',exact:true}).click();await settingsNav.getByRole('link',{name:'Connections'}).click();
 await setupButton.click();await expect(openKey).toHaveValue('');await setupButton.click();
 await page.reload();await expect(settingsNav.getByRole('link',{name:'Connections'})).toHaveAttribute('aria-current','page');
 const refresh=page.getByRole('button',{name:'Refresh status',exact:true});await expect(refresh).toBeEnabled();
 const startRequests=requests.length;await refresh.click();await expect(refresh).toBeEnabled();
 const updates=requests.slice(startRequests);expect(updates.filter(path=>path==='/api/market/chart')).toHaveLength(3);for(const kind of ['sentiment','calendar','news'])expect(updates).toContain('/api/'+kind);
 const treasury=page.getByRole('button',{name:'U.S. Treasury daily yield',exact:true});await treasury.click();
 await expect(statusTable).toContainText('4.05%');await expect(statusTable).toContainText('2026-10-23');
 let unavailable=true;await page.route('**/api/market/chart?symbol=US2Y&interval=D',route=>unavailable?route.fulfill({json:{status:'unavailable',message:'Fixture provider pause'}}):route.fallback());
 await refresh.click();await expect(statusTable).toContainText('Fixture provider pause');await expect(statusTable).not.toContainText('4.05%');
 unavailable=false;const retryStart=requests.length;await page.getByRole('button',{name:'Retry U.S. Treasury daily yield',exact:true}).click();
 await expect(statusTable).toContainText('4.05%');expect(requests.slice(retryStart).filter(path=>path==='/api/market/chart')).toHaveLength(1);
 await statusTable.getByRole('button',{name:'CNN Fear & Greed',exact:true}).click();
 await page.screenshot({path:dir+'/connections-desktop.png'});
 await page.goto(runtime.url+'/#sentiment');await expect(openKey).toHaveCount(0);await page.locator('.sentiment-source-details summary').click();await page.getByRole('button',{name:'Manage CNN connection'}).click();await expect(openKey).toBeVisible();expect(page.url()).toContain('#settings/connections/cnn');
 mark('Six source checks, independent retries, Treasury date-only observations, CNN configuration and clearing unsaved credentials work from Settings and Fear & Greed');
 await footer.getByRole('button',{name:'Account & security',exact:true}).click();expect(page.url()).toContain('#settings/account');await expect(page.getByRole('heading',{name:'Account & security',exact:true})).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(0);await page.getByLabel('Current password',{exact:true}).fill('unsaved-fixture');await settingsNav.getByRole('link',{name:'Charts',exact:true}).click();await settingsNav.getByRole('link',{name:'Account & security',exact:true}).click();await expect(page.getByLabel('Current password',{exact:true})).toHaveValue('');await expect(page.locator('.settings-content')).toContainText('owner@example.com');await page.screenshot({path:dir+'/account-desktop.png'});
 await settingsNav.getByRole('link',{name:'Workspace',exact:true}).click();const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Download workspace backup'}).click();const download=await downloadPromise;const backup=JSON.parse(readFileSync(await download.path(),'utf8'));expect(JSON.stringify(backup)).not.toContain('isolated-unsaved-key-fixture');await expect(page.locator('.settings-content')).toContainText('Europe/Skopje');
 mark('Account controls open inline in Settings and clear unsaved credentials on leaving; Workspace exposes time settings and a credential-free backup');
 await expect(page.locator('.sidebar-transfer-net')).toBeVisible();
 const netSwitch=page.getByRole('switch',{name:'Show Trading net'});await netSwitch.uncheck();await save();await expect(page.locator('.sidebar-transfer-net')).toHaveCount(0);await page.reload();await expect(netSwitch).not.toBeChecked();await expect(page.locator('.sidebar-transfer-net')).toHaveCount(0);await netSwitch.check();await save();await page.reload();await expect(netSwitch).toBeChecked();await expect(page.locator('.sidebar-transfer-net')).toBeVisible();
 mark('Trading net visibility saves and survives reload in both hidden and shown states');
 for(const width of [320,390,820,1024,1488]){
  await page.setViewportSize({width,height:900});
  for(const category of ['Watchlist','Charts','Connections','Account & security','Workspace']){
   await settingsNav.getByRole('link',{name:category,exact:true}).click();await expect(page.locator('.settings-content')).toBeVisible();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
   expect(await page.locator('.settings-content').evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
   if(category==='Connections'){
    const visibleDetails=page.locator('.connection-facts dd, .connection-warning p');
    expect(await visibleDetails.evaluateAll(nodes=>nodes.every(el=>el.scrollWidth<=el.clientWidth+1))).toBe(true);
   }
   if(['Charts','Connections'].includes(category)&&[390,820].includes(width))await page.screenshot({path:`${dir}/${category.toLowerCase()}-${width}.png`,fullPage:true});
  }
  if(width===390){await page.getByRole('button',{name:'Open navigation',exact:true}).click();await expect(footer.getByRole('button',{name:'Settings',exact:true})).toBeVisible();await footer.getByRole('button',{name:'Log out',exact:true}).scrollIntoViewIfNeeded();await expect(footer.getByRole('button',{name:'Log out',exact:true})).toBeInViewport();await page.screenshot({path:dir+'/drawer-phone.png'});await footer.getByRole('button',{name:'Settings',exact:true}).click();await expect(page.locator('.sidebar')).not.toHaveClass(/is-open/);}
 }
 mark('All five settings sections and bottom account controls fit phone, tablet and desktop; the mobile drawer closes after navigation');
 await settingsNav.getByRole('link',{name:'Charts',exact:true}).click();
 await page.route('**/api/workspace',route=>route.request().method()==='PUT'?route.fulfill({status:503,json:{message:'Isolated save outage'}}):route.fallback());
 await page.getByLabel('Default chart timeframe').selectOption('2m');await page.getByRole('button',{name:'Save defaults',exact:true}).click();await expect(page.locator('.workspace-save-status')).toHaveClass(/needs-attention/);
 page.once('dialog',dialog=>dialog.dismiss());await footer.getByRole('button',{name:'Log out',exact:true}).click();await expect(page.locator('.settings-page')).toBeVisible();
 await page.route('**/api/auth/logout',route=>route.fulfill({status:503,json:{message:'Isolated sign-out outage'}}));page.once('dialog',dialog=>dialog.accept());await footer.getByRole('button',{name:'Log out',exact:true}).click();await expect(footer.getByRole('alert')).toHaveText('Isolated sign-out outage');await expect(footer.getByRole('button',{name:'Log out',exact:true})).toBeEnabled();
 await page.unroute('**/api/auth/logout');page.once('dialog',dialog=>dialog.accept());await footer.getByRole('button',{name:'Log out',exact:true}).click();await expect(page.getByRole('heading',{name:'Welcome back.'})).toBeVisible();expect(await page.locator('.settings-page').count()).toBe(0);
 mark('Log out respects unsaved-change cancellation, exposes network errors without losing the session, and successfully returns to login');
 expect(errors).toEqual([]);writeFileSync(dir+'/checks.json',JSON.stringify({result:'passed',checks,errors},null,2)+'\n');
}finally{await browser.close();await runtime.close();}
