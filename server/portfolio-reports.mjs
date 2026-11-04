import {activityDateBounds} from '../src/data/portfolio-activity.mjs';
import {randomUUID} from 'node:crypto';
import {dividendHistoryPath} from './portfolio-rebuild.mjs';
import {monthBounds,monthlyReturn} from '../src/data/portfolio-insights.mjs';
const fail=(status,message)=>Object.assign(Error(message),{status});
const identity=a=>a?.snapshot?.source==='api'?`${a.environment}:${a.snapshot.brokerId}`:null;
const FIRST='/equity/history/dividends?limit=50';
export function createPortfolioReports(db,{now,credential,decode,account,accounts,isClosed,request,activity,funding}){
  db.exec(`CREATE TABLE IF NOT EXISTS portfolio_income_state(account_id TEXT PRIMARY KEY,identity TEXT NOT NULL,generation TEXT NOT NULL,detail TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS portfolio_income(account_id TEXT NOT NULL,scan TEXT NOT NULL,reference TEXT NOT NULL,detail TEXT NOT NULL,PRIMARY KEY(account_id,scan,reference));
    CREATE TABLE IF NOT EXISTS portfolio_execution_notes(account_id TEXT NOT NULL,identity TEXT NOT NULL,execution_id INTEGER NOT NULL,revision INTEGER NOT NULL,reason TEXT NOT NULL,notes TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(account_id,identity,execution_id));`);
  const pending=new Set();
  const state=id=>{const row=db.prepare('SELECT * FROM portfolio_income_state WHERE account_id=?').get(id);return row?.identity===identity(account(id))?JSON.parse(row.detail):{};};
  const save=(id,g,s)=>db.prepare('INSERT INTO portfolio_income_state VALUES(?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET identity=excluded.identity,generation=excluded.generation,detail=excluded.detail').run(id,identity(account(id)),g,JSON.stringify(s));
  async function syncIncome(id){
    const a=account(id),record=credential(id);if(!record||!identity(a)||pending.has(id))return;
    let s=state(id);if(s.retryAt>now()&&s.generation===record.generation)return;
    const g=record.generation,key=identity(a),current=()=>!isClosed()&&credential(id)?.generation===g&&identity(account(id))===key;
    pending.add(id);
    try{
      if(!s.scan||s.generation!==g){s={...s,scan:randomUUID(),cursor:FIRST,seen:[],pages:0,startedAt:now(),generation:g};db.prepare('DELETE FROM portfolio_income WHERE account_id=? AND scan<>?').run(id,s.completedScan||'');}
      s.retryAt=now()+60000;save(id,g,s);
      const path=dividendHistoryPath(s.cursor),raw=await request(path,decode(record,id));if(!current())return;
      if(!Array.isArray(raw?.items)||raw.items.length>50||!Object.hasOwn(raw,'nextPagePath'))throw Error('Distribution history is incomplete.');
      const next=raw.nextPagePath===null||raw.nextPagePath===''?null:dividendHistoryPath(raw.nextPagePath);
      if(s.seen.includes(path)||next&&(s.seen.includes(next)||next===path))throw Error('Distribution history repeated a page.');
      if(s.pages>=200)throw Error('Distribution history exceeds the 10,000-record limit.');
      const rows=raw.items.map(r=>{
        const at=typeof r.paidOn==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(r.paidOn)?Date.parse(r.paidOn):NaN;
        if(typeof r.reference!=='string'||!r.reference||r.reference.length>200||!Number.isFinite(at)||at>now()+300000||!Number.isFinite(r.amount)||!/^[A-Z]{3}$/.test(r.currency)||typeof r.type!=='string'||r.type.length>100)throw Error('Distribution amount, identity or currency is missing.');
        return {id:r.reference,at,amount:r.amount,currency:r.currency,type:r.type,name:String(r.instrument?.name||r.ticker||'').slice(0,160)};
      });
      db.exec('BEGIN IMMEDIATE');try{
        for(const row of rows)db.prepare('INSERT INTO portfolio_income VALUES(?,?,?,?) ON CONFLICT(account_id,scan,reference) DO UPDATE SET detail=excluded.detail').run(id,s.scan,row.id,JSON.stringify(row));
        s={...s,pages:s.pages+1,cursor:next,seen:[...s.seen,path],error:null};
        if(!next){s={...s,completedScan:s.scan,coveredThrough:s.startedAt,completedAt:now(),scan:null,retryAt:now()+900000};db.prepare('DELETE FROM portfolio_income WHERE account_id=? AND scan<>?').run(id,s.completedScan);}
        save(id,g,s);db.exec('COMMIT');
      }catch(e){db.exec('ROLLBACK');throw e;}
    }catch(e){if(current()){s.error=e.historyPermission?'Enable History: Dividends to include cash distributions.':e.message;s.retryAt=now()+Math.max(60000,e.retryMs||300000);save(id,g,s);}}
    finally{pending.delete(id);}
  }
  function chosen(filters){return accounts().accounts.filter(a=>(!filters.person||a.personId===filters.person)&&(!filters.account||a.id===filters.account));}
  function read(filters={}){
    let bounds;try{if(filters.year!==undefined){if(!/^(19|20|21)\d{2}$/.test(String(filters.year))||filters.month)throw Error('Choose a valid year.');bounds=activityDateBounds(filters.year+'-01-01',filters.year+'-12-31',filters.timeZone);}else bounds=monthBounds(filters.month,filters.timeZone);}catch(e){throw fail(400,e.message);}
    if(bounds.from>now())throw fail(400,'Choose the current period or an earlier period.');
    const root=accounts(),through=Math.min(bounds.to-1,now());
    let reportBytes=0;
    return {month:filters.month,year:filters.year,timeZone:filters.timeZone||'Europe/Skopje',generatedAt:now(),bounds,people:root.people,accounts:chosen(filters).map(a=>{
      const ledger=funding.ledger(a.id),executions=activity.ledger(a.id,bounds),s=state(a.id),currency=a.snapshot?.currency||null;
      const inMonth=r=>r.at>=bounds.from&&r.at<bounds.to&&r.at<=now();
      const income=s.completedScan?db.prepare('SELECT detail FROM portfolio_income WHERE account_id=? AND scan=?').all(a.id,s.completedScan).map(r=>JSON.parse(r.detail)).filter(inMonth).sort((a,b)=>a.at-b.at):[];
      const fundingComplete=ledger.complete&&ledger.coveredThrough>=through,tradesComplete=executions.complete&&executions.coveredThrough>=through,incomeComplete=!!s.completedScan&&s.coveredThrough>=through;
      // Current-month data can be minutes behind the clock; retain the precise
      // checked-through dates rather than declaring today's history complete.
      const warnings=[!fundingComplete&&'Cash movements cover the latest completed import; the selected period may be incomplete.',!tradesComplete&&'Executions cover imported history; the selected period may be incomplete.',!incomeComplete&&'Distributions cover the latest completed import; the selected period may be incomplete.',ledger.error,executions.error,s.error,!credential(a.id)&&'Account disconnected: saved data only.'].filter(Boolean);
      const result={id:a.id,personId:a.personId,person:root.people.find(p=>p.id===a.personId)?.name||'Unknown person',label:a.label,environment:a.environment,currency,performance:monthlyReturn(ledger,currency,bounds,now()),funding:ledger.flows.filter(inMonth),trades:executions.items.filter(inMonth),income,fundingComplete,tradesComplete,incomeComplete,coverage:{funding:ledger.coveredThrough,trades:executions.coveredThrough,income:s.coveredThrough||null},warnings};
      reportBytes+=Buffer.byteLength(JSON.stringify(result));if(reportBytes>8000000)throw fail(413,'This report is too large. Select one person or account.');return result;
    })};
  }
  async function refresh(filters){read(filters);const queue=chosen(filters).filter(a=>credential(a.id));const worker=async()=>{while(queue.length&&!isClosed()){const {id}=queue.shift();await Promise.allSettled([funding.sync(id),activity.sync(id),syncIncome(id)]);}};await Promise.all([worker(),worker()]);return isClosed()?null:read(filters);}
  function note(id,executionId){return db.prepare('SELECT revision,reason,notes,updated_at AS updatedAt FROM portfolio_execution_notes WHERE account_id=? AND identity=? AND execution_id=?').get(id,identity(account(id)),executionId)||{revision:0,reason:'',notes:'',updatedAt:null};}
  function journal(filters){const data=activity.read({...filters,kind:'journal'});return {...data,items:data.items.map(item=>({...item,note:note(item.accountId,item.id)}))};}
  function saveNote(input){
    const id=input?.accountId,executionId=input?.executionId,a=account(id);
    if(!Number.isSafeInteger(executionId)||executionId<0||!Number.isSafeInteger(input.revision)||input.revision<0||typeof input.reason!=='string'||input.reason.length>500||typeof input.notes!=='string'||input.notes.length>4000)throw fail(400,'Enter a reason (up to 500 characters) and notes (up to 4,000 characters).');
    if(!db.prepare('SELECT 1 FROM portfolio_activity_fills WHERE account_id=? AND identity=? AND item_id=?').get(id,identity(a),executionId))throw fail(404,'Execution not found.');
    if(note(id,executionId).revision!==input.revision)throw fail(409,'These notes changed in another view. Copy your draft and reload the saved notes.');
    db.prepare('INSERT INTO portfolio_execution_notes VALUES(?,?,?,?,?,?,?) ON CONFLICT(account_id,identity,execution_id) DO UPDATE SET revision=excluded.revision,reason=excluded.reason,notes=excluded.notes,updated_at=excluded.updated_at').run(id,identity(a),executionId,input.revision+1,input.reason.trim(),input.notes.trim(),now());
    return note(id,executionId);
  }
  function remove(id){for(const table of ['portfolio_income','portfolio_income_state','portfolio_execution_notes'])db.prepare(`DELETE FROM ${table} WHERE account_id=?`).run(id);}
  return {read,refresh,journal,saveNote,syncIncome,remove};
}
