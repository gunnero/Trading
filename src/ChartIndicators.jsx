import {useDisplayTime} from './DisplayTime';
export const INDICATORS=[
  {key:'ema',label:'9 / 21 EMA ribbon',color:'#b2b5be',series:['ema9','ema21']},
  {key:'vwap',label:'Session VWAP',color:'#ffffff',series:['vwap']},
  {key:'pdh',label:'Previous day high',color:'#4caf50',series:['pdh'],cross:true},
  {key:'pdl',label:'Previous day low',color:'#f23645',series:['pdl'],cross:true},
  {key:'pdc',label:'Previous day close',color:'#ffeb3b',series:['pdc'],cross:true},
  {key:'sma20',label:'20 SMA · 1D',color:'#00bcd4',series:['sma20']},
  {key:'sma50',label:'50 SMA · 1D',color:'#ffeb3b',series:['sma50']},
  {key:'sma100',label:'100 SMA · 1D',color:'#00e676',series:['sma100']},
  {key:'sma200',label:'200 SMA · 1D',color:'#f23645',series:['sma200']},
];
export const validIndicator=value=>typeof value==='number'&&Number.isFinite(value);
export function IndicatorControls({indicators,enabled,setEnabled,fit,setFit,formatValue}){
  const {journalStamp,zoneLabel}=useDisplayTime();
  const series=indicators?.series||{},vwapNote={
    'intraday-only':'VWAP: intraday charts only',
    'no-volume':'VWAP: no traded volume for this index',
    'incomplete-session':'VWAP: complete session volume unavailable',
  }[indicators?.vwapStatus];
  return <div className="chart-overlay-controls">
    <div className="chart-indicators"><div className="chart-panel-heading"><strong>Indicators</strong><span>Hover the plot to inspect values · close this panel to hide hover details</span></div>
      <div className="chart-indicator-options">{INDICATORS.map(item=>{
        const available=item.series.every(key=>series[key]?.some(validIndicator));
        const latest=item.series.map(key=>series[key]?.at(-1));
        return <label key={item.key} className={!available?'indicator-unavailable':''}>
          <input type="checkbox" checked={enabled[item.key]} disabled={!available} onChange={e=>setEnabled(value=>({...value,[item.key]:e.target.checked}))}/>
          <i style={{background:item.color}}/><span>{item.label}</span><strong>{latest.every(validIndicator)?latest.map(formatValue).join(' / '):'Unavailable'}</strong>
        </label>;
      })}</div>
      <p>EMA uses the chart timeframe and closing prices; its ribbon is green above the 21 EMA and red below. SMAs use completed daily closes. Previous day means the preceding completed Yahoo daily bar{indicators?.previousDay?` (${indicators.previousDay})`:''}; crosses use width 1.</p>
      <p>VWAP uses HLC3 × volume, resetting at Yahoo’s session boundaries. The 4h chart samples cumulative hourly VWAP. Session definitions, candles and daily closes can differ from TradingView. Values stay blank when history or volume is insufficient.</p>
      <p><a href="https://www.tradingview.com/support/solutions/43000502018-volume-weighted-average-price-vwap/" target="_blank" rel="noreferrer">VWAP calculation ↗</a> · <a href="https://www.tradingview.com/support/solutions/43000502589-moving-averages/" target="_blank" rel="noreferrer">Moving average calculations ↗</a></p>
      {indicators?.dailyStatus==='stale'&&<p className="amber">Daily indicators use cached / old source history{indicators.dailyFetchedAt?` · fetched ${journalStamp(indicators.dailyFetchedAt)} ${zoneLabel}`:''}.</p>}
      {(!indicators||indicators.dailyStatus==='unavailable')&&<p className="amber">Daily indicator history unavailable. Price candles remain available.</p>}
    </div>
    <label className="chart-fit-indicators"><input type="checkbox" checked={fit} onChange={e=>setFit(e.target.checked)}/>Fit indicators</label>
    {(vwapNote||indicators?.dailyStatus==='stale'||indicators?.dailyStatus==='unavailable'||!indicators)&&<small className="chart-indicator-status">{[vwapNote,indicators?.dailyStatus==='stale'?'Daily indicators: cached / old':indicators?.dailyStatus==='unavailable'?'Daily indicators unavailable':!indicators?'Indicator history unavailable':null].filter(Boolean).join(' · ')}</small>}
  </div>;
}
