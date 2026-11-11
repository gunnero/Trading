import test from 'node:test';
import assert from 'node:assert/strict';
import {portfolioChartOrderLines,chartOrderStatus} from '../src/data/portfolio-chart-orders.mjs';
const entry={id:'NASDAQ:AMD',symbol:'AMD'},position={holding:{ticker:'AMD_US_EQ',instrumentCurrency:'USD'},orderListing:entry};
const order={id:12,ticker:'AMD_US_EQ',type:'LIMIT',side:'SELL',status:'PARTIALLY_FILLED',quantity:2,filledQuantity:.5,limitPrice:550,priceCurrency:'USD'};
const data=orders=>({ticker:'AMD_US_EQ',priceCurrency:'USD',orders});
test('exact holding limit orders retain partial fills and exact prices',()=>{
 const [line]=portfolioChartOrderLines(data([order]),position,entry);
 assert.equal(line.value,550);assert.equal(line.remainingQuantity,1.5);assert.equal(line.currency,'USD');assert.equal(chartOrderStatus(line),'Partially filled');
 const [unknown]=portfolioChartOrderLines(data([{...order,filledQuantity:null}]),position,entry);assert.equal(unknown.remainingQuantity,null);
});
test('unverified listings, other broker tickers and price currencies cannot overlay this holding',()=>{
 for(const wrong of [{...position,orderListing:null},{...position,orderListing:{id:'NASDAQ:GOOGL'}},{...position,holding:{...position.holding,instrumentCurrency:'EUR'}}])assert.deepEqual(portfolioChartOrderLines(data([order]),wrong,entry),[]);
 for(const wrong of [{...data([order]),ticker:'AMD_DE_EQ'},{...data([order]),priceCurrency:'EUR'},data([{...order,ticker:'GOOG_US_EQ'}]),data([{...order,priceCurrency:'EUR'}])])assert.deepEqual(portfolioChartOrderLines(wrong,position,entry),[]);
});
test('terminal, malformed, duplicate, non-limit and fully filled entries are excluded',()=>{
 for(const patch of [{status:'FILLED'},{status:'CANCELLED'},{status:'REJECTED'},{status:'REPLACED'},{type:'MARKET'},{side:'SHORT'},{limitPrice:0},{limitPrice:NaN},{quantity:-1},{filledQuantity:2},{filledQuantity:3},{filledQuantity:-1},{id:'12'}])assert.deepEqual(portfolioChartOrderLines(data([{...order,...patch}]),position,entry),[]);
 assert.deepEqual(portfolioChartOrderLines(data([order,{...order,limitPrice:560}]),position,entry),[]);
});
test('uncertain status and stale reads remain explicit references without claiming cancellation',()=>{
 const [line]=portfolioChartOrderLines(data([{...order,awaitingHistory:true}]),position,entry);assert.equal(chartOrderStatus(line),'Status unconfirmed');
 const [stale]=portfolioChartOrderLines(data([order]),position,entry,true);assert.match(chartOrderStatus(stale),/Last confirmed/);
 const [cancel]=portfolioChartOrderLines(data([{...order,status:'CANCELLING'}]),position,entry);assert.equal(chartOrderStatus(cancel),'Cancellation pending');
});
