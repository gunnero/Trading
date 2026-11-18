import {marketDay,validDay} from './calendar.mjs';
import {journalStats} from './journal.mjs';
import {REVIEW_RULES} from './journal-review.mjs';

export const SESSION_NOTE_FIELDS=[['wentWell','What went well'],['mistakes','Mistakes to work on'],['lesson','Main lesson'],['nextSession','Focus for the next session']];
export const SESSION_CHECKS=[['retest','Waited for a separate retest'],['alignment','EMA 9/21 and VWAP aligned'],['risk','Respected planned risk']];
const checkIds=SESSION_CHECKS.map(([key])=>key);
export const sessionAccount=trade=>JSON.stringify([trade.firm,trade.account]);
export const sessionDates=trades=>[...new Set(trades.flatMap(t=>[marketDay(t.entryAt),...(t.exitAt?[marketDay(t.exitAt)]:[])]))].sort().reverse();
export function defaultSessionDay(trades,now=Date.now()){
  const today=marketDay(now),dates=sessionDates(trades);
  return dates.find(day=>day<=today)||today;
}
export function sessionResults(trades,day,account=''){
  const scoped=trades.filter(t=>!account||sessionAccount(t)===account);
  const entries=scoped.filter(t=>marketDay(t.entryAt)===day).sort((a,b)=>a.entryAt.localeCompare(b.entryAt));
  const closed=scoped.filter(t=>t.exitAt&&marketDay(t.exitAt)===day).sort((a,b)=>a.exitAt.localeCompare(b.exitAt));
  const open=entries.filter(t=>!t.exitAt);
  const tags=new Map();for(const trade of entries)for(const tag of new Set(trade.tags))tags.set(tag,(tags.get(tag)||0)+1);
  return {entries,closed,open,stats:journalStats(closed),tags:[...tags].map(([label,count])=>({label,count})).sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label))};
}
export function sessionAdherence(entries,results){
  const rules=REVIEW_RULES.map(([id,label])=>({id,label,met:0,missed:0,unknown:0}));
  const counts={matched:0,missed:0,incomplete:0,outside:0,loading:0,cached:0};
  for(const trade of entries){
    const item=results[trade.id],review=item?.review;
    if(!item||item.status==='loading')counts.loading++;
    else if(review?.status==='outside-session')counts.outside++;
    else if(review?.status==='matched')counts.matched++;
    else if(review?.status==='missed')counts.missed++;
    else counts.incomplete++;
    if(item?.cached)counts.cached++;
    for(const rule of rules){const passed=review?.checks.find(c=>c.id===rule.id)?.passed;rule[passed===true?'met':passed===false?'missed':'unknown']++;}
  }
  const complete=counts.matched+counts.missed;
  return {...counts,total:entries.length,complete,matchRate:complete?counts.matched/complete*100:null,rules};
}
export function validateSessionReviews(value){
  const fail=()=>{throw Error('Invalid daily review notes.');};
  if(!value||value.version!==1||!Array.isArray(value.days)||value.days.length>730)fail();
  const seen=new Set();
  const days=value.days.map(row=>{
    if(!row||!validDay(row.date)||seen.has(row.date))fail();seen.add(row.date);
    const result={date:row.date};
    for(const [key] of SESSION_NOTE_FIELDS){const text=row[key]??'';if(typeof text!=='string'||text.length>2000)fail();result[key]=text;}
    if(row.reflection!==undefined){
      if(typeof row.reflection!=='string'||row.reflection.length>2000)fail();
      if(row.reflection)result.reflection=row.reflection;
    }
    if(row.checks!==undefined){
      if(!Array.isArray(row.checks)||row.checks.length>checkIds.length||row.checks.some(key=>!checkIds.includes(key))||new Set(row.checks).size!==row.checks.length)fail();
      if(row.checks.length)result.checks=checkIds.filter(key=>row.checks.includes(key));
    }
    return result;
  });
  const result={version:1,days};if(JSON.stringify(result).length>800000)throw Error('Daily review notes have reached their storage limit. Back up your workspace before clearing older notes.');
  return result;
}
function updateDay(value,date,changes){
  const rows=value?.days||[],existing=rows.find(row=>row.date===date)||{date};
  const next={...existing,...changes},days=rows.filter(row=>row.date!==date);
  if(next.checks?.length||next.reflection?.trim()||SESSION_NOTE_FIELDS.some(([field])=>next[field]?.trim()))days.push(next);
  return validateSessionReviews({version:1,days:days.sort((a,b)=>b.date.localeCompare(a.date))});
}
export function saveSessionNote(value,date,key,text){
  if(key!=='reflection'&&!SESSION_NOTE_FIELDS.some(([field])=>field===key))throw Error('Unknown daily review field.');
  return updateDay(value,date,{[key]:text});
}
export function saveSessionCheck(value,date,key,checked){
  if(!checkIds.includes(key)||typeof checked!=='boolean')throw Error('Invalid daily checklist item.');
  const checks=new Set(value?.days.find(row=>row.date===date)?.checks);
  if(checked)checks.add(key);else checks.delete(key);
  return updateDay(value,date,{checks:[...checks]});
}
