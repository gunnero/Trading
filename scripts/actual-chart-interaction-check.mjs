import {testFetch as fetch} from '../tests/fixtures/auth.mjs';
// Read-only verification against the owner's loopback preview. Never alters saved preferences.
import {chromium,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
const base='http://127.0.0.1:4173',before=await(await fetch(base+'/api/workspace')).json();
const browser=await chromium.launch({headless:true,executablePath:'/home/gunner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',env:{...process.env,LD_LIBRARY_PATH:'/home/gunner/.cache/mediahub/browser-libs/root/usr/lib/x86_64-linux-gnu'}});
const errors=[],checks=[];let writes=0;
const track=page=>{page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='PUT')writes++;});};
try{
 const page=await browser.newPage({viewport:{width:1488,height:1100}});track(page);await page.goto(base);
 await expect(page.locator('.chart-panel .price-chart')).toBeVisible({timeout:40000});await expect(page.locator('.chart-panel .zone-role-status summary')).toContainText('closes',{timeout:40000});
 await page.locator('.chart-panel').getByRole('button',{name:'Zoom in',exact:true}).click();await expect.poll(async()=>+await page.locator('.chart-panel .price-chart').getAttribute('data-view-start')).toBeGreaterThan(0);
 const mainChart=page.locator('.chart-panel .price-chart'),mainBox=await mainChart.boundingBox(),priorSpan=await mainChart.evaluate(el=>+el.dataset.priceMax- +el.dataset.priceMin);
 await page.mouse.move(mainBox.x+mainBox.width-30,mainBox.y+100);await page.mouse.down();await page.mouse.move(mainBox.x+mainBox.width-30,mainBox.y+60,{steps:10});await page.mouse.up();await expect(mainChart).toHaveAttribute('data-price-scale','manual');expect(await mainChart.evaluate(el=>+el.dataset.priceMax- +el.dataset.priceMin)).toBeLessThan(priorSpan);
 await page.screenshot({path:'docs/qa/chart-interactive-actual-overview.png',fullPage:true});checks.push('Actual primary chart price-axis drag changes the displayed range');
 await page.getByRole('button',{name:'Open NQ chart',exact:true}).click();const dialog=page.getByRole('dialog');
 await expect(dialog.locator('.price-chart')).toHaveAttribute('aria-label',/NQ Yahoo Finance 4h/,{timeout:40000});await expect(dialog.locator('.zone-role-status summary')).toContainText('30 min closes',{timeout:40000});
 await dialog.getByRole('button',{name:'Zoom in',exact:true}).click();await dialog.screenshot({path:'docs/qa/chart-interactive-actual-NQ.png'});
 checks.push('Actual QQQ/primary and NQ charts show confirmation history and respond to zoom');await page.close();
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});const mobile=await context.newPage();track(mobile);await mobile.goto(base);await mobile.getByRole('button',{name:'Open NQ chart',exact:true}).click();
 const md=mobile.getByRole('dialog'),chart=md.locator('.price-chart');await expect(chart).toHaveAttribute('aria-label',/NQ Yahoo Finance 4h/,{timeout:40000});
 await chart.scrollIntoViewIfNeeded();const box=await chart.boundingBox(),x=box.x+box.width*.45,y=Math.max(50,Math.min(700,box.y+100));
 const cdp=await context.newCDPSession(mobile);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x-25,y,id:0},{x:x+25,y,id:1}]});
 for(let d=30;d<=65;d+=5)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-d,y,id:0},{x:x+d,y,id:1}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expect.poll(async()=>+await chart.getAttribute('data-view-end')- +await chart.getAttribute('data-view-start')).toBeLessThan(100);
 expect(await md.evaluate(d=>d.scrollWidth>d.clientWidth+1)).toBe(false);
 const axisBox=await chart.boundingBox(),axisX=axisBox.x+axisBox.width-30,axisY=axisBox.y+80;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:axisX,y:axisY,id:0}]});for(let dy=5;dy<=35;dy+=5)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:axisX,y:axisY+dy,id:0}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect(chart).toHaveAttribute('data-price-scale','manual');checks.push('Actual mobile price scale supports touch dragging');
 await mobile.screenshot({path:'docs/qa/chart-interactive-actual-mobile.png'});checks.push('Touch pinch zoom changes the mobile chart range without horizontal overflow');
 const after=await(await fetch(base+'/api/workspace')).json();expect(writes).toBe(0);expect(after).toEqual(before);expect(errors).toEqual([]);
 writeFileSync('docs/qa/chart-interaction-actual-checks.json',JSON.stringify({result:'passed',checks,errors,writes,revision:after.revision,preferences:after.data.preferences},null,2)+'\n');console.log({checks,errors,writes,revision:after.revision});
}finally{await browser.close();}
