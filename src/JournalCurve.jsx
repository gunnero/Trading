import {useEffect,useRef} from 'react';
import * as echarts from 'echarts/core';
import {LineChart} from 'echarts/charts';
import {GridComponent,TooltipComponent} from 'echarts/components';
import {CanvasRenderer} from 'echarts/renderers';
import {money} from './data/journal.mjs';
echarts.use([LineChart,GridComponent,TooltipComponent,CanvasRenderer]);
export default function JournalCurve({series}){
  const ref=useRef();
  useEffect(()=>{
    const chart=echarts.init(ref.current,null,{renderer:'canvas',devicePixelRatio:Math.min(devicePixelRatio||1,2)});
    // Each daily point uses that day's final cumulative realized P/L; include an explicit baseline.
    chart.setOption({animation:false,grid:{left:66,right:24,top:22,bottom:42},textStyle:{fontFamily:'Inter',color:'#9aafb9'},tooltip:{trigger:'axis',renderMode:'richText',formatter:rows=>`${rows[0].axisValue}\n${money(rows[0].value)} gross`},xAxis:{type:'category',boundaryGap:false,data:['Start',...series.map(d=>d.date.slice(5))],axisLine:{lineStyle:{color:'#26383f'}},axisLabel:{fontSize:10,color:'#9aafb9'},axisTick:{show:false}},yAxis:{type:'value',scale:false,axisLabel:{fontSize:10,color:'#9aafb9',formatter:v=>Math.abs(v)>=1000?`${v<0?'-':''}$${(Math.abs(v)/1000).toFixed(1)}k`:`$${v}`},splitLine:{lineStyle:{color:'#26383f'}},axisLine:{show:false}},series:[{type:'line',data:[0,...series.map(d=>d.cumulative)],showSymbol:true,symbolSize:6,lineStyle:{width:2,color:series.at(-1).cumulative<0?'#ef777c':'#2ac9ad'},itemStyle:{color:series.at(-1).cumulative<0?'#ef777c':'#2ac9ad'},areaStyle:{color:series.at(-1).cumulative<0?'#ef777c':'#2ac9ad',opacity:.07}}]});
    let frame;const resize=new ResizeObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(!chart.isDisposed())chart.resize();});});resize.observe(ref.current);return()=>{cancelAnimationFrame(frame);resize.disconnect();chart.dispose();};
  },[series]);
  return <div ref={ref} className="journal-performance-chart" role="img" aria-label={`Cumulative gross P/L: starts at zero; ${series.map(d=>`${d.date}: ${money(d.cumulative)}`).join('; ')}`}/>;
}
