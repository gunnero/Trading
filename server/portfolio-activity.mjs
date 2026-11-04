import {orderHistoryPath} from './portfolio-history.mjs';
import {activityDateBounds} from '../src/data/portfolio-activity.mjs';

const fail=(status,message)=>Object.assign(Error(message),{status});
const number=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const currency=value=>typeof value==='string'&&/^[A-Z]{3}$/.test(value)?value:null;
const text=(value,max=160)=>typeof value==='string'?value.slice(0,max):'';
const terminal=new Set(['FILLED','CANCELLED','REJECTED','REPLACED']);
const FIRST='/equity/history/orders?limit=50';
const identity=a=>a?.snapshot?.source==='api'&&a.snapshot.brokerId?`${a.environment}:${a.snapshot.brokerId}`:null;

export function normalizeActivityPage(raw,now,orderView){
  if(!Array.isArray(raw?.items)||raw.items.length>50||!Object.hasOwn(raw,'nextPagePath'))throw Error('Order history is incomplete.');
  const next=raw.nextPagePath===null||raw.nextPagePath===''?null:orderHistoryPath(raw.nextPagePath),orders=[],fills=[];
  for(const item of raw.items){
    // Share distributions and splits are corporate actions, not executions.
    const fill=item?.fill;if(fill&&fill.type!=='TRADE')continue;
    const order=orderView(item?.order);orders.push(order);
    if(!fill)continue;
    if(!Number.isSafeInteger(fill.id)||fill.id<0||typeof fill.filledAt!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(fill.filledAt))throw Error('An execution has an invalid identity or date.');
    const at=Date.parse(fill.filledAt),quantity=number(fill.quantity),price=number(fill.price),wallet=fill.walletImpact;
    if(!Number.isFinite(at)||at>now+300000||quantity===null||quantity===0||price!==null&&price<0)throw Error('An execution is incomplete.');
    let charges=null;
    if(wallet?.taxes!==undefined&&wallet.taxes!==null){
      if(!Array.isArray(wallet.taxes)||wallet.taxes.length>50)throw Error('Execution fees are incomplete.');
      charges=wallet.taxes.map(tax=>{if(number(tax.quantity)===null||!currency(tax.currency)||!text(tax.name))throw Error('Execution fee currency or amount is missing.');return {name:text(tax.name,80),currency:tax.currency,amount:tax.quantity};});
    }
    fills.push({id:fill.id,orderId:order.id,ticker:order.ticker,name:order.name,side:order.side,at,quantity:Math.abs(quantity),price,
      priceCurrency:currency(item.order.instrument?.currency)||currency(item.order.currency),currency:currency(wallet?.currency),
      netValue:number(wallet?.netValue),realized:number(wallet?.realisedProfitLoss),charges});
  }
  return {orders,fills,next};
}

export function createPortfolioActivity(db,{now,credential,decode,account,accounts,isClosed,request,orderView,tracking=()=>null}){
  db.exec(`CREATE TABLE IF NOT EXISTS portfolio_activity_orders(account_id TEXT NOT NULL,identity TEXT NOT NULL,item_id INTEGER NOT NULL,at INTEGER NOT NULL,ticker TEXT NOT NULL,name TEXT NOT NULL,detail TEXT NOT NULL,PRIMARY KEY(account_id,identity,item_id));
    CREATE TABLE IF NOT EXISTS portfolio_activity_fills(account_id TEXT NOT NULL,identity TEXT NOT NULL,item_id INTEGER NOT NULL,at INTEGER NOT NULL,ticker TEXT NOT NULL,name TEXT NOT NULL,detail TEXT NOT NULL,PRIMARY KEY(account_id,identity,item_id));
    CREATE TABLE IF NOT EXISTS portfolio_activity_events(id INTEGER PRIMARY KEY AUTOINCREMENT,account_id TEXT NOT NULL,identity TEXT NOT NULL,event_key TEXT NOT NULL,at INTEGER NOT NULL,ticker TEXT NOT NULL,name TEXT NOT NULL,detail TEXT NOT NULL,read_at INTEGER,UNIQUE(account_id,identity,event_key));
    CREATE TABLE IF NOT EXISTS portfolio_activity_sync(account_id TEXT PRIMARY KEY,generation TEXT NOT NULL,identity TEXT NOT NULL,detail TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS portfolio_activity_fills_date ON portfolio_activity_fills(account_id,identity,at);
    CREATE INDEX IF NOT EXISTS portfolio_activity_orders_date ON portfolio_activity_orders(account_id,identity,at);
    CREATE INDEX IF NOT EXISTS portfolio_activity_events_date ON portfolio_activity_events(account_id,identity,at);`);
  const pending=new Set();
  function state(id,g,key){const row=db.prepare('SELECT * FROM portfolio_activity_sync WHERE account_id=?').get(id);return row?.generation===g&&row.identity===key?JSON.parse(row.detail):{nextAt:0,headAt:0,cursor:null,pages:0,seen:[],complete:false,startedAt:now(),checkedAt:null,error:null};}
  const save=(id,g,key,s)=>db.prepare('INSERT INTO portfolio_activity_sync VALUES(?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET generation=excluded.generation,identity=excluded.identity,detail=excluded.detail').run(id,g,key,JSON.stringify(s));
  function scope(id,g){if(isClosed()||credential(id)?.generation!==g)throw fail(409,'The account connection changed.');const a=account(id),key=identity(a);if(!key)throw fail(409,'The broker account changed.');return key;}
  function storeOrder(id,key,order){
    const old=db.prepare('SELECT detail FROM portfolio_activity_orders WHERE account_id=? AND identity=? AND item_id=?').get(id,key,order.id),previous=old?JSON.parse(old.detail):null;
    if(previous&&(previous.ticker!==order.ticker||previous.side!==order.side))throw Error('The historical order identity changed.');
    if(previous&&(terminal.has(previous.status)&&!terminal.has(order.status)||number(previous.filledQuantity)!==null&&number(order.filledQuantity)!==null&&previous.filledQuantity>order.filledQuantity))return;
    const created=Date.parse(order.createdAt),at=Number.isFinite(created)?created:previous?.at??order.firstSeen??now();
    const detail={...previous,...order,filledQuantity:order.filledQuantity??previous?.filledQuantity??null,name:order.name===order.ticker?previous?.name||order.name:order.name,at,...(terminal.has(order.status)?{awaitingHistory:false}:{})};
    db.prepare('INSERT INTO portfolio_activity_orders VALUES(?,?,?,?,?,?,?) ON CONFLICT(account_id,identity,item_id) DO UPDATE SET at=excluded.at,ticker=excluded.ticker,name=excluded.name,detail=excluded.detail').run(id,key,order.id,at,order.ticker,detail.name,JSON.stringify(detail));
    return {previous,detail};
  }
  function notify(id,key,eventKey,detail){
    db.prepare('INSERT OR IGNORE INTO portfolio_activity_events(account_id,identity,event_key,at,ticker,name,detail) VALUES(?,?,?,?,?,?,?)').run(id,key,eventKey,now(),detail.ticker,detail.name||detail.ticker,JSON.stringify(detail));
  }
  function observe(id,g,order,previous,alert=false){
    const key=scope(id,g),stored=storeOrder(id,key,order);
    if(!alert||!stored)return;previous=stored.previous||previous;order=stored.detail;
    const progressed=(order.filledQuantity??0)>(previous?.filledQuantity??0),changed=order.status!==previous?.status;
    if((changed&&['PARTIALLY_FILLED','FILLED','CANCELLED','REJECTED'].includes(order.status))||(progressed&&order.status==='PARTIALLY_FILLED'))notify(id,key,`order:${order.id}:${order.status}${order.status==='PARTIALLY_FILLED'?':'+(order.filledQuantity??'unknown'):''}`,{orderId:order.id,ticker:order.ticker,name:order.name,status:order.status,side:order.side,quantity:order.quantity,filledQuantity:order.filledQuantity});
  }
  function rejected(id,g,attempt){const key=scope(id,g);notify(id,key,`attempt:${attempt.token}`,{orderId:null,ticker:attempt.ticker||attempt.order?.ticker||'',name:attempt.name||attempt.order?.name||'Order',status:'REJECTED',side:attempt.side||attempt.order?.side,quantity:attempt.quantity??null,filledQuantity:null,message:attempt.message});}
  function ingest(id,g,key,page,s){
    db.exec('BEGIN IMMEDIATE');
    try{
      const recent=new Set();
      for(const fill of page.fills){
        const row=db.prepare('SELECT detail FROM portfolio_activity_fills WHERE account_id=? AND identity=? AND item_id=?').get(id,key,fill.id);
        if(!row&&fill.at>=s.startedAt)recent.add(fill.orderId);
        if(row){const old=JSON.parse(row.detail);if(old.orderId!==fill.orderId||old.ticker!==fill.ticker||old.side!==fill.side||old.at!==fill.at)throw Error('An execution identity changed.');}
        db.prepare('INSERT INTO portfolio_activity_fills VALUES(?,?,?,?,?,?,?) ON CONFLICT(account_id,identity,item_id) DO UPDATE SET detail=excluded.detail').run(id,key,fill.id,fill.at,fill.ticker,fill.name,JSON.stringify(fill));
      }
      for(const order of page.orders){
        const row=db.prepare('SELECT detail FROM portfolio_activity_orders WHERE account_id=? AND identity=? AND item_id=?').get(id,key,order.id),previous=row?JSON.parse(row.detail):null;
        observe(id,g,order,previous,recent.has(order.id)||s.complete&&!!previous);
      }
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  async function sync(id){
    const a=account(id),record=credential(id),key=identity(a);if(!record||!key||a.platform!=='Trading 212'||pending.has(id))return;
    const g=record.generation,s=state(id,g,key);if(s.nextAt>now())return;
    pending.add(id);s.nextAt=now()+30000;save(id,g,key,s);
    try{
      // Refresh the recent page between older pages, so a long initial import
      // cannot delay new executions. Both requests share the persisted backoff.
      const head=s.complete&&!s.cursor&&now()<(s.rescanAt||0)||!!s.cursor&&s.headAt<=now(),path=head?FIRST:s.cursor||FIRST;
      const raw=await request(path,decode(record,id));if(scope(id,g)!==key)throw fail(409,'The account changed.');
      const page=normalizeActivityPage(raw,now(),orderView);
      if(!head&&page.next&&(page.next===path||s.seen.includes(page.next)))throw Error('Order history repeated a page.');
      ingest(id,g,key,page,s);s.checkedAt=now();s.error=null;
      if(path===FIRST)s.headAt=now()+60000;
      if(head&&!s.cursor)s.nextAt=now()+60000;
      if(!head){
        s.pages++;s.seen.push(path);s.cursor=page.next;
        if(!page.next){s.complete=true;s.completedAt=now();s.rescanAt=now()+86400000;s.cursor=null;s.pages=0;s.seen=[];s.nextAt=now()+60000;}
        else if(s.pages>=200){s.error='History exceeds 10,000 records. The imported portion is available; older records need a separate export.';s.nextAt=now()+3600000;s.cursor=null;s.pages=0;s.seen=[];s.complete=false;}
      }
    }catch(e){
      if(isClosed()||credential(id)?.generation!==g)return;
      s.error=e.historyPermission?'Enable History: Orders on this account’s Trading 212 API key to import executions.':e.status?e.message:e.message||'Execution history could not be refreshed.';
      s.nextAt=now()+Math.max(e.historyPermission?3600000:60000,e.retryMs||0);
    }finally{pending.delete(id);if(!isClosed()&&credential(id)?.generation===g)save(id,g,key,s);}
  }
  function selection(filters={}){
    const root=accounts(),list=root.accounts.filter(a=>identity(a)),names=new Map(root.people.map(p=>[p.id,p.name]));
    const person=filters.person||'',id=filters.account||'',stock=filters.stock||'';
    if(typeof person!=='string'||typeof id!=='string'||typeof stock!=='string'||stock.length>80)throw fail(400,'Invalid activity filter.');
    const chosen=list.filter(a=>(!person||a.personId===person)&&(!id||a.id===id));
    const params=[],clauses=chosen.map(a=>{params.push(a.id,identity(a));return '(account_id=? AND identity=?)';});
    let where=clauses.length?'('+clauses.join(' OR ')+')':'0';
    if(stock){where+=" AND (ticker LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\')";const q='%'+stock.replace(/[\\%_]/g,'\\$&')+'%';params.push(q,q);}
    let bounds;try{bounds=activityDateBounds(filters.from,filters.to,filters.timeZone);}catch{throw fail(400,'Choose a valid date range and time zone.');}
    if(bounds.from!==null){where+=' AND at>=?';params.push(bounds.from);}
    if(bounds.to!==null){where+=' AND at<?';params.push(bounds.to);}
    return {where,params,list,root,names,decorate:row=>{const a=list.find(a=>a.id===row.account_id);return {...JSON.parse(row.detail),accountId:a.id,accountLabel:a.label,personId:a.personId,person:names.get(a.personId)||'Unknown person',environment:a.environment,brokerId:a.snapshot.brokerId};}};
  }
  function health(id){const s=tracking(id);return s?{checkedAt:s.checkedAt,error:s.error,historyError:s.historyError,balanceError:s.balanceError,historyPending:s.historyPending}:null;}
  function read(filters={}){
    const kind=filters.kind||'trades',table={trades:'portfolio_activity_fills',orders:'portfolio_activity_orders',alerts:'portfolio_activity_events'}[kind];if(typeof table!=='string')throw fail(400,'Choose Trades, Orders or Alerts.');
    const offset=Number(filters.offset||0);if(!Number.isSafeInteger(offset)||offset<0||offset>1000000)throw fail(400,'Invalid page.');
    const s=selection(filters);if(kind==='orders'&&(filters.from||filters.to))s.where+=" AND json_extract(detail,'$.createdAt') IS NOT NULL";const total=db.prepare(`SELECT count(*) n FROM ${table} WHERE ${s.where}`).get(...s.params).n;
    const rows=db.prepare(`SELECT * FROM ${table} WHERE ${s.where} ORDER BY at DESC,${kind==='alerts'?'id':'item_id'} DESC LIMIT 50 OFFSET ?`).all(...s.params,offset);
    const statuses=s.list.map(a=>{const g=credential(a.id)?.generation,key=identity(a),saved=g?state(a.id,g,key):null;return {accountId:a.id,accountLabel:a.label,person:s.names.get(a.personId),connected:!!g,environment:a.environment,checkedAt:saved?.checkedAt||null,complete:!!saved?.complete,pages:saved?.pages||0,nextAt:saved?.nextAt||null,error:saved?.error||null,tracking:g?health(a.id):null};});
    return {kind,total,offset,more:offset+rows.length<total,items:rows.map(row=>({...s.decorate(row),...(kind==='alerts'?{eventId:row.id,at:row.at,read:row.read_at!==null}:{})})),people:s.root.people,accounts:s.list.map(a=>({id:a.id,personId:a.personId,label:a.label,environment:a.environment})),statuses};
  }
  function notifications(){
    const s=selection(),unread=db.prepare(`SELECT count(*) n FROM portfolio_activity_events WHERE ${s.where} AND read_at IS NULL`).get(...s.params).n;
    const rows=db.prepare(`SELECT * FROM portfolio_activity_events WHERE ${s.where} ORDER BY id DESC LIMIT 10`).all(...s.params);
    return {unread,latestId:rows[0]?.id||0,items:rows.map(row=>({...s.decorate(row),eventId:row.id,at:row.at,read:row.read_at!==null}))};
  }
  function markRead(input){
    if(!Number.isSafeInteger(input?.through)||input.through<0)throw fail(400,'Choose a notification to mark read.');
    const s=selection();db.prepare(`UPDATE portfolio_activity_events SET read_at=? WHERE ${s.where} AND id<=? AND read_at IS NULL`).run(now(),...s.params,input.through);return notifications();
  }
  function remove(id){for(const table of ['portfolio_activity_orders','portfolio_activity_fills','portfolio_activity_events','portfolio_activity_sync'])db.prepare(`DELETE FROM ${table} WHERE account_id=?`).run(id);}
  return {sync,observe,rejected,read,notifications,markRead,remove};
}
