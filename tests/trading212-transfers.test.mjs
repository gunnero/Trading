import test from 'node:test';
import assert from 'node:assert/strict';
import {descriptionPlatform,tradingRows,transferSummary} from '../src/data/transfers.mjs';
const base={kind:'card',date:'2026-11-06',description:'123 London   Trading 212',amount:'-100',currency:'USD',fee:null};
test('Trading212 Opis matches exact wording and keeps platform totals separate',()=>{
 assert.equal(descriptionPlatform(base),'Trading212');
 assert.equal(descriptionPlatform({...base,description:'london trading 212'}),'Trading212');
 for(const description of ['Trading 212','London Trading 2120','Unrelated'])assert.equal(descriptionPlatform({...base,description}), '');
 const rows=tradingRows([base,{...base,description:'VANQUISH TRADER',amount:'-49'}]);
 assert.equal(rows[0].review.activity,'deposit');
 const totals=transferSummary(rows);
 assert.equal(totals.find(t=>t.platform==='Trading212').deposit,'100');
 assert.equal(totals.find(t=>t.platform==='Vanquish').cost,'49');
 assert.equal(transferSummary(rows,'Vanquish').length,1);
});
test('account settlements, incoming funds, duplicates and incomplete entries require review',()=>{
 for(const changes of [{kind:'account'},{amount:'100'},{possibleDuplicate:true},{possibleChange:true},{date:null}])assert.equal(tradingRows([{...base,...changes}])[0].review,null);
 const review={platform:'Trading212',activity:'exclude'};
 assert.deepEqual(tradingRows([{...base,review}])[0].review,review);
});
