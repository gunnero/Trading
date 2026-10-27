import {CaretRight,FileText} from '@phosphor-icons/react';
import {chartableEntry,SETUP_INTERVALS} from './data/instruments.mjs';
import {stageLabel,compareSetups,RETEST_WINDOW,CONFIRMATION_WINDOW} from './data/retests.mjs';
import {quotePrice,quoteChange,quoteTone,entryState} from './data/quotes.mjs';
import {formatPrice,zoneText} from './data/market';
import {clockStamp,tradingDay} from './data/market-session.mjs';
import {marketDay} from './data/calendar.mjs';
const tone=result=>result?.stage==='confirmed'?(result.direction==='bullish'?'green':'red'):'amber';
export function FocusTabs({focus,onFocus,quotes,qqqRoles,spyRoles,sheet,scan,customEntry}){
  return <div className="instrument-tabs" role="tablist" aria-label="Primary instruments">
    {['QQQ','SPY'].map(ticker=>{const result=quotes[ticker],q=result?.quote,roles=ticker==='QQQ'?qqqRoles:spyRoles,state=entryState({symbol:ticker,group:'FUND'},{...sheet,instruments:{...sheet.instruments,[ticker]:roles.instrument||sheet.instruments[ticker]}},result);
      return <button key={ticker} role="tab" aria-selected={focus===ticker} className={`instrument-tab ${focus===ticker?'selected':''}`} onClick={()=>onFocus(ticker)}><strong>{ticker}</strong><span className="tab-price">{quotePrice(q)}</span><span className={quoteTone(q)}>{q?quoteChange(q):'—'}</span><small className="amber">{state.label}</small></button>;
    })}
    <button role="tab" aria-selected={focus==='hot'} className={`instrument-tab focus-tab ${focus==='hot'?'selected':''}`} onClick={()=>onFocus('hot')}><strong>TOP / HOT</strong><span>{scan.top?.entry.symbol||'—'}</span><small className={tone(scan.top)}>{scan.status==='loading'?'Scanning watchlist…':scan.top?`${scan.top.direction==='bullish'?'Bullish':'Bearish'} · ${stageLabel(scan.top.stage)}`:'No qualifying setup'}</small></button>
    <button role="tab" aria-selected={focus==='custom'} className={`instrument-tab focus-tab ${focus==='custom'?'selected':''}`} onClick={()=>onFocus('custom')}><strong>CUSTOM</strong><span>{customEntry?.symbol||'Choose stock'}</span><small className="muted">{customEntry?`${customEntry.exchange} · from your watchlist`:'Pick from your watchlist'}</small></button>
  </div>;
}
export function SetupControls({focus,watchlist,customKey,onCustom,interval,onInterval,scan,sheetDate}){
  const day=marketDay(Date.now()),session=tradingDay(day),live=session.kind==='session'&&Date.now()>=Date.parse(session.open)&&Date.now()<Date.parse(session.close),date=scan.top?.sessionDate||scan.byKey.QQQ?.sessionDate||scan.byKey.SPY?.sessionDate;
  const unavailable=scan.stocks.filter(r=>['unavailable','stale','insufficient','indicators-unavailable'].includes(r.stage)).length;
  return <div className="setup-controls">
    <div className="setup-control-row"><span><strong>Break & retest</strong><small>Bullish + bearish · EMA 9/21 + VWAP</small></span><label>Confirm on<select aria-label="Setup confirmation interval" value={interval} onChange={e=>onInterval(e.target.value)}>{SETUP_INTERVALS.map(value=><option key={value} value={value}>{value==='source'?'Level timeframe':value}</option>)}</select></label>
      {focus==='custom'&&<label>Watchlist stock<select aria-label="Custom watchlist stock" value={watchlist.some(e=>e.id===customKey&&chartableEntry(e))?customKey:''} onChange={e=>onCustom(e.target.value)}><option value="">Choose a symbol</option>{watchlist.filter(chartableEntry).toSorted((a,b)=>a.symbol.localeCompare(b.symbol)).map(e=><option key={e.id} value={e.id}>{e.symbol} · {e.exchange}</option>)}</select></label>}
      <small className="scan-state">{scan.status==='loading'?`Scanning ${scan.progress||0}/${scan.total||0}…`:date?`${live&&date===day?'Today':'Last regular session'} · ${date}`:'Session data unavailable'}{scan.refreshing?' · Updating…':''}</small>
    </div>
    <details className="scan-details"><summary>Scan details & rules{scan.status==='ready'?` · ${scan.eligible}/${scan.stocks.length} stocks have levels${unavailable?` · ${unavailable} data gaps`:''}`:''}</summary>
      <p>A completed candle closes above the full zone for a bullish break, or below for a bearish break. A later candle must touch the zone and close back on the breakout side. The break candle cannot count as its own retest.</p>
      <p>Bullish alignment: EMA 9 above EMA 21, with the candle close and latest quote above EMA 21 and session VWAP. Bearish alignment reverses these checks. Confirmation requires alignment on both the retest candle and the latest completed candle. Missing or conflicting readings exclude a Top/Hot pick. Previous-day levels and daily SMAs provide context, not extra votes.</p>
      <p>Wait up to {RETEST_WINDOW} candles for a retest; confirmed setups stay current for {CONFIRMATION_WINDOW} candles. Picks must remain within one zone width of the broken edge (minimum width 0.1% of price). Ranking: confirmed retest first, then retesting, then waiting; newest event, nearest edge, then symbol. This is a rule match, not a probability or market-wide ranking.</p>
      <p>Scans your U.S. watchlist stocks and ADRs that have same-session levels. Refreshes each minute while visible. Yahoo regular-session data can lag; pre-market/after-hours are not scanned. Chart interval and zone-flip timeframe remain independent. Options spreads, liquidity and Greeks are not assessed.</p>
      <a href="https://www.fidelity.com/learning-center/trading-investing/technical-analysis/support-and-resistance" target="_blank" rel="noopener noreferrer">Support/resistance background · Fidelity ↗</a>
      {scan.updatedAt&&<p>Scan finished {clockStamp(scan.updatedAt)} · Skopje</p>}
      <div className="scan-table">{scan.stocks.toSorted(compareSetups).map(r=><div key={r.key}><strong>{r.entry.symbol}</strong><span className={tone(r)}>{stageLabel(r.stage)}{r.direction?` · ${r.direction}`:''}</span><button className="text-button" onClick={()=>onCustom(r.entry.id)}>Open custom<CaretRight size={13}/></button></div>)}</div>
    </details>
  </div>;
}
export function RetestPanel({symbol,result,canPlan,onPlan}){
  const bull=result?.direction==='bullish',zone=result?.zone,values=result?.indicators||{},price=result?.quote?.price;
  const stageNote={expired:'The confirmation window has passed. Wait for a new break and retest.',invalidated:'Price crossed the far edge of the zone. This setup no longer qualifies.',extended:'Price is beyond the proximity limit. This setup is excluded from Top/Hot.','indicator-conflict':'EMA or VWAP alignment is missing. This setup is excluded from Top/Hot.','indicators-unavailable':'Required EMA or VWAP readings are unavailable. Confirmation is paused.'}[result?.stage];
  const references=[['pdh','Previous day high'],['pdl','Previous day low'],['pdc','Previous day close'],['sma20','20 SMA · 1D'],['sma50','50 SMA · 1D'],['sma100','100 SMA · 1D'],['sma200','200 SMA · 1D']].filter(([key])=>Number.isFinite(values[key])).map(([key,label])=>({label,value:values[key]})).sort((a,b)=>Math.abs(a.value-price)-Math.abs(b.value-price));
  return <section className="scenario-panel retest-panel"><h2>Break & retest</h2><p className={`scenario-status ${tone(result)}`}>{stageLabel(result?.stage||'loading')}</p>
    <small className="muted">{result?.direction?`${bull?'Bullish':'Bearish'} · `:''}{result?.timeframe||'Selected'} confirmation candles</small><div className="scenario-divider"/>
    {zone?<><div className={`zone-banner ${bull?'demand':'supply'}`}><strong>{bull?'Break above':'Break below'}</strong><span>{zoneText(zone)}</span></div><div className="scenario-copy"><p>Break: {clockStamp(result.breakAt*1000)} · Skopje</p><p>{result.confirmedAt?`Retest: ${clockStamp(result.confirmedAt*1000)} · Skopje`:`Waiting for a later candle to touch ${zoneText(zone)} and close ${bull?'above '+formatPrice(zone.high):'below '+formatPrice(zone.low)}.`}</p><p>Invalidation reference: {bull?'below':'above'} {formatPrice(result.invalidation)}.</p></div></>:<p className="scenario-copy">{result?.stage==='no-levels'?'Import levels for this symbol to check your strategy.':result?.stage==='dated'?'Import levels dated for the quote session before evaluating a setup.':result?.stage==='waiting-break'?'Wait for a closed candle beyond a full zone, then a separate retest. Both directions are monitored.':result?.message||'Waiting for complete candles and matching levels.'}</p>}
    {stageNote&&<p className="small-copy amber">{stageNote}</p>}
    {!!result?.checks?.length&&<div className="setup-checks">{result.checks.map(check=><div key={check.name}><span>{check.name}</span><strong className={check.passed===true?'green':'amber'}>{check.passed===null?'Unavailable':check.passed?'Aligned':'Conflict'}</strong></div>)}<small>EMA 9 {Number.isFinite(values.ema9)?formatPrice(values.ema9):'—'} · EMA 21 {Number.isFinite(values.ema21)?formatPrice(values.ema21):'—'}<br/>VWAP {Number.isFinite(values.vwap)?formatPrice(values.vwap):'—'}</small></div>}
    {!!references.length&&<details className="setup-references"><summary>Previous day & daily averages</summary>{references.map(r=><div key={r.label}><span>{r.label}</span><strong>{formatPrice(r.value)}</strong><small>{r.value>price?'Above price':'Below price'}</small></div>)}{result.dailyStatus!=='ok'&&<small className="amber">Daily references: {result.dailyStatus||'unavailable'}</small>}</details>}
    {result?.through&&!references.length&&<p className="small-copy muted">Previous-day levels and daily averages unavailable.</p>}
    {result?.through&&<p className="setup-source">Checked through {clockStamp(result.through*1000)} · Skopje<br/>Yahoo reference {quotePrice(result.quote)} · data may be delayed</p>}
    <button className="button primary review-button" disabled={!canPlan} onClick={onPlan}>Review {symbol||'stock'} plan<CaretRight size={21}/></button><button className="options-link" disabled={!canPlan} onClick={onPlan}><FileText size={24} weight="light"/><span><strong>Options</strong><small>Plan the setup · contract feed pending</small></span><CaretRight size={16}/></button>
  </section>;
}
