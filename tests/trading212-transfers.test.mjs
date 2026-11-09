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
 for(const changes of [{kind:'account'},{amount:'100'},{possibleChange:true},{date:null}])assert.equal(tradingRows([{...base,...changes}])[0].review,null);
 const review={platform:'Trading212',activity:'exclude'};
 assert.deepEqual(tradingRows([{...base,review}])[0].review,review);
});
test('withdrawals link unique bank credits once without changing original rows',()=>{
 const account={id:'a',kind:'account',date:'2026-02-05',description:'Card credit',recipient:'London  Trading 212 123456',amount:'672',currency:'MKD'};
 const card={id:'c',kind:'card',date:'2025-05-22',bookingDate:'2026-02-06',description:'Uplata na tekuai raeun (kartica)',amount:'12.99',currency:'USD',settlementAmount:'672',fee:null};
 const result=tradingRows([account,card]);
 assert.equal(result[0].settlementOnly,true);assert.equal(result[1].review.activity,'withdrawal');
 assert.equal(transferSummary(result)[0].withdrawal,'12.99');assert.equal(transferSummary(result).length,1);
 assert.equal(card.review,undefined);assert.equal(account.review,undefined);
 for(const extra of [{...account,id:'b'},{...card,id:'d'}])assert.equal(tradingRows([account,card,extra]).some(r=>r.linkedAccountId),false);
 for(const changes of [{settlementAmount:'673'},{bookingDate:'2026-02-10'},{review:{platform:'Trading212',activity:'exclude'}}])assert.equal(tradingRows([account,{...card,...changes}]).some(r=>r.linkedAccountId),false);
 assert.equal(tradingRows([{...account,recipient:'Different sender'},card]).length,0);
 const flagged=tradingRows([account,{...card,possibleDuplicate:true,possibleChange:true}]);assert.equal(flagged[1].matchedPlatform,'Trading212');assert.equal(flagged[1].review,null);
});
