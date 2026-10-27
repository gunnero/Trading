import {chromium,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {TOTP,Secret} from 'otpauth';
import {openAuthStore} from '../server/auth.mjs';
import {testRuntime} from './qa-runtime.mjs';
import {mockMarket} from '../tests/fixtures/market.mjs';
import {mockBriefing} from '../tests/fixtures/briefing.mjs';

const runtime=await testRuntime({authenticated:false}),store=openAuthStore({directory:runtime.directory});
const browser=await chromium.launch({headless:true,executablePath:'/home/gunner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',env:{...process.env,LD_LIBRARY_PATH:'/home/gunner/.cache/mediahub/browser-libs/root/usr/lib/x86_64-linux-gnu'}});
const password='Isolated browser authentication passphrase 2026!',checks=[],errors=[];
const dir='docs/qa/auth';mkdirSync(dir,{recursive:true});
const mark=message=>{checks.push(message);console.log('PASS '+message);};
async function prepare(page){page.on('pageerror',error=>errors.push(error.message));await mockMarket(page);await mockBriefing(page);}
async function login(page,code){page=page.locator('.auth-screen');await page.getByLabel('Email or username').fill('gunner');await page.getByLabel('Password',{exact:true}).fill(password);await page.getByLabel('Authenticator or recovery code',{exact:false}).fill(code);await page.getByRole('button',{name:'Sign in',exact:true}).click();}
try{
  const context=await browser.newContext({viewport:{width:1488,height:1100}}),page=await context.newPage();await prepare(page);
  const requests=[];page.on('request',request=>requests.push(new URL(request.url()).pathname));
  await page.goto(runtime.url);await expect(page.getByRole('heading',{name:'Owner activation required'})).toBeVisible();
  expect(await page.locator('main').count()).toBe(0);expect(requests.filter(path=>path.startsWith('/api/')&&!path.startsWith('/api/auth/'))).toEqual([]);
  expect((await fetch(runtime.url+'/api/workspace')).status).toBe(401);
  mark('Logged-out visitors load no workspace, charts or private API data');
  const setup=store.issueSetup();await page.goto(runtime.url+'/#activate='+setup.token);
  await expect(page.getByRole('heading',{name:'Set up your account'})).toBeVisible();expect(page.url()).not.toContain(setup.token);
  await page.getByLabel('Create password',{exact:true}).fill(password);await page.getByLabel('Confirm password',{exact:true}).fill(password);await page.getByRole('button',{name:'Activate account'}).click();
  const account=page.getByRole('dialog',{name:'Account & security'});await expect(account).toBeVisible();await expect(account).toContainText('Workspace owner');await expect(account).toContainText('owner@example.com');
  await account.getByLabel('Current password',{exact:true}).fill(password);await account.getByRole('button',{name:'Set up two-step verification'}).click();await expect(account.getByAltText('Authenticator enrollment QR code')).toBeVisible();
  const secret=await account.locator('.account-enrollment code').textContent(),totp=new TOTP({secret:Secret.fromBase32(secret)});
  await account.getByLabel('Authenticator code',{exact:true}).fill(totp.generate());await account.getByRole('button',{name:'Enable two-step verification'}).click();
  await expect(account.getByRole('heading',{name:'Save these recovery codes'})).toBeVisible();const codes=await account.locator('.account-recovery code').allTextContents();expect(codes.length).toBe(10);
  await account.getByRole('button',{name:'I have saved my codes'}).click();await expect(account).toContainText('Two-step verification enabled');
  await account.getByRole('button',{name:'Close account settings'}).click();await expect(page.locator('.workspace-save-status')).toContainText('Workspace saved');
  mark('Private one-use activation, exact owner profile, local QR enrollment and recovery-code confirmation work');
  // Existing workspace edits still autosave through the protected API.
  await page.getByRole('button',{name:'Key levels',exact:true}).first().click();await expect(page.getByRole('heading',{name:'Your map for the session.'})).toBeVisible();
  await page.reload();await expect(page.getByRole('heading',{name:'Your map for the session.'})).toBeVisible();
  await page.getByRole('button',{name:'Account and security'}).click();await expect(account).toBeVisible();await account.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('heading',{name:'Welcome back.'})).toBeVisible();
  await login(page,'');await expect(page.getByRole('alert')).toContainText('Check your sign-in details');
  await login(page,codes[0]);await expect(page.getByRole('heading',{name:'Your map for the session.'})).toBeVisible();
  mark('Sign-out hides private content; password-only login fails with MFA; recovery sign-in restores the saved page');
  // Expiry locks the mounted workspace rather than destroying pending editor state.
  await page.getByRole('button',{name:'Account and security'}).click();await account.getByLabel('Current password',{exact:true}).fill('unsaved-field-preserved');
  store.db.prepare('DELETE FROM sessions').run();await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  const lock=page.getByRole('dialog',{name:'Sign in to unlock your workspace'});await expect(lock).toBeVisible();await page.keyboard.press('Escape');await expect(lock).toBeVisible();
  await login(page,codes[1]);await expect(lock).toHaveCount(0);await expect(account.getByLabel('Current password',{exact:true})).toHaveValue('unsaved-field-preserved');await account.getByLabel('Current password',{exact:true}).fill('');
  mark('Revoked sessions lock immediately, cannot be dismissed with Escape, and restore in-tab edits after authentication');
  const second=await page.context().newPage();await prepare(second);await second.goto(runtime.url+'/#levels');await expect(second.locator('main')).toBeVisible();
  await account.getByRole('button',{name:'Sign out all devices'}).click();await expect(page.getByRole('heading',{name:'Welcome back.'})).toBeVisible();await expect(second.getByRole('heading',{name:'Welcome back.'})).toBeVisible();expect(await second.locator('main').count()).toBe(0);await second.close();
  mark('Sign out all devices revokes server sessions and clears private content in other tabs');
  for(const width of [320,390,820,1488]){await page.setViewportSize({width,height:900});await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);await page.screenshot({path:`${dir}/login-${width}.png`});}
  await login(page,codes[2]);await expect(page.locator('main')).toBeVisible();await page.getByRole('button',{name:'Account and security'}).click();
  for(const width of [320,390,820,1488]){await page.setViewportSize({width,height:900});expect(await account.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);await account.evaluate(el=>{el.scrollTop=1200;});await expect(account.getByRole('button',{name:'Close account settings'})).toBeInViewport();}
  mark('Login and security settings fit 320px, phone, tablet and desktop widths; close remains accessible');
  expect(errors).toEqual([]);writeFileSync(`${dir}/checks.json`,JSON.stringify({result:'passed',checks,errors},null,2)+'\n');
}finally{await browser.close();store.close();await runtime.close();}
