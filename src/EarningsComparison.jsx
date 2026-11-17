import {useEffect,useRef} from 'react';
import {earningsNumber} from './data/earnings.mjs';
import {formatEarningsRevenue} from './data/earnings-revenue.mjs';

const valueFormat = new Intl.NumberFormat('en-US',{notation:'compact', maximumFractionDigits:2});
const format = value => value === null ? '—' : valueFormat.format(value);

function comparisonOptions(eps, figures, currency) {
  const panels = [{name:'EPS', values:eps}];
  if (figures.some(Number.isFinite)) panels.push({name:`Revenue (${currency})`, values:figures});
  return {
    animation:false,
    color:['#713bdd','#cbb5f4'],
    textStyle:{fontFamily:'Inter',color:'#251b3a'},
    legend:{top:0,itemWidth:8,itemHeight:8,textStyle:{fontSize:10,color:'#6f6483'}},
    grid:panels.map((_,i)=>({left:i ? '54%' : 6, right:panels.length===2 && !i ? '54%' : 12, top:24, bottom:4, containLabel:true})),
    tooltip:{trigger:'axis',confine:true,valueFormatter:format},
    xAxis:panels.map(({name},i)=>({type:'category',gridIndex:i,data:[name],axisTick:{show:false},axisLine:{lineStyle:{color:'#ddd8ea'}},axisLabel:{fontSize:10}})),
    yAxis:panels.map((_,i)=>({type:'value',gridIndex:i,splitNumber:3,axisLabel:{fontSize:9,color:'#6f6483',formatter:format},splitLine:{lineStyle:{color:'#e8e1f2'}}})),
    series:panels.flatMap(({values},i)=>values.flatMap((value,j)=>value===null ? [] : [{
      name:j?'Estimated':'Actual',type:'bar',xAxisIndex:i,yAxisIndex:i,barMaxWidth:42,data:[value],
      itemStyle:{color:j?'#cbb5f4':'#713bdd'},label:{show:true,position:value<0?'bottom':'top',fontSize:10,color:'#251b3a',formatter:({value})=>format(value)}
    }]))
  };
}

export default function EarningsComparison({event,revenue}) {
  const element=useRef(null);
  const actual=earningsNumber(event.epsActual), estimate=earningsNumber(event.epsForecast);
  const revenueActual=revenue.actual?.amount??null, revenueEstimate=revenue.estimate?.amount??null;
  const currency=revenue.actual?.currency||revenue.estimate?.currency;
  useEffect(()=>{
    let active=true,chart,observer;
    import('./earnings-chart.mjs').then(core=>{
      if(!active)return;
      chart=core.init(element.current);
      chart.setOption(comparisonOptions([actual,estimate],[revenueActual,revenueEstimate],currency));
      observer=new ResizeObserver(()=>chart.resize());
      observer.observe(element.current);
    }).catch(()=>{}); // Exact accessible values remain in the adjacent summary.
    return()=>{active=false;observer?.disconnect();chart?.dispose();};
  },[actual,estimate,revenueActual,revenueEstimate,currency]);
  const revenueLabel=currency ? `. Revenue: actual ${formatEarningsRevenue(revenue.actual)}, estimated ${formatEarningsRevenue(revenue.estimate)}` : '';
  return <div ref={element} className="earnings-comparison" role="img" aria-label={`EPS comparison for ${event.symbol}: actual ${event.epsActual??'not supplied'}, estimated ${event.epsForecast??'not supplied'}${revenueLabel}`}/>;
}
