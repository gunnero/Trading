import TransfersNet from './TransfersNet';
import {PageHeader,PageNavigation} from './PageHeader';
import {useDisplayTime} from './DisplayTime';
import {DisplayTimeProvider} from './DisplayTime';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, LockKey, UserCircle, SignOut, SquaresFour, Tag, SlidersHorizontal, CalendarBlank, Plus, Trash, UploadSimple, CaretRight, CaretDown, X, MagnifyingGlass, ArrowUpRight, ArrowDownRight, Minus, FileText, Check, Info, ArrowLeft, DownloadSimple, List, Clock, FunnelSimple, Notebook, ArrowCounterClockwise, WarningCircle, Gear, Newspaper, Gauge, Copy } from '@phosphor-icons/react';
import {useAuth,AccountDialog} from './Auth';
import {SettingsPage,settingsCategory} from './SettingsPage';
const SentimentPage=React.lazy(()=>import('./SentimentPage'));
const EarningsPage=React.lazy(()=>import('./EarningsPage'));
const TradeJournal=React.lazy(()=>import('./TradeJournal'));
const TransfersPage=React.lazy(()=>import('./TransfersPage'));
const SessionReview=React.lazy(()=>import('./SessionReview'));
import { PriceChart, Sparkline } from './Charts';
import { TIMEFRAMES } from './data/candles';
import { useBriefing, BriefingStrip, NewsPage, SidebarSentiment, TV_SCRIPT } from './Briefing';
import { formatDate, formatPrice, zoneText, zoneName, parseLevels, mergeLevelSheets, parseWatchlist, matchingInstrument, locate, toneFor } from './data/market';
import { useWorkspace } from './useWorkspace';
import { MarketClock, MarketHours } from './MarketClock';
import {MarketContextChart} from './MarketContextChart';
import EconomicCalendar from './EconomicCalendar';
import {MarketGroups} from './MarketGroups';
import {marketGroups,CONTEXT_INSTRUMENTS} from './data/market-context.mjs';
import {useZoneRoles,ZoneRoleStatus} from './ZoneRoles';
import {useMarketQuotes, useMarketChart} from './useMarketData';
import {quoteKey,quotePrice,quoteChange,quoteTone,quoteDelay,entryState,isExtendedQuote,awaitingSessionQuote} from './data/quotes.mjs';
import {marketDay} from './data/calendar.mjs';
import {FocusTabs,SetupControls,RetestPanel} from './RetestDesk';
import {useRetestScan} from './useRetestScan';
import {chartableEntry} from './data/instruments.mjs';
import {CompanyDetail} from './CompanyDetail';
import {LevelSetup} from './LevelSetup';
import {LevelsView} from './LevelsView';
import {importLevelList} from './data/level-history.mjs';
import {levelDestination} from './data/level-listings.mjs';
import {WATCH_GROUPS, WATCH_EXCHANGES, overviewWatchlist, readWatchlist, newWatchEntry, addWatchEntry, removeWatchEntry, replaceWatchlist} from './data/watchlist.mjs';
import {DrawingProvider} from './ChartDrawings';
import {ChartSettingsProvider,ChartHeader,ChartLevels,useSavedTimeframe} from './ChartSettings';

const sections = [{ id: 'overview', title: 'Overview', icon: SquaresFour }, { id: 'levels', title: 'Key levels', icon: SlidersHorizontal }, { id: 'briefing', title: 'Economic Calendar', icon: CalendarBlank }, { id: 'earnings', title: 'Earnings', icon: CalendarBlank }, { id: 'news', title: 'News', icon: Newspaper }, { id: 'journal', title: 'Trade journal', icon: Notebook }, { id: 'transfers', title: 'Transfers & Costs', icon: ArrowDownRight }, { id: 'review', title: 'Session review', icon: CalendarBlank }, { id: 'sentiment', title: 'Fear & Greed', icon: Gauge }, { id: 'settings', title: 'Settings', icon: Gear }];
function currentRoute() {
  const route = window.location.hash.slice(1);
  if (route.split('/')[0] === 'watchlist') return 'settings/watchlist';
  return sections.some(section => section.id === route.split('/')[0]) ? route : 'overview';
}
const groupLabels = { STOCKS: 'Stocks', 'DEPOSITARY RECEIPT': 'Depositary receipts', FUND: 'Funds', FUTURES: 'Futures', CRYPTO: 'Crypto' };
function Status({ text, tone }) { return <span className={`status ${tone || toneFor(text)}`}>{text}</span>; }
function Empty({ title, children, icon: Icon = MagnifyingGlass }) { return <div className="empty"><Icon size={30} weight="light" /><h3>{title}</h3><p>{children}</p></div>; }
function Modal({ title, subtitle, children, onClose, wide = false, className = '', initialFocus }) {
  const ref = useRef(null);
  useEffect(() => { const dialog = ref.current, trigger = document.activeElement, previousOverflow=document.body.style.overflow; document.body.style.overflow='hidden'; if (!dialog.open) dialog.showModal(); if(initialFocus)dialog.querySelector(initialFocus)?.focus({preventScroll:true}); return () => { document.body.style.overflow=previousOverflow; if (dialog.open) dialog.close(); if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({preventScroll:true}); }; }, []);
  return <dialog ref={ref} className={`modal ${wide ? 'wide' : ''} ${className}`} aria-labelledby="dialog-title" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="modal-inner"><header className="modal-header"><div><h2 id="dialog-title">{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={22}/></button></header>{children}</div>
  </dialog>;
}

export function App() {
  const workspace=useWorkspace();
  if(!workspace.data) return <div className="workspace-loading"><Bell size={36} className="amber"/><h1>Opening Bell</h1><p>{workspace.status==='loading'?'Loading your saved workspace…':workspace.error}</p>{workspace.status!=='loading'&&<button className="button primary" onClick={workspace.retry}>Retry connection</button>}</div>;
  return <DisplayTimeProvider workspace={workspace}><ChartSettingsProvider workspace={workspace}><DrawingProvider workspace={workspace}><SessionDesk workspace={workspace}/></DrawingProvider></ChartSettingsProvider></DisplayTimeProvider>;
}
function SessionDesk({workspace}) {
  const {quoteStamp,zoneLabel}=useDisplayTime();
  const [route, setRoute] = useState(currentRoute);
  const section=route.split('/')[0],category=settingsCategory(route),watchlistOpen=section==='settings'&&category==='watchlist';
  const {user,signOut}=useAuth();
  const [logoutBusy,setLogoutBusy]=useState(false),[logoutError,setLogoutError]=useState('');
  async function logout(){
    if(logoutBusy)return;
    if(workspace.status!=='saved'&&!confirm('There are unsaved changes. Log out and discard those unsaved changes?'))return;
    setLogoutBusy(true);setLogoutError('');
    try{await signOut();}catch(error){setLogoutError(error.message);setLogoutBusy(false);}
  }
  const {levelText,levelSourceDates,watchText,plans,preferences,manualSentiment}=workspace.data;
  const {symbol:primarySymbol}=preferences;
  const focus=preferences.focus||primarySymbol,customKey=preferences.customSymbol||'',setupInterval=preferences.setupInterval||'2m';
  const sheet=useMemo(()=>parseLevels(levelText,levelSourceDates),[levelText,levelSourceDates]);
  const watchlist=useMemo(()=>readWatchlist(watchText),[watchText]);
  const setWatchText=watchText=>workspace.update(current=>replaceWatchlist(current,parseWatchlist(watchText)));
  const setFocus=focus=>workspace.update(current=>({...current,preferences:{...current.preferences,focus,...(['QQQ','SPY'].includes(focus)?{symbol:focus}:{})}}));
  const setCustom=customSymbol=>workspace.update(current=>({...current,preferences:{...current.preferences,customSymbol,focus:'custom'}}));
  const setSetupInterval=setupInterval=>workspace.update(current=>({...current,preferences:{...current.preferences,setupInterval}}));
  const setPlans=change=>workspace.update(current=>({...current,plans:typeof change==='function'?change(current.plans):change}));
  const setManual=manualSentiment=>workspace.update({manualSentiment});
  const [dialog, setDialog] = useState(()=>user.mfaEnabled?null:'account');
  const [toast, setToast] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const sidebarRef=useRef(null);
  useEffect(()=>{
    if(!menuOpen)return;
    const trigger=document.activeElement,previous=document.body.style.overflow;
    document.body.style.overflow='hidden';
    const items=()=>[...sidebarRef.current.querySelectorAll('button,a[href]')].filter(node=>node.getBoundingClientRect().height>0);
    items()[0]?.focus();
    const onKey=event=>{
      if(event.key==='Escape'){event.preventDefault();setMenuOpen(false);}
      if(event.key==='Tab'){
        const list=items(),first=list[0],last=list.at(-1);
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
    };
    const onResize=()=>{if(window.innerWidth>760)setMenuOpen(false);};
    document.addEventListener('keydown',onKey);window.addEventListener('resize',onResize);
    return()=>{document.body.style.overflow=previous;document.removeEventListener('keydown',onKey);window.removeEventListener('resize',onResize);if(trigger?.isConnected)trigger.focus({preventScroll:true});};
  },[menuOpen]);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [selectedLevel,setSelectedLevel]=useState(null);
  const [levelView,setLevelView]=useState(null);
  const viewedSheet=levelView?.historical?levelView.sheet:sheet;
  const [removedEntry,setRemovedEntry]=useState(null);
  const removeSymbol=entry=>{setRemovedEntry({entry,index:watchlist.findIndex(item=>item.id===entry.id)});workspace.update(current=>removeWatchEntry(current,entry.id));};
  const undoRemove=()=>{if(!removedEntry)return;workspace.update(current=>readWatchlist(current.watchText).some(entry=>entry.id===removedEntry.entry.id)?current:addWatchEntry(current,removedEntry.entry,removedEntry.index));setRemovedEntry(null);};
  const addSymbol=entry=>{workspace.update(current=>addWatchEntry(current,entry));setDialog(null);setToast(`${entry.id} added to your watchlist.`);};
  const briefing = useBriefing({manual:manualSentiment,setManual,section});
  const customEntry=watchlist.find(e=>e.id===customKey&&chartableEntry(e));
  const contextGroups=useMemo(()=>marketGroups(watchlist),[watchlist]);
  const scan=useRetestScan(watchlist,sheet,setupInterval,customKey,section==='overview');
  const selectedStock=focus==='hot'?scan.top?.entry:focus==='custom'?customEntry:null;
  const symbol=['QQQ','SPY'].includes(focus)?focus:selectedStock?.symbol;
  const marketKey=['QQQ','SPY'].includes(focus)?focus:selectedStock?quoteKey(selectedStock):null;
  const [timeframe,setTimeframe]=useSavedTimeframe(marketKey,{primary:true});
  const quotes=useMarketQuotes(watchlist,watchlistOpen,[marketKey,['instrument','level-setup'].includes(dialog)&&selectedEntry?quoteKey(selectedEntry):null,...contextGroups.flatMap(group=>group.items.map(item=>item.key))],(watchlistOpen||!['transfers','settings','journal','review','earnings','sentiment','levels','briefing'].includes(section)||['earnings','levels'].includes(section)&&['instrument','level-setup'].includes(dialog)));
  const chart=useMarketChart(marketKey,timeframe,section==='overview');
  const quoteResult=quotes[marketKey],quote=quoteResult?.quote;
  const setup=scan.byKey[marketKey]||{stage:scan.status==='loading'?'loading':symbol?'no-levels':'waiting-break',timeframe:setupInterval};
  const [planSnapshot,setPlanSnapshot]=useState(null);
  const macro=CONTEXT_INSTRUMENTS;
  const [macroSymbol,setMacroSymbol]=useState('NQ');
  const qqqRoles=useZoneRoles(sheet.instruments.QQQ,sheet.date,undefined,section==='overview'||watchlistOpen),spyRoles=useZoneRoles(sheet.instruments.SPY,sheet.date,undefined,section==='overview'||watchlistOpen);
  const stockRoles=useZoneRoles(selectedStock?matchingInstrument(selectedStock,sheet):null,sheet.date,marketKey,section==='overview');
  const roles=focus==='QQQ'?qqqRoles:focus==='SPY'?spyRoles:stockRoles;
  const currentSheet={...sheet,instruments:{...sheet.instruments,...(qqqRoles.instrument?{QQQ:qqqRoles.instrument}:{}),...(spyRoles.instrument?{SPY:spyRoles.instrument}:{})}};
  const instrument = roles.instrument;
  const sourceDate=instrument?.sourceDate||sheet.date;
  const matchedDate=!!quote&&sourceDate===quote.sessionDate;
  const validInstrument = instrument && !instrument.futures;
  const context = matchedDate && validInstrument && quoteResult.status==='ok' && (roles.status==='ok'||isExtendedQuote(quote)) ? locate(quote.price, instrument) : null;
  const startPlan=()=>{setPlanSnapshot({symbol,marketKey,setup,quote,context:setup.zone?{...context,zone:setup.zone}:context});setDialog('plan');};
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 5000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    const canonicalize = () => { if(window.location.hash.slice(1).split('/')[0]==='watchlist') window.history.replaceState(window.history.state,'','#settings/watchlist'); };
    canonicalize();
    const syncSection = () => { canonicalize(); setRoute(currentRoute()); setMenuOpen(false); setDialog(null); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', syncSection);
    return () => window.removeEventListener('hashchange', syncSection);
  }, []);
  const navigate = next => { window.location.hash = next; setRoute(next); setMenuOpen(false); window.scrollTo(0, 0); };
  const inspect = entry => { setSelectedEntry(entry); setDialog('instrument'); };
  const openLevelSetup=entry=>{setSelectedEntry(entry);setDialog('level-setup');};
  const openLevel=(item,selectedSheet,historical)=>{
    setLevelView({sheet:selectedSheet,historical});
    const target=levelDestination(item,watchlist);setSelectedLevel(item);
    if(target.kind==='chart'){setMacroSymbol(item.symbol);setDialog('macro-chart');}
    else if(target.kind==='setup')openLevelSetup(target.entry);
    else if(target.kind==='details'&&!historical)inspect(target.entry);
    else setDialog('level-link');
  };
  const marketContext=<MarketGroups groups={contextGroups} quotes={quotes} onOpen={(group,item)=>{
    setLevelView(null);
    if(group==='funds'||!macro.some(([key])=>key===item.key)){inspect(item.entry);return;}
    setMacroSymbol(item.key);setDialog('macro-chart');
  }}/>;
  return <div className="app-shell" data-section={section}>
    <aside ref={sidebarRef} id="desk-navigation" role={menuOpen?'dialog':undefined} aria-modal={menuOpen||undefined} aria-label="Navigation" className={`sidebar ${menuOpen ? 'is-open' : ''}`}>
      <button className="icon-button drawer-close" aria-label="Close navigation menu" onClick={()=>setMenuOpen(false)}><X size={22}/></button><MarketClock onOpen={()=>{setMenuOpen(false);setDialog('market-hours');}}/>
      <nav aria-label="Main navigation">{sections.filter(item=>!['settings','sentiment'].includes(item.id)).map(({ id, title, icon: Icon }) => <button key={id} aria-label={title} title={title} className={`nav-item ${section === id ? 'active' : ''}`} onClick={() => navigate(id)} aria-current={section === id ? 'page' : undefined}><Icon size={22} weight={section === id ? 'regular' : 'light'}/><span>{title}</span></button>)}</nav>
      <div className="sidebar-account-area">
        <SidebarSentiment briefing={briefing} active={section==='sentiment'} onOpen={()=>navigate('sentiment')}/><TransfersNet onOpen={()=>navigate('transfers')}/>
        <div className="sidebar-profile">
          <button className="nav-item account-nav" aria-label="Account and security" title="Account and security" onClick={()=>{setMenuOpen(false);setDialog('account');}}><UserCircle size={32}/><span className="account-nav-copy"><span className="account-nav-label">{user.username}</span><small className="account-nav-profile">Account & security</small></span><CaretRight className="account-nav-arrow" size={15}/></button>
          <button className={`nav-item sidebar-settings ${section==='settings'?'active':''}`} aria-label="Settings" title="Settings" aria-current={section==='settings'?'page':undefined} onClick={()=>navigate('settings')}><Gear size={22}/><span>Settings</span></button>
          <button className="sidebar-logout" aria-label="Log out" title="Log out" disabled={logoutBusy} onClick={logout}><SignOut size={19}/><span>{logoutBusy?'Logging out…':'Log out'}</span></button>
          {logoutError&&<p className="sidebar-logout-error" role="alert">{logoutError}</p>}
        </div>
      </div>
    </aside>
    {menuOpen && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)}/>}
    <nav className="mobile-bottom-nav" aria-label="Quick navigation" inert={menuOpen||undefined}>{sections.filter(item=>['overview','briefing','news'].includes(item.id)).map(({id,title,icon:Icon})=><button key={id} aria-label={title} aria-current={section===id?'page':undefined} onClick={()=>navigate(id)}><Icon size={21}/><span>{id==='briefing'?'Calendar':title}</span></button>)}<button aria-label="More navigation" aria-current={['transfers','levels','review','settings','journal','earnings','sentiment'].includes(section)?'page':undefined} aria-expanded={menuOpen} aria-controls="desk-navigation" onClick={()=>setMenuOpen(true)}><List size={21}/><span>More</span></button></nav>
    <div className="main-shell" inert={menuOpen||undefined}>
      <MarketClock compact onOpen={()=>setDialog('market-hours')}/>
      <PageNavigation.Provider value={{expanded:menuOpen,open:()=>setMenuOpen(true)}}><main>
        {!user.mfaEnabled&&<div className="account-security-banner"><LockKey size={17}/><span>Protect your desk with two-step verification.</span><button className="text-button" onClick={()=>setDialog('account')}>Set up security <CaretRight size={15}/></button></div>}

        {section === 'overview' && <>
          <PageHeader title="Overview" description="Market context, your levels and setups for the U.S. session."/>
          <div className="page-market-context">{marketContext}</div>
          {quote && instrument && !matchedDate && <div className="notice"><WarningCircle size={20}/><span>{awaitingSessionQuote(sourceDate,quote)?`Today's levels are ready. Waiting for today's ${symbol} price; Yahoo's last regular-session quote is from ${formatDate(quote.sessionDate)}. No new level import is needed.`:<>{instrument.carriedForward?'Carried-forward levels':'Levels'} dated {formatDate(sourceDate)}; {symbol} quote session {formatDate(quote.sessionDate)}. The chart remains available; zone comparisons are paused until dates match.</>}</span></div>}
          <BriefingStrip briefing={briefing} watchlist={watchlist} onOpen={() => navigate('briefing')} onNews={() => navigate('news')} onEarnings={()=>navigate('earnings')} onSentiment={()=>navigate('sentiment')}/>
          <FocusTabs focus={focus} onFocus={setFocus} quotes={quotes} qqqRoles={qqqRoles} spyRoles={spyRoles} sheet={sheet} scan={scan} customEntry={customEntry}/>
          <SetupControls focus={focus} watchlist={watchlist} customKey={customKey} onCustom={setCustom} interval={setupInterval} onInterval={setSetupInterval} scan={scan} sheetDate={sheet.date}/>
          <div className="market-data-caption" role="status"><span>{quote?`${symbol} · ${quoteStamp(quote)} · ${quote.session||'Regular session'} ${isExtendedQuote(quote)?'chart price · level context only':'quote'}`:!symbol?(focus==='hot'?'No qualifying Top/Hot setup in your watchlist.':'Choose your custom stock from the watchlist.'):quoteResult?.status==='loading'?'Loading Yahoo prices…':'Yahoo prices unavailable · retrying automatically'}{quoteResult?.status==='stale'&&' · Cached / old reading'}</span><button onClick={()=>setDialog('market-data')}>Source & delays <Info size={13}/></button></div>
          <div className="workspace-grid">
            <section className="chart-panel" aria-label={`${symbol||'Stock'} chart`}><ChartHeader symbol={symbol} marketKey={marketKey} timeframe={timeframe} onTimeframe={setTimeframe} roles={roles}/>
              <ChartLevels scope={`${marketKey}|${timeframe}`} instrument={instrument} date={sheet.date} roles={roles} quoteDate={quote?.sessionDate} onTradingView={()=>setDialog('tradingview')}/>
              {chart.candles?.length ? <PriceChart symbol={symbol} drawingKey={marketKey} instrument={validInstrument?instrument:null} timeframe={timeframe} candles={chart.candles} price={chart.quote.price} indicators={chart.indicators}/> : <Empty icon={Clock} title={!symbol?(focus==='hot'?'No qualifying setup':'Choose a watchlist stock'):chart.status==='loading'?'Loading Yahoo chart…':'Chart unavailable'}>{!symbol?(focus==='hot'?'The automatic scan waits for your break-and-retest rules and indicator alignment. Open Scan details to see each stock’s status.':'Use the Watchlist stock selector above.'):chart.status==='loading'?'Fetching actual regular-session candles.':chart.message}</Empty>}
              <div className="chart-footnote"><span>{chart.status==='stale'?'Cached / old history · ':''}{chart.quote?`Quote ${quoteStamp(chart.quote)} · `:''}{timeframe==='4h'?'4h from hourly bars':'Yahoo history'}</span><span>Regular session · partial bars marked</span></div>
            </section>
            <RetestPanel symbol={symbol} result={setup} canPlan={!!context&&!!(context.supply||context.demand||setup.zone)} onPlan={startPlan}/>

          </div>
          <WatchlistTable compact watchlist={watchlist} sheet={currentSheet} quotes={quotes} onInspect={inspect} onViewAll={() => navigate('settings/watchlist')}/>
        </>}
        {section === 'briefing' && <EconomicCalendar briefing={briefing}/>}
        {section === 'sentiment' && <React.Suspense fallback={<p role="status">Loading sentiment…</p>}><SentimentPage briefing={briefing} onSettings={()=>navigate('settings/connections')}/></React.Suspense>}
        {section === 'earnings' && <React.Suspense fallback={<p role="status">Loading earnings…</p>}><EarningsPage watchlist={watchlist} sheet={sheet} now={briefing.now} onInspect={inspect} onLevels={item=>openLevel(item,sheet,false)} onBoard={()=>navigate('levels')}/></React.Suspense>}
        {section === 'journal' && <React.Suspense fallback={<p role="status">Loading trade journal…</p>}><TradeJournal workspace={workspace} tab={route.split('/')[1]==='plans'?'plans':'trades'} tradeId={route.split('/')[2]} onTab={tab=>navigate(`journal/${tab}`)} onClearTrade={()=>navigate('journal/trades')} onNewPlan={()=>navigate('overview')} onReview={day=>navigate(day?`review/${day}`:'review')}/></React.Suspense>}
        {section === 'transfers' && <React.Suspense fallback={<p role="status">Loading transfers…</p>}><TransfersPage/></React.Suspense>}
        {section === 'settings' && <SettingsPage category={category} watchlistContent={<WatchlistTable watchlist={watchlist} sheet={currentSheet} quotes={quotes} onInspect={inspect} onImport={() => setDialog('watch-import')} onAdd={()=>setDialog('watch-add')} onRemove={removeSymbol} removedEntry={removedEntry} onUndoRemove={undoRemove} onDismissRemove={()=>setRemovedEntry(null)}/>} workspace={workspace} onAccount={()=>setDialog('account')} onLogout={logout} logoutBusy={logoutBusy} logoutError={logoutError}/>}
        {section === 'news' && <NewsPage watchlist={watchlist} marketFeed={briefing.news} marketContext={marketContext}/>}
        {section === 'levels' && <LevelsView workspace={workspace.data} watchlist={watchlist} onImport={() => setDialog('import')} onSelect={openLevel}/ >}
        {section === 'review' && <React.Suspense fallback={<p role="status">Loading session review…</p>}><SessionReview workspace={workspace} selectedDay={route.split('/')[1]} onDay={day=>navigate(`review/${day}`)} onJournal={()=>navigate('journal/trades')} onTrade={id=>navigate(`journal/trades/${encodeURIComponent(id)}`)}/></React.Suspense>}
        <div className={`workspace-save-status ${workspace.status==='error'||workspace.status==='conflict'?'needs-attention':''}`} role="status" aria-live="polite"><span>{workspace.status==='saved'?'Workspace saved':workspace.status==='saving'?'Saving workspace…':workspace.status==='pending'?'Unsaved changes…':workspace.error}</span><div>{['error','conflict'].includes(workspace.status)&&<>{workspace.status==='error'&&<button onClick={workspace.retry}>Retry save</button>}<button onClick={workspace.reload}>Load saved version</button></>}<button onClick={workspace.backup}><DownloadSimple size={14}/>Back up workspace</button></div></div>
        <footer className="app-footer"><span>OPENING BELL <span className="footer-separator">/</span> EARLY ACCESS</span><span>Yahoo market data · U.S. Treasury daily 2Y · sources may be delayed</span></footer>
      </main></PageNavigation.Provider>
    </div>
    {dialog === 'account' && <AccountDialog workspace={workspace} onClose={()=>setDialog(null)}/>}
      {dialog === 'macro-chart' && <Modal title={`${macro.find(([key])=>key===macroSymbol)?.[1]} chart`} subtitle="Market context · source history" onClose={()=>setDialog(null)} wide className="market-chart-modal"><MarketContextChart key={macroSymbol} symbol={macroSymbol} quotes={quotes} sheet={viewedSheet} historical={!!levelView?.historical} onSelect={setMacroSymbol}/></Modal>}
    {dialog === 'level-setup' && selectedEntry && <Modal title={`${selectedEntry.symbol} ${levelView?.historical?'historical levels':'setup'}`} subtitle={levelView?.historical?`Saved list · ${formatDate(viewedSheet.date)}`:"Your levels, chart and break & retest checks"} onClose={()=>setDialog(null)} wide className="level-setup-modal"><LevelSetup key={selectedEntry.id} entry={selectedEntry} sheet={viewedSheet} historical={!!levelView?.historical} result={quotes[quoteKey(selectedEntry)]} initialInterval={setupInterval} onPlan={snapshot=>{setPlanSnapshot(snapshot);setDialog('plan');}}/></Modal>}
    {dialog === 'level-link' && selectedLevel && <LevelLinkDialog instrument={selectedLevel} destination={levelDestination(selectedLevel,watchlist)} historical={!!levelView?.historical} onChoose={openLevelSetup} onAdd={()=>setDialog('level-add')} onClose={()=>setDialog(null)}/>}
    {dialog === 'level-add' && selectedLevel && <AddSymbolDialog watchlist={watchlist} initialSymbol={selectedLevel.symbol} onClose={()=>setDialog(null)} onAdd={entry=>{workspace.update(current=>addWatchEntry(current,entry));openLevelSetup(entry);setToast(`${entry.id} added to your watchlist.`);}}/>}
    {dialog === 'market-data' && <Modal title="Market data" subtitle="Yahoo Finance · interim personal data source" onClose={()=>setDialog(null)}><div className="market-source-details"><p>Prices and candles come from Yahoo Finance and refresh automatically every minute while this app is visible. Quotes show their original observation time in {zoneLabel}.</p><p>SPY, QQQ and U.S. stocks use available Yahoo pre-market and after-hours chart prices during those sessions. Their timestamps are source bar times; changes compare with the last regular close. If no extended-hours observation is available, the last regular-session quote stays labeled with its original date.</p><p>ES/NQ are Yahoo’s selected futures contracts with a 10-minute source delay. VIX and the 10-year yield have a 15-minute source delay. U.S. stock delivery can vary; this connection is not a guaranteed real-time feed.</p><p>The 2-year rate is the U.S. Treasury’s daily par yield, refreshed hourly. It is a daily reference, not an intraday quote.</p><p>Charts, zone-flip confirmation and break-and-retest signals use regular-session candles only. Pre-market prices provide level context; strategy confirmation starts at the regular open. 4-hour candles aggregate actual hourly bars from the U.S. session open; the final bar is shorter. W/M aggregate daily history. Cached readings are labeled; unavailable symbols stay blank. Options bid/ask and Greeks still need an options feed.</p><a className="text-button" href="https://help.yahoo.com/kb/SLN2310.html" target="_blank" rel="noopener noreferrer">Yahoo data sources & delays<ArrowUpRight size={16}/></a></div></Modal>}
    {dialog === 'market-hours' && <Modal title="Market hours" subtitle="U.S. stocks & ETFs · your local session clock" onClose={()=>setDialog(null)}><MarketHours/></Modal>}
    {dialog === 'tradingview' && <TradingViewDialog symbol={symbol||primarySymbol} marketKey={marketKey} timeframe={timeframe} levelText={levelText} sheet={sheet} onClose={() => setDialog(null)}/>}
    {dialog === 'import' && <ImportDialog kind="levels" initial={levelText} sourceDates={levelSourceDates} onClose={() => setDialog(null)} onImport={(merged,text) => { workspace.update(current=>importLevelList(current,text)); setDialog(null); setToast(`${merged.updated.length} updated · ${merged.added.length} added · ${merged.carried.length} carried forward for ${formatDate(merged.date)}.`); }}/ >}
    {dialog === 'watch-add' && <AddSymbolDialog watchlist={watchlist} onClose={()=>setDialog(null)} onAdd={addSymbol}/>}
    {dialog === 'watch-import' && <ImportDialog kind="watchlist" initial={watchText} onClose={() => setDialog(null)} onImport={(parsed, text) => { setWatchText(text); setRemovedEntry(null); setDialog(null); setToast(`Imported ${parsed.length} symbols into your radar.`); }}/ >}
    {dialog === 'plan' && planSnapshot && <PlanDialog symbol={planSnapshot.symbol} marketKey={planSnapshot.marketKey} setup={planSnapshot.setup} context={planSnapshot.context} quote={planSnapshot.quote} onClose={() => setDialog(null)} onSave={plan => { setPlans(p => [{ ...plan, id: crypto.randomUUID(), notes: '', sessionDate:planSnapshot.quote.sessionDate, priceMode:'yahoo', marketQuote:{price:planSnapshot.quote.price,observedAt:planSnapshot.quote.observedAt,provider:'Yahoo Finance'} }, ...p]); setDialog(null); navigate('journal/plans'); setToast(`${planSnapshot.symbol} draft saved to Trade journal → Plans.`); }}/ >}
    {dialog === 'instrument' && selectedEntry && (chartableEntry(selectedEntry)?<Modal title={`${selectedEntry.symbol} details`} subtitle="Company, trading context & catalysts" onClose={()=>setDialog(null)} wide className="company-modal"><CompanyDetail key={selectedEntry.id} entry={selectedEntry} sheet={sheet} result={quotes[quoteKey(selectedEntry)]} setupInterval={setupInterval} onUseCustom={()=>{setCustom(selectedEntry.id);setDialog(null);navigate('overview');}}/></Modal>:<InstrumentDialog entry={selectedEntry} sheet={sheet} result={quotes[quoteKey(selectedEntry)]} onClose={() => setDialog(null)}/>)}
    {toast && <div className="toast" role="status"><Check size={19}/>{toast}<button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast('')}><X size={17}/></button></div>}
  </div>;
}

function WatchlistTable({ compact = false, watchlist, sheet, quotes, onInspect, onViewAll, onImport, onAdd, onRemove, removedEntry, onUndoRemove, onDismissRemove }) {
  const {quoteStamp}=useDisplayTime();
  const [query,setQuery]=useState(''),[status,setStatus]=useState('All'),[group,setGroup]=useState('All'),[sort,setSort]=useState('Default');
  const resetFilters=()=>{setQuery('');setStatus('All');setGroup('All');};
  let rows=compact?overviewWatchlist(watchlist):watchlist.filter(x=>`${x.symbol} ${x.exchange}`.toLowerCase().includes(query.toLowerCase()));
  if(!compact){
    rows=rows.filter(e=>(group==='All'||e.group===group)&&(status==='All'||entryState(e,sheet,quotes[quoteKey(e)]).label===status));
    if(sort==='Biggest move')rows=rows.toSorted((a,b)=>Math.abs(quotes[quoteKey(b)]?.quote?.changePercent||0)-Math.abs(quotes[quoteKey(a)]?.quote?.changePercent||0));
    if(sort==='Symbol')rows=rows.toSorted((a,b)=>a.symbol.localeCompare(b.symbol));
  }
  const statuses=['All','Testing supply','Testing demand','Approaching supply','Approaching demand','Between zones','No levels','Today’s levels ready','Dated levels','Context','Cached / old quote','Unavailable'];
  return <section className={`panel watchlist-panel ${compact?'compact':''}`}><div className="section-heading"><div className="inline-heading"><h2>{compact?'Watchlist activity':'Watchlist radar'}</h2><span className="muted">{watchlist.length} symbols</span></div>{compact?<button className="text-button" onClick={onViewAll}>View all<CaretRight size={15}/></button>:<div className="watchlist-actions"><button className="button outline" onClick={onImport}><UploadSimple size={17}/>Import watchlist</button><button className="button primary" onClick={()=>{resetFilters();onAdd();}}><Plus size={17}/>Add symbol</button></div>}</div>
    {!compact&&removedEntry&&<div className="watchlist-undo"><span role="status">{removedEntry.entry.id} removed from your watchlist.</span><button className="text-button" onClick={onUndoRemove}><ArrowCounterClockwise size={15}/>Undo</button><button className="icon-button" aria-label="Dismiss removal notice" onClick={onDismissRemove}><X size={16}/></button></div>}
    {!compact&&<><p className="section-description">Actual quotes and daily changes. Sort by biggest move, then compare the price with your levels.</p><div className="filters"><label className="search-input"><MagnifyingGlass size={19}/><input aria-label="Search watchlist" placeholder="Find a symbol or exchange" value={query} onChange={e=>setQuery(e.target.value)}/></label><label className="select-wrap"><span className="sr-only">Filter status</span><FunnelSimple size={17}/><select aria-label="Filter status" value={status} onChange={e=>setStatus(e.target.value)}>{statuses.map(x=><option key={x}>{x}</option>)}</select></label><select aria-label="Filter asset group" value={group} onChange={e=>setGroup(e.target.value)}><option value="All">All assets</option>{Object.entries(groupLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><select aria-label="Sort watchlist" value={sort} onChange={e=>setSort(e.target.value)}><option>Default</option><option>Biggest move</option><option>Symbol</option></select></div></>}
    <div className="table-scroll"><table className="watch-table"><thead><tr><th className="spark-cell" aria-label="Latest session trend"/><th>Symbol</th><th>Last price</th><th>Change</th><th>At level</th><th>Status</th><th className="reason-col">What to watch</th><th className="row-arrow"/>{!compact&&<th className="watchlist-remove-cell"><span className="sr-only">Remove symbol</span></th>}</tr></thead><tbody>{rows.map(entry=>{
      const result=quotes[quoteKey(entry)],q=result?.quote,state=entryState(entry,sheet,result),zone=state.location?.zone;
      return <tr key={entry.id} data-watchlist-id={entry.id} onClick={()=>onInspect(entry)}><td className="spark-cell">{q?.trend?.length>1?<Sparkline tone={quoteTone(q)} data={q.trend}/>:<Minus size={20} className="muted"/>}</td><td><button className="symbol-button" onClick={e=>{e.stopPropagation();onInspect(entry);}}>{entry.symbol}</button>{!compact&&<small className="symbol-exchange">{entry.exchange}{entry.group==='FUTURES'?' · Yahoo contract':''}</small>}</td><td className="numeric" data-label="Last price">{quotePrice(q)}<small className="quote-cell-stamp">{q?`${isExtendedQuote(q)?q.session+' · ':''}${quoteStamp(q)}`:result?.status==='loading'?'Loading…':'Unavailable'}</small></td><td data-label="Change" className={`numeric ${quoteTone(q)}`}>{quoteChange(q)}</td><td className="zone-cell" data-label="At level">{zone?`${zoneName(zone.type)} ${zoneText(zone)}`:state.location?.label||'—'}</td><td data-label="Status"><Status text={state.label} tone={state.tone}/></td><td className="reason-col">{state.reason}</td><td className="row-arrow"><CaretRight size={15}/></td>{!compact&&<td className="watchlist-remove-cell"><button className="icon-button watchlist-remove" aria-label={`Remove ${entry.id} from watchlist`} title={`Remove ${entry.symbol}`} onClick={e=>{e.stopPropagation();onRemove(entry);requestAnimationFrame(()=>document.querySelector('.watchlist-undo .text-button')?.focus());}}><Trash size={17}/></button></td>}</tr>;
    })}</tbody></table></div>
    {rows.length===0&&(watchlist.length===0?<Empty icon={Tag} title="Your watchlist is empty">Add a symbol to start following it.<button className="button primary" onClick={compact?onViewAll:onAdd}><Plus size={17}/>{compact?'Manage watchlist':'Add your first symbol'}</button></Empty>:<Empty title="No symbols match">Try another symbol or reset your filters.<button className="button outline" onClick={resetFilters}>Reset filters</button></Empty>)}
    <div className="table-footer"><span>{compact?'Yahoo Finance':`${rows.length} of ${watchlist.length} symbols · Yahoo Finance`}</span><span>Session shown per quote · futures delayed · no relative-volume estimate</span></div>
  </section>;
}

function LevelLinkDialog({instrument,destination,historical,onChoose,onAdd,onClose}){
  return <Modal title={`${instrument.symbol} levels`} subtitle={`Levels updated ${formatDate(instrument.sourceDate)} · ${instrument.timeframe}${instrument.carriedForward?' · Carried forward':''}`} onClose={onClose}>
    {destination.kind==='choose'?<><p className="form-help">This symbol has more than one U.S. listing in your watchlist. Choose the exchange for this setup.</p><div className="level-listing-choices">{destination.entries.map(entry=><button className="button outline" key={entry.id} onClick={()=>onChoose(entry)}>{entry.id}<CaretRight size={16}/></button>)}</div></>:<><p className="form-help">{historical?'Saved historical levels are shown below. No setup checks run against archived lists.':instrument.futures?'This futures instrument has no confirmed market-data mapping in the app. Its supplied levels remain available below; no stock or spot-crypto prices are substituted.':'The level sheet does not specify an exchange, and this symbol has no verified U.S. listing saved here. Add its exact listing to enable the chart and setup checks when Yahoo provides data.'}</p>{!instrument.futures&&!historical&&<button className="button primary" onClick={onAdd}><Plus size={17}/>Add listing & open setup</button>}</>}
    <h3 className="detail-heading">Your supplied levels</h3>{instrument.zones.map((zone,i)=><div className="level-row" key={i}><span className={zone.type==='S'?'red':zone.type==='D'?'green':'amber'}>{zoneName(zone.type)}</span><strong>{zoneText(zone)}</strong></div>)}
  </Modal>;
}

function AddSymbolDialog({watchlist,initialSymbol='',onClose,onAdd}) {
  const [symbol,setSymbol]=useState(initialSymbol),[exchange,setExchange]=useState(initialSymbol?'':'NASDAQ'),[group,setGroup]=useState('STOCKS'),[error,setError]=useState('');
  const changeGroup=value=>{setGroup(value);setError('');if(!WATCH_EXCHANGES[value].includes(exchange))setExchange(initialSymbol?'':WATCH_EXCHANGES[value][0]);};
  const submit=e=>{
    e.preventDefault();
    try {
      const entry=newWatchEntry({symbol,exchange,group});
      if(watchlist.some(item=>item.id===entry.id))throw new Error(`${entry.id} is already in your watchlist.`);
      onAdd(entry);
    }catch(err){setError(err.message);}
  };
  return <Modal title="Add symbol" subtitle="Follow another instrument in your saved watchlist." onClose={onClose} className="watchlist-add-modal" initialFocus="#watch-symbol"><form onSubmit={submit}>
    <label className="block-label" htmlFor="watch-symbol">Ticker symbol<input id="watch-symbol" readOnly={!!initialSymbol} autoComplete="off" spellCheck={false} required maxLength={24} placeholder={group==='FUTURES'?'NQ1!':group==='CRYPTO'?'BTCUSD':'e.g. NVDA'} value={symbol} onChange={e=>{setSymbol(e.target.value.toUpperCase());setError('');}} aria-describedby="watch-symbol-help" aria-invalid={!!error}/></label>
    <div className="form-grid"><label>Asset type<select value={group} onChange={e=>changeGroup(e.target.value)}>{Object.entries(WATCH_GROUPS).filter(([value])=>!initialSymbol||['STOCKS','DEPOSITARY RECEIPT','FUND'].includes(value)).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>Exchange<select value={exchange} onChange={e=>{setExchange(e.target.value);setError('');}}>{initialSymbol&&<option value="">Choose exchange</option>}{WATCH_EXCHANGES[group].map(value=><option key={value}>{value}</option>)}</select></label></div>
    <p className="form-help" id="watch-symbol-help">Use the listing’s exchange and asset type. Quotes load automatically when supported by the current feed. Your existing level sheet stays separate.</p>
    {symbol.trim()&&<div className="watchlist-symbol-preview"><Tag size={18}/><strong>{exchange}:{symbol.trim()}</strong><span>{WATCH_GROUPS[group]}</span></div>}
    {error&&<div className="form-error" role="alert"><WarningCircle size={18}/>{error}</div>}
    <div className="modal-footer"><button type="button" className="text-button" onClick={onClose}>Cancel</button><button className="button primary" type="submit"><Plus size={18}/>{initialSymbol?'Add & open setup':'Add to watchlist'}</button></div>
  </form></Modal>;
}

function ImportDialog({ kind, initial, sourceDates, onClose, onImport }) {
  const [text, setText] = useState(kind==='levels'?'':initial);
  const [error, setError] = useState('');
  const isLevels = kind === 'levels';
  const preview=useMemo(()=>{
    if(!isLevels||!text.trim())return null;
    try{return {merged:mergeLevelSheets(initial,text,sourceDates)};}catch(error){return {error:error.message};}
  },[isLevels,initial,text,sourceDates]);
  const loadFile = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 200000) { setError('Choose a text file smaller than 200 KB.'); return; }
    try { setText(await file.text()); setError(''); } catch { setError('Could not read this file. Try pasting the text.'); }
  };
  const submit = e => { e.preventDefault(); try { onImport(isLevels ? mergeLevelSheets(initial,text,sourceDates) : parseWatchlist(text), text); } catch (err) { setError(err.message); } };
  return <Modal title={isLevels ? 'Import your daily levels' : 'Import your watchlist'} subtitle={isLevels ? 'Paste the new daily list. Missing instruments keep their last supplied levels.' : 'Paste a TradingView watchlist export, or choose its text file.'} onClose={onClose} wide><form onSubmit={submit}><div className="import-actions"><label className="button outline file-picker"><UploadSimple size={17}/>Choose .txt file<input type="file" accept=".txt,text/plain" onChange={loadFile}/></label><a className="text-button" download href={`/data/${isLevels ? 'levels' : 'watchlist'}.txt`}><DownloadSimple size={17}/>Original import</a></div><label className="field-label" htmlFor="import-text">{isLevels ? 'Level sheet' : 'Watchlist export'}</label><textarea id="import-text" className="import-text" placeholder={isLevels?'LVLS YYYY-MM-DD\nQQQ|30min|S 708.14-707.23':undefined} spellCheck={false} value={text} onChange={e => {setText(e.target.value);setError('');}} rows={13}/><p className="form-help">{isLevels ? 'Included instruments replace their entire previous row. Only missing instruments carry forward, with their original dates, timeframes and asset types. Older levels remain chart references; setup comparisons still require the quote’s U.S. session date.' : 'Exchange prefixes and futures symbols are preserved. Spot crypto is kept separate from futures.'}</p>{preview?.merged&&<div className="level-import-preview" aria-label="Level import preview"><p role="status"><strong>{preview.merged.updated.length} updated · {preview.merged.added.length} added · {preview.merged.carried.length} carried forward</strong></p>{preview.merged.carried.length>0&&<details><summary>Instruments kept from earlier lists</summary><ul>{preview.merged.carried.map(item=><li key={item.symbol}><strong>{item.symbol}{item.futures?' · FUT':''}</strong><span>{item.sourceDate} · {item.timeframe} · {item.zones.length} zones</span></li>)}</ul></details>}</div>}{(error||preview?.error)&&<div className="form-error" role="alert"><WarningCircle size={18}/>{error||preview.error}</div>}<div className="modal-footer"><span className="muted">Imports save automatically to your workspace.</span><button className="button primary" type="submit">{isLevels ? 'Import levels' : 'Import watchlist'}<CaretRight size={18}/></button></div></form></Modal>;
}

function PlanDialog({ symbol, marketKey, setup, context, quote, onClose, onSave }) {
  const {quoteStamp}=useDisplayTime();
  const [scenario, setScenario] = useState(setup?.direction==='bullish'?'continuation':'rejection');
  const [strategy, setStrategy] = useState('');
  const [expiration, setExpiration] = useState('');
  const [budget, setBudget] = useState('');
  const [thesis, setThesis] = useState('');
  const zone = context.zone || context.supply || context.demand;
  const scenarioTitle = scenario==='rejection'?'Bearish break & retest':'Bullish break & retest';
  return <Modal title={`${symbol} session plan`} subtitle={`Conditional plan · Yahoo quote ${formatPrice(quote.price)} · ${quoteStamp(quote)}`} onClose={onClose} wide><form onSubmit={e => {e.preventDefault(); onSave({ symbol, marketKey, scenario, scenarioTitle, strategy, expiration, budget, thesis: thesis || `Wait for a ${setup?.timeframe||'2m'} close ${scenario==='rejection'?'below':'above'} ${formatPrice(scenario==='rejection'?zone.low:zone.high)}, then a later candle touching the zone and closing back on that side. Require ${scenario==='rejection'?'bearish':'bullish'} EMA 9/21 and VWAP alignment. Invalidation reference: ${formatPrice(scenario==='rejection'?zone.high:zone.low)}.` });}}>
    <div className="plan-scenario-tabs"><button type="button" className={scenario === 'rejection' ? 'active red' : ''} onClick={() => setScenario('rejection')}><ArrowDownRight size={21}/>Bearish break & retest</button><button type="button" className={scenario === 'continuation' ? 'active green' : ''} onClick={() => setScenario('continuation')}><ArrowUpRight size={21}/>Bullish break & retest</button></div>
    <div className="plan-summary"><div><span>Decision zone</span><strong>{zoneText(zone)}</strong></div><div><span>Condition to evaluate</span><strong>{scenario === 'rejection' ? `Break below & retest ${formatPrice(zone.low)}` : `Hold & retest above ${formatPrice(zone.high)}`}</strong></div><div><span>What changes the thesis</span><strong>{scenario === 'rejection' ? `Acceptance above ${formatPrice(zone.high)}` : `Failed retest below ${formatPrice(zone.low)}`}</strong></div></div>
    <div className="form-grid"><label>Option structure<select required value={strategy} onChange={e => setStrategy(e.target.value)}><option value="">Choose your structure</option><option>Long call</option><option>Long put</option><option>Call debit spread</option><option>Put debit spread</option></select></label><label>Planned expiration<input type="date" required min={marketDay(Date.now())} value={expiration} onChange={e=>setExpiration(e.target.value)}/></label></div>
    <div className="options-placeholder"><FileText size={24}/><div><strong>{expiration ? 'Ready for contract data' : 'Select an expiration to assess contracts'}</strong><p>Bid/ask spreads, IV and Greeks will appear here when an options feed is connected. This is a proposed date; listed expirations and contracts are not yet verified.</p></div></div>
    <label className="block-label">Premium loss budget · optional ($)<input type="number" min="1" step="0.01" placeholder="Set your planned maximum" value={budget} onChange={e => setBudget(e.target.value)}/></label><label className="block-label">Your thesis<textarea rows={3} placeholder="What must happen, and what would change your mind?" value={thesis} onChange={e => setThesis(e.target.value)}/></label><p className="form-help">A price invalidation and a premium loss budget are separate. This form saves a draft; it does not monitor risk or place an order.</p><div className="modal-footer"><button type="button" className="text-button" onClick={onClose}>Back to desk</button><button className="button primary" type="submit">Save draft plan<Check size={19}/></button></div>
  </form></Modal>;
}
function InstrumentDialog({entry,sheet,result,onClose}) {
  const {quoteStamp}=useDisplayTime();
  const q=result?.quote,instrument=matchingInstrument(entry,sheet),state=entryState(entry,sheet,result);
  return <Modal title={entry.symbol} subtitle={`${entry.exchange} · ${groupLabels[entry.group]} · ${q?.provider||'Market data'}`} onClose={onClose}><div className="instrument-detail-price"><strong>{quotePrice(q)}</strong><Status text={state.label} tone={state.tone}/></div><p className="detail-reason">{state.reason}</p>{q&&<><div className="detail-metric"><span>Day change</span><strong className={quoteTone(q)}>{quoteChange(q)}</strong></div><p className="form-help">{q.name} · {quoteStamp(q)}<br/>{quoteDelay(q)}{result.status==='stale'?` · ${result.message}`:''}</p><div className="detail-metric"><span>Session volume</span><strong>{q.volume==null?'—':q.volume.toLocaleString('en-US')}</strong></div></>}<h3 className="detail-heading">Your listed levels <small>· {instrument?.sourceDate||sheet.date}{instrument?` · ${instrument.timeframe}${instrument.carriedForward?' · Carried forward':''}`:''}</small></h3>{instrument?instrument.zones.map((z,i)=><div className="level-row" key={i}><span className={z.type==='S'?'red':z.type==='D'?'green':'muted'}>{zoneName(z.type)}</span><strong>{zoneText(z)}</strong></div>):<p className="muted">No matching levels in your sheet. {entry.group==='CRYPTO'&&'Your exchange’s spot crypto quote is not connected.'}</p>}<div className="level-info"><Info size={18}/><p>{entry.group==='FUTURES'?'Yahoo futures are context only. The source contract and adjustment convention may differ from your continuous chart.':'The zone status describes price location. It does not confirm a price reaction or options liquidity.'}</p></div></Modal>;
}

function TradingViewDialog({symbol,marketKey,timeframe,levelText,sheet,onClose}) {
  const carried=Object.values(sheet.instruments).filter(item=>item.carriedForward);
  const [copied,setCopied]=useState(false), [error,setError]=useState('');
  const intervals={'2m':'2','5m':'5','15m':'15','30m':'30','1h':'60','4h':'240',D:'D',W:'W',M:'M'};
  const chartUrl=`https://www.tradingview.com/chart/?${new URLSearchParams({symbol:marketKey?.includes(':')?marketKey:`${symbol==='QQQ'?'NASDAQ':'AMEX'}:${symbol}`,interval:intervals[timeframe]})}`;
  async function copy() {try {await navigator.clipboard.writeText(levelText);setCopied(true);setError('');}catch {setError('Select the sheet below and copy it manually.');}}
  return <Modal title="gunner’s lvls" subtitle="Your levels, ready for TradingView." onClose={onClose} wide><div className="tv-toolkit"><p>The indicator uses a daily level list to draw supply, demand and gap zones. Copy your current sheet, then paste it into the indicator’s settings on TradingView.</p><div className="tv-actions"><a className="button primary" href={TV_SCRIPT} target="_blank" rel="noopener noreferrer">Open gunner’s lvls<ArrowUpRight size={18}/></a><a className="button outline" href={chartUrl} target="_blank" rel="noopener noreferrer">Open {symbol} chart · {timeframe}<ArrowUpRight size={18}/></a></div><ol><li>Open the script and add it to your favorites in TradingView.</li><li>Open your chart, then add gunner’s lvls from Indicators.</li><li>Paste this sheet into the indicator’s settings.</li></ol>{carried.length>0&&<p className="small-copy amber">This combined sheet includes carried-forward levels: {carried.map(item=>`${item.symbol} (${item.sourceDate})`).join(', ')}. The copied format has one header date; individual source dates remain saved in this app.</p>}<label>Current level sheet<textarea readOnly rows={7} value={levelText} onFocus={e=>e.target.select()}/></label><button className="button outline" onClick={copy}>{copied?<Check size={18}/>:<Copy size={18}/>} {copied?'Copied level sheet':'Copy level sheet'}</button>{error && <p role="status" className="amber">{error}</p>}<p className="small-copy muted">This protected Pine indicator runs on TradingView. The app independently flips zones using confirmed Yahoo candles on each level’s source timeframe. The protected Pine script is not running here, and changes do not sync automatically.</p></div></Modal>;
}
