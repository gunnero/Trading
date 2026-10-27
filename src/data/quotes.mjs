import {locate, matchingInstrument, formatPrice} from './market.js';
import {clockStamp,tradingDay} from './market-session.mjs';
import {marketDay} from './calendar.mjs';
export const PRIMARY_QUOTES=['QQQ','SPY','NQ','ES','VIX','US10Y','US2Y'];
export const quoteKey=entry=>['QQQ','SPY'].includes(entry.symbol)&&['FUND','STOCKS','DEPOSITARY RECEIPT'].includes(entry.group)&&['NASDAQ','NYSE','AMEX','CBOE','NYSEARCA','NYSEAMERICAN','BATS'].includes(entry.exchange)?entry.symbol:entry.id;
export const quotePrice=q=>q&&Number.isFinite(q.price)?`${q.kind==='yield'?q.price.toFixed(3):formatPrice(q.price)}${['yield','treasury'].includes(q.kind)?'%':''}`:'—';
export const quoteChange=q=>!Number.isFinite(q?.change)?'—':`${q.change>=0?'+':''}${['yield','treasury'].includes(q.kind)?`${(q.change*100).toFixed(1)} bp`:q.kind==='index'?q.change.toFixed(2):`${q.changePercent.toFixed(2)}%`}`;
export const quoteTone=q=>!Number.isFinite(q?.change)?'muted':q.change>0?'green':q.change<0?'red':'muted';
export function quoteStamp(q){return q?.observedAt?`${clockStamp(q.observedAt)} · Skopje${q.priceSource==='chart-close'?' · bar time':''}`:q?.sessionDate?`${q.sessionDate} · daily`:'Awaiting quote';}
export function quoteDelay(q){return q?.kind==='treasury'?'Daily par yield':q?.delayMinutes?`${q.delayMinutes} min delayed`:q?.kind==='index'?'Delayed · timing varies':`${q?.session||'Regular session'}${q?.priceSource==='chart-close'?' · chart price':''} · delay varies`;}
export const isExtendedQuote=q=>['pre','post'].includes(q?.sessionType);
export function awaitingSessionQuote(sourceDate,quote,now=Date.now()){
  return sourceDate===marketDay(now)&&tradingDay(sourceDate).kind==='session'&&!!quote?.sessionDate&&quote.sessionDate<sourceDate;
}
export function entryState(entry,sheet,result,now=Date.now()){
  const q=result?.quote,instrument=matchingInstrument(entry,sheet);
  if(!q)return {label:result?.status==='loading'?'Loading':'Unavailable',reason:result?.message||'Waiting for the source.',tone:'muted',location:null};
  if(result.status==='stale')return {label:'Cached / old quote',reason:result.message||'Refresh pending. Comparisons paused.',tone:'amber',location:null};
  if(entry.group==='FUTURES')return {label:'Context',reason:`${q.name}. Contract basis may differ from your continuous levels.`,tone:'muted',location:null};
  if(!instrument)return {label:'No levels',reason:'Import levels to map this quote.',tone:'muted',location:null};
  const sourceDate=instrument.sourceDate||sheet.date;
  if(sourceDate!==q.sessionDate)return awaitingSessionQuote(sourceDate,q,now)?{label:'Today’s levels ready',reason:`Waiting for today's price. Last quote: ${q.sessionDate}.`,tone:'amber',location:null}:{label:'Dated levels',reason:`${instrument.carriedForward?'Carried forward · ':''}Levels ${sourceDate}; quote session ${q.sessionDate}.`,tone:'amber',location:null};
  if(isExtendedQuote(q)){
    const location=locate(q.price,instrument);
    return {label:location.label,reason:`${q.session} context · ${q.sessionType==='pre'?'imported levels; strategy confirmation starts at the regular open.':'regular-session strategy is not updated by this price.'}`,tone:'muted',location};
  }
  if(instrument.roleStatus&&instrument.roleStatus!=='ok')return {label:'Checking level roles',reason:'Waiting for current closed-candle confirmation.',tone:'amber',location:null};
  const location=locate(q.price,instrument);
  return {label:location.label,reason:location.zone?'Watch the reaction at this zone.':'Wait for price to reach a listed zone.',tone:location.zone?.type==='S'?'red':location.zone?.type==='D'?'green':'muted',location};
}
