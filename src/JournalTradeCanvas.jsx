import {useEffect,useRef,useState} from 'react';
import * as echarts from 'echarts/core';
import {CandlestickChart} from 'echarts/charts';
import {GridComponent,TooltipComponent,DataZoomComponent,MarkLineComponent,MarkAreaComponent} from 'echarts/components';
import {CanvasRenderer} from 'echarts/renderers';
import {Plus,Minus,ArrowsOutSimple,Hand} from '@phosphor-icons/react';
import {localStamp,money} from './data/journal.mjs';
import {tradeViewport} from './data/journal-chart.mjs';
echarts.use([CandlestickChart,GridComponent,TooltipComponent,DataZoomComponent,MarkLineComponent,MarkAreaComponent,CanvasRenderer]);
const clock=value=>localStamp(value).slice(11,16);
export default function JournalTradeCanvas({trade,candles,markers,timeframe}){
  const node=useRef(),engine=useRef(),[interact,setInteract]=useState(()=>matchMedia('(pointer:fine)').matches);
  const home=tradeViewport(trade,candles,timeframe);
  useEffect(()=>{
    const chart=echarts.init(node.current,null,{renderer:'canvas',devicePixelRatio:Math.min(devicePixelRatio||1,2)});engine.current=chart;
    const entry=markers.find(m=>m.kind==='entry'&&m.available),exit=markers.find(m=>m.kind==='exit'&&m.available);
    chart.setOption({animation:false,textStyle:{fontFamily:'Inter',color:'#9aafb9'},grid:{left:16,right:65,top:38,bottom:90},
      tooltip:{trigger:'axis',renderMode:'richText',confine:true,axisPointer:{type:'cross',label:{formatter:p=>p.axisDimension==='x'?clock(p.value):money(p.value)}},formatter:rows=>{const row=rows.find(r=>r.seriesType==='candlestick');if(!row)return '';const [time,o,c,l,h]=row.data;const partial=candles[row.dataIndex]?.partial;return `${trade.symbol} · ${localStamp(time).replace('T',' · ')} Skopje${partial?' · Partial bar':''}\nUnderlying open ${money(o)} · close ${money(c)}\nLow ${money(l)} · high ${money(h)}`;}},
      xAxis:{type:'time',min:candles[0].timestamp*1000,max:candles.at(-1).end*1000,axisLine:{lineStyle:{color:'#31474f'}},axisLabel:{color:'#9aafb9',fontSize:10,hideOverlap:true,formatter:value=>localStamp(candles[0].timestamp*1000).slice(0,10)===localStamp(candles.at(-1).timestamp*1000).slice(0,10)?clock(value):`${localStamp(value).slice(5,10)}\n${clock(value)}`},splitLine:{show:true,lineStyle:{color:'#20343b'}}},
      yAxis:{type:'value',position:'right',scale:true,axisLabel:{color:'#9aafb9',fontSize:10,formatter:value=>value.toFixed(2)},splitLine:{lineStyle:{color:'#263b43'}}},
      dataZoom:[{type:'inside',xAxisIndex:0,startValue:home[0],endValue:home[1],filterMode:'filter',zoomOnMouseWheel:interact,moveOnMouseMove:interact,moveOnMouseWheel:false},{type:'slider',xAxisIndex:0,bottom:16,height:24,startValue:home[0],endValue:home[1],showDetail:false,borderColor:'#31474f',fillerColor:'#2ac9ad22',dataBackground:{lineStyle:{color:'#50757e'},areaStyle:{color:'#263b43'}},handleStyle:{color:'#91abb5'}}],
      series:[{type:'candlestick',name:'Underlying price',encode:{x:0,y:[1,2,3,4]},data:candles.map(c=>[c.timestamp*1000,...c.ohlc]),barMaxWidth:12,itemStyle:{color:'#2ac9ad',color0:'#ef777c',borderColor:'#2ac9ad',borderColor0:'#ef777c'},
        markLine:{silent:true,symbol:['none','none'],animation:false,data:markers.filter(m=>m.available).map(m=>({name:m.kind==='entry'?'Entry':'Exit',xAxis:m.time*1000,lineStyle:{color:m.kind==='entry'?'#2ac9ad':'#f3c34d',type:'dashed',width:2},label:{show:true,formatter:m.kind==='entry'?'ENTRY':'EXIT',position:m.kind==='entry'?'insideStartTop':'insideEndTop',color:m.kind==='entry'?'#2ac9ad':'#f3c34d',backgroundColor:'#0e191e',padding:[4,5]}}))},
        markArea:{silent:true,itemStyle:{color:'#8ab2bf0c'},data:entry&&exit?[[{xAxis:entry.time*1000},{xAxis:exit.time*1000}]]:[]}}]});
    let frame;const observer=new ResizeObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>!chart.isDisposed()&&chart.resize());});observer.observe(node.current);
    return()=>{cancelAnimationFrame(frame);observer.disconnect();chart.dispose();engine.current=null;};
  },[candles,trade,timeframe]);
  useEffect(()=>{engine.current?.setOption({dataZoom:[{type:'inside',zoomOnMouseWheel:interact,moveOnMouseMove:interact}]});},[interact]);
  const zoom=factor=>{const chart=engine.current;if(!chart)return;const state=chart.getOption().dataZoom[0],middle=(state.start+state.end)/2,half=Math.max(.25,Math.min(50,(state.end-state.start)*factor/2));chart.dispatchAction({type:'dataZoom',start:Math.max(0,middle-half),end:Math.min(100,middle+half)});};
  return <div className="journal-trade-canvas-wrap"><div className="journal-trade-canvas" data-interact={interact} ref={node} role="img" aria-label={`${trade.symbol} ${timeframe} underlying candlesticks. ${markers.map(m=>`${m.kind} at ${localStamp(m.time*1000)} Skopje${m.available?' marked':' has no covering candle'}`).join('. ')}`} style={{touchAction:interact?'none':'pan-y'}}/>
    <div className="journal-trade-chart-tools"><span><i className="entry"/>Entry <i className="exit"/>Exit · execution times</span><div><button type="button" className="icon-button" title="Zoom in" aria-label="Zoom trade chart in" onClick={()=>zoom(.65)}><Plus size={17}/></button><button type="button" className="icon-button" title="Zoom out" aria-label="Zoom trade chart out" onClick={()=>zoom(1.5)}><Minus size={17}/></button><button type="button" className="text-button" onClick={()=>engine.current?.dispatchAction({type:'dataZoom',startValue:home[0],endValue:home[1]})}><ArrowsOutSimple size={16}/>Fit trade</button><button type="button" className="text-button" aria-pressed={interact} onClick={()=>setInteract(v=>!v)}><Hand size={16}/>{interact?'Done interacting':'Interact'}</button></div></div>
  </div>;
}
