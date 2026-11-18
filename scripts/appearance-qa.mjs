import {chromium, expect} from '@playwright/test';
import {existsSync} from 'node:fs';
import {testRuntime} from './qa-runtime.mjs';
import {testFetch} from '../tests/fixtures/auth.mjs';
import {mockMarket} from '../tests/fixtures/market.mjs';
import {mockBriefing} from '../tests/fixtures/briefing.mjs';

const chrome = '/home/gunner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const libs = '/home/gunner/.cache/mediahub/browser-libs/root/usr/lib/x86_64-linux-gnu';
const browser = await chromium.launch({
  headless: true,
  ...(existsSync(chrome) && {executablePath: chrome}),
  ...(existsSync(libs) && {env: {...process.env, LD_LIBRARY_PATH: libs}})
});
const runtime = await testRuntime();
const context = await browser.newContext({viewport:{width:1440,height:900}});
const errors = [];
const toggle = page => page.getByRole('switch', {name:'Dark mode'});
const revision = async () => (await (await testFetch(runtime.url+'/api/workspace')).json()).revision;

async function openDesk(context, route = '') {
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await mockMarket(page);
  await mockBriefing(page);
  await page.goto(runtime.url + route);
  return page;
}

// Check the actual painted canvas as well as the document theme.
async function chartInk(canvas, rgb) {
  return canvas.evaluate((el, color) => {
    const pixels = el.getContext('2d').getImageData(0, 0, el.width, el.height).data;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] === color[0] && pixels[i+1] === color[1] && pixels[i+2] === color[2] && pixels[i+3] > 200) return true;
    }
    return false;
  }, rgb);
}

try {
  const before = await revision();
  const page = await openDesk(context);
  const canvas = page.locator('.price-chart canvas').first();
  await expect(toggle(page)).not.toBeChecked();
  await expect(page.locator('body')).toHaveCSS('background-color','rgb(244, 242, 250)');
  await expect.poll(() => chartInk(canvas, [113,59,221])).toBe(true);
  await toggle(page).focus();
  await page.keyboard.press('Space');
  await expect(toggle(page)).toBeChecked();
  await expect(toggle(page)).toBeFocused();
  await expect(page.locator('body')).toHaveCSS('background-color','rgb(23, 21, 30)');
  await expect.poll(() => chartInk(canvas, [187,154,255])).toBe(true);
  await page.reload();
  await expect(toggle(page)).toBeChecked();

  await page.getByRole('button',{name:'NVDA',exact:true}).click();
  const dialog = page.getByRole('dialog');
  for (const name of ['Overview','Financials','Earnings','News']) {
    await dialog.getByRole('tab',{name,exact:true}).click();
    await expect(dialog).toHaveCSS('background-color','rgb(23, 21, 30)');
    await expect(dialog.getByRole('tab',{name,exact:true})).toHaveCSS('color','rgb(187, 154, 255)');
  }
  const other = await openDesk(context, '#settings/workspace');
  await expect(toggle(other)).toBeChecked();
  await toggle(other).click();
  await expect(dialog).toHaveCSS('background-color','rgb(244, 242, 250)');
  await expect(dialog.getByRole('tab',{name:'News',exact:true})).toHaveAttribute('aria-selected','true');
  await other.setViewportSize({width:390,height:740});
  await other.getByRole('button',{name:'Open navigation',exact:true}).click();
  await toggle(other).click();
  await expect(toggle(other)).toBeChecked();
  await other.getByRole('button',{name:'Close navigation menu'}).click();
  await expect(other.locator('select').first()).toHaveCSS('color-scheme','dark');
  await other.emulateMedia({media:'print'});
  await expect(other.locator('html')).toHaveCSS('color-scheme','light');
  expect(await revision()).toEqual(before);

  // The saved appearance also applies before an owner signs back in.
  await context.clearCookies();
  await page.reload();
  await expect(page.getByLabel('Password', {exact:true}).first()).toBeVisible();
  await expect(page.locator('body')).toHaveCSS('background-color','rgb(23, 21, 30)');

  const blocked = await browser.newContext();
  await blocked.addInitScript(() => Object.defineProperty(window,'localStorage',{get(){throw new Error('Storage unavailable');}}));
  const restricted = await openDesk(blocked);
  await toggle(restricted).click();
  await expect(toggle(restricted)).toBeChecked();
  await blocked.close();
  expect(errors).toEqual([]);
  console.log('PASS Light/Dark on desktop and mobile, keyboard, chart repaint, company tabs, cross-tab sync, reload, sign-in, print, disabled storage and workspace revision.');
} finally {
  await browser.close();
  await runtime.close();
}
