import {randomUUID} from 'node:crypto';
import {portfolioListing} from '../src/data/portfolio-listings.mjs';
import {portfolioLedger,rebuildPortfolioValues} from '../src/data/portfolio-rebuild.mjs';
import {orderHistoryPath} from './portfolio-history.mjs';
import {fundingHistoryPath} from './portfolio-funding.mjs';

const fail=(status,message)=>Object.assign(Error(message),{status});
const kinds=['orders','transactions','dividends'];
export function dividendHistoryPath(path){
  if(typeof path!=='string'||!/^\/(?:api\/v0\/)?equity\/history\/dividends\?/.test(path))throw Error('Invalid dividend history page.');
  const transformed=typeof path==='string'?path.replace('/history/dividends?','/history/orders?'):path;
  return orderHistoryPath(transformed).replace('/history/orders?','/history/dividends?');
}
const validatePath=(kind,path)=>kind==='orders'?orderHistoryPath(path):kind==='transactions'?fundingHistoryPath(path):dividendHistoryPath(path);
export function createPortfolioRebuild(db,{now,request,credential,decode,account,isClosed,prices}){
  db.exec(`CREATE TABLE IF NOT EXISTS portfolio_rebuild_state(account_id TEXT PRIMARY KEY,state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS portfolio_rebuild_items(account_id TEXT NOT NULL,scan TEXT NOT NULL,kind TEXT NOT NULL,item_id TEXT NOT NULL,detail TEXT NOT NULL,PRIMARY KEY(account_id,scan,kind,item_id));`);
  const pending=new Set(),state=id=>{const row=db.prepare('SELECT state FROM portfolio_rebuild_state WHERE account_id=?').get(id);return row?JSON.parse(row.state):{};};
  const save=(id,s)=>db.prepare('INSERT INTO portfolio_rebuild_state VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET state=excluded.state').run(id,JSON.stringify(s));
  const belongs=(s,a)=>s.brokerId===a.snapshot?.brokerId&&s.environment===a.environment&&a.snapshot?.source==='api';
  function read(id){const a=account(id),s=state(id);if(!belongs(s,a))return {status:'idle',points:[],message:null};return {status:s.status||'idle',points:s.points||[],from:s.points?.[0]?.at||null,to:s.points?.at(-1)?.at||null,anchorAt:s.anchor?.fetchedAt||null,pages:s.pages||0,priced:s.priced||0,instruments:s.instruments?.length||0,message:s.message||null,completedAt:s.completedAt||null};}
  function values(id){return read(id).points;}
  function start(id,input){
    const a=account(id),record=credential(id),s=state(id);
    if(!record||a.snapshot?.source!=='api')throw fail(400,'Connect this account before rebuilding history.');
    if(pending.has(id)||s.status==='loading'&&belongs(s,a))throw fail(409,'A history rebuild is already running.');
    if(s.retryAt>now())throw fail(429,'Wait for the history retry window before rebuilding again.');
    if(now()-Date.parse(a.snapshot.fetchedAt)>120000)throw fail(409,'Refresh the account balance before rebuilding history.');
    const listings=Array.isArray(input?.listings)?input.listings.slice(0,500).map(e=>({id:e.id,symbol:e.symbol,ticker:e.ticker,exchange:e.exchange,group:e.group,isin:e.isin})):[];
    db.prepare('DELETE FROM portfolio_rebuild_items WHERE account_id=?').run(id);
    save(id,{scan:randomUUID(),generation:record.generation,brokerId:a.snapshot.brokerId,environment:a.environment,anchor:a.snapshot,listings,kind:0,cursor:'/equity/history/orders?limit=50',paths:[],pages:0,priced:0,status:'loading',points:belongs(s,a)?s.points:[],completedAt:belongs(s,a)?s.completedAt:null});return read(id);
  }
  const items=(id,s,kind)=>db.prepare('SELECT detail FROM portfolio_rebuild_items WHERE account_id=? AND scan=? AND kind=?').all(id,s.scan,kind).map(row=>JSON.parse(row.detail));
  async function sync(id){
    const a=account(id),record=credential(id);let s=state(id);
    if(!record||s.status!=='loading'||pending.has(id)||s.retryAt>now())return read(id);
    if(!belongs(s,a)||s.generation!==record.generation){save(id,{...s,status:'unavailable',message:'The broker connection changed. Start a new history rebuild.'});return read(id);}
    pending.add(id);const secret=decode(record,id),current=()=>!isClosed()&&credential(id)?.generation===record.generation&&state(id).scan===s.scan,safeRead=()=>isClosed()?null:read(id),readingPages=s.kind<kinds.length;
    try{
      for(let page=0;page<3&&s.kind<kinds.length;page++){
        const kind=kinds[s.kind],path=validatePath(kind,s.cursor);
        if(s.paths.includes(kind+':'+path)||s.pages>=600)throw Error('History pagination repeated or exceeded 30,000 records. No incomplete chart was published.');
        const body=await request(path,secret);if(!current())return safeRead();
        if(!Array.isArray(body?.items)||body.items.length>50||!Object.hasOwn(body,'nextPagePath'))throw Error('The broker returned an incomplete history page.');
        const next=body.nextPagePath===null||body.nextPagePath===''?null:validatePath(kind,body.nextPagePath);
        if(next&&(next===path||s.paths.includes(kind+':'+next)))throw Error('The broker repeated a history cursor.');
        db.exec('BEGIN IMMEDIATE');try{
          for(const item of body.items){const key=kind==='orders'?item?.fill?.id??item?.order?.id:item?.reference;if((typeof key!=='string'&&typeof key!=='number')||String(key).length>200)throw Error('A historical record has no reliable identity.');const identity=kind==='orders'?(item.fill?'fill:':'order:')+key:String(key),detail=JSON.stringify(item);if(detail.length>20000)throw Error('A historical record is oversized.');db.prepare('INSERT INTO portfolio_rebuild_items VALUES(?,?,?,?,?) ON CONFLICT DO UPDATE SET detail=excluded.detail').run(id,s.scan,kind,identity,detail);}
          s={...s,pages:s.pages+1,paths:[...s.paths,kind+':'+path],cursor:next,kind:next?s.kind:s.kind+1};
          if(!next&&s.kind<kinds.length)s.cursor='/equity/history/'+kinds[s.kind]+'?limit=50';save(id,s);db.exec('COMMIT');
        }catch(e){db.exec('ROLLBACK');throw e;}
      }
      // Keep each request below the client deadline: pages and prices run in
      // separate passes. A completed scan is never replaced by a partial one.
      if(!readingPages&&s.kind===kinds.length){
        const ledger=portfolioLedger({orders:items(id,s,'orders'),transactions:items(id,s,'transactions'),dividends:items(id,s,'dividends'),snapshot:s.anchor});
        if(ledger.instruments.length>100)throw Error('Automatic reconstruction currently supports up to 100 historical instruments.');
        s.instruments=ledger.instruments;
        for(let count=0;count<2&&s.priced<ledger.instruments.length;count++){
          const instrument=ledger.instruments[s.priced],listing=portfolioListing(instrument,s.listings);
          if(!listing)throw Error('No verified historical price listing for '+instrument.name+' ('+instrument.ticker+'). Add its exact listing to the watchlist before rebuilding.');
          const history=await prices(listing.id,ledger.from,ledger.to);if(!current())return safeRead();
          db.prepare('INSERT OR REPLACE INTO portfolio_rebuild_items VALUES(?,?,?,?,?)').run(id,s.scan,'prices',instrument.ticker,JSON.stringify(history));s.priced++;save(id,s);
        }
        if(s.priced===ledger.instruments.length){
          const histories=Object.fromEntries(db.prepare("SELECT item_id,detail FROM portfolio_rebuild_items WHERE account_id=? AND scan=? AND kind='prices'").all(id,s.scan).map(row=>[row.item_id,JSON.parse(row.detail)]));
          const points=rebuildPortfolioValues(ledger,histories,s.anchor.currency);s={...s,points,status:'ready',completedAt:now(),message:null};
        }
      }
      if(current()){s.retryAt=now()+60000;save(id,s);}
    }catch(e){if(current())save(id,{...s,status:'unavailable',message:e.historyPermission?'Enable History: Orders, History: Transactions and History: Dividends read permissions to rebuild older balances.':e.message||'Historical reconstruction is unavailable.',retryAt:now()+Math.max(60000,e.retryMs||300000)});}
    finally{pending.delete(id);}return safeRead();
  }
  function remove(id){db.prepare('DELETE FROM portfolio_rebuild_items WHERE account_id=?').run(id);db.prepare('DELETE FROM portfolio_rebuild_state WHERE account_id=?').run(id);}
  return {start,sync,read,values,remove};
}
