import {randomUUID} from 'node:crypto';
import {portfolioNumber,portfolioText,portfolioCurrency} from '../src/data/portfolio.mjs';
import {accountPerformance,portfolioRangeStart} from '../src/data/portfolio-history.mjs';

const FIRST='/equity/history/transactions?limit=50';
export function fundingHistoryPath(path){
  if(typeof path!=='string'||path.length>1000||!/^\/(?:api\/v0\/)?equity\/history\/transactions\?/.test(path))throw Error('Invalid funding history page.');
  const url=new URL(path,'https://history.invalid'),params=[...url.searchParams];
  if(!['/equity/history/transactions','/api/v0/equity/history/transactions'].includes(url.pathname)||url.hash||params.some(([k])=>!['cursor','time','limit'].includes(k))||new Set(params.map(([k])=>k)).size!==params.length)throw Error('Invalid funding history query.');
  const cursor=url.searchParams.get('cursor'),time=url.searchParams.get('time'),limit=url.searchParams.get('limit');
  if(cursor!==null&&!/^[A-Za-z0-9._~:+/=-]{1,200}$/.test(cursor)||limit!==null&&(!/^\d{1,2}$/.test(limit)||+limit<1||+limit>50)||time!==null&&(!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(time)||!Number.isFinite(Date.parse(time))))throw Error('Invalid funding history cursor.');
  const query=new URLSearchParams({limit:limit||'50'});if(cursor!==null)query.set('cursor',cursor);if(time!==null)query.set('time',time);
  return '/equity/history/transactions?'+query;
}
export function normalizeFundingHistory(body,now=Date.now()){
  if(!Array.isArray(body?.items)||body.items.length>50||!Object.hasOwn(body,'nextPagePath'))throw Error('Incomplete funding history.');
  const next=body.nextPagePath===null||body.nextPagePath===''?null:fundingHistoryPath(body.nextPagePath);
  const rows=body.items.map(item=>{
    const id=portfolioText(item?.reference,'transaction reference',200),type=portfolioText(item?.type,'transaction type',80),currency=portfolioCurrency(item?.currency),amount=portfolioNumber(item?.amount,'transaction amount',{optional:false});
    if(typeof item.dateTime!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(item.dateTime)||!Number.isFinite(Date.parse(item.dateTime))||Date.parse(item.dateTime)>now+300000||type==='DEPOSIT'&&amount<0)throw Error('Invalid funding transaction.');
    return {id,type,currency,amount,at:Date.parse(item.dateTime)};
  });return {rows,next};
}
export function createPortfolioFunding(db,{now,request,credential,decode,account,isClosed}){
  db.exec(`CREATE TABLE IF NOT EXISTS portfolio_valuations(account_id TEXT NOT NULL,slot INTEGER NOT NULL,at INTEGER NOT NULL,currency TEXT NOT NULL,value REAL NOT NULL,PRIMARY KEY(account_id,slot));
    CREATE TABLE IF NOT EXISTS portfolio_funding_state(account_id TEXT PRIMARY KEY,state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS portfolio_cashflows(account_id TEXT NOT NULL,scan TEXT NOT NULL,reference TEXT NOT NULL,at INTEGER NOT NULL,currency TEXT NOT NULL,amount REAL NOT NULL,type TEXT NOT NULL,PRIMARY KEY(account_id,scan,reference));`);
  const pending=new Map();
  const state=id=>{const row=db.prepare('SELECT state FROM portfolio_funding_state WHERE account_id=?').get(id);return row?JSON.parse(row.state):{};};
  const save=(id,s)=>db.prepare('INSERT INTO portfolio_funding_state VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET state=excluded.state').run(id,JSON.stringify(s));
  function remove(id){pending.delete(id);for(const table of ['portfolio_valuations','portfolio_funding_state','portfolio_cashflows'])db.prepare(`DELETE FROM ${table} WHERE account_id=?`).run(id);}
  function record(id,snapshot){
    if(snapshot?.source!=='api')return;
    const s=state(id),environment=account(id).environment;
    if(s.brokerId&&(s.brokerId!==snapshot.brokerId||s.environment!==environment))remove(id);
    if(s.brokerId!==snapshot.brokerId||s.environment!==environment)save(id,{...state(id),brokerId:snapshot.brokerId,environment});
    const at=Date.parse(snapshot.fetchedAt);if(!Number.isFinite(snapshot.accountValue)||!Number.isFinite(at)||at>now()+300000)return;
    db.prepare('INSERT OR IGNORE INTO portfolio_valuations VALUES(?,?,?,?,?)').run(id,Math.floor(at/900000),at,snapshot.currency,snapshot.accountValue);
    db.prepare(`DELETE FROM portfolio_valuations WHERE account_id=? AND at<? AND at<>(SELECT min(at) FROM portfolio_valuations WHERE account_id=?) AND at NOT IN (SELECT max(at) FROM portfolio_valuations WHERE account_id=? GROUP BY cast(at/86400000 AS INTEGER))`).run(id,now()-90*86400000,id,id);
  }
  function read(id,range){
    const a=account(id),snap=a.snapshot,s=state(id),connected=!!credential(id),broker=snap?.source==='api',currency=snap?.currency;
    const valuations=broker?db.prepare('SELECT at,value FROM portfolio_valuations WHERE account_id=? AND currency=? ORDER BY at').all(id,currency):[];
    const at=Date.parse(snap?.fetchedAt);if(broker&&Number.isFinite(snap.accountValue)&&Number.isFinite(at)&&at>(valuations.at(-1)?.at||0))valuations.push({at,value:snap.accountValue});
    if(broker&&s.completedValuation?.currency===currency&&!valuations.some(v=>v.at===s.completedValuation.at))valuations.push(s.completedValuation);
    // Pagination is a snapshot of history starting at the first request. Do not
    // pair newer balances with older funding: an unseen deposit is not profit.
    const covered=valuations.filter(v=>v.at<=s.coveredThrough).sort((a,b)=>a.at-b.at);
    const rows=broker&&s.completedScan?db.prepare('SELECT at,amount,currency,type FROM portfolio_cashflows WHERE account_id=? AND scan=? ORDER BY at').all(id,s.completedScan):[];
    const performance=broker&&s.completedScan?accountPerformance(covered,rows,currency,range,now()):{amount:null,points:[],coverage:'unavailable',netDeposits:null,totalReturn:null,ratePercent:null,accountValue:snap?.accountValue??null,reason:broker?'Complete deposit and withdrawal history is required.':'Connect an account to calculate return from its funding history.'};
    const chartFrom=portfolioRangeStart(range,now()),valuePoints=valuations.filter(v=>v.at<=now()&&v.at>=chartFrom).sort((a,b)=>a.at-b.at).map(v=>({at:v.at,value:v.value}));
    return {...performance,valuePoints,valuationTrackingFrom:valuations.length?Math.min(...valuations.map(v=>v.at)):null,trackingFrom:covered[0]?.at||null,fetchedAt:s.completedAt||null,status:s.completedScan&&broker?'ready':'unavailable',updating:connected&&!!s.scan&&!s.error,pages:s.pages||0,error:broker?s.error||null:null,connected};
  }
  async function sync(id){
    account(id);const record=credential(id);if(!record||pending.has(id))return;
    let s=state(id);if(s.retryAt>now())return;
    const token={};pending.set(id,token);const current=()=>!isClosed()&&credential(id)?.generation===record.generation&&pending.get(id)===token;
    try{
      if(!s.scan||s.generation!==record.generation){db.prepare('DELETE FROM portfolio_cashflows WHERE account_id=? AND scan<>?').run(id,s.completedScan||'');const snapshot=account(id).snapshot;
        s={...s,scan:randomUUID(),generation:record.generation,cursor:FIRST,paths:[],pages:0,error:null,startedAt:now(),valuation:snapshot?.source==='api'&&Number.isFinite(snapshot.accountValue)?{at:Date.parse(snapshot.fetchedAt),value:snapshot.accountValue,currency:snapshot.currency}:null};}
      s.retryAt=now()+60000;save(id,s);const secret=decode(record,id),deadline=Date.now()+18000;
      for(let page=0;page<10&&(page===0||Date.now()<deadline);page++){
        if(s.pages>=200)throw Error('Funding history exceeds the 10,000-transaction import limit. No incomplete total was published.');
        const path=fundingHistoryPath(s.cursor);if(s.paths.includes(path))throw Error('The broker repeated a funding cursor.');
        const body=await request(path,secret);if(!current())return;
        const {rows,next}=normalizeFundingHistory(body,now());if(next&&(next===path||s.paths.includes(next)))throw Error('The broker repeated a funding cursor.');
        db.exec('BEGIN IMMEDIATE');
        try{
          const insert=db.prepare('INSERT INTO portfolio_cashflows VALUES(?,?,?,?,?,?,?) ON CONFLICT(account_id,scan,reference) DO UPDATE SET at=excluded.at,currency=excluded.currency,amount=excluded.amount,type=excluded.type');
          for(const row of rows)insert.run(id,s.scan,row.id,row.at,row.currency,row.amount,row.type);
          s={...s,pages:s.pages+1,paths:[...s.paths,path],cursor:next,error:null};
          if(!next){s={...s,completedScan:s.scan,completedAt:now(),coveredThrough:s.startedAt,completedValuation:s.valuation,scan:null,retryAt:now()+60000};db.prepare('DELETE FROM portfolio_cashflows WHERE account_id=? AND scan<>?').run(id,s.completedScan);}
          save(id,s);db.exec('COMMIT');
        }catch(e){db.exec('ROLLBACK');throw e;}
        if(!next)break;
      }
    }catch(e){if(current()){s.error=e.historyPermission?'Enable History: Transactions read permission on the Trading 212 key to load net deposits and account return.':e.status?'Funding history is temporarily unavailable. Holdings remain connected.':e.message;s.retryAt=now()+Math.max(60000,e.retryMs||300000);save(id,s);}}
    finally{if(pending.get(id)===token)pending.delete(id);}
  }
  return {record,read,sync,remove};
}
