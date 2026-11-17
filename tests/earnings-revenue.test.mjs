import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createEarningsRevenueService,matchEarningsRevenue} from '../server/earnings-revenue.mjs';
import {earningsMiddleware} from '../server/earnings.mjs';
import {earningsReportIdentity,formatEarningsRevenue,revenueSurprise} from '../src/data/earnings-revenue.mjs';

const BEFORE = Date.parse('2026-11-17T19:00Z');
const AFTER = Date.parse('2026-11-17T22:00Z');
const event = {id:'2026-11-17:EXM',symbol:'EXM',name:'Example Holdings, Inc. (The)',date:'2026-11-17',fiscalQuarter:'Oct/2026',window:'after',status:'expected'};
const reported = {...event,status:'reported'};
const period = '3Q2027';
const end = '2026-10-31';
const current = {currency:'CNY',period,periodEnd:end,revenueEstimate:10e9,dates:[event.date],history:[],series:[]};
const data = {symbol:'EXM',name:'The Example Holdings Corporation',type:'EQUITY',exchange:'NMS',currency:'USD',earnings:current,quarterly:[]};
const snapshot = {status:'ok',fetchedAt:new Date(BEFORE).toISOString(),data};
const history = {end,period,reported:event.date,actual:2};
const actualSnapshot = {status:'ok',fetchedAt:new Date(AFTER).toISOString(),data:{...data,
  earnings:{...current,period:'4Q2027',periodEnd:'2027-01-31',dates:['2027-02-16'],history:[history],series:[{history:[history]}]},
  quarterly:[{fiscalQuarter:period,revenue:12e9},{fiscalQuarter:'3Q2026',revenue:3e9}]}};

test('upcoming consensus requires verified listing, issuer, reported currency, period end and a matching date',()=>{
  const match = matchEarningsRevenue(event,snapshot,BEFORE);
  assert.equal(match.actual,null);
  assert.equal(formatEarningsRevenue(match.estimate),'10B CNY');
  for(const fields of [{symbol:'BAD'},{exchange:'LSE'},{type:'ETF'},{currency:'CNY'},{name:'Some other issuer'}]) {
    assert.equal(matchEarningsRevenue(event,{...snapshot,data:{...data,...fields}},BEFORE),null);
  }
  for(const fields of [{currency:null},{periodEnd:'2026-09-30'},{dates:['2026-11-19']},{dates:[event.date,'2026-11-18']},{history:[history]},{revenueEstimate:null}]) {
    const result=matchEarningsRevenue(event,{...snapshot,data:{...data,earnings:{...current,...fields}}},BEFORE);
    assert.equal(result?.estimate??null,null);
  }
  assert.equal(matchEarningsRevenue({...event,fiscalQuarter:'Sep/2026'},snapshot,BEFORE).estimate,null);
  assert.equal(matchEarningsRevenue(reported,snapshot,AFTER).estimate,null);
});

test('actual quarterly revenue requires a unique matching fiscal period and the exact report date',()=>{
  const match=matchEarningsRevenue(reported,actualSnapshot,AFTER);
  assert.equal(match.actual.amount,12e9);
  assert.equal(match.estimate,null);
  assert.equal(matchEarningsRevenue(reported,actualSnapshot,BEFORE-2*86400000).actual,null);
  assert.equal(matchEarningsRevenue({...reported,date:'2026-11-16'},actualSnapshot,AFTER).actual,null);
  for(const value of [0,-10,null]) {
    const changed={...actualSnapshot,data:{...actualSnapshot.data,quarterly:[{fiscalQuarter:period,revenue:value}]}};
    assert.equal(matchEarningsRevenue(reported,changed,AFTER).actual?.amount??null,value);
  }
  const ambiguous={...actualSnapshot,data:{...actualSnapshot.data,quarterly:[...actualSnapshot.data.quarterly,{fiscalQuarter:period,revenue:122e9}]}};
  assert.equal(matchEarningsRevenue(reported,ambiguous,AFTER).actual,null);
});

test('captured estimates survive restart and compare only to the same report, quarter and currency',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'desk-revenue-'));
  const cachePath=join(dir,'revenue.json');
  let now=BEFORE, currentSnapshot=snapshot, calls=0;
  const companies={getEarnings:async()=>{calls++;return currentSnapshot;}};
  const config={companies,cachePath,now:()=>now};
  try{
    let service=createEarningsRevenueService(config);
    const upcoming=await Promise.all([service.get(event),service.get(event)]);
    assert.equal(calls,1);
    assert.equal(upcoming[0].estimate.amount,10e9);
    service=createEarningsRevenueService(config);
    now=AFTER;
    currentSnapshot={...actualSnapshot,status:'stale'};
    const result=await service.get(reported);
    assert.equal(result.status,'stale');
    assert.equal(result.estimate.captured,true);
    assert.equal(result.estimate.fetchedAt,snapshot.fetchedAt);
    assert.equal(revenueSurprise(result),20);
    currentSnapshot={...actualSnapshot,data:{...actualSnapshot.data,earnings:{...actualSnapshot.data.earnings,currency:'USD'}}};
    const changed=await service.get(reported);
    assert.equal(changed.estimate,null);
    assert.equal(revenueSurprise(changed),null);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('an estimate fetched after the expected release window cannot become a historical comparison',async()=>{
  let currentSnapshot={...snapshot,fetchedAt:new Date(AFTER).toISOString()};
  const service=createEarningsRevenueService({companies:{getEarnings:async()=>currentSnapshot},now:()=>AFTER});
  assert.equal((await service.get(event)).estimate.amount,10e9);
  currentSnapshot=actualSnapshot;
  assert.equal((await service.get(reported)).estimate,null);
});

test('revenue endpoint matches the cached published calendar event before reading company data',async()=>{
  let calls=0;
  const handler=earningsMiddleware({report:async identity=>identity.symbol==='EXM'?reported:null}, {get:async()=>{calls++;return {status:'ok',actual:{fetchedAt:actualSnapshot.fetchedAt}};}});
  async function request(params,method='GET') {
    const res={statusCode:200,setHeader(){},end(body){this.body=JSON.parse(body);}};
    await handler({url:`/api/earnings/revenue?${new URLSearchParams(params)}`,method},res,()=>assert.fail('unexpected next'));
    return res;
  }
  const params={report:event.id,period:'2026-10',state:'reported'};
  assert.equal((await request(params)).body.data.id,event.id);
  assert.equal((await request({...params,period:'2026-09'})).body.status,'unavailable');
  assert.equal((await request({...params,state:'expected'})).body.status,'unavailable');
  assert.equal((await request({...params,report:'2026-11-17:OTHER'})).body.status,'unavailable');
  assert.equal((await request({...params,report:'2026-02-30:EXM'})).statusCode,400);
  assert.equal((await request(params,'POST')).statusCode,405);
  assert.equal(calls,1);
  assert.equal(earningsReportIdentity('2026-11-17:BRK/B'),null);
});
