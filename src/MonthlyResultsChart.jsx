import {useEffect,useRef} from 'react';
import {init,use} from 'echarts/core';
import {BarChart} from 'echarts/charts';
import {GridComponent,TooltipComponent} from 'echarts/components';
import {CanvasRenderer} from 'echarts/renderers';

use([BarChart,GridComponent,TooltipComponent,CanvasRenderer]);

export default function MonthlyResultsChart({weeks,currency}){
  const el=useRef(null);
  useEffect(()=>{
    const node=el.current,chart=init(node);
    const money=new Intl.NumberFormat('en-US',{style:'currency',currency,signDisplay:'exceptZero'});
    const compact=new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1});
    function draw(){
      if(!node.clientWidth)return;
      chart.resize();
      const narrow=node.clientWidth<480;
      const month=new Intl.DateTimeFormat('en-US',{month:'short',timeZone:'UTC'}).format(new Date(weeks[0].from+'T12:00:00Z'));
      const dates=weeks.map((w,i)=>(narrow?'':month+' ')+Number(w.from.slice(8))+'–'+Number(w.to.slice(8))+'\nWeek '+(i+1));
      const label=p=>Math.abs(p.value)>=10000||narrow?compact.format(p.value):money.format(p.value);
      chart.setOption({animation:false,textStyle:{fontFamily:'Inter, sans-serif'},grid:{left:48,right:12,top:27,bottom:43},
        tooltip:{trigger:'axis',confine:true,renderMode:'richText',formatter:items=>{
          const w=weeks[items[0]?.dataIndex];return w?w.from+' – '+w.to+'\n'+(Number.isFinite(w.amount)?money.format(w.amount):'Unavailable'):'';
        }},
        xAxis:{type:'category',data:dates,name:'',axisTick:{show:false},axisLabel:{interval:0,fontSize:11,lineHeight:15,color:'#514663'},axisLine:{onZero:false,lineStyle:{color:'#bcb1cf'}}},
        yAxis:{type:'value',splitNumber:4,axisLabel:{fontSize:11,color:'#514663',formatter:v=>compact.format(v)},splitLine:{lineStyle:{color:'#ded7ec'}}},
        series:[{type:'bar',barMaxWidth:86,barWidth:'64%',itemStyle:{color:'#8150e6'},label:{show:true,formatter:label,color:'#30233f',fontWeight:600,fontSize:narrow?10:12},
          data:weeks.map(w=>({value:w.amount,label:{position:w.amount<0?'bottom':'top'}}))}]});
    }
    draw();const observer=new ResizeObserver(draw);observer.observe(node);
    return()=>{observer.disconnect();chart.dispose();};
  },[weeks,currency]);
  return <figure className="mr-figure"><div className="mr-chart" ref={el} role="img" aria-label={'Recorded realized results by week in '+currency}/>
    <figcaption className="mr-sr">{weeks.map(w=><span key={w.from}>{w.from} – {w.to}: {w.amount===null?'Unavailable':w.amount.toFixed(2)+' '+currency}. </span>)}</figcaption></figure>;
}
