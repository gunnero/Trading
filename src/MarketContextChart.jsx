import {Clock} from '@phosphor-icons/react';
import {useDisplayTime} from './DisplayTime';
import {ChartHeader,ChartLevels,useSavedTimeframe} from './ChartSettings';
import {ChartLegend} from './ChartLegend';
import {PriceChart,TreasuryHistoryChart} from './Charts';
import {useMarketChart} from './useMarketData';
import {useZoneRoles} from './ZoneRoles';
import {quotePrice,quoteChange,quoteTone,quoteDelay} from './data/quotes.mjs';
import {formatDate,zoneName} from './data/market';
import {CONTEXT_INSTRUMENTS,FUTURES_CONTEXT} from './data/market-context.mjs';
import {levelRoleRows} from './data/level-focus.mjs';
import './market-context.css';

// Keep the five primary reference charts first, followed by the other supported listings.
const primarySymbols=['NQ','ES','VIX','US10Y','US2Y'];
const chartTabs=[...primarySymbols.map(symbol=>CONTEXT_INSTRUMENTS.find(([key])=>key===symbol)),
  ...CONTEXT_INSTRUMENTS.filter(([key])=>!primarySymbols.includes(key))];

const exactPrice=new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:20});
const basisNote='Yahoo futures history may roll between contracts. Its contract basis can differ from your continuous TradingView levels.';
const sourceNotes={
  US2Y:'Treasury publishes daily par yields. The chart includes only published observation dates.',
  US10Y:'Yahoo’s 10-year Treasury yield index. Quotes and axes are percentages.',
  DXY:'ICE U.S. Dollar Index via Yahoo Finance. Tracks the dollar against six currencies.',
  VIX1D:'Cboe’s one-day measure of expected S&P 500 volatility uses regular U.S. trading hours. Before the open, the last published session is shown. Yahoo coverage may omit the final 15 minutes.',
  VIX:'Cboe Volatility Index via Yahoo Finance. The source delay applies to both the quote and the chart.',
};

function ImportedLevels({instrument,roles,historical,quoteDate}){
  const {clockStamp,zoneLabel}=useDisplayTime();
  const reference=historical?'Historical reference':!roles?'Imported reference':null;
  const rows=levelRoleRows(instrument,roles,reference);
  return <section className="context-imports" aria-label={`Imported ${instrument.symbol} futures levels`}>
    <header><h3>Imported {instrument.symbol} FUT levels</h3><span>{formatDate(instrument.sourceDate)} · Source {instrument.timeframe}</span></header>
    <p>{basisNote}</p>
    {instrument.carriedForward&&<p>Carried forward from {formatDate(instrument.sourceDate)}.</p>}
    {quoteDate&&quoteDate!==instrument.sourceDate&&<p>Quote session {formatDate(quoteDate)} · different from the level sheet.</p>}
    <div className="context-level-grid" role="region" aria-label="Imported level prices and roles" tabIndex={0}>
      <table><thead><tr><th scope="col">Level type</th><th scope="col">Price range</th><th scope="col">Current zone</th><th scope="col">Status</th><th scope="col">Confirmed close</th></tr></thead>
      <tbody>{rows.map(({zone,type,status,evidence})=><tr key={`${zone.type}|${zone.low}|${zone.high}`}>
        <th scope="row"><i className={`zone-dot zone-${zone.type}`}/>{zoneName(zone.type)}</th>
        <td>{exactPrice.format(zone.low)} – {exactPrice.format(zone.high)}</td>
        <td><span className={`context-zone zone-${type}`}>{zoneName(type)}</span></td><td>{status}</td>
        <td>{evidence?`${exactPrice.format(evidence.close)} · ${clockStamp(evidence.end)} ${zoneLabel}`:'—'}</td>
      </tr>)}</tbody></table>
    </div>
  </section>;
}

export function MarketContextChart({symbol,quotes,sheet,onSelect,historical=false}){
  const {quoteStamp,zoneLabel}=useDisplayTime();
  const daily=symbol==='US2Y',label=CONTEXT_INSTRUMENTS.find(([key])=>key===symbol)?.[1]||symbol;
  const [timeframe,setTimeframe]=useSavedTimeframe(symbol);
  const futures=FUTURES_CONTEXT.some(item=>item.key===symbol),autoRoles=['NQ','ES'].includes(symbol);
  const imported=futures&&sheet?.instruments[label]?.futures?sheet.instruments[label]:null;
  const confirmation=useZoneRoles(historical||!autoRoles?null:imported,sheet?.date);
  const roles=historical||!autoRoles?null:confirmation,instrument=roles?roles.instrument:imported;
  const history=useMarketChart(symbol,timeframe);
  const quote=history.quote||quotes[symbol]?.quote;
  const stale=history.status==='stale'||(!history.quote&&quotes[symbol]?.status==='stale');
  const source=daily?'U.S. Treasury':'Yahoo Finance',scope=`${symbol}|${timeframe}`;
  return <div className="context-chart-content">
    <div className="context-chart-symbols" role="group" aria-label="Choose market indicator">{chartTabs.map(([key,name])=>
      <button type="button" key={key} className={key===symbol?'selected':''} aria-pressed={key===symbol} onClick={()=>onSelect(key)}>{name}</button>
    )}</div>
    {historical&&<p className="notice">Historical level sheet · {formatDate(sheet.date)}. Original roles are shown over the currently loaded chart history.</p>}
    <div className="context-quote">
      <strong>{quotePrice(quote)}</strong><b className={quoteTone(quote)}>{quoteChange(quote)}</b>
      <span>{quote?.provider||source}{daily?' · Daily observations only':quote?` · ${quoteDelay(quote)}`:''} · {daily&&quote?.sessionDate?formatDate(quote.sessionDate):quote?quoteStamp(quote):'Awaiting observation'}</span>
      {quote?.name&&quote.name!==label&&!daily&&<small>{quote.name}</small>}
    </div>
    {stale&&<p className="notice" role="status">Cached / old history · {history.message||'Source refresh pending.'}</p>}
    <section key={symbol} className="context-chart-panel" aria-label={`${label} market chart`}>
      <ChartHeader symbol={label} marketKey={symbol} timeframe={timeframe} onTimeframe={setTimeframe} daily={daily} source={source} roles={roles} showToolLabels/>
      {!daily&&<ChartLevels scope={scope} instrument={instrument} date={imported?.sourceDate||sheet?.date} roles={roles} quoteDate={quote?.sessionDate}/>}
      {!daily&&history.candles?.length>0&&<ChartLegend scope={scope} indicators={history.indicators}/>}
      {daily&&history.points?.length?<TreasuryHistoryChart points={history.points}/>:!daily&&history.candles?.length?
        <PriceChart symbol={label} drawingKey={symbol} timeframe={timeframe} candles={history.candles} price={history.quote?.price??history.candles.at(-1).ohlc[1]} percent={symbol==='US10Y'} instrument={instrument} indicators={history.indicators}/>:
        <div className="empty" role="status"><Clock size={30}/><h3>{history.status==='loading'?'Loading chart…':'Chart unavailable'}</h3><p>{history.status==='loading'?'Fetching source history.':history.message||'History is unavailable. Retrying automatically.'}</p></div>}
      <div className="chart-footnote"><span>{daily&&history.points?.length?`${history.points[0].date} – ${history.points.at(-1).date} · ${history.points.length} published observations`:daily?'Published observation dates':`${timeframe==='4h'?'4h from source hourly bars · ':''}${zoneLabel} time · partial bars marked`}</span><span>{daily?'Hourly source cache':'Refreshes every minute'}</span></div>
    </section>
    {imported?<ImportedLevels instrument={imported} roles={roles} historical={historical} quoteDate={quote?.sessionDate}/>:
      <p className="context-chart-note">{futures?`No imported ${label} futures levels on this sheet. ${basisNote}`:sourceNotes[symbol]}</p>}
  </div>;
}
