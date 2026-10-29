import {useDisplayTime} from './DisplayTime';
import {ChartHeader,ChartLevels,useSavedTimeframe} from './ChartSettings';
import {Clock} from '@phosphor-icons/react';
import {PriceChart,TreasuryHistoryChart} from './Charts';
import {TIMEFRAMES} from './data/candles';
import {useMarketChart} from './useMarketData';
import {quotePrice,quoteChange,quoteTone,quoteDelay} from './data/quotes.mjs';
import {formatDate,zoneName,zoneText} from './data/market';
import {useZoneRoles,ZoneRoleStatus} from './ZoneRoles';

import {CONTEXT_INSTRUMENTS,FUTURES_CONTEXT} from './data/market-context.mjs';
export function MarketContextChart({symbol,quotes,sheet,onSelect,historical=false}){
  const {quoteStamp,zoneLabel}=useDisplayTime();
  const daily=symbol==='US2Y',label=CONTEXT_INSTRUMENTS.find(([key])=>key===symbol)?.[1]||symbol;
  const [timeframe,setTimeframe]=useSavedTimeframe(symbol);
  const futures=FUTURES_CONTEXT.some(item=>item.key===symbol),autoRoles=['NQ','ES'].includes(symbol);
  const imported=futures&&sheet?.instruments[label]?.futures?sheet.instruments[label]:null;
  const confirmation=useZoneRoles(historical||!autoRoles?null:imported,sheet?.date),roles=historical||!autoRoles?null:confirmation,instrument=roles?roles.instrument:imported;
  const history=useMarketChart(symbol,timeframe);
  const quote=history.quote||quotes[symbol]?.quote;
  const stale=history.status==='stale'||(!history.quote&&quotes[symbol]?.status==='stale');
  return <div className="context-chart-content">
    {historical&&<p className="notice">Saved list {formatDate(sheet.date)} · original supplied roles over the currently loaded chart history. This is a historical level reference, not a market replay.</p>}
    <div className="context-chart-symbols" role="group" aria-label="Choose market indicator">{CONTEXT_INSTRUMENTS.map(([key,name])=><button key={key} className={key===symbol?'selected':''} aria-pressed={key===symbol} onClick={()=>onSelect(key)}>{name}</button>)}</div>
    <div className="context-chart-summary"><div><strong>{quotePrice(quote)}</strong><span className={quoteTone(quote)}>{quoteChange(quote)}</span><small>{quote?.name||label}</small></div><div className="context-chart-source"><span>{quote?.provider||'Loading source…'} · {daily?'Daily par yield':quoteDelay(quote)}</span><span>{quote?quoteStamp(quote):'Awaiting source observation'}</span></div></div>
    {stale&&<div className="notice" role="status">Cached / old history · {history.message||'Source refresh pending.'}</div>}
    <section className="context-chart-panel" aria-label={`${label} market chart`}>
      <ChartHeader symbol={label} marketKey={symbol} timeframe={timeframe} onTimeframe={setTimeframe} daily={daily} source={daily?'U.S. Treasury':'Yahoo Finance'} roles={roles}/>
      {!daily&&<ChartLevels scope={`${symbol}|${timeframe}`} instrument={instrument} date={imported?.sourceDate||sheet?.date} roles={roles} quoteDate={quote?.sessionDate}/>}
      {daily&&history.points?.length?<TreasuryHistoryChart points={history.points}/>:!daily&&history.candles?.length?<PriceChart symbol={label} drawingKey={symbol} timeframe={timeframe} candles={history.candles} price={history.quote.price} percent={symbol==='US10Y'} instrument={instrument} indicators={history.indicators}/>:<div className="empty" role="status"><Clock size={30}/><h3>{history.status==='loading'?'Loading chart…':'Chart unavailable'}</h3><p>{history.status==='loading'?'Fetching source history.':history.message||'History is not available from this source. Retrying automatically.'}</p></div>}
      <div className="chart-footnote"><span>{daily&&history.points?.length?`${history.points[0].date} – ${history.points.at(-1).date} · ${history.points.length} published observations`:daily?'Published observation dates':`${timeframe==='4h'?'4h from source hourly bars · ':''}${zoneLabel} time · partial bars marked`}</span><span>{daily?'Refreshes hourly':'Refreshes every minute'}</span></div>

    </section>
    {futures&&!autoRoles&&imported&&<p className="context-chart-note">Imported levels are reference overlays with their original supply/demand roles. Automatic role confirmation is available for NQ and ES.</p>}
    <p className="context-chart-note">{daily?'U.S. Treasury daily par yields, shown by observation date. Weekends and missing observations are not filled in.':futures?'Yahoo futures history may roll between contracts. Its contract basis can differ from your continuous TradingView levels.':symbol==='US10Y'?'Yahoo’s 10-year Treasury yield index. Values and chart axes are percentages.':symbol==='DXY'?'ICE U.S. Dollar Index via Yahoo Finance. Tracks the dollar against six currencies; it is not a direct stock-market direction signal.':symbol==='VIX1D'?'Cboe 1-Day Volatility Index via Yahoo Finance. Expected S&P 500 volatility, not direction. Calculated during regular U.S. trading hours; before the open, the last published session is shown. Yahoo chart coverage may omit the final 15 minutes of Cboe’s session.':'Cboe Volatility Index via Yahoo Finance. The source delay applies to both the quote and its chart.'}</p>
  </div>;
}
