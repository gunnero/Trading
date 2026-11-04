import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalRoute,routeView,routeGroup} from '../src/data/navigation.mjs';

test('legacy destinations retain their exact detail under the consolidated navigation',()=>{
  for(const [before,after,view,group] of [
    ['briefing','markets/calendar','briefing','markets'],['earnings','markets/earnings','earnings','markets'],['news','markets/news','news','markets'],
    ['insights/monitor','portfolio/insights/monitor','insights','portfolio'],['activity','portfolio/activity','activity','portfolio'],
    ['review/2026-11-03','journal/review/2026-11-03','journal','journal'],['levels','levels','levels','overview'],
    ['watchlist','settings/watchlist','settings','settings'],['transfers','settings/transfers','settings','settings'],
  ]){assert.equal(canonicalRoute(before),after);assert.equal(canonicalRoute(after),after);assert.equal(routeView(after),view);assert.equal(routeGroup(after),group);}
});
test('navigation preserves account/order and encoded trade identities without fallback',()=>{
  for(const route of ['portfolio/trade/00000000-0000-0000-0000-000000000002?ticker=AMD_US_EQ&side=SELL','portfolio/trade/missing-account?side=BUY','portfolio/trade/%E0%A4%A','journal/trades/a%2Fb','settings/account'])assert.equal(canonicalRoute(route),route);
  assert.equal(canonicalRoute('markets'),'markets/calendar');assert.equal(canonicalRoute('#news'),'markets/news');assert.equal(canonicalRoute('unknown'),'overview');assert.equal(canonicalRoute(''),'overview');
});
