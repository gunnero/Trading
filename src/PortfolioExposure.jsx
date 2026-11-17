import {useId,useMemo,useState} from 'react';
import {ArrowsClockwise,CaretDown,CaretRight,CaretUp,Info,LockKey,LockKeyOpen} from '@phosphor-icons/react';
import {portfolioExposure} from './data/portfolio-insights.mjs';
import {PortfolioPrivacyControls,usePortfolioPrivacy} from './PortfolioPrivacy';
import {portfolioPercent,usePortfolioResource} from './PortfolioTools';
import {useDisplayTime} from './DisplayTime';
import './portfolio-exposure.css';

const weightFormat=new Intl.NumberFormat('en-US',{maximumFractionDigits:2});
const leadingRows=4;

function ExposureRow({symbol,name,value,currency,weight,accountCount,nested=false,children}){
  const [expanded,setExpanded]=useState(false),id=useId();
  const {money}=usePortfolioPrivacy();
  const LeadingCaret=expanded?CaretDown:CaretRight,TrailingCaret=expanded?CaretUp:CaretRight;
  const toggle=()=>setExpanded(open=>!open);
  return <>
    <tr className={'pe-row'+(expanded?' is-expanded':'')+(nested?' is-nested':'')} onClick={toggle}>
      <th scope="row">
        <button type="button" aria-expanded={expanded} aria-controls={expanded?id:undefined} className="pe-company">
          <LeadingCaret size={15} aria-hidden="true"/><span><strong>{symbol}</strong><span>{name}</span></span>
        </button>
      </th>
      <td><div className="pe-weight"><b>{Number.isFinite(weight)?weightFormat.format(weight)+'%':'—'}</b>
        <span className="pe-track" aria-hidden="true"><i style={{width:Math.max(0,Math.min(100,weight||0))+'%'}}/></span></div></td>
      <td className="pe-value">{money(value,currency)}</td>
      <td><div className="pe-count" data-unit={accountCount===1?'account':'accounts'}>{accountCount}<TrailingCaret size={14} aria-hidden="true"/></div></td>
    </tr>
    {expanded&&<tr id={id}><td colSpan={4} className="pe-expanded">{children}</td></tr>}
  </>;
}

function SecurityRow({row,currency,nested}){
  const privacy=usePortfolioPrivacy(),{clockStamp,zoneLabel}=useDisplayTime();
  return <ExposureRow symbol={row.symbol} name={row.name} value={row.value} weight={row.weight}
    accountCount={row.accountCount} currency={currency} nested={nested}>
    <div className="pe-ownership">
      <table aria-label={row.symbol+' account breakdown'}><thead><tr>
        <th scope="col">Account</th><th scope="col">Holdings</th><th scope="col">Value</th><th scope="col">Last snapshot</th>
      </tr></thead><tbody>{row.accounts.map((account,index)=><tr key={account.id+':'+index}>
        <th scope="row">{privacy.person(account.person)} · {privacy.label(account.label,account.id)}</th>
        <td data-label="Holdings">{privacy.number(account.quantity)} shares<small>{portfolioPercent(account.weight).replace('+','')} of this account</small></td>
        <td data-label="Value">{privacy.money(account.value,currency)}</td>
        <td data-label="Last snapshot">{account.observedAt?clockStamp(account.observedAt)+' '+zoneLabel:'Date unavailable'}
          <small>{account.source==='api'?(account.connected?'Broker snapshot':'Disconnected snapshot'):'Manual snapshot'}{account.error?' · refresh failed':''}</small>
        </td>
      </tr>)}</tbody></table>
      <p>{row.identity} · Share price currency {row.instrumentCurrency||'unavailable'}</p>
    </div>
  </ExposureRow>;
}

function CurrencyHoldings({bucket,shared}){
  const {money}=usePortfolioPrivacy();
  const rows=shared?bucket.rows.filter(row=>row.shared):bucket.rows;
  const groupTail=rows.length>leadingRows+1;
  const leading=groupTail?rows.slice(0,leadingRows):rows,other=groupTail?rows.slice(leadingRows):[];
  const otherValue=other.reduce((total,row)=>total+row.value,0);
  const otherAccounts=new Set(other.flatMap(row=>row.accounts.map(account=>account.id)));
  return <section className="pe-currency" aria-label={bucket.currency+' holdings'}>
    <header><h3>{bucket.currency} holdings</h3><span>{shared?'All holdings':'Total'} <strong>{money(bucket.total,bucket.currency)}</strong></span></header>
    {bucket.missing>0&&<p className="pe-feedback">{bucket.missing} {bucket.missing===1?'holding has':'holdings have'} no value and {bucket.missing===1?'is':'are'} excluded from weights.</p>}
    {rows.length?<div className="pe-table-scroll" role="region" aria-label={bucket.currency+' exposure table'} tabIndex={0}>
      <table className="pe-table" aria-label={bucket.currency+' stock exposure'}><colgroup><col/><col/><col/><col/></colgroup>
        <thead><tr>{['Company','Holdings weight','Value','Accounts'].map(title=><th key={title} scope="col">{title}</th>)}</tr></thead>
        <tbody>{leading.map(row=><SecurityRow key={row.key} row={row} currency={bucket.currency}/>)}
          {groupTail&&<ExposureRow symbol="Other" name={other.length+' other stocks'} value={otherValue} currency={bucket.currency}
            weight={bucket.total>0?100*otherValue/bucket.total:null} accountCount={otherAccounts.size}>
            <table className="pe-table pe-other-table" aria-label={'Other '+bucket.currency+' holdings'}>
              <colgroup><col/><col/><col/><col/></colgroup>
              <thead><tr>{['Company','Holdings weight','Value','Accounts'].map(title=><th key={title} scope="col">{title}</th>)}</tr></thead>
              <tbody>{other.map(row=><SecurityRow key={row.key} row={row} currency={bucket.currency} nested/>)}</tbody>
            </table>
          </ExposureRow>}
        </tbody>
      </table>
    </div>:<p className="pe-feedback">{shared?'No stocks shared by multiple accounts in this currency.':'No known holding values in this currency.'}</p>}
  </section>;
}

export default function PortfolioExposure({watchlist,onJournal,onPortfolios}){
  const privacy=usePortfolioPrivacy(),{clockStamp,zoneLabel}=useDisplayTime();
  const {data,error,busy,refresh}=usePortfolioResource('');
  const [shared,setShared]=useState(false),[privacyOpen,setPrivacyOpen]=useState(false),privacyId=useId();
  const result=useMemo(()=>data?portfolioExposure(data.data,watchlist):null,[data,watchlist]);
  const PrivacyIcon=privacy.privateMode?LockKey:LockKeyOpen;
  return <section className="pe-view" aria-label="Combined portfolio exposure">
    <header className="pe-heading"><div><h2>Combined stock exposure</h2><p>Known holding values across accounts · Cash excluded</p></div>
      <div className="pe-actions">
        <button type="button" className="button outline pe-lock" aria-label="Portfolio privacy settings" title="Portfolio privacy settings"
          aria-expanded={privacyOpen} aria-controls={privacyId} data-private={privacy.privateMode} onClick={()=>setPrivacyOpen(open=>!open)}><PrivacyIcon size={17}/></button>
        <button type="button" className="button primary" onClick={refresh} disabled={busy}><ArrowsClockwise size={17}/>{busy?'Refreshing…':'Refresh exposure'}</button>
      </div>
    </header>
    <div id={privacyId} hidden={!privacyOpen}>{privacyOpen&&<PortfolioPrivacyControls/>}</div>
    <label className="pe-filter"><input type="checkbox" checked={shared} onChange={event=>setShared(event.target.checked)}/>Only stocks shared by multiple accounts</label>
    {error&&<p role="alert" className="amber">{error}</p>}
    {!result&&!error&&<p role="status">Loading exposure…</p>}
    {result&&<>
      {!result.buckets.length&&<p className="pe-feedback">No holding values are available yet.</p>}
      {result.buckets.map(bucket=><CurrencyHoldings key={bucket.currency} bucket={bucket} shared={shared}/>)}
      <footer className="pe-foot"><div><Info size={16} aria-hidden="true"/><span>{result.missingAccounts} {result.missingAccounts===1?'account':'accounts'} without a snapshot · {result.demoAccounts} demo {result.demoAccounts===1?'account':'accounts'} excluded · Account currencies kept separate</span></div>
        <div>Account snapshots{result.latestSnapshotAt!==null&&' · Latest '+clockStamp(result.latestSnapshotAt)+' '+zoneLabel}</div>
      </footer>
    </>}
    <div className="pe-links"><button type="button" className="text-button" onClick={onJournal}>Broker trade journal</button>{onPortfolios&&<button type="button" className="text-button" onClick={onPortfolios}>Portfolios</button>}</div>
  </section>;
}
