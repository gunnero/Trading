import {addDays,marketDay} from './calendar.mjs';
import {tradingDay} from './market-session.mjs';

export const sentimentScore=value=>Number.isFinite(value)?value.toFixed(2):'—';
export function sentimentDisplay(feed,now=Date.now()){
  if(!feed?.data)return {label:feed?.status==='loading'?'Connecting…':'Feed unavailable',warning:true,detail:null};
  if(feed.status==='stale')return {label:'Cached snapshot',warning:true,outdated:true,detail:feed.message||'The source has not supplied an updated reading yet.'};
  const observed=Date.parse(feed.data.observedAt),day=tradingDay(marketDay(now));
  const marketOpen=day.kind==='session'&&now>=Date.parse(day.open)&&now<Date.parse(day.close);
  // A failed session update must not become current again at the closing bell,
  // over the weekend, or during the next pre-market. Stop aging at the last
  // session close, so a valid Friday closing snapshot remains useful on Monday.
  let session;
  for(let i=0;i<12;i++){
    const candidate=tradingDay(addDays(day.day,-i));
    if(candidate.kind==='unknown')break;
    if(candidate.kind==='session'&&Date.parse(candidate.open)<=now){session=candidate;break;}
  }
  if(session&&observed<Date.parse(session.open))return {label:marketOpen?'Awaiting market update':'Session update unavailable',warning:true,outdated:true,detail:marketOpen?'The automatic source has not supplied a reading from the current regular session. CNN may show a newer score.':'The automatic source has not supplied a reading from the latest regular session. CNN may show a newer score.'};
  const delayMinutes=feed.source?.delivery==='api'?20:90;
  if(session&&Math.min(now,Date.parse(session.close))-observed>delayMinutes*60000)return {label:'Delayed snapshot',warning:true,outdated:true,detail:`This snapshot trails the latest trading session by over ${delayMinutes} minutes. CNN may show a newer score.`};
  if(feed.source?.delivery==='daily')return {label:'Daily backup',warning:true,detail:'The daily archive is the newest available source. It publishes after the U.S. session, not throughout the trading day.'};
  return {label:feed.source?.delivery==='api'?'API snapshot':feed.source?.delivery==='hourly'?'Hourly snapshot':'As of',warning:false,detail:null};
}
