import {testFetch as fetch} from '../tests/fixtures/auth.mjs';
// Read-only smoke check of the running owner preview; never edits the workspace.
import {chromium,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
const browser=await chromium.launch({headless:true,executablePath:'/home/gunner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',env:{...process.env,LD_LIBRARY_PATH:'/home/gunner/.cache/mediahub/browser-libs/root/usr/lib/x86_64-linux-gnu'}});
const page=await browser.newPage({viewport:{width:1488,height:1058}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const origin='http://127.0.0.1:4173';
const before=await (await fetch(`${origin}/api/workspace`)).json();
async function pictures(){
 await expect.poll(()=>page.locator('.news-image img').evaluateAll(images=>images.filter(img=>{const box=img.getBoundingClientRect();return box.top<innerHeight&&box.bottom>0;}).every(img=>img.complete&&img.naturalWidth>0)),{timeout:25000}).toBe(true);
 await page.locator('.news-image img').evaluateAll(async images=>{
  await Promise.all(images.filter(img=>img.complete&&img.naturalWidth>0).map(img=>img.decode()));
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 });
}
try{
 const response=await page.goto(origin);expect(response.status()).toBe(200);
 await expect(page.locator('.overview-news time')).toBeVisible();await pictures();
 const title=await page.locator('.overview-news strong').innerText();
 await page.screenshot({path:'docs/qa/overview-latest-news.png',fullPage:false});
 await page.getByRole('button',{name:'Open News',exact:true}).click();await expect(page.locator('.news-lead h3')).toHaveText(title);await pictures();
 await page.screenshot({path:'docs/qa/news-page-desktop.png',fullPage:false});
 const images=await page.locator('.news-image img').evaluateAll(nodes=>nodes.map(img=>({url:img.src,loaded:img.complete&&img.naturalWidth>0})));
 await page.setViewportSize({width:390,height:900});await pictures();
 await page.screenshot({path:'docs/qa/news-page-mobile.png',fullPage:false});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.getByRole('navigation').getByRole('button',{name:'Overview',exact:true}).click();await pictures();
 await page.screenshot({path:'docs/qa/overview-latest-news-mobile.png',fullPage:false});
 const after=await (await fetch(`${origin}/api/workspace`)).json();expect(after.revision).toEqual(before.revision);expect(errors).toEqual([]);
 writeFileSync('docs/qa/news-preview-smoke.json',JSON.stringify({result:'passed',http:response.status(),title,images,revisionUnchanged:after.revision===before.revision,errors},null,2)+'\n');
 console.log(JSON.stringify({result:'passed',images:images.filter(img=>img.loaded).length,revisionUnchanged:true,errors}));
}finally{await browser.close();}
