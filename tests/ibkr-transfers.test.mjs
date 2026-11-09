import test from 'node:test';import assert from 'node:assert/strict';
import {tradingRows,transferSummary} from '../src/data/transfers.mjs';
const base={kind:'account',date:'2026-01-13',recipient:'INTERACTIVE BROKERS LLC',currency:'EUR',fee:null,amount:'-200',description:'Девизен налог за плаќање'};
test('IBKR wires and explicit separate fees keep their currencies and categories',()=>{
 const rows=tradingRows([base,{...base,description:'Провизија за девизен налог за плаќање',currency:'MKD',amount:'-1500'}]);assert.equal(rows[0].review.activity,'deposit');assert.equal(rows[1].review.activity,'cost');const sums=transferSummary(rows,'IBKR');assert.equal(sums.find(s=>s.currency==='EUR').deposit,'200');assert.equal(sums.find(s=>s.currency==='MKD').cost,'1500');
});
test('wire candidates need sender review and unrelated wires stay hidden',()=>{
 const receipt={...base,description:'Девизен прилив',recipient:'U12345678 Example',amount:'195'};assert.equal(tradingRows([receipt])[0].review,null);assert.equal(tradingRows([{...receipt,recipient:'Other sender'}]).length,0);assert.equal(tradingRows([{...receipt,currency:'MKD'}]).length,0);assert.equal(tradingRows([{...base,possibleDuplicate:true}])[0].review,null);
});
test('unique bank/card fee representation counts once; uncertain fee groups stay pending',()=>{
 const fee={...base,id:'a',currency:'MKD',amount:'-1500',description:'Провизија за девизен налог за плаќање',possibleDuplicate:true};
 const card={...fee,id:'c',kind:'card',recipient:null,description:'1980 - 1980 - Девизен налог за плаќање'};
 const rows=tradingRows([fee,card]);assert.equal(rows.length,1);assert.equal(rows[0].review.activity,'cost');assert.equal(transferSummary(rows)[0].cost,'1500');assert.equal(fee.possibleDuplicate,true);
 for(const extra of [{...fee,id:'b'},{...card,id:'d'}])assert.ok(tradingRows([fee,card,extra]).every(r=>!r.review));
 assert.equal(tradingRows([{...fee,possibleChange:true},card])[0].review,null);
});
