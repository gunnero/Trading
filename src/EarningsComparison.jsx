import {useChartPalette} from './appearance';
import {useEffect,useRef} from 'react';
import {earningsNumber} from './data/earnings.mjs';
import {formatEarningsRevenue} from './data/earnings-revenue.mjs';

const valueFormat = new Intl.NumberFormat('en-US',{notation:'compact', maximumFractionDigits:2});
const format = value => value === null ? '—' : valueFormat.format(value);

function comparisonOptions(eps, figures, currency, palette) {
  const panels = [{name:'EPS', values:eps}];
  if (figures.some(Number.isFinite)) panels.push({name:`Revenue (${currency})`, values:figures});
  return {
    animation:false,
    color:[palette.primary,palette.chartEstimate],
    textStyle:{fontFamily:'Inter',color:palette.text},
    legend:{top:0,itemWidth:8,itemHeight:8,textStyle:{fontSize:10,color:palette.muted}},
    grid:panels.map((_,i)=>({left:i ? '54%' : 6, right:panels.length===2 && !i ? '54%' : 12, top:24, bottom:4, containLabel:true})),
    tooltip:{backgroundColor:palette.panel,borderColor:palette.border,textStyle:{color:palette.text},trigger:'axis',confine:true,valueFormatter:format},
    xAxis:panels.map(({name},i)=>({type:'category',gridIndex:i,data:[name],axisTick:{show:false},axisLine:{lineStyle:{color:palette.border}},axisLabel:{fontSize:10,color:palette.muted}})),
    yAxis:panels.map((_,i)=>({type:'value',gridIndex:i,splitNumber:3,axisLabel:{fontSize:9,color:palette.muted,formatter:format},splitLine:{lineStyle:{color:palette.chartGrid}}})),
    series:panels.flatMap(({values},i)=>values.flatMap((value,j)=>value===null ? [] : [{
      name:j?'Estimated':'Actual',type:'bar',xAxisIndex:i,yAxisIndex:i,barMaxWidth:42,data:[value],
      itemStyle:{color:j?palette.chartEstimate:palette.primary},label:{show:true,position:value<0?'bottom':'top',fontSize:10,color:palette.text,formatter:({value})=>format(value)}
    }]))
  };
}

export default function EarningsComparison({event,revenue}) {
  const palette = useChartPalette();
  const element=useRef(null);
  const actual=earningsNumber(event.epsActual), estimate=earningsNumber(event.epsForecast);
  const revenueActual=revenue.actual?.amount??null, revenueEstimate=revenue.estimate?.amount??null;
  const currency=revenue.actual?.currency||revenue.estimate?.currency;
  useEffect(()=>{
    let active=true,chart,observer;
    import('./earnings-chart.mjs').then(core=>{
      if(!active)return;
      chart=core.init(element.current);
      chart.setOption(comparisonOptions([actual,estimate],[revenueActual,revenueEstimate],currency,palette));
      observer=new ResizeObserver(()=>chart.resize());
      observer.observe(element.current);
    }).catch(()=>{}); // Exact accessible values remain in the adjacent summary.
    return()=>{active=false;observer?.disconnect();chart?.dispose();};
  },[actual,estimate,revenueActual,revenueEstimate,currency, palette]);
  const revenueLabel=currency ? `. Revenue: actual ${formatEarningsRevenue(revenue.actual)}, estimated ${formatEarningsRevenue(revenue.estimate)}` : '';
  return <div ref={element} className="earnings-comparison" role="img" aria-label={`EPS comparison for ${event.symbol}: actual ${event.epsActual??'not supplied'}, estimated ${event.epsForecast??'not supplied'}${revenueLabel}`}/>;
}
