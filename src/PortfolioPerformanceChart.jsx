import {useChartPalette} from './appearance';
import {useEffect,useRef,useState} from 'react';
import {init,use} from 'echarts/core';
import {LineChart} from 'echarts/charts';
import {GridComponent,TooltipComponent} from 'echarts/components';
import {CanvasRenderer} from 'echarts/renderers';
import {useDisplayTime} from './DisplayTime';

use([LineChart,GridComponent,TooltipComponent,CanvasRenderer]);

export default function PortfolioPerformanceChart({comparison,benchmark}){
  const palette = useChartPalette();
  const {clockStamp,clockTime,clockDate,briefingTime,displayDay}=useDisplayTime();
  const element=useRef(null),chart=useRef(null);
  const [observation,setObservation]=useState(null);
  const {points,start,end}=comparison;
  const shortDate=at=>briefingTime(at,{hour:undefined,minute:undefined});
  const index=Math.min(observation??points.length-1,points.length-1);
  const selected=points[index];

  useEffect(()=>{
    const node=element.current,graph=init(node);
    chart.current=graph;
    const colors=[palette.primary,palette.muted],gridColor=palette.chartGrid;
    const date=at=>briefingTime(at,{hour:undefined,minute:undefined});
    const withinDay=displayDay(start)===displayDay(end);
    const intraday=end-start<2*86400000;
    const xAxis=(width)=>{
      const splits=Math.min(points.length-1,Math.max(2,Math.min(10,Math.floor((width-96)/89))));
      return {type:'value',min:start,max:end,interval:(end-start)/splits,axisTick:{show:true},
        axisLine:{lineStyle:{color:palette.chartAxis}},splitLine:{show:true,lineStyle:{color:gridColor}},
        axisLabel:{color:palette.text,fontSize:12,lineHeight:15,hideOverlap:true,formatter:at=>withinDay?clockTime(at):date(at)+'\n'+(intraday?clockTime(at):clockDate(at).split(',')[0])},
        axisPointer:{label:{formatter:p=>clockStamp(p.value)}}};
    };
    graph.setOption({
      animation:false,grid:{left:52,right:67,top:14,bottom:41},
      textStyle:{fontFamily:'Inter, sans-serif'},tooltip:{backgroundColor:palette.panel,borderColor:palette.border,textStyle:{color:palette.text},trigger:'axis',confine:true,renderMode:'richText',
        formatter:items=>[clockStamp(items[0].value[0]),...items.map(p=>p.seriesName+'   '+p.value[1].toFixed(2))].join('\n')},
      xAxis:xAxis(node.clientWidth),
      yAxis:{type:'value',scale:true,splitNumber:7,boundaryGap:['7%','12%'],axisLabel:{color:palette.text,fontSize:12},
        splitLine:{lineStyle:{color:gridColor}},axisLine:{show:true,lineStyle:{color:palette.chartAxis}}},
      series:['value','benchmark'].map((field,i)=>({
        name:i?benchmark:'Account',type:'line',symbol:'circle',symbolSize:(_,p)=>p.dataIndex===points.length-1?7:0,
        data:points.map(p=>[p.at,p[field]]),itemStyle:{color:colors[i]},
        lineStyle:{color:colors[i],width:i?1.8:2.4,type:i?'dashed':'solid'},
        endLabel:{show:true,distance:7,color:palette.onPrimary,backgroundColor:colors[i],borderRadius:3,padding:[3,5],
          formatter:p=>p.value[1].toFixed(1)},labelLayout:{moveOverlap:'shiftY'},
      })),
    });
    const observer=new ResizeObserver(()=>{if(node.clientWidth){graph.resize();graph.setOption({xAxis:xAxis(node.clientWidth)});}});
    observer.observe(node);
    return()=>{observer.disconnect();chart.current=null;graph.dispose();};
  },[points,start,end,benchmark,briefingTime,clockDate,clockStamp,clockTime,displayDay, palette]);

  function inspect(position){
    setObservation(position);
    chart.current?.dispatchAction({type:'showTip',seriesIndex:0,dataIndex:position});
  }
  return <figure className="perf-comparison">
    <div className="perf-chart-card"><div className="perf-chart-key">
      <span><i aria-hidden="true"/>Account (indexed, 100 = {shortDate(start)})</span>
      <span><i aria-hidden="true"/>{benchmark} (indexed, 100 = {shortDate(start)})</span>
      <span className="perf-shared">Shared observation period · {displayDay(start).slice(0,4)===displayDay(end).slice(0,4)?shortDate(start):clockDate(start).split(', ').pop()} – {clockDate(end).split(', ').pop()}</span>
    </div><div className="perf-canvas" ref={element} role="img" aria-label={'Account and '+benchmark+' return index, starting at 100. Latest values '+points.at(-1).value.toFixed(2)+' and '+points.at(-1).benchmark.toFixed(2)+'.'}/>
    <label className="perf-inspector"><span>{clockStamp(selected.at)} · Account {selected.value.toFixed(2)} · {benchmark} {selected.benchmark.toFixed(2)}</span>
      <input aria-label="Comparison observation" aria-valuetext={clockStamp(selected.at)+', Account '+selected.value.toFixed(2)+', '+benchmark+' '+selected.benchmark.toFixed(2)} type="range" min="0" max={points.length-1} value={index}
        onFocus={()=>inspect(index)} onBlur={()=>chart.current?.dispatchAction({type:'hideTip'})} onChange={e=>inspect(Number(e.target.value))}/></label></div>
    <figcaption><span>Account · cash-flow-adjusted estimate</span><span>{benchmark} · Yahoo Finance adjusted daily closes</span></figcaption>
  </figure>;
}
