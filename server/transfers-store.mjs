import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {normalizeExport,matchKey,validateReview} from '../src/data/transfers.mjs';
const fail=message=>Object.assign(Error(message),{status:400});
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function openTransfersStore(directory){
 mkdirSync(directory,{recursive:true,mode:0o700});const filename=join(directory,'transfers.sqlite');const db=new DatabaseSync(filename);chmodSync(filename,0o600);db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS transfers (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, document TEXT NOT NULL);');
 db.prepare('INSERT OR IGNORE INTO transfers VALUES (1,0,?)').run(JSON.stringify({version:1,rows:[],rules:[],sources:[],sync:{state:'disconnected',lastSuccess:null,message:'Connect NLB to import your transactions.'},automatic:false}));
 if(db.prepare('PRAGMA user_version').get().user_version>1){db.close();throw Error('This ledger was created by a newer app version.');}db.exec('PRAGMA user_version=1');
 const read=()=>{const row=db.prepare('SELECT revision,document FROM transfers WHERE id=1').get();return {revision:row.revision,data:JSON.parse(row.document)};};
 function change(fn,revision){const before=read();if(revision!==undefined&&before.revision!==revision)throw Object.assign(Error('The ledger changed. Reload and review your edit again.'),{status:409});const original=JSON.stringify(before.data);const data=fn(before.data);if(JSON.stringify(data)===original)return before;if(data.rows.length>10000||Buffer.byteLength(JSON.stringify(data))>12_000_000)throw fail('The ledger reached its storage limit. Export a backup before continuing.');const result=db.prepare('UPDATE transfers SET revision=revision+1,document=? WHERE id=1 AND revision=?').run(JSON.stringify(data),before.revision);if(!result.changes)throw Object.assign(Error('The ledger changed. Reload and retry.'),{status:409});return {revision:before.revision+1,data};}
 function ingest(batches){return change(data=>{
  // Validate every batch before changing any rows; bank reads never delete history.
  const normalized=batches.map(({source,rows})=>({source,rows:normalizeExport(rows,source)}));
  const map=new Map(data.rows.map(row=>[row.id,row])),newIds=new Set();
  for(const {source,rows} of normalized){const occurrences=new Map();for(const row of rows){
   const fingerprint=digest([source.key,row.date,row.description,row.recipient,row.amount,row.currency]),ordinal=(occurrences.get(fingerprint)||0)+1;occurrences.set(fingerprint,ordinal);
   const id=`${fingerprint}:${ordinal}`,existing=map.get(id),next={...row,id,sourceKey:source.key,sourceLabel:source.label,kind:source.kind,firstSeen:existing?.firstSeen||new Date().toISOString(),review:existing?.review||null,possibleChange:existing?.possibleChange||false};
   if(!existing)newIds.add(id);
   if(existing&&(existing.status!==row.status||existing.fee!==row.fee))next.review=null;
   map.set(id,next);
  }}
  const all=[...map.values()],overlaps=new Map(),variants=new Map();
  const variantKey=row=>JSON.stringify([row.sourceKey,row.date,row.description,row.recipient,row.currency]);
  for(const row of all){const key=variantKey(row);if(!variants.has(key))variants.set(key,[]);variants.get(key).push(row);}
  for(const group of variants.values()){if(new Set(group.map(row=>row.amount)).size>1&&group.some(row=>newIds.has(row.id))){for(const row of group){row.review=null;row.possibleChange=true;}}}
  for(const row of all){if(!row.date||row.amount===null||!row.currency)continue;const key=JSON.stringify([row.date,row.amount,row.currency]);if(!overlaps.has(key))overlaps.set(key,new Set());overlaps.get(key).add(row.sourceKey);}
  for(const row of all){if(row.review)continue;
   const possibleDuplicate=!!row.possibleChange||(overlaps.get(JSON.stringify([row.date,row.amount,row.currency]))?.size||0)>1;
   row.possibleDuplicate=possibleDuplicate;
   const rule=data.rules.find(rule=>rule.key===matchKey(row));
   if(rule&&!possibleDuplicate){try{row.review=validateReview(row,rule.review);}catch{/* Incomplete rows stay in review. */}}
  }
  return {...data,rows:all.sort((a,b)=>(b.date||'').localeCompare(a.date||'')||a.id.localeCompare(b.id))};
 });}
 function review(id,value,remember,revision){return change(data=>{const row=data.rows.find(row=>row.id===id);if(!row)throw fail('Transaction not found.');const reviewed=validateReview(row,value);row.review=reviewed;row.possibleDuplicate=false;row.possibleChange=false;if(remember){if(!row.description&&!row.recipient)throw fail('A repeat rule needs a description or counterparty.');const key=matchKey(row);data.rules=data.rules.filter(rule=>rule.key!==key);if(data.rules.length>=200)throw fail('At most 200 matching rules are supported.');data.rules.push({key,review:reviewed,label:row.description||row.recipient});}return data;},revision);}
 return {read,change,ingest,review,close:()=>db.close()};
}
