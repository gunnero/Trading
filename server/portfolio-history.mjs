import {randomUUID} from 'node:crypto';
import {portfolioNumber,portfolioText,portfolioCurrency} from '../src/data/portfolio.mjs';
import {sampledPerformance,realizedPerformance,portfolioRangeStart,PORTFOLIO_RANGES} from '../src/data/portfolio-history.mjs';

const FIRST='/equity/history/orders?limit=50',PAGE_LIMIT=200;
export function orderHistoryPath(path){
  if(typeof path!=='string'||path.length>250||!/^\/(?:api\/v0\/)?equity\/history\/orders\?/.test(path))throw Error('Invalid history page.');
  const url=new URL(path,'https://history.invalid');
  if(!['/equity/history/orders','/api/v0/equity/history/orders'].includes(url.pathname)||url.hash)throw Error('Invalid history page.');
  const params=[...url.searchParams];
  if(params.some(([key])=>!['cursor','limit'].includes(key))||new Set(params.map(([k])=>k)).size!==params.length)throw Error('Invalid history query.');
  const cursor=url.searchParams.get('cursor'),limit=url.searchParams.get('limit');
  if(cursor!==null&&!/^-?\d{1,20}$/.test(cursor)||limit!==null&&(!/^\d{1,2}$/.test(limit)||+limit<1||+limit>50))throw Error('Invalid history cursor.');
  return `/equity/history/orders?limit=${limit||50}${cursor===null?'':`&cursor=${cursor}`}`;
}
export function normalizeOrderHistory(body,now=Date.now()){
  if(!Array.isArray(body?.items)||body.items.length>50||!Object.hasOwn(body,'nextPagePath'))throw Error('Incomplete order history.');
  const next=body.nextPagePath===null||body.nextPagePath===''?null:orderHistoryPath(body.nextPagePath);
  const rows=[];
  for(const item of body.items){
    const order=item?.order,fill=item?.fill;
    if(!order||!['BUY','SELL'].includes(order.side))throw Error('Incomplete historical order.');
    if(!fill){if(['FILLED','PARTIALLY_FILLED'].includes(order.status)||order.filledQuantity>0)throw Error('Missing execution.');continue;}
    if(!Number.isSafeInteger(fill.id)||fill.id<0||typeof fill.filledAt!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(fill.filledAt))throw Error('Invalid execution identity.');
    const at=Date.parse(fill.filledAt);if(!Number.isFinite(at)||at>now+300000)throw Error('Invalid execution time.');
    // No trade profit is inferred from sale proceeds, quantity or an average price.
    const wallet=fill.walletImpact,pnl=portfolioNumber(wallet?.realisedProfitLoss,'realized profit/loss');
    if(order.side==='BUY'&&(pnl===null||pnl===0))continue;
    const currency=portfolioCurrency(wallet?.currency),ticker=portfolioText(order.instrument?.ticker||order.ticker,'instrument',80);
    rows.push({id:String(fill.id),at,currency,pnl,ticker});
  }
  return {rows,next};
}

export function createPortfolioHistory(db,{now,request,credential,decode,account,isClosed}){
  db.exec(`CREATE TABLE IF NOT EXISTS portfolio_samples(account_id TEXT NOT NULL,slot INTEGER NOT NULL,at INTEGER NOT NULL,currency TEXT NOT NULL,pnl REAL NOT NULL,PRIMARY KEY(account_id,slot));
    CREATE TABLE IF NOT EXISTS portfolio_history_state(account_id TEXT PRIMARY KEY,state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS portfolio_fills(account_id TEXT NOT NULL,scan TEXT NOT NULL,fill_id TEXT NOT NULL,at INTEGER NOT NULL,currency TEXT NOT NULL,pnl REAL,ticker TEXT NOT NULL,PRIMARY KEY(account_id,scan,fill_id));`);
  const pending=new Map();
  const state=id=>{const row=db.prepare('SELECT state FROM portfolio_history_state WHERE account_id=?').get(id);return row?JSON.parse(row.state):{};};
  const save=(id,value)=>db.prepare('INSERT INTO portfolio_history_state VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET state=excluded.state').run(id,JSON.stringify(value));
  function record(id,snapshot){
    const at=Date.parse(snapshot?.fetchedAt),pnl=snapshot?.realized+snapshot?.unrealized;
    if(snapshot?.source!=='api')return;
    // A manual import can sit between two connections. Bind retained history to
    // the broker identity as well as the local card, including live/demo scope.
    const previous=state(id),environment=account(id).environment;
    if(previous.brokerId&&(previous.brokerId!==snapshot.brokerId||previous.environment!==environment))remove(id);
    if(previous.brokerId!==snapshot.brokerId||previous.environment!==environment)save(id,{...state(id),brokerId:snapshot.brokerId,environment});
    if(!Number.isFinite(snapshot.realized)||!Number.isFinite(snapshot.unrealized)||!Number.isFinite(at)||at>now()+300000)return;
    // Preserve the first observation in each 15-minute bucket. The latest live
    // snapshot is also included by read(), without claiming extra stored history.
    db.prepare('INSERT OR IGNORE INTO portfolio_samples VALUES(?,?,?,?,?)').run(id,Math.floor(at/900000),at,snapshot.currency,pnl);
    // Retain daily observations beyond 90 days, plus the very first observation.
    db.prepare(`DELETE FROM portfolio_samples WHERE account_id=? AND at<? AND at<>(SELECT min(at) FROM portfolio_samples WHERE account_id=?) AND at NOT IN (SELECT max(at) FROM portfolio_samples WHERE account_id=? GROUP BY cast(at/86400000 AS INTEGER))`).run(id,now()-90*86400000,id,id);
  }
  function read(id,range='1D'){
    if(!PORTFOLIO_RANGES.includes(range))throw Object.assign(Error('Choose a supported performance range.'),{status:400});
    const a=account(id),currency=a.snapshot?.currency||null,s=state(id),connected=!!credential(id);
    const broker=a.snapshot?.source==='api';
    const samples=currency&&broker?db.prepare('SELECT at,pnl FROM portfolio_samples WHERE account_id=? AND currency=? ORDER BY at').all(id,currency):[];
    const snap=a.snapshot,at=Date.parse(snap?.fetchedAt);
    if(snap?.source==='api'&&Number.isFinite(snap.realized)&&Number.isFinite(snap.unrealized)&&Number.isFinite(at)&&at>(samples.at(-1)?.at||0))samples.push({at,pnl:snap.realized+snap.unrealized});
    const fills=broker&&s.completedScan&&currency?db.prepare('SELECT at,pnl,currency FROM portfolio_fills WHERE account_id=? AND scan=? AND at>=? ORDER BY at').all(id,s.completedScan,portfolioRangeStart(range,now())):[];
    const currencies=[...new Set(fills.map(f=>f.currency))],mixed=currencies.some(c=>c!==currency);
    const realized=broker&&s.completedScan&&!mixed?realizedPerformance(fills,range,now()):{amount:null,points:[],missing:0,count:0};
    return {accountId:id,range,currency,fetchedAt:s.completedAt||null,trackingFrom:samples[0]?.at||null,sampled:sampledPerformance(samples,range,now()),
      realized:{...realized,status:broker&&s.completedScan?'ready':'unavailable',mixedCurrencies:mixed,updating:connected&&!!s.scan&&!s.error,pages:s.pages||0,error:broker?s.error||null:null,retryAt:s.retryAt||null,connected}};
  }
  async function sync(id){
    account(id);const record=credential(id);if(!record||pending.has(id))return;
    let s=state(id);if(s.retryAt>now())return;
    const token={};pending.set(id,token);
    const current=()=>!isClosed()&&credential(id)?.generation===record.generation&&pending.get(id)===token;
    try{
      if(!s.scan||s.generation!==record.generation){
        db.prepare('DELETE FROM portfolio_fills WHERE account_id=? AND scan<>?').run(id,s.completedScan||'');
        s={...s,scan:randomUUID(),generation:record.generation,cursor:FIRST,paths:[],pages:0,error:null};
      }
      s.retryAt=now()+60000;save(id,s);
      const secret=decode(record,id);
      for(let page=0;page<2;page++){
        if(s.pages>=PAGE_LIMIT)throw Error('History exceeds the 10,000-order import limit. Earlier results are unavailable.');
        const path=orderHistoryPath(s.cursor);
        if(s.paths.includes(path))throw Error('The broker repeated a history cursor. No incomplete totals were published.');
        const body=await request(path,secret);if(!current())return;
        const {rows,next}=normalizeOrderHistory(body,now());
        if(next&&(next===path||s.paths.includes(next)))throw Error('The broker repeated a history cursor. No incomplete totals were published.');
        db.exec('BEGIN IMMEDIATE');
        try{
          const insert=db.prepare('INSERT INTO portfolio_fills VALUES(?,?,?,?,?,?,?) ON CONFLICT(account_id,scan,fill_id) DO UPDATE SET at=excluded.at,currency=excluded.currency,pnl=excluded.pnl,ticker=excluded.ticker');
          for(const row of rows)insert.run(id,s.scan,row.id,row.at,row.currency,row.pnl,row.ticker);
          s={...s,pages:s.pages+1,paths:[...s.paths,path],cursor:next,error:null};
          if(!next){s={...s,completedScan:s.scan,completedAt:now(),scan:null,retryAt:now()+15*60000};db.prepare('DELETE FROM portfolio_fills WHERE account_id=? AND scan<>?').run(id,s.completedScan);}
          save(id,s);db.exec('COMMIT');
        }catch(e){db.exec('ROLLBACK');throw e;}
        if(!next)break;
      }
    }catch(error){if(current()){s.error=error.historyPermission?'History access is unavailable. Enable History: Orders read permission on the Trading 212 key, then retry.':error.status?'Order history is temporarily unavailable. Your holdings connection is unchanged.':error.message;s.retryAt=now()+Math.max(60000,error.retryMs||300000);save(id,s);}}
    finally{if(pending.get(id)===token)pending.delete(id);}
  }
  function remove(id){pending.delete(id);for(const table of ['portfolio_samples','portfolio_history_state','portfolio_fills'])db.prepare(`DELETE FROM ${table} WHERE account_id=?`).run(id);}
  return {record,read,sync,remove};
}
