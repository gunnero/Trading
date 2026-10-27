import {chromium,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {testRuntime} from './qa-runtime.mjs';
import {testFetch} from '../tests/fixtures/auth.mjs';
import {mockMarket,yahooPayload} from '../tests/fixtures/market.mjs';
import {mockBriefing} from '../tests/fixtures/briefing.mjs';
import {screenshotFixtures} from '../tests/fixtures/journal.mjs';
import {parseCandles,resolveSymbol} from '../server/market-data.mjs';
const runtime=await testRuntime(),dir='docs/qa/journal-chart';mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/home/gunner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',env:{...process.env,LD_LIBRARY_PATH:'/home/gunner/.cache/mediahub/browser-libs/root/usr/lib/x86_64-linux-gnu'}});
const checks=[],errors=[];const mark=s=>{checks.push(s);console.log('PASS '+s);};
let mode='ok';const requests=[];
async function setup(page){
 page.on('pageerror',e=>errors.push(e.message));await mockMarket(page);await mockBriefing(page);
 await page.route('**/api/market/trade-history?*',async route=>{
  const params=new URL(route.request().url()).searchParams,symbol=params.get('symbol'),frame=params.get('interval');requests.push(Object.fromEntries(params));
  if(mode==='unavailable')return route.fulfill({json:{status:'unavailable',message:'No historical candles for this date.'}});
  const start=Date.parse('2026-10-26T13:30:00Z')/1000,asset=resolveSymbol(symbol),payload=yahooPayload(asset.symbol,{start,step:Number.parseInt(frame),price:asset.symbol==='AMD'?520:710});
  let candles=parseCandles(payload,asset,frame,Date.parse('2026-10-26T21:00Z'),{full:true});
  if(mode==='gap')candles=candles.filter(c=>!(c.timestamp<=Date.parse('2026-10-26T15:19:54Z')/1000&&c.end>Date.parse('2026-10-26T15:19:54Z')/1000));
  return route.fulfill({json:{symbol,timeframe:frame,from:'2026-10-26',to:'2026-10-26',provider:'Yahoo Finance',status:mode==='stale'?'stale':'ok',message:mode==='stale'?'Cached reading · source refresh unavailable.':undefined,candles,observedThrough:Date.parse('2026-10-26T20:00Z')/1000,fetchedAt:'2026-10-26T21:00:00Z'}});
 });
}
try{
 const read=async()=>await(await testFetch(runtime.url+'/api/workspace')).json(),initial=await read();
 const saved=await testFetch(runtime.url+'/api/workspace',{method:'PUT',headers:{'Content-Type':'application/json','X-Opening-Bell-Client':'web'},body:JSON.stringify({revision:initial.revision,data:{...initial.data,journal:{version:1,trades:screenshotFixtures()}}})});expect(saved.ok).toBe(true);const before=await read();
 const page=await browser.newPage({viewport:{width:1488,height:1100}});await setup(page);await page.goto(runtime.url+'/#journal');await expect(page.locator('.journal-trades tbody tr')).toHaveCount(3);expect(requests).toHaveLength(0);
 await page.getByRole('button',{name:'AMD 530 Call',exact:true}).click();const dialog=page.getByRole('dialog'),chart=dialog.locator('.journal-trade-canvas');await expect(chart.locator('canvas')).toBeVisible();await expect(dialog.getByRole('button',{name:'2m',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(chart).toHaveAttribute('aria-label',/entry at 2026-10-26T16:19:54 Skopje marked.*exit at 2026-10-26T16:22:42 Skopje marked/);await expect(dialog.locator('.journal-execution-summary')).toContainText('$2.42');await expect(dialog.locator('.journal-execution-summary')).toContainText('$2.96');expect(requests[0]).toEqual({symbol:'NASDAQ:AMD',interval:'2m',from:'2026-10-26',to:'2026-10-26'});
 await dialog.screenshot({path:dir+'/trade-desktop.png'});const original=await chart.screenshot();await dialog.getByRole('button',{name:'Zoom trade chart in'}).click();expect((await chart.screenshot()).equals(original)).toBe(false);await dialog.getByRole('button',{name:'Fit trade',exact:true}).click();
 await dialog.getByRole('button',{name:'5m',exact:true}).click();await expect(chart).toHaveAttribute('aria-label',/AMD 5m/);await expect(chart.locator('canvas')).toBeVisible();await dialog.getByRole('button',{name:'15m',exact:true}).click();await expect(chart).toHaveAttribute('aria-label',/AMD 15m/);
 await dialog.getByRole('button',{name:'Details & notes',exact:true}).click();await expect(dialog.getByLabel('Entry time · Skopje · 24h')).toHaveValue('16:19:54');await expect(chart).toHaveCount(0);await dialog.getByRole('button',{name:'Trade chart',exact:true}).click();await expect(chart.locator('canvas')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'AMD 530 Call',exact:true})).toBeFocused();expect((await read()).revision).toBe(before.revision);
 mark('Saved trade opens its dated 2m underlying chart with exact entry/exit markers and separate option premiums; zoom, fit, intervals, details and focus return work without workspace writes');
 mode='gap';await page.getByRole('button',{name:'AMD 530 Call',exact:true}).click();await expect(dialog.getByText(/Entry time has no covering source candle/)).toBeVisible();await expect(chart).toHaveAttribute('aria-label',/entry .*has no covering candle.*exit .*marked/);await dialog.screenshot({path:dir+'/missing-candle.png'});
 mode='stale';await dialog.getByRole('button',{name:'Refresh history',exact:true}).click();await expect(dialog.getByText('Cached reading · source refresh unavailable.',{exact:true})).toBeVisible();mode='unavailable';await dialog.getByRole('button',{name:'15m',exact:true}).click();await expect(dialog.getByText('Historical chart unavailable',{exact:true})).toBeVisible();await expect(chart).toHaveCount(0);await expect(dialog.locator('.journal-execution-summary')).toContainText('$2.42');await page.keyboard.press('Escape');
 mark('Missing candles withhold only their own markers; stale history is labeled; another interval never reuses the previous chart during an outage');
 mode='ok';for(const width of [320,390,820]){
  const mobile=await browser.newPage({viewport:{width,height:900},hasTouch:true,isMobile:true});await setup(mobile);await mobile.goto(runtime.url+'/#journal');await mobile.getByRole('button',{name:'QQQ 714 Call',exact:true}).tap();const md=mobile.getByRole('dialog'),canvas=md.locator('.journal-trade-canvas');await expect(canvas.locator('canvas')).toBeVisible();expect(await md.evaluate(n=>n.scrollWidth-n.clientWidth)).toBeLessThanOrEqual(1);await expect(canvas).toHaveCSS('touch-action','pan-y');await md.getByRole('button',{name:'Interact',exact:true}).tap();await expect(canvas).toHaveCSS('touch-action','none');await md.getByRole('button',{name:'Done interacting',exact:true}).tap();await expect(canvas).toHaveCSS('touch-action','pan-y');await md.evaluate(n=>n.scrollTop=0);await md.screenshot({path:`${dir}/trade-${width}.png`});await md.evaluate(n=>n.scrollTop=n.scrollHeight);await expect(md.getByRole('button',{name:'Close trade dialog'})).toBeInViewport();await mobile.close();
 }
 mark('Phone/tablet layouts fit from 320px, keep close controls reachable, and allow page scrolling until chart interaction is explicitly enabled');
 expect((await read()).data).toEqual(before.data);expect(errors).toEqual([]);writeFileSync(dir+'/checks.json',JSON.stringify({result:'passed',checks,errors},null,2)+'\n');
}finally{await browser.close();await runtime.close();}
