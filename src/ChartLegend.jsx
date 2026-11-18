import {INDICATORS} from './ChartIndicators';
import {useSavedChart} from './ChartSettings';

export function ChartLegend({scope,indicators}){
 const {config}=useSavedChart(scope);
 const readings=INDICATORS.filter(item=>['ema','vwap'].includes(item.key)&&config.enabled[item.key])
  .flatMap(item=>item.series.map(id=>({id,color:item.color,value:indicators?.series?.[id]?.at(-1)})))
  .filter(reading=>Number.isFinite(reading.value));
 if(!readings.length)return null;
 return <dl className="company-chart-legend" aria-label="Latest overlay readings">{readings.map(({id,color,value})=>
  <div key={id}><dt><i style={{borderColor:color}} aria-hidden="true"/>{id==='ema9'?'EMA 9':id==='ema21'?'EMA 21':'VWAP'}</dt><dd>{value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</dd></div>
 )}</dl>;
}
