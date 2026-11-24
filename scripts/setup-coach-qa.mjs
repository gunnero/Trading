import {chromium, expect} from '@playwright/test';
import {existsSync, mkdirSync} from 'node:fs';
import {testRuntime} from './qa-runtime.mjs';
import {authenticateTestPage, testFetch} from '../tests/fixtures/auth.mjs';
import {mockMarket, NOW, fixtureQuote} from '../tests/fixtures/market.mjs';
import {mockBriefing} from '../tests/fixtures/briefing.mjs';

const chrome = '/home/gunner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const libs = '/home/gunner/.cache/mediahub/browser-libs/root/usr/lib/x86_64-linux-gnu';
const launch = {headless:true};
if (existsSync(chrome)) launch.executablePath = chrome;
if (existsSync(libs)) launch.env = {...process.env, LD_LIBRARY_PATH:libs};
const day = '2026-10-23';
const trade = (id, minute, fields = {}) => ({
  id, firm:'Vanquish', account:'QA Main', symbol:'QQQ', expiration:day, optionType:'CALL',
  position:'long', strike:603, quantity:1, multiplier:100, entryPrice:2, exitPrice:3,
  entryAt:`${day}T14:${minute}:00Z`, exitAt:`${day}T16:${minute}:00Z`,
  fees:2, source:'manual', tags:[], notes:'', review:{}, ...fields,
});
const sample = [
  trade('coach-followed', '01', {tags:['Followed plan'], notes:'Waited for the second candle.'}),
  trade('coach-early', '02', {tags:['Early entry','Chased entry'], exitPrice:1, notes:'Clicked while the candle was developing.'}),
  trade('coach-mixed', '03', {tags:['Followed plan','Early entry']}),
  trade('coach-unclassified', '04', {notes:'No entry check recorded.'}),
  trade('coach-open', '05', {exitAt:null, exitPrice:null}),
  trade('coach-other', '06', {firm:'Trading 212', tags:['Followed plan']}),
];
const runtime = await testRuntime();
let browser;
try {
  const api = runtime.url + '/api/workspace';
  const current = await (await testFetch(api)).json();
  const seed = {
    ...current.data, preferences:{symbol:'QQQ', timeframe:'4h', setupInterval:'2m'},
    levelText:`LVLS ${day}\nQQQ|4h|S 601-600\nSPY|4h|D 650-649\n`,
    journal:{version:1, trades:sample},
  };
  const saved = await testFetch(api, {method:'PUT', headers:{'Content-Type':'application/json','X-Opening-Bell-Client':'web'}, body:JSON.stringify({revision:current.revision, data:seed})});
  expect(saved.status).toBe(200);

  browser = await chromium.launch(launch);
  const page = await browser.newPage({viewport:{width:1488, height:1000}});
  const errors = [], unexpected = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.hostname === 'api.openai.com' || url.pathname.startsWith('/api/desk/') || url.pathname === '/api/workspace' && request.method() === 'PUT') unexpected.push(url.pathname);
  });
  await authenticateTestPage(page);
  await page.clock.install({time: NOW});
  await mockMarket(page);
  await mockBriefing(page);
  let complete = false;
  let missing = false;
  await page.route('**/api/market/setup?*', route => {
    const params = new URL(route.request().url()).searchParams;
    const symbol = params.get('symbol'), timeframe = params.get('interval'), from = params.get('from');
    const fixture = fixtureQuote(symbol);
    const start = Date.parse(day + 'T13:30:00Z') / 1000;
    const bars = [600.5, 601.4, 601.3].map((close, index) => ({
      timestamp:start + index * 120, end:start + (index + 1) * 120,
      sessionDate:day, open:close - .1, close,
      low:index === 2 ? 600.9 : close - .1, high:close + .1, closed:index < 2 || complete,
      indicators:{ema9:601.2, ema21:601, vwap:600.9},
    }));
    return route.fulfill({json:{
      ...fixture, status:missing ? 'insufficient' : 'ok', symbol, timeframe, from,
      quote:{...fixture.quote, sessionDate:day, price:601.32},
      bars:missing ? [] : bars, through:missing ? null : bars[complete ? 2 : 1].end, dailyStatus:'ok',
    }});
  });
  await page.route('**/api/journal/ibkr', route => route.fulfill({json:{
    configured:true, revision:2, unmatched:[], journal:{trades:[trade('coach-ibkr', '07', {firm:'IBKR', account:'Fixture IBKR', tags:['Followed plan'], notes:'IBKR note'})]},
  }}));
  await page.goto(runtime.url);
  await page.locator('.setup-explain > summary').click();
  const explanation = page.getByRole('region', {name:'QQQ setup explanation'});
  const retestRule = explanation.locator('.setup-explain-rule').filter({has:page.getByText('Separate retest', {exact:true})});
  await expect(explanation).toContainText('The break closed above supply. A separate retest hasn’t confirmed.');
  await expect(retestRule).toContainText('Pending');
  mkdirSync('docs/qa', {recursive:true});
  await page.locator('.setup-explain').screenshot({path:'docs/qa/setup-explanation.png'});
  complete = true;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(retestRule).toContainText('Passed');
  missing = true;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(explanation.locator('.setup-explain-state.unavailable')).toHaveCount(6);
  for (const width of [320, 390, 820, 1488]) {
    await page.setViewportSize({width, height:950});
    await expect.poll(() => explanation.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
  }
  await page.getByRole('navigation', {name:'Main navigation'}).getByRole('button', {name:'Journal', exact:true}).click();
  await page.getByRole('button', {name:'Journal Coach', exact:true}).click();
  await expect(page.getByRole('heading', {name:'Journal Coach'})).toBeVisible();
  const comparison = page.getByRole('region', {name:'Entry comparison'});
  await expect(comparison).toContainText('4 closed trades');
  await expect(comparison.getByRole('region', {name:'Followed rules'}).locator('.coach-count')).toHaveText('1');
  await expect(comparison.getByRole('region', {name:'Early or chased entry'}).locator('.coach-count')).toHaveText('1');
  await expect(comparison).toContainText('1 other or unclassified · 1 conflicting');
  await expect(page.getByRole('region', {name:'One improvement for next week'})).toContainText('Record the close time');
  const notes = page.getByRole('region', {name:'Trade notes'});
  await notes.locator('summary').filter({hasText:'Early or chased entry'}).click();
  await expect(notes.getByText('Clicked while the candle was developing.')).toBeVisible();
  await page.locator('.coach-card').getByRole('combobox', {name:'Journal', exact:true}).selectOption('ibkr');
  await expect(comparison).toContainText('1 closed trade');
  await expect(notes.locator('summary')).toHaveText(/Followed rules/);
  await page.locator('.coach-card').getByRole('combobox', {name:'Journal', exact:true}).selectOption('broker');
  await expect(comparison).toContainText('1 closed trade');
  await expect(notes.getByText('There are no saved notes')).toBeVisible();
  await page.locator('.coach-card').getByRole('combobox', {name:'Journal', exact:true}).selectOption('trades');
  await page.locator('.journal-coach').screenshot({path:'docs/qa/journal-coach.png'});
  for (const theme of ['light','dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    for (const width of [320, 390, 820, 1488]) {
      await page.setViewportSize({width, height:900});
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    }
  }
  expect(errors).toEqual([]);
  expect(unexpected).toEqual([]);
  console.log('PASS: live rule evidence, missing data, disjoint journal groups, separate brokers, private notes, and responsive layout');
} finally {
  await browser?.close();
  await runtime.close();
}
