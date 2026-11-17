import {useEffect,useRef} from 'react';
import {ArrowLeft,WarningCircle} from '@phosphor-icons/react';
import './portfolio-trade.css';
import {PageHeader} from './PageHeader';
import {PortfolioTrading} from './PortfolioTrading';
import {PortfolioPrivacyControls,usePortfolioPrivacy} from './PortfolioPrivacy';

export function portfolioTradeRoute(accountId,holding,side='BUY'){
  const query=new URLSearchParams({side});
  if(holding?.ticker)query.set('ticker',holding.ticker);
  return `portfolio/trade/${encodeURIComponent(accountId)}?${query}`;
}

function readRoute(route){
  const [path,search='']=route.split('?'),parts=path.split('/'),query=new URLSearchParams(search);
  try{
    const accountId=parts.length===3?decodeURIComponent(parts[2]):null;
    const side=query.get('side')||'BUY',ticker=query.get('ticker');
    return ['BUY','SELL'].includes(side)?{accountId,side,holding:ticker?{ticker}:undefined}:{};
  }catch{return {};}
}

export function PortfolioTradePage({route,state,error,onReload,onBack,onAccountChange,sheet,watchlist}){
  const privacy=usePortfolioPrivacy(),ref=useRef(null),selection=readRoute(route);
  const account=state?.data.accounts.find(item=>item.id===selection.accountId);
  const owner=state?.data.people.find(item=>item.id===account?.personId);
  useEffect(()=>{const heading=ref.current.querySelector('h1');heading.tabIndex=-1;heading.focus({preventScroll:true});},[route]);
  return <section ref={ref} className="pm-page pm-trade-page" aria-labelledby="pm-trade-title">
    <button className="text-button pm-trade-back" onClick={()=>onBack(account)}><ArrowLeft size={15}/>Back to portfolio</button>
    <PageHeader id="pm-trade-title" title="Trade / orders" actions={account&&!privacy.privateMode&&
      <div className={`pm-trading-account ${account.environment==='live'?'pm-live':''}`}>
        <select aria-label="Trading account" value={account.id} onChange={event=>{
          const next=state.data.accounts.find(item=>item.id===event.target.value);
          if(next)onAccountChange(next);
        }}>{state.data.accounts.filter(item=>item.id===account.id||item.connected&&item.platform==='Trading 212').map(item=>
          <option key={item.id} value={item.id}>{state.data.people.find(person=>person.id===item.personId)?.name||'Unknown person'} · {item.platform} · {item.label}{item.environment?` · ${item.environment.toUpperCase()}`:''}</option>
        )}</select>
        {account.connected&&<strong>{account.environment==='demo'?'DEMO · Practice money':'LIVE · Real money'}</strong>}
      </div>}/>
    {privacy.privateMode?<><PortfolioPrivacyControls/><div className="panel pm-empty" role="status">Show names and balances to trade.</div></>:<>
      {error&&<div className="pm-alert" role="alert"><WarningCircle size={19}/><span>{error}</span><button className="text-button" onClick={onReload}>Reload latest</button></div>}
      {!state?<div className="panel pm-empty" role="status">Loading account…</div>:!account?<div className="panel pm-empty" role="status"><h2>Account unavailable</h2><p>This account link is no longer available. Return to Portfolio Manager to select an account.</p></div>:!account.connected?<div className="panel pm-empty" role="status"><h2>Account disconnected</h2><p>Reconnect this account in Portfolio Manager to trade or check broker orders.</p></div>:<div className="panel pm-trade-panel">
        <PortfolioTrading key={route} account={account} owner={owner?.name||'Unknown person'} initialHolding={selection.holding} initialSide={selection.side} sheet={sheet} watchlist={watchlist} onPortfolioChange={onReload}/>
      </div>}
    </>}
  </section>;
}
