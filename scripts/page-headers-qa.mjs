import {chromium,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {testRuntime} from './qa-runtime.mjs';
import {testFetch} from '../tests/fixtures/auth.mjs';
import {mockMarket} from '../tests/fixtures/market.mjs';
import {mockBriefing} from '../tests/fixtures/briefing.mjs';
const runtime=await testRuntime(),dir='docs/qa/page-headers';mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/home/gunner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',env:{...process.env,LD_LIBRARY_PATH:'/home/gunner/.cache/mediahub/browser-libs/root/usr/lib/x86_64-linux-gnu'}});
const pages=[['overview','Overview'],['levels','Key levels'],['briefing','Economic Calendar'],['earnings','Earnings'],['news','News'],['journal/trades','Trade journal'],['journal/plans','Trade journal'],['review','Session review'],['sentiment','Fear & Greed'],['settings/charts','Settings'],['settings/watchlist','Settings'],['settings/connections','Settings'],['settings/account','Settings'],['settings/workspace','Settings']];
const errors=[],checks=[],metrics=[],layoutIssues=[];let writes=0;const mark=s=>{checks.push(s);console.log('PASS '+s);};
const page=await browser.newPage({viewport:{width:1488,height:1050},reducedMotion:'reduce'});
try{
 await mockMarket(page);await mockBriefing(page);await page.clock.setFixedTime(new Date('2026-10-29T20:00:00Z'));page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='PUT'&&r.url().includes('/api/workspace'))writes++;});
 await page.route('**/api/sentiment/details',r=>r.fulfill({json:{status:'unavailable',message:'Details not connected in this isolated layout check',data:null}}));
 const read=async()=>await(await testFetch(runtime.url+'/api/workspace')).json(),before=await read();
 const go=async(route,title)=>{await page.goto(runtime.url+'/#'+route);await expect(page.locator('.page-header h1')).toHaveText(title);await page.evaluate(()=>document.fonts.ready);};
 for(const width of [1488,1024,820,390,320]){
  await page.setViewportSize({width,height:1050});let baseline;
  for(const [route,title] of pages){
   await go(route,title);await expect(page.locator('main h1')).toHaveCount(1);await expect(page.locator('.page-header')).toHaveCount(1);await expect(page.locator('.topbar')).toHaveCount(0);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),`${route} overflow at ${width}`).toBeLessThanOrEqual(1);
   const metric=await page.locator('.page-header').evaluate(h=>{const t=h.querySelector('h1'),d=h.querySelector('.page-header-description'),s=getComputedStyle(t),b=h.getBoundingClientRect(),r=t.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height,titleX:r.x,titleY:r.y,font:s.fontFamily,size:s.fontSize,weight:s.fontWeight,line:s.lineHeight,tracking:s.letterSpacing,color:s.color,background:getComputedStyle(h).backgroundColor,subtitle:getComputedStyle(d).fontSize};});
   baseline??=metric;
   for(const key of ['x','y','width','titleX','titleY','font','size','weight','line','tracking','color','background','subtitle'])if(metric[key]!==baseline[key])layoutIssues.push({route,width,key,actual:metric[key],expected:baseline[key]});
   expect(metric.size).toBe(width<=760?'24px':'28px');
   for(const action of await page.locator('.page-header-actions button,.page-header-actions a').all()){await expect(action).toBeVisible();const b=await action.boundingBox();expect(b.x).toBeGreaterThanOrEqual(0);expect(b.x+b.width).toBeLessThanOrEqual(width+1);}
   if(width===1488){await page.locator('.page-header').screenshot({path:`${dir}/${route.replace('/','-')}-header.png`});if(!route.includes('/')||route==='journal/trades')await page.screenshot({path:`${dir}/${route.replace('/','-')}-desktop.png`});}
   if([820,390].includes(width)&&['levels','briefing','earnings','news','journal/trades','review','settings/charts','sentiment'].includes(route))await page.screenshot({path:`${dir}/${route.replace('/','-')}-${width}.png`});
   metrics.push({route,viewport:width,...metric});
   await expect(page.locator('.market-groups')).toHaveCount(['overview','news'].includes(route)?1:0);
  }
 }
 expect(layoutIssues).toEqual([]);
 mark('All 14 page/subpage states share one heading, typography, color, alignment and gutters at five widths; actions remain visible without horizontal overflow');
 await page.setViewportSize({width:390,height:844});
 for(const [route,title] of pages.filter(([route])=>!route.includes('/'))){await go(route,title);const menu=page.getByRole('button',{name:'Open navigation',exact:true});await menu.click();await expect(page.getByRole('dialog',{name:'Navigation'})).toBeVisible();await expect(page.locator('.main-shell')).toHaveAttribute('inert','');await page.keyboard.press('Escape');await expect(page.locator('.sidebar')).not.toHaveClass(/is-open/);await expect(menu).toBeFocused();}
 await page.getByRole('button',{name:'More navigation'}).click();await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'News',exact:true}).click();await expect(page.locator('.page-header h1')).toHaveText('News');await expect(page.locator('.sidebar')).not.toHaveClass(/is-open/);
 mark('Every phone header opens the navigation drawer; Escape returns focus, and existing More navigation still works');
 await page.setViewportSize({width:1488,height:1050});
 await go('levels','Key levels');await page.locator('.page-header').getByRole('button',{name:'Import levels'}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 await go('earnings','Earnings');await page.locator('.page-header').getByRole('button',{name:'Full calendar'}).click();await expect(page.getByRole('region',{name:'U.S. earnings calendar',exact:true})).toBeVisible();await page.getByRole('button',{name:'Session view',exact:true}).click();await expect(page.locator('.earnings-live-bar')).toBeVisible();
 await go('journal/plans','Trade journal');await expect(page.getByRole('heading',{name:'Saved plans',exact:true})).toBeVisible();await page.locator('.page-header').getByRole('button',{name:'Session review',exact:true}).click();await expect(page.locator('.page-header h1')).toHaveText('Session review');await page.locator('.page-header').getByRole('button',{name:'Open trade journal',exact:true}).click();await expect(page).toHaveURL(/#journal\/trades$/);await page.reload();await expect(page.locator('.page-header h1')).toHaveText('Trade journal');await page.goBack();await expect(page.locator('.page-header h1')).toHaveText('Session review');
 await go('sentiment','Fear & Greed');await page.locator('.page-header').getByRole('button',{name:'Refresh readings'}).click();await expect(page.locator('.sentiment-panel')).toBeVisible();
 await go('news','News');await expect(page.locator('.page-header').getByRole('link',{name:'Yahoo Finance'})).toHaveAttribute('href',/finance.yahoo.com/);await page.getByRole('button',{name:'My watchlist',exact:true}).click();await expect(page.getByLabel('News symbol')).toBeVisible();await page.getByRole('checkbox',{name:'Economy headlines only'}).check();await expect(page.getByRole('checkbox',{name:'Economy headlines only'})).toBeChecked();
 await go('settings/workspace','Settings');await expect(page.getByLabel('Time zone',{exact:true})).toBeVisible();await page.getByRole('navigation',{name:'Settings sections'}).getByRole('link',{name:'Charts',exact:true}).click();await expect(page.getByRole('heading',{name:'Chart defaults',exact:true})).toBeVisible();
 mark('Header actions, journal/review links, import dialog, earnings view switch, sentiment refresh, News filters and Settings navigation remain functional');
 expect(writes).toBe(0);expect((await read()).revision).toBe(before.revision);expect(errors).toEqual([]);mark('Page navigation and header actions make no workspace writes or browser errors');
 writeFileSync(dir+'/checks.json',JSON.stringify({result:'passed',checks,metrics,errors,writes},null,2)+'\n');
}catch(e){await page.screenshot({path:dir+'/failure.png',fullPage:true});writeFileSync(dir+'/checks.json',JSON.stringify({result:'failed',checks,metrics,layoutIssues,errors,error:e.message},null,2)+'\n');throw e;}finally{await browser.close();await runtime.close();}
