import {useId,useState} from 'react';
import {ArrowsClockwise,CaretLeft,CaretRight,ChartBar,Coins,Info,LockKey} from '@phosphor-icons/react';
import {PageHeader} from './PageHeader';
import {PortfolioPrivacyControls,usePortfolioPrivacy} from './PortfolioPrivacy';
import {useDisplayTime} from './DisplayTime';
import {usePortfolioResource} from './PortfolioTools';
import {activityRequest} from './PortfolioNotifications';
import {marketDay} from './data/calendar.mjs';
import {calendarRows,calendarWindow,daysUntil,holdingDateLabel,holdingMonthLabel,shiftHoldingMonth} from './data/holdings-calendar.mjs';
import './portfolio-holdings-calendar.css';

// The API limits each request to eight holdings. Keep the account-wide order
// as pages arrive, and discard a partial result if membership changes mid-read.
async function readCalendar(path,signal,publish){
  const first=await activityRequest(path+'&offset=0',undefined,signal);
  let result=first;
  while(result.more){
    const offset=result.items.length;
    if(!offset||offset>=first.total)throw Error('Calendar coverage is incomplete. Refresh to try again.');
    publish(result);
    const next=await activityRequest(path+'&offset='+offset,undefined,signal);
    if(next.accountId!==first.accountId||next.holdingsKey!==first.holdingsKey||next.total!==first.total){
      publish(null);
      throw Error('The holdings changed while dates were loading. Refresh to check the current holdings.');
    }
    if(next.offset!==offset||!next.items.length)throw Error('Calendar coverage is incomplete. Refresh to try again.');
    result={...next,items:[...result.items,...next.items]};
  }
  if(result.items.length!==first.total)throw Error('Calendar coverage is incomplete. Refresh to try again.');
  return result;
}

function Holding({holding}){
  const ticker=holding.listing?.split(':').at(-1)||holding.ticker.replace(/_US_EQ$/,'');
  return <><strong>{ticker}</strong><small>{holding.name}</small></>;
}
function EventLabel({family}){
  const Icon=family==='Earnings'?ChartBar:Coins;
  return <span className="hc-event"><Icon size={21} aria-hidden="true"/><b>{family}</b></span>;
}
function Source({holding}){
  const {clockStamp,zoneLabel}=useDisplayTime();
  if(!holding.listing)return <small>No verified market listing.</small>;
  if(holding.status==='unavailable')return <small>Yahoo Finance · unavailable</small>;
  return <small title={holding.fetchedAt?'Fetched '+clockStamp(holding.fetchedAt)+' '+zoneLabel:undefined}>Yahoo company snapshot{holding.status==='stale'&&<em>Cached · refresh unavailable</em>}</small>;
}
function MonthCalendar({today,month,day,events,onMonth,onDay}){
  const [expanded,setExpanded]=useState(false),gridId=useId();
  const first=new Date(month+'-01T12:00:00Z');
  const count=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
  const eventCounts=new Map();
  for(const {event} of events)eventCounts.set(event.date,(eventCounts.get(event.date)||0)+1);
  return <aside className={'hc-card hc-month'+(expanded?' hc-open':'')} aria-label="Browse holdings calendar">
    <button className="hc-browse" aria-expanded={expanded} aria-controls={gridId} onClick={()=>setExpanded(!expanded)}>Browse dates <strong>{holdingMonthLabel(month)}</strong></button>
    <div id={gridId} className="hc-month-body">
    <header><button className="icon-button" aria-label="Previous month" disabled={month<=today.slice(0,7)} onClick={()=>onMonth(shiftHoldingMonth(month,-1))}><CaretLeft size={17}/></button>
      <h3>{holdingMonthLabel(month)}</h3><button className="icon-button" aria-label="Next month" onClick={()=>onMonth(shiftHoldingMonth(month,1))}><CaretRight size={17}/></button></header>
    <div className="hc-days">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=><span key={d}>{d}</span>)}
      {Array.from({length:first.getUTCDay()},(_,i)=><i key={'blank'+i}/>)}
      {Array.from({length:count},(_,i)=>{
        const date=month+'-'+String(i+1).padStart(2,'0'),n=eventCounts.get(date)||0;
        return <button type="button" key={date} className={n?'hc-marked':undefined} aria-current={date===today?'date':undefined}
          aria-pressed={day===date} disabled={date<today} aria-label={holdingDateLabel(date)+(n?', '+n+' scheduled '+(n===1?'event':'events'):'')}
          onClick={()=>onDay(date)}>{i+1}</button>;
      })}
    </div></div></aside>;
}
function EventTable({rows,today,empty}){
  return <div className="hc-card hc-table"><table aria-label="Scheduled holdings events"><thead><tr>{['Date','Holding','Event','Status','Source'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead>
    <tbody>{rows.map(({holding,event})=>{
      const n=daysUntil(event.date,today),earnings=event.type==='Earnings',estimated=event.estimated===true;
      const status=estimated?'Estimated':earnings&&event.estimated===false?'Confirmed':'Published';
      return <tr key={[holding.ticker,event.type,event.date].join(':')}><td><time dateTime={event.date}>{holdingDateLabel(event.date)}</time><small>{n===0?'Today':n===1?'In 1 day':'In '+n+' days'}</small></td>
        <th scope="row"><Holding holding={holding}/></th><td><EventLabel family={earnings?'Earnings':'Dividend'}/><small className="hc-kind">{earnings?(estimated?'Estimated earnings':'Earnings date'):event.type==='Ex-dividend'?'Ex-dividend date':'Payment date'}</small></td>
        <td><span className={'hc-status '+(estimated?'hc-estimate':'hc-published')}>{status}</span></td><td><Source holding={holding}/></td></tr>;
    })}</tbody></table>{!rows.length&&<p className="hc-empty">{empty}</p>}</div>;
}
function UnavailableDates({rows,loading}){
  return <section className="hc-unavailable"><h2>Dates unavailable</h2>
    <p>Upcoming dates the source hasn’t supplied for these holdings.</p>
    <div className="hc-card hc-table"><table aria-label="Unavailable holdings dates"><thead><tr>{['Holding','Event','Status','Source'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead>
      <tbody>{rows.map(({holding,missing})=><tr key={holding.ticker}><th scope="row"><Holding holding={holding}/></th>
        <td><div className="hc-families">{missing.map(family=><EventLabel key={family} family={family}/>)}</div></td><td><span className="hc-status hc-unknown">{holding.status==='unavailable'?'Unavailable':'No date'}</span></td><td><Source holding={holding}/></td></tr>)}</tbody></table>
      {!rows.length&&<p className="hc-empty">{loading?'Checking holdings…':'No missing earnings or dividend dates among the holdings checked.'}</p>}</div></section>;
}

function AccountSchedule({data,calendar}){
  const {clockStamp,zoneLabel}=useDisplayTime();
  const [month,setMonth]=useState(null),[day,setDay]=useState(null);
  const today=marketDay(Date.now()),shownMonth=month||today.slice(0,7);
  const {events,unavailable}=calendarRows(data?.items||[],today),range=calendarWindow(today,month,day);
  const rows=events.filter(({event})=>event.date>=range.from&&event.date<=range.to);
  const later=events.find(({event})=>event.date>range.to);
  const stamps=(data?.items||[]).map(h=>h.fetchedAt).filter(Boolean).sort();
  const from=stamps.length?clockStamp(stamps[0]):null,to=stamps.length?clockStamp(stamps.at(-1)):null;
  const chooseMonth=value=>{setMonth(value);setDay(null);};
  return <><div className="hc-columns"><section className="hc-schedule"><header><h2>{range.title}</h2>{(day||month)&&<button className="text-button" onClick={()=>chooseMonth(null)}>Next 30 days</button>}</header>
        <p>Key earnings and dividend dates for your holdings, in chronological order.</p>
        {data?<><EventTable rows={rows} today={today} empty={data.more?'Checking holdings for scheduled events…':!data.total?'No holdings in this account.':'No published events in this period.'}/>
          {data.more&&<p className="hc-progress" role="status">{data.items.length} of {data.total} holdings checked{calendar.busy?'…':'.'}</p>}
          {later&&<button className="text-button hc-later" onClick={()=>chooseMonth(later.event.date.slice(0,7))}>Next event after this period · {holdingDateLabel(later.event.date)} <CaretRight size={13}/></button>}</>
          :!calendar.error&&<p role="status">Loading company dates…</p>}</section>
        <MonthCalendar today={today} month={shownMonth} day={day} events={events} onMonth={chooseMonth} onDay={d=>{setMonth(d.slice(0,7));setDay(d===day?null:d);}}/></div>
        {data?.items.length>0&&<UnavailableDates rows={unavailable} loading={data.more}/>}
        {data&&<footer className="hc-footer"><Info size={16} aria-hidden="true"/><span>{from?'Snapshots fetched · '+from+(from!==to?' – '+to:'')+' '+zoneLabel:'Snapshot time unavailable'}</span><span>Source · Yahoo Finance company snapshots</span></footer>}</>;
}

export default function PortfolioHoldingsCalendar({accounts,account,selectAccount,view,navigation,onJournal}){
  const privacy=usePortfolioPrivacy(),privacyId=useId();
  const calendar=usePortfolioResource(account?'insights/calendar?'+new URLSearchParams({account:account.id}):null,1800000,readCalendar);
  const [showPrivacy,setShowPrivacy]=useState(false),{data}=calendar;
  const busy=calendar.busy||view.busy;
  const actions=<><label className="hc-account">Account<select aria-label="Planning account" disabled={!accounts.length} value={account?.id||''} onChange={e=>selectAccount(e.target.value)}>
    {!accounts.length&&<option value="">Choose an account</option>}{accounts.map(a=><option key={a.id} value={a.id}>{[privacy.person(a.person),privacy.label(a.label,a.id),a.environment==='demo'?'DEMO':null].filter(Boolean).join(' · ')}</option>)}</select></label>
    <button type="button" className="button primary hc-refresh" disabled={busy} onClick={()=>{calendar.refresh();view.refresh();}}><ArrowsClockwise size={17} aria-hidden="true"/>{busy?'Refreshing…':'Refresh'}</button></>;
  return <section className="planning-view hc-view" aria-label="Portfolio planning">
    <PageHeader title="Holdings calendar" description="Earnings and dividends for stocks you own." actions={actions}/>{navigation}
    {(view.error||calendar.error)&&<p className="hc-message amber" role="alert">{calendar.error||view.error}{data&&!data.more?' · Showing the previous calendar.':''}</p>}
    {!account?<p role="status">{view.error?'Account data unavailable.':view.data?'Add an account in Portfolio Manager to see its holdings calendar.':'Loading accounts…'}</p>
      :<AccountSchedule key={account.id} data={data} calendar={calendar}/>}
    <div className="hc-tools"><button className="text-button" aria-expanded={showPrivacy} aria-controls={privacyId} onClick={()=>setShowPrivacy(!showPrivacy)}><LockKey size={15}/>Privacy settings</button>
      <button className="text-button" onClick={onJournal}>Broker trade journal</button></div>
    <div id={privacyId} hidden={!showPrivacy}>{showPrivacy&&<PortfolioPrivacyControls/>}</div>
  </section>;
}
