import {useEffect,useRef} from 'react';
import * as echarts from 'echarts/core';
import {LineChart} from 'echarts/charts';
import {GridComponent,TooltipComponent} from 'echarts/components';
import {CanvasRenderer} from 'echarts/renderers';
import {useDisplayTime} from './DisplayTime';
import {money} from './data/journal.mjs';

echarts.use([LineChart,GridComponent,TooltipComponent,CanvasRenderer]);
export default function JournalCurve({series,basis}){
  const {clockStamp,journalStamp,displayDay,clockTime,zoneLabel}=useDisplayTime();
  const ref=useRef(),field=basis==='net'?'cumulativeNet':'cumulative';
  useEffect(()=>{
    const chart=echarts.init(ref.current,null,{renderer:'canvas',devicePixelRatio:Math.min(devicePixelRatio||1,2)});
    const gridLine={lineStyle:{color:'#e4deee'}};
    const oneDay=displayDay(series[0].at)===displayDay(series.at(-1).at);
    const axisLabel=d=>d==='Start'?d:oneDay?clockTime(d):clockStamp(d).split(' · ')[0];
    chart.setOption({
      animation:false,grid:{left:5,right:12,top:14,bottom:8,containLabel:true},
      textStyle:{fontFamily:'Inter',color:'#594e6e'},
      tooltip:{trigger:'axis',renderMode:'richText',formatter:rows=>(rows[0].axisValue==='Start'?'Start':journalStamp(rows[0].axisValue)+' '+zoneLabel)+'\n'+money(rows[0].value)+' '+basis},
      xAxis:{type:'category',boundaryGap:false,data:['Start',...series.map(d=>d.at)],
        axisLine:{lineStyle:{color:'#cfc6dd'}},axisTick:{show:false},splitLine:{...gridLine,show:true},
        axisLabel:{hideOverlap:true,formatter:axisLabel}},
      yAxis:{type:'value',splitLine:gridLine,axisLabel:{formatter:v=>Math.abs(v)>=1000?(v/1000)+'k':String(v)}},
      series:[{type:'line',step:'end',data:[0,...series.map(d=>d[field])],showSymbol:true,symbol:'emptyCircle',
        symbolSize:5,lineStyle:{width:2,color:'#713bdd'},itemStyle:{color:'#713bdd'},areaStyle:{color:'#9864ed',opacity:.13}}]
    });
    const resize=new ResizeObserver(()=>chart.resize());
    resize.observe(ref.current);
    return ()=>{resize.disconnect();chart.dispose();};
  },[series,basis,field,clockStamp,journalStamp,displayDay,clockTime,zoneLabel]);
  return <div ref={ref} className="journal-performance-chart" role="img"
    aria-label={'Cumulative '+basis+' P/L from zero. '+series.length+' exit times, ending at '+money(series.at(-1)[field])}/>;
}
