import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {PORTFOLIO_LIMITS,portfolioText,portfolioNumber,portfolioCurrency,normalizePortfolioSnapshot} from '../src/data/portfolio.mjs';
import {createPortfolioHistory,orderHistoryPath} from './portfolio-history.mjs';
import {createPortfolioFunding,fundingHistoryPath} from './portfolio-funding.mjs';
import {createPortfolioActivity} from './portfolio-activity.mjs';
import {createTradePrice} from './portfolio-trade-price.mjs';
import {createPortfolioTrading,orderView} from './portfolio-trading.mjs';
import {createPortfolioRebuild,dividendHistoryPath} from './portfolio-rebuild.mjs';
import {createPortfolioMetadata} from './portfolio-metadata.mjs';
import {createPortfolioReports} from './portfolio-reports.mjs';
import {createPortfolioAlerts} from './portfolio-alerts.mjs';
import {createPortfolioPlanning} from './portfolio-planning.mjs';
import {defaultCompanyService} from './company-data.mjs';
import {defaultMarketService} from './market-data.mjs';

const fail=(status,message,retryMs=0)=>Object.assign(new Error(message),{status,retryMs});
const TTL=60000;
const BASES={live:'https://live.trading212.com/api/v0',demo:'https://demo.trading212.com/api/v0'};
// Snapshot/history reads remain GET-only. User-confirmed order writes have a
// separate allowlisted, opt-in boundary in portfolio-trading.mjs.
const PATHS=['/equity/account/summary','/equity/positions','/equity/metadata/instruments','/equity/metadata/exchanges'];
export function normalizeTrading212(summary,positions,checkedAt) {
  const currency=portfolioCurrency(summary?.currency);
  if(!Number.isSafeInteger(summary.id)||summary.id<0||!summary.cash||!summary.investments||!Array.isArray(positions))throw Error('Incomplete broker response.');
  const required=(value,label)=>portfolioNumber(value,label,{optional:false});
  const cash=summary.cash,investment=summary.investments;
  const snapshot=normalizePortfolioSnapshot({version:1,currency,
    accountValue:required(summary.totalValue,'account value'),investmentsValue:required(investment.currentValue,'investments'),
    availableCash:required(cash.availableToTrade,'cash'),reservedCash:required(cash.reservedForOrders,'reserved cash'),pieCash:required(cash.inPies,'pie cash'),
    cash:required(cash.availableToTrade,'cash')+required(cash.reservedForOrders,'reserved cash')+required(cash.inPies,'pie cash'),
    cost:required(investment.totalCost,'cost'),unrealized:required(investment.unrealizedProfitLoss,'unrealized return'),realized:required(investment.realizedProfitLoss,'realized return'),
    sourceLabel:'Trading 212 API',
    holdings:positions.map(position=>{
      const instrument=position?.instrument,wallet=position?.walletImpact;
      if(!instrument||!wallet||wallet.currency!==currency)throw Error('Incomplete position or mismatched wallet currency.');
      return {ticker:instrument.ticker,name:instrument.name,isin:instrument.isin,instrumentCurrency:instrument.currency,
        quantity:position.quantity,averagePrice:required(position.averagePricePaid,'average price'),price:required(position.currentPrice,'price'),
        value:required(wallet.currentValue,'position value'),cost:required(wallet.totalCost,'position cost'),unrealized:required(wallet.unrealizedProfitLoss,'position return'),fxImpact:wallet.fxImpact};
    })});
  return {...snapshot,source:'api',fetchedAt:checkedAt,brokerId:String(summary.id),
    note:'Account summary and positions are separate broker reads. Values can move between them. Prices use instrument currency; holding values and returns use the primary account currency. The API does not supply a quote observation timestamp.'};
}

export function createPortfolioService(auth,directory,{fetcher=fetch,now=Date.now,timeoutMs=6000,background=false,workspace=()=>({}),quote=(key)=>defaultMarketService().quote(key),prices=(...args)=>defaultMarketService().portfolioPrices(...args),benchmarkPrices=(...args)=>defaultMarketService().benchmarkPrices(...args),company=key=>defaultCompanyService().get(key)}={}) {
  mkdirSync(directory,{recursive:true,mode:0o700});
  const filename=join(directory,'portfolio.sqlite'),db=new DatabaseSync(filename);chmodSync(filename,0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS portfolio_document(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,document TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS portfolio_credentials(id TEXT PRIMARY KEY,credential TEXT NOT NULL,generation TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS portfolio_retry(id TEXT PRIMARY KEY,retry_at INTEGER NOT NULL);`);
  db.prepare('INSERT OR IGNORE INTO portfolio_document VALUES(1,0,?)').run(JSON.stringify({version:1,people:[],accounts:[]}));
  const pending=new Map();let closed=false;
  const credential=id=>db.prepare('SELECT * FROM portfolio_credentials WHERE id=?').get(id);
  const retry=id=>db.prepare('SELECT retry_at FROM portfolio_retry WHERE id=?').get(id)?.retry_at||0;
  const backoff=(id,until)=>db.prepare('INSERT INTO portfolio_retry VALUES(?,?) ON CONFLICT(id) DO UPDATE SET retry_at=max(retry_at,excluded.retry_at)').run(id,until);
  function read(){
    const row=db.prepare('SELECT * FROM portfolio_document WHERE id=1').get(),data=JSON.parse(row.document);
    return {revision:row.revision,data:{...data,accounts:data.accounts.map(item=>({...item,connected:!!credential(item.id),retryAt:retry(item.id)||null}))}};
  }
  function change(fn,revision){
    const row=db.prepare('SELECT * FROM portfolio_document WHERE id=1').get();
    if(revision!==undefined&&revision!==row.revision)throw fail(409,'Portfolio Manager changed in another request. Reload the latest data and retry your edit.');
    const data=JSON.parse(row.document);fn(data);
    if(Buffer.byteLength(JSON.stringify(data))>12000000)throw fail(400,'Portfolio storage limit reached. Export your accounts before removing old data.');
    db.prepare('UPDATE portfolio_document SET revision=revision+1,document=? WHERE id=1').run(JSON.stringify(data));
    return read();
  }
  const find=id=>{const item=read().data.accounts.find(item=>item.id===id);if(!item)throw fail(404,'Account not found.');return item;};
  function person(input,revision,id){
    const name=portfolioText(input?.name,'person’s name');
    return change(data=>{
      if(data.people.some(p=>p.id!==id&&p.name.toLocaleLowerCase()===name.toLocaleLowerCase()))throw fail(400,'This person already exists.');
      if(id){const p=data.people.find(p=>p.id===id);if(!p)throw fail(404,'Person not found.');p.name=name;}
      else {if(data.people.length>=PORTFOLIO_LIMITS.people)throw fail(400,'Up to 30 people are supported.');data.people.push({id:randomUUID(),name});}
    },revision);
  }
  function account(input,revision,id){
    const label=portfolioText(input?.label,'account label'),platform=portfolioText(input?.platform,'platform',60),personId=portfolioText(input?.personId,'person identifier',80);
    return change(data=>{
      if(!data.people.some(p=>p.id===personId))throw fail(400,'Choose an existing person.');
      if(id){const a=data.accounts.find(a=>a.id===id);if(!a)throw fail(404,'Account not found.');if(credential(id)&&a.platform!==platform)throw fail(400,'Disconnect before changing platform.');Object.assign(a,{label,platform,personId});}
      else {if(data.accounts.length>=PORTFOLIO_LIMITS.accounts)throw fail(400,'Up to 50 accounts are supported.');data.accounts.push({id:randomUUID(),personId,label,platform,environment:'live',snapshot:null,lastSuccess:null,lastAttempt:null,error:null});}
    },revision);
  }
  function removePerson(id,revision){return change(data=>{if(data.accounts.some(a=>a.personId===id))throw fail(400,'Remove this person’s accounts first.');if(!data.people.some(p=>p.id===id))throw fail(404,'Person not found.');data.people=data.people.filter(p=>p.id!==id);},revision);}
  function removeAccount(id,revision){find(id);trading.assertIdle(id);const result=change(data=>{data.accounts=data.accounts.filter(a=>a.id!==id);},revision);db.prepare('DELETE FROM portfolio_credentials WHERE id=?').run(id);db.prepare('DELETE FROM portfolio_retry WHERE id=?').run(id);history.remove(id);trading.remove(id);activity.remove(id);rebuild.remove(id);metadata.remove(id);reports.remove(id);alerts.remove(id);planning.remove(id);return result;}
  function importSnapshot(id,raw,revision){find(id);if(credential(id))throw fail(400,'Disconnect the automatic feed before replacing it with a manual snapshot.');const snapshot=normalizePortfolioSnapshot(raw);return change(data=>{const a=data.accounts.find(a=>a.id===id);Object.assign(a,{snapshot:{...snapshot,importedAt:new Date(now()).toISOString()},lastSuccess:null,lastAttempt:null,error:null,environment:'live'});},revision);}
  async function request(path,secret){
    const validator=path.startsWith('/equity/history/orders?')?orderHistoryPath:path.startsWith('/equity/history/transactions?')?fundingHistoryPath:path.startsWith('/equity/history/dividends?')?dividendHistoryPath:null,historical=!!validator;
    if((!PATHS.includes(path)&&(!validator||validator(path)!==path))||!BASES[secret.environment])throw Error('Invalid broker endpoint.');
    try{
      const response=await fetcher(BASES[secret.environment]+path,{method:'GET',headers:{Accept:'application/json',Authorization:'Basic '+Buffer.from(secret.apiKey+':'+secret.apiSecret).toString('base64')},redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
      if(!response.ok){
        const after=response.headers.get('retry-after'),reset=Number(response.headers.get('x-ratelimit-reset'))*1000;
        const wait=after?(/^\d+$/.test(after)?Number(after)*1000:Date.parse(after)-now()):0;
        const delay=Math.max(60000,Number.isFinite(wait)?wait:0,Number.isFinite(reset)?reset-now():0);
        throw Object.assign(fail(502,[401,403].includes(response.status)?'Trading 212 rejected access. Check the key, secret, account-data permissions and any IP restrictions.':response.status===429?'Trading 212’s request limit was reached. Waiting before retrying.':'Trading 212 is unavailable. Keeping the last successful snapshot.',Math.min(86400000,delay)),{historyPermission:historical&&[401,403].includes(response.status)});
      }
      if(!response.headers.get('content-type')?.includes('application/json'))throw Error('Invalid response.');
      const reader=response.body.getReader(),chunks=[];let size=0;
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>(path.startsWith('/equity/metadata/')?16000000:2000000)){await reader.cancel();throw Error('Oversized response.');}chunks.push(value);}
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }catch(error){if(error.status)throw error;throw fail(502,'Trading 212 did not return a complete account snapshot. Keeping the last successful data.',300000);}
  }
  async function fetchSnapshot(secret){
    const summary=await request(PATHS[0],secret),positions=await request(PATHS[1],secret);
    try{return normalizeTrading212(summary,positions,new Date(now()).toISOString());}
    catch{throw fail(502,'Trading 212 returned incomplete or unsupported account data. Keeping the last successful snapshot.',300000);}
  }
  function checkIdentity(id,snapshot,environment){
    const current=find(id);
    if(current.snapshot?.source==='api'&&(current.environment!==environment||current.snapshot.brokerId!==snapshot.brokerId))throw fail(400,'This key belongs to a different account or environment. Add a separate platform account to keep the portfolios distinct.');
    if(read().data.accounts.some(a=>a.id!==id&&a.snapshot?.source==='api'&&a.snapshot.brokerId===snapshot.brokerId&&a.environment===environment))throw fail(400,'This broker account is already tracked. It cannot be counted under two people.');
  }
  async function connect(id,input,revision){
    trading.assertIdle(id);
    const current=find(id);if(current.platform!=='Trading 212')throw fail(400,'Automatic connections currently support Trading 212. Other platforms support snapshots.');
    if(input?.authorized!==true)throw fail(400,'Confirm that the account owner authorized this connection.');
    const environment=input.environment;if(!BASES[environment])throw fail(400,'Choose live or demo.');
    for(const field of ['apiKey','apiSecret'])if(typeof input[field]!=='string'||!/^[-A-Za-z0-9_+/=.]{8,512}$/.test(input[field]))throw fail(400,'Enter a valid API key and API secret.');
    if(read().revision!==revision)throw fail(409,'Portfolio Manager changed. Reload and retry.');
    if(pending.has(id))throw fail(409,'An account read is already running.');
    if(retry(id)>now())throw fail(429,'Wait for this account’s retry window before connecting again.');
    const token={};pending.set(id,token);backoff(id,now()+TTL);
    const secret={apiKey:input.apiKey,apiSecret:input.apiSecret,environment};
    try{
      const snapshot=await fetchSnapshot(secret);if(closed)throw Error('Closed');
      if(pending.get(id)!==token)throw fail(409,'The connection changed. Retry when ready.');
      checkIdentity(id,snapshot,environment);
      // A concurrent metadata edit or deletion must not be overwritten by a slow connection.
      if(read().revision!==revision)throw fail(409,'Portfolio Manager changed during the check. Reload and retry.');
      const encrypted=auth.encrypt(JSON.stringify(secret),'portfolio:'+id);
      db.exec('BEGIN IMMEDIATE');
      try{
        db.prepare('INSERT INTO portfolio_credentials VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET credential=excluded.credential,generation=excluded.generation').run(id,encrypted,randomUUID());
        change(data=>{Object.assign(data.accounts.find(a=>a.id===id),{snapshot,environment,lastSuccess:snapshot.fetchedAt,lastAttempt:snapshot.fetchedAt,error:null});},revision);
        history.record(id,snapshot);
        db.exec('COMMIT');
      }catch(error){db.exec('ROLLBACK');throw error;}
      backoff(id,now()+TTL);return read();
    }catch(error){if(!closed&&error.retryMs)backoff(id,now()+error.retryMs);throw error;}
    finally{if(pending.get(id)===token)pending.delete(id);}
  }
  async function sync(id){
    find(id);const record=credential(id);if(!record)throw fail(400,'Connect this account first.');
    if(pending.has(id)||retry(id)>now())return read();
    const token={};pending.set(id,token);backoff(id,now()+TTL);
    try{
      const secret=JSON.parse(auth.decrypt(record.credential,'portfolio:'+id)),snapshot=await fetchSnapshot(secret);
      if(closed||credential(id)?.generation!==record.generation)return closed?null:read();
      checkIdentity(id,snapshot,secret.environment);
      change(data=>Object.assign(data.accounts.find(a=>a.id===id),{snapshot,lastSuccess:snapshot.fetchedAt,lastAttempt:new Date(now()).toISOString(),error:null}));history.record(id,snapshot);backoff(id,now()+TTL);
    }catch(error){
      if(!closed&&credential(id)?.generation===record.generation){backoff(id,now()+Math.max(TTL,error.retryMs||300000));change(data=>Object.assign(data.accounts.find(a=>a.id===id),{lastAttempt:new Date(now()).toISOString(),error:error.status?error.message:'The saved connection could not be read. Reconnect this account.'}));}
    }finally{if(pending.get(id)===token)pending.delete(id);}
    return closed?null:read();
  }
  function disconnect(id,revision){find(id);trading.assertIdle(id);if(read().revision!==revision)throw fail(409,'Portfolio Manager changed. Reload and retry.');pending.delete(id);db.prepare('DELETE FROM portfolio_credentials WHERE id=?').run(id);return change(data=>{data.accounts.find(a=>a.id===id).error=null;},revision);}
  async function middleware(req,res,next){
    const url=new URL(req.url,'http://localhost'),path=url.pathname;
    if(path!=='/api/portfolio'&&!path.startsWith('/api/portfolio/'))return next();
    res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
    try{
      if(req.method==='GET'&&path==='/api/portfolio'){res.end(JSON.stringify(read()));return;}
      if(req.method==='GET'&&path==='/api/portfolio/activity'){res.end(JSON.stringify(activity.read(Object.fromEntries(url.searchParams))));return;}
      if(req.method==='GET'&&path==='/api/portfolio/notifications'){res.end(JSON.stringify(activity.notifications()));return;}
      if(req.method==='GET'&&path==='/api/portfolio/insights/planning'){res.end(JSON.stringify(planning.read()));return;}
      if(req.method==='GET'&&path==='/api/portfolio/insights/performance'){res.end(JSON.stringify(await planning.performance(Object.fromEntries(url.searchParams))));return;}
      if(req.method==='GET'&&path==='/api/portfolio/insights/calendar'){res.end(JSON.stringify(await planning.calendar(Object.fromEntries(url.searchParams))));return;}
      if(req.method==='GET'&&path==='/api/portfolio/insights/alerts'){res.end(JSON.stringify(alerts.read()));return;}
      if(req.method==='GET'&&path==='/api/portfolio/insights/reports'){res.end(JSON.stringify(reports.read(Object.fromEntries(url.searchParams))));return;}
      if(req.method==='GET'&&path==='/api/portfolio/journal'){res.end(JSON.stringify(reports.journal(Object.fromEntries(url.searchParams))));return;}
      const hoursMatch=path.match(/^\/api\/portfolio\/accounts\/([a-f0-9-]{36})\/hours$/);
      if(req.method==='GET'&&hoursMatch){res.end(JSON.stringify(await metadata.hours(hoursMatch[1],url.searchParams.get('ticker'))));return;}
      const tradeMatch=path.match(/^\/api\/portfolio\/accounts\/([a-f0-9-]{36})\/trading(?:\/(instruments|orders|position|attempt|settings|preview|submit|acknowledge))?$/);
      if(tradeMatch&&req.method==='GET'){
        const [,id,action]=tradeMatch;
        const result=!action?trading.read(id):action==='instruments'?await trading.search(id,url.searchParams.get('q')||''):action==='orders'?await trading.pending(id):action==='position'?await trading.position(id,url.searchParams.get('ticker')):action==='attempt'?trading.attempt(id,url.searchParams.get('token')):null;
        if(!result)throw fail(405,'Method not supported.');res.end(JSON.stringify(result));return;
      }
      const historyMatch=path.match(/^\/api\/portfolio\/accounts\/([a-f0-9-]{36})\/history(?:\/(sync|rebuild|rebuild\/sync))?$/);
      if(historyMatch&&req.method==='GET'&&!historyMatch[2]){res.end(JSON.stringify(readHistory(historyMatch[1],url.searchParams.get('range')||'1D')));return;}
      if(!['POST','PUT','DELETE'].includes(req.method))throw fail(405,'Method not supported.');
      if(req.headers['content-type']?.split(';')[0]!=='application/json'||req.headers['x-opening-bell-client']!=='web')throw fail(415,'Use a JSON app request.');
      let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>2000000)throw fail(413,'Snapshot is too large (maximum 2 MB).');chunks.push(chunk);}
      let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fail(400,'Invalid JSON request.');}
      if(req.method==='POST'&&path==='/api/portfolio/notifications/read'){res.end(JSON.stringify(activity.markRead(input)));return;}
      if(req.method==='POST'&&path==='/api/portfolio/insights/planning'){res.end(JSON.stringify(planning.save(input)));return;}
      if(req.method==='POST'&&path==='/api/portfolio/insights/alerts'){res.end(JSON.stringify(input.action?alerts.update(input):alerts.create(input)));return;}
      if(req.method==='POST'&&path==='/api/portfolio/insights/reports/refresh'){res.end(JSON.stringify(await reports.refresh(input)));return;}
      if(req.method==='POST'&&path==='/api/portfolio/journal/notes'){res.end(JSON.stringify(reports.saveNote(input)));return;}
      if(tradeMatch){
        const [,id,action]=tradeMatch;
        if(req.method!=='POST'||!['settings','preview','submit','acknowledge'].includes(action))throw fail(405,'Method not supported.');
        const result=action==='settings'?trading.configure(id,input):action==='preview'?await trading.preview(id,input):action==='submit'?await trading.submit(id,input):trading.acknowledge(id,input);
        res.end(JSON.stringify(result));return;
      }
      if(historyMatch&&req.method==='POST'&&historyMatch[2]){
        const [,id,action]=historyMatch,range=input?.range||'1D';history.read(id,range);
        if(action==='rebuild')rebuild.start(id,input);
        else if(action==='rebuild/sync')await rebuild.sync(id);
        else await Promise.all([history.sync(id),funding.sync(id)]);
        res.end(JSON.stringify(readHistory(id,range)));return;
      }
      const match=path.match(/^\/api\/portfolio\/(people|accounts)(?:\/([a-f0-9-]{36})(?:\/(snapshot|connect|disconnect|sync))?)?$/);
      if(!match)throw fail(404,'Portfolio endpoint not found.');
      const [,kind,id,action]=match,revision=input?.revision;
      if(action!=='sync'&&(!Number.isSafeInteger(revision)||revision<0))throw fail(400,'A saved revision is required.');
      let result;
      if(kind==='people'&&!action){
        if(req.method==='POST'&&!id)result=person(input,revision);
        else if(req.method==='PUT'&&id)result=person(input,revision,id);
        else if(req.method==='DELETE'&&id)result=removePerson(id,revision);
      }else if(kind==='accounts'){
        if(!action&&req.method==='POST'&&!id)result=account(input,revision);
        else if(!action&&req.method==='PUT'&&id)result=account(input,revision,id);
        else if(!action&&req.method==='DELETE'&&id)result=removeAccount(id,revision);
        else if(req.method==='POST'&&action==='snapshot')result=importSnapshot(id,input.snapshot,revision);
        else if(req.method==='POST'&&action==='connect')result=await connect(id,input,revision);
        else if(req.method==='POST'&&action==='disconnect')result=disconnect(id,revision);
        else if(req.method==='POST'&&action==='sync')result=await sync(id);
      }
      if(!result)throw fail(405,'Method not supported.');res.end(JSON.stringify(result));
    }catch(error){res.statusCode=error.status||500;res.end(JSON.stringify({message:error.status?error.message:'Portfolio Manager could not complete this request.'}));}
  }
  const historyOptions={now,request,credential,decode:(record,id)=>JSON.parse(auth.decrypt(record.credential,'portfolio:'+id)),account:find,isClosed:()=>closed};
  const metadata=createPortfolioMetadata(db,historyOptions);
  const activity=createPortfolioActivity(db,{...historyOptions,orderView,accounts:()=>read().data,tracking:id=>trading.tracking(id)});
  const trading=createPortfolioTrading(db,{...historyOptions,fetcher,timeoutMs,marketPrice:createTradePrice({now,quote,workspace}),readCatalog:metadata.instruments,orderLimit:(...args)=>planning.orderLimit(...args),getOrderLimit:id=>planning.settings(id).maxOrderValue,onObserve:activity.observe,onRejected:activity.rejected,onBalances(id,fresh,generation){
    if(closed||credential(id)?.generation!==generation)throw fail(409,'The account connection changed.');
    if(pending.has(id))throw fail(409,'An account refresh is already running.');
    const snapshot=normalizeTrading212(fresh.summary,fresh.positions,new Date(fresh.at).toISOString());
    checkIdentity(id,snapshot,find(id).environment);
    change(data=>Object.assign(data.accounts.find(a=>a.id===id),{snapshot,lastSuccess:snapshot.fetchedAt,lastAttempt:snapshot.fetchedAt,error:null}));
    history.record(id,snapshot);backoff(id,now()+TTL);
  }});
  const rebuild=createPortfolioRebuild(db,{...historyOptions,prices,readListings:metadata.historyListings});
  const funding=createPortfolioFunding(db,{...historyOptions,historicalValues:rebuild.values}),history=createPortfolioHistory(db,{...historyOptions,funding});
  const reports=createPortfolioReports(db,{...historyOptions,accounts:()=>read().data,activity,funding});
  const alerts=createPortfolioAlerts(db,{...historyOptions,accounts:()=>read().data,workspace,quote,activity});
  const planning=createPortfolioPlanning(db,{...historyOptions,accounts:()=>read().data,activity,funding,workspace,benchmarkPrices,company,assertIdle:trading.assertIdle});
  const readHistory=(id,range)=>({...history.read(id,range),rebuild:rebuild.read(id)});
  for(const a of read().data.accounts)history.record(a.id,a.snapshot);
  // Visible pages refresh each minute; a bounded 15-minute sampler maintains
  // history when the page is closed. It uses the same account locks/backoff.
  const sampler=background?setInterval(async()=>{
    if(closed)return;const queue=read().data.accounts.filter(a=>a.connected);
    const worker=async()=>{while(queue.length&&!closed){const a=queue.shift();try{await sync(a.id);if(!closed)await funding.sync(a.id);}catch{ /* A removed/disconnected account needs no background retry. */ }}};
    await Promise.all([worker(),worker()]);
  },900000):null;sampler?.unref();
  let monitoring=false;
  async function monitor(){
    if(closed||monitoring)return;monitoring=true;
    try{
      const queue=read().data.accounts.filter(a=>a.connected);
      const worker=async()=>{while(queue.length&&!closed){const {id}=queue.shift();
        try{await trading.monitor(id);}catch{/* Per-account tracking state retains provider errors. */}
        if(!closed)try{await activity.sync(id);}catch{/* Removed/reconnected account. */}
      }};
      await Promise.all([worker(),worker()]);
      if(!closed){planning.check();await alerts.check();}
    }finally{monitoring=false;}
  }
  const orderSampler=background?setInterval(monitor,15000):null;orderSampler?.unref();
  return {monitor,activity,metadata,reports,alerts,planning,read,person,account,removePerson,removeAccount,importSnapshot,connect,disconnect,sync,history,funding,trading,rebuild,middleware,close(){closed=true;clearInterval(sampler);clearInterval(orderSampler);db.close();}};
}
