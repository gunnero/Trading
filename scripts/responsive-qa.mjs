import {chromium,expect} from '@playwright/test';
import {writeFileSync,mkdirSync} from 'node:fs';
import {testRuntime} from './qa-runtime.mjs';
import {mockMarket,indicatorFixture} from '../tests/fixtures/market.mjs';
import {mockBriefing} from '../tests/fixtures/briefing.mjs';

const dir='docs/qa/responsive-after';mkdirSync(dir,{recursive:true});
const runtime=await testRuntime(),browser=await chromium.launch({headless:true,executablePath:'/home/gunner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',env:{...process.env,LD_LIBRARY_PATH:'/home/gunner/.cache/mediahub/browser-libs/root/usr/lib/x86_64-linux-gnu'}});
const checks=[],errors=[],metrics=[];
const mark=text=>{checks.push(text);console.log('PASS '+text);};
async function setup(page){
  page.on('pageerror',error=>errors.push(error.message));
  await mockMarket(page);await mockBriefing(page);
  const fixtures=new Map();
  await page.route('**/api/market/chart?*',route=>{
    const url=new URL(route.request().url()),symbol=url.searchParams.get('symbol'),frame=url.searchParams.get('interval');
    if(symbol==='US2Y')return route.fallback();
    const key=symbol+':'+frame;if(!fixtures.has(key))fixtures.set(key,indicatorFixture(symbol,frame));
    return route.fulfill({json:fixtures.get(key)});
  });
}
async function noOverflow(page){expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);expect(await page.locator('main').evaluate(node=>node.scrollWidth-node.clientWidth)).toBeLessThanOrEqual(1);}
try{
  for(const [width,height] of [[320,740],[360,800],[390,844],[430,932],[768,1024],[820,1180],[844,390],[1024,768],[1180,820],[1488,1100]]){
    const page=await browser.newPage({viewport:{width,height},hasTouch:width<=1180,isMobile:width<=1180});await setup(page);
    await page.goto(runtime.url+'/#overview');const panel=page.locator('.chart-panel'),chart=panel.locator('.price-chart');await expect(chart).toBeVisible();
    await noOverflow(page);
    const controls=panel.locator('.chart-header-icons button'),frames=panel.locator('[aria-label="Chart timeframe"] button');
    const boxes=await controls.evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};}));
    const frameBoxes=await frames.evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};}));
    expect(boxes.length).toBe(6);expect(frameBoxes.length).toBe(9);
    for(const a of boxes)for(const b of frameBoxes)expect(a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y).toBe(false);
    if(width<=1100){expect(Math.min(...boxes.map(r=>r.w))).toBeGreaterThanOrEqual(44);expect(Math.min(...frameBoxes.map(r=>r.h))).toBeGreaterThanOrEqual(44);}
    const chartWidth=(await chart.boundingBox()).width,chartY=await panel.evaluate(node=>node.getBoundingClientRect().top+scrollY);
    if(width>=768&&width<=1100)expect(chartWidth).toBeGreaterThan(width*.7);
    if([390,820,1488].includes(width)){
      await page.screenshot({path:`${dir}/overview-${width}.png`});await chart.scrollIntoViewIfNeeded();await page.screenshot({path:`${dir}/chart-${width}.png`});
    }
    await page.goto(runtime.url+'/#watchlist');await expect(page.locator('.watch-table tbody tr')).toHaveCount(52);await noOverflow(page);
    expect(await page.locator('[_echarts_instance_]').count()).toBe(0);
    const row=page.locator('[data-watchlist-id="NASDAQ:NVDA"]');await row.scrollIntoViewIfNeeded();
    if(width<=760){
      for(const selector of ['td:nth-child(3)','td:nth-child(4)','.zone-cell','td:nth-child(6)','.reason-col','.watchlist-remove'])await expect(row.locator(selector)).toBeVisible();
      const r=await row.boundingBox();expect(r.width).toBeLessThanOrEqual(width);expect(r.height).toBeLessThan(240);
    }
    if([390,820].includes(width))await page.screenshot({path:`${dir}/watchlist-${width}.png`});
    for(const section of ['levels','briefing','news']){
      await page.goto(runtime.url+'/#'+section);await page.locator('main').scrollIntoViewIfNeeded();await noOverflow(page);
      if(section==='news')await expect(page.getByRole('heading',{name:'Technology earnings and the Fed lead the week ahead'})).toBeVisible();
      if(section==='briefing'&&width<=1100){
        const calendar=await page.locator('.briefing-calendars').boundingBox(),sentiment=await page.locator('.briefing-side').boundingBox();expect(calendar.y).toBeLessThan(sentiment.y);
      }
      if([390,820].includes(width))await page.screenshot({path:`${dir}/${section}-${width}.png`});
    }
    metrics.push({width,height,chartWidth,chartY,watchlistChartEngines:0});await page.close();
  }
  mark('Ten viewport sizes from 320 to 1488px fit without page overflow; chart controls do not overlap, tablet charts are full width, and phone watchlists retain essential details');

  const mobile=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});await setup(mobile);await mobile.goto(runtime.url+'/#overview');
  const quick=mobile.getByRole('navigation',{name:'Quick navigation'});
  await quick.getByRole('button',{name:'More navigation',exact:true}).tap();await expect(mobile.locator('.sidebar')).toHaveAttribute('aria-modal','true');
  expect(await mobile.evaluate(()=>document.body.style.overflow)).toBe('hidden');
  await mobile.keyboard.press('Shift+Tab');expect(await mobile.evaluate(()=>document.activeElement.closest('.sidebar')!==null)).toBe(true);
  await mobile.keyboard.press('Escape');await expect(quick.getByRole('button',{name:'More navigation'})).toBeFocused();
  await quick.getByRole('button',{name:'More navigation'}).tap();await mobile.locator('.sidebar').getByRole('button',{name:'Key levels',exact:true}).tap();await expect(mobile).toHaveURL(/#levels$/);await mobile.reload();await expect(mobile.getByRole('heading',{name:'Key levels',exact:true})).toBeVisible();
  await quick.getByRole('button',{name:'Overview',exact:true}).tap();const panel=mobile.locator('.chart-panel'),chart=panel.locator('.price-chart');await expect(chart).toBeVisible();
  await chart.scrollIntoViewIfNeeded();await expect(panel.locator('.touch-chart-shell')).toHaveAttribute('data-touch-active','false');
  const cdp=await mobile.context().newCDPSession(mobile),box=await chart.boundingBox(),start=await mobile.evaluate(()=>scrollY);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+100,y:box.y+210,id:1}]});
  for(let dy=10;dy<=110;dy+=10)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+100,y:box.y+210-dy,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(()=>mobile.evaluate(()=>scrollY)).toBeGreaterThan(start+30);
  await panel.getByRole('button',{name:'Interact with chart',exact:true}).tap();await expect(panel.locator('.touch-chart-shell')).toHaveAttribute('data-touch-active','true');
  await chart.scrollIntoViewIfNeeded();const axis=await chart.boundingBox();
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:axis.x+axis.width-25,y:axis.y+90,id:1}]});
  for(let dy=5;dy<=60;dy+=5)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:axis.x+axis.width-25,y:axis.y+90+dy,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect(chart).toHaveAttribute('data-price-scale','manual');
  await panel.getByRole('button',{name:'Drawing tools',exact:true}).tap();await panel.getByRole('button',{name:'Horizontal level',exact:true}).tap();await chart.scrollIntoViewIfNeeded();const drawingBox=await chart.boundingBox();await mobile.touchscreen.tap(drawingBox.x+100,drawingBox.y+120);await expect(panel.locator('.drawing-shape')).toHaveCount(1);
  await expect(mobile.locator('.workspace-save-status')).toContainText('Workspace saved');await mobile.reload();await expect(panel.locator('.drawing-shape')).toHaveCount(1);await expect(chart).toHaveAttribute('data-price-scale','manual');await panel.getByRole('button',{name:'Reset view',exact:true}).tap();await expect(chart).toHaveAttribute('data-price-scale','auto');await expect(panel.locator('.drawing-shape')).toHaveCount(1);
  await quick.getByRole('button',{name:'Watchlist',exact:true}).tap();await mobile.getByRole('textbox',{name:'Search watchlist'}).fill('NVDA');await mobile.locator('.watch-table .symbol-button').tap();const dialog=mobile.getByRole('dialog');await expect(dialog.locator('.price-chart')).toBeVisible();
  expect(await dialog.evaluate(node=>node.scrollWidth-node.clientWidth)).toBeLessThanOrEqual(1);await dialog.evaluate(node=>{node.scrollTop=1000;});await expect(dialog.getByRole('button',{name:'Close dialog',exact:true})).toBeInViewport();await dialog.getByRole('button',{name:'Close dialog',exact:true}).tap();await expect(mobile.locator('.watch-table .symbol-button')).toBeFocused();
  await mobile.close();mark('Phone drawer traps/returns focus, page refresh preserves navigation, chart swipes scroll until activated, touch axis/drawings work and persist, Reset keeps drawings, and company dialogs stay closable');

  const perf=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});await setup(perf);await perf.clock.install({time:new Date('2026-10-25T12:00:00Z')});
  const requests=[],scriptResponses=[];perf.on('request',r=>{if(r.url().includes('/api/'))requests.push(new URL(r.url()).pathname);});
  perf.on('response',response=>{if(response.url().endsWith('.js'))scriptResponses.push(response.body().then(body=>({name:new URL(response.url()).pathname.split('/').at(-1),bytes:body.length})));});
  await perf.goto(runtime.url+'/#news');await expect(perf.getByRole('heading',{name:'Technology earnings and the Fed lead the week ahead'})).toBeVisible();
  const scripts=await Promise.all(scriptResponses);expect(scripts.length).toBeGreaterThan(0);
  expect(scripts.some(r=>r.name.includes('ChartCanvas'))).toBe(false);expect(await perf.locator('[_echarts_instance_]').count()).toBe(0);
  for(const path of ['/api/market/setup','/api/market/chart','/api/market/level-history','/api/sentiment','/api/calendar','/api/earnings'])expect(requests.includes(path)).toBe(false);
  await perf.goto(runtime.url+'/#overview');await expect(perf.locator('.chart-panel .price-chart')).toBeVisible();await expect(perf.locator('.scan-details')).toContainText('stocks have levels');
  await perf.goto(runtime.url+'/#news');await expect(perf.getByRole('heading',{name:'Technology earnings and the Fed lead the week ahead'})).toBeVisible();const cut=requests.length;
  await perf.clock.fastForward(70000);await perf.waitForTimeout(50);
  expect(requests.slice(cut).filter(path=>/setup|chart|level-history|sentiment|calendar|earnings/.test(path))).toEqual([]);
  await perf.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  await perf.waitForTimeout(100);const hiddenCut=requests.length;await perf.clock.fastForward(11*60000);await perf.waitForTimeout(100);expect(requests.length).toBe(hiddenCut);
  await perf.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});await expect.poll(()=>requests.length).toBeGreaterThan(hiddenCut);
  await perf.close();mark('Cold News loads no chart engine or unused feeds; leaving Overview stops scan/chart polling; a hidden tab makes no refresh requests and resumes when visible');
  expect(errors).toEqual([]);
  writeFileSync(`${dir}/checks.json`,JSON.stringify({result:'passed',checks,metrics,coldNewsScripts:scripts,errors},null,2)+'\n');
}finally{await browser.close();await runtime.close();}
