import {useCallback,useEffect,useRef,useState} from 'react';
import {Users,Plus,ArrowLeft,ArrowsLeftRight,ArrowsClockwise,LinkSimple,UploadSimple,DownloadSimple,PencilSimple,X,Briefcase,ShieldCheck,MagnifyingGlass,WarningCircle,Eye,EyeSlash,CaretRight,CaretUp,CaretDown,CaretUpDown} from '@phosphor-icons/react';
import {PageHeader} from './PageHeader';
import {useDisplayTime} from './DisplayTime';
import {apiFetch} from './auth-client';
import {normalizePortfolioSnapshot,portfolioStatus,portfolioTotals,portfolioPerformance,portfolioReturnTotals} from './data/portfolio.mjs';
import {portfolioListing,portfolioListingChoices} from './data/portfolio-listings.mjs';
import {CompanyDetail} from './CompanyDetail';
import {PortfolioPosition} from './PortfolioPosition';
import {PortfolioHistory} from './PortfolioHistory';
import {PortfolioTradePage,portfolioTradeRoute} from './PortfolioTradePage';
import {usePortfolioHours,HoursButton,StockHours} from './PortfolioHours';
import {usePortfolioPrivacy,PortfolioPrivacyControls,PortfolioAccountPrivacy} from './PortfolioPrivacy';
import './portfolio.css';
import './portfolio-account.css';

const money=(value,currency='USD')=>value===null||value===undefined?'—':new Intl.NumberFormat('en-US',{style:'currency',currency,maximumFractionDigits:2}).format(value);
const quantity=value=>new Intl.NumberFormat('en-US',{maximumFractionDigits:8}).format(value);
const initials=name=>name.split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join('').toUpperCase();
const tone=value=>value>0?'green':value<0?'red':'';
const percent=value=>Number.isFinite(value)?`${value>0?'+':''}${value.toFixed(2)}%`:'—';
const accountRoute=id=>`portfolio/account/${encodeURIComponent(id)}`;
function accountId(route){
  const parts=route.split('?')[0].split('/');
  try{return parts.length===3?decodeURIComponent(parts[2]):null;}catch{return null;}
}
async function request(path='',body,method='POST'){
  const response=await apiFetch('/api/portfolio'+path,{method:body===undefined?'GET':method,...(body===undefined?{}:{headers:{'Content-Type':'application/json','X-Opening-Bell-Client':'web'},body:JSON.stringify(body)}),signal:AbortSignal.timeout(25000)});
  let result;try{result=await response.json();}catch{throw Error('Portfolio Manager is unavailable. Please retry.');}
  if(!response.ok)throw Object.assign(Error(result.message||'The portfolio request failed.'),{status:response.status});return result;
}
function download(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function Dialog({title,onClose,children,wide=false}){
  const ref=useRef();
  useEffect(()=>{const dialog=ref.current,trigger=document.activeElement,overflow=document.body.style.overflow;document.body.style.overflow='hidden';dialog.showModal();return()=>{dialog.close();document.body.style.overflow=overflow;if(trigger?.isConnected)trigger.focus();};},[]);
  return <dialog ref={ref} className={`modal ${wide?'wide company-modal':'pm-dialog'}`} aria-labelledby="pm-dialog-title" onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose();}}><div className="modal-inner"><header className="modal-header"><h2 id="pm-dialog-title">{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={22}/></button></header>{children}</div></dialog>;
}

export default function PortfolioManager({route='portfolio',onNavigate,sheet,watchlist,setupInterval,onActivity,onInsights}){
  const privacy=usePortfolioPrivacy();
  const isTradePage=route.split('/')[1]==='trade';
  const isAccountPage=route.split('/')[1]==='account';
  const filter=privacy.filter,selected=privacy.account;
  const [state,setState]=useState(null),[error,setError]=useState(''),[dialog,setDialog]=useState(null),[refreshing,setRefreshing]=useState(false),[search,setSearch]=useState('');
  const [holdingView,setHoldingView]=useState(null);
  const [reveal,setReveal]=useState(null),[valueVisibility,setValueVisibility]=useState(null);
  const accountHeading=useRef(null);
  const current=useRef(null),active=useRef(false),syncing=useRef(false),dialogRef=useRef(null);dialogRef.current=dialog||isTradePage;
  const {clockStamp,zoneLabel}=useDisplayTime();
  const accept=useCallback(result=>{if(active.current&&(!current.current||result.revision>=current.current.revision)){current.current=result;setState(result);}},[]);
  const load=useCallback(async()=>{try{accept(await request());if(active.current)setError('');}catch(e){if(active.current)setError(e.message);}},[accept]);
  const refresh=useCallback(async()=>{
    if(syncing.current||document.hidden||dialogRef.current)return;
    syncing.current=true;if(active.current)setRefreshing(true);
    try{
      const fresh=await request();accept(fresh);
      const queue=fresh.data.accounts.filter(a=>a.connected);
      const work=async()=>{while(queue.length&&active.current&&!document.hidden&&!dialogRef.current){const a=queue.shift();accept(await request(`/accounts/${a.id}/sync`,{}));}};
      await Promise.all([work(),work()]);if(active.current)setError('');
    }catch(e){if(active.current)setError(e.message);}
    finally{syncing.current=false;if(active.current)setRefreshing(false);}
  },[accept]);
  useEffect(()=>{active.current=true;if(isTradePage)load();else refresh();const timer=setInterval(refresh,60000),visible=()=>{if(!document.hidden)refresh();};document.addEventListener('visibilitychange',visible);return()=>{active.current=false;clearInterval(timer);document.removeEventListener('visibilitychange',visible);};},[refresh,load,isTradePage]);
  async function mutate(path,body,method){const result=await request(path,{...body,revision:current.current.revision},method);accept(result);return result;}
  const people=state?.data.people||[],allAccounts=state?.data.accounts||[];
  const accounts=allAccounts.filter(a=>filter==='all'||!people.some(p=>p.id===filter)||a.personId===filter);
  const selectedAccount=accounts.find(a=>a.id===selected)||accounts[0];
  const account=isAccountPage?allAccounts.find(a=>a.id===accountId(route)):selectedAccount;
  const accountStatus=account&&portfolioStatus(account);
  // Any new preference snapshot, including a change from another tab, ends this preview.
  const revealedAccount=privacy.privateMode&&reveal?.preferences===privacy.preferences&&reveal.route===route&&reveal.accountId===account?.id?account.id:null;
  const personName=(id,view=privacy)=>view.person(people.find(p=>p.id===id)?.name||'Unknown person');
  const balancesVisible=valueVisibility?.route===route&&valueVisibility.preferences===privacy.preferences?valueVisibility.visible:undefined;
  const selectedPrivacy=privacy.forView(!!revealedAccount,balancesVisible),{money}=privacy;
  const actionsHidden=privacy.privateMode||selectedPrivacy.hideBalances;
  const totals=portfolioTotals(accounts),unknown=accounts.filter(a=>!a.snapshot||a.snapshot.accountValue===null).length;
  const returns=portfolioReturnTotals(accounts);
  const viewedAccount=holdingView?.route===route?allAccounts.find(a=>a.id===holdingView.accountId):null;
  const viewedHolding=viewedAccount?.snapshot?.holdings.find(h=>h.ticker===holdingView.ticker);
  useEffect(()=>{
    if(!state||isAccountPage||isTradePage)return;
    const validFilter=filter==='all'||people.some(p=>p.id===filter)?filter:'all';
    if(validFilter!==filter||selected!==(account?.id||null))privacy.update({filter:validFilter,account:account?.id||null});
  },[state,filter,selected,account?.id,isAccountPage,isTradePage]);
  useEffect(()=>{if(actionsHidden)setDialog(null);},[actionsHidden]);
  useEffect(()=>{setDialog(null);setHoldingView(null);setSearch('');setReveal(value=>value?.route===route?value:null);setValueVisibility(null);},[route]);
  useEffect(()=>{if(isAccountPage)accountHeading.current?.focus({preventScroll:true});},[route,isAccountPage,account?.id]);
  const stamp=a=>a.snapshot?.source==='api'?(a.lastSuccess?`Last sync ${clockStamp(a.lastSuccess)}`:'Never synced'):a.snapshot?.observedAt?`Observed ${clockStamp(a.snapshot.observedAt)}`:a.snapshot?'Source date unknown':'Connect or import a snapshot';
  function selectAccount(a){
    if(!privacy.privateMode){openAccount(a);return;}
    const preferences=privacy.update({account:a.id});
    setReveal(revealedAccount!==a.id?{accountId:a.id,preferences,route}:null);
  }
  function openAccount(a){
    const destination=accountRoute(a.id),preferences=privacy.update({account:a.id});
    setReveal(revealedAccount===a.id?{accountId:a.id,preferences,route:destination}:null);
    onNavigate(destination);
  }
  function openTrade(a,holding,side){setHoldingView(null);onNavigate(portfolioTradeRoute(a.id,holding,side));}
  if(isTradePage)return <PortfolioTradePage route={route} state={state} error={error} onReload={load} onBack={a=>{if(a)privacy.update({account:a.id,filter:filter==='all'?'all':a.personId});onNavigate('portfolio');}} sheet={sheet} watchlist={watchlist}/>;
  return <div className={`pm-page${isAccountPage?' pm-account-page':''}`}>
    <PageHeader title="Portfolio Manager" description={isAccountPage?undefined:'People, accounts and holdings in one place.'} actions={isAccountPage?undefined:<>{onInsights&&<button className="button outline" onClick={onInsights}>Portfolio insights</button>}{onActivity&&<button className="button outline" onClick={onActivity}>Activity & alerts</button>}<button className="button outline" disabled={refreshing||!!dialog} onClick={refresh}><ArrowsClockwise size={17} className={refreshing?'pm-spinning':''}/>{refreshing?'Refreshing…':'Refresh'}</button><button className="button primary" disabled={privacy.privateMode} onClick={()=>setDialog({type:'person'})}><Plus size={17}/>Add person</button></>}/>
    {isAccountPage?<button className="text-button pm-account-back" onClick={()=>onNavigate('portfolio')}><ArrowLeft size={17}/>Back to accounts</button>:<PortfolioPrivacyControls accountPreviews={accounts.length>0}/>}
    {error&&<div className="pm-alert" role="alert"><WarningCircle size={19}/><span>{error}</span><button className="text-button" onClick={load}>Reload latest</button></div>}
    {!state?<div className="panel pm-empty" role="status">{isAccountPage?'Loading account…':'Loading your portfolios…'}</div>:!isAccountPage?<>
      <div className="pm-filter-row"><div className="pm-people" aria-label="Filter by person"><button aria-pressed={filter==='all'} onClick={()=>{privacy.update({filter:'all'});}}><Users size={17}/>Everyone <span>{people.length}</span></button>{people.map(p=><button key={p.id} aria-pressed={filter===p.id} onClick={()=>{privacy.update({filter:p.id,account:allAccounts.find(a=>a.id===selected&&a.personId===p.id)?.id||allAccounts.find(a=>a.personId===p.id)?.id||null});}}><i>{privacy.hideNames?<Users size={15}/>:initials(p.name)}</i>{personName(p.id)}</button>)}</div>{filter!=='all'&&<button className="icon-button" aria-label="Edit person" disabled={privacy.privateMode} onClick={()=>setDialog({type:'person',person:people.find(p=>p.id===filter)})}><PencilSimple size={18}/></button>}</div>
      <section className="pm-overview panel" aria-label="Portfolio overview"><div className="pm-overview-value"><span className="pm-eyebrow">Recorded account value</span>{totals.length?totals.map(total=><strong key={total.currency}>{total.known?money(total.value,total.currency):'—'} <small>{total.currency}</small></strong>):<strong>—</strong>}{returns.map(total=><div className="pm-overview-return" key={total.currency}><span>Open return · {total.currency}</span><b className={tone(total.open)}>{total.known?money(total.open,total.currency):'—'}{total.percent!==null?` (${percent(total.percent)})`:''}</b><small>{total.known} of {total.accounts} recorded accounts</small></div>)}<p>Whole accounts · currencies kept separate{unknown>0?` · ${unknown} account${unknown===1?'':'s'} without a value`:''}</p></div><div className="pm-count"><strong>{accounts.length}</strong><span>Platform accounts</span></div><div className="pm-count"><strong>{accounts.filter(a=>a.connected).length}</strong><span>Connected to a broker</span></div><div className="pm-overview-note"><ShieldCheck size={22}/><p>Account tracking<small>Refreshes each minute here; records snapshots every 15 minutes. Trading is enabled separately for each authorized account.</small></p></div></section>
      <p className="pm-caption">Totals use each account’s last available snapshot, which may have a different date. Missing accounts are excluded; demo accounts never enter totals.</p>
      <div className="pm-section-heading"><div><h2>{filter==='all'?'People & accounts':`${personName(filter)}’s accounts`}</h2><p>Open an account to see its holdings and connection.</p></div><button className="button outline" disabled={privacy.privateMode||!people.length} onClick={()=>setDialog({type:'account',personId:filter!=='all'?filter:people[0]?.id})}><Plus size={17}/>Add account</button></div>
      {!people.length?<div className="panel pm-empty"><Users size={36}/><h3>Start with a person</h3><p>Add a friend, then their Trading 212 or other platform account. Each account stays separate.</p><button className="button primary" disabled={privacy.privateMode} onClick={()=>setDialog({type:'person'})}>Add your first person</button></div>:!accounts.length?<div className="panel pm-empty"><Briefcase size={32}/><h3>No accounts yet</h3><p>Add a platform account to connect a broker or import a saved snapshot.</p></div>:<div className="pm-account-grid">{accounts.map(a=>{
        const revealed=revealedAccount===a.id,selected=account?.id===a.id;
        const view=privacy.forView(revealed),name=personName(a.personId,view);
        return <PortfolioAccountPrivacy key={a.id} revealed={revealed}><div className="pm-account-list-row">
          <button className={`pm-account-card panel ${selected?'selected':''}`} aria-current={selected?true:undefined}
            aria-pressed={privacy.privateMode?revealed:undefined} onClick={()=>selectAccount(a)}>
            <div className="pm-account-identity"><span className="pm-avatar">{view.hideNames?<Users size={22}/>:initials(name)}</span>
              <div><strong>{name}</strong><small>{a.platform} · {view.label(a.label,a.id)}{a.environment==='demo'?' · DEMO':''}</small></div>
            </div>
            <strong className="pm-card-value">{view.money(a.snapshot?.accountValue,a.snapshot?.currency)}</strong>
            <AccountReturn snapshot={a.snapshot}/>
            <span className={`pm-status ${a.connected&&!a.error&&a.snapshot?.source==='api'&&portfolioStatus(a).includes('Auto')?'green':'amber'}`}>{portfolioStatus(a)}</span>
            <small className="pm-account-time">{stamp(a)}</small>
            {privacy.privateMode&&<span className="sr-only">{revealed?'Hide private details':'Reveal private details'}</span>}
          </button>
          <button className="icon-button pm-account-open" aria-label={`Open account details for ${name} · ${view.label(a.label,a.id)}`} onClick={()=>openAccount(a)}><CaretRight size={17}/></button>
        </div></PortfolioAccountPrivacy>;
      })}</div>}
    </>:!account?<div className="panel pm-empty" role="status"><h2 ref={accountHeading} tabIndex={-1}>Account unavailable</h2><p>Use Back to accounts to select an available account.</p></div>:<PortfolioAccountPrivacy revealed={!!revealedAccount} balancesVisible={balancesVisible}><section className="pm-detail" aria-label="Selected portfolio">
        <header className="pm-detail-header">
          <div><h2 ref={accountHeading} tabIndex={-1}>{personName(account.personId,selectedPrivacy)} <span>·</span> {account.platform} {selectedPrivacy.label(account.label,account.id)}</h2>
            <div className="pm-account-meta"><span className={`pm-status ${/auto-updated/i.test(accountStatus)?'green':'amber'}`}>{accountStatus}</span><span>{stamp(account)} · {zoneLabel}</span></div>
          </div>
          <div className="pm-actions">
            <button className="button outline" disabled={actionsHidden} onClick={()=>setDialog({type:'account',account})}><PencilSimple size={16}/>Edit account</button>
            {account.platform==='Trading 212'&&<button className="button outline" disabled={actionsHidden} onClick={()=>setDialog({type:'connect',account})}><LinkSimple size={17}/>{account.connected?'Connection':'Connect account'}</button>}
            {account.connected&&<button className="button primary" disabled={actionsHidden} onClick={()=>openTrade(account)}><ArrowsLeftRight size={17}/>Trade / orders</button>}
          </div>
        </header>
        {account.error&&<p className="pm-alert" role="status">{selectedPrivacy.privateMode?'Account refresh needs attention.':account.error}{account.retryAt&&` Next attempt after ${clockStamp(account.retryAt)}.`}</p>}
        {account.snapshot?<><PortfolioHistory key={account.id} account={account} watchlist={watchlist}>
          <Holdings account={account} snapshot={account.snapshot} watchlist={watchlist} search={search} setSearch={setSearch}
            onToggleValues={()=>setValueVisibility({route,preferences:privacy.preferences,visible:selectedPrivacy.hideBalances})} onOpen={h=>setHoldingView({route,accountId:account.id,ticker:h.ticker})}/>
          </PortfolioHistory>
          <div className="pm-snapshot-footer"><p><strong>{selectedPrivacy.privateMode?'Saved snapshot':account.snapshot.sourceLabel}</strong>{account.snapshot.note&&!selectedPrivacy.privateMode&&<span>{account.snapshot.note}</span>}{account.snapshot.source!=='api'&&<span>This is a saved snapshot. It does not update when the account owner buys, sells or deposits.</span>}</p><button className="button outline" disabled={actionsHidden} onClick={()=>download({...account.snapshot,source:'snapshot'},'portfolio-snapshot.json')}><DownloadSimple size={16}/>Export snapshot</button></div>
        </>:<div className="pm-empty"><LinkSimple size={30}/><h3>Ready to connect</h3><p>{account.platform==='Trading 212'?'Connect an authorized Trading 212 Invest or Stocks ISA account to automatically read its balance and holdings.':'Automatic syncing is not available for this platform yet. You can track an imported snapshot.'}</p></div>}
        <div className="pm-import-row"><span>Have a saved snapshot?</span><button className="text-button" disabled={actionsHidden||account.connected} onClick={()=>setDialog({type:'import',account})}><UploadSimple size={16}/>Import snapshot</button>{account.connected&&<small>Disconnect to import manually.</small>}</div>
      </section></PortfolioAccountPrivacy>}
    {dialog&&!actionsHidden&&<PortfolioDialog key={`${dialog.type}-${dialog.account?.id||dialog.person?.id||'new'}`} dialog={dialog} people={people} accounts={allAccounts} mutate={mutate} reload={load} onClose={()=>setDialog(null)} onSelect={id=>{privacy.update({account:id,filter:'all'});onNavigate(accountRoute(id));}} onAccountRemoved={()=>onNavigate('portfolio')}/>}
    {holdingView?.route===route&&<PortfolioAccountPrivacy revealed={!!revealedAccount} balancesVisible={balancesVisible}><Dialog wide title={`${viewedHolding?.name||holdingView.ticker} · holding details`} onClose={()=>setHoldingView(null)}>{viewedHolding?<HoldingDetail key={`${holdingView.accountId}:${holdingView.ticker}`} holding={viewedHolding} account={viewedAccount} owner={personName(viewedAccount.personId,selectedPrivacy)} sheet={sheet} watchlist={watchlist} setupInterval={setupInterval} onTrade={actionsHidden?null:side=>openTrade(viewedAccount,viewedHolding,side)}/>:<p className="pm-no-results">This holding is no longer in the latest account snapshot.</p>}</Dialog></PortfolioAccountPrivacy>}
  </div>;
}

const holdingsColumns=[
  ['instrument','Instrument'],['quantity','Shares'],['averagePrice','Avg. price'],
  ['price','Last price'],['value','Value'],['unrealized','Unrealized'],['weight','Weight'],
];

function Holdings({account,snapshot,watchlist,search,setSearch,onOpen,onToggleValues}){
  const {money,number:quantity,hideBalances}=usePortfolioPrivacy();
  const hours=usePortfolioHours(account.id,account.connected);
  const [sort,setSort]=useState({key:'value',direction:'descending'});
  const order=hideBalances?{key:'instrument',direction:'ascending'}:sort;
  const sum=snapshot.holdings.reduce((total,h)=>total+(h.value??0),0),needle=search.trim().toLowerCase();
  const rows=snapshot.holdings.map(holding=>{
    const listing=portfolioListing(holding,watchlist);
    return {holding,listing,instrument:listing?.symbol||holding.name,weight:sum>0&&holding.value!==null?holding.value/sum*100:null};
  }).filter(({holding,instrument})=>`${holding.ticker} ${holding.name} ${instrument}`.toLowerCase().includes(needle));
  rows.sort((a,b)=>{
    const left=a[order.key]??a.holding[order.key],right=b[order.key]??b.holding[order.key];
    if(left==null||right==null)return Number(left==null)-Number(right==null);
    const comparison=order.key==='instrument'?left.localeCompare(right):left-right;
    return (order.direction==='ascending'?comparison:-comparison)||a.instrument.localeCompare(b.instrument);
  });
  const EyeIcon=hideBalances?EyeSlash:Eye;
  return <section className="pm-holdings" aria-labelledby="pm-holdings-title">
    <div className="pm-section-heading">
      <h3 id="pm-holdings-title">Holdings</h3>
      <div className="pm-holdings-tools">
        <label className="pm-search"><MagnifyingGlass size={17}/><input aria-label="Search holdings" placeholder="Search instrument (e.g. NVDA, AAPL)" value={search} onChange={e=>setSearch(e.target.value)}/></label>
        {!hideBalances&&<select className="pm-holdings-sort" aria-label="Sort holdings" value={`${sort.key}:${sort.direction}`} onChange={e=>{
          const [key,direction]=e.target.value.split(':');setSort({key,direction});
        }}>{holdingsColumns.flatMap(([key,label])=>['ascending','descending'].map(direction=><option key={`${key}:${direction}`} value={`${key}:${direction}`}>{label} {direction==='ascending'?'↑':'↓'}</option>))}</select>}
        <button className="pm-values-toggle" role="switch" aria-checked={!hideBalances} onClick={onToggleValues}><EyeIcon size={16}/>Show values<span aria-hidden="true"/></button>
      </div>
    </div>
    <div className="pm-table-wrap"><table className="pm-table">
      <thead><tr>{holdingsColumns.map(([key,label])=>{
        const active=order.key===key,Icon=active?(order.direction==='ascending'?CaretUp:CaretDown):CaretUpDown;
        return <th key={key} scope="col" aria-sort={active?order.direction:undefined}>
          {hideBalances?<span>{label}</span>:<button onClick={()=>setSort({key,direction:active&&order.direction==='ascending'?'descending':'ascending'})}>{label}<Icon size={12}/></button>}
        </th>;
      })}</tr></thead>
      <tbody>{rows.map(({holding:h,listing,instrument,weight})=><tr key={h.ticker} className="pm-holding-row" onClick={e=>{
        if(!e.target.closest('button,dialog')){const button=e.currentTarget.querySelector('.pm-holding-button');button?.focus({preventScroll:true});button?.click();}
      }}>
        <td><div className="pm-instrument-cell"><HoursButton compact hours={hours} ticker={h.ticker} name={h.name}/><button className="pm-instrument pm-holding-button" onClick={()=>onOpen(h)} aria-label={`View ${h.name} holding details`}>
          <span><strong>{instrument}</strong>{listing&&<small>{listing.exchange} · {h.name}</small>}</span><CaretRight size={14}/>
        </button></div></td>
        <td data-label="Shares">{quantity(h.quantity)}</td>
        <td data-label="Avg. price">{money(h.averagePrice,h.instrumentCurrency)} <small>{h.instrumentCurrency}</small></td>
        <td data-label="Last price">{money(h.price,h.instrumentCurrency)} <small>{h.instrumentCurrency}</small></td>
        <td data-label="Value">{money(h.value,snapshot.currency)}</td>
        <td data-label="Unrealized" className={hideBalances?'':tone(h.unrealized)}>{money(h.unrealized,snapshot.currency)}{!hideBalances&&h.cost>0&&h.unrealized!==null&&<small> ({percent(h.unrealized/h.cost*100)})</small>}</td>
        <td data-label="Weight">{hideBalances?'••••':weight===null?'—':`${weight.toFixed(2)}%`}</td>
      </tr>)}</tbody>
    </table></div>
    {!rows.length&&<p className="pm-no-results">{snapshot.holdings.length?'No matching holdings.':'No open holdings in this snapshot.'}</p>}
  </section>;
}

function AccountReturn({snapshot}){
  const {money}=usePortfolioPrivacy();
  if(!snapshot)return null;
  const p=portfolioPerformance(snapshot);
  return <span className="pm-card-return"><b className={tone(p.open)}>{money(p.open,snapshot.currency)}{p.openPercent!==null?` (${percent(p.openPercent)})`:''}</b> open return</span>;
}
function HoldingDetail({holding,account,owner,sheet,watchlist,setupInterval,onTrade}){
  const privacy=usePortfolioPrivacy();
  const [chosen,setChosen]=useState('');
  const choices=portfolioListingChoices(watchlist),automatic=portfolioListing(holding,watchlist),entry=automatic||choices.find(e=>e.id===chosen);
  const position={holding,accountId:account.id,connected:account.connected,platform:account.platform,orderListing:automatic,onTrade:account.connected&&!privacy.privateMode?onTrade:null,listing:entry,currency:account.snapshot.currency,owner,accountLabel:privacy.label(account.label,account.id),sourceLabel:privacy.privateMode?'Saved snapshot':account.snapshot.sourceLabel,source:account.snapshot.source,observedAt:account.snapshot.observedAt,lastSuccess:account.lastSuccess,status:portfolioStatus(account),environment:account.environment};
  return <>
    {!automatic&&<div className="pm-listing-picker"><label>Stock / ETF listing<select aria-label="Holding chart listing" value={entry?.id||''} onChange={e=>setChosen(e.target.value)}><option value="" disabled>Choose this holding’s ticker</option>{choices.map(e=><option key={e.id} value={e.id}>{e.exchange}:{e.symbol}</option>)}</select></label><p>No unique automatic match for {holding.name} ({holding.ticker}). Choose this holding’s own ticker and currency. QQQ is a separate ETF, not an exchange selection. This choice applies to this view only.</p></div>}
    {entry?<CompanyDetail key={entry.id} entry={entry} sheet={sheet} setupInterval={setupInterval} position={position}/>:<><PortfolioPosition position={position}/><div className="empty"><h3>Choose a chart listing</h3><p>Your holding details are available above. A matching listing is needed for its chart, company details and your saved levels.</p></div></>}
    <details className="company-disclosure"><summary>Listing & trading hours</summary>{automatic&&<p className="pm-auto-listing">Chart matched automatically · <strong>{automatic.exchange}:{automatic.symbol}</strong></p>}<StockHours accountId={account.id} connected={account.connected} ticker={holding.ticker} name={holding.name}/></details>
  </>;
}

function PortfolioDialog({dialog,people,accounts,mutate,reload,onClose,onSelect,onAccountRemoved}){
  const {type,account,person}=dialog;
  const [name,setName]=useState(person?.name||''),[personId,setPersonId]=useState(account?.personId||dialog.personId||people[0]?.id||''),[platform,setPlatform]=useState(account?.platform||'Trading 212'),[label,setLabel]=useState(account?.label||'Invest'),[apiKey,setApiKey]=useState(''),[apiSecret,setApiSecret]=useState(''),[authorized,setAuthorized]=useState(false),[environment,setEnvironment]=useState(account?.environment||'live'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[snapshot,setSnapshot]=useState(null),[confirm,setConfirm]=useState(false);
  const title=type==='person'?(person?'Edit person':'Add person'):type==='account'?(account?'Edit account':'Add platform account'):type==='connect'?'Trading 212 connection':'Import portfolio snapshot';
  async function run(fn,close=true){setBusy(true);setError('');try{await fn();if(close)onClose();}catch(e){setError(e.message);if(e.status===409)await reload();}finally{setBusy(false);}}
  async function save(event){event.preventDefault();await run(async()=>{
    if(type==='person')await mutate('/people'+(person?'/'+person.id:''),{name},person?'PUT':'POST');
    if(type==='account'){const result=await mutate('/accounts'+(account?'/'+account.id:''),{personId,platform,label},account?'PUT':'POST');onSelect(account?.id||result.data.accounts.at(-1).id);}
    if(type==='connect')await mutate(`/accounts/${account.id}/connect`,{apiKey,apiSecret,authorized,environment});
    if(type==='import')await mutate(`/accounts/${account.id}/snapshot`,{snapshot});
  });}
  const close=()=>{if(!busy)onClose();};
  return <Dialog title={title} onClose={close}><form className="pm-form" onSubmit={save}>
    {type==='person'&&<><p>Track a whole account for each person. Adding someone does not send an invitation or give them access to your desk.</p><label>Full name<input required maxLength={100} value={name} onChange={e=>setName(e.target.value)} autoFocus placeholder="Person’s full name"/></label></>}
    {type==='account'&&<><label>Person<select aria-label="Person" value={personId} onChange={e=>setPersonId(e.target.value)}>{people.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label><label>Platform<input required maxLength={60} list="pm-platforms" value={platform} onChange={e=>setPlatform(e.target.value)} disabled={account?.connected}/><datalist id="pm-platforms"><option value="Trading 212"/><option value="Interactive Brokers"/><option value="Other"/></datalist></label><label>Account label<input required maxLength={100} value={label} onChange={e=>setLabel(e.target.value)} placeholder="Invest, ISA, or another account name"/></label><p>Trading 212 supports automatic account reads. Other platforms currently support imported snapshots.</p></>}
    {type==='connect'&&<><div className="pm-connect-note"><ShieldCheck size={25}/><div><strong>{people.find(p=>p.id===account.personId)?.name} · {account.label}</strong><p>The account owner creates an API key and secret in Trading 212 → Settings → API (Beta). Enable account and portfolio read permissions, plus Metadata for stock trading hours, History: Dividends for reports, History: Transactions for account return and History: Orders for past realized results. For viewing only, leave order execution disabled. To trade, the owner must additionally enable Metadata, Orders: Read and Orders: Execute, then enable trading separately in Trade / orders.</p></div></div><p>Enter credentials here, never in chat. They are encrypted on the server and excluded from exports. Connecting reads account summary, positions and history. Orders require separately enabled trading and a confirmed order review.</p><a className="pm-doc-link" href="https://helpcentre.trading212.com/hc/en-us/articles/14584770928157-Trading-212-API-key" target="_blank" rel="noopener noreferrer">Trading 212 API setup ↗</a><label>Environment<select aria-label="Environment" value={environment} onChange={e=>setEnvironment(e.target.value)}><option value="live">Live account · Invest / Stocks ISA</option><option value="demo">Demo account · excluded from totals</option></select></label><label>API key<input type="password" required autoComplete="off" value={apiKey} onChange={e=>setApiKey(e.target.value)} maxLength={512}/></label><label>API secret<input type="password" required autoComplete="off" value={apiSecret} onChange={e=>setApiSecret(e.target.value)} maxLength={512}/></label><label className="pm-check"><input type="checkbox" required checked={authorized} onChange={e=>setAuthorized(e.target.checked)}/><span>The account owner authorized this connection and supplied these API credentials.</span></label><p>Updates run every 60 seconds while Portfolio Manager is open, with a 15-minute background snapshot for performance history. This is polling, not a streaming price feed. Availability depends on the account’s API access.</p></>}
    {type==='import'&&<><p>Import a Portfolio Manager JSON snapshot. Review its value and holdings below before saving. This replaces the selected account’s current snapshot.</p><label>Snapshot file<input type="file" accept=".json,application/json" onChange={async e=>{setSnapshot(null);setError('');const file=e.target.files?.[0];if(!file)return;try{if(file.size>2000000)throw Error('Choose a JSON file smaller than 2 MB.');setSnapshot(normalizePortfolioSnapshot(JSON.parse(await file.text())));}catch(error){setError(error.message);}}}/></label><button type="button" className="text-button" onClick={()=>download({version:1,currency:'USD',sourceLabel:'Manual snapshot',observedAt:null,accountValue:null,cash:null,holdings:[]},'portfolio-template.json')}>Download empty JSON template</button>{snapshot&&<div className="pm-import-preview"><strong>{money(snapshot.accountValue,snapshot.currency)} · {snapshot.holdings.length} holdings</strong><p>{snapshot.sourceLabel} · {snapshot.observedAt||'Source date unknown'}</p><ul>{snapshot.holdings.map(h=><li key={h.ticker}><span>{h.ticker} · {quantity(h.quantity)} shares</span><b>{money(h.value,snapshot.currency)}</b></li>)}</ul>{snapshot.note&&<p>{snapshot.note}</p>}</div>}</>}
    {error&&<p role="alert" className="pm-alert">{error}</p>}
    <div className="pm-form-actions"><button className="button outline" type="button" onClick={close} disabled={busy}>Cancel</button><button className="button primary" disabled={busy||type==='import'&&!snapshot}>{busy?'Saving…':type==='connect'?'Connect & read account':type==='import'?'Save snapshot':'Save'}</button></div>
    {(person||type==='account'&&account||type==='connect'&&account.connected)&&<div className="pm-danger">{!confirm?<button type="button" className="text-button" disabled={busy||!!person&&accounts.some(a=>a.personId===person.id)} onClick={()=>setConfirm(true)}>{type==='connect'?'Disconnect account':person?'Remove person':'Remove account'}</button>:<><p>{type==='connect'?'Delete the saved API credentials and stop automatic reads? The last snapshot stays available.':person?'Remove this person?':'Remove this account, its snapshot, performance history and saved connection? This cannot be undone. Snapshot export includes current holdings only.'}</p><button type="button" className="button outline" disabled={busy} onClick={()=>run(async()=>{await mutate(type==='connect'?`/accounts/${account.id}/disconnect`:person?`/people/${person.id}`:`/accounts/${account.id}`,{},type==='connect'?'POST':'DELETE');if(type==='account')onAccountRemoved();})}>Confirm {type==='connect'?'disconnect':'remove'}</button><button type="button" className="text-button" onClick={()=>setConfirm(false)} disabled={busy}>Keep it</button></>}{person&&accounts.some(a=>a.personId===person.id)&&<p>Remove this person’s platform accounts first.</p>}</div>}
  </form></Dialog>;
}
