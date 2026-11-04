import {useEffect,useRef} from 'react';
import {earningsNumber} from './data/earnings.mjs';

// Both bars use the selected Nasdaq report's EPS basis and fiscal period.
export default function EarningsComparison({event}){
 const element=useRef(null),actual=earningsNumber(event.epsActual),estimate=earningsNumber(event.epsForecast);
 useEffect(()=>{
  let active=true,chart,observer;
  import('./earnings-chart.mjs').then(core=>{
   if(!active)return;
   chart=core.init(element.current);
   chart.setOption({animation:false,color:['#713bdd','#cbb5f4'],textStyle:{fontFamily:'Inter',color:'#251b3a'},legend:{top:0,itemWidth:8,itemHeight:8,textStyle:{fontSize:10,color:'#6f6483'}},grid:{left:38,right:12,top:34,bottom:30},tooltip:{trigger:'axis',confine:true},xAxis:{type:'category',data:['EPS'],axisTick:{show:false},axisLine:{lineStyle:{color:'#ddd8ea'}},axisLabel:{fontSize:10}},yAxis:{type:'value',splitNumber:4,axisLabel:{fontSize:9,color:'#6f6483'},splitLine:{lineStyle:{color:'#e8e1f2'}}},series:[{name:'Actual',type:'bar',barMaxWidth:42,data:[actual],label:{show:true,position:'top',fontSize:10,color:'#251b3a'}},{name:'Estimated',type:'bar',barMaxWidth:42,data:[estimate],label:{show:true,position:'top',fontSize:10,color:'#251b3a'}}]});
   observer=new ResizeObserver(()=>chart.resize());observer.observe(element.current);
  }).catch(()=>{}); // Exact accessible values remain in the adjacent summary.
  return()=>{active=false;observer?.disconnect();chart?.dispose();};
 },[actual,estimate]);
 return <div ref={element} className="earnings-comparison" role="img" aria-label={`EPS comparison for ${event.symbol}: actual ${event.epsActual??'not supplied'}, estimated ${event.epsForecast??'not supplied'}`}/>;
}
