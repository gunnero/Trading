import {chromium,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {testRuntime} from './qa-runtime.mjs';
import {testFetch} from '../tests/fixtures/auth.mjs';
import {mockMarket,indicatorFixture,priceHistoryFixture} from '../tests/fixtures/market.mjs';
import {mockBriefing} from '../tests/fixtures/briefing.mjs';

const runtime=await testRuntime(),dir='docs/qa/portfolio-details';mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/home/gunner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',env:{...process.env,LD_LIBRARY_PATH:'/home/gunner/.cache/mediahub/browser-libs/root/usr/lib/x86_64-linux-gnu'}});
const checks=[],errors=[],mark=s=>{checks.push(s);console.log('PASS '+s);};
const read=async()=>await(await testFetch(runtime.url+'/api/portfolio')).json();
const workspace=async()=>await(await testFetch(runtime.url+'/api/workspace')).json();
async function change(path,body){const state=await read();const res=await testFetch(runtime.url+'/api/portfolio'+path,{method:'POST',headers:{'content-type':'application/json','x-opening-bell-client':'web'},body:JSON.stringify({revision:state.revision,...body})});expect(res.ok).toBe(true);return res.json();}
const amd={ticker:'AMD_US_EQ',name:'AMD fixture holding',isin:'US0079031078',quantity:4,instrumentCurrency:'USD',averagePrice:450,price:500,value:2000,cost:1800,unrealized:200};
const meta={...amd,ticker:'FB_US_EQ',name:'Meta fixture holding',isin:'US30303M1027',quantity:2,averagePrice:90,price:100,value:1000,cost:900,unrealized:100};
const unknown={...amd,ticker:'UNKNOWN_US_EQ',name:'Unmapped fixture',isin:'',instrumentCurrency:'EUR',value:null,unrealized:null,cost:null};
const snapshot={version:1,currency:'USD',accountValue:3100,investmentsValue:3000,cash:100,cost:2700,unrealized:300,realized:50,sourceLabel:'Isolated broker-shaped fixture',holdings:[amd,meta,unknown]};
try{
 let data=await change('/people',{name:'Alex Fixture'});const person=data.data.people[0];
 data=await change('/accounts',{personId:person.id,platform:'Trading 212',label:'First account'});const first=data.data.accounts[0];
 await change(`/accounts/${first.id}/snapshot`,{snapshot});
 data=await change('/accounts',{personId:person.id,platform:'Trading 212',label:'Second account'});const second=data.data.accounts[1];
 await change(`/accounts/${second.id}/snapshot`,{snapshot:{...snapshot,holdings:[{...amd,averagePrice:510}]}});
 const before=await workspace(),page=await browser.newPage({viewport:{width:1488,height:1100},reducedMotion:'reduce'});
 page.on('pageerror',e=>errors.push(e.message));await mockMarket(page);await mockBriefing(page);
 let quoteCurrency='USD',priceMode='normal',priceDelay=null;const marketPaths=[];page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/market/'))marketPaths.push(r.url());});
 await page.route('**/api/market/price-history?*',async route=>{if(priceDelay)await priceDelay;const u=new URL(route.request().url()),body=priceHistoryFixture(u.searchParams.get('symbol'),u.searchParams.get('range'));body.quote.currency=quoteCurrency;if(priceMode==='wrong')body.symbol='NASDAQ:QQQ';return route.fulfill({json:body});});
 await page.route('**/api/market/chart?*',route=>{const u=new URL(route.request().url()),body=indicatorFixture(u.searchParams.get('symbol'),u.searchParams.get('interval'));body.quote.currency=quoteCurrency;return route.fulfill({json:body});});
 await page.goto(runtime.url+'/#portfolio');await expect(page.locator('.pm-account-value')).toContainText('$3,100.00');await page.getByText('Return details',{exact:true}).click();await expect(page.locator('.pm-return-breakdown')).toContainText('+11.11%');await expect(page.locator('.pm-return-breakdown')).toContainText('$50.00');await page.getByText('Return details',{exact:true}).click();await expect(page.locator('.pm-overview-return')).toContainText('$600.00 (+11.11%)');expect(marketPaths).toEqual([]);
 await page.screenshot({path:dir+'/returns-desktop.png',fullPage:true});mark('One account value summary with collapsed return details renders without background stock-chart requests');
 const open=page.getByRole('button',{name:'View AMD fixture holding holding details'}),dialog=page.getByRole('dialog');
 const chooseChart=async(name)=>{const details=dialog.locator('.company-position > details');if(!await details.evaluate(e=>e.open))await details.locator('summary').click();await dialog.getByRole('button',{name,exact:true}).click();};
 await page.locator('.pm-table tr').filter({has:open}).getByText('$2,000.00',{exact:true}).click();await expect(dialog).toBeVisible();await page.keyboard.press('Escape');await expect(open).toBeFocused();await page.keyboard.press('Enter');await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('img',{name:/AMD Yahoo Finance 4h/})).toBeVisible();await expect(dialog.locator('.company-position-strip')).toContainText('4 shares');await chooseChart('Price history');await expect(dialog.getByRole('img',{name:'AMD share price history'})).toBeVisible();await expect(dialog.locator('.company-chart')).toHaveCount(0);await expect(dialog.locator('[data-average-line]')).toContainText('$450.00');
 let releasePrice;priceDelay=new Promise(r=>releasePrice=r);await dialog.getByRole('button',{name:'1W',exact:true}).click();await expect(dialog.getByRole('img',{name:'AMD share price history'})).toHaveCount(0);await expect(dialog.locator('.pm-stock-chart')).toContainText('Loading stock price');releasePrice();priceDelay=null;await expect(dialog.getByRole('img',{name:'AMD share price history'})).toBeVisible();
 priceMode='wrong';await dialog.getByRole('button',{name:'1M',exact:true}).click();await expect(dialog.locator('.pm-stock-chart')).toContainText('temporarily unavailable');await expect(dialog.getByRole('img',{name:'AMD share price history'})).toHaveCount(0);await expect(dialog.locator('.pm-position')).toContainText('$2,000.00');priceMode='normal';
 for(const range of ['1W','1M','3M','1Y','MAX']){await dialog.getByRole('button',{name:range,exact:true}).click();await expect(dialog.getByRole('img',{name:'AMD share price history'})).toBeVisible();}
 for(const width of [320,390,820,1488]){await page.setViewportSize({width,height:1100});await dialog.evaluate(el=>el.scrollTop=0);expect(await dialog.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);await dialog.screenshot({path:`${dir}/stock-simple-${width}.png`});await dialog.locator('.pm-position').screenshot({path:`${dir}/investment-${width}.png`});}
 await dialog.getByRole('checkbox',{name:'Average price',exact:true}).uncheck();await expect(dialog.locator('[data-average-line]')).toHaveCount(0);await dialog.getByRole('checkbox',{name:'Average price',exact:true}).check();
 await chooseChart('Candles & levels');
 const chart=dialog.getByRole('img',{name:/AMD Yahoo Finance 4h/});await expect(chart).toBeVisible();await expect(chart).toHaveAttribute('aria-label',/Average paid reference 450 USD/);await expect(dialog.locator('.pm-position')).toContainText('First account');await expect(dialog.locator('.pm-position')).toContainText('$450.00');await expect(dialog.getByLabel('All AMD levels',{exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Levels',exact:true}).click();await expect(dialog.getByRole('region',{name:'Chart levels settings'})).toContainText('Your levels');await expect(chart).toHaveAttribute('aria-label',/imported reference levels/);
 await dialog.locator('.company-chart').screenshot({path:dir+'/average-levels-desktop.png'});
 await page.evaluate(()=>{const key='opening-bell.portfolio-view.v1',p=JSON.parse(localStorage.getItem(key));localStorage.setItem(key,JSON.stringify({...p,hideNames:true,hideBalances:true}));dispatchEvent(new StorageEvent('storage',{key}));});
 await expect(dialog.locator('.pm-position')).toContainText('Alex Fixture');await expect(dialog.locator('.pm-position')).toContainText('$2,000.00');await expect(chart).toHaveAttribute('aria-label',/Average paid reference 450 USD/);await expect(dialog.getByRole('img',{name:'AMD share price history'})).toHaveCount(0);
 // Switching selection from another tab must mask this now-inactive account,
 // including references in both visible SVGs and accessible chart descriptions.
 await page.evaluate(account=>{const key='opening-bell.portfolio-view.v1',p=JSON.parse(localStorage.getItem(key));localStorage.setItem(key,JSON.stringify({...p,account}));dispatchEvent(new StorageEvent('storage',{key}));},second.id);
 await expect(dialog.locator('.pm-position')).not.toContainText('First account');await expect(dialog.locator('.pm-position')).not.toContainText('$2,000.00');await expect(dialog.locator('[data-average-line]')).toHaveCount(0);await expect(chart).not.toHaveAttribute('aria-label',/Average paid reference/);await expect(dialog.getByRole('checkbox',{name:/Average paid/})).toBeDisabled();await expect(dialog.getByRole('img',{name:'AMD share price history'})).toHaveCount(0);
 await page.evaluate(account=>{const key='opening-bell.portfolio-view.v1',p=JSON.parse(localStorage.getItem(key));localStorage.setItem(key,JSON.stringify({...p,account,hideNames:false,hideBalances:false}));dispatchEvent(new StorageEvent('storage',{key}));},first.id);
 await expect(chart).toHaveAttribute('aria-label',/Average paid reference 450 USD/);
 mark('Privacy keeps the selected holding and average-price overlays visible, and masks an inactive holding in an already-open dialog after selection changes');
 // Reopen from the current holdings row after the cross-tab selection replaced it.
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await open.click();await chooseChart('Candles & levels');await expect(chart).toBeVisible();

 await dialog.getByRole('checkbox',{name:/Average paid/}).uncheck();await expect(chart).not.toHaveAttribute('aria-label',/Average paid reference/);await dialog.getByRole('checkbox',{name:/Average paid/}).check();
 await dialog.getByRole('tab',{name:'Financials',exact:true}).click();await expect(dialog.locator('.company-financials')).toBeVisible();await dialog.getByRole('tab',{name:'News',exact:true}).click();await expect(dialog.getByRole('heading',{name:'AMD headlines'})).toBeVisible();await dialog.getByRole('tab',{name:'Overview',exact:true}).click();
 for(const width of [320,390,820,1488]){await page.setViewportSize({width,height:1000});await dialog.evaluate(el=>el.scrollTop=0);expect(await dialog.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);await dialog.screenshot({path:`${dir}/holding-${width}.png`});}
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(open).toBeFocused();mark('Keyboard holding detail, average line with imported levels, toggle, Financials/News, focus return and responsive dialog pass');
 await page.getByRole('button',{name:/Alex Fixture Trading 212 · Second account/}).click();await open.click();await chooseChart('Candles & levels');await expect(dialog.getByRole('img',{name:/AMD Yahoo Finance/})).toHaveAttribute('aria-label',/Average paid reference 510 USD/);await page.keyboard.press('Escape');
 await page.getByRole('button',{name:/Alex Fixture Trading 212 · First account/}).click();await page.getByRole('button',{name:'View Meta fixture holding holding details'}).click();await chooseChart('Candles & levels');await expect(dialog.getByRole('img',{name:/META Yahoo Finance/})).toHaveAttribute('aria-label',/Average paid reference 90 USD/);await expect(dialog).toContainText('FB_US_EQ');await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'View Unmapped fixture holding details'}).click();await expect(dialog.getByRole('heading',{name:'Choose a chart listing'})).toBeVisible();await expect(dialog.locator('.price-chart')).toHaveCount(0);await dialog.getByLabel('Holding chart listing').selectOption('NASDAQ:AMD');await chooseChart('Candles & levels');await expect(dialog.getByRole('img',{name:/AMD Yahoo Finance/})).not.toHaveAttribute('aria-label',/Average paid reference/);await expect(dialog.getByRole('checkbox',{name:/Average paid/})).toBeDisabled();await page.keyboard.press('Escape');
 quoteCurrency='EUR';await open.click();await chooseChart('Price history');await expect(dialog.getByRole('checkbox',{name:'Average price',exact:true})).toBeDisabled();await chooseChart('Candles & levels');await expect(dialog.getByRole('img',{name:/AMD Yahoo Finance/})).not.toHaveAttribute('aria-label',/Average paid reference/);await expect(dialog.getByRole('checkbox',{name:/Average paid/})).toBeDisabled();await page.keyboard.press('Escape');quoteCurrency='USD';
 mark('Different accounts retain their own averages; FB maps to META; unknown listings require a choice and mismatched currencies suppress overlays');
 await open.click();await chooseChart('Candles & levels');await expect(dialog.getByRole('img',{name:/AMD Yahoo Finance/})).toHaveAttribute('aria-label',/Average paid reference 450 USD/);
 await change(`/accounts/${first.id}/snapshot`,{snapshot:{...snapshot,holdings:[{...amd,averagePrice:460},meta,unknown]}});await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await expect(dialog.getByRole('img',{name:/AMD Yahoo Finance/})).toHaveAttribute('aria-label',/Average paid reference 460 USD/);
 await change(`/accounts/${first.id}/snapshot`,{snapshot:{...snapshot,holdings:[meta,unknown]}});await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await expect(dialog).toContainText('no longer in the latest account snapshot');await expect(dialog.locator('.price-chart')).toHaveCount(0);await page.keyboard.press('Escape');
 const netflix={...amd,ticker:'NFLX_US_EQ',name:'Netflix match fixture',isin:'US64110L1061',averagePrice:80};
 const nvidia={...amd,ticker:'NVDA_US_EQ',name:'Nvidia watchlist fixture',isin:'',averagePrice:90};
 const qqq={...amd,ticker:'QQQ_US_EQ',name:'QQQ fund fixture',isin:'US46090E1038',averagePrice:500};
 await change(`/accounts/${first.id}/snapshot`,{snapshot:{...snapshot,holdings:[netflix,nvidia,qqq,unknown]}});await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 for(const [holding,symbol,average] of [[netflix,'NFLX',80],[nvidia,'NVDA',90],[qqq,'QQQ',500]]){
   await page.getByRole('button',{name:`View ${holding.name} holding details`}).click();await chooseChart('Candles & levels');await expect(dialog.getByLabel('Holding chart listing')).toHaveCount(0);await expect(dialog.locator('.pm-auto-listing')).toContainText(`NASDAQ:${symbol}`);
   await expect(dialog.getByRole('img',{name:new RegExp(`${symbol} Yahoo Finance`)})).toHaveAttribute('aria-label',new RegExp(`Average paid reference ${average} USD`));
   if(symbol==='NFLX')await dialog.screenshot({path:dir+'/netflix-automatic.png'});
   await page.keyboard.press('Escape');
 }
 await page.getByRole('button',{name:'View Unmapped fixture holding details'}).click();await expect(dialog.getByLabel('Holding chart listing')).toHaveValue('');await expect(dialog.locator('.price-chart')).toHaveCount(0);await expect(dialog).toContainText('QQQ is a separate ETF');await page.keyboard.press('Escape');
 mark('Netflix matches directly, Nvidia uses its exact watchlist listing, QQQ keeps its own chart, and unmatched holdings never default to QQQ');
 await expect(page.locator('.workspace-save-status')).toContainText('Workspace saved');const after=await workspace();expect(after.data.levelText).toEqual(before.data.levelText);expect(after.data.drawings).toEqual(before.data.drawings);expect(after.data.preferences).toEqual(before.data.preferences);expect(after.data.chartSettings.charts['NASDAQ:AMD|4h']).not.toHaveProperty('referenceLine');expect(errors).toEqual([]);
 mark('Holding refresh updates the average, removed holdings close the chart, and portfolio overlays never mutate levels, drawings or the selected trading instrument');
 writeFileSync(dir+'/checks.json',JSON.stringify({result:'passed',checks,errors},null,2)+'\n');
}catch(error){console.error(error);throw error;}finally{await browser.close();await runtime.close();}
