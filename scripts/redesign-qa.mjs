import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
import {testRuntime} from './qa-runtime.mjs';
import {testFetch} from '../tests/fixtures/auth.mjs';
import {mockMarket,indicatorFixture} from '../tests/fixtures/market.mjs';
import {mockBriefing} from '../tests/fixtures/briefing.mjs';
const dir='docs/qa/redesign-implementation';fs.mkdirSync(dir,{recursive:true});
const runtime=await testRuntime();
const browser=await chromium.launch({headless:true,executablePath:'/home/gunner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',env:{...process.env,LD_LIBRARY_PATH:'/home/gunner/.cache/mediahub/browser-libs/root/usr/lib/x86_64-linux-gnu'}});
const results={routes:[],errors:[],interactions:[]};
const routes=['overview','levels','markets/calendar','markets/earnings','markets/news','portfolio','portfolio/insights','portfolio/insights/monitor','portfolio/insights/allocation','portfolio/insights/performance','portfolio/insights/calendar','portfolio/insights/alerts','portfolio/insights/reports','portfolio/insights/annual','portfolio/activity','journal/trades','journal/broker','journal/plans','journal/review','sentiment','settings/transfers','settings/watchlist','settings/charts','settings/connections','settings/account','settings/workspace'];
try{
 const page=await browser.newPage({viewport:{width:1488,height:1058},reducedMotion:'reduce'});
 await mockMarket(page);await mockBriefing(page);
 await page.route('**/api/market/chart?*',r=>{const u=new URL(r.request().url());return r.fulfill({json:indicatorFixture(u.searchParams.get('symbol'),u.searchParams.get('interval'))});});
 await page.route('**/api/portfolio/notifications',r=>r.fulfill({json:{items:[],unread:0}}));
 await page.route('**/api/transfers/net',r=>r.fulfill({json:{status:'locked'}}));
 page.on('pageerror',e=>results.errors.push(e.message));
 const before=await(await testFetch(runtime.url+'/api/workspace')).json();
 for(const width of [1488,820,390,320]){
  await page.setViewportSize({width,height:width===1488?1058:1000});
  for(const route of routes){
   await page.goto(runtime.url+'/#'+route);await expect(page.locator('main h1')).toHaveCount(1);await page.evaluate(()=>document.fonts.ready);
   if(route==='overview')await expect(page.locator('.price-chart canvas').first()).toBeVisible();
   await page.waitForTimeout(200);
   const measure=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth-innerWidth,canvas:getComputedStyle(document.body).backgroundColor,text:getComputedStyle(document.querySelector('main')).color}));
   results.routes.push({route,width,...measure});
   if(width===1488||width===390)await page.screenshot({path:`${dir}/${route.replaceAll('/','-')}-${width}.png`,fullPage:width===390});
  }
 }
 await page.setViewportSize({width:1488,height:1058});await page.goto(runtime.url+'/#overview');await expect(page.locator('.price-chart').first()).toBeVisible();
 await expect(page.locator('.desk-brand').first()).toContainText('Trading Desk');
 await expect(page.getByRole('combobox',{name:'Market group'}).locator('option')).toHaveText(['Market Indicators','Futures','Funds / ETFs']);
 for(const group of ['futures','funds','indicators']){await page.getByRole('combobox',{name:'Market group'}).selectOption(group);await expect(page.locator('.market-ticker-quote').first()).toBeVisible();}
 results.interactions.push('The compact market strip switches between all three instrument groups');
 await page.getByRole('button',{name:'Indicators',exact:true}).click();await expect(page.getByRole('checkbox',{name:/Session VWAP/})).toBeVisible();await page.screenshot({path:dir+'/overview-indicators-1488.png'});await page.getByRole('button',{name:'Indicators',exact:true}).click();
 await page.getByRole('button',{name:'Open VIX chart',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.screenshot({path:dir+'/context-chart-1488.png'});await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 results.interactions.push('Chart indicator controls and market-context modal open and close');
 await page.setViewportSize({width:820,height:1180});await page.getByRole('button',{name:'Open navigation',exact:true}).click();await expect(page.getByRole('dialog',{name:'Navigation'})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'Navigation'})).toHaveCount(0);
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.screenshot({path:dir+'/navigation-phone.png'});await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Journal',exact:true}).click();await expect(page.locator('.sidebar')).not.toHaveClass(/is-open/);results.interactions.push('Tablet and phone navigation drawer, Escape and selection');
 results.workspaceBefore=before.revision;
 results.overflow=results.routes.filter(r=>r.overflow>1);
 results.pass=!results.errors.length&&!results.overflow.length;
 fs.writeFileSync(dir+'/route-checks.json',JSON.stringify(results,null,2));console.log(JSON.stringify({pass:results.pass,captures:results.routes.length,errors:results.errors,overflow:results.overflow,interactions:results.interactions},null,2));if(!results.pass)process.exitCode=1;
}catch(e){fs.writeFileSync(dir+'/route-failure.json',JSON.stringify({error:e.message,...results},null,2));throw e;}finally{await browser.close();await runtime.close();}
