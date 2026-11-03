import {chromium,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {testRuntime} from './qa-runtime.mjs';
import {testFetch} from '../tests/fixtures/auth.mjs';
import {mockMarket} from '../tests/fixtures/market.mjs';
import {mockBriefing} from '../tests/fixtures/briefing.mjs';
import {sampledPerformance,realizedPerformance,accountPerformance} from '../src/data/portfolio-history.mjs';

const runtime=await testRuntime(),dir='docs/qa/portfolio-history';mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/home/gunner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',env:{...process.env,LD_LIBRARY_PATH:'/home/gunner/.cache/mediahub/browser-libs/root/usr/lib/x86_64-linux-gnu'}});
const checks=[],errors=[],mark=s=>{checks.push(s);console.log('PASS '+s);};
const read=async path=>await(await testFetch(runtime.url+path)).json();
async function change(path,body){const state=await read('/api/portfolio');const res=await testFetch(runtime.url+'/api/portfolio'+path,{method:'POST',headers:{'content-type':'application/json','x-opening-bell-client':'web'},body:JSON.stringify({revision:state.revision,...body})});expect(res.ok).toBe(true);return res.json();}
const holding={ticker:'IPOE_US_EQ',name:'SoFi Technologies',isin:'US83406F1021',quantity:10,instrumentCurrency:'USD',averagePrice:20,price:25,value:250,cost:200,unrealized:50};
const snapshot={version:1,currency:'USD',accountValue:1250,investmentsValue:250,cash:1000,cost:200,unrealized:50,realized:25,sourceLabel:'Isolated history fixture',holdings:[holding]};
try{
 let root=await change('/people',{name:'Performance Fixture'});const person=root.data.people[0];
 root=await change('/accounts',{personId:person.id,platform:'Trading 212',label:'Primary'});const first=root.data.accounts[0].id;
 await change(`/accounts/${first}/snapshot`,{snapshot});
 root=await change('/accounts',{personId:person.id,platform:'Trading 212',label:'Secondary'});const second=root.data.accounts[1].id;
 root=await change(`/accounts/${second}/snapshot`,{snapshot:{...snapshot,accountValue:1900,currency:'EUR',holdings:[]}});
 const endpoint=runtime.url+`/api/portfolio/accounts/${first}/history`;
 expect((await fetch(endpoint)).status).toBe(401);
 expect((await testFetch(endpoint+'/sync',{method:'POST',headers:{'content-type':'application/json','x-opening-bell-client':'web','X-CSRF-Token':'invalid'},body:'{}'})).status).toBe(403);
 expect((await testFetch(endpoint+'?range=bad')).status).toBe(400);
 expect((await read(`/api/portfolio/accounts/${first}/history`)).sampled.coverage).toBe('unavailable');
 mark('History endpoints enforce authentication, CSRF and valid ranges; manual snapshots do not invent past values');
 const before=await read('/api/workspace'),page=await browser.newPage({viewport:{width:1488,height:1100},reducedMotion:'reduce'});
 page.on('pageerror',e=>errors.push(e.message));await mockMarket(page);await mockBriefing(page);
 const now=Date.now(),day=86400000,samples=[{at:now-370*day,pnl:0},{at:now-32*day,pnl:10},{at:now-8*day,pnl:20},{at:now-day-60000,pnl:40},{at:now-3600000,pnl:80},{at:now,pnl:75}];
 const fills=[{at:now-2*day,pnl:50},{at:now-3600000,pnl:-25}];let historyMode='normal',delay=null;
 root.data.accounts=root.data.accounts.map(a=>({...a,connected:true,snapshot:{...a.snapshot,source:'api',fetchedAt:new Date(now).toISOString()},lastSuccess:new Date(now).toISOString()}));
 await page.route('**/api/portfolio',route=>route.fulfill({json:root}));
 await page.route('**/api/portfolio/accounts/*/sync',route=>route.fulfill({json:root}));
 await page.route(/\/api\/portfolio\/accounts\/[^/]+\/history(?:\/sync|\?.*)?$/,async route=>{
   const url=new URL(route.request().url()),range=url.searchParams.get('range')||route.request().postDataJSON()?.range||'1D',accountId=url.pathname.split('/')[4],currency=accountId===first?'USD':'EUR';
   if(delay)await delay;
   const rows=accountId===first?samples:[{at:now,pnl:900}];
   const accountReturn={...accountPerformance(rows.map(r=>({at:r.at,value:r.pnl+1000+(accountId===first?175:0)})),[{at:now-400*day,amount:1000,currency,type:'DEPOSIT'}],currency,range,now),trackingFrom:rows[0].at,fetchedAt:now,status:'ready',updating:false,pages:1};
   if(historyMode==='funding-denied')Object.assign(accountReturn,{amount:null,points:[],netDeposits:null,error:'Enable History: Transactions read permission on the Trading 212 key to load net deposits and account return.',status:'unavailable'});
   const result={accountId,range,currency,accountReturn,trackingFrom:rows[0].at,fetchedAt:now,sampled:sampledPerformance(rows,range,now),realized:{...realizedPerformance(fills,range,now),status:'ready',error:null,updating:false,pages:1}};
   if(historyMode==='denied')result.realized={...result.realized,amount:null,points:[],error:'History access is unavailable. Enable History: Orders read permission on the Trading 212 key, then retry.',status:'unavailable'};
   if(historyMode==='partial')result.realized={...result.realized,amount:null,points:[],status:'unavailable',updating:true,pages:2};
   await route.fulfill({json:result}).catch(()=>{});
 });
 await page.goto(runtime.url+'/#portfolio');const panel=page.getByRole('region',{name:'Portfolio profit and loss'}),value=panel.locator('.pm-history-value strong');
 await expect(panel.getByRole('button',{name:'Account return',exact:true})).toHaveAttribute('aria-pressed','true');await expect(panel.getByRole('button',{name:'Max',exact:true})).toHaveAttribute('aria-pressed','true');await expect(value).toHaveText('$250.00');await expect(panel.locator('.pm-account-performance')).toContainText('$1,000.00');await expect(panel).toContainText('Not supplied by API');
 await panel.getByRole('button',{name:'Day',exact:true}).click();await expect(value).toHaveText('$35.00');
 historyMode='funding-denied';await expect(panel.getByRole('button',{name:'Refresh portfolio history'})).toBeEnabled();await panel.getByRole('button',{name:'Refresh portfolio history'}).click();await expect(value).toHaveText('—');await expect(panel).toContainText('History: Transactions');
 historyMode='normal';await expect(panel.getByRole('button',{name:'Refresh portfolio history'})).toBeEnabled();await panel.getByRole('button',{name:'Refresh portfolio history'}).click();await expect(value).toHaveText('$35.00');
 mark('Account-wide return is default, net deposits are visible, unavailable MWRR and funding permission states are explicit');
 await expect(page.locator('.pm-table')).toContainText('SoFi Technologies');await expect(page.locator('.pm-table')).toContainText('SOFI');await expect(page.locator('.pm-table')).not.toContainText('IPOE_US_EQ');
 await page.getByLabel('Search holdings').fill('SOFI');await expect(page.getByRole('button',{name:'View SoFi Technologies holding details'})).toBeVisible();await page.getByLabel('Search holdings').fill('');
 await page.getByRole('button',{name:'View SoFi Technologies holding details'}).click();const dialog=page.getByRole('dialog');await expect(dialog.getByRole('img',{name:/SOFI Yahoo Finance/})).toBeVisible();await expect(dialog.locator('.pm-broker-identity p')).toBeHidden();await dialog.getByText('Broker instrument',{exact:true}).click();await expect(dialog.locator('.pm-broker-identity p')).toBeVisible();await expect(dialog.locator('.pm-broker-identity')).toContainText('IPOE_US_EQ');await page.keyboard.press('Escape');
 mark('Company names and SOFI replace raw codes in holdings; search and current-ticker chart work; broker identity stays in details');
 await panel.getByRole('button',{name:'Open + sold trades',exact:true}).click();
 for(const [label,expected,coverage] of [['Week','—','no account observation'],['Month','—','no account observation'],['3 months','—','no account observation'],['YTD','—','no account observation'],['Year','—','no account observation'],['Max','$75.00','Total shown above']]){
   await panel.getByRole('button',{name:label,exact:true}).click();await expect(value).toHaveText(expected);await expect(panel).toContainText(coverage);
 }
 await panel.getByRole('button',{name:'Day',exact:true}).click();await expect(value).toHaveText('$35.00');await expect(panel.getByRole('img',{name:/Return from recorded account/})).toBeVisible();
 const slider=panel.getByRole('slider',{name:'Performance chart observation'});await slider.focus();await page.keyboard.press('Home');await expect(panel.locator('.pm-history-readout b')).toHaveText('$0.00');await page.keyboard.press('End');await expect(panel.locator('.pm-history-readout b')).toHaveText('$35.00');
 await panel.getByRole('button',{name:'Realized trades',exact:true}).click();await expect(value).toHaveText('-$25.00');await panel.getByRole('button',{name:'Week',exact:true}).click();await expect(value).toHaveText('$25.00');
 const path=await panel.locator('svg path[data-stepped]').getAttribute('d');expect(path).toContain('H ');expect(path).toContain('V ');expect(path).not.toContain('L ');await panel.screenshot({path:dir+'/realized-steps.png'});
 mark('All seven periods withhold unavailable baselines; realized loss chart has zero baseline and flat intervals; keyboard inspection passes');
 for(const mode of ['denied','partial']){
   historyMode=mode;await expect(panel.getByRole('button',{name:'Refresh portfolio history'})).toBeEnabled();await panel.getByRole('button',{name:'Refresh portfolio history'}).click();await expect(value).toHaveText('—');await expect(panel).toContainText(mode==='denied'?'History: Orders':'2 pages checked');await expect(page.locator('.pm-table')).toContainText('SoFi Technologies');
 }
 historyMode='normal';await expect(panel.getByRole('button',{name:'Refresh portfolio history'})).toBeEnabled();await panel.getByRole('button',{name:'Refresh portfolio history'}).click();await expect(value).toHaveText('$25.00');
 await panel.getByRole('button',{name:'Open + sold trades',exact:true}).click();await panel.getByRole('button',{name:'Max',exact:true}).click();await expect(value).toHaveText('$75.00');
 let release;delay=new Promise(r=>release=r);await page.getByRole('button',{name:/Performance Fixture Trading 212 · Secondary/}).click();await expect(value).toHaveText('—');await expect(panel).toContainText('Loading performance history');release();delay=null;await expect(value).toHaveText('€900.00');await expect(panel.getByRole('button',{name:'Account return',exact:true})).toHaveAttribute('aria-pressed','true');
 mark('Missing history permission and incomplete scans preserve holdings; switching accounts clears old results and currency before loading');
 await page.getByRole('button',{name:/Performance Fixture Trading 212 · Primary/}).click();await expect(value).toHaveText('$250.00');
 for(const width of [320,390,820,1488]){await page.setViewportSize({width,height:1000});await panel.scrollIntoViewIfNeeded();expect(await panel.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);await panel.screenshot({path:`${dir}/performance-${width}.png`});}
 expect(await read('/api/workspace')).toEqual(before);expect(errors).toEqual([]);mark('Performance controls/chart fit 320–1488px; view interactions leave saved workspace unchanged');
 writeFileSync(dir+'/checks.json',JSON.stringify({result:'passed',checks,errors},null,2)+'\n');
}finally{await browser.close();await runtime.close();}
