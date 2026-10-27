import {useState} from 'react';
import {ChartHeader,ChartLevels,useSavedTimeframe} from './ChartSettings';
import {PriceChart} from './Charts';
import {useMarketChart} from './useMarketData';
import {useZoneRoles} from './ZoneRoles';
import {useStockSetup} from './useStockSetup';
import {RetestPanel} from './RetestDesk';
import {matchingInstrument,locate,formatDate} from './data/market.js';
import {quoteKey,quotePrice,quoteStamp,quoteDelay,isExtendedQuote,awaitingSessionQuote} from './data/quotes.mjs';
import {SETUP_INTERVALS} from './data/instruments.mjs';

export function LevelSetup({entry,sheet,result,initialInterval,onPlan,historical=false}){
  const key=quoteKey(entry),[timeframe,setTimeframe]=useSavedTimeframe(key),[interval,setInterval]=useState(initialInterval);
  const imported=matchingInstrument(entry,sheet),history=useMarketChart(key,timeframe),confirmation=useZoneRoles(historical?null:imported,sheet.date,key);
  const roles=historical?null:confirmation,instrument=historical?imported:roles.instrument;
  const setup=useStockSetup(entry,sheet,interval,!historical),quote=result?.quote||history.quote;
  const quoteStatus=result?.quote?result.status:history.status,sourceDate=instrument?.sourceDate||sheet.date;
  const context=!historical&&quote&&quoteStatus==='ok'&&instrument&&(roles.status==='ok'||isExtendedQuote(quote))&&sourceDate===quote.sessionDate?locate(quote.price,instrument):null;
  const canPlan=!!context&&!!(context.supply||context.demand||setup.zone);
  return <div className="level-setup-content">
    {historical&&<p className="notice">Saved list {formatDate(sheet.date)} · original supplied roles. These older levels are references over the currently loaded price history, not a historical replay. Setup checks and plans use the latest list.</p>}
    <div className="level-setup-meta"><span>{entry.exchange} · {entry.group==='FUND'?'Fund / ETF':entry.group==='DEPOSITARY RECEIPT'?'Depositary receipt':'Stock'}</span><span>Levels updated <time dateTime={sourceDate}>{formatDate(sourceDate)}</time> · {instrument?.timeframe}{instrument?.carriedForward?' · Carried forward':''}</span></div>
    <div className="level-setup-controls"><div><strong>{quotePrice(quote)}</strong><small>{quote?`${quoteStamp(quote)} · ${quoteDelay(quote)}`:'Awaiting Yahoo quote'}{quoteStatus==='stale'?' · Cached / old quote':''}</small></div>{!historical&&<label>Setup confirmation<select aria-label="Level setup confirmation interval" value={interval} onChange={e=>setInterval(e.target.value)}>{SETUP_INTERVALS.map(value=><option key={value} value={value}>{value==='source'?'Level timeframe':value}</option>)}</select></label>}</div>
    {quote&&sourceDate!==quote.sessionDate&&<p className="notice">{!historical&&awaitingSessionQuote(sourceDate,quote)?`Today’s levels are ready. Waiting for today’s price; the last regular-session quote is from ${quote.sessionDate}. No new import is needed.`:<>Levels {sourceDate}; quote session {quote.sessionDate}. Carried or older levels remain chart references. Setup comparisons require matching dates.</>}</p>}
    <div className={`workspace-grid level-setup-grid ${historical?'historical-level-chart':''}`}>
      <section className="chart-panel" aria-label={`${entry.symbol} level setup chart`}>
        <ChartHeader symbol={entry.symbol} marketKey={key} timeframe={timeframe} onTimeframe={setTimeframe} roles={roles}/>
        <ChartLevels scope={`${key}|${timeframe}`} instrument={instrument} date={sourceDate} roles={roles} quoteDate={quote?.sessionDate}/>
        {history.candles?.length?<PriceChart symbol={entry.symbol} drawingKey={key} timeframe={timeframe} candles={history.candles} price={history.quote.price} instrument={instrument} indicators={history.indicators}/>:<div className="empty" role="status"><h3>{history.status==='loading'?'Loading setup chart…':'Chart unavailable'}</h3><p>{history.message||'Fetching regular-session candles.'}</p></div>}
        <div className="chart-footnote"><span>{history.status==='stale'?'Cached / old history · ':''}{timeframe==='4h'?'4h from hourly bars · ':''}Yahoo Finance</span><span>Regular session · partial bars marked</span></div>
      </section>
      {!historical&&<RetestPanel symbol={entry.symbol} result={setup} canPlan={canPlan} onPlan={()=>onPlan({symbol:entry.symbol,marketKey:key,setup,quote,context:setup.zone?{...context,zone:setup.zone}:context})}/>}
    </div>
    {!historical&&<p className="small-copy muted">Bullish and bearish break & retest · EMA 9/21 + session VWAP. The chart interval is separate from setup confirmation and the original level timeframe. Yahoo data may be delayed; options prices, Greeks and liquidity are not connected.</p>}
    {entry.sourceUrl&&<a className="text-button" href={entry.sourceUrl} target="_blank" rel="noopener noreferrer">{entry.exchange} listing reference · verified {entry.verifiedAt} ↗</a>}
  </div>;
}
