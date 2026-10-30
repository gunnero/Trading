import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {openAuthStore,passwordHash} from '../server/auth.mjs';
import {Secret,TOTP} from 'otpauth';
export async function testRuntime({authenticated=true}={}){
 const directory=mkdtempSync(join(tmpdir(),'opening-bell-browser-'));
 const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const url=`http://127.0.0.1:${port}`;let child,output='';
 const prior={};for(const key of ['SESSION','CSRF','ORIGIN']){prior[key]=process.env['OPENING_BELL_TEST_'+key];delete process.env['OPENING_BELL_TEST_'+key];}
 if(authenticated){
  const auth=openAuthStore({directory});
  try{auth.db.prepare('UPDATE owner SET password=?,totp=? WHERE id=1').run(await passwordHash('Isolated browser fixture passphrase 2026!'),auth.encrypt(new Secret({size:20}).base32));const session=auth.newSession();process.env.OPENING_BELL_TEST_SESSION=session.token;process.env.OPENING_BELL_TEST_CSRF=auth.csrf(session.row.id);process.env.OPENING_BELL_TEST_ORIGIN=url;}finally{auth.close();}
 }
 async function start(){
  child=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,NODE_ENV:'test',OPENING_BELL_ORIGIN:'',OPENING_BELL_PORT:String(port),OPENING_BELL_DATA_DIR:directory,OPENING_BELL_ALLOWED_ORIGINS:''},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',s=>{output+=s;});child.stderr.on('data',s=>{output+=s;});
  for(let i=0;i<100;i++){if(child.exitCode!==null)throw new Error(output);try{if((await fetch(`${url}/api/auth/session`)).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}
  throw new Error(`Test runtime did not start. ${output}`);
 }
 async function stop(){if(child&&child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await exited;}}
 async function close(){await stop();rmSync(directory,{recursive:true,force:true});for(const key of ['SESSION','CSRF','ORIGIN']){if(prior[key]===undefined)delete process.env['OPENING_BELL_TEST_'+key];else process.env['OPENING_BELL_TEST_'+key]=prior[key];}}
 try{await start();}catch(e){await close();throw e;}
 // Rotate only this temporary fixture's factor to avoid wall-clock waits between UI scenarios.
 // Replay rejection is tested against a fixed secret in auth.test.mjs.
 function authenticatorCode(){const auth=openAuthStore({directory});try{const secret=new Secret({size:20});auth.db.prepare('UPDATE owner SET totp=?,last_counter=-1 WHERE id=1').run(auth.encrypt(secret.base32));return new TOTP({secret}).generate();}finally{auth.close();}}
 return {url,directory,start,stop,close,authenticatorCode};
}
