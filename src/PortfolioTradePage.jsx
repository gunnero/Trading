import {useEffect,useRef} from 'react';
import {ArrowLeft,WarningCircle} from '@phosphor-icons/react';
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

export function PortfolioTradePage({route,state,error,onReload,onBack,sheet,watchlist}){
  const privacy=usePortfolioPrivacy(),ref=useRef(null),selection=readRoute(route);
  const account=state?.data.accounts.find(item=>item.id===selection.accountId);
  const owner=state?.data.people.find(item=>item.id===account?.personId);
  useEffect(()=>{const heading=ref.current.querySelector('h1');heading.tabIndex=-1;heading.focus({preventScroll:true});},[route]);
  return <section ref={ref} className="pm-page pm-trade-page" aria-labelledby="pm-trade-title">
    <PageHeader id="pm-trade-title" title="Trade / orders" description="Review trades and follow orders for this account." actions={<button className="button outline" onClick={()=>onBack(account)}><ArrowLeft size={17}/>Back to portfolio</button>}/>
    {privacy.privateMode?<><PortfolioPrivacyControls/><div className="panel pm-empty" role="status">Show names and balances to trade.</div></>:<>
      {error&&<div className="pm-alert" role="alert"><WarningCircle size={19}/><span>{error}</span><button className="text-button" onClick={onReload}>Reload latest</button></div>}
      {!state?<div className="panel pm-empty" role="status">Loading account…</div>:!account?<div className="panel pm-empty" role="status"><h2>Account unavailable</h2><p>This account link is no longer available. Return to Portfolio Manager to select an account.</p></div>:!account.connected?<div className="panel pm-empty" role="status"><h2>Account disconnected</h2><p>Reconnect this account in Portfolio Manager to trade or check broker orders.</p></div>:<div className="panel pm-trade-panel">
        <PortfolioTrading key={route} account={account} owner={owner?.name||'Unknown person'} initialHolding={selection.holding} initialSide={selection.side} sheet={sheet} watchlist={watchlist} onPortfolioChange={onReload}/>
      </div>}
    </>}
  </section>;
}
