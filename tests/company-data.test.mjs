import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanyService,parseCompanyPage,companyMiddleware} from '../server/company-data.mjs';
const NOW=Date.parse('2026-10-24T23:00Z');
const v=raw=>({raw,fmt:String(raw)});
function modules(symbol='NVDA'){return {price:{symbol,longName:'NVIDIA Corporation',quoteType:'EQUITY',regularMarketTime:Date.parse('2026-10-23T20:00Z')/1000,regularMarketPrice:v(210.96),marketCap:v(5e12),currency:'USD',averageDailyVolume3Month:v(118e6)},summaryProfile:{sector:'Technology',industry:'Semiconductors',country:'US',longBusinessSummary:'A company profile.',website:'https://example.com',irWebsite:'javascript:alert(1)'},summaryDetail:{trailingPE:v(27),dividendYield:v(.0047),fiftyTwoWeekLow:v(164),fiftyTwoWeekHigh:v(243),dividendRate:v(0)},defaultKeyStatistics:{mostRecentQuarter:{fmt:'2026-07-26'},shortPercentOfFloat:v(.03),dateShortInterest:{fmt:'2026-10-15'},trailingEps:v(7.9),floatShares:v(23e9)},financialData:{financialCurrency:'USD',totalRevenue:v(300e9),debtToEquity:v(16.97),profitMargins:v(-.1),freeCashflow:v(0)},calendarEvents:{earnings:{earningsDate:[{fmt:'2026-11-17'}],isEarningsDateEstimate:true,earningsAverage:v(2.4),revenueAverage:v(1e11)}},earnings:{defaultMethodology:'nongaap',financialCurrency:'USD',earningsChart:{quarterly:[{date:'2Q2026',fiscalQuarter:'2Q2027',actual:v(2.2),estimate:v(2.1),reportedDate:{fmt:'2026-08-26'}}]},financialsChart:{yearly:[{date:2026,revenue:v(200e9),earnings:v(100e9)}]}}};}
const html=items=>'<script>throw Error("never execute");</script><script type="application/json" data-sveltekit-fetched>'+JSON.stringify({status:200,body:JSON.stringify({quoteSummary:{result:items}})})+'</script>';
const response=data=>new Response(html([data]),{headers:{'Content-Type':'text/html'}});
test('Company page chooses the exact symbol, preserves numeric zeros/negatives and distinguishes percent scales',()=>{
 const result=parseCompanyPage(html([modules('AMD'),modules()]),'NVDA',NOW);
 assert.equal(result.symbol,'NVDA');assert.equal(result.metrics.dividendRate.value,0);assert.equal(result.metrics.freeCashflow.value,0);assert.equal(result.metrics.profitMargin.value,-.1);
 assert.equal(result.metrics.debtEquity.format,'percent-points');assert.equal(result.metrics.shortFloat.format,'percent');assert.equal(result.metrics.shortFloat.asOf,'2026-10-15');assert.equal(result.metrics.forwardPE.value,null);
 assert.equal(result.profile.investorRelations,null);assert.equal(result.profile.website,'https://example.com/');assert.equal(result.quarter,'2026-07-26');assert.equal(result.earnings.estimated,true);assert.equal(result.earnings.basis,'Non-GAAP');assert.equal(result.annual[0].period,'2026');
});
test('Wrong instruments, malformed HTML and future quote timestamps fail without inferring another company',()=>{
 assert.throws(()=>parseCompanyPage(html([modules('AMD')]),'NVDA',NOW));assert.throws(()=>parseCompanyPage('<html>blocked</html>','NVDA',NOW));
 const m=modules();m.price.regularMarketTime=NOW/1000+600;assert.throws(()=>parseCompanyPage(html([m]),'NVDA',NOW));m.price.quoteType='FUTURE';assert.throws(()=>parseCompanyPage(html([m]),'NVDA',NOW));
});
test('ADRs preserve statement currency; funds use fund metrics instead of corporate earnings ratios',()=>{
 const m=modules('TSM');m.financialData.financialCurrency='TWD';const r=parseCompanyPage(html([m]),'TSM',NOW);assert.equal(r.currency,'USD');assert.equal(r.metrics.revenue.currency,'TWD');assert.equal(r.metrics.trailingEps.currency,'USD');assert.equal(r.metrics.enterpriseValue.currency,null);
 const f=modules('QQQ');f.price.quoteType='ETF';f.summaryDetail.totalAssets=v(4e11);f.fundProfile={feesExpensesInvestment:{annualReportExpenseRatio:v(.002)}};const fund=parseCompanyPage(html([f]),'QQQ',NOW);assert.equal(fund.fund,true);assert.equal(fund.metrics.marketCap.label,'Net assets');assert.equal(fund.metrics.expenseRatio.value,.002);assert.equal(fund.metrics.trailingPE,undefined);
});
test('Snapshot requests share in-flight work, cache for 30 minutes, retain dates during outages and expire after a day',async()=>{
 let calls=0,time=NOW,offline=false;const service=createCompanyService({now:()=>time,fetcher:async()=>{calls++;await new Promise(r=>setTimeout(r,3));if(offline)throw Error();return response(modules());}});
 const [a,b]=await Promise.all([service.get('NASDAQ:NVDA'),service.get('NYSE:NVDA')]);assert.equal(calls,1);assert.equal(a.symbol,'NASDAQ:NVDA');assert.equal(b.symbol,'NYSE:NVDA');time+=1000;await service.get('NASDAQ:NVDA');assert.equal(calls,1);
 offline=true;time+=1800000;const stale=await service.get('NASDAQ:NVDA');assert.equal(stale.status,'stale');assert.equal(stale.fetchedAt,a.fetchedAt);assert.deepEqual(stale.data,a.data);time+=86400000;assert.equal((await service.get('NASDAQ:NVDA')).status,'unavailable');
});
test('Provider blocks back off across symbols and remain respected after a process restart',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'company-cache-')),cachePath=join(directory,'cache.json');let calls=0;
 try{const fetcher=async()=>{calls++;return new Response('',{status:429,headers:{'retry-after':'3600'}});};const service=createCompanyService({now:()=>NOW,fetcher,cachePath});assert.equal((await service.get('NASDAQ:NVDA')).status,'unavailable');await service.get('NASDAQ:AMD');assert.equal(calls,1);await createCompanyService({now:()=>NOW+1000,fetcher,cachePath}).get('NASDAQ:TSLA');assert.equal(calls,1);}finally{rmSync(directory,{recursive:true,force:true});}
});
test('Invalid listing keys, methods, non-HTML and oversized responses never reach the company view',async()=>{
 let calls=0;const service=createCompanyService({now:()=>NOW,fetcher:async()=>{calls++;return Response.json({});}}),middleware=companyMiddleware(service);
 for(const [url,method,status] of [['/api/company?symbol=LSE:NVDA','GET',400],['/api/company?symbol=NASDAQ:NVDA','POST',405]]){let body;const res={setHeader(){},end(s){body=s;}};await middleware({url,method},res,()=>{});assert.equal(res.statusCode,status);assert.ok(body);}assert.equal(calls,0);
 assert.equal((await service.get('NASDAQ:NVDA')).status,'unavailable');assert.equal((await createCompanyService({now:()=>NOW,fetcher:async()=>new Response('x'.repeat(4000001),{headers:{'content-type':'text/html'}})}).get('NASDAQ:NVDA')).status,'unavailable');
});
