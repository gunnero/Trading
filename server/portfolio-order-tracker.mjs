import {orderHistoryPath} from './portfolio-history.mjs';

const terminal=new Set(['FILLED','CANCELLED','REJECTED','REPLACED']);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const initial=()=>({revision:0,syncedRevision:0,nextCheckAt:0,historyNextAt:0,checkedAt:null,cursor:null,pages:0,seen:[]});

// Private, generation-scoped observations. A missing pending order is unresolved
// until the broker's order history supplies a terminal status for that exact ID.
export function createOrderTracker(db,{now,broker,current,orderView,refreshBalances,onObserve}){
  db.exec(`CREATE TABLE IF NOT EXISTS portfolio_tracked_orders(account_id TEXT NOT NULL,generation TEXT NOT NULL,order_id INTEGER NOT NULL,detail TEXT NOT NULL,PRIMARY KEY(account_id,generation,order_id));
    CREATE TABLE IF NOT EXISTS portfolio_order_tracking(account_id TEXT NOT NULL,generation TEXT NOT NULL,detail TEXT NOT NULL,PRIMARY KEY(account_id,generation));`);
  const state=(id,g)=>{const row=db.prepare('SELECT detail FROM portfolio_order_tracking WHERE account_id=? AND generation=?').get(id,g);return row?JSON.parse(row.detail):initial();};
  const save=(id,g,s)=>db.prepare('INSERT INTO portfolio_order_tracking VALUES(?,?,?) ON CONFLICT(account_id,generation) DO UPDATE SET detail=excluded.detail').run(id,g,JSON.stringify(s));
  const orders=(id,g)=>db.prepare('SELECT detail FROM portfolio_tracked_orders WHERE account_id=? AND generation=?').all(id,g).map(row=>JSON.parse(row.detail));
  function observe(id,g,order,s,alert=true){
    const row=db.prepare('SELECT detail FROM portfolio_tracked_orders WHERE account_id=? AND generation=? AND order_id=?').get(id,g,order.id),old=row?JSON.parse(row.detail):null;
    if(old&&(old.ticker!==order.ticker||old.side!==order.side||old.type!==order.type||old.quantity!==order.quantity))throw Error('Order identity changed. Check Trading 212.');
    if(old&&terminal.has(old.status))return;
    if(old&&finite(old.filledQuantity)&&finite(order.filledQuantity)&&order.filledQuantity<old.filledQuantity)return;
    const filled=finite(order.filledQuantity)&&order.filledQuantity>(old?.filledQuantity??0);
    if(filled||order.status==='PARTIALLY_FILLED'&&old?.status!==order.status||terminal.has(order.status)&&old?.status!==order.status)s.revision++;
    // Persist the refresh obligation before the observation, so a crash between
    // recording a fill and refreshing balances cannot lose that work.
    save(id,g,s);
    const detail={...order,filledQuantity:order.filledQuantity??old?.filledQuantity??null,firstSeen:old?.firstSeen??now(),observedAt:now(),awaitingHistory:false};
    db.prepare('INSERT INTO portfolio_tracked_orders VALUES(?,?,?,?) ON CONFLICT(account_id,generation,order_id) DO UPDATE SET detail=excluded.detail').run(id,g,order.id,JSON.stringify(detail));
    try{onObserve?.(id,g,detail,old,alert);s.activityError=null;}
    catch{s.activityError='Order status is saved; activity updates are waiting to catch up.';}
    save(id,g,s);
  }
  function record(id,ctx,order,alert=true){
    const g=ctx.record.generation,s=state(id,g);observe(id,g,order,s,alert);
    // Also refresh reservations after an accepted new order/cancellation request.
    s.revision++;s.nextCheckAt=0;save(id,g,s);
  }
  function restore(id,ctx,attempts){
    const g=ctx.record.generation;
    let restored=true;
    for(const order of attempts)if(!db.prepare('SELECT 1 FROM portfolio_tracked_orders WHERE account_id=? AND generation=? AND order_id=?').get(id,g,order.id))try{record(id,ctx,order,false);}catch{restored=false;}
    const s=state(id,g);s.restoredAttempts=restored;if(!restored)s.error='Order status is saved; local tracking is waiting to catch up.';save(id,g,s);
  }
  function result(id,g,s){
    const all=orders(id,g).sort((a,b)=>b.firstSeen-a.firstSeen||b.id-a.id);
    return {orders:[...all.filter(o=>!terminal.has(o.status)),...all.filter(o=>terminal.has(o.status)).slice(0,50)],checkedAt:s.checkedAt,error:s.error||null,historyError:s.historyError||null,balanceError:s.balanceError||null,activityError:s.activityError||null,revision:s.revision,syncedRevision:s.syncedRevision,historyPending:all.some(o=>o.awaitingHistory)};
  }
  async function poll(id,ctx){
    const g=ctx.record.generation,s=state(id,g);
    if(s.nextCheckAt>now())return result(id,g,s);
    s.nextCheckAt=now()+15000;save(id,g,s);
    try{
      const raw=await broker('/equity/orders',ctx.secret);current(id,ctx);
      if(!Array.isArray(raw)||raw.length>1000)throw Error('The pending order list is unavailable.');
      const pending=raw.map(orderView),ids=new Set();
      for(const order of pending){if(ids.has(order.id))throw Error('The broker returned duplicate order IDs.');ids.add(order.id);}
      for(const order of pending)observe(id,g,order,s);
      s.checkedAt=now();s.error=null;
      const missing=orders(id,g).filter(o=>!terminal.has(o.status)&&!ids.has(o.id));
      for(const order of missing)db.prepare('UPDATE portfolio_tracked_orders SET detail=? WHERE account_id=? AND generation=? AND order_id=?').run(JSON.stringify({...order,awaitingHistory:true}),id,g,order.id);
      if(missing.length&&s.historyNextAt<=now()){
        s.historyNextAt=now()+20000;
        try{
          const path=s.cursor||'/equity/history/orders?limit=50',raw=await broker(path,ctx.secret);current(id,ctx);
          if(!Array.isArray(raw?.items)||raw.items.length>50||!Object.hasOwn(raw,'nextPagePath'))throw Error('Order history is incomplete.');
          const next=raw.nextPagePath===null||raw.nextPagePath===''?null:orderHistoryPath(raw.nextPagePath);
          const targets=new Map(missing.map(o=>[o.id,o]));
          for(const item of raw.items){
            if(!targets.has(item?.order?.id))continue;
            const order=orderView(item.order);observe(id,g,order,s);
          }
          if(next&&(next===path||s.seen.includes(next)))throw Error('Order history pagination repeated.');
          s.pages++;s.seen.push(path);s.historyError=null;
          const unresolved=orders(id,g).some(o=>!terminal.has(o.status)&&!ids.has(o.id));
          if(!next||!unresolved||s.pages>=200){s.cursor=null;s.pages=0;s.seen=[];s.historyNextAt=now()+60000;}
          else s.cursor=next;
        }catch(e){current(id,ctx);s.historyNextAt=now()+Math.max(60000,e.retryMs||0);s.historyError=e.upstreamStatus===403?'Final status needs History: Orders permission on the API key.':e.message;s.cursor=null;s.pages=0;s.seen=[];}
      }else if(!missing.length){s.cursor=null;s.pages=0;s.seen=[];s.historyError=null;}
      for(const order of orders(id,g).filter(o=>!terminal.has(o.status)&&!ids.has(o.id)))db.prepare('UPDATE portfolio_tracked_orders SET detail=? WHERE account_id=? AND generation=? AND order_id=?').run(JSON.stringify({...order,awaitingHistory:true}),id,g,order.id);
    }catch(e){current(id,ctx);s.error=e.message;s.nextCheckAt=now()+Math.max(60000,e.retryMs||0);}
    // Recheck until successful, including after restart. Never treat a failed
    // balances refresh as evidence that the execution itself failed.
    if(s.syncedRevision<s.revision){
      try{await refreshBalances(id,ctx);current(id,ctx);s.syncedRevision=s.revision;s.balanceError=null;}
      catch(e){current(id,ctx);s.balanceError='Order status updated; holdings and cash are waiting for a successful broker refresh.';}
    }
    save(id,g,s);
    // Bound completed observations without discarding unresolved orders.
    const completed=orders(id,g).filter(o=>terminal.has(o.status)).sort((a,b)=>b.firstSeen-a.firstSeen||b.id-a.id);
    for(const order of completed.slice(100))db.prepare('DELETE FROM portfolio_tracked_orders WHERE account_id=? AND generation=? AND order_id=?').run(id,g,order.id);
    return result(id,g,s);
  }
  function remove(id){for(const table of ['portfolio_tracked_orders','portfolio_order_tracking'])db.prepare(`DELETE FROM ${table} WHERE account_id=?`).run(id);}
  function deferRestore(id,ctx){const g=ctx.record.generation,s=state(id,g);s.restoredAttempts=false;s.nextCheckAt=0;save(id,g,s);}
  function needsMonitoring(id,g,hasAttempts){const s=state(id,g);return hasAttempts&&!s.restoredAttempts||s.syncedRevision<s.revision||orders(id,g).some(o=>!terminal.has(o.status));}
  return {record,restore,poll,remove,deferRestore,needsMonitoring,read:(id,g)=>result(id,g,state(id,g))};
}
