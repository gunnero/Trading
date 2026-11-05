import {useEffect,useRef} from 'react';
import {init,use} from 'echarts/core';
import {BarChart,LineChart,ScatterChart} from 'echarts/charts';
import {GridComponent,TooltipComponent} from 'echarts/components';
import {CanvasRenderer} from 'echarts/renderers';
use([BarChart,LineChart,ScatterChart,GridComponent,TooltipComponent,CanvasRenderer]);

function useSentimentChart(option){
 const element=useRef(null),instance=useRef(null);
 useEffect(()=>{
  const chart=init(element.current,null,{renderer:'canvas',devicePixelRatio:Math.min(window.devicePixelRatio||1,2)});instance.current=chart;
  let frame;const observer=new ResizeObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(!chart.isDisposed())chart.resize();});});observer.observe(element.current);
  return()=>{observer.disconnect();cancelAnimationFrame(frame);chart.dispose();instance.current=null;};
 },[]);
 useEffect(()=>{instance.current?.setOption(option,{notMerge:true});},[option]);
 return element;
}
const textStyle={fontFamily:'Inter, sans-serif',color:'#6f6483'};
export function SentimentGauge({score,rating}){
 const ref=useSentimentChart({animation:false,textStyle,grid:{left:12,right:12,top:18,bottom:28},xAxis:{type:'value',min:0,max:100,interval:20,axisLine:{show:false},axisTick:{show:true,lineStyle:{color:'#a99bbf'}},axisLabel:{color:'#6f6483',fontSize:12},splitLine:{show:false}},yAxis:{type:'category',data:['Score'],show:false},series:[...['#f7687d','#f2b0bd','#f6d18b','#b3dfb4','#67c98e'].map((color,i)=>({type:'bar',stack:'scale',data:[20],barWidth:24,silent:true,itemStyle:{color,borderRadius:i===0?[12,0,0,12]:i===4?[0,12,12,0]:0}})),{type:'scatter',data:[[score,0]],symbol:'triangle',symbolRotate:180,symbolSize:13,symbolOffset:[0,-24],itemStyle:{color:'#251b3a'},silent:true}]});
 return <div className="sentiment-gauge"><div ref={ref} className="sentiment-gauge-chart" role="meter" aria-label="Fear and Greed score" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score} aria-valuetext={`${score.toFixed(2)} out of 100, ${rating}`}/><div className="sentiment-gauge-labels" aria-hidden="true"><span>Fear</span><span>Neutral</span><span>Greed</span></div></div>;
}
const tickDate=new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',day:'numeric',month:'short'}),fullDate=new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',day:'numeric',month:'short',year:'numeric'});
export function SentimentHistoryChart({points,selected}){
 const active=selected??points.length-1;
 const ref=useSentimentChart({animation:false,useUTC:true,textStyle,grid:{left:43,right:18,top:14,bottom:36},tooltip:{trigger:'axis',confine:true,backgroundColor:'#faf8ff',borderColor:'#ddd8ea',textStyle:{color:'#251b3a',fontSize:12},formatter:params=>{const p=points[params[0]?.dataIndex];return p?`${fullDate.format(new Date(p.date+'T12:00:00Z'))}<br/>${p.score.toFixed(2)} / 100 · ${p.rating}`:'';}},xAxis:{type:'time',min:Date.parse(points[0].date),max:Date.parse(points.at(-1).date)+(points.length===1?86400000:0),splitNumber:5,axisLine:{lineStyle:{color:'#ccc3df'}},axisTick:{show:false},axisLabel:{color:'#6f6483',fontSize:12,hideOverlap:true,showMinLabel:true,showMaxLabel:true,formatter:value=>tickDate.format(value)},splitLine:{show:true,lineStyle:{color:'#e2dbef'}}},yAxis:{type:'value',min:0,max:100,interval:10,axisLabel:{fontSize:12,color:'#6f6483'},splitLine:{lineStyle:{color:'#e2dbef'}}},series:[{type:'line',data:points.map(p=>[Date.parse(p.date),p.score]),smooth:false,showSymbol:true,symbol:'circle',symbolSize:(_,params)=>params.dataIndex===active?7:0,lineStyle:{color:'#7934f5',width:2},itemStyle:{color:'#7934f5'},areaStyle:{color:'#7934f5',opacity:.055},connectNulls:false}]});
 return <div ref={ref} className="sentiment-history-chart" role="img" data-point-count={points.length} aria-label={`CNN sentiment history, ${fullDate.format(new Date(points[0].date))} to ${fullDate.format(new Date(points.at(-1).date))}. Expand Explore observations for keyboard readings.`}/>;
}
