import {validDay} from '../src/data/calendar.mjs';
const numeric=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const raw=value=>numeric(value?.raw??value);
const suppliedNumber=value=>raw(value)??(typeof value==='string'&&/^-?\d+(\.\d+)?$/.test(value.trim())?numeric(Number(value)):null);
const text=value=>typeof value==='string'?value.trim().slice(0,40):null;
const day=value=>{
 if(validDay(value?.fmt))return value.fmt;
 const n=raw(value);return n!==null&&n>0&&n<1e11?new Date(n*1000).toISOString().slice(0,10):null;
};
const basisFor=value=>value==='gaap'?'GAAP':value==='nongaap'?'Non-GAAP':'Source basis unspecified';
function periodOrder(row){
 if(row.end)return row.end;
 const m=/^([1-4])Q(\d{4})$/.exec(row.period||'');
 return m?`${m[2]}-${String(Number(m[1])*3).padStart(2,'0')}`:row.reported||row.period||'';
}
export function earningsHistory(module={},now=Date.now()){
 const today=new Date(now).toISOString().slice(0,10),rows=new Map();
 for(const r of Array.isArray(module.earningsChart?.quarterly)?module.earningsChart.quarterly:[]){
  if(!r||typeof r!=='object')continue;
  const period=text(r.fiscalQuarter||r.date),end=day(r.periodEndDate),reported=day(r.reportedDate),actual=raw(r.actual),estimate=raw(r.estimate);
  if(!period&&!end||reported>today||end>today||actual===null&&!reported)continue;
  const surprisePercent=suppliedNumber(r.surprisePct);
  const row={period:period||end,end,reported,actual,estimate,surprisePercent};
  rows.set(end||period,row);
 }
 return [...rows.values()].sort((a,b)=>periodOrder(a).localeCompare(periodOrder(b)));
}
export function companyEarningsSeries(modules,now=Date.now()){
 const base=modules.earnings||{},basis=basisFor(base.defaultMethodology),series=[];
 for(const [id,label,module] of [['gaap','GAAP',modules.earningsGaap],['nongaap','Non-GAAP',modules.earningsNonGaap]]){
  if(module&&earningsHistory(module,now).length)series.push({id,basis:label,history:earningsHistory(module,now)});
 }
 const history=earningsHistory(base,now);
 const same=series.find(s=>s.basis===basis);
 if(same){const merged=new Map([...history,...same.history].map(row=>[row.end||row.period,row]));same.history=[...merged.values()].sort((a,b)=>periodOrder(a).localeCompare(periodOrder(b)));}
 else if(history.length)series.push({id:'default',basis,history});
 return {history,basis,series,defaultSeries:series.find(s=>s.basis===basis)?.id||series[0]?.id||'default'};
}
