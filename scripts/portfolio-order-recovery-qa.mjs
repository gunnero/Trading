import {chromium,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {testRuntime} from './qa-runtime.mjs';
import {testFetch} from '../tests/fixtures/auth.mjs';
import {mockMarket} from '../tests/fixtures/market.mjs';
import {mockBriefing} from '../tests/fixtures/briefing.mjs';
const runtime=await testRuntime(),dir='docs/qa/portfolio-order-recovery';mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/home/gunner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',env:{...process.env,LD_LIBRARY_PATH:'/home/gunner/.cache/mediahub/browser-libs/root/usr/lib/x86_64-linux-gnu'}});
const checks=[],errors=[],mark=s=>{checks.push(s);console.log('PASS '+s);};
const read=async path=>(await testFetch(runtime.url+path)).json();
const change=async(path,body)=>{const state=await read('/api/portfolio');const res=await testFetch(runtime.url+'/api/portfolio'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Opening-Bell-Client':'web'},body:JSON.stringify({...body,revision:state.revision})});expect(res.ok).toBe(true);return res.json();};
try{
 let root=await change('/people',{name:'Recovery fixture'});root=await change('/accounts',{personId:root.data.people[0].id,label:'Practice',platform:'Trading 212'});const id=root.data.accounts[0].id,base=`/api/portfolio/accounts/${id}`,key='opening-bell.order-check.'+id;
 const holding={ticker:'AMD_US_EQ',name:'Advanced Micro Devices',instrumentCurrency:'USD',quantity:5,averagePrice:95,price:100,value:500,cost:475,unrealized:25};
 root=await change(`/accounts/${id}/snapshot`,{snapshot:{version:1,currency:'USD',accountValue:1500,investmentsValue:500,cash:1000,cost:475,unrealized:25,realized:0,holdings:[holding],sourceLabel:'Isolated test'}});
 root.data.accounts[0]={...root.data.accounts[0],connected:true,environment:'demo',snapshot:{...root.data.accounts[0].snapshot,source:'api',brokerId:'123'}};
 const before=await read('/api/workspace');
 expect((await fetch(runtime.url+base+'/trading/attempt?token='+crypto.randomUUID())).status).toBe(401);
 expect((await testFetch(runtime.url+base+'/trading/attempt',{method:'POST',headers:{'Content-Type':'application/json','X-Opening-Bell-Client':'web'},body:'{}'})).status).toBe(405);
 mark('Confirmation lookup requires owner authentication and cannot submit orders');
 for(const mode of ['accepted','rejected','malformed','wrong-token','network','unknown','not-sent','cancel','known-response','missing']){
  const context=await browser.newContext({viewport:{width:390,height:1000}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await mockMarket(page);await mockBriefing(page);
  await page.route('**/api/portfolio',route=>route.fulfill({json:root}));await page.route('**/api/portfolio/accounts/*/sync',route=>route.fulfill({json:root}));
  let review,receipt,posts=0,lookups=0,lookupReady=false,settingsFail=false,state={enabled:true,blocked:false,attempts:[],environment:'demo'};
  const instrument={ticker:'AMD_US_EQ',name:'Advanced Micro Devices',currency:'USD',type:'STOCK',extendedHours:true};
  const bad=route=>route.fulfill({status:502,contentType:'text/html',body:'<html>Bad Gateway</html>'});
  await context.route(/\/trading(?:\/[^?]+)?(?:\?.*)?$/,async route=>{
   const req=route.request(),url=new URL(req.url()),action=url.pathname.split('/trading')[1],body=req.method()==='POST'?req.postDataJSON():{};
   let data={...state,blocked:mode==='unknown'&&posts>0||mode==='accepted'&&posts>0&&!lookupReady};
   if(!action&&settingsFail)return bad(route);
   if(action==='/instruments')data={items:[instrument]};
   if(action==='/position')data={ticker:instrument.ticker,currency:'USD',instrumentCurrency:'USD',shares:5,availableShares:5,price:100,availableCash:1000,checkedAt:Date.now()};
   if(action==='/orders')data={orders:[{id:75,ticker:instrument.ticker,name:instrument.name,quantity:1,type:'MARKET',side:'BUY',status:'NEW',filledQuantity:0}]};
   if(action==='/preview'){review={...body,token:crypto.randomUUID(),action:body.action||'ORDER',name:instrument.name,currency:'USD',environment:'demo',brokerId:'123',expiresAt:Date.now()+60000,order:body.action==='CANCEL'?{ticker:instrument.ticker,side:'BUY',quantity:1}:undefined};data=review;}
   if(action==='/submit'){
    expect(body).toEqual({token:review.token,confirmed:true});posts++;settingsFail=true;
    receipt={...review,state:mode==='unknown'?'UNKNOWN':mode==='not-sent'?'PREPARED':mode==='rejected'?'REJECTED':'ACCEPTED',message:mode==='rejected'?'Fixture: broker rejected the order':mode==='cancel'?'Cancellation requested.':'Order received by Trading 212.',order:mode==='cancel'?review.order:{id:76,status:'NEW',filledQuantity:0},createdAt:Date.now()};
    if(mode==='unknown')delete receipt.message;
    if(mode==='known-response')return route.fulfill({json:receipt});
    if(mode==='malformed')return route.fulfill({json:{success:true}});
    if(mode==='wrong-token')return route.fulfill({json:{...receipt,token:crypto.randomUUID()}});
    if(mode==='network')return route.abort('failed');
    return bad(route);
   }
   if(action==='/attempt'){
    lookups++;expect(req.method()).toBe('GET');expect(url.searchParams.get('token')).toBe(review.token);
    if(mode==='missing')return route.fulfill({status:409,json:{message:'Confirmation unavailable'}});
    if(!lookupReady)return bad(route);
    data={attempt:receipt,inFlight:false,notSubmitted:mode==='not-sent'};
   }
   await route.fulfill({json:data});
  });
  await page.goto(runtime.url+`/#portfolio/trade/${id}?ticker=AMD_US_EQ`);await expect(page.locator('.pm-selected-instrument')).toContainText('AMD_US_EQ');
  if(mode==='cancel')await page.getByRole('button',{name:'Review cancellation'}).click();
  else{await page.getByLabel('Order shares').fill('1');await expect(page.getByRole('button',{name:'Review order',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Review order',exact:true}).click();}
  await page.getByRole('checkbox',{name:/I confirm this demo/}).check();await page.getByRole('button',{name:mode==='cancel'?'Confirm cancellation':'Confirm demo buy',exact:true}).click();
  if(mode==='known-response'){
   await expect(page.locator('.pm-order-result')).toContainText('Order received by Trading 212.');await expect(page.getByText(/The saved status could not be refreshed/)).toBeVisible();expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBeNull();expect(posts).toBe(1);mark('A failed follow-up refresh preserves the already accepted receipt');await context.close();continue;
  }
  const recovery=page.getByRole('status').filter({has:page.getByRole('heading',{name:'Checking submitted order'})});
  await expect(recovery).toBeVisible();await expect(recovery).toContainText(mode==='missing'?'unavailable for the current connection':'saved result is temporarily unavailable');await expect(page.getByRole('button',{name:'Review order',exact:true})).toBeDisabled();expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBe(review.token);expect(posts).toBe(1);
  if(mode==='accepted'){
   const second=await context.newPage();await mockMarket(second);await mockBriefing(second);await second.route('**/api/portfolio',route=>route.fulfill({json:root}));settingsFail=false;
   await second.goto(runtime.url+`/#portfolio/trade/${id}?ticker=AMD_US_EQ`);await expect(second.locator('.pm-order-recovery')).toBeVisible();await expect(second.getByRole('button',{name:'Review order',exact:true})).toBeDisabled();
   await page.reload();await expect(page.locator('.pm-order-recovery')).toBeVisible();await expect(page.getByRole('button',{name:'Review order',exact:true})).toBeDisabled();
   await page.setViewportSize({width:320,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);await page.locator('.pm-order-recovery').screenshot({path:dir+'/lost-response-320.png'});
   lookupReady=true;await page.getByRole('button',{name:'Check saved result'}).click();await expect(page.locator('.pm-order-result')).toContainText('Order received by Trading 212.');await expect(page.getByText(/An earlier order has an uncertain result/)).toHaveCount(0);await expect(second.locator('.pm-order-recovery')).toHaveCount(0);await second.close();
  }else if(mode==='missing'){
   await expect(page.getByRole('button',{name:'Clear checked confirmation'})).toBeDisabled();await page.getByRole('checkbox',{name:/I checked this confirmation/}).check();settingsFail=false;await page.getByRole('button',{name:'Clear checked confirmation'}).click();await expect(page.locator('.pm-order-result')).toContainText('No order was resent.');
  }else{
   settingsFail=false;lookupReady=true;await page.getByRole('button',{name:'Check saved result'}).click();await expect(page.locator('.pm-order-result')).toContainText(mode==='unknown'?'Result uncertain':mode==='not-sent'?'Order not submitted':mode==='cancel'?'Cancellation requested':mode==='rejected'?'Order rejected':'Order received by Trading 212.');
   if(mode==='unknown')await expect(page.getByRole('button',{name:'Review order',exact:true})).toBeDisabled();
  }
  await expect(page.locator('.pm-order-recovery')).toHaveCount(0);expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBeNull();expect(posts).toBe(1);expect(lookups).toBeGreaterThan(0);mark(`${mode}: confirmation recovered or checked without a repeated POST, including failed follow-up reads`);await context.close();
 }
 expect(errors).toEqual([]);expect(await read('/api/workspace')).toEqual(before);writeFileSync(dir+'/checks.json',JSON.stringify({result:'passed',checks,errors,brokerRequests:'All mocked; no live orders or broker credentials'},null,2)+'\n');
}finally{await browser.close();await runtime.close();}
