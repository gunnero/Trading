import {chromium,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {testRuntime} from './qa-runtime.mjs';
import {testFetch} from '../tests/fixtures/auth.mjs';
import {mockMarket} from '../tests/fixtures/market.mjs';
import {mockBriefing} from '../tests/fixtures/briefing.mjs';
const runtime=await testRuntime(),dir='docs/qa/navigation';mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/home/gunner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',env:{...process.env,LD_LIBRARY_PATH:'/home/gunner/.cache/mediahub/browser-libs/root/usr/lib/x86_64-linux-gnu'}});
const checks=[],errors=[],mark=s=>{checks.push(s);console.log('PASS '+s);};
const read=async()=>(await testFetch(runtime.url+'/api/workspace')).json();
const page=await browser.newPage({viewport:{width:1488,height:1050}});
try{
 await mockMarket(page);await mockBriefing(page);page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/portfolio/notifications',r=>r.fulfill({json:{items:[],unread:16,latestId:16}}));
 let tradeWrites=0;page.on('request',r=>{if(r.method()==='POST'&&/\/trading\/(preview|submit)/.test(r.url()))tradeWrites++;});
 const before=await read();await page.goto(runtime.url+'/#overview');
 const main=page.getByRole('navigation',{name:'Main navigation'});
 await expect(main.getByRole('button')).toHaveText(['Overview','Markets','Portfolio Manager16','Journal']);
 await expect(page.getByRole('button',{name:'Account and security',exact:true})).toBeHidden();
 await page.locator('.page-header').getByRole('button',{name:'Key levels',exact:true}).click();await expect(page).toHaveURL(/#levels$/);await expect(main.getByRole('button',{name:'Overview',exact:true})).toHaveAttribute('aria-current','page');
 await page.getByRole('button',{name:'Back to Overview',exact:true}).click();await expect(page).toHaveURL(/#overview$/);
 await main.getByRole('button',{name:'Markets',exact:true}).click();const markets=page.getByRole('navigation',{name:'Markets sections'});
 await expect(page).toHaveURL(/#markets\/calendar$/);await markets.getByRole('button',{name:'Earnings',exact:true}).click();await expect(page.getByRole('heading',{name:'Earnings',exact:true,level:1})).toBeVisible();
 await markets.getByRole('button',{name:'News',exact:true}).click();await expect(page).toHaveURL(/#markets\/news$/);await page.reload();await expect(markets.getByRole('button',{name:'News',exact:true})).toHaveAttribute('aria-current','page');
 await page.goBack();await expect(page).toHaveURL(/#markets\/earnings$/);await page.goForward();await expect(page).toHaveURL(/#markets\/news$/);
 mark('Compact main menu, Overview levels shortcut and Markets tabs work with refresh and browser history');
 await main.getByRole('button',{name:'Portfolio Manager',exact:true}).click();const portfolios=page.getByRole('navigation',{name:'Portfolio sections'});
 await expect(portfolios.getByRole('button',{name:'Accounts',exact:true})).toHaveAttribute('aria-current','page');await portfolios.getByRole('button',{name:'Insights',exact:true}).click();await expect(page).toHaveURL(/#portfolio\/insights$/);
 await page.getByRole('button',{name:'Monitor',exact:true}).click();await expect(page).toHaveURL(/#portfolio\/insights\/monitor$/);await page.reload();await expect(page.getByRole('button',{name:'Monitor',exact:true})).toHaveAttribute('aria-current','page');
 await portfolios.getByRole('button',{name:'Activity & alerts',exact:true}).click();await expect(page).toHaveURL(/#portfolio\/activity$/);await expect(portfolios.getByLabel('16 unread alerts')).toBeVisible();
 await expect(main.getByRole('button',{name:'Portfolio Manager',exact:true})).toHaveAttribute('aria-current','page');
 await main.getByRole('button',{name:'Journal',exact:true}).click();const journal=page.getByRole('navigation',{name:'Trade journal sections'});
 await journal.getByRole('button',{name:'Session review',exact:true}).click();await page.getByLabel('Session review date').fill('2026-11-03');await expect(page).toHaveURL(/#journal\/review\/2026-11-03$/);await page.reload();await expect(page.getByLabel('Session review date')).toHaveValue('2026-11-03');await expect(page.locator('main h1')).toHaveCount(1);
 await journal.getByRole('button',{name:'Trades',exact:true}).click();await expect(page).toHaveURL(/#journal\/trades$/);
 await page.locator('.sidebar-profile').getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('navigation',{name:'Settings sections'}).getByRole('link',{name:'Account & security',exact:true}).click();await expect(page.getByRole('heading',{name:'Account & security',exact:true})).toBeVisible();
 mark('Portfolio tabs keep unread alerts and insight subpages; Journal contains daily reviews; account security lives inside Settings');
 for(const [old,next] of [['briefing','markets/calendar'],['earnings','markets/earnings'],['news','markets/news'],['insights/reports','portfolio/insights/reports'],['activity','portfolio/activity'],['review/2026-11-03','journal/review/2026-11-03']]){await page.goto(runtime.url+'/#'+old);await expect(page).toHaveURL(runtime.url+'/#'+next);}
 for(const width of [320,390,820,1488]){
  await page.setViewportSize({width,height:1050});
  for(const route of ['overview','markets/calendar','markets/earnings','markets/news','portfolio','portfolio/insights','portfolio/activity','journal/review/2026-11-03','settings/account']){
   await page.goto(runtime.url+'/#'+route);await expect(page.locator('main h1')).toHaveCount(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),`${route} at ${width}`).toBeLessThanOrEqual(1);
   for(const selected of await page.locator('.section-tabs [aria-current=page], .journal-page-tabs [aria-current=page]').all()){const bounds=await selected.boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(width);}
   if([320,1488].includes(width)&&['overview','markets/news','portfolio','journal/review/2026-11-03','settings/account'].includes(route))await page.screenshot({path:`${dir}/${route.replaceAll('/','-')}-${width}.png`});
  }
 }
 await page.setViewportSize({width:390,height:844});
 for(const [label,route] of [['Markets','markets/calendar'],['Portfolio Manager','portfolio'],['Journal','journal']]){
  await page.getByRole('button',{name:'Open navigation',exact:true}).click();await expect(page.getByRole('dialog',{name:'Navigation'})).toBeVisible();await main.getByRole('button',{name:label,exact:true}).click();await expect(page).toHaveURL(runtime.url+'/#'+route);await expect(page.locator('.sidebar')).not.toHaveClass(/is-open/);
 }
 await expect(page.getByRole('heading',{name:'Trade journal',exact:true})).toBeVisible();
 expect((await read()).revision).toBe(before.revision);expect(tradeWrites).toBe(0);expect(errors).toEqual([]);mark('Legacy links, four responsive widths and mobile navigation pass with no workspace or trading writes');
 writeFileSync(dir+'/checks.json',JSON.stringify({result:'passed',checks,errors,tradeWrites},null,2)+'\n');
}catch(e){await page.screenshot({path:dir+'/failure.png',fullPage:true});writeFileSync(dir+'/checks.json',JSON.stringify({result:'failed',checks,errors,error:e.message},null,2)+'\n');throw e;}finally{await browser.close();await runtime.close();}
