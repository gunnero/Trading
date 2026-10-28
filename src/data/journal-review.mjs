import {marketDay,addDays} from './calendar.mjs';
import {tradingDay} from './market-session.mjs';
import {parseLevels} from './market.js';
import {levelSnapshots} from './level-history.mjs';
import {ema,sessionVwap} from './indicators.mjs';
import {RETEST_WINDOW,CONFIRMATION_WINDOW} from './retests.mjs';

const finite=n=>typeof n==='number'&&Number.isFinite(n);
export const REVIEW_RULES=[['break','Closed 2m break'],['retest','Separate retest'],['ema','9 / 21 EMA alignment'],['vwap','Session VWAP'],['timing','Fresh confirmation'],['location','Close to the zone']];
export const tradeDirection=trade=>(trade.optionType==='CALL')===(trade.position==='long')?'bullish':'bearish';
export function replayDates(trade){
  const day=marketDay(trade.entryAt),to=marketDay(trade.exitAt||trade.entryAt);
  // Leave room for EMA warm-up without exceeding the history API's 31-day limit.
  const warmup=[addDays(day,-7),addDays(to,-30)].sort().at(-1);
  return {day,to,from:warmup<=day?warmup:day};
}
export function tradeLevelContext(trade,workspace){
  const day=marketDay(trade.entryAt);
  try{
    const saved=levelSnapshots(workspace).find(sheet=>sheet.date===day);
    if(!saved)return {status:'missing',day,message:`No saved level sheet for ${day}. Zone checks need that day's levels.`};
    const instrument=parseLevels(saved.levelText,saved.levelSourceDates).instruments[trade.symbol];
    if(!instrument||instrument.futures)return {status:'missing',day,message:`No stock/ETF zones for ${trade.symbol} in the ${day} sheet.`};
    if(instrument.sourceDate!==day)return {status:'dated',day,instrument,message:`These zones were carried from ${instrument.sourceDate}; they cannot verify the ${day} entry.`};
    return {status:'ok',day,instrument,message:`Saved ${day} sheet · ${instrument.timeframe} levels. Import time was not recorded; same-day corrections may differ from what you saw at entry.`};
  }catch{return {status:'missing',day,message:'The saved level sheet is unavailable for this trade.'};}
}
function patternsFor(zones,bars,priorClose){
  const patterns=[];
  for(const zone of zones.filter(z=>z.type!=='G')){
    let role=zone.type,active=null,previous=priorClose;
    bars.forEach((bar,i)=>{
      const [,close,low,high]=bar.ohlc,above=close>zone.high,below=close<zone.low;
      const flip=role==='S'&&above?'bullish':role==='D'&&below?'bearish':null;
      if(flip){
        const crossed=flip==='bullish'?(previous??bar.ohlc[0])<=zone.high:(previous??bar.ohlc[0])>=zone.low;
        role=flip==='bullish'?'D':'S';
        active=crossed?{zone,direction:flip,stage:'waiting-retest',breakAt:bar.end,breakIndex:i,confirmedAt:null,confirmIndex:null}:null;
      }else if(active){
        const holds=active.direction==='bullish'?above:below,touches=low<=zone.high&&high>=zone.low;
        if(active.confirmIndex!==null&&i-active.confirmIndex>=CONFIRMATION_WINDOW)active.stage='expired';
        else if(active.confirmIndex===null&&i-active.breakIndex>RETEST_WINDOW)active.stage='expired';
        else if(active.stage!=='expired'){
          if(!holds){active.stage='retesting';active.confirmIndex=null;active.confirmedAt=null;}
          else if(touches&&i>active.breakIndex){active.stage='confirmed';active.confirmIndex=i;active.confirmedAt=bar.end;}
        }
      }
      previous=close;
    });
    if(active)patterns.push(active);
  }
  return patterns;
}
const fmt=n=>finite(n)?n.toFixed(2):'unavailable';
export function reviewTrade(trade,history,levels){
  const direction=tradeDirection(trade),bull=direction==='bullish',entry=Date.parse(trade.entryAt)/1000,day=marketDay(trade.entryAt),schedule=tradingDay(day);
  const checks=REVIEW_RULES.map(([id,label])=>({id,label,passed:null,detail:'Waiting for dated 2m history.'}));
  const result={direction,day,entry,checks,levels,frame:'2m',status:'incomplete',headline:'Review incomplete',through:null,reference:null,pattern:null};
  const set=(id,passed,detail)=>Object.assign(checks.find(c=>c.id===id),{passed,detail});
  const finish=()=>{
    result.passed=checks.filter(c=>c.passed===true).length;result.failed=checks.filter(c=>c.passed===false).length;result.unknown=checks.filter(c=>c.passed===null).length;
    if(result.status!=='outside-session'){
      result.status=result.unknown?'incomplete':result.failed?'missed':'matched';
      result.headline=result.unknown?'Review incomplete':result.failed?`Entry missed ${result.failed} ${result.failed===1?'check':'checks'}`:'Rules matched before entry';
    }
    return result;
  };
  const unknown=message=>{checks.forEach(c=>{c.detail=message;});return finish();};
  if(schedule.kind==='unknown')return unknown('The exchange schedule is unavailable for this date.');
  const open=Date.parse(schedule.open)/1000,close=Date.parse(schedule.close)/1000;
  if(schedule.kind!=='session'||entry<open||entry>=close){result.status='outside-session';result.headline='Outside your trading session';return unknown('Your strategy starts at the regular stock-market open; this entry is outside that session.');}
  if(!history||history.status==='loading')return unknown('Loading dated 2m candles for the entry.');
  if(!['ok','stale'].includes(history.status)||!history.candles?.length)return unknown('Historical 2m candles are unavailable; executions alone cannot verify this setup.');
  if(history.timeframe!=='2m'||history.symbol?.split(':').at(-1)!==trade.symbol)return unknown('The review needs this exact underlying listing on 2m candles.');
  if(!finite(history.observedThrough)||history.observedThrough<entry)return unknown('The source had not observed the entry time. A later clock does not complete cached candles.');
  // Use completed candles only. Never evaluate the final OHLC of the candle
  // containing an intra-candle entry, or any candle after entry.
  const rows=history.candles.filter(c=>c.complete===true&&c.end<=entry&&c.end<=history.observedThrough&&c.ohlc?.length===4&&c.ohlc.every(finite)).sort((a,b)=>a.timestamp-b.timestamp);
  const bars=rows.filter(c=>c.sessionDate===day),requiredEnd=open+Math.floor((entry-open)/120)*120;
  const covered=requiredEnd===open?bars.length===0:bars.length>0&&bars[0].timestamp===open&&bars.at(-1).end===requiredEnd&&bars.every((bar,i)=>bar.start===open&&bar.end-bar.timestamp===120&&(!i||bars[i-1].end===bar.timestamp));
  if(!covered)return unknown('Missing or unfinished 2m candles before entry. The review pauses rather than assuming a break or retest.');
  if(!bars.length){checks.forEach(c=>{c.detail='There was no completed regular-session 2m candle before entry.';});set('break',false,'Entry was before the first 2m close.');set('retest',false,'A separate closed retest was not available yet.');return finish();}
  const fast=ema(rows.map(c=>c.ohlc[1]),9),slow=ema(rows.map(c=>c.ohlc[1]),21),vwap=sessionVwap(rows);
  const readings=new Map(rows.map((c,i)=>[c.end,{close:c.ohlc[1],ema9:fast[i],ema21:slow[i],vwap:vwap[i]}]));
  const latest=bars.at(-1),reference=readings.get(latest.end);result.through=latest.end;result.reference=reference;
  const prior=rows.findLast(c=>c.sessionDate<day)?.ohlc[1];
  const patterns=levels?.status==='ok'?patternsFor(levels.instrument.zones,bars,prior):[];
  const same=patterns.filter(p=>p.direction===direction);
  const aligned=(read,key)=>!read||!finite(read[key])||key==='ema9'&&!finite(read.ema21)?null:key==='ema9'?(bull?read.ema9>read.ema21&&read.close>read.ema21:read.ema9<read.ema21&&read.close<read.ema21):(bull?read.close>read.vwap:read.close<read.vwap);
  // Prefer a fully eligible setup when multiple zones were retested. A newer
  // or narrower failed candidate must not hide another valid setup at entry.
  const eligible=p=>{
    const confirmation=readings.get(p.confirmedAt),edge=bull?p.zone.high:p.zone.low;
    const near=Math.abs(reference.close-edge)<=Math.max(p.zone.high-p.zone.low,reference.close*.001);
    return p.stage==='confirmed'&&near&&(bull?reference.close>edge:reference.close<edge)&&['ema9','vwap'].every(key=>aligned(reference,key)===true&&aligned(confirmation,key)===true);
  };
  const rank=p=>eligible(p)?0:p.stage==='confirmed'?1:p.stage==='waiting-retest'?2:p.stage==='retesting'?3:4;
  same.sort((a,b)=>rank(a)-rank(b)||(b.confirmedAt||b.breakAt)-(a.confirmedAt||a.breakAt)||Math.abs(reference.close-(bull?a.zone.high:a.zone.low))-Math.abs(reference.close-(bull?b.zone.high:b.zone.low)));
  const pattern=same[0];result.pattern=pattern||null;
  const confirm=pattern?.confirmedAt?readings.get(pattern.confirmedAt):null;
  for(const [id,key] of [['ema','ema9'],['vwap','vwap']]){
    const latestPass=aligned(reference,key),confirmationPass=confirm?aligned(confirm,key):true;
    const passed=latestPass===null||confirmationPass===null?null:latestPass&&confirmationPass;
    const values=id==='ema'?`EMA 9 ${fmt(reference.ema9)} · EMA 21 ${fmt(reference.ema21)} · close ${fmt(reference.close)}`:`VWAP ${fmt(reference.vwap)} · close ${fmt(reference.close)}`;
    set(id,passed,`${values}. ${passed===null?(id==='vwap'?'Complete session volume is required.':'More warm-up candles are required.'):confirm?'Checked at retest confirmation and the last close before entry.':'Checked at the last close before entry; no retest confirmation is available.'}`);
  }
  if(levels?.status!=='ok'){
    for(const id of ['break','retest','timing','location'])set(id,null,levels?.message||'A matching dated level sheet is required.');
    return finish();
  }
  if(!levels.instrument.zones.some(z=>z.type!=='G')){
    for(const id of ['break','retest','timing','location'])set(id,null,'The saved sheet contains no supply/demand zones for this strategy.');
    return finish();
  }
  if(!pattern){
    const opposite=patterns.sort((a,b)=>b.breakAt-a.breakAt)[0];
    set('break',false,opposite?`The available break was ${opposite.direction}; this ${trade.position} ${trade.optionType.toLowerCase()} needs a ${direction} setup.`:`No completed ${direction} break through a full zone before entry.`);
    set('retest',false,'No separate closed retest for the trade direction before entry.');
    set('timing',false,'No confirmed setup was available to enter.');
    set('location',null,'There is no matching broken zone to measure entry distance from.');
    return finish();
  }
  set('break',true,`A candle closed ${bull?'above':'below'} the full ${fmt(pattern.zone.low)}–${fmt(pattern.zone.high)} zone.`);
  set('retest',!!pattern.confirmedAt,pattern.confirmedAt?'A separate later candle touched the zone and closed back on the breakout side.':pattern.stage==='expired'?`No valid retest within ${RETEST_WINDOW} candles of the break.`:'Entry came before a separate retest candle closed back on the breakout side.');
  const age=pattern.confirmIndex===null?null:bars.length-1-pattern.confirmIndex;
  set('timing',pattern.stage==='confirmed'&&age<CONFIRMATION_WINDOW,age===null?'No closed retest was confirmed before entry.':`${age} completed candles since confirmation; it must be fewer than ${CONFIRMATION_WINDOW}.`);
  const edge=bull?pattern.zone.high:pattern.zone.low,width=Math.max(pattern.zone.high-pattern.zone.low,reference.close*.001),distance=Math.abs(reference.close-edge),correctSide=bull?reference.close>edge:reference.close<edge;
  result.distance={edge,width,points:distance};
  set('location',correctSide&&distance<=width,`Last closed underlying price was ${fmt(distance)} from the broken edge; limit ${fmt(width)}. ${correctSide?'On the breakout side.':'Back inside or beyond the zone.'} The exact underlying price at the option fill is unavailable.`);
  return finish();
}
