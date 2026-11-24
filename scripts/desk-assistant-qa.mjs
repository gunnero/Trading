import assert from 'node:assert/strict';
import {chromium, expect} from '@playwright/test';
import {existsSync} from 'node:fs';
import {testRuntime} from './qa-runtime.mjs';
import {authenticateTestPage, testFetch} from '../tests/fixtures/auth.mjs';
import {mockMarket} from '../tests/fixtures/market.mjs';
import {mockBriefing} from '../tests/fixtures/briefing.mjs';

const runtime = await testRuntime();
const chrome = '/home/gunner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const libs = '/home/gunner/.cache/mediahub/browser-libs/root/usr/lib/x86_64-linux-gnu';
let browser;
try {
  const root = runtime.url + '/api/desk/';
  assert.equal((await fetch(root + 'briefing')).status, 401);
  assert.equal((await fetch(root + 'status')).status, 401);
  const request = {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{"question":"Show my QQQ levels"}'};
  assert.equal((await testFetch(root + 'ask', {...request, headers: {...request.headers, 'X-CSRF-Token': 'invalid'}})).status, 403);
  const local = await testFetch(root + 'ask', request);
  assert.equal(local.status, 200);
  assert.equal((await local.json()).sources[0].id, 'levels');

  browser = await chromium.launch({headless: true, ...(existsSync(chrome) ? {executablePath: chrome} : {}), ...(existsSync(libs) ? {env: {...process.env, LD_LIBRARY_PATH: libs}} : {})});
  const page = await browser.newPage({viewport: {width: 1488, height: 1000}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await authenticateTestPage(page);
  await mockMarket(page);
  await mockBriefing(page);
  const fixture = {
    day: '2026-11-27', generatedAt: '2026-11-27T15:00:00Z', aiAvailable: true,
    session: {label: 'Market open', schedule: 'Regular session 15:30–19:00 Skopje · early close.'},
    sources: [{id: 'events', title: 'Economic events', source: 'Calendar fixture', route: 'markets/calendar', status: 'partial',
      asOf: '2026-11-27T14:00:00Z', message: 'Partial schedule', rows: [{title: 'Scheduled release', detail: 'Time TBA · Estimated'}]}],
  };
  await page.route('**/api/desk/briefing', route => route.fulfill({json: {
    ...fixture,
    ...(route.request().method() === 'POST' ? {answer: {text: 'The release is estimated and has no time yet.', sourceIds: ['events']}} : {}),
  }}));
  await page.goto(runtime.url);
  await page.getByRole('button', {name: 'Daily briefing', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Daily Session Briefing'})).toBeVisible();
  await expect(page.getByText('Cached or incomplete')).toBeVisible();
  await expect(page.getByText('Time TBA · Estimated')).toBeVisible();
  await page.getByRole('button', {name: 'Summarize with OpenAI'}).click();
  await expect(page.getByRole('region', {name: 'OpenAI summary'})).toContainText('The release is estimated');
  await page.getByRole('button', {name: 'Economic events', exact: true}).click();
  await expect(page.getByRole('link', {name: 'Open in DESK'})).toBeFocused();
  await page.getByRole('link', {name: 'Ask DESK', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Ask DESK'})).toBeVisible();
  await page.getByRole('button', {name: 'What are my saved SPY and QQQ levels?'}).click();
  await page.getByRole('button', {name: 'Ask', exact: true}).click();
  await expect(page.getByRole('region', {name: 'Saved levels'})).toContainText('QQQ');
  await page.getByRole('button', {name: 'Show my QQQ trades tagged Early entry'}).click();
  await page.getByRole('button', {name: 'Ask', exact: true}).click();
  await expect(page.getByRole('region', {name: 'Saved journal entries'})).toContainText('0 matching entries tagged Early entry');
  for (const theme of ['dark', 'light']) {
    await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
    for (const width of [320, 390, 820, 1488]) {
      await page.setViewportSize({width, height: 900});
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    }
  }
  await page.getByRole('link', {name: 'Daily briefing', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Daily Session Briefing'})).toBeVisible();
  await page.setViewportSize({width: 320, height: 800});
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  assert.deepEqual(errors, []);
  console.log('PASS: authenticated routes, briefing navigation, cited summary, source and journal lookups, and responsive layout');
} finally {
  await browser?.close();
  await runtime.close();
}
