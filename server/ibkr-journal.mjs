import {FLEX_BASE,flexXml,flexError,parseFlexReport,mergeFills,matchFills} from './ibkr-flex.mjs';
import {validateTrade} from '../src/data/journal.mjs';

const PURPOSE='ibkr-journal-flex',INTERVAL=15*60000;
const fail=(status,message)=>Object.assign(new Error(message),{status});
export function createIbkrJournal(account,{fetcher=fetch,now=Date.now,delay=ms=>new Promise(r=>setTimeout(r,ms)),background=false}={}){
  const db=account.db;
  db.exec(`CREATE TABLE IF NOT EXISTS ibkr_journal(id INTEGER PRIMARY KEY CHECK(id=1),credential TEXT,config TEXT,result TEXT NOT NULL,fills TEXT NOT NULL,notes TEXT NOT NULL,revision INTEGER NOT NULL,next_at INTEGER NOT NULL);
    INSERT OR IGNORE INTO ibkr_journal VALUES(1,NULL,NULL,'{}','[]','{}',0,0);`);
  let pending=null,closed=false;
  const row=()=>db.prepare('SELECT * FROM ibkr_journal WHERE id=1').get();
  function status(){const r=row(),result=JSON.parse(r.result);return {configured:!!r.credential,config:r.config?JSON.parse(r.config):null,syncing:!!pending,revision:r.revision,nextAt:r.next_at?new Date(r.next_at).toISOString():null,...result};}
  function read(){const r=row();return {...status(),...matchFills(JSON.parse(r.fills),JSON.parse(r.notes))};}
  async function request(action,token,query){
    const url=new URL(action,FLEX_BASE);url.search=new URLSearchParams({t:token,q:query,v:'3'}).toString();
    let response;
    try{
      response=await fetcher(url.href,{headers:{Accept:'application/xml','User-Agent':'Node/24 TradingDesk/1'},redirect:'error',signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error();
      const reader=response.body.getReader(),chunks=[];let size=0;
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8_000_000){await reader.cancel();throw Error();}chunks.push(value);}
      return Buffer.concat(chunks).toString('utf8');
    }catch{throw fail(502,'IBKR could not return the report. Saved trades are unchanged; automatic sync will retry later.');}
  }
  function checkResponse(doc){
    const response=doc.FlexStatementResponse;
    if(!response)return;
    if(response.Status==='Success')return;
    const code=response.ErrorCode;
    if(['1012','1015'].includes(code))throw flexError('The Flex token is expired or invalid. Replace it in Connection settings.');
    if(['1003','1014'].includes(code))throw flexError('IBKR could not find this query/report. Check the Query ID and reporting period.');
    if(['1001','1004','1005','1006','1007','1008','1009','1018','1019'].includes(code))return 'wait';
    throw flexError('IBKR rejected the report request. Check the token, query IDs, account access and any token IP restriction.');
  }
  async function report(token,query){
    const doc=flexXml(await request('SendRequest',token,query));checkResponse(doc);
    const reference=doc.FlexStatementResponse?.ReferenceCode;
    if(!/^\d{1,30}$/.test(reference||''))throw flexError('IBKR has not prepared this report. Automatic sync will retry later.');
    // Never follow the report-supplied URL or redirects with a credential.
    for(let attempt=0;attempt<4;attempt++){
      await delay(attempt?3000:1000);
      if(closed)throw Error('Closed');
      const raw=await request('GetStatement',token,reference),result=flexXml(raw);
      if(checkResponse(result)==='wait')continue;
      if(result.FlexQueryResponse)return raw;
      throw flexError('IBKR returned an unexpected report. Select XML output.');
    }
    throw flexError('IBKR is still preparing the report. Automatic sync will retry later.');
  }
  function validateConfig(input){
    if(!input||typeof input.token!=='string'||!/^\d{10,128}$/.test(input.token))throw flexError('Enter the full numeric Flex Web Service token.');
    if(!/^\d{1,20}$/.test(input.activityQueryId||'')||input.confirmationQueryId&&!/^\d{1,20}$/.test(input.confirmationQueryId))throw flexError('Enter the Activity Query ID and, optionally, the Trade Confirmation Query ID.');
    if(input.activityQueryId===input.confirmationQueryId)throw flexError('Use different query IDs for Activity and Trade Confirmations.');
    if(!/^[A-Za-z0-9-]{2,32}$/.test(input.accountId||''))throw flexError('Enter the exact IBKR account ID included in the reports.');
    try{if(typeof input.timeZone!=='string'||input.timeZone.length>80)throw Error();new Intl.DateTimeFormat('en',{timeZone:input.timeZone});}catch{throw flexError('Choose the timezone used by your IBKR reports.');}
    const config={activityQueryId:input.activityQueryId,confirmationQueryId:input.confirmationQueryId||'',accountId:input.accountId,timeZone:input.timeZone};
    const r=row(),previous=r.config&&JSON.parse(r.config),fills=JSON.parse(r.fills);
    if(fills.length&&(fills[0].account!==config.accountId||previous&&previous.timeZone!==config.timeZone))throw flexError('Saved executions belong to this account and report timezone. Reconnecting cannot change their identity.');
    return config;
  }
  function start(input){
    if(closed)throw fail(503,'Journal is shutting down.');
    if(pending)throw fail(409,'An IBKR sync is already running.');
    const r=row();
    if(r.next_at>now())throw fail(429,'Please wait until the next sync time before retrying IBKR.');
    const config=input?validateConfig(input):r.config&&JSON.parse(r.config);
    if(!config||!input&&!r.credential)throw flexError('Connect IBKR first.');
    const token=input?input.token:account.decrypt(r.credential,PURPOSE);
    db.prepare('UPDATE ibkr_journal SET next_at=? WHERE id=1').run(now()+INTERVAL);
    const task=(async()=>{
      try{
        const activity=parseFlexReport(await report(token,config.activityQueryId),config,'activity');
        const confirmation=config.confirmationQueryId?parseFlexReport(await report(token,config.confirmationQueryId),config,'confirmation'):null;
        if(closed)return;
        const latest=row(),old=JSON.parse(latest.fills);
        const fills=mergeFills(old,[...(confirmation?.fills||[]),...activity.fills]);
        const matched=matchFills(fills,JSON.parse(latest.notes));
        const result={lastAttempt:new Date(now()).toISOString(),lastSuccess:new Date(now()).toISOString(),state:matched.unmatched.length?'attention':'ok',message:matched.unmatched.length?'Opening history is incomplete. Affected contracts are excluded from totals. Extend the Activity query period to include their entries.':null,executionCount:fills.length,tradeCount:matched.journal.trades.length,unmatchedCount:matched.unmatched.length,skipped:activity.skipped+(confirmation?.skipped||0),coverage:activity.coverage};
        db.prepare('UPDATE ibkr_journal SET credential=?,config=?,fills=?,result=?,revision=revision+1,next_at=? WHERE id=1').run(account.encrypt(token,PURPOSE),JSON.stringify(config),JSON.stringify(fills),JSON.stringify(result),now()+INTERVAL);
      }catch(error){
        if(closed)return;
        const previous=JSON.parse(row().result);
        db.prepare('UPDATE ibkr_journal SET result=?,next_at=? WHERE id=1').run(JSON.stringify({...previous,state:'error',lastAttempt:new Date(now()).toISOString(),message:error.status?error.message:'The report could not be safely reconciled. Check the execution fields; saved trades are unchanged.'}),now()+INTERVAL);
      }
    })();
    pending=task;void task.finally(()=>{if(pending===task)pending=null;});
    return status();
  }
  function disconnect(){
    if(pending)throw fail(409,'Wait for the current sync to finish before disconnecting.');
    // Keep report configuration with the retained executions to protect timezone identity.
    db.prepare('UPDATE ibkr_journal SET credential=NULL WHERE id=1').run();return status();
  }
  function saveNote(input){
    const r=row();if(input?.revision!==r.revision)throw fail(409,'IBKR records changed. Copy your unsaved notes, then reload the journal before saving.');
    const notes=JSON.parse(r.notes),journal=matchFills(JSON.parse(r.fills),notes).journal;
    const trade=journal.trades.find(t=>t.id===input.id);if(!trade)throw fail(404,'This IBKR trade is no longer in the current matching. Reload the journal.');
    let checked;try{checked=validateTrade({...trade,notes:input.notes,tags:input.tags,review:input.review,risk:input.risk});}catch{throw flexError('Check the note, tags, risk and strategy review values.');}
    notes[trade.id]={notes:checked.notes,tags:checked.tags,review:checked.review,risk:checked.risk,quantity:trade.quantity};
    if(JSON.stringify(notes).length>1500000)throw flexError('IBKR note storage limit reached. Export your journal before adding more notes.');
    db.prepare('UPDATE ibkr_journal SET notes=?,revision=revision+1 WHERE id=1').run(JSON.stringify(notes));return read();
  }
  async function middleware(req,res,next){
    const path=new URL(req.url,'http://localhost').pathname;
    if(!['/api/settings/ibkr-journal','/api/journal/ibkr','/api/journal/ibkr/sync','/api/journal/ibkr/notes'].includes(path))return next();
    res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    try{
      if(req.method==='GET'&&path==='/api/journal/ibkr'){res.end(JSON.stringify(read()));return;}
      if(req.method==='GET'&&path==='/api/settings/ibkr-journal'){res.end(JSON.stringify(status()));return;}
      if(req.method==='DELETE'&&path==='/api/settings/ibkr-journal'){res.end(JSON.stringify(disconnect()));return;}
      if(req.method!=='POST')throw fail(405,'Method not supported.');
      if(req.headers['content-type']?.split(';')[0]!=='application/json'||req.headers['x-opening-bell-client']!=='web')throw fail(415,'Use a JSON app request.');
      let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>16000)throw fail(413,'Request too large.');chunks.push(chunk);}
      let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw flexError('Invalid request.');}
      let result;
      if(path==='/api/settings/ibkr-journal'){result=start(input);res.statusCode=202;}
      else if(path==='/api/journal/ibkr/sync'){result=start();res.statusCode=202;}
      else if(path==='/api/journal/ibkr/notes')result=saveNote(input);
      else throw fail(405,'Method not supported.');
      res.end(JSON.stringify(result));
    }catch(error){res.statusCode=error.status||500;res.end(JSON.stringify({message:error.status?error.message:'The IBKR journal request could not be completed.'}));}
  }
  function tick(){if(!closed&&!pending&&row().credential&&row().next_at<=now())try{start();}catch{}}
  const timer=background?setInterval(tick,30000):null;
  timer?.unref();
  return {status,read,start,disconnect,saveNote,middleware,tick,settled:()=>pending,close(){closed=true;clearInterval(timer);}};
}
