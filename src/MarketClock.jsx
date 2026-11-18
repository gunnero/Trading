import {useDisplayTime} from './DisplayTime';
import {useEffect,useMemo,useState} from 'react';
import {Bell,ArrowUpRight,Circle,Clock,Info} from '@phosphor-icons/react';
import {marketSession,until,MARKET_CALENDAR} from './data/market-session.mjs';

import {createDisplayTime} from './data/display-time.mjs';

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
    <span className="market-clock-heading"><Bell size={29} weight="light"/><span><small>U.S. STOCK MARKET</small><strong className="market-clock-state">{!compact&&<Circle className="market-status-dot" size={8} weight="fill" aria-hidden="true"/>}{clock.label}</strong><span className="market-clock-detail">{clock.detail}</span></span></span>
    <span className="market-clock-local"><span className="market-clock-date">{clockDate(clock.now)}</span><span><time dateTime={new Date(clock.now).toISOString()} className="market-clock-time">{clockTime(clock.now)}</time><small>{zoneLabel}{compact?` · ${formatLabel}`:''}</small></span></span>
  </button>;
}
export function MarketHours() {
  const {clockTime,clockDate,zoneLabel,clockStamp,clockRange,displayDay,settings}=useDisplayTime();
  const ny=useMemo(()=>createDisplayTime({timeZone:'America/New_York',hourCycle:settings.hourCycle}),[settings.hourCycle]);
  const clock=useMarketClock(),schedule=clock.schedule;
  const currentDay=schedule?.day===clock.today.day;
  const rows=schedule?[
    [schedule.early?'Regular market · early close':'Regular market',schedule.open,schedule.close,'open'],
    ['Pre-market',schedule.pre,schedule.open,'pre'],
    ['After-hours',schedule.close,schedule.post,'after'],
    ['SPY / QQQ options',schedule.open,schedule.optionsClose,'options'],
  ]:[];
  return <div className="market-hours">
    <div className={`hours-status session-${clock.state}`}>
      <div><strong><i className="session-dot"/>{clock.label}</strong><span>{clock.detail}</span></div>
      <span>{clockStamp(clock.now)} · {zoneLabel}</span>
    </div>
    {clock.transition&&<p className="hours-transition">{clock.transition.label} <strong>{clockStamp(clock.transition.at)}</strong> · in {until(clock.transition.at,clock.now)}</p>}
    {schedule?<table className="market-hours-sessions">
      <caption>{currentDay?'Current trading day':'Next trading day'} · {clockDate(schedule.open)}</caption>
      <thead><tr><th scope="col">Session</th><th scope="col">Hours · {zoneLabel}</th><th scope="col">Local date</th></tr></thead>
      <tbody>{rows.map(([label,start,end,state])=><tr key={state} className={state==='options'?'market-hours-options':currentDay&&state===clock.state?'is-current':undefined}>
        <th scope="row">{label}{state==='options'&&<small>Regular reference</small>}</th>
        <td>{clockRange(start,end)}</td><td>{displayDay(start)!==displayDay(end)?`${clockDate(start)} → ${clockDate(end)}`:clockDate(start)}</td>
      </tr>)}</tbody>
    </table>:<p className="market-hours-unavailable">The published calendar needs an update before the next session can be shown.</p>}
    <div className="hours-attribution">
      <Info size={16} aria-hidden="true"/><div><strong>Trading access depends on your venue and broker.</strong>
        <p>The clock uses device time and published schedules. Unscheduled closures and halts are unmonitored.</p>
        <div className="hours-links"><a href={MARKET_CALENDAR.source} target="_blank" rel="noreferrer">NYSE calendar &amp; hours<ArrowUpRight size={12}/></a>
          <a href={MARKET_CALENDAR.optionsSource} target="_blank" rel="noreferrer">Nasdaq options hours<ArrowUpRight size={12}/></a>
          <a href={MARKET_CALENDAR.extendedOptionsSource} target="_blank" rel="noreferrer">Cboe extended sessions<ArrowUpRight size={12}/></a></div>
        <small>NYSE Arca extended hours · Calendar coverage {MARKET_CALENDAR.from.slice(0,4)}–{MARKET_CALENDAR.through.slice(0,4)}</small>
      </div>
    </div>
    {schedule&&<section className="hours-conversion">
      <h3><Clock size={16} aria-hidden="true"/>Time conversion for {ny.clockDate(schedule.open)}</h3>
      <dl><div><dt>Regular · New York (ET)</dt><dd>{ny.clockRange(schedule.open,schedule.close)}</dd></div>
      {settings.timeZone!=='America/New_York'&&<div><dt>Regular · {settings.timeZone}</dt><dd>{clockRange(schedule.open,schedule.close)}</dd></div>}
      <div><dt>Pre-market opens</dt><dd>{ny.clockTime(schedule.pre)} ET{settings.timeZone!=='America/New_York'&&` → ${clockTime(schedule.pre)} ${zoneLabel}`}</dd></div></dl>
    </section>}
  </div>;
}
