import test from 'node:test';
import assert from 'node:assert/strict';
import {initialWorkspace,validateWorkspace} from '../server/workspace.mjs';
import {parseWatchlist} from '../src/data/market.js';
import {marketGroups,EXTRA_FUTURES_CHART_KEYS} from '../src/data/market-context.mjs';
import {createMarketService,supportsChart,parseCandles,resolveSymbol} from '../server/market-data.mjs';
import {CHART_DEFAULTS} from '../src/data/chart-settings.mjs';
import {NOW,yahooPayload} from './fixtures/market.mjs';

test('Context groups preserve exact watchlist listings and exclude stocks and crypto from funds/futures',()=>{
  const list=parseWatchlist(initialWorkspace().watchText),groups=marketGroups(list);
  assert.deepEqual(groups[0].items.map(item=>item.key),['VIX','VIX1D','DXY','US10Y','US2Y']);
  assert.deepEqual(groups[1].items.map(item=>item.key),['NYMEX:CL1!','ES','COMEX:GC1!','NQ','CME_MINI:RTY1!']);
  assert.deepEqual(groups[2].items.map(item=>item.entry.id),list.filter(entry=>entry.group==='FUND').map(entry=>entry.id));
  const changed=parseWatchlist('###FUND,NYSEARCA:VTI,LSE:QQQ,###FUTURES,CBOT_MINI:YM1!');
  assert.deepEqual(marketGroups(changed)[2].items.map(item=>item.key),['NYSEARCA:VTI','LSE:QQQ']);
  assert.equal(marketGroups(changed)[1].items[0].key,'CBOT_MINI:YM1!');
  assert.deepEqual(marketGroups([]).slice(1).map(group=>group.items),[[],[]]);
});

test('New futures charts request only the existing exact Yahoo mappings and keep futures identity',async()=>{
  const requested=[];
  const service=createMarketService({now:()=>NOW,fetcher:async url=>{requested.push(url);return Response.json(yahooPayload(decodeURIComponent(new URL(url).pathname.split('/').at(-1)),{price:100}));}});
  for(const [key,provider] of [['NYMEX:CL1!','CL=F'],['COMEX:GC1!','GC=F'],['CME_MINI:RTY1!','RTY=F']]){
    for(const frame of ['2m','5m','15m','30m','1h','4h','D','W','M'])assert.equal(supportsChart(key,frame),true);
    const result=await service.chart(key,'4h');assert.equal(result.status,'ok');assert.equal(result.quote.providerSymbol,provider);assert.equal(result.quote.kind,'future');assert.equal(result.candles.length,2);assert.ok(requested.at(-1).includes(encodeURIComponent(provider)));
  }
  for(const key of ['CL','NYSE:CL1!','NYMEX:GC1!','CBOT_MINI:YM1!'])assert.equal(supportsChart(key,'4h'),false);
});

test('Added futures scopes persist chart settings and drawings without accepting arbitrary exchange aliases',()=>{
  const original=initialWorkspace(),data={...original,chartSettings:{defaults:CHART_DEFAULTS,intervals:{},charts:{}},chartDrawings:{}};
  for(const key of EXTRA_FUTURES_CHART_KEYS){data.chartSettings.intervals[key]='2m';data.chartSettings.charts[key+'|2m']={...CHART_DEFAULTS,panel:'drawings',timeRange:{start:20,end:90},priceRange:null};data.chartDrawings[key+'|2m']=[{id:'line',type:'horizontal',color:'#efbd4e',points:[{time:1792692000,price:100}]}];}
  const saved=validateWorkspace(data);assert.deepEqual(saved.chartDrawings,data.chartDrawings);assert.deepEqual(saved.chartSettings,data.chartSettings);assert.deepEqual(saved.preferences,original.preferences);
  data.chartSettings.intervals['NYMEX:GC1!']='2m';assert.throws(()=>validateWorkspace(data));delete data.chartSettings.intervals['NYMEX:GC1!'];data.chartDrawings['NYMEX:GC1!|2m']=[];assert.throws(()=>validateWorkspace(data));
});

test('DXY and VIX1D have source-backed index charts and independent saved scopes',async()=>{
 const service=createMarketService({now:()=>NOW,fetcher:async url=>Response.json(yahooPayload(decodeURIComponent(new URL(url).pathname.split('/').at(-1)),{price:100}))});
 for(const [key,provider] of [['DXY','DX-Y.NYB'],['VIX1D','^VIX1D']]){
  for(const frame of ['2m','5m','15m','30m','1h','4h','D','W','M'])assert.equal(supportsChart(key,frame),true);
  const chart=await service.chart(key,'4h');assert.equal(chart.status,'ok');assert.equal(chart.quote.providerSymbol,provider);assert.equal(chart.quote.kind,'index');assert.ok(chart.candles.length);
  const data=initialWorkspace();data.chartSettings={defaults:CHART_DEFAULTS,intervals:{[key]:'2m'},charts:{[key+'|2m']:{...CHART_DEFAULTS,panel:null,timeRange:{start:10,end:100},priceRange:null}}};data.chartDrawings={[key+'|2m']:[{id:'line',type:'horizontal',color:'#efbd4e',points:[{time:1792692000,price:100}]}]};assert.deepEqual(validateWorkspace(data).chartDrawings,data.chartDrawings);
 }
});


test('New index daily closes are withheld until their own session finishes',()=>{
 const now=Date.parse('2026-10-23T20:05:00Z');
 for(const [symbol,end] of [['DXY','2026-10-24T04:00:00Z'],['VIX1D','2026-10-23T20:15:00Z']]){
  const asset=resolveSymbol(symbol),rows=parseCandles(yahooPayload(asset.symbol),asset,'D',now,{full:true});
  assert.ok(rows.length);assert.equal(rows.at(-1).end,Date.parse(end)/1000);assert.equal(rows.at(-1).complete,false);
 }
});
