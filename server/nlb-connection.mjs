import {execFile} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {join,dirname,resolve} from 'node:path';
import {rm} from 'node:fs/promises';
import {openTransfersStore} from './transfers-store.mjs';
import {validDay} from '../src/data/transfers.mjs';
const require=createRequire(import.meta.url);
const cli=join(dirname(require.resolve('nlbcli/package.json')),'dist/index.mjs');
const day=date=>date.toISOString().slice(0,10);
const bankDay=date=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Skopje',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
const bankDate=date=>date.split('-').reverse().join('.');
const fail=(message,status=400)=>Object.assign(Error(message),{status});
export function runNlb(args,{signal}={}){
 // No shell and no caller-controlled command names. Raw CLI output/errors never go to logs.
 return new Promise((resolve,reject)=>execFile(process.execPath,[cli,...args],{timeout:args.includes('login')?155000:60000,maxBuffer:3_000_000,signal,env:{...process.env,NO_COLOR:'1',FORCE_COLOR:'0'}},(error,stdout)=>{
  if(error){const auth=error.code===3;reject(Object.assign(Error(auth?'NLB approval is required. Reconnect and approve on your phone.':'NLB could not complete the read. Saved transactions are unchanged; try again later.'),{auth}));}else resolve(stdout);
 }));
}
export function createNlbConnection(directory,{run=runNlb,now=()=>new Date(),removeSession}={}){
 const store=openTransfersStore(directory),profile='opening-bell-'+createHash('sha256').update(resolve(directory)).digest('hex').slice(0,20);
 const sessionPath=join(process.env.HOME||'~','.nlbcli','profiles',profile,'session.json');
 const erase=removeSession||(()=>rm(sessionPath,{force:true}));
 let job=null,controller=null,closed=false;
 // A process restart never reports a lost background job as still running.
 if(['connecting','syncing'].includes(store.read().data.sync.state))store.change(data=>({...data,sync:{...data.sync,state:'unavailable',message:'The previous operation was interrupted. Retry to continue.'}}));
 const updateSync=patch=>store.change(data=>({...data,sync:{...data.sync,...patch}}));
 const command=(args,interactive=false)=>run(['--profile',profile,...(interactive?[]:['--non-interactive']),...args],{signal:controller?.signal});
 function launch(state,message,work){if(job)throw fail('An NLB operation is already running.',409);controller=new AbortController();updateSync({state,message,lastAttempt:now().toISOString()});job=(async()=>{try{await work();}catch(error){if(!closed)updateSync({state:error.auth?'approval-required':'unavailable',message:error.message?.startsWith('NLB ')?error.message:'The NLB response could not be imported. Saved transactions are unchanged.'});}finally{job=null;controller=null;}})();}
 function login(username){
  if(typeof username!=='string'||!username.trim()||username.length>100||/[\x00-\x1f]/.test(username))throw fail('Enter your NLB Klik username.');
  const last=store.read().data.sync.lastLogin;if(last&&now()-new Date(last)<60000)throw fail('Wait one minute before requesting another phone approval.',429);
  if(job)throw fail('An NLB operation is already running.',409);
  updateSync({lastLogin:now().toISOString()});
  launch('connecting','Approve the NLB login on your phone. This may take up to two minutes.',async()=>{
   await command(['login','--username',username.trim()],true);
   const accounts=await command(['accounts','list']),cards=await command(['cards','list']);
   const candidates=[...[...new Set(accounts.match(/\b\d{3}-\d{10}-\d{2}[A-Z]{2,3}\b/g)||[])].map(id=>({id,kind:'account'})),...[...new Set(cards.match(/\b\d{8,15}\/\d{4}\b/g)||[])].map(id=>({id,kind:'card'}))];
   if(!candidates.length)throw fail('NLB returned no supported accounts or cards.');
   store.change(data=>({...data,candidates,sync:{...data.sync,state:'connected',message:'Connected. Choose the accounts and cards to import.'}}));
  });
 }
 function configure(sources,automatic,revision){
  if(job)throw fail('Wait for the current NLB operation to finish.',409);
  if(!Number.isSafeInteger(revision))throw fail('A ledger revision is required.');
  if(!Array.isArray(sources)||!sources.length||sources.length>4||typeof automatic!=='boolean')throw fail('Select one to four sources.');
  store.change(data=>{const seen=new Set();const selected=sources.map(source=>{
   if(!data.candidates?.some(item=>item.id===source.id&&item.kind===source.kind))throw fail('Choose an account or card returned by NLB.');
   const key=source.kind+':'+source.id;if(seen.has(key))throw fail('A source was selected twice.');seen.add(key);
   if(source.kind==='account'&&!['MKD','EUR','USD'].includes(source.currency))throw fail('Confirm the account currency.');
   if(!validDay(source.since)||source.since>bankDay(now())||source.since<'2000-01-01')throw fail('Choose a valid history start date.');
   if(typeof source.label!=='string'||!source.label.trim()||source.label.length>80)throw fail('Give each source a short label.');
   const old=data.sources.find(item=>item.key===key);
   if(data.rows.some(row=>row.sourceKey===key)&&data.rows.find(row=>row.sourceKey===key)?.currency!==source.currency&&source.kind==='account')throw fail('An imported account currency cannot be changed.');
   return {id:source.id,kind:source.kind,key,label:source.label.trim(),currency:source.kind==='account'?source.currency:null,since:source.since,lastRead:old?.since===source.since?old.lastRead:null};
  });return {...data,sources:selected,automatic,sync:{...data.sync,message:'Sources saved. Sync now to read transactions.'}};},revision);
 }
 function sync(){const initial=store.read().data;if(!initial.sources.length)throw fail('Choose your NLB sources first.');
  launch('syncing','Reading NLB transactions…',async()=>{
   const batches=[],today=bankDay(now());
   for(const source of initial.sources){
    const overlap=day(new Date(Date.parse(bankDay(source.lastRead?new Date(source.lastRead):now()))-45*86400000));let start=source.lastRead&&overlap>source.since?overlap:source.since;const rows=[];
    while(start<=today){const end=day(new Date(Math.min(Date.parse(start)+89*86400000,Date.parse(today))));updateSync({message:`Reading ${source.label}: ${start} to ${end}…`});
     const output=await command([source.kind==='account'?'accounts':'cards','transactions',source.id,'--start',bankDate(start),'--end',bankDate(end),'--format','json']);
     let batch;try{batch=JSON.parse(output);}catch{throw fail('NLB returned an invalid transaction export.');}if(!Array.isArray(batch)||rows.length+batch.length>5000)throw fail('NLB history exceeded the supported import size.');rows.push(...batch);start=day(new Date(Date.parse(end)+86400000));
    }
    batches.push({source,rows});
   }
   store.ingest(batches);
   store.change(data=>({...data,sources:data.sources.map(source=>({...source,lastRead:now().toISOString()})),sync:{...data.sync,state:'connected',lastSuccess:now().toISOString(),message:'Transactions imported. Review new matches before they enter totals.'}}));
  });
 }
 async function disconnect(){controller?.abort();if(job)await job;await erase();store.change(data=>({...data,automatic:false,candidates:[],sync:{...data.sync,state:'disconnected',message:'Disconnected. Your saved ledger is retained.'}}));}
 function checkSchedule(){const {data}=store.read();if(!job&&data.automatic&&data.sources.length&&!['disconnected','approval-required','connecting'].includes(data.sync.state)&&(!data.sync.lastAttempt||now()-new Date(data.sync.lastAttempt)>=3600000)){try{sync();}catch{/* Next scheduled check can retry. */}}}
 const timer=setInterval(checkSchedule,60000);timer.unref();
 async function middleware(req,res,next){
  const path=new URL(req.url,'http://localhost').pathname;if(!path.startsWith('/api/transfers'))return next();
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
  try{
   if(req.method==='GET'&&path==='/api/transfers'){res.end(JSON.stringify(store.read()));return;}
   if(req.method!=='POST')throw fail('Use POST for ledger actions.',405);
   if(req.headers['content-type']?.split(';')[0]!=='application/json'||req.headers['x-opening-bell-client']!=='web')throw fail('A JSON app request is required.',415);
   let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>3_000_000)throw fail('Import exceeds 3 MB.',413);chunks.push(chunk);}
   let body;try{body=JSON.parse(Buffer.concat(chunks));}catch{throw fail('Invalid JSON.');}
   if(!body||typeof body!=='object')throw fail('Invalid request.');
   if(path==='/api/transfers/login')login(body.username);
   else if(path==='/api/transfers/sources')configure(body.sources,body.automatic,body.revision);
   else if(path==='/api/transfers/sync')sync();
   else if(path==='/api/transfers/disconnect')await disconnect();
   else if(path==='/api/transfers/review'){if(!Number.isSafeInteger(body.revision))throw fail('A ledger revision is required.');store.review(body.id,body.review,body.remember===true,body.revision);}
   else if(path==='/api/transfers/reopen'){if(!Number.isSafeInteger(body.revision))throw fail('A ledger revision is required.');store.change(data=>{const row=data.rows.find(row=>row.id===body.id);if(!row)throw fail('Transaction not found.');row.review=null;data.rules=data.rules.filter(rule=>rule.key!==JSON.stringify([row.sourceKey,row.description,row.recipient,row.status,row.amount===null?null:row.amount.startsWith('-')?'-':'+']));return data;},body.revision);}
   else if(path==='/api/transfers/rules/remove'){if(!Number.isSafeInteger(body.revision))throw fail('A ledger revision is required.');store.change(data=>({...data,rules:data.rules.filter(rule=>rule.key!==body.key)}),body.revision);}
   else if(path==='/api/transfers/import'){
    if(job)throw fail('Wait for the bank sync to finish.',409);const source=store.read().data.sources.find(source=>source.key===body.sourceKey);if(!source)throw fail('Choose a configured NLB source.');store.ingest([{source,rows:body.rows}]);
   }else throw fail('Unknown ledger action.',404);
   res.end(JSON.stringify(store.read()));
  }catch(error){res.statusCode=error.status||400;res.end(JSON.stringify({message:error.status?error.message:'The ledger action could not be completed. Check the input and retry.'}));}
 }
 return {middleware,store,login,sync,configure,disconnect,checkSchedule,wait:()=>job,close:async()=>{closed=true;clearInterval(timer);controller?.abort();if(job)await job;store.close();}};
}
