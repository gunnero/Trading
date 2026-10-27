import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {openAuthStore} from '../server/auth.mjs';

const recover=process.argv.includes('--recover'),store=openAuthStore();
try{
  const access=store.issueSetup({recover}),port=Number(process.env.OPENING_BELL_PORT||4173);
  const url=`http://127.0.0.1:${port}/#activate=${access.token}`;
  writeFileSync(join(store.directory,'owner-setup.json'),JSON.stringify({...access,url},null,2),{mode:0o600});
  writeFileSync(join(store.directory,'owner-setup.html'),`<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Opening Bell owner activation</title><h1>Opening Bell owner activation</h1><p>This private, one-use link expires in 30 minutes. Choose your password inside the app.</p><a href="${url}" rel="noreferrer">${recover?'Recover':'Activate'} your owner account</a>`,{mode:0o600});
  console.log(`Private ${recover?'recovery':'activation'} link saved in ${join(store.directory,'owner-setup.html')}. Expires in 30 minutes. No password has been generated or logged.`);
}finally{store.close();}
