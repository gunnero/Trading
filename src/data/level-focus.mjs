import {FUTURES_CONTEXT} from './market-context.mjs';
import {quoteKey} from './quotes.mjs';

export const FOCUS_SYMBOLS=['QQQ','SPY'];
export const CONTEXT_SYMBOLS=['NQ','ES','IWM','RTY'];

// Use only the same explicitly mapped listings as the existing charts.
export function levelChartKey(instrument,destination){
  if(!instrument)return null;
  if(instrument.futures)return FUTURES_CONTEXT.find(item=>item.label===instrument.symbol)?.key||null;
  return destination.kind==='setup'?quoteKey(destination.entry):null;
}
export function zoneDistance(zone,price){
  return Number.isFinite(price)?Math.max(zone.low-price,price-zone.high,0):null;
}
export function nearestLevelZones(zones,type,price){
  return zones.filter(zone=>zone.type===type).toSorted((a,b)=>{
    if(Number.isFinite(price))return zoneDistance(a,price)-zoneDistance(b,price)||a.low-b.low;
    return type==='D'?b.high-a.high:a.low-b.low;
  }).slice(0,2);
}

// Present the existing source-timeframe confirmation, without deriving a role
// from the quote or from a developing candle. Archived lists stay references.
export function levelRoleRows(imported,roles,reference=null){
  const matching=roles?.instrument?.symbol===imported.symbol&&roles.date===imported.sourceDate;
  const usable=!reference&&matching&&['ok','stale'].includes(roles.status);
  const cutoff=Number.isFinite(roles?.through)?roles.through:0;
  const bars=usable?(roles.bars||[]).filter(bar=>bar.closed===true&&Number.isFinite(bar.close)&&Number.isFinite(bar.end)&&bar.end<=cutoff&&bar.sessionDate>=imported.sourceDate).toSorted((a,b)=>a.end-b.end):[];
  const latest=bars.at(-1);
  return imported.zones.map((zone,index)=>{
    const current=roles?.instrument?.zones[index];
    const confirmed=latest&&current?.low===zone.low&&current?.high===zone.high&&current?.originalType===zone.type;
    const flip=confirmed&&current.lastFlip;
    const evidence=flip?bars.find(bar=>bar.end===flip.at&&bar.close===flip.close):latest;
    const status=reference||(!matching?'Confirmation unavailable':roles.status==='loading'?'Checking closes':roles.status==='insufficient'?'History incomplete':!usable?'Confirmation unavailable':'No completed candles');
    if(zone.type==='G')return {zone,type:'G',label:'Gap (reference)',status:'Not auto-flipped',evidence:null};
    if(!confirmed||!evidence)return {zone,type:zone.type,label:`Imported ${zone.type==='S'?'supply':'demand'}`,status,evidence:null};
    return {zone,type:current.type,label:current.type==='D'?'Support (demand)':'Supply (resistance)',status:roles.status==='stale'?'Cached confirmation':flip?'Role changed':'Role confirmed',evidence};
  });
}
