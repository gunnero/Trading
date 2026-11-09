import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {normalizeNbrm,createNbrmRates} from '../server/nbrm-rates.mjs';
import {convertMoney,ibkrBankBreakdown,tradingRows} from '../src/data/transfers.mjs';
const raw=[{datum:'2026-11-09T00:00:00',oznaka:'USD',nomin:100,sreden:5500},{datum:'2026-11-09T00:00:00',oznaka:'EUR',nomin:1,sreden:61.5}];
test('official list validates units, date, currencies and positive finite rates',()=>{
 const r=normalizeNbrm(raw,'2026-11-09');assert.equal(r.rates.USD,'55.00000000');assert.equal(r.rates.EUR,'61.50000000');
 for(const bad of [[],raw.slice(1),[...raw,raw[0]],raw.map(r=>({...r,sreden:0})),raw.map(r=>({...r,nomin:0}))])assert.throws(()=>normalizeNbrm(bad,'2026-11-09'));
 assert.throws(()=>normalizeNbrm(raw,'2026-11-08'));assert.throws(()=>normalizeNbrm(raw,'2026-11-17'));
});
test('cached rates survive restart, retry is bounded, stale cache is rejected',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'nbrm-'));let calls=0,clock=new Date('2026-11-09T12:00:00Z'),failed=false;
 const fetchImpl=async url=>{calls++;assert.equal(url.hostname,'www.nbrm.mk');if(failed)throw Error('offline');return new Response(JSON.stringify(raw));};
 try{
  const api=createNbrmRates(directory,{fetchImpl,now:()=>clock});const r=await api.read();assert.equal(r.state,'available');await api.read();assert.equal(calls,1);
  failed=true;const restored=createNbrmRates(directory,{fetchImpl,now:()=>clock});assert.equal((await restored.read()).state,'cached');await restored.read();assert.equal(calls,2);
  clock=new Date('2026-11-18T12:00:00Z');assert.equal((await restored.read()).state,'unavailable');assert.equal(calls,3);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('estimate uses original MKD where available and counts bank fees once in all equivalents',()=>{
 const base={kind:'account',date:'2026-11-02',recipient:'INTERACTIVE BROKERS LLC',description:'Девизен налог за плаќање',currency:'USD',amount:'-100',fee:'0'};
 const fee={...base,currency:'MKD',amount:'-600',description:'Провизија за девизен налог за плаќање'};
 const fx=normalizeNbrm(raw,'2026-11-09');
 let result=ibkrBankBreakdown(tradingRows([base,fee]),fx);assert.equal(result.mkdNet,'-6100');assert.equal(result.usdNet,'-110.91');assert.equal(result.eurNet,'-99.19');assert.equal(result.estimated,true);
 result=ibkrBankBreakdown(tradingRows([{...base,settlementAmount:'-5400'},fee]),fx);assert.equal(result.mkdNet,'-6000');assert.equal(result.estimated,false);
 assert.equal(convertMoney('-1.005','1'),'-1.01');assert.equal(convertMoney('1','1','3'),'0.33');assert.throws(()=>convertMoney('1','0'));
});
