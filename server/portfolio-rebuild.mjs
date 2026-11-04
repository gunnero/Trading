import {randomUUID} from 'node:crypto';
import {portfolioHistoryListing,portfolioCatalogListing} from '../src/data/portfolio-listings.mjs';
import {portfolioLedger,rebuildPortfolioValues,verifyPortfolioSplits} from '../src/data/portfolio-rebuild.mjs';
import {orderHistoryPath} from './portfolio-history.mjs';
import {fundingHistoryPath} from './portfolio-funding.mjs';

const fail=(status,message)=>Object.assign(Error(message),{status});
const kinds=['orders','transactions','dividends'];
export function dividendHistoryPath(path){
  if(typeof path!=='string'||!/^\/(?:api\/v0\/)?equity\/history\/dividends\?/.test(path))throw Error('Invalid dividend history page.');
  const transformed=path.replace('/history/dividends?','/history/orders?');
  return orderHistoryPath(transformed).replace('/history/orders?','/history/dividends?');
}
const validatePath=(kind,path)=>kind==='orders'?orderHistoryPath(path):kind==='transactions'?fundingHistoryPath(path):dividendHistoryPath(path);
export function createPortfolioRebuild(db,{now,request,credential,decode,account,isClosed,prices,readListings}){
  db.exec(`CREATE TABLE IF NOT EXISTS portfolio_rebuild_state(account_id TEXT PRIMARY KEY,state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS portfolio_rebuild_items(account_id TEXT NOT NULL,scan TEXT NOT NULL,kind TEXT NOT NULL,item_id TEXT NOT NULL,detail TEXT NOT NULL,PRIMARY KEY(account_id,scan,kind,item_id));`);
  const pending=new Set(),state=id=>{const row=db.prepare('SELECT state FROM portfolio_rebuild_state WHERE account_id=?').get(id);return row?JSON.parse(row.state):{};};
  const save=(id,s)=>db.prepare('INSERT INTO portfolio_rebuild_state VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET state=excluded.state').run(id,JSON.stringify(s));
  const belongs=(s,a)=>s.brokerId===a.snapshot?.brokerId&&s.environment===a.environment&&a.snapshot?.source==='api';
  const resumable=(s,a,record)=>!!s.scan&&belongs(s,a)&&record?.generation===s.generation&&['loading','paused','blocked','unavailable'].includes(s.status);
  function read(id){
    const a=account(id),s=state(id);if(!belongs(s,a))return {status:'idle',points:[],message:null};
    const records=s.scan?db.prepare("SELECT COUNT(*) AS count FROM portfolio_rebuild_items WHERE account_id=? AND scan=? AND kind!='prices'").get(id,s.scan).count:0;
    return {status:s.status||'idle',points:s.points||[],from:s.points?.[0]?.at||null,to:s.points?.at(-1)?.at||null,anchorAt:s.anchor?.fetchedAt||null,pages:s.pages||0,records,priced:s.priced||0,instruments:s.instruments?.length||0,listingChecks:s.listingChecks||[],listingMessage:s.listingMessage||null,historyComplete:s.kind>=kinds.length,stage:s.stage||(s.kind<kinds.length?'history':'validation'),canResume:resumable(s,a,credential(id)),retryAt:s.retryAt||null,message:s.message||null,completedAt:s.completedAt||null};
  }
  function values(id){return read(id).points;}
  function start(id,input){
    const a=account(id),record=credential(id),s=state(id);
    if(!record||a.snapshot?.source!=='api')throw fail(400,'Connect this account before rebuilding history.');
    if(pending.has(id)||s.status==='loading'&&belongs(s,a)&&s.generation===record.generation)throw fail(409,'A history rebuild is already running.');
    const sameConnection=belongs(s,a)&&s.generation===record.generation;
    if(sameConnection&&s.retryAt>now())throw fail(429,'Saved progress is safe. Wait for the history retry window before continuing.');
    const listings=Array.isArray(input?.listings)?input.listings.slice(0,500).map(e=>({id:e.id,symbol:e.symbol,ticker:e.ticker,exchange:e.exchange,group:e.group,isin:e.isin})):null;
    // Retain the original balance anchor and every committed page/price. A newer
    // snapshot cannot be reconciled against an older, partially imported scan.
    if(resumable(s,a,record)){
      save(id,{...s,listings:listings??s.listings,catalogChecked:false,priceIssues:{},status:'loading',message:null,retryAt:null});return read(id);
    }
    if(now()-Date.parse(a.snapshot.fetchedAt)>120000)throw fail(409,'Refresh the account balance before rebuilding history.');
    db.exec('BEGIN IMMEDIATE');try{
      db.prepare('DELETE FROM portfolio_rebuild_items WHERE account_id=?').run(id);
      save(id,{scan:randomUUID(),generation:record.generation,brokerId:a.snapshot.brokerId,environment:a.environment,anchor:a.snapshot,listings:listings||[],kind:0,cursor:'/equity/history/orders?limit=50',paths:[],pages:0,priced:0,stage:'history',status:'loading',points:belongs(s,a)?s.points:[],completedAt:belongs(s,a)?s.completedAt:null});db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}return read(id);
  }
  const items=(id,s,kind)=>db.prepare('SELECT detail FROM portfolio_rebuild_items WHERE account_id=? AND scan=? AND kind=?').all(id,s.scan,kind).map(row=>JSON.parse(row.detail));
  async function sync(id){
    const a=account(id),record=credential(id);let s=state(id);
    if(!record||!['loading','paused'].includes(s.status)||pending.has(id)||s.retryAt>now())return read(id);
    if(!belongs(s,a)||s.generation!==record.generation){save(id,{...s,status:'unavailable',message:'The broker connection changed. Start a new history rebuild.'});return read(id);}
    pending.add(id);const current=()=>!isClosed()&&credential(id)?.generation===record.generation&&state(id).scan===s.scan&&belongs(s,account(id)),safeRead=()=>isClosed()?null:read(id),readingPages=s.kind<kinds.length;
    let retryable=false;
    try{
      const secret=decode(record,id);s={...s,status:'loading',message:null};
      for(let page=0;page<3&&s.kind<kinds.length;page++){
        s.stage='history';const kind=kinds[s.kind],path=validatePath(kind,s.cursor);
        if(s.paths.includes(kind+':'+path)||s.pages>=600)throw Error('History pagination repeated or exceeded 30,000 records. No incomplete chart was published.');
        retryable=true;const body=await request(path,secret);retryable=false;if(!current())return safeRead();
        if(!Array.isArray(body?.items)||body.items.length>50||!Object.hasOwn(body,'nextPagePath'))throw Error('The broker returned an incomplete history page.');
        const next=body.nextPagePath===null||body.nextPagePath===''?null:validatePath(kind,body.nextPagePath);
        if(next&&(next===path||s.paths.includes(kind+':'+next)))throw Error('The broker repeated a history cursor.');
        db.exec('BEGIN IMMEDIATE');try{
          for(const item of body.items){const key=kind==='orders'?item?.fill?.id??item?.order?.id:item?.reference;if((typeof key!=='string'&&typeof key!=='number')||String(key).length>200)throw Error('A historical record has no reliable identity.');const identity=kind==='orders'?(item.fill?'fill:':'order:')+key:String(key),detail=JSON.stringify(item);if(detail.length>20000)throw Error('A historical record is oversized.');db.prepare('INSERT INTO portfolio_rebuild_items VALUES(?,?,?,?,?) ON CONFLICT DO UPDATE SET detail=excluded.detail').run(id,s.scan,kind,identity,detail);}
          const committed={...s,pages:s.pages+1,paths:[...s.paths,kind+':'+path],cursor:next,kind:next?s.kind:s.kind+1,failures:0};
          if(!next&&committed.kind<kinds.length)committed.cursor='/equity/history/'+kinds[committed.kind]+'?limit=50';save(id,committed);db.exec('COMMIT');s=committed;
        }catch(e){db.exec('ROLLBACK');throw e;}
      }
      // Pages and prices run in separate passes, below the client deadline.
      if(!readingPages&&s.kind===kinds.length){
        s.stage='validation';const ledger=portfolioLedger({orders:items(id,s,'orders'),transactions:items(id,s,'transactions'),dividends:items(id,s,'dividends'),snapshot:s.anchor});
        if(ledger.instruments.length>100)throw Error('Automatic reconstruction currently supports up to 100 historical instruments.');
        s.instruments=ledger.instruments;s.stage='prices';s.priceIssues||={};s.catalogListings||={};
        // Saved rows, not an array offset, identify completed instruments. This
        // also resumes old scans whose first missing listing stopped the loop.
        const savedPrices=new Set(db.prepare("SELECT item_id FROM portfolio_rebuild_items WHERE account_id=? AND scan=? AND kind='prices'").all(id,s.scan).map(r=>r.item_id));
        const listingFor=i=>portfolioHistoryListing(i,s.listings)||s.catalogListings[i.ticker];
        const updateChecks=()=>{
          s.priced=ledger.instruments.filter(i=>savedPrices.has(i.ticker)).length;
          s.listingChecks=ledger.instruments.map(i=>({ticker:i.ticker,name:i.name,currency:i.instrumentCurrency,listing:listingFor(i)?.id||null,status:savedPrices.has(i.ticker)?'saved':s.priceIssues[i.ticker]?'unavailable':listingFor(i)?'pending':'unmatched',message:s.priceIssues[i.ticker]||null}));
        };
        updateChecks();
        if(readListings&&!s.catalogChecked&&s.listingChecks.some(i=>i.status==='unmatched')){
          // Metadata has its own pass so two broker reads cannot compete with
          // daily-price requests for the browser's confirmation deadline.
          s.stage='listings';
          try{
            const catalog=await readListings(id);if(!current())return safeRead();
            for(const i of ledger.instruments){const match=portfolioCatalogListing(i,catalog);if(match)s.catalogListings[i.ticker]=match;}
            s.listingMessage=null;
          }catch{if(!current())return safeRead();s.listingMessage='Automatic listing lookup is unavailable. Check Metadata read permission, then retry; saved history and prices will be reused.';}
          s.catalogChecked=true;updateChecks();s.retryAt=now()+60000;save(id,s);return safeRead();
        }
        const queue=ledger.instruments.filter(i=>!savedPrices.has(i.ticker)&&listingFor(i)&&!s.priceIssues[i.ticker]);
        for(const instrument of queue.slice(0,2)){
          const listing=listingFor(instrument);
          try{
            retryable=true;const history=await prices(listing.id,ledger.from,ledger.to,listing.providerCheck);retryable=false;if(!current())return safeRead();
            if(history?.currency!==instrument.instrumentCurrency||!Array.isArray(history.points)||!history.points.length)throw Error('Verified daily prices are unavailable in the instrument currency.');
            verifyPortfolioSplits(ledger.splits.filter(split=>split.ticker===instrument.ticker),history);
            db.prepare('INSERT OR REPLACE INTO portfolio_rebuild_items VALUES(?,?,?,?,?)').run(id,s.scan,'prices',instrument.ticker,JSON.stringify(history));savedPrices.add(instrument.ticker);s.failures=0;
          }catch(e){
            if(!current())return safeRead();
            if(retryable&&![400,404,422].includes(e.status))throw e;
            retryable=false;s.priceIssues[instrument.ticker]=e.message||'Historical prices could not be verified.';
          }
          updateChecks();save(id,s);
        }
        if(s.priced===ledger.instruments.length){
          s.stage='calculation';const histories=Object.fromEntries(db.prepare("SELECT item_id,detail FROM portfolio_rebuild_items WHERE account_id=? AND scan=? AND kind='prices'").all(id,s.scan).map(row=>[row.item_id,JSON.parse(row.detail)]));
          const points=rebuildPortfolioValues(ledger,histories,s.anchor.currency);s={...s,points,status:'ready',completedAt:now(),message:null};
        }else if(!s.listingChecks.some(i=>i.status==='pending')){
          s.status='blocked';
          const unresolved=s.listingChecks.filter(i=>i.status!=='saved');
          s.message=`Chart not ready: ${unresolved.length} instrument${unresolved.length===1?' needs':'s need'} a verified listing or daily prices. All imported records and completed prices are saved. ${unresolved.length===1&&unresolved[0].message?unresolved[0].message:'See the full list below.'}`;
        }
      }
      if(current()){s.retryAt=['ready','blocked'].includes(s.status)?null:now()+60000;save(id,s);}
    }catch(e){if(current()){
      const automatic=retryable&&!e.historyPermission&&![400,401,403,404].includes(e.status),failures=(s.failures||0)+1;
      save(id,{...s,status:automatic?'paused':'blocked',failures,message:e.historyPermission?'Enable History: Orders, History: Transactions and History: Dividends read permissions to rebuild older balances.':e.message||'Historical reconstruction is unavailable.',retryAt:automatic?now()+Math.max(60000,e.retryMs||Math.min(900000,60000*2**Math.min(failures-1,4))):null});
    }}finally{pending.delete(id);}return safeRead();
  }
  function remove(id){db.prepare('DELETE FROM portfolio_rebuild_items WHERE account_id=?').run(id);db.prepare('DELETE FROM portfolio_rebuild_state WHERE account_id=?').run(id);}
  return {start,sync,read,values,remove};
}
