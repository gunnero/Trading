import {chromium,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {testRuntime} from './qa-runtime.mjs';
import {testFetch} from '../tests/fixtures/auth.mjs';
import {mockMarket} from '../tests/fixtures/market.mjs';
import {mockBriefing} from '../tests/fixtures/briefing.mjs';
import {screenshotFixtures} from '../tests/fixtures/journal.mjs';
import {openAuthStore} from '../server/auth.mjs';
import {parseFlexReport,mergeFills} from '../server/ibkr-flex.mjs';
import {FLEX_CONFIG,FLEX_TOKEN,report,execution} from '../tests/fixtures/ibkr-flex.mjs';

const runtime=await testRuntime(),dir='docs/qa/ibkr-journal';mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/home/gunner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',env:{...process.env,LD_LIBRARY_PATH:'/home/gunner/.cache/mediahub/browser-libs/root/usr/lib/x86_64-linux-gnu'}});
const checks=[],errors=[];const mark=s=>{checks.push(s);console.log('PASS '+s);};
try{
  const initial=await(await testFetch(runtime.url+'/api/workspace')).json();
  const data={...initial.data,journal:{version:1,trades:screenshotFixtures()}};
  expect((await testFetch(runtime.url+'/api/workspace',{method:'PUT',headers:{'Content-Type':'application/json','X-Opening-Bell-Client':'web'},body:JSON.stringify({revision:initial.revision,data})})).ok).toBe(true);
  await runtime.stop();
  const auth=openAuthStore({directory:runtime.directory});
  const fills=mergeFills([],parseFlexReport(report([execution(),execution({ibExecID:'002',ibOrderID:'101',quantity:'-3',buySell:'SELL',openCloseIndicator:'C',dateTime:'20261124;105215',tradePrice:'2.80'})]),FLEX_CONFIG).fills);
  const {token,...config}=FLEX_CONFIG;
  auth.db.prepare('UPDATE ibkr_journal SET config=?,fills=?,revision=1,result=?').run(JSON.stringify(config),JSON.stringify(fills),JSON.stringify({state:'ok',executionCount:2,tradeCount:1,lastSuccess:'2026-11-24T16:00:00.000Z'}));auth.close();await runtime.start();
  const page=await browser.newPage({viewport:{width:1488,height:1000}});page.on('pageerror',e=>errors.push(e.message));await mockMarket(page);await mockBriefing(page);
  await page.route('**/api/market/trade-history?*',r=>r.fulfill({json:{status:'unavailable',message:'No historical chart in this connection test.'}}));
  await page.goto(runtime.url+'/#journal');await expect(page.getByRole('heading',{name:'Vanquish journal',exact:true})).toBeVisible();await page.getByLabel('Journal period').selectOption('all');await expect(page.locator('.journal-trades tbody tr')).toHaveCount(3);
  await page.getByRole('button',{name:'IBKR',exact:true}).click();await expect(page.getByRole('heading',{name:'IBKR journal',exact:true})).toBeVisible();await page.getByLabel('Journal period').selectOption('all');await expect(page.locator('.journal-trades tbody tr')).toHaveCount(1);await expect(page.locator('.journal-stats')).toContainText('+$138');await expect(page.getByRole('button',{name:'Import trades',exact:true})).toHaveCount(0);
  await page.locator('.journal-trades tbody tr').getByRole('button',{name:'Notes',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog.getByRole('button',{name:'Edit execution details'})).toHaveCount(0);await dialog.getByLabel('Review notes').fill('IBKR-specific journal note');await dialog.getByRole('button',{name:'Save trade',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.getByText('IBKR notes saved.',{exact:true})).toBeVisible();
  await page.reload();await page.getByLabel('Journal period').selectOption('all');await page.locator('.journal-trades tbody tr').getByRole('button',{name:'Notes',exact:true}).click();await expect(page.getByLabel('Review notes')).toHaveValue('IBKR-specific journal note');await page.getByRole('button',{name:'Close trade dialog'}).click();
  expect((await(await testFetch(runtime.url+'/api/workspace')).json()).data).toEqual(data);
  mark('IBKR has independent totals, immutable executions and durable notes; Vanquish workspace is unchanged');
  await page.getByRole('button',{name:'Trading 212',exact:true}).click();await expect(page.getByRole('heading',{name:'Trading 212 journal',exact:true})).toBeVisible();await expect(page.locator('.bj-source')).toContainText('Trading 212 executions');await expect(page.getByText('QQQ 530 Call',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Vanquish',exact:true}).click();await page.getByLabel('Journal period').selectOption('all');await expect(page.locator('.journal-trades tbody tr')).toHaveCount(3);
  mark('Vanquish, Trading 212 and IBKR tabs stay separate across navigation');
  await page.getByRole('button',{name:'IBKR',exact:true}).click();await page.getByRole('button',{name:'IBKR connection settings',exact:true}).click();
  await expect(page.getByLabel('IBKR account ID',{exact:true})).toHaveValue(FLEX_CONFIG.accountId);
  let submitted=null;
  await page.route('**/api/settings/ibkr-journal',async route=>{if(route.request().method()==='POST'){submitted=route.request().postDataJSON();await route.fulfill({status:202,json:{configured:false,syncing:true,config}});}else await route.continue();});
  await page.getByLabel('Flex Web Service token',{exact:true}).fill(FLEX_TOKEN);await page.getByLabel('I checked that this is the timezone used in my IBKR reports.').check();await page.getByRole('button',{name:'Connect & sync',exact:true}).click();
  await expect.poll(()=>submitted?.token).toBe(FLEX_TOKEN);await expect(page.getByLabel('Flex Web Service token',{exact:true})).toHaveValue('');expect(submitted.timeZone).toBe('America/New_York');expect(await page.evaluate(t=>JSON.stringify({...localStorage}).includes(t),FLEX_TOKEN)).toBe(false);
  mark('Connection form submits explicit account/query/timezone with CSRF and clears the token without browser storage');
  for(const theme of ['light','dark'])for(const width of [320,390,820,1488]){
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.setViewportSize({width,height:1000});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
    await page.locator('.ibkr-connection').screenshot({path:`${dir}/connection-${theme}-${width}.png`});
  }
  mark('Connection controls fit both themes at phone, tablet and desktop widths');
  expect(errors).toEqual([]);writeFileSync(dir+'/checks.json',JSON.stringify({checks,errors},null,2));
}finally{await browser.close();await runtime.close();}
