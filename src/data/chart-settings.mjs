import {TIMEFRAMES} from './candles.js';
import {DRAWING_COLORS} from './drawings.mjs';
export const INDICATOR_KEYS=['ema','vwap','pdh','pdl','pdc','sma20','sma50','sma100','sma200'];
export const CHART_DEFAULTS={defaultTimeframe:'4h',enabled:Object.fromEntries(INDICATOR_KEYS.map(key=>[key,true])),showLevels:true,fitLevels:false,fitIndicators:false,drawingsVisible:true,drawingColor:DRAWING_COLORS[0],hoverValues:true};
export const INSTRUMENT_KEY=/^(?:QQQ|SPY|NQ|ES|VIX|VIX1D|DXY|US10Y|US2Y|NYMEX:CL1!|COMEX:GC1!|CME_MINI:RTY1!|(?:NASDAQ|NYSE|AMEX|CBOE|NYSEARCA|NYSEAMERICAN|BATS):[A-Z][A-Z0-9.]{0,9})$/;
export function readChartSettings(data){
  return data.chartSettings||{defaults:CHART_DEFAULTS,charts:{},intervals:{[data.preferences.focus==='custom'&&data.preferences.customSymbol?data.preferences.customSymbol:data.preferences.symbol]:data.preferences.timeframe}};
}
export function chartConfig(settings,scope){return {...settings.defaults,panel:null,timeRange:{start:0,end:100},priceRange:null,...settings.charts[scope]};}
const fail=()=>{throw new Error('Invalid saved chart settings.');};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
function defaults(value){
  if(!object(value)||!TIMEFRAMES.includes(value.defaultTimeframe)||!object(value.enabled)||!DRAWING_COLORS.includes(value.drawingColor))fail();
  const result={defaultTimeframe:value.defaultTimeframe,drawingColor:value.drawingColor,enabled:{}};
  for(const key of INDICATOR_KEYS){if(typeof value.enabled[key]!=='boolean')fail();result.enabled[key]=value.enabled[key];}
  for(const key of ['showLevels','fitLevels','fitIndicators','drawingsVisible','hoverValues']){if(typeof value[key]!=='boolean')fail();result[key]=value[key];}
  return result;
}
export function validateChartSettings(value){
  if(!object(value)||!object(value.charts)||!object(value.intervals)||Object.keys(value.charts).length>1000||Object.keys(value.intervals).length>300)fail();
  const result={defaults:defaults(value.defaults),charts:{},intervals:{}};
  for(const [key,frame] of Object.entries(value.intervals)){if(!INSTRUMENT_KEY.test(key)||!TIMEFRAMES.includes(frame)||(key==='US2Y'&&frame!=='D'))fail();result.intervals[key]=frame;}
  for(const [scope,config] of Object.entries(value.charts)){
    const [symbol,frame,...rest]=scope.split('|');if(rest.length||!INSTRUMENT_KEY.test(symbol)||!TIMEFRAMES.includes(frame)||(symbol==='US2Y'&&frame!=='D'))fail();
    const normalized=defaults(config),view=config.timeRange,price=config.priceRange;
    if(![null,'indicators','levels','drawings','navigation'].includes(config.panel)||!object(view)||![view.start,view.end].every(Number.isFinite)||view.start<0||view.end>100||view.end<=view.start)fail();
    if(price!==null&&(!object(price)||![price.min,price.max].every(Number.isFinite)||price.min>=price.max||Math.abs(price.min)>1e12||Math.abs(price.max)>1e12))fail();
    result.charts[scope]={...normalized,panel:config.panel,timeRange:{start:view.start,end:view.end},priceRange:price?{min:price.min,max:price.max}:null};
  }
  return result;
}
