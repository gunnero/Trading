import {chromium,expect} from '@playwright/test';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {testRuntime} from './qa-runtime.mjs';
import {testFetch} from '../tests/fixtures/auth.mjs';
import {mockMarket} from '../tests/fixtures/market.mjs';
import {mockBriefing} from '../tests/fixtures/briefing.mjs';

const runtime=await testRuntime(),dir='docs/qa/portfolio';mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/home/gunner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',env:{...process.env,LD_LIBRARY_PATH:'/home/gunner/.cache/mediahub/browser-libs/root/usr/lib/x86_64-linux-gnu'}});
const checks=[],errors=[],mark=message=>{checks.push(message);console.log('PASS '+message);};
const snapshot={version:1,currency:'USD',sourceLabel:'Isolated screenshot fixture',accountValue:1100,investmentsValue:1000,cash:100,cost:900,unrealized:100,totalReturn:150,holdings:[{ticker:'TEST',name:'Fixture Company',quantity:2.12345678,averagePrice:450,price:500,value:1000,cost:900,unrealized:100}],note:'Source date unknown. This is test data.'};
try{
 const page=await browser.newPage({viewport:{width:1488,height:1000},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));await mockMarket(page);await mockBriefing(page);
 const paths=[];page.on('request',r=>paths.push(new URL(r.url()).pathname));
 const read=async()=>await(await testFetch(runtime.url+'/api/portfolio')).json(),workspace=async()=>await(await testFetch(runtime.url+'/api/workspace')).json(),before=await workspace();
 await page.goto(runtime.url+'/#portfolio');await expect(page.getByRole('heading',{name:'Portfolio Manager',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Start with a person'})).toBeVisible();
 expect(paths.some(p=>p.startsWith('/api/market/'))).toBe(false);expect((await workspace()).revision).toBe(before.revision);
 const addPerson=async name=>{await page.getByRole('button',{name:'Add person',exact:true}).click();await page.getByLabel('Full name').fill(name);await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);};
 await addPerson('Alex Fixture');await addPerson('Sam Fixture');
 await page.getByRole('button',{name:'Add account',exact:true}).click();await page.getByLabel('Account label',{exact:true}).fill('Main account');await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.getByRole('heading',{name:'Ready to connect'})).toBeVisible();
 await page.getByRole('button',{name:'Import snapshot',exact:true}).click();await page.getByLabel('Snapshot file').setInputFiles({name:'fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(snapshot))});await expect(page.locator('.pm-import-preview')).toContainText('$1,100.00 · 1 holdings');
 expect((await read()).data.accounts[0].snapshot).toBe(null);await page.getByRole('button',{name:'Save snapshot',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.pm-table')).toContainText('2.12345678');await expect(page.locator('.pm-source')).toContainText('Source date unknown');
 mark('Direct route has no market polling or workspace writes; people/accounts save and import requires review, preserving fractional shares and unknown dates');
 await page.getByRole('button',{name:'Add account',exact:true}).click();await page.getByLabel('Person',{exact:true}).selectOption({label:'Sam Fixture'});await page.getByLabel('Account label',{exact:true}).fill('Unconnected');await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.pm-overview')).toContainText('1 account without a value');await expect(page.locator('.pm-overview-value')).toContainText('$1,100.00');
 await page.getByRole('button',{name:/Alex Fixture Trading 212/}).click();await page.getByLabel('Search holdings').fill('missing');await expect(page.getByText('No matching holdings.')).toBeVisible();await page.getByLabel('Search holdings').fill('');
 const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Export snapshot',exact:true}).click();const downloaded=await downloading;const exported=JSON.parse(readFileSync(await downloaded.path(),'utf8'));expect(exported.holdings[0].quantity).toBe(2.12345678);expect(exported.apiKey).toBeUndefined();
 await page.reload();await expect(page.locator('.pm-table')).toContainText('Fixture Company');const saved=await read();await runtime.stop();await runtime.start();await page.reload();await expect(page.locator('.pm-table')).toContainText('Fixture Company');expect(await read()).toEqual(saved);
 mark('Separate people/accounts, missing-data totals, holdings search, credential-free snapshot export and actual server-restart persistence pass');
 await page.getByRole('button',{name:'Connect account',exact:true}).click();await expect(page.getByText(/account owner authorized this connection/)).toBeVisible();await page.getByLabel('API key',{exact:true}).fill('fixture-unsaved-key');await page.getByLabel('API secret',{exact:true}).fill('fixture-unsaved-secret');await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:'Connect account',exact:true}).click();await expect(page.getByLabel('API key',{exact:true})).toHaveValue('');
 let submitted;await page.route('**/api/portfolio/accounts/*/connect',async route=>{submitted=route.request().postDataJSON();await route.fulfill({status:502,json:{message:'Isolated broker unavailable'}});});
 await page.getByLabel('API key',{exact:true}).fill('fixture-key-12345');await page.getByLabel('API secret',{exact:true}).fill('fixture-secret-67890');await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Connect & read account'}).click();await expect(page.getByRole('alert')).toContainText('Isolated broker unavailable');expect(submitted.authorized).toBe(true);expect(submitted.environment).toBe('live');await page.getByRole('button',{name:'Cancel',exact:true}).click();expect((await read()).data.accounts[0].snapshot.accountValue).toBe(1100);
 mark('Connection form requires owner permission, clears unsaved secrets on close, and preserves snapshots when connection fails');
 await page.getByRole('button',{name:'Edit account',exact:true}).click();await page.getByLabel('Account label',{exact:true}).fill('Renamed account');
 const prior=await read();await testFetch(runtime.url+'/api/portfolio/people',{method:'POST',headers:{'content-type':'application/json','x-opening-bell-client':'web'},body:JSON.stringify({revision:prior.revision,name:'Concurrent Fixture'})});
 await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.getByRole('alert')).toContainText('changed');await expect(page.getByLabel('Account label',{exact:true})).toHaveValue('Renamed account');await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.pm-detail-header')).toContainText('Renamed account');
 mark('Concurrent edits are rejected, unsaved form values survive, and retry uses the current revision');
 for(const width of [320,390,820,1024,1488]){
  await page.setViewportSize({width,height:1000});await expect(page.locator('.pm-detail')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({path:`${dir}/portfolio-${width}.png`,fullPage:true});
  await page.getByRole('button',{name:'Connect account',exact:true}).click();expect(await page.getByRole('dialog').evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);await page.getByRole('button',{name:'Cancel',exact:true}).click();
  if(width===390){await page.getByRole('button',{name:'More navigation'}).click();const nav=page.getByRole('navigation',{name:'Main navigation'});await expect(nav.getByRole('button',{name:'Portfolio Manager'})).toBeVisible();await nav.getByRole('button',{name:'Portfolio Manager'}).click();await expect(page.locator('.sidebar')).not.toHaveClass(/is-open/);}
 }
 mark('Portfolio page and connection dialog fit 320/390/820/1024/1488px; mobile navigation opens Portfolio Manager');
 await page.getByRole('button',{name:/Sam Fixture Trading 212/}).click();await page.getByRole('button',{name:'Edit account',exact:true}).click();await page.getByRole('button',{name:'Remove account',exact:true}).click();expect((await read()).data.accounts.length).toBe(2);await page.getByRole('button',{name:'Confirm remove'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect((await read()).data.accounts.length).toBe(1);
 const personFilter=page.locator('.pm-people').getByRole('button',{name:'Sam Fixture'});await personFilter.click();await page.getByRole('button',{name:'Edit person',exact:true}).click();await page.getByRole('button',{name:'Remove person',exact:true}).click();await page.getByRole('button',{name:'Confirm remove'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect((await read()).data.people.some(p=>p.name==='Sam Fixture')).toBe(false);
 mark('Account and person removal require explicit confirmation and preserve unrelated accounts');
 expect((await fetch(runtime.url+'/api/portfolio')).status).toBe(401);
 expect((await fetch(runtime.url+'/api/portfolio/accounts/any/connect',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status).toBe(401);
 expect((await testFetch(runtime.url+'/api/portfolio/people',{method:'POST',headers:{'content-type':'application/json','x-opening-bell-client':'web','x-csrf-token':'wrong'},body:'{}'})).status).toBe(403);
 for(const path of ['/portfolio.sqlite','/.data/portfolio.sqlite','/server/portfolio.mjs'])expect((await fetch(runtime.url+path)).status).toBe(404);
 expect((await workspace()).revision).toBe(before.revision);expect(errors).toEqual([]);
 mark('Owner login, CSRF and private-file gates pass; no general workspace mutations or browser errors');
 writeFileSync(dir+'/checks.json',JSON.stringify({result:'passed',checks,errors},null,2)+'\n');
}finally{await browser.close();await runtime.close();}
