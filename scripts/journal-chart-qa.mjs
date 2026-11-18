import {chromium,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {testRuntime} from './qa-runtime.mjs';
import {testFetch} from '../tests/fixtures/auth.mjs';
import {mockMarket,yahooPayload} from '../tests/fixtures/market.mjs';
import {mockBriefing} from '../tests/fixtures/briefing.mjs';
import {fixture,screenshotFixtures} from '../tests/fixtures/journal.mjs';
import {chartIndicators} from '../src/data/indicators.mjs';
import {parseCandles,resolveSymbol} from '../server/market-data.mjs';
const runtime=await testRuntime(),dir='docs/qa/journal-chart';mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/home/gunner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',env:{...process.env,LD_LIBRARY_PATH:'/home/gunner/.cache/mediahub/browser-libs/root/usr/lib/x86_64-linux-gnu'}});
const checks=[],errors=[];const mark=s=>{checks.push(s);console.log('PASS '+s);};
let mode='ok';const requests=[];
async function setup(page){
 await page.clock.setFixedTime(new Date('2026-10-26T17:30:00Z'));
 page.on('pageerror',e=>errors.push(e.message));await mockMarket(page);await mockBriefing(page);
 await page.route('**/api/market/trade-history?*',async route=>{
  const params=new URL(route.request().url()).searchParams,symbol=params.get('symbol'),frame=params.get('interval');requests.push(Object.fromEntries(params));
  if(mode==='unavailable')return route.fulfill({json:{status:'unavailable',message:'No historical candles for this date.'}});
  const start=Date.parse('2026-10-26T13:30:00Z')/1000,asset=resolveSymbol(symbol),payload=yahooPayload(asset.symbol,{start,step:Number.parseInt(frame),price:asset.symbol==='AMD'?520:710});
  if(frame==='2m'&&asset.symbol==='AMD'){
   const q=payload.chart.result[0].indicators.quote[0];
   for(let i=0;i<q.close.length;i++){
    const close=i<50?520+i*.05:i===50?526.4:i===51?526.3:526.4+(i-52)*.02;
    q.open[i]=close-.04;q.close[i]=close;q.low[i]=i===51?525.8:close-.06;q.high[i]=close+.08;
   }
  }
  let candles=parseCandles(payload,asset,frame,Date.parse('2026-10-26T21:00Z'),{full:true});
  if(mode==='gap')candles=candles.filter(c=>!(c.timestamp<=Date.parse('2026-10-26T15:19:54Z')/1000&&c.end>Date.parse('2026-10-26T15:19:54Z')/1000));
  return route.fulfill({json:{indicators:chartIndicators({rows:candles,frame,now:Date.parse('2026-10-26T21:00Z'),dailyStatus:'unavailable'}),symbol,timeframe:frame,from:'2026-10-26',to:'2026-10-26',provider:'Yahoo Finance',status:mode==='stale'?'stale':'ok',message:mode==='stale'?'Cached reading · source refresh unavailable.':undefined,candles,observedThrough:Date.parse('2026-10-26T20:00Z')/1000,fetchedAt:'2026-10-26T21:00:00Z'}});
 });
}
try{
 const read=async()=>await(await testFetch(runtime.url+'/api/workspace')).json(),initial=await read();
 const saved=await testFetch(runtime.url+'/api/workspace',{method:'PUT',headers:{'Content-Type':'application/json','X-Opening-Bell-Client':'web'},body:JSON.stringify({revision:initial.revision,data:{...initial.data,levelText:'LVLS 2026-10-26\nAMD|4h|S 526-525',levelSourceDates:{AMD:'2026-10-26'},levelHistory:[],journal:{version:1,trades:[...screenshotFixtures(),fixture({id:'open',strike:520,position:'short',entryAt:'2026-10-26T15:19:54.789Z',entryPrice:2.3401,exitAt:null,exitPrice:null,reportedPnl:null})]}}})});expect(saved.ok).toBe(true);const before=await read();
 const page=await browser.newPage({viewport:{width:1488,height:1100}});await setup(page);await page.goto(runtime.url+'/#journal');await expect(page.locator('.journal-trades tbody tr')).toHaveCount(4);expect(requests).toHaveLength(0);
 await page.getByRole('button',{name:'AMD 530 Call',exact:true}).click();const dialog=page.getByRole('dialog'),chart=dialog.locator('.journal-trade-canvas');await expect(chart.locator('canvas')).toBeVisible();await expect(dialog.getByRole('button',{name:'2m',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(chart).toHaveAttribute('aria-label',/entry at 2026-10-26 · 16:19:54 Skopje marked.*exit at 2026-10-26 · 16:22:42 Skopje marked/);await expect(dialog.locator('.review-metrics')).toContainText('$2.42');await expect(dialog.locator('.review-metrics')).toContainText('$2.96');expect(requests[0]).toEqual({symbol:'NASDAQ:AMD',interval:'2m',from:'2026-10-19',to:'2026-10-26'});
 await expect(dialog.getByRole('heading',{name:'Trade review',exact:true})).toBeVisible();
 await expect(dialog.locator('.review-fills tbody tr')).toHaveCount(2);await expect(dialog.locator('.review-inspector [role=status]')).toHaveText('Saved');
 await dialog.getByText('Option fill diagram',{exact:true}).click();
 await expect(dialog.getByRole('region',{name:'Exact option executions'})).toContainText('Your option fills');
 await dialog.getByText('Option fill diagram',{exact:true}).click();
 await dialog.getByText('Automatic strategy review',{exact:true}).click();
 await expect(dialog.getByRole('region',{name:'Automatic strategy review'})).toContainText('Rules matched before entry');
 await expect(dialog.locator('.journal-auto-checks [data-result=met]')).toHaveCount(6);
 const player=dialog.getByRole('slider',{name:'Replay candle'});
 await dialog.getByRole('button',{name:'First candle'}).click();
 await expect(player).toHaveValue('0');await expect(chart).not.toHaveAttribute('aria-label',/exit at/);
 await dialog.getByRole('button',{name:'Next candle'}).click();await expect(player).toHaveValue('1');
 await dialog.getByRole('button',{name:'Play replay'}).click();await expect.poll(async()=>Number(await player.inputValue())).toBeGreaterThan(1);
 await dialog.getByRole('button',{name:'Pause replay'}).click();const paused=await player.inputValue();await page.waitForTimeout(720);expect(await player.inputValue()).toBe(paused);
 await player.focus();await page.keyboard.press('Home');await expect(player).toHaveValue('0');
 await dialog.getByRole('button',{name:'Last candle'}).click();await expect(chart).toHaveAttribute('aria-label',/exit .*marked/);
 await dialog.getByText('Chart controls & indicators',{exact:true}).click();
 await dialog.locator('.journal-trade-canvas-wrap').screenshot({path:dir+'/entry-exit-markers.png'});
 await dialog.getByRole('button',{name:'Focus entry',exact:true}).click();await dialog.getByRole('button',{name:'Focus exit',exact:true}).click();await dialog.getByRole('button',{name:'Fit trade',exact:true}).click();
 await dialog.getByLabel('Indicators',{exact:true}).uncheck();await expect(dialog.locator('.journal-indicator-legend')).toHaveCount(0);await dialog.getByLabel('Indicators',{exact:true}).check();
 await dialog.getByText('Chart controls & indicators',{exact:true}).click();await dialog.getByText('Automatic strategy review',{exact:true}).click();await dialog.evaluate(n=>n.scrollTop=0);await page.screenshot({path:dir+'/trade-desktop.png'});await dialog.getByText('Chart controls & indicators',{exact:true}).click();await dialog.getByText('Automatic strategy review',{exact:true}).click();const original=await chart.screenshot();await dialog.getByRole('button',{name:'Zoom trade chart in'}).click();expect((await chart.screenshot()).equals(original)).toBe(false);await dialog.getByRole('button',{name:'Fit trade',exact:true}).click();
 await dialog.getByRole('button',{name:'5m',exact:true}).click();await expect(chart).toHaveAttribute('aria-label',/AMD 5m/);await expect(chart.locator('canvas')).toBeVisible();await dialog.getByRole('button',{name:'15m',exact:true}).click();await expect(chart).toHaveAttribute('aria-label',/AMD 15m/);await expect(dialog.locator('.journal-auto-checks [data-result=met]')).toHaveCount(6);
 await dialog.locator('.journal-trade-canvas-wrap').screenshot({path:dir+'/same-candle-markers.png'});await dialog.getByRole('region',{name:'Automatic strategy review'}).screenshot({path:dir+'/automatic-review.png'});
 await dialog.getByRole('button',{name:'Strategy notes',exact:true}).click();await expect(chart.locator('canvas')).toBeVisible();await expect(dialog.getByLabel('Review notes')).toBeVisible();await dialog.getByRole('button',{name:'Edit execution details',exact:true}).click();await expect(dialog.getByLabel('Entry time · Skopje · 24h')).toHaveValue('16:19:54');await expect(chart).toHaveCount(0);await dialog.getByRole('button',{name:'Return to replay',exact:true}).click();await expect(chart.locator('canvas')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'AMD 530 Call',exact:true})).toBeFocused();expect((await read()).revision).toBe(before.revision);
 mark('Saved trade opens its dated 2m underlying chart with exact entry/exit markers and separate option premiums; zoom, fit, intervals, details and focus return work without workspace writes');
 mode='gap';await page.getByRole('button',{name:'AMD 530 Call',exact:true}).click();await expect(dialog.getByText(/Entry time has no covering source candle/)).toBeVisible();await expect(chart).toHaveAttribute('aria-label',/entry .*has no covering candle.*exit .*marked/);await dialog.getByText('Automatic strategy review',{exact:true}).click();await expect(dialog.locator('.journal-auto-review')).toBeVisible();await dialog.screenshot({path:dir+'/missing-candle.png'});
 mode='stale';await dialog.getByRole('button',{name:'Refresh history',exact:true}).click();await expect(dialog.getByText('Cached reading · source refresh unavailable.',{exact:true})).toBeVisible();mode='unavailable';await dialog.getByRole('button',{name:'15m',exact:true}).click();await expect(dialog.getByText('Historical chart unavailable',{exact:true})).toBeVisible();await expect(chart).toHaveCount(0);await expect(dialog.locator('.review-metrics')).toContainText('$2.42');await page.keyboard.press('Escape');
 mark('Missing candles withhold only their own markers; stale history is labeled; another interval never reuses the previous chart during an outage');
 mode='ok';
 const qqqRow=page.locator('.jt-results tr').filter({has:page.getByRole('button',{name:'QQQ 714 Call',exact:true})});
 await qqqRow.getByRole('button',{name:'Notes',exact:true}).click();
 const evidence=dialog.getByRole('region',{name:'Automatic strategy review'}),detailTab=dialog.getByRole('button',{name:'Details & notes',exact:true});
 await expect(detailTab).toHaveAttribute('aria-pressed','true');
 await expect(evidence.locator('[data-result=unknown]')).toHaveCount(4);
 await expect(evidence.getByText(/No stock\/ETF zones for QQQ/)).toHaveCount(1);
 await expect(evidence).toContainText('2 of 6 evaluated');
 await expect(chart).toHaveCount(0);
 await dialog.getByLabel('Review notes').fill('Waited for the next close.');
 await dialog.getByLabel('Separate retest held the broken zone').selectOption('true');
 await expect(evidence.locator('[data-rule=retest]')).toHaveAttribute('data-result','unknown');
 await dialog.getByRole('button',{name:'Replay',exact:true}).click();
 await expect(chart.locator('canvas')).toBeVisible();
 await detailTab.click();
 await dialog.getByRole('button',{name:'Edit execution details',exact:true}).click();
 await dialog.getByRole('button',{name:'Return to details & notes',exact:true}).click();
 await expect(detailTab).toHaveAttribute('aria-pressed','true');
 await expect(dialog.getByLabel('Separate retest held the broken zone')).toHaveValue('true');
 await expect(dialog.getByLabel('Review notes')).toHaveValue('Waited for the next close.');
 mode='stale';await evidence.getByRole('button',{name:'Recheck strategy'}).click();
 await expect(evidence.getByText('Cached history',{exact:true})).toBeVisible();
 mode='unavailable';await evidence.getByRole('button',{name:'Recheck strategy'}).click();
 await expect(evidence.locator('[data-result=unknown]')).toHaveCount(6);
 await expect(evidence.getByText(/Historical 2m candles are unavailable/)).toHaveCount(1);
 await expect(dialog.locator('.review-fills tbody tr')).toHaveCount(2);
 page.once('dialog',prompt=>prompt.accept());await dialog.getByRole('button',{name:'Close trade dialog'}).click();
 expect((await read()).revision).toBe(before.revision);
 mark('Notes opens the entry evidence directly. Unknown rules share their source explanation, manual grades and draft notes survive view changes, and refresh handles cached and unavailable history without a workspace write');
 mode='ok';for(const width of [320,390,820]){
  const mobile=await browser.newPage({viewport:{width,height:900},hasTouch:true,isMobile:true});await setup(mobile);await mobile.goto(runtime.url+'/#journal');await mobile.getByRole('button',{name:'QQQ 714 Call',exact:true}).tap();const md=mobile.getByRole('dialog'),canvas=md.locator('.journal-trade-canvas');await expect(canvas.locator('canvas')).toBeVisible();expect(await md.evaluate(n=>n.scrollWidth-n.clientWidth)).toBeLessThanOrEqual(1);await expect(canvas).toHaveCSS('touch-action','pan-y');await md.getByText('Chart controls & indicators',{exact:true}).tap();await md.getByRole('button',{name:'Interact',exact:true}).tap();await expect(canvas).toHaveCSS('touch-action','none');await md.getByRole('button',{name:'Done interacting',exact:true}).tap();await expect(canvas).toHaveCSS('touch-action','pan-y');await md.locator('.journal-trade-canvas-wrap').screenshot({path:`${dir}/markers-${width}.png`});await md.getByText('Automatic strategy review',{exact:true}).tap();await expect(md.locator('.journal-auto-checks')).toBeVisible();await md.locator('.journal-auto-review').screenshot({path:`${dir}/review-${width}.png`});await md.getByText('Automatic strategy review',{exact:true}).tap();await md.getByText('Chart controls & indicators',{exact:true}).tap();await md.evaluate(n=>n.scrollTop=0);await md.screenshot({path:`${dir}/trade-${width}.png`});await md.evaluate(n=>n.scrollTop=n.scrollHeight);await expect(md.getByRole('button',{name:'Close trade dialog'})).toBeInViewport();await mobile.close();
 }
 mark('Phone/tablet layouts fit from 320px, keep close controls reachable, and allow page scrolling until chart interaction is explicitly enabled');
 expect((await read()).data).toEqual(before.data);
 await page.getByRole('button',{name:'AMD 520 Call',exact:true}).click();
 await expect(dialog.locator('.review-fills tbody tr')).toHaveCount(1);
 await expect(dialog.locator('.review-fills')).toContainText('Sell to open');
 await expect(dialog.locator('.review-metrics')).toContainText('$2.3401');
 await expect(dialog.locator('.review-metrics')).toContainText('Open');
 await dialog.getByLabel('Review notes').fill('Retest reviewed.');
 page.once('dialog',prompt=>prompt.dismiss());await page.keyboard.press('Escape');
 await expect(dialog.getByLabel('Review notes')).toHaveValue('Retest reviewed.');
 await dialog.getByRole('button',{name:'Save trade'}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect.poll(async()=>(await read()).data.journal.trades.find(t=>t.id==='open').notes).toBe('Retest reviewed.');
 const updated=(await read()).data.journal.trades.find(t=>t.id==='open');
 expect(updated).toEqual({...before.data.journal.trades.find(t=>t.id==='open'),notes:'Retest reviewed.'});
 mark('An open short shows only its saved entry, preserves four-decimal premiums and subsecond fills, and asks before discarding edited notes');
 expect(errors).toEqual([]);writeFileSync(dir+'/checks.json',JSON.stringify({result:'passed',checks,errors},null,2)+'\n');
}finally{await browser.close();await runtime.close();}
