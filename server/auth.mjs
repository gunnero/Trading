import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHash,createHmac,scrypt,timingSafeEqual,createCipheriv,createDecipheriv} from 'node:crypto';
import {promisify} from 'node:util';
import {mkdirSync,chmodSync,readFileSync,writeFileSync,existsSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {TOTP,Secret} from 'otpauth';
import QRCode from 'qrcode';

// Initial identity only. Existing private databases retain their owner's profile.
export const OWNER={email:process.env.OPENING_BELL_OWNER_EMAIL||'owner@example.com',username:process.env.OPENING_BELL_OWNER_USERNAME||'gunner',name:process.env.OPENING_BELL_OWNER_NAME||'Workspace owner'};
export const AUTH_IDLE_MS=30*60_000,AUTH_MAX_MS=8*60*60_000;
const derive=promisify(scrypt),hash=value=>createHash('sha256').update(value).digest('hex');
const random=()=>randomBytes(32).toString('base64url');
const fail=(status,message)=>Object.assign(new Error(message),{status});
const safeEqual=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const dummy=`scrypt$131072$8$1$${Buffer.alloc(16).toString('base64url')}$${Buffer.alloc(64).toString('base64url')}`;
const cost={N:131072,r:8,p:1,maxmem:160*1024*1024};
export function validatePassword(password){
  if(typeof password!=='string'||[...password].length<15||[...password].length>128||Buffer.byteLength(password)>512)throw fail(400,'Use a password or passphrase with 15–128 characters.');
  const weak=new Set(['passwordpassword','password123456789','123456789012345','1234567890123456','qwertyuiopasdfgh','letmeinletmeinletmein','aleksandardimovski','aleksandardimovski123','aleksandardimovski123!']);
  if(weak.has(password.toLowerCase().trim())||/^(.)\1+$/.test(password))throw fail(400,'Choose a less predictable password or passphrase.');
}
export async function passwordHash(password){
  validatePassword(password);const salt=randomBytes(16).toString('base64url');
  const result=await derive(password,Buffer.from(salt,'base64url'),64,cost);
  return `scrypt$131072$8$1$${salt}$${result.toString('base64url')}`;
}
export async function passwordMatches(password,record){
  if(typeof password!=='string'||Buffer.byteLength(password)>512)return false;
  const parts=(record||dummy).split('$');
  if(parts.length!==6||parts.slice(0,4).join('$')!=='scrypt$131072$8$1')return false;
  const expected=Buffer.from(parts[5],'base64url'),salt=Buffer.from(parts[4],'base64url');if(expected.length!==64||salt.length!==16)return false;
  const result=await derive(password,salt,64,cost);return timingSafeEqual(result,expected)&&!!record;
}
export function authConfig(env=process.env){
  let origin=null;
  if(env.OPENING_BELL_ORIGIN){
    const url=new URL(env.OPENING_BELL_ORIGIN);
    if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('OPENING_BELL_ORIGIN must be a single HTTPS origin without a path.');
    origin=url.origin;
  }
  if(env.NODE_ENV==='production'&&!origin)throw Error('Public mode requires OPENING_BELL_ORIGIN=https://your-domain and an HTTPS reverse proxy.');
  return {origin,secure:!!origin,cookieName:origin?'__Host-ob_session':'ob_local_session'};
}
export function openAuthStore({directory=process.env.OPENING_BELL_DATA_DIR||fileURLToPath(new URL('../.data/',import.meta.url)),now=Date.now}={}){
  mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700);
  const filename=join(directory,'auth.sqlite'),keyFile=join(directory,'auth.key');
  if(!existsSync(keyFile)){
    if(existsSync(filename))throw Error('Authentication encryption key is missing. Restore auth.key from the protected backup.');
    writeFileSync(keyFile,randomBytes(32),{mode:0o600,flag:'wx'});
  }
  chmodSync(keyFile,0o600);const key=readFileSync(keyFile);if(key.length!==32)throw Error('Invalid authentication encryption key.');
  const db=new DatabaseSync(filename);chmodSync(filename,0o600);db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  db.exec(`CREATE TABLE IF NOT EXISTS owner(id INTEGER PRIMARY KEY CHECK(id=1),email TEXT NOT NULL,username TEXT NOT NULL,name TEXT NOT NULL,password TEXT,totp TEXT,last_counter INTEGER NOT NULL DEFAULT -1,pending_totp TEXT,pending_until INTEGER,pending_session TEXT);
    CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,created INTEGER NOT NULL,active INTEGER NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS recovery(code TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS setup(id INTEGER PRIMARY KEY CHECK(id=1),token TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS attempts(bucket TEXT PRIMARY KEY,started INTEGER NOT NULL,count INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,at INTEGER NOT NULL,event TEXT NOT NULL);`);
  db.prepare('INSERT OR IGNORE INTO owner(id,email,username,name) VALUES(1,?,?,?)').run(OWNER.email,OWNER.username,OWNER.name);
  const owner=()=>db.prepare('SELECT * FROM owner WHERE id=1').get();
  function transaction(work){db.exec('BEGIN IMMEDIATE');try{const value=work();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}}
  function encrypt(secret,purpose='totp'){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(`opening-bell:${purpose}:v1`));const encrypted=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');}
  function decrypt(secret,purpose='totp'){const bytes=Buffer.from(secret,'base64url'),cipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));cipher.setAAD(Buffer.from(`opening-bell:${purpose}:v1`));cipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString('utf8');}
  function event(name){db.prepare('INSERT INTO events(at,event) VALUES(?,?)').run(now(),name);db.prepare('DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY id DESC LIMIT 100)').run();}
  function cleanup(){db.prepare('DELETE FROM sessions WHERE expires<=? OR active<=?').run(now(),now()-AUTH_IDLE_MS);db.prepare('DELETE FROM attempts WHERE started<?').run(now()-15*60_000);}
  function throttle(ip){
    cleanup();
    transaction(()=>{for(const [bucket,limit] of [[hash('ip:'+ip),8],['global',24]]){
      const old=db.prepare('SELECT * FROM attempts WHERE bucket=?').get(bucket);
      if(old&&old.count>=limit)throw fail(429,'Too many attempts. Wait 15 minutes before trying again.');
    }for(const bucket of [hash('ip:'+ip),'global'])db.prepare('INSERT INTO attempts(bucket,started,count) VALUES(?,?,1) ON CONFLICT(bucket) DO UPDATE SET count=count+1').run(bucket,now());});
  }
  function csrf(id){return createHmac('sha256',key).update('csrf:'+id).digest('base64url');}
  function session(token){
    if(typeof token!=='string'||!/^[-\w]{43}$/.test(token))return null;
    const row=db.prepare('SELECT * FROM sessions WHERE id=?').get(hash(token));
    if(!row)return null;
    if(row.expires<=now()||row.active+AUTH_IDLE_MS<=now()){db.prepare('DELETE FROM sessions WHERE id=?').run(row.id);return null;}
    return row;
  }
  function newSession(oldId){
    cleanup();if(oldId)db.prepare('DELETE FROM sessions WHERE id=?').run(oldId);
    const token=random(),id=hash(token),created=now(),expires=created+AUTH_MAX_MS;
    db.prepare('INSERT INTO sessions(id,created,active,expires) VALUES(?,?,?,?)').run(id,created,created,expires);
    db.prepare('DELETE FROM sessions WHERE id NOT IN (SELECT id FROM sessions ORDER BY created DESC,rowid DESC LIMIT 5)').run();
    return {token,row:{id,created,active:created,expires}};
  }
  function profile(row){const user=owner();return {authenticated:true,user:{email:user.email,username:user.username,name:user.name,mfaEnabled:!!user.totp},csrf:csrf(row.id),idleExpiresAt:row.active+AUTH_IDLE_MS,expiresAt:row.expires,sessionCount:db.prepare('SELECT count(*) n FROM sessions WHERE expires>? AND active>?').get(now(),now()-AUTH_IDLE_MS).n};}
  function secondFactor(user,code){
    if(!user.totp)return {kind:'none'};
    if(typeof code!=='string')return null;
    const normalized=code.replace(/[\s-]/g,'').toUpperCase();
    if(/^[A-F0-9]{32}$/.test(normalized)&&db.prepare('SELECT code FROM recovery WHERE code=?').get(hash(normalized)))return {kind:'recovery',hash:hash(normalized)};
    if(!/^\d{6}$/.test(code))return null;
    const totp=new TOTP({secret:Secret.fromBase32(decrypt(user.totp))}),delta=totp.validate({token:code,timestamp:now(),window:1});
    const counter=Math.floor(now()/30000)+(delta??0);return delta!==null&&counter>user.last_counter?{kind:'totp',counter}:null;
  }
  function consumeFactor(factor){
    if(factor.kind==='totp'&&!db.prepare('UPDATE owner SET last_counter=? WHERE id=1 AND last_counter<?').run(factor.counter,factor.counter).changes)throw fail(401,'The code was already used. Wait for the next code.');
    if(factor.kind==='recovery'&&!db.prepare('DELETE FROM recovery WHERE code=?').run(factor.hash).changes)throw fail(401,'The recovery code was already used.');
  }
  function recoveryCodes(){
    const codes=Array.from({length:10},()=>randomBytes(16).toString('hex').toUpperCase());db.prepare('DELETE FROM recovery').run();for(const code of codes)db.prepare('INSERT INTO recovery(code) VALUES(?)').run(hash(code));return codes.map(code=>code.match(/.{1,8}/g).join('-'));
  }
  function issueSetup({recover=false}={}){
    if(owner().password&&!recover)throw Error('The owner is already activated. Use the explicit recovery command to reset access.');
    const token=random(),expires=now()+30*60_000;db.prepare('INSERT INTO setup(id,token,expires) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET token=excluded.token,expires=excluded.expires').run(hash(token),expires);event(recover?'recovery_requested':'setup_requested');return {token,expires};
  }
  function validSetup(token){const row=db.prepare('SELECT * FROM setup WHERE id=1').get();return typeof token==='string'&&token.length===43&&row&&row.expires>now()&&safeEqual(hash(token),row.token);}
  return {db,now,owner,transaction,encrypt,decrypt,event,throttle,csrf,session,newSession,profile,secondFactor,consumeFactor,recoveryCodes,issueSetup,validSetup,directory,close:()=>db.close()};
}

function json(res,status,value){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(value));}
async function body(req){
  if(req.headers['content-type']?.split(';')[0].trim().toLowerCase()!=='application/json'||req.headers['x-opening-bell-client']!=='web')throw fail(415,'Use a JSON app request.');
  if(Number(req.headers['content-length'])>16_384)throw fail(413,'Request too large.');
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>16_384)throw fail(413,'Request too large.');chunks.push(chunk);}
  let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fail(400,'Invalid request.');}
  if(!data||typeof data!=='object'||Array.isArray(data))throw fail(400,'Invalid request.');return data;
}
export function authMiddleware(store,{config=authConfig(),development=false}={}){
  let hashing=0;
  const cookie=(res,token)=>res.setHeader('Set-Cookie',`${config.cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict${config.secure?'; Secure':''}${token?'':'; Max-Age=0'}`);
  async function costly(work){if(hashing>=2)throw fail(429,'Sign-in is busy. Try again shortly.');hashing++;try{return await work();}finally{hashing--;}}
  function current(row){if(!row||!store.db.prepare('SELECT id FROM sessions WHERE id=? AND expires>? AND active>?').get(row.id,store.now(),store.now()-AUTH_IDLE_MS))throw fail(401,'Your session expired. Sign in again.');}
  function signedIn(res,result){cookie(res,result.token);return json(res,200,store.profile(result.row));}
  async function reauthenticate(row,data,ip){
    store.throttle(ip);const user=store.owner();
    if(!await costly(()=>passwordMatches(data.password,user.password)))throw fail(401,'Check your password and verification code.');
    current(row);const updated=store.owner();if(updated.password!==user.password||updated.totp!==user.totp)throw fail(401,'Your account changed. Sign in again.');
    const factor=store.secondFactor(updated,data.code);if(!factor)throw fail(401,'Check your password and verification code.');
    store.consumeFactor(factor);return updated;
  }
  return async(req,res,next)=>{
    try{
      res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Resource-Policy','same-origin');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
      res.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self'${development?" 'unsafe-inline'":''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://s.yimg.com https://g.foolcdn.com https://cdn.content.foolcdn.com https://images.mktw.net https://247wallst.com; font-src 'self'; connect-src 'self'${development?' ws://127.0.0.1:* ws://localhost:*':''}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
      if(config.secure)res.setHeader('Strict-Transport-Security','max-age=31536000');
      const url=new URL(req.url,'http://localhost'),path=decodeURIComponent(url.pathname),host=req.headers.host||'';
      const expected=config.origin||`http://${host}`;let validHost=false;
      try{const parsed=new URL(`http://${host}`);validHost=config.origin?host===new URL(config.origin).host:['127.0.0.1','localhost','[::1]','terminal.local'].includes(parsed.hostname)&&!parsed.username&&!parsed.password&&parsed.pathname==='/';}catch{}
      if(!validHost)throw fail(403,'This host is not allowed.');
      if(path.startsWith('/api/')&&(req.headers['sec-fetch-site']==='cross-site'||req.headers.origin&&req.headers.origin!==expected))throw fail(403,'Use this app’s own origin.');
      const tokens=(req.headers.cookie||'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(config.cookieName+'='));
      const row=tokens.length===1?store.session(tokens[0].slice(config.cookieName.length+1)):null;
      if(path==='/api/auth/session'&&req.method==='GET')return json(res,200,row?store.profile(row):{authenticated:false,configured:!!store.owner().password});
      const publicAuth=['/api/auth/login','/api/auth/setup'].includes(path);
      if(config.secure&&path.startsWith('/api/')&&path!=='/api/auth/setup'&&(!store.owner().password||!store.owner().totp))throw fail(503,'Account protection must be completed locally before public access is enabled.');
      if(path.startsWith('/api/')&&!publicAuth&&!row)throw fail(401,'Sign in to access your workspace.');
      if(!['GET','HEAD'].includes(req.method)){
        if(req.headers.origin!==expected||req.headers['sec-fetch-site']==='cross-site')throw fail(403,'The request must come from this app.');
        if(!publicAuth&&(!row||!safeEqual(req.headers['x-csrf-token'],store.csrf(row.id))))throw fail(403,'The session check failed. Refresh and try again.');
      }
      if(path.startsWith('/api/auth/')){
        if(config.secure&&path==='/api/auth/setup')throw fail(403,'Owner activation and recovery are available only in local mode.');
        if(req.method!=='POST')throw fail(405,'Use POST for this action.');
        const data=await body(req),ip=req.socket.remoteAddress||'unknown';
        if(path==='/api/auth/setup'){
          store.throttle(ip);if(!store.validSetup(data.token))throw fail(400,'This activation link is invalid or expired.');
          const password=await costly(()=>passwordHash(data.password));
          const result=store.transaction(()=>{
            if(!store.validSetup(data.token))throw fail(400,'This activation link is invalid or expired.');
            store.db.prepare('UPDATE owner SET password=?,totp=NULL,last_counter=-1,pending_totp=NULL,pending_until=NULL,pending_session=NULL WHERE id=1').run(password);
            store.db.exec('DELETE FROM setup; DELETE FROM sessions; DELETE FROM recovery; DELETE FROM attempts;');store.event('owner_activated');return store.newSession();
          });
          for(const file of ['owner-setup.json','owner-setup.html']){try{unlinkSync(join(store.directory,file));}catch{}}
          return signedIn(res,result);
        }
        if(path==='/api/auth/login'){
          store.throttle(ip);const user=store.owner(),identifier=typeof data.identifier==='string'?data.identifier.trim().toLowerCase().slice(0,254):'';
          const matches=await costly(()=>passwordMatches(data.password,user.password));
          if(!matches||![user.email.toLowerCase(),user.username.toLowerCase()].includes(identifier)){store.event('login_failed');throw fail(401,'Check your sign-in details and verification code.');}
          const result=store.transaction(()=>{
            const latest=store.owner();if(latest.password!==user.password||latest.totp!==user.totp)throw fail(401,'Check your sign-in details and verification code.');
            const factor=store.secondFactor(latest,data.code);if(!factor){store.event('login_failed');throw fail(401,'Check your sign-in details and verification code.');}
            store.consumeFactor(factor);store.event('login_succeeded');return store.newSession(row?.id);
          });return signedIn(res,result);
        }
        current(row);
        if(path==='/api/auth/logout'||path==='/api/auth/logout-all'){
          if(path.endsWith('logout-all'))store.db.prepare('DELETE FROM sessions').run();else store.db.prepare('DELETE FROM sessions WHERE id=?').run(row.id);
          cookie(res,'');res.setHeader('Clear-Site-Data','"cache"');store.event('signed_out');return json(res,200,{authenticated:false});
        }
        if(path==='/api/auth/activity'){store.db.prepare('UPDATE sessions SET active=? WHERE id=?').run(store.now(),row.id);row.active=store.now();return json(res,200,store.profile(row));}
        if(path==='/api/auth/password'){
          const user=await reauthenticate(row,data,ip);validatePassword(data.newPassword);const password=await costly(()=>passwordHash(data.newPassword));
          const result=store.transaction(()=>{current(row);if(store.owner().password!==user.password)throw fail(401,'Your account changed. Sign in again.');store.db.prepare('UPDATE owner SET password=?,pending_totp=NULL,pending_until=NULL,pending_session=NULL WHERE id=1').run(password);store.db.exec('DELETE FROM sessions; DELETE FROM setup;');store.event('password_changed');return store.newSession();});return signedIn(res,result);
        }
        if(path==='/api/auth/totp/start'){
          const user=await reauthenticate(row,data,ip),secret=new Secret({size:20});
          store.db.prepare('UPDATE owner SET pending_totp=?,pending_until=?,pending_session=? WHERE id=1').run(store.encrypt(secret.base32),store.now()+10*60_000,row.id);
          const totp=new TOTP({issuer:'Opening Bell',label:user.email,secret});
          return json(res,200,{secret:secret.base32,qr:await QRCode.toDataURL(totp.toString(),{errorCorrectionLevel:'M',width:240,margin:2})});
        }
        if(path==='/api/auth/totp/confirm'){
          store.throttle(ip);
          const result=store.transaction(()=>{
            const user=store.owner();if(!user.pending_totp||user.pending_until<=store.now()||user.pending_session!==row.id)throw fail(400,'Authenticator setup expired. Start again.');
            const totp=new TOTP({secret:Secret.fromBase32(store.decrypt(user.pending_totp))});
            const delta=typeof data.code==='string'&&/^\d{6}$/.test(data.code)?totp.validate({token:data.code,timestamp:store.now(),window:1}):null;
            if(delta===null)throw fail(400,'Enter the current six-digit code from your authenticator.');
            store.db.prepare('UPDATE owner SET totp=pending_totp,last_counter=?,pending_totp=NULL,pending_until=NULL,pending_session=NULL WHERE id=1').run(Math.floor(store.now()/30000)+delta);
            const recoveryCodes=store.recoveryCodes();store.db.exec('DELETE FROM sessions; DELETE FROM setup;');store.event('two_step_enabled');return {...store.newSession(),recoveryCodes};
          });cookie(res,result.token);return json(res,200,{...store.profile(result.row),recoveryCodes:result.recoveryCodes});
        }
        if(path==='/api/auth/recovery-codes'){
          const user=await reauthenticate(row,data,ip);if(!user.totp)throw fail(400,'Enable two-step verification first.');
          const result=store.transaction(()=>{const recoveryCodes=store.recoveryCodes();store.db.exec('DELETE FROM sessions;');store.event('recovery_codes_replaced');return {...store.newSession(),recoveryCodes};});cookie(res,result.token);return json(res,200,{...store.profile(result.row),recoveryCodes:result.recoveryCodes});
        }
        throw fail(404,'Unknown account action.');
      }
      // Source files, seed imports, databases and dotfiles never belong to the HTTP surface.
      if(path.startsWith('/data/')||path.startsWith('/server/')||path.startsWith('/@fs/')||/(^|\/)\.(?!vite\/)/.test(path))throw fail(404,'Not found.');
      // Vite can otherwise serve arbitrary project files, including QA screenshots and instructions.
      if(development&&!path.startsWith('/api/')&&!['/','/index.html','/favicon.svg','/@vite/client','/@react-refresh'].includes(path)&&!['/src/','/assets/','/node_modules/','/@id/'].some(prefix=>path.startsWith(prefix)))throw fail(404,'Not found.');
      if(path.startsWith('/api/')){res.setHeader('Cache-Control','no-store');req.auth={owner:1,session:row};}
      return await next();
    }catch(error){if(!res.headersSent){if(error.status===429)res.setHeader('Retry-After','900');json(res,error.status||500,{message:error.status?error.message:'The account service could not complete the request.'});}else res.end();}
  };
}
