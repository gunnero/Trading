import {awaitingSessionQuote,isExtendedQuote} from './quotes.mjs';
import {tradingDay} from './market-session.mjs';
export const RETEST_WINDOW=12,CONFIRMATION_WINDOW=3;
export const stageLabel=stage=>({'confirmed':'Retest confirmed','waiting-retest':'Waiting for retest',retesting:'Retesting zone','waiting-break':'Waiting for break','awaiting-session':'Today’s levels ready',extended:'Extended from zone',expired:'Setup expired',invalidated:'Setup invalidated','indicator-conflict':'Indicator conflict','indicators-unavailable':'Indicators unavailable','no-levels':'No supplied levels',dated:'Dated levels',stale:'Cached / old data',loading:'Checking candles',unavailable:'Data unavailable',insufficient:'Incomplete history'}[stage]||'Waiting for data');
const candidateStages=['confirmed','retesting','waiting-retest'];
export function evaluateRetest(instrument,sheetDate,data,now=Date.now()){
  sheetDate=instrument?.sourceDate||sheetDate;
  const base={quote:data?.quote,timeframe:data?.timeframe,through:data?.through,fetchedAt:data?.fetchedAt,sessionDate:data?.quote?.sessionDate};
  if(!instrument||instrument.futures||!instrument.zones.some(z=>z.type!=='G'))return {...base,stage:'no-levels'};
  if(!data||data.status==='loading')return {...base,stage:'loading'};
  if(data.status!=='ok')return {...base,stage:['stale','insufficient'].includes(data.status)?data.status:'unavailable',message:data.message};
  if(sheetDate!==data.quote?.sessionDate){
    if(awaitingSessionQuote(sheetDate,data.quote,now)){
      const open=tradingDay(sheetDate).open;
      return {...base,stage:'awaiting-session',through:null,message:now<Date.parse(open)?`Your ${sheetDate} levels are ready for pre-market preparation. Break-and-retest confirmation uses regular-session candles, starting at the U.S. market open. No new import is needed.`:`Your ${sheetDate} levels are ready. Waiting for today's regular-session candles from Yahoo before confirming a setup. No new import is needed.`};
    }
    return {...base,stage:'dated'};
  }
  if(isExtendedQuote(data.quote))return {...base,stage:'awaiting-session',through:null,message:'Extended-hours prices provide level context only. Break-and-retest confirmation requires regular-session candles and a regular-session quote.'};
  const ordered=[...new Map((data.bars||[]).filter(b=>b.closed===true&&[b.open,b.close,b.high,b.low,b.end].every(Number.isFinite)).map(b=>[b.end,b])).values()].sort((a,b)=>a.end-b.end);
  const bars=ordered.filter(b=>b.sessionDate===sheetDate),prior=ordered.filter(b=>b.sessionDate<sheetDate).at(-1);
  const patterns=[],latest=bars.at(-1),reference=latest?.indicators||{};
  base.dailyStatus=data.dailyStatus;base.indicators=reference;
  for(const zone of instrument.zones.filter(z=>z.type!=='G')){
    let role=zone.type,active=null,previous=prior?.close;
    for(let i=0;i<bars.length;i++){
      const bar=bars[i],above=bar.close>zone.high,below=bar.close<zone.low;
      const flip=role==='S'&&above?'bullish':role==='D'&&below?'bearish':null;
      if(flip){
        const crossed=flip==='bullish'?(previous??bar.open)<=zone.high:(previous??bar.open)>=zone.low;
        role=flip==='bullish'?'D':'S';
        active=crossed?{zone:{...zone},direction:flip,stage:'waiting-retest',breakAt:bar.end,breakClose:bar.close,breakIndex:i,confirmIndex:null}:null;
      }else if(active){
        const holds=active.direction==='bullish'?above:below,touches=bar.low<=zone.high&&bar.high>=zone.low;
        if(active.confirmIndex!==null&&i-active.confirmIndex>=CONFIRMATION_WINDOW)active.stage='expired';
        else if(active.confirmIndex===null&&i-active.breakIndex>RETEST_WINDOW)active.stage='expired';
        else if(active.stage!=='expired'){
          if(!holds){active.stage='retesting';active.confirmIndex=null;active.confirmedAt=null;}
          else if(touches&&i>active.breakIndex){active.stage='confirmed';active.confirmIndex=i;active.confirmedAt=bar.end;active.confirmClose=bar.close;}
        }
      }
      previous=bar.close;
    }
    if(active){
      const bull=active.direction==='bullish',edge=bull?zone.high:zone.low,price=data.quote.price;
      const width=Math.max(zone.high-zone.low,price*.001),distance=Math.abs(price-edge)/width;
      if((bull&&price<zone.low)||(!bull&&price>zone.high))active.stage='invalidated';
      else if(active.stage==='confirmed'&&((bull&&price<=zone.high)||(!bull&&price>=zone.low)))active.stage='retesting';
      else if(candidateStages.includes(active.stage)&&distance>1)active.stage='extended';
      const confirmed=bars.find(b=>b.end===active.confirmedAt),aligned=bar=>{
        const v=bar?.indicators||{},finite=key=>typeof v[key]==='number'&&Number.isFinite(v[key]);
        return [{name:'9 / 21 EMA',passed:finite('ema9')&&finite('ema21')?(bull?v.ema9>v.ema21&&bar.close>v.ema21:v.ema9<v.ema21&&bar.close<v.ema21):null},
          {name:'Session VWAP',passed:finite('vwap')?(bull?bar.close>v.vwap:bar.close<v.vwap):null}];
      };
      const confirmationChecks=confirmed?aligned(confirmed):null;
      const checks=aligned(latest).map((check,i)=>{
        if(check.passed===null||confirmationChecks?.[i].passed===null)return {...check,passed:null};
        const value=i===0?reference.ema21:reference.vwap;
        const priceAligned=Number.isFinite(price)&&Number.isFinite(value)&&(bull?price>value:price<value);
        return {...check,passed:check.passed&&(!confirmationChecks||confirmationChecks[i].passed)&&priceAligned};
      });
      if(candidateStages.includes(active.stage)){
        if(checks.some(c=>c.passed===null))active.stage='indicators-unavailable';
        else if(checks.some(c=>!c.passed))active.stage='indicator-conflict';
      }
      patterns.push({...base,...active,distance,checks,invalidation:bull?zone.low:zone.high});
    }
  }
  return patterns.sort(compareSetups)[0]||{...base,stage:'waiting-break'};
}
export function compareSetups(a,b){
  const rank=s=>({confirmed:0,retesting:1,'waiting-retest':2,'indicator-conflict':3,'indicators-unavailable':4,extended:5,expired:6,invalidated:7}[s]??8);
  return rank(a.stage)-rank(b.stage)||(b.confirmedAt||b.breakAt||0)-(a.confirmedAt||a.breakAt||0)||(a.distance??Infinity)-(b.distance??Infinity)||(a.entry?.symbol||'').localeCompare(b.entry?.symbol||'');
}
export const topRetest=results=>results.filter(r=>candidateStages.includes(r.stage)).sort(compareSetups)[0]||null;
