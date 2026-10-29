import {spawn} from 'node:child_process';
import {chromium,expect} from '@playwright/test';
import {testRuntime} from './qa-runtime.mjs';
import {authenticateTestPage} from '../tests/fixtures/auth.mjs';
const runtime=await testRuntime();await runtime.stop();let output='';
const child=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',new URL(runtime.url).port,'--strictPort'],{env:{...process.env,NODE_ENV:'development',OPENING_BELL_ORIGIN:'',OPENING_BELL_DATA_DIR:runtime.directory},stdio:['ignore','pipe','pipe']});
child.stdout.on('data',v=>{output+=v});child.stderr.on('data',v=>{output+=v});let browser;
try{
 let ready=false;for(let n=0;n<150;n++){try{if((await fetch(runtime.url+'/api/auth/session')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}expect(ready,output).toBe(true);
 for(const path of ['/AGENTS.md','/README.md','/docs/qa/auth/login-390.png','/tests/fixtures/market.mjs','/scripts/owner-access.mjs','/server/seed/levels.txt','/data/watchlist.txt','/.data/auth.key','/@fs/etc/passwd'])expect((await fetch(runtime.url+path)).status,path).toBe(404);
 expect((await fetch(runtime.url+'/api/workspace')).status).toBe(401);
 browser=await chromium.launch({headless:true,executablePath:'/home/gunner/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',env:{...process.env,LD_LIBRARY_PATH:'/home/gunner/.cache/mediahub/browser-libs/root/usr/lib/x86_64-linux-gnu'}});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(runtime.url);await expect(page.getByRole('heading',{name:'Welcome back.'})).toBeVisible();await authenticateTestPage(page);await page.goto(runtime.url+'/#levels');await page.reload();await expect(page.getByRole('heading',{name:'Key levels',exact:true})).toBeVisible();expect(errors).toEqual([]);
 console.log('PASS Vite gates APIs, blocks private project files and serves the authenticated app with its CSP');
}finally{if(browser)await browser.close();if(child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await done;}await runtime.close();}
