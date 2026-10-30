import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {mkdtempSync,rmSync,statSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {TOTP,Secret} from 'otpauth';
import {openAuthStore,authMiddleware,authConfig,passwordHash,passwordMatches,AUTH_IDLE_MS,AUTH_MAX_MS} from '../server/auth.mjs';
import {openWorkspaceStore,workspaceMiddleware} from '../server/workspace.mjs';

const password='Independent private test passphrase 2026!';
async function app(t,{active=true,config=authConfig({})}={}){
  const directory=mkdtempSync(join(tmpdir(),'ob-auth-test-'));let time=Date.now();
  const auth=openAuthStore({directory,now:()=>time}),workspace=openWorkspaceStore({directory});
  if(active)auth.db.prepare('UPDATE owner SET password=? WHERE id=1').run(await passwordHash(password));
  const gate=authMiddleware(auth,{config}),saved=workspaceMiddleware(workspace);
  const server=createServer((req,res)=>gate(req,res,()=>saved(req,res,()=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({shell:true}));})));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`,origin=config.origin||url;
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));auth.close();workspace.close();rmSync(directory,{recursive:true,force:true});});
  let cookie='',csrf='';
  async function post(action,data={},extra={}){
    const headers={Host:new URL(origin).host,Origin:origin,'Content-Type':'application/json','X-Opening-Bell-Client':'web',Cookie:cookie,'X-CSRF-Token':csrf,...extra};
    // Node fetch replaces Host; use an actual HTTP request to exercise reverse-proxy host validation.
    const response=await new Promise((resolve,reject)=>{const req=request(url+'/api/auth/'+action,{method:'POST',headers},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));});req.on('error',reject);req.end(JSON.stringify(data));});
    const body=await response.json();if(response.ok&&response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(body.csrf)csrf=body.csrf;return {response,body};
  }
  const login=(extra={})=>post('login',{identifier:'gunner',password,...extra});
  return {auth,workspace,url,origin,directory,post,login,get cookie(){return cookie;},get csrf(){return csrf;},now:()=>time,advance:delta=>{time+=delta;}};
}

test('every private API is gated and seed/source/secret paths are never public',async t=>{
  const a=await app(t,{active:false});
  for(const path of ['/api/workspace','/api/market/quotes','/api/market/chart','/api/market/setup','/api/market/level-history','/api/company','/api/news','/api/earnings','/api/calendar','/api/sentiment'])assert.equal((await fetch(a.url+path)).status,401,path);
  for(const path of ['/data/levels.txt','/data/watchlist.txt','/server/seed/levels.txt','/.data/workspace.sqlite','/.data/auth.key','/@fs/home/gunner/Sites/Trading/.data/auth.key','/%2edata/auth.sqlite'])assert.equal((await fetch(a.url+path)).status,404,path);
  const status=await(await fetch(a.url+'/api/auth/session')).json();assert.deepEqual(status,{authenticated:false,configured:false});
  assert.ok(!(await(await fetch(a.url+'/')).text()).includes('LVLS'));
});

test('owner activation needs an expiring one-use server token and never stores a password in plaintext',async t=>{
  const a=await app(t,{active:false}),token=a.auth.issueSetup().token;
  assert.equal((await a.post('setup',{token:'wrong',password})).response.status,400);
  assert.equal((await a.post('setup',{token,password},{Origin:'https://attacker.example'})).response.status,403);
  assert.equal((await a.post('setup',{token,password:'short'})).response.status,400);
  const activated=await a.post('setup',{token,password});assert.equal(activated.response.status,200);assert.equal(activated.body.user.email,'owner@example.com');assert.equal(activated.body.user.name,'Workspace owner');
  assert.match(activated.response.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);assert.equal(activated.response.headers.get('cache-control'),'no-store');
  assert.equal(await passwordMatches(password,a.auth.owner().password),true);assert.ok(!a.auth.owner().password.includes(password));
  assert.equal((await a.post('setup',{token,password})).response.status,400);
  const next=a.auth.issueSetup({recover:true});a.advance(31*60000);assert.equal((await a.post('setup',{token:next.token,password})).response.status,400);
  assert.equal(statSync(join(a.directory,'auth.key')).mode&0o777,0o600);assert.equal(statSync(join(a.directory,'auth.sqlite')).mode&0o777,0o600);
});

test('email and username sign-in work; forged origins, CSRF tokens, duplicate cookies and wrong credentials fail',async t=>{
  const a=await app(t),unknown=await a.post('login',{identifier:'someone@example.com',password}),wrong=await a.post('login',{identifier:'gunner',password:'wrong'});
  assert.equal(unknown.response.status,401);assert.deepEqual(unknown.body,wrong.body);
  assert.equal((await a.post('login',{identifier:'GUNNER',password})).response.status,200);
  assert.equal((await a.post('login',{identifier:'OWNER@EXAMPLE.COM',password})).response.status,200);
  const before=a.workspace.read(),body=JSON.stringify(before),headers={Cookie:a.cookie,Origin:a.url,'Content-Type':'application/json','X-Opening-Bell-Client':'web'};
  assert.equal((await fetch(a.url+'/api/workspace',{method:'PUT',headers,body})).status,403);
  assert.equal((await fetch(a.url+'/api/workspace',{method:'PUT',headers:{...headers,'X-CSRF-Token':a.csrf,Origin:'https://evil.example'},body})).status,403);
  assert.equal((await fetch(a.url+'/api/workspace',{method:'PUT',headers:{...headers,'X-CSRF-Token':a.csrf},body})).status,200);
  assert.equal((await fetch(a.url+'/api/workspace',{headers:{Cookie:a.cookie+'; '+a.cookie}})).status,401);
  assert.equal((await fetch(a.url+'/api/workspace',{headers:{Cookie:a.cookie,'Sec-Fetch-Site':'cross-site'}})).status,403);
  assert.equal((await fetch(a.url+'/api/workspace',{headers:{Cookie:a.cookie}})).status,200);
});

test('existing owner identity, credentials, recovery codes, sessions and workspace survive new default configuration',async t=>{
  const a=await app(t),secret=new Secret({size:20});
  a.auth.db.prepare('UPDATE owner SET email=?,totp=? WHERE id=1').run('custom.owner@example.com',a.auth.encrypt(secret.base32));
  const session=a.auth.newSession();a.auth.recoveryCodes();
  const before=a.auth.owner(),workspace=a.workspace.read(),recovery=a.auth.db.prepare('SELECT * FROM recovery ORDER BY code').all();
  for(let i=0;i<2;i++){
    const reopened=openAuthStore({directory:a.directory,now:a.now});
    assert.deepEqual({...reopened.owner()},{...before});
    assert.deepEqual({...reopened.session(session.token)},session.row);
    assert.deepEqual(reopened.db.prepare('SELECT * FROM recovery ORDER BY code').all(),recovery);
    reopened.close();
  }
  assert.deepEqual(a.workspace.read(),workspace);
  assert.equal((await a.post('login',{identifier:'owner@example.com',password})).response.status,401);
  const signedIn=await a.post('login',{identifier:'CUSTOM.OWNER@EXAMPLE.COM',password,code:new TOTP({secret}).generate({timestamp:a.now()})});
  assert.equal(signedIn.response.status,200);assert.equal(signedIn.body.user.email,'custom.owner@example.com');
});

test('sessions rotate on login, are stored as hashes, persist across restart and are revoked on logout',async t=>{
  const a=await app(t);await a.login();const first=a.cookie,token=first.split('=')[1];
  assert.ok(!readFileSync(join(a.directory,'auth.sqlite')).includes(Buffer.from(token)));
  const reopened=openAuthStore({directory:a.directory,now:a.now});assert.ok(reopened.session(token));reopened.close();
  await a.login();assert.notEqual(a.cookie,first);assert.equal((await fetch(a.url+'/api/workspace',{headers:{Cookie:first}})).status,401);
  const active=a.cookie,loggedOut=await a.post('logout');assert.match(loggedOut.response.headers.get('set-cookie'),/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT$/);assert.equal((await fetch(a.url+'/api/workspace',{headers:{Cookie:active}})).status,401);
  await a.login();const another=a.auth.newSession().token;await a.post('logout-all');assert.equal(a.auth.session(another),null);
});

test('persistent sessions last 30 days including a week away; polling and interaction never extend the deadline',async t=>{
  const a=await app(t),signedIn=await a.login(),day=24*60*60_000,expires=signedIn.body.expiresAt;
  assert.equal(AUTH_MAX_MS,30*day);assert.equal(AUTH_IDLE_MS,AUTH_MAX_MS);
  assert.equal(expires,a.now()+30*day);
  const cookie=signedIn.response.headers.get('set-cookie');
  assert.match(cookie,/; Max-Age=2592000;/);
  assert.ok(cookie.endsWith('; Expires='+new Date(expires).toUTCString()));
  a.advance(7*day+1);
  assert.equal((await fetch(a.url+'/api/workspace',{headers:{Cookie:a.cookie}})).status,200);
  const restored=openAuthStore({directory:a.directory,now:a.now});
  assert.equal(restored.session(a.cookie.split('=')[1]).expires,expires);restored.close();
  a.advance(22*day);
  const activity=await a.post('activity');assert.equal(activity.response.status,200);assert.equal(activity.body.expiresAt,expires);
  assert.equal(activity.response.headers.get('set-cookie'),null);
  a.advance(expires-a.now()-1);
  assert.equal((await fetch(a.url+'/api/workspace',{headers:{Cookie:a.cookie}})).status,200);
  a.advance(1);
  assert.equal((await a.post('activity')).response.status,401);
  assert.equal((await fetch(a.url+'/api/workspace',{headers:{Cookie:a.cookie}})).status,401);
  assert.equal(a.auth.db.prepare('SELECT count(*) n FROM sessions').get().n,0);
});

test('old eight-hour sessions keep their original idle and absolute deadlines and expired sessions are not revived',async t=>{
  const a=await app(t);await a.login();
  a.auth.db.prepare('UPDATE sessions SET expires=created+?').run(8*60*60_000);
  const expires=a.now()+8*60*60_000;
  a.advance(29*60_000);
  const active=await a.post('activity');assert.equal(active.response.status,200);assert.equal(active.body.expiresAt,expires);
  assert.equal(active.body.idleExpiresAt,a.now()+30*60_000);
  a.advance(30*60_000);
  assert.equal((await fetch(a.url+'/api/workspace',{headers:{Cookie:a.cookie}})).status,401);
  await a.login();a.auth.db.prepare('UPDATE sessions SET expires=created+?').run(8*60*60_000);
  for(let i=0;i<16;i++){a.advance(29*60_000);assert.equal((await a.post('activity')).response.status,200);}
  a.advance(16*60_000);assert.equal((await a.post('activity')).response.status,401);
});

test('password change requires current credentials, revokes other sessions and preserves the trading workspace',async t=>{
  const a=await app(t);await a.login();const before=a.workspace.read(),other=a.auth.newSession().token;
  assert.equal((await a.post('password',{password:'incorrect',newPassword:'Another strong private passphrase!'})).response.status,401);
  const oldCookie=a.cookie;assert.equal((await a.post('password',{password,newPassword:'Another strong private passphrase!'})).response.status,200);
  assert.equal(a.auth.session(other),null);assert.notEqual(a.cookie,oldCookie);assert.deepEqual(a.workspace.read(),before);
  assert.equal((await a.login()).response.status,401);assert.equal((await a.login({password:'Another strong private passphrase!'})).response.status,200);
});

test('TOTP enrollment verifies ownership, encrypts the secret, blocks code replay and issues single-use recovery codes',async t=>{
  const a=await app(t);await a.login();const enrolled=await a.post('totp/start',{password});assert.equal(enrolled.response.status,200);
  assert.ok(!a.auth.owner().pending_totp.includes(enrolled.body.secret));assert.match(enrolled.body.qr,/^data:image\/png;base64,/);
  const totp=new TOTP({secret:Secret.fromBase32(enrolled.body.secret)}),code=()=>totp.generate({timestamp:a.now()});
  const confirmed=await a.post('totp/confirm',{code:code()});assert.equal(confirmed.response.status,200);assert.equal(confirmed.body.user.mfaEnabled,true);assert.equal(confirmed.body.recoveryCodes.length,10);
  assert.match(confirmed.response.headers.get('set-cookie'),/; Max-Age=2592000;/);
  assert.equal((await a.login({code:code()})).response.status,401);a.advance(30000);assert.equal((await a.login({code:code()})).response.status,200);
  assert.equal((await a.login({code:code()})).response.status,401);
  const recovery=confirmed.body.recoveryCodes[0];assert.equal((await a.login({code:recovery})).response.status,200);assert.equal((await a.login({code:recovery})).response.status,401);
  assert.ok(!a.auth.db.prepare('SELECT code FROM recovery').all().some(row=>row.code===recovery.replaceAll('-','')));
});

test('failed attempts are bounded, survive restart and ignore spoofed forwarding headers',async t=>{
  const a=await app(t);for(let i=0;i<8;i++)assert.equal((await a.post('setup',{token:'invalid',password},{'X-Forwarded-For':`10.0.0.${i}`})).response.status,400);
  const limited=await a.login();assert.equal(limited.response.status,429);assert.equal(limited.response.headers.get('retry-after'),'900');
  const reopened=openAuthStore({directory:a.directory,now:a.now});assert.throws(()=>reopened.throttle('127.0.0.1'),e=>e.status===429);reopened.close();a.advance(15*60000+1);assert.equal((await a.login()).response.status,200);
});

test('public configuration requires HTTPS, secure host cookies and MFA before the standalone server starts',async t=>{
  assert.throws(()=>authConfig({NODE_ENV:'production'}));assert.throws(()=>authConfig({OPENING_BELL_ORIGIN:'http://example.com'}));assert.throws(()=>authConfig({OPENING_BELL_ORIGIN:'https://example.com/path'}));
  const config=authConfig({OPENING_BELL_ORIGIN:'https://desk.example'}),a=await app(t,{config});
  assert.equal((await a.login()).response.status,503);
  const secret=new Secret({size:20});a.auth.db.prepare('UPDATE owner SET totp=? WHERE id=1').run(a.auth.encrypt(secret.base32));
  const login=await a.login({code:new TOTP({secret}).generate({timestamp:a.now()})});assert.match(login.response.headers.get('set-cookie'),/^__Host-ob_session=.*; Path=\/; HttpOnly; SameSite=Strict; Secure; Max-Age=2592000; Expires=/);assert.equal(login.response.headers.get('strict-transport-security'),'max-age=31536000');assert.match(login.response.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.equal((await a.post('setup',{token:a.auth.issueSetup({recover:true}).token,password})).response.status,403);
  assert.equal((await fetch(a.url+'/api/auth/session',{headers:{'X-Forwarded-Host':'desk.example','X-Forwarded-Proto':'https'}})).status,403);
  a.auth.db.prepare('UPDATE owner SET totp=NULL WHERE id=1').run();
  const child=spawnSync(process.execPath,['server/index.mjs'],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...process.env,NODE_ENV:'production',OPENING_BELL_ORIGIN:config.origin,OPENING_BELL_DATA_DIR:a.directory,OPENING_BELL_PORT:'42877'},encoding:'utf8',timeout:10000});
  assert.notEqual(child.status,0);assert.match(child.stderr,/enable two-step verification locally/);
  assert.equal(existsSync(new URL('../dist/client/data/levels.txt',import.meta.url)),false);assert.equal(existsSync(new URL('../dist/client/data/watchlist.txt',import.meta.url)),false);
});

import {fileURLToPath} from 'node:url';

test('Transfers requires a short-lived authenticator grant bound to the current session; summary stays available',async t=>{
 const a=await app(t);await a.login();
 assert.equal((await a.post('transfers-unlock',{password})).response.status,403);
 const secret=new Secret({size:20});a.auth.db.prepare('UPDATE owner SET totp=? WHERE id=1').run(a.auth.encrypt(secret.base32));
 const code=()=>new TOTP({secret}).generate({timestamp:a.now()});
 const read=(path,token,cookie=a.cookie)=>fetch(a.url+path,{headers:{Cookie:cookie,...(token?{'X-Transfers-Token':token}:{})}});
 assert.equal((await read('/api/transfers')).status,423);
 assert.equal((await read('/api/transfers/summary')).status,200);
 assert.equal((await a.post('transfers-unlock',{code:'invalid'})).response.status,403);
 assert.equal((await a.post('transfers-unlock',{code:code()},{'X-CSRF-Token':'bad'})).response.status,403);
 const grant=(await a.post('transfers-unlock',{code:code()})).body;assert.ok(grant.token);assert.equal((await read('/api/transfers',grant.token)).status,200);
 const other=a.auth.newSession();assert.equal((await read('/api/transfers',grant.token,'ob_local_session='+other.token)).status,423);
 await a.post('transfers-lock',{}, {'X-Transfers-Token':grant.token});assert.equal((await read('/api/transfers',grant.token)).status,423);
 assert.equal((await a.post('transfers-unlock',{code:code()})).response.status,403);a.advance(30000);
 const next=(await a.post('transfers-unlock',{code:code()})).body;a.advance(15*60_000+1);assert.equal((await read('/api/transfers',next.token)).status,423);assert.equal((await read('/api/transfers/summary')).status,200);
 const final=(await a.post('transfers-unlock',{code:code()})).body;await a.post('logout');assert.equal((await read('/api/transfers',final.token)).status,401);
});

test('Transfers accepts only fresh enrolled TOTP, never password or recovery-code fallback',async t=>{
 const a=await app(t);await a.login();const secret=new Secret({size:20});
 a.auth.db.prepare('UPDATE owner SET totp=? WHERE id=1').run(a.auth.encrypt(secret.base32));
 const recovery=a.auth.recoveryCodes()[0];
 assert.equal((await a.post('transfers-unlock',{password})).response.status,403);
 assert.equal((await a.post('transfers-unlock',{code:recovery})).response.status,403);
 assert.equal(a.auth.db.prepare('SELECT count(*) n FROM recovery').get().n,10);
 const stale=new TOTP({secret}).generate({timestamp:a.now()-120000});
 assert.equal((await a.post('transfers-unlock',{code:stale})).response.status,403);
 const code=new TOTP({secret}).generate({timestamp:a.now()});
 assert.equal((await a.login({code})).response.status,200);
 assert.equal((await a.post('transfers-unlock',{code})).response.status,403);
 a.advance(30000);
 assert.equal((await a.post('transfers-unlock',{code:new TOTP({secret}).generate({timestamp:a.now()})})).response.status,200);
});
