import test from 'node:test';
import assert from 'node:assert/strict';
import {earningsHistory,companyEarningsSeries} from '../server/company-earnings.mjs';
import {earningsComparison} from '../src/data/company-earnings.mjs';
const now=Date.parse('2026-10-29T22:00Z');
const row=(period,actual,estimate,extras={})=>({fiscalQuarter:period,actual:{raw:actual},estimate:{raw:estimate},...extras});
const module=quarterly=>({earningsChart:{quarterly}});
test('Keeps every available quarter, sorts fiscal periods, and removes duplicate revisions',()=>{
 const rows=['3Q2026','4Q2025','1Q2026','2Q2026','3Q2025','2Q2025'].map(p=>row(p,2,1));
 rows.push(row('3Q2026',3,2,{surprisePct:'50'}));
 const result=earningsHistory(module(rows),now);
 assert.equal(result.length,6);assert.equal(result[0].period,'2Q2025');assert.equal(result.at(-1).actual,3);assert.equal(result.at(-1).surprisePercent,50);
});
test('Preserves missing/negative/zero EPS and exact dates; excludes future and estimate-only rows',()=>{
 const result=earningsHistory(module([null,row('2Q2026',-2,-3),row('3Q2026',0,0,{reportedDate:{fmt:'2026-10-28'}}),row('1Q2026',null,null,{reportedDate:{fmt:'2026-04-29'},periodEndDate:{fmt:'2026-03-31'}}),row('4Q2026',2,1,{reportedDate:{fmt:'2027-02-04'}}),row('4Q2026',null,1)]),now);
 assert.equal(result.length,3);assert.equal(result[0].actual,null);assert.equal(result[0].end,'2026-03-31');assert.equal(result.at(-1).actual,0);assert.equal(result.at(-1).reported,'2026-10-28');
});
test('GAAP and Non-GAAP histories remain independent with the source default selected',()=>{
 const result=companyEarningsSeries({earnings:{...module([row('2Q2026',3,2),row('3Q2026',4,3)]),defaultMethodology:'nongaap'},earningsGaap:module([row('3Q2026',2,3)]),earningsNonGaap:module([row('3Q2026',4,3)])},now);
 assert.equal(result.defaultSeries,'nongaap');assert.equal(result.series[0].history[0].actual,2);assert.equal(result.series[1].history.length,2);assert.equal(result.series[1].history.at(-1).actual,4);
});
test('Surprise uses provider percentage, or an explicitly calculated fallback with absolute negative estimates',()=>{
 assert.deepEqual(earningsComparison({actual:2,estimate:1,surprisePercent:98.2}),{difference:1,percent:98.2,derived:false,result:'Beat',tone:'green'});
 assert.equal(earningsComparison({actual:-1,estimate:-2}).percent,50);
 assert.equal(earningsComparison({actual:1,estimate:0}).percent,null);
 assert.equal(earningsComparison({actual:0,estimate:0}).result,'Met');
 assert.equal(earningsComparison({actual:null,estimate:2}).result,'Pending');
 assert.equal(earningsComparison({actual:0,estimate:null}).result,'Reported');
 assert.equal(earningsComparison({actual:1,estimate:2}).result,'Miss');
});
