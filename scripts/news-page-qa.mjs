import {chromium,expect} from '@playwright/test';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {testRuntime} from './qa-runtime.mjs';
import {testFetch} from '../tests/fixtures/auth.mjs';
import {mockMarket} from '../tests/fixtures/market.mjs';
import {mockBriefing} from '../tests/fixtures/briefing.mjs';

const runtime=await testRuntime(),dir='docs/qa/news-correction';mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/home/gunner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',env:{...process.env,LD_LIBRARY_PATH:'/home/gunner/.cache/mediahub/browser-libs/root/usr/lib/x86_64-linux-gnu'}});
const page=await browser.newPage({viewport:{width:1488,height:1050},reducedMotion:'reduce'}),errors=[],checks=[],requests=[];let mode='ok',writes=0;
const mark=s=>{checks.push(s);console.log('PASS '+s);};
const stamp='2026-11-04T18:29:00Z',titles=['Example headline: Markets weigh the latest economic outlook','U.S. stocks extend gains as investors assess economic data',"Treasury yields hold steady ahead of next week’s inflation report",'Tech sector leads as major stocks trade higher','U.S. jobs data in focus as markets look for growth signals','Fed speakers highlight data dependence and a gradual approach'];
const articles=titles.map((title,i)=>({id:String(i),title,url:`https://finance.yahoo.com/news/fixture-${i}`,publisher:i?'Yahoo Finance':'Example publisher',publishedAt:`2026-11-04T${['18:20','18:18','18:05','15:42','14:27','11:14'][i]}:00Z`,economy:i!==3}));
async function setup(p){
 await p.clock.install({time:new Date('2026-11-04T18:30:00Z')});await mockMarket(p);await mockBriefing(p);
 p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.method()==='PUT'&&r.url().includes('/api/workspace'))writes++;});
 await p.route('**/api/sentiment',r=>r.fulfill({json:{status:'ok',fetchedAt:stamp,data:{score:27.31,rating:'fear',observedAt:stamp}}}));
 await p.route('**/qa-news-image.svg',r=>r.fulfill({contentType:'image/svg+xml',body:readFileSync(new URL('../public/favicon.svg',import.meta.url))}));
 await p.route('**/qa-news-failed.png',r=>r.fulfill({status:404,body:''}));
 await p.route('**/api/news?*',async r=>{
  const symbols=new URL(r.request().url()).searchParams.get('symbols');requests.push(symbols);
  const items=symbols==='NVDA'?[{...articles[0],id:'nvda',title:'NVIDIA ticker fixture'}]:mode==='empty'?[]:mode==='images'?articles.map((a,i)=>({...a,image:i<2?{url:runtime.url+(i?'/qa-news-failed.png':'/qa-news-image.svg')}:null})):mode==='older'?[articles[0],{...articles[1],publishedAt:'2026-11-03T23:30:00Z'},{...articles[2],publishedAt:'2026-11-03T20:00:00Z'}]:articles;
  await new Promise(resolve=>setTimeout(resolve,30));await r.fulfill({json:mode==='unavailable'?{status:'unavailable',message:'Fixture source outage',data:null}:{status:mode==='stale'?'stale':'ok',fetchedAt:stamp,source:{name:'Yahoo Finance',url:'https://finance.yahoo.com/'},data:{articles:items}}});
 });
}
try{
 await setup(page);const before=await(await testFetch(runtime.url+'/api/workspace')).json();await page.goto(runtime.url+'/#markets/news');
 await expect(page.locator('.news-article')).toHaveCount(6);await expect(page.locator('.news-group').nth(0)).toHaveAccessibleName('Newest');await expect(page.locator('.news-group').nth(0).locator('.news-article')).toHaveCount(2);await expect(page.locator('.news-group').nth(1)).toHaveAccessibleName('Earlier today');await expect(page.locator('.news-quotes button')).toHaveCount(3);await expect(page.locator('.market-groups')).toHaveCount(0);
 await expect(page.locator('.sidebar-sentiment strong')).toHaveText('27');await expect(page.locator('.sidebar-sentiment')).toHaveAttribute('title',/27\.31/);await expect(page.locator('.sidebar-sentiment')).toContainText('fear');
 const box=await page.locator('.news-quotes').boundingBox(),tabs=await page.getByRole('navigation',{name:'Markets sections'}).boundingBox();expect(box.y+box.height).toBeLessThanOrEqual(tabs.y+1);await expect(page.getByLabel('News symbol')).toBeVisible();await expect(page.locator('.news-lead')).toHaveAttribute('href',articles[0].url);await expect(page.locator('.news-lead')).toHaveAttribute('rel','noopener noreferrer');
 mark('Approved header, three quote strip, lead story and time groups render; sidebar rounds 27.31 to 27 while retaining its exact source and rating');
 await page.getByRole('button',{name:'Open NQ chart',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Open NQ chart',exact:true})).toBeFocused();
 const count=requests.length;await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Overview',exact:true}).click();await expect(page.locator('.overview-news strong')).toHaveText(titles[0]);await page.getByRole('button',{name:'Open News',exact:true}).click();await expect(page.locator('.news-lead h3')).toHaveText(titles[0]);expect(requests.length).toBe(count);
 await page.getByLabel('News symbol').selectOption('NVDA');await expect(page.getByRole('button',{name:'My watchlist',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.locator('.news-article')).toHaveCount(1);await expect(page.locator('.news-lead')).toContainText('NVIDIA ticker fixture');expect(requests.at(-1)).toBe('NVDA');
 await page.getByRole('button',{name:'U.S. market',exact:true}).click();await expect(page.getByLabel('News symbol')).toHaveValue('all');await expect(page.locator('.news-article')).toHaveCount(6);await page.getByRole('checkbox',{name:'Economy headlines only'}).check();await expect(page.locator('.news-article')).toHaveCount(5);await expect(page.locator('.news-list')).not.toContainText(titles[3]);await page.getByRole('checkbox',{name:'Economy headlines only'}).uncheck();
 mark('Quote chart focus return, shared Overview headline, market/watchlist/ticker selection and economy filter work without duplicate market-feed requests');
 const refresh=()=>page.getByRole('button',{name:'Refresh source',exact:true}).click();
 mode='stale';await refresh();await expect(page.locator('.news-panel').getByRole('status')).toContainText('cached headlines');await expect(page.locator('.news-source-status')).toContainText('Cached');
 mode='unavailable';await refresh();await expect(page.locator('.news-article')).toHaveCount(0);await expect(page.locator('.news-panel')).toContainText('Fixture source outage');
 mode='empty';await refresh();await expect(page.locator('.news-panel')).toContainText('No headlines returned');mode='older';await refresh();await expect(page.locator('.news-group').nth(0)).toHaveAccessibleName('Earlier today');await expect(page.locator('.news-group').nth(1)).toHaveAccessibleName('Nov 3, 2026');
 mode='ok';await refresh();await expect(page.locator('.news-article')).toHaveCount(6);const refreshCount=requests.length;await page.clock.fastForward(10*60*1000+100);await expect.poll(()=>requests.length).toBeGreaterThan(refreshCount);
 mark('Cached, empty and unavailable states recover; grouping follows Skopje midnight; automatic ten-minute refresh remains active');
 mode='images';await refresh();await expect(page.locator('.news-lead img')).toBeVisible();await expect.poll(()=>page.locator('.news-image img').count()).toBe(1);await expect(page.locator('.news-article')).toHaveCount(6);await page.screenshot({path:dir+'/publisher-images.png',fullPage:true});
 for(const width of [1488,1024,820,390,320]){await page.setViewportSize({width,height:1050});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);if(width<400)await page.screenshot({path:`${dir}/images-${width}.png`,fullPage:true});}
 mode='ok';await refresh();await expect(page.locator('.news-image')).toHaveCount(0);
 for(const width of [1488,1024,820,390,320]){await page.setViewportSize({width,height:1050});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);await page.screenshot({path:`${dir}/news-${width}.png`,fullPage:true});}
 await page.getByRole('button',{name:'Open navigation',exact:true}).click();await expect(page.getByRole('dialog',{name:'Navigation'})).toBeVisible();await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Overview',exact:true}).click();await page.getByRole('button',{name:'Open News',exact:true}).click();await expect(page.locator('.sidebar')).not.toHaveClass(/is-open/);await expect(page.locator('.news-lead')).toBeVisible();
 mark('Publisher images display when supplied; failed images collapse without losing headlines; text/image layouts fit 320px phones through desktop and navigation works');
 expect(writes).toBe(0);expect((await(await testFetch(runtime.url+'/api/workspace')).json()).revision).toBe(before.revision);expect(errors).toEqual([]);mark('No browser errors or workspace writes');
 writeFileSync(dir+'/browser-checks.json',JSON.stringify({result:'passed',checks,errors,writes},null,2)+'\n');
}catch(error){await page.screenshot({path:dir+'/failure.png',fullPage:true});throw error;}finally{await browser.close();await runtime.close();}
