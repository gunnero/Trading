import {chromium,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {testRuntime} from './qa-runtime.mjs';
import {testFetch} from '../tests/fixtures/auth.mjs';
import {mockMarket} from '../tests/fixtures/market.mjs';
import {mockBriefing} from '../tests/fixtures/briefing.mjs';

const runtime=await testRuntime(),dir='docs/qa/portfolio-order-status';mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/home/gunner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',env:{...process.env,LD_LIBRARY_PATH:'/home/gunner/.cache/mediahub/browser-libs/root/usr/lib/x86_64-linux-gnu'}});
const checks=[],errors=[],mark=value=>{checks.push(value);console.log('PASS '+value);};
const read=async path=>(await testFetch(runtime.url+path)).json();
const change=async(path,body)=>{const state=await read('/api/portfolio');const response=await testFetch(runtime.url+'/api/portfolio'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Opening-Bell-Client':'web'},body:JSON.stringify({...body,revision:state.revision})});expect(response.ok).toBe(true);return response.json();};
try{
  let root=await change('/people',{name:'Order status fixture'});
  root=await change('/accounts',{personId:root.data.people[0].id,label:'Practice',platform:'Trading 212'});
  const id=root.data.accounts[0].id;
  root=await change(`/accounts/${id}/snapshot`,{snapshot:{version:1,currency:'USD',accountValue:1500,investmentsValue:500,cash:1000,cost:475,unrealized:25,realized:0,holdings:[{ticker:'AMD_US_EQ',name:'Advanced Micro Devices',instrumentCurrency:'USD',quantity:5,averagePrice:95,price:100,value:500,cost:475,unrealized:25}],sourceLabel:'Isolated test'}});
  root.data.accounts[0].connected=true;root.data.accounts[0].environment='demo';root.data.accounts[0].snapshot.brokerId='123';
  for(const type of ['MARKET','LIMIT']){
    const context=await browser.newContext({viewport:{width:1488,height:1100}}),page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await mockMarket(page);await mockBriefing(page);
    await page.route('**/api/portfolio',route=>route.fulfill({json:root}));
    let review,receipt,posts=0,orderReads=0,holdingReads=0,holdingsFail=false,ordersFail=false,trackedStatus='NEW',includeMatching=true,matchingOverride={},activityError=null;
    const instrument={ticker:'AMD_US_EQ',name:'Advanced Micro Devices',currency:'USD',type:'STOCK',extendedHours:true};
    await page.route(/\/trading(?:\/[^?]+)?(?:\?.*)?$/,async route=>{
      const request=route.request(),url=new URL(request.url()),action=url.pathname.split('/trading')[1],body=request.method()==='POST'?request.postDataJSON():{};
      let data={enabled:true,blocked:false,attempts:receipt?[receipt]:[],environment:'demo'};
      if(action==='/instruments')data={items:[instrument]};
      if(action==='/position'){
        holdingReads++;
        if(holdingsFail)return route.fulfill({status:502,contentType:'text/html',body:'<html>Temporary gateway error</html>'});
        data={ticker:instrument.ticker,currency:'USD',instrumentCurrency:'USD',shares:5,availableShares:5,price:100,value:500,averagePrice:95,availableCash:1000,checkedAt:Date.now()};
      }
      if(action==='/orders'){
        orderReads++;
        if(ordersFail)return route.fulfill({status:502,json:{message:'Order status refresh unavailable'}});
        const matching={id:76,ticker:instrument.ticker,name:instrument.name,quantity:2,type,side:'BUY',status:trackedStatus,filledQuantity:trackedStatus==='FILLED'?2:trackedStatus==='PARTIALLY_FILLED'?1:0,...matchingOverride};
        data={orders:posts?[{...matching,id:900,status:'FILLED',filledQuantity:2},...(includeMatching?[matching]:[])]:[],checkedAt:Date.now(),activityError};
      }
      if(action==='/preview'){
        review={...body,quantity:body.cashAmount!=null?body.cashAmount/100:body.quantity,token:crypto.randomUUID(),action:'ORDER',name:instrument.name,currency:'USD',environment:'demo',brokerId:'123',referencePrice:100,estimate:200,currentShares:5,remainingShares:7,availableCash:1000,remainingCash:800,requestedCashAmount:body.cashAmount??null,expiresAt:Date.now()+60000};data=review;
      }
      if(action==='/submit'){
        expect(body).toEqual({token:review.token,confirmed:true});posts++;holdingsFail=true;
        receipt={...review,state:'ACCEPTED',message:'Order received by Trading 212. Its status will update automatically.',order:{id:76,status:'NEW',filledQuantity:0},createdAt:Date.now()};data=receipt;
      }
      await route.fulfill({json:data});
    });
    await page.goto(runtime.url+`/#portfolio/trade/${id}?ticker=AMD_US_EQ`);
    const holding=page.getByRole('region',{name:'Current holding'}),result=page.getByRole('status',{name:'Latest order status'});
    await expect(holding).toContainText('$1,000.00');
    await page.getByLabel('Order type').selectOption(type);
    if(type==='MARKET'){await page.getByRole('button',{name:'Cash amount',exact:true}).click();await page.getByLabel('Order cash amount').fill('200');}
    else{await page.getByLabel('Order limit price').fill('100');await page.getByLabel('Order shares').fill('2');}
    await page.getByRole('button',{name:'Review order',exact:true}).click();await page.getByRole('checkbox',{name:/I confirm this demo buy/}).check();await page.getByRole('button',{name:'Confirm demo buy'}).click();
    await expect(result).toContainText('Order accepted');await expect(result).toContainText('Order #76 · Pending');await expect(result).toContainText('waiting for execution');
    await expect(type==='MARKET'?page.getByLabel('Order cash amount'):page.getByLabel('Order shares')).toHaveValue('');
    await expect(holding).toContainText('HTTP 502');await expect(holding).toContainText('$1,000.00');await expect(holding).toContainText('Last confirmed holding');await expect(holding).toContainText('For reference only');
    await expect(page.getByRole('button',{name:'100%',exact:true})).toBeDisabled();
    if(type==='MARKET')await page.getByRole('button',{name:'Shares',exact:true}).click();
    await page.getByLabel('Order shares').fill('1');await expect(page.getByRole('button',{name:'Review order',exact:true})).toBeDisabled();expect(posts).toBe(1);
    expect(await result.evaluate(element=>!!(element.compareDocumentPosition(document.querySelector('.pm-order-form'))&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
    for(const width of [320,1488]){await page.setViewportSize({width,height:1100});await page.getByRole('region',{name:'Account trading',exact:true}).screenshot({path:`${dir}/${type.toLowerCase()}-accepted-${width}.png`});}
    mark(`${type}: acceptance is prominent, submitted size clears, and failed holdings retain reference values without enabling another review`);

    const poll=async()=>{const before=orderReads;await expect.poll(async()=>{await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));return orderReads;}).toBeGreaterThan(before);};
    includeMatching=false;await poll();await expect(result).toContainText('Order #76 · Pending');await expect(result).not.toContainText('#900');
    includeMatching=true;trackedStatus='FILLED';
    for(const mismatch of [{ticker:'MSFT_US_EQ'},{side:'SELL'},{type:type==='LIMIT'?'MARKET':'LIMIT'},{quantity:3}]){matchingOverride=mismatch;await poll();await expect(result).toContainText('Order #76 · Pending');}
    matchingOverride={};activityError='Order status is saved; activity updates are waiting to catch up.';
    includeMatching=true;trackedStatus='PARTIALLY_FILLED';await poll();await expect(result).toContainText('Order partially filled');await expect(result).toContainText('1 shares filled');await expect(result).toContainText('remaining quantity');
    await expect(page.getByText(activityError,{exact:true})).toBeVisible();activityError=null;
    ordersFail=true;await poll();await expect(page.getByText('Order status refresh unavailable',{exact:true})).toBeVisible();await expect(result).toContainText('Order partially filled');
    ordersFail=false;trackedStatus='FILLED';await poll();await expect(result).toContainText('Order filled');await expect(result).toContainText('2 shares filled');
    trackedStatus='NEW';await poll();await expect(result).toContainText('Order filled');await expect(result).toContainText('2 shares filled');expect(posts).toBe(1);expect(holdingReads).toBeGreaterThan(1);
    trackedStatus='CANCELLED';await poll();await expect(result).toContainText('Order filled');
    mark(`${type}: matching order updates through partial and full fills while holdings fail; unrelated IDs, stale pending snapshots and status-read failures cannot overwrite the confirmed receipt`);
    for(const width of [320,1488]){await page.setViewportSize({width,height:1100});expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);await result.screenshot({path:`${dir}/${type.toLowerCase()}-receipt-${width}.png`});}
    await context.close();
  }
  expect(errors).toEqual([]);writeFileSync(dir+'/checks.json',JSON.stringify({checks,errors},null,2));
}finally{await browser.close();await runtime.close();}
