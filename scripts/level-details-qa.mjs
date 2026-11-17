import {chromium,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {testRuntime} from './qa-runtime.mjs';
import {testFetch} from '../tests/fixtures/auth.mjs';
import {mockMarket} from '../tests/fixtures/market.mjs';
import {mockBriefing} from '../tests/fixtures/briefing.mjs';
const runtime=await testRuntime(),browser=await chromium.launch({headless:true,executablePath:'/home/gunner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',env:{...process.env,LD_LIBRARY_PATH:'/home/gunner/.cache/mediahub/browser-libs/root/usr/lib/x86_64-linux-gnu'}});
const page=await browser.newPage({viewport:{width:1488,height:1100}}),errors=[],checks=[],dir='docs/qa/level-design-20261117';mkdirSync(dir,{recursive:true});
const read=async()=>await(await testFetch(runtime.url+'/api/workspace')).json();
let mode='ok';const end=Date.parse('2026-10-23T19:30Z')/1000;
try{
 const initial=await read();const data={...initial.data,levelText:initial.data.levelText.replace(/^QQQ\|.*$/m,'QQQ|30min|S 711.10-710.20|S 715.30-714.60|S 718-717|D 705.20-704|D 700-698.50|G 702.20-701.50')};
 const saved=await testFetch(runtime.url+'/api/workspace',{method:'PUT',headers:{'Content-Type':'application/json','X-Opening-Bell-Client':'web'},body:JSON.stringify({revision:initial.revision,data})});expect(saved.ok).toBe(true);const before=await read();
 await mockMarket(page);await mockBriefing(page);page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/market/level-history?*',route=>{const u=new URL(route.request().url());return route.fulfill({json:{status:mode,message:mode==='stale'?'Provider refresh unavailable':null,symbol:u.searchParams.get('symbol'),timeframe:u.searchParams.get('interval'),from:u.searchParams.get('from'),through:mode==='insufficient'?null:end,bars:mode==='insufficient'?[]:[{end:end-1800,sessionDate:'2026-10-23',closed:true,close:708},{end,sessionDate:'2026-10-23',closed:true,close:712},{end:end+1800,sessionDate:'2026-10-23',closed:false,close:690}]}});});
 await page.goto(runtime.url+'/#levels');const details=page.locator('.level-zone-details'),table=details.locator('.level-role-table'),flipped=table.locator('tbody tr').filter({hasText:'710.20–711.10'});
 await expect(table.locator('tbody tr')).toHaveCount(6);await expect(flipped).toContainText('Support (demand)');await expect(flipped.locator('.level-confirmed-close')).toHaveText('712.00');await expect(flipped).toContainText('Role changed');await expect(flipped).toContainText('30 min');await expect(flipped.locator('time')).toHaveAttribute('datetime','2026-10-23T19:30:00.000Z');await expect(flipped).toContainText('21:30');await expect(details.locator('.gap .level-nearest-chip')).toHaveText('701.50–702.20');await expect(table).toContainText('Gap (reference)');await expect(table).not.toContainText('Filled');await expect(table).not.toContainText('690.00');
 await expect(details.locator('.level-sheet-details')).not.toHaveAttribute('open','');await details.locator('summary').click();await expect(details.locator('.level-row')).toHaveCount(6);await expect(details).toContainText('Source timeframe: 30 min');await details.locator('summary').click();
 await page.evaluate(()=>document.fonts.ready);await details.screenshot({path:dir+'/details-desktop.png'});await page.screenshot({path:dir+'/page-desktop.png',fullPage:true});
 // Match the reference crop's 650px content width without shrinking text pixels.
 await page.addStyleTag({content:'.level-zone-details{max-width:650px}'});await details.screenshot({path:dir+'/details-reference-width.png'});
 checks.push('Three summaries, all role rows, closed-candle flip evidence, preserved gap role, exact source disclosure and source timeframe independent of the visible 4h chart');
 mode='stale';await page.reload();await expect(details).toContainText('Cached confirmation');await expect(flipped.locator('.level-confirmed-close')).toHaveText('712.00');
 mode='insufficient';await page.reload();await expect(flipped).toContainText('Imported supply');await expect(flipped).toContainText('History incomplete');await expect(flipped.locator('.level-confirmed-close')).toHaveText('—');
 mode='ok';
 checks.push('Cached confirmations retain dates and closes; incomplete history reverts to imported roles with no invented confirmation');
 await page.reload();await expect(flipped).toContainText('Support (demand)');
 for(const width of [1024,820,390,320]){await page.setViewportSize({width,height:1000});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);await details.screenshot({path:dir+`/details-${width}.png`});}
 const scroll=details.locator('.level-role-table-wrap');await scroll.focus();await page.keyboard.press('End');await scroll.evaluate(el=>el.scrollLeft=el.scrollWidth);expect(await scroll.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);await expect(details.locator('summary')).toBeVisible();await details.locator('summary').click();await expect(details.locator('.level-sheet-details')).toHaveAttribute('open','');
 expect(await read()).toEqual(before);expect(errors).toEqual([]);checks.push('Desktop/tablet/phone layout, keyboard-scrollable table and source disclosure work without page overflow, browser errors or passive workspace writes');
 writeFileSync(dir+'/details-checks.json',JSON.stringify({result:'passed',checks,errors},null,2));for(const check of checks)console.log('PASS '+check);
}finally{await browser.close();await runtime.close();}
