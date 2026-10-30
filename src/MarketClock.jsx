import {useDisplayTime} from './DisplayTime';
import {useEffect,useMemo,useState} from 'react';
import {Bell,ArrowUpRight} from '@phosphor-icons/react';
import {marketSession,until,MARKET_CALENDAR} from './data/market-session.mjs';

function useMarketClock() {
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{
    const tick=()=>{if(!document.hidden)setNow(Date.now());},timer=setInterval(tick,1000);
    document.addEventListener('visibilitychange',tick);window.addEventListener('focus',tick);
    return ()=>{clearInterval(timer);document.removeEventListener('visibilitychange',tick);window.removeEventListener('focus',tick);};
  },[]);
  // Exchange boundaries are minute-aligned. Keep second ticks local to the clock.
  const minute=Math.floor(now/60000);
  const session=useMemo(()=>marketSession(minute*60000),[minute]);
  return {...session,now};
}
export function MarketClock({onOpen,compact=false}) {
  const {zoneLabel,clockDate,clockTime,formatLabel,clockStamp}=useDisplayTime();
  const clock=useMarketClock();
  return <button className={`market-clock ${compact?'market-clock-compact':'market-clock-sidebar'} session-${clock.state}`} onClick={onOpen} aria-label="Market status and session hours" aria-haspopup="dialog" title={`${clock.label} · ${clock.detail}. View session hours in ${zoneLabel}.`}>
    <span className="market-clock-heading"><Bell size={29} weight="light"/><span><small>U.S. STOCK MARKET</small><strong className="market-clock-state">{clock.label}</strong><span className="market-clock-detail">{clock.detail}</span></span></span>
    <span className="market-clock-local"><span className="market-clock-date">{clockDate(clock.now)}</span><span><time dateTime={new Date(clock.now).toISOString()} className="market-clock-time">{clockTime(clock.now,!compact)}</time><small>{zoneLabel} · {formatLabel}</small></span></span>
  </button>;
}
export function MarketHours() {
  const {clockTime,clockDate,zoneLabel,clockStamp,clockRange}=useDisplayTime();
  const clock=useMarketClock(),schedule=clock.schedule;
  const rows=schedule?[
    ['Pre-market',schedule.pre,schedule.open,'pre'],
    [schedule.early?'Regular · early close':'Regular session',schedule.open,schedule.close,'open'],
    ['After-hours',schedule.close,schedule.post,'after'],
  ]:[];
  return <div className="market-hours">
    <div className={`market-hours-now session-${clock.state}`}><span><i/><strong>{clock.label}</strong><small>{clock.detail}</small></span><span><time dateTime={new Date(clock.now).toISOString()}>{clockTime(clock.now,true)}</time><small>{clockDate(clock.now)} · {zoneLabel}</small></span></div>
    {clock.transition && <p className="market-hours-transition">{clock.transition.label} <strong>{clockStamp(clock.transition.at)}</strong> <span>in {until(clock.transition.at,clock.now)}</span></p>}
    {schedule ? <>
      <h3>{schedule.day===clock.today.day?'Current trading day':'Next trading day'} <span>{clockDate(schedule.open)}</span></h3>
      <p className="small-copy muted">All times are {zoneLabel}. After-hours may finish on the following local day.</p>
      <div className="market-hours-sessions">{rows.map(([label,start,end,state])=><div className={clock.state===state && schedule.day===clock.today.day?'is-current':''} key={state}><span><i className={`session-dot session-${state}`}/>{label}{clock.state===state && schedule.day===clock.today.day && <b>NOW</b>}</span><strong><time dateTime={start}>{clockRange(start,end)}</time></strong></div>)}</div>
      <div className="market-hours-options"><strong>SPY / QQQ options · regular hours</strong><span>{clockRange(schedule.open,schedule.optionsClose)} {zoneLabel}</span><p>Eligible exchanges trade these options later than the stock-market close. Morning access and order cutoffs depend on your venue and broker.</p><a href={MARKET_CALENDAR.optionsSource} target="_blank" rel="noopener noreferrer">Options hours<ArrowUpRight size={13}/></a><a href={MARKET_CALENDAR.extendedOptionsSource} target="_blank" rel="noopener noreferrer">Cboe extended sessions<ArrowUpRight size={13}/></a></div>
    </> : <p className="market-hours-unavailable">The published calendar needs an update before the next session can be shown.</p>}
    <p className="market-hours-source">Scheduled stock/ETF sessions, including published holidays and early closes. Extended hours follow NYSE Arca. Unscheduled closures and trading halts are not monitored.</p>
    <div className="market-hours-sources"><a href={MARKET_CALENDAR.source} target="_blank" rel="noopener noreferrer">NYSE calendar & hours<ArrowUpRight size={13}/></a><small>Calendar: 2026–2028 · checked 24 Oct 2026</small></div>
  </div>;
}
