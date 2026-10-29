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
 await page.getByLabel('Default chart timeframe').selectOption('5m');await page.getByRole('checkbox',{name:'9 / 21 EMA ribbon',exact:true}).uncheck();await page.getByRole('button',{name:'Save defaults',exact:true}).click();await save();
 await page.reload();await expect(page.getByLabel('Default chart timeframe')).toHaveValue('5m');await expect(page.getByRole('checkbox',{name:'9 / 21 EMA ribbon',exact:true})).not.toBeChecked();expect(page.url()).toContain('#settings/charts');
 const saved=await read();expect(saved.data.levelText).toBe(before.data.levelText);expect(saved.data.plans).toEqual(before.data.plans);expect(saved.data.chartDrawings).toEqual(before.data.chartDrawings);
 await page.getByRole('button',{name:'Apply to all charts',exact:true}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();expect((await read()).revision).toBe(saved.revision);
 await page.getByRole('button',{name:'Restore app defaults',exact:true}).click();await page.getByRole('button',{name:'Confirm reset',exact:true}).click();await save();await expect(page.getByLabel('Default chart timeframe')).toHaveValue('4h');expect((await read()).data.chartDrawings).toEqual(before.data.chartDrawings);
 mark('Chart defaults persist after refresh; apply/reset require confirmation and preserve imported data and drawings');
 const settingsNav=page.getByRole('navigation',{name:'Settings sections'});
 await settingsNav.getByRole('link',{name:'Connections'}).click();await expect(page.getByLabel('API key',{exact:true})).toBeVisible();
 await page.getByLabel('API key',{exact:true}).fill('isolated-unsaved-key-fixture');await settingsNav.getByRole('link',{name:'Account',exact:true}).click();await settingsNav.getByRole('link',{name:'Connections'}).click();await expect(page.getByLabel('API key',{exact:true})).toHaveValue('');
 await page.reload();expect(page.url()).toContain('#settings/connections');await expect(settingsNav.getByRole('link',{name:'Connections'})).toHaveAttribute('aria-current','page');await page.screenshot({path:dir+'/connections-desktop.png'});
 await page.goto(runtime.url+'/#sentiment');await expect(page.getByLabel('API key',{exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Manage CNN connection'}).click();await expect(page.getByLabel('API key',{exact:true})).toBeVisible();expect(page.url()).toContain('#settings/connections');
 mark('CNN management lives in Connections, clears unsaved keys when leaving, retains its route on refresh and is linked from Fear & Greed');
 await footer.getByRole('button',{name:'Account and security'}).click();const account=page.getByRole('dialog',{name:'Account & security'});await expect(account).toBeVisible();await account.getByRole('button',{name:'Close account settings'}).click();await expect(footer.getByRole('button',{name:'Account and security'})).toBeFocused();
 await settingsNav.getByRole('link',{name:'Account',exact:true}).click();await expect(page.locator('.settings-content')).toContainText('owner@example.com');await page.getByRole('button',{name:'Manage account security'}).click();await expect(account).toBeVisible();await account.getByRole('button',{name:'Close account settings'}).click();await page.screenshot({path:dir+'/account-desktop.png'});
 await settingsNav.getByRole('link',{name:'Workspace',exact:true}).click();const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Download workspace backup'}).click();const download=await downloadPromise;const backup=JSON.parse(readFileSync(await download.path(),'utf8'));expect(JSON.stringify(backup)).not.toContain('isolated-unsaved-key-fixture');await expect(page.locator('.settings-content')).toContainText('Europe/Skopje');
 mark('Account controls reuse the protected security dialog with focus return; Workspace exposes time settings and a credential-free backup');
 for(const width of [320,390,820,1024,1488]){
  await page.setViewportSize({width,height:900});
  for(const category of ['Watchlist','Charts','Connections','Account','Workspace']){
   await settingsNav.getByRole('link',{name:category,exact:true}).click();await expect(page.locator('.settings-content')).toBeVisible();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
   expect(await page.locator('.settings-content').evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
   if(['Charts','Connections'].includes(category)&&[390,820].includes(width))await page.screenshot({path:`${dir}/${category.toLowerCase()}-${width}.png`,fullPage:true});
  }
  if(width===390){await page.getByRole('button',{name:'More navigation'}).click();await expect(footer.getByRole('button',{name:'Settings',exact:true})).toBeVisible();await footer.getByRole('button',{name:'Log out',exact:true}).scrollIntoViewIfNeeded();await expect(footer.getByRole('button',{name:'Log out',exact:true})).toBeInViewport();await page.screenshot({path:dir+'/drawer-phone.png'});await footer.getByRole('button',{name:'Settings',exact:true}).click();await expect(page.locator('.sidebar')).not.toHaveClass(/is-open/);}
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
