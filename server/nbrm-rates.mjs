import {readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {validDay} from '../src/data/transfers.mjs';
const SOURCE='https://www.nbrm.mk/KLServiceNOV/EN/GetExchangeRate';
const day=now=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Skopje',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
export function normalizeNbrm(raw,today){
 if(!Array.isArray(raw)||raw.length>1000)throw Error('Invalid rate list');
 const dates=[...new Set(raw.map(r=>r.datum?.slice(0,10)).filter(d=>validDay(d)&&d<=today&&Date.parse(today)-Date.parse(d)<=7*86400000))].sort().reverse();
 for(const date of dates){
  const rates={MKD:'1'};
  for(const code of ['USD','EUR']){
   const entries=raw.filter(r=>r.datum?.slice(0,10)===date&&r.oznaka===code);
   if(entries.length!==1)continue;
   const r=entries[0];if(!Number.isFinite(r.sreden)||r.sreden<=0||!Number.isFinite(r.nomin)||r.nomin<=0)continue;
   const rate=r.sreden/r.nomin;if(rate>0&&rate<10000)rates[code]=rate.toFixed(8);
  }
  if(rates.USD&&rates.EUR)return {date,rates,sourceUrl:SOURCE};
 }
 throw Error('No complete recent rate list');
}
export function createNbrmRates(directory,{fetchImpl=fetch,now=()=>new Date()}={}){
 let cached=null,checked=0,pending=null,loaded=false;
 const file=join(directory,'nbrm-rates-cache.json');
 function usable(value){try{return value&&validDay(value.date)&&value.date<=day(now())&&Date.parse(day(now()))-Date.parse(value.date)<=7*86400000&&['USD','EUR'].every(c=>typeof value.rates?.[c]==='string'&&/^\d+(\.\d{1,8})?$/.test(value.rates[c])&&Number(value.rates[c])>0&&Number(value.rates[c])<10000);}catch{return false;}}
 async function read(){
  if(!loaded){loaded=true;try{const saved=JSON.parse(await readFile(file,'utf8'));if(usable(saved))cached=saved;}catch{}}
  if(checked&&Number(now())-checked<3600000)return usable(cached)?{...cached,cached:true}:{state:'unavailable',sourceUrl:SOURCE};
  if(pending)return pending;
  pending=(async()=>{
   checked=Number(now());const end=day(now()),start=new Date(Date.parse(end)-7*86400000).toISOString().slice(0,10),fmt=d=>d.split('-').reverse().join('.');
   try{
    const url=new URL('https://www.nbrm.mk/KLServiceNOV/GetExchangeRate');url.search=new URLSearchParams({StartDate:fmt(start),EndDate:fmt(end),format:'json'});
    const response=await fetchImpl(url,{signal:AbortSignal.timeout(12000),redirect:'error'});if(!response.ok)throw Error('Rate provider unavailable');
    let size=0;const chunks=[];for await(const part of response.body){size+=part.length;if(size>500000)throw Error('Rate list too large');chunks.push(Buffer.from(part));}
    const value=normalizeNbrm(JSON.parse(Buffer.concat(chunks).toString('utf8')),end);cached={...value,fetchedAt:now().toISOString(),state:'available'};
    try{await writeFile(file+'.tmp',JSON.stringify(cached),{mode:0o600});await rename(file+'.tmp',file);}catch{/* Memory cache remains usable. */}
    return {...cached,cached:false};
   }catch{return usable(cached)?{...cached,cached:true,state:'cached'}:{state:'unavailable',sourceUrl:SOURCE};}
  })().finally(()=>{pending=null;});return pending;
 }
 return {read};
}
