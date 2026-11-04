import {chromium,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {testRuntime} from './qa-runtime.mjs';
import {testFetch} from '../tests/fixtures/auth.mjs';
import {mockMarket} from '../tests/fixtures/market.mjs';
import {mockBriefing} from '../tests/fixtures/briefing.mjs';

const runtime=await testRuntime(),dir='docs/qa/portfolio-rebuild';mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/home/gunner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',env:{...process.env,LD_LIBRARY_PATH:'/home/gunner/.cache/mediahub/browser-libs/root/usr/lib/x86_64-linux-gnu'}});
const checks=[],errors=[],mark=s=>{checks.push(s);console.log('PASS '+s);};
try{
 const read=async path=>(await testFetch(runtime.url+path)).json();
 const change=async(path,body)=>{const state=await read('/api/portfolio');const response=await testFetch(runtime.url+'/api/portfolio'+path,{method:'POST',headers:{'content-type':'application/json','x-opening-bell-client':'web'},body:JSON.stringify({...body,revision:state.revision})});expect(response.ok).toBe(true);return response.json();};
 let root=await change('/people',{name:'History fixture'});root=await change('/accounts',{personId:root.data.people[0].id,platform:'Trading 212',label:'Primary'});
 const id=root.data.accounts[0].id,now=Date.now(),before=await read('/api/workspace');
 root=await change(`/accounts/${id}/snapshot`,{snapshot:{version:1,currency:'USD',accountValue:1200,investmentsValue:1000,cash:200,cost:900,unrealized:100,holdings:[{ticker:'AMD_US_EQ',name:'AMD',instrumentCurrency:'USD',quantity:10,price:100,value:1000,cost:900,averagePrice:90,unrealized:100}]}});
 root.data.accounts[0]={...root.data.accounts[0],connected:true,environment:'demo',snapshot:{...root.data.accounts[0].snapshot,source:'api',brokerId:'fixture',fetchedAt:new Date(now).toISOString()}};
 const page=await browser.newPage({viewport:{width:1488,height:1100},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));await mockMarket(page);await mockBriefing(page);
 await page.route('**/api/portfolio',r=>r.fulfill({json:root}));await page.route('**/api/portfolio/accounts/*/sync',r=>r.fulfill({json:root}));
 let rebuild={status:'blocked',stage:'prices',canResume:true,historyComplete:true,pages:12,records:500,priced:2,instruments:4,message:'Chart not ready: 2 instruments need a verified listing or daily prices. All imported records and completed prices are saved. See the full list below.',listingChecks:[
  {ticker:'VUAAl_EQ',name:'Vanguard S&P 500 (Acc)',currency:'USD',listing:'LSE:VUAA',status:'saved'},
  {ticker:'EQACs_EQ',name:'Invesco EQQQ Nasdaq-100 (Acc)',currency:'USD',listing:'SIX:EQAC',status:'saved'},
  {ticker:'UNKNOWN_US_EQ',name:'Unmatched fixture fund',currency:'USD',status:'unmatched'},
  {ticker:'MISSING_US_EQ',name:'Unavailable fixture stock',currency:'USD',listing:'NASDAQ:MISSING',status:'unavailable',message:'Yahoo Finance has no daily history for NASDAQ:MISSING.'}
 ]},starts=0,automatic=false,syncs=0,active=0,maxActive=0,failSync=false;
 await page.route(/\/api\/portfolio\/accounts\/[^/]+\/history(?:\/rebuild\/sync|\/rebuild|\/sync|\?.*)?$/,async route=>{
  if(new URL(route.request().url()).pathname.endsWith('/rebuild')){starts++;rebuild={...rebuild,status:'loading',stage:'listings',message:null};}
  if(automatic&&new URL(route.request().url()).pathname.endsWith('/rebuild/sync')){
   syncs++;active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>setTimeout(resolve,150));active--;
   if(failSync){await route.fulfill({status:503,json:{message:'Temporary pricing outage'}});return;}
   const priced=Math.min(rebuild.instruments,rebuild.priced+2);
   rebuild={...rebuild,priced,status:priced===rebuild.instruments?'ready':'loading',retryAt:priced===rebuild.instruments?null:Date.now()+1000};
  }
  await route.fulfill({json:{rebuild,accountReturn:{amount:200,ratePercent:20,netDeposits:1000,valuePoints:[{at:now-86400000,value:1190},{at:now,value:1200}],valuationTrackingFrom:now-86400000,recordedFrom:now-86400000,to:now}}});
 });
 await page.goto(runtime.url+'/#portfolio');const panel=page.getByRole('region',{name:'Account summary'}),detail=panel.locator('.pm-history-explainer').first();
 await expect(detail).toContainText('Transactions saved; older chart not ready.');await expect(detail).toContainText('2 of 4 instruments priced');await expect(detail.locator('.pm-listing-checks li')).toHaveCount(4);
 await expect(detail).toContainText('Prices saved · SIX:EQAC');await expect(detail).toContainText('No exact listing verified');await expect(detail).toContainText('Yahoo Finance has no daily history');
 await expect(panel.getByRole('img',{name:'Account value history'})).toBeVisible();mark('Saved transactions are distinct from chart readiness; every unresolved instrument and saved listing is visible together');
 for(const width of [320,1488]){await page.setViewportSize({width,height:1100});await detail.scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);await detail.screenshot({path:`${dir}/listings-${width}.png`});}
 await page.reload();await expect(detail).toContainText('2 of 4 instruments priced');await expect(detail.locator('.pm-listing-checks li')).toHaveCount(4);
 await detail.getByRole('button',{name:'Retry using saved history',exact:true}).click();await expect(detail).toContainText('Matching historical instruments with Trading 212');expect(starts).toBe(1);await expect(detail).toContainText('12 pages saved');
 rebuild={...rebuild,status:'loading',stage:'prices',listingChecks:rebuild.listingChecks.map(i=>i.status==='saved'?i:{...i,status:'pending',listing:'NASDAQ:'+i.ticker.split('_')[0]})};
 await panel.getByRole('button',{name:'Refresh portfolio history'}).click();await expect(detail).toContainText('The older chart is still being built');await detail.getByText('Historical instruments · 2 / 4 ready',{exact:true}).click();await expect(detail).toContainText('Waiting for prices · NASDAQ:UNKNOWN');
 rebuild={...rebuild,status:'ready',priced:4,listingChecks:rebuild.listingChecks.map(i=>({...i,status:'saved'}))};await panel.getByRole('button',{name:'Refresh portfolio history'}).click();await expect(detail.getByText('Reconstructed history is available. Estimated points are identified on the chart.')).toBeAttached();
 expect(starts).toBe(1);expect(await read('/api/workspace')).toEqual(before);expect(errors).toEqual([]);mark('Progress survives reload; one retry retains saved records, advances through matching and prices, and reports ready only on completion');
 automatic=true;rebuild={...rebuild,status:'loading',stage:'prices',priced:5,instruments:24,retryAt:Date.now()+1000,listingChecks:[]};
 const started=Date.now();await page.reload();await expect(detail).toContainText('5 of 24 instruments priced');await expect(detail).toContainText('Prices continue automatically as each batch finishes');
 await expect.poll(()=>rebuild.status,{timeout:20000}).toBe('ready');await expect(detail).toContainText('24 of 24 instruments priced');
 expect(syncs).toBe(10);expect(maxActive).toBe(1);expect(starts).toBe(1);expect(Date.now()-started).toBeLessThan(20000);mark('5 of 24 prices reaches completion automatically in under 20 seconds with no overlapping batches or new import');
 rebuild={...rebuild,status:'paused',priced:5,retryAt:Date.now()+10000};const savedSyncs=syncs;await page.reload();await expect(detail).toContainText('Import paused');await page.waitForTimeout(2200);expect(syncs).toBe(savedSyncs);mark('Reload respects a saved provider retry deadline without issuing another sync');
 rebuild={...rebuild,status:'loading',retryAt:Date.now()-1};failSync=true;await panel.getByRole('button',{name:'Refresh portfolio history'}).click();await expect(panel).toContainText('Temporary pricing outage');const failedSyncs=syncs;await page.waitForTimeout(2200);expect(syncs).toBe(failedSyncs);mark('Network/service failures back off instead of creating a rapid retry loop');
 failSync=false;await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 await page.waitForTimeout(1500);expect(syncs).toBe(failedSyncs);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});await expect.poll(()=>syncs).toBeGreaterThan(failedSyncs);await page.goto(runtime.url+'/#overview');const stoppedSyncs=syncs;await page.waitForTimeout(2200);expect(syncs).toBe(stoppedSyncs);expect(errors).toEqual([]);mark('Hidden pages pause work; visibility resumes it and leaving the portfolio stops its timer');
 writeFileSync(dir+'/checks.json',JSON.stringify({result:'passed',checks,errors,productionMutations:false},null,2)+'\n');
}finally{await browser.close();await runtime.close();}
