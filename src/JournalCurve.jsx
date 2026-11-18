import {useChartPalette} from './appearance';
import {useEffect,useRef} from 'react';
import * as echarts from 'echarts/core';
import {LineChart} from 'echarts/charts';
import {GridComponent,TooltipComponent} from 'echarts/components';
import {CanvasRenderer} from 'echarts/renderers';
import {useDisplayTime} from './DisplayTime';
import {money} from './data/journal.mjs';

echarts.use([LineChart,GridComponent,TooltipComponent,CanvasRenderer]);
export default function JournalCurve({series,basis}){
  const palette = useChartPalette();
  const {clockStamp,journalStamp,displayDay,clockTime,zoneLabel}=useDisplayTime();
  const ref=useRef(),field=basis==='net'?'cumulativeNet':'cumulative';
  useEffect(()=>{
    const chart=echarts.init(ref.current,null,{renderer:'canvas',devicePixelRatio:Math.min(devicePixelRatio||1,2)});
    const gridLine={lineStyle:{color:palette.chartGrid}};
    const oneDay=displayDay(series[0].at)===displayDay(series.at(-1).at);
    const axisLabel=d=>d==='Start'?d:oneDay?clockTime(d):clockStamp(d).split(' · ')[0];
    chart.setOption({
      animation:false,grid:{left:5,right:12,top:14,bottom:8,containLabel:true},
      textStyle:{fontFamily:'Inter',color:palette.muted},
      tooltip:{backgroundColor:palette.panel,borderColor:palette.border,textStyle:{color:palette.text},trigger:'axis',renderMode:'richText',formatter:rows=>(rows[0].axisValue==='Start'?'Start':journalStamp(rows[0].axisValue)+' '+zoneLabel)+'\n'+money(rows[0].value)+' '+basis},
      xAxis:{type:'category',boundaryGap:false,data:['Start',...series.map(d=>d.at)],
        axisLine:{lineStyle:{color:palette.chartAxis}},axisTick:{show:false},splitLine:{...gridLine,show:true},
        axisLabel:{color:palette.muted,hideOverlap:true,formatter:axisLabel}},
      yAxis:{type:'value',splitLine:gridLine,axisLabel:{color:palette.muted,formatter:v=>Math.abs(v)>=1000?(v/1000)+'k':String(v)}},
      series:[{type:'line',step:'end',data:[0,...series.map(d=>d[field])],showSymbol:true,symbol:'emptyCircle',
        symbolSize:5,lineStyle:{width:2,color:palette.primary},itemStyle:{color:palette.primary},areaStyle:{color:palette.primary,opacity:.13}}]
    });
    const resize=new ResizeObserver(()=>chart.resize());
    resize.observe(ref.current);
    return ()=>{resize.disconnect();chart.dispose();};
  },[series,basis,field,clockStamp,journalStamp,displayDay,clockTime,zoneLabel, palette]);
  return <div ref={ref} className="journal-performance-chart" role="img"
    aria-label={'Cumulative '+basis+' P/L from zero. '+series.length+' exit times, ending at '+money(series.at(-1)[field])}/>;
}
