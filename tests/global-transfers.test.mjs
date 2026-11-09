import test from 'node:test';import assert from 'node:assert/strict';
import {globalTradingSummary} from '../src/data/transfers.mjs';
const fx={date:'2026-11-09',rates:{USD:'50',EUR:'60'}};
const row=(platform,currency,amount,activity,extra={})=>({kind:'account',date:'2026-11-01',currency,amount,review:{platform,activity},...extra});
test('global net sums actual settlements, IBKR fees and projected installments once',()=>{
 const rows=[row('IBKR','USD','-100','deposit'),row('IBKR','EUR','50','withdrawal'),row('IBKR','MKD','-600','cost',{description:'Провизија за девизен налог за плаќање'}),row('Trading212','USD','-100','deposit',{kind:'card',settlementAmount:'-5400'}),row('Trading212','USD','10','withdrawal',{kind:'card',settlementAmount:'540'}),row('Trading212','MKD','540','withdrawal',{settlementOnly:true}),row('Trading212','MKD','-5400','deposit'),row('Vanquish','USD','-60','cost',{kind:'card',sourceKey:'card:v',description:'VANQUISH TRADER 1/6',settlementAmount:'-500'})];
 const summary=globalTradingSummary(rows,fx);assert.deepEqual(summary.components,{IBKR:'-2600',Trading212:'-4860',Vanquish:'-3000'});assert.deepEqual(summary.totals,{MKD:'-10460',USD:'-209.2',EUR:'-174.33'});assert.equal(summary.net,summary.totals.USD);
 rows.push(row('IBKR','USD','9999','exclude'));assert.equal(globalTradingSummary(rows,fx).net,'-209.2');
});
test('incomplete coverage never becomes a partial global total, and pending entries are disclosed',()=>{
 const missing=row('Vanquish','USD','-100','cost',{kind:'card',description:'VANQUISH TRADER'});assert.equal(globalTradingSummary([missing],fx).totals.MKD,null);
 const known=row('Trading212','USD','-100','deposit',{kind:'card',settlementAmount:'-5400'});const s=globalTradingSummary([known,{...known,review:null}],null);assert.equal(s.totals.MKD,'-5400');assert.equal(s.net,null);assert.equal(s.pending,1);
});
test('global positive means all platforms together recovered their costs',()=>{
 const rows=[row('Trading212','USD','-100','deposit',{kind:'card',settlementAmount:'-5000'}),row('IBKR','EUR','-100','deposit'),row('Vanquish','USD','300','withdrawal',{settlementAmount:'15000'})];assert.equal(globalTradingSummary(rows,fx).net,'80');
});
