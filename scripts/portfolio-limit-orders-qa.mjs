import {chromium,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {testRuntime} from './qa-runtime.mjs';
import {testFetch} from '../tests/fixtures/auth.mjs';
import {mockMarket,indicatorFixture} from '../tests/fixtures/market.mjs';
import {mockBriefing} from '../tests/fixtures/briefing.mjs';
const runtime=await testRuntime(),dir='docs/qa/portfolio-limit-orders';mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/home/gunner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',env:{...process.env,LD_LIBRARY_PATH:'/home/gunner/.cache/mediahub/browser-libs/root/usr/lib/x86_64-linux-gnu'}});
const checks=[],errors=[],mark=s=>{checks.push(s);console.log('PASS '+s);};
const read=async()=>await(await testFetch(runtime.url+'/api/portfolio')).json();
async function change(path,body){const state=await read(),response=await testFetch(runtime.url+'/api/portfolio'+path,{method:'POST',headers:{'content-type':'application/json','x-opening-bell-client':'web'},body:JSON.stringify({revision:state.revision,...body})});expect(response.ok).toBe(true);return response.json();}
const holding={ticker:'AMD_US_EQ',name:'AMD order fixture',isin:'US0079031078',quantity:5,instrumentCurrency:'USD',averagePrice:450,price:495.6,value:2478,cost:2250,unrealized:228};
const snapshot={version:1,currency:'USD',accountValue:3478,cash:1000,sourceLabel:'Order overlay fixture',holdings:[holding]};
try{
 let saved=await change('/people',{name:'Chart Fixture'});const person=saved.data.people[0];
 saved=await change('/accounts',{personId:person.id,platform:'Trading 212',label:'First account'});const first=saved.data.accounts[0];await change(`/accounts/${first.id}/snapshot`,{snapshot});
 saved=await change('/accounts',{personId:person.id,platform:'Trading 212',label:'Second account'});const second=saved.data.accounts[1];await change(`/accounts/${second.id}/snapshot`,{snapshot});
 saved=await read();for(const account of saved.data.accounts){account.connected=true;account.snapshot.source='api';}
 const context=await browser.newContext({viewport:{width:1488,height:1100},reducedMotion:'reduce'}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await mockMarket(page);await mockBriefing(page);
 await page.route('**/api/portfolio',route=>route.fulfill({json:saved}));
 await page.route('**/api/portfolio/accounts/*/sync',route=>route.fulfill({json:saved}));
 let currency='USD';await page.route('**/api/market/chart?*',route=>{const u=new URL(route.request().url()),body=indicatorFixture(u.searchParams.get('symbol'),u.searchParams.get('interval'));body.quote.currency=currency;return route.fulfill({json:body});});
 const base={ticker:'AMD_US_EQ',type:'LIMIT',status:'NEW',quantity:2,filledQuantity:0,priceCurrency:'USD'};
 let orders=[{...base,id:101,side:'BUY',limitPrice:475.25,quantity:3.5},{...base,id:102,side:'SELL',limitPrice:510.75,status:'PARTIALLY_FILLED',filledQuantity:.5},{...base,id:103,side:'BUY',limitPrice:510.75},{...base,id:104,side:'BUY',limitPrice:999,ticker:'GOOG_US_EQ'},{...base,id:105,side:'SELL',limitPrice:998,priceCurrency:'EUR'}],readError=false,reads=0,writes=0;
 page.on('request',request=>{if(request.method()!=='GET'&&new URL(request.url()).pathname.includes('/trading/'))writes++;});
 await page.route('**/trading/chart-orders?*',route=>{reads++;const isFirst=new URL(route.request().url()).pathname.includes(first.id);return route.fulfill(readError?{status:502,json:{message:'Synthetic order read outage'}}:{json:{ticker:'AMD_US_EQ',priceCurrency:'USD',orders:isFirst?orders:[{...base,id:201,side:'SELL',limitPrice:580}],checkedAt:Date.now(),error:null,historyError:null}});});
 await page.goto(runtime.url+'/#portfolio');const open=page.getByRole('button',{name:'View AMD order fixture holding details'}),dialog=page.getByRole('dialog');await open.click();
 const panel=dialog.getByRole('region',{name:'Limit orders on chart'}),chart=dialog.getByRole('img',{name:/AMD Yahoo Finance/});
 await expect(panel).toContainText('Buy limit · $475.25');await expect(panel).toContainText('Sell limit · $510.75');await expect(panel).toContainText('1.5 shares remaining');await expect(panel).not.toContainText('#104');await expect(panel).not.toContainText('#105');
 await expect(chart).toHaveAttribute('aria-label',/BUY limit/);await expect(chart).toHaveAttribute('aria-label',/SELL limit/);await expect(chart).toHaveAttribute('aria-label',/475.25/);await expect(chart).not.toHaveAttribute('aria-label',/999|998/);
 for(const width of [1488,320]){await page.setViewportSize({width,height:1100});expect(await dialog.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);await dialog.locator('.company-chart').screenshot({path:`${dir}/limit-chart-${width}.png`});await panel.screenshot({path:`${dir}/limit-list-${width}.png`});}
 await chart.focus();await page.keyboard.press('+');const view=[await chart.getAttribute('data-view-start'),await chart.getAttribute('data-view-end')];for(let i=0;i<20;i++)await page.keyboard.press('ArrowDown');await expect(chart).toHaveAttribute('data-price-scale','manual');await dialog.getByRole('button',{name:'Fit limit orders',exact:true}).click();await expect(chart).toHaveAttribute('data-price-scale','auto');await expect(chart).toHaveAttribute('data-visible-limit-order-count','3');expect([await chart.getAttribute('data-view-start'),await chart.getAttribute('data-view-end')]).toEqual(view);
 mark('Buy/sell/partial limit orders appear at exact prices for this holding; wrong tickers/currencies are excluded and 320/1488px fit');
 await panel.getByLabel('Show limit orders').uncheck();await expect(chart).not.toHaveAttribute('aria-label',/BUY limit|SELL limit/);await expect(chart).toHaveAttribute('aria-label',/Average paid reference/);await panel.getByLabel('Show limit orders').check();
 const details=dialog.locator('.company-position > details');await details.locator('summary').click();await dialog.getByRole('button',{name:'Price history',exact:true}).click();const svg=dialog.getByRole('img',{name:/^AMD share price history/});await expect(svg).toBeVisible();await expect(dialog.locator('[data-limit-order-id]')).toHaveCount(3);await svg.screenshot({path:dir+'/limit-price-history.png'});await dialog.getByRole('button',{name:'Candles & levels',exact:true}).click();await expect(chart).toBeVisible();
 mark('Visibility toggle preserves average paid; both candlestick and price-history views show limit references');
 const poll=async()=>{const before=reads;await expect.poll(async()=>{await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));return reads;},{timeout:20000}).toBeGreaterThan(before);};
 orders=[{...base,id:101,side:'BUY',limitPrice:475.25,status:'FILLED',filledQuantity:2},{...base,id:102,side:'SELL',limitPrice:510.75,status:'CANCELLED'},{...base,id:103,side:'BUY',limitPrice:510.75,status:'REJECTED'}];await poll();await expect(panel).toContainText('No pending limit orders');await expect(chart).not.toHaveAttribute('aria-label',/BUY limit|SELL limit/);
 orders=[{...base,id:106,side:'SELL',limitPrice:520,awaitingHistory:true}];await poll();await expect(panel).toContainText('Status unconfirmed');await expect(panel).toContainText('not assumed filled or cancelled');
 readError=true;await poll();await expect(panel).toContainText('Showing last confirmed orders');await expect(chart).toHaveAttribute('aria-label',/520/);mark('Confirmed terminal orders disappear; missing status and refresh failures remain explicitly unconfirmed or last confirmed');
 await page.evaluate(account=>{const key='opening-bell.portfolio-view.v1',value=JSON.parse(localStorage.getItem(key));localStorage.setItem(key,JSON.stringify({...value,account,hideNames:true,hideBalances:true}));dispatchEvent(new StorageEvent('storage',{key}));},second.id);
 await expect(panel).toHaveCount(0);await expect(chart).not.toHaveAttribute('aria-label',/BUY limit|SELL limit|Average paid reference/);await page.keyboard.press('Escape');readError=false;
 await open.click();await expect(panel).toContainText('#201');await expect(panel).not.toContainText('#106');await expect(chart).toHaveAttribute('aria-label',/580/);await expect(chart).not.toHaveAttribute('aria-label',/520/);mark('Privacy masks both visual and accessible order references; another account gets only its own orders');
 await page.keyboard.press('Escape');currency='EUR';await open.click();await expect(panel).toContainText('#201');await expect(chart).not.toHaveAttribute('aria-label',/SELL limit/);mark('A chart quote with a different price currency never gets an order line');
 expect(writes).toBe(0);expect(errors).toEqual([]);mark('Chart reads never submit/cancel/modify orders and produce no browser errors');
 writeFileSync(dir+'/checks.json',JSON.stringify({checks,errors,brokerWrites:writes},null,2)+'\n');await context.close();
}finally{await browser.close();await runtime.close();}
