import {useDisplayTime} from './DisplayTime';
import {useEffect,useRef,useState} from 'react';
import * as echarts from 'echarts/core';
import {CandlestickChart,LineChart,CustomChart} from 'echarts/charts';
import {GridComponent,TooltipComponent,DataZoomComponent,MarkLineComponent,MarkAreaComponent} from 'echarts/components';
import {CanvasRenderer} from 'echarts/renderers';
import {Plus,Minus,ArrowsOutSimple,Hand} from '@phosphor-icons/react';
import {money} from './data/journal.mjs';
import {tradeViewport} from './data/journal-chart.mjs';
import {ribbonSegments} from './data/indicators.mjs';
echarts.use([CandlestickChart,LineChart,CustomChart,GridComponent,TooltipComponent,DataZoomComponent,MarkLineComponent,MarkAreaComponent,CanvasRenderer]);
const overlays=[['ema9','9 EMA','#b4b7c0'],['ema21','21 EMA','#979ca7'],['vwap','Session VWAP','#ffffff'],['pdh','Previous high','#4caf50'],['pdl','Previous low','#ef3e52'],['pdc','Previous close','#ffe333'],['sma20','20 SMA · 1D','#00bcd4'],['sma50','50 SMA · 1D','#ffe333'],['sma100','100 SMA · 1D','#00d882'],['sma200','200 SMA · 1D','#ef3e52']];
const finite=n=>typeof n==='number'&&Number.isFinite(n);
export default function JournalTradeCanvas({trade,candles,markers,timeframe,levels}){
  const {clockTime,journalStamp,zoneLabel,displayDay}=useDisplayTime();
  const node=useRef(),engine=useRef(),[interact,setInteract]=useState(()=>matchMedia('(pointer:fine)').matches);
  const [showIndicators,setShowIndicators]=useState(true),[showLevels,setShowLevels]=useState(true),viewport=useRef(null);
  const home=tradeViewport(trade,candles,timeframe);
  useEffect(()=>{
    const chart=echarts.init(node.current,null,{renderer:'canvas',devicePixelRatio:Math.min(devicePixelRatio||1,2)});engine.current=chart;
    const entry=markers.find(m=>m.kind==='entry'&&m.available),exit=markers.find(m=>m.kind==='exit'&&m.available);
    const startView=viewport.current||home;
    const priceRange=(from,to)=>{
      const visible=candles.filter(c=>c.end*1000>=from&&c.timestamp*1000<=to),rows=visible.length?visible:candles;
      const low=Math.min(...rows.map(c=>c.ohlc[2])),high=Math.max(...rows.map(c=>c.ohlc[3])),pad=Math.max((high-low)*.13,high*.0003);
      return {min:low-pad,max:high+pad};
    };
    const lines=showIndicators?overlays.map(([key,name,color])=>({type:'line',name,showSymbol:false,connectNulls:false,silent:true,z:3,lineStyle:{color,width:key==='vwap'?1.5:1,type:key.startsWith('pd')?'dotted':'solid'},encode:{x:0,y:1},data:candles.flatMap((c,i)=>[...(i&&candles[i-1].end!==c.timestamp||key==='vwap'&&i&&candles[i-1].start!==c.start?[[c.timestamp*1000,null]]:[]),[c.timestamp*1000,c.indicators[key]??null]])})):[];
    const segments=showIndicators?ribbonSegments(candles.map(c=>c.indicators.ema9),candles.map(c=>c.indicators.ema21)).filter(s=>candles[Math.floor(s.points[0][0])]?.end===candles[Math.ceil(s.points[1][0])]?.timestamp):[];
    const timestamp=index=>{const i=Math.floor(index),fraction=index-i;return (candles[i].timestamp+fraction*((candles[i+1]?.timestamp??candles[i].end)-candles[i].timestamp))*1000;};
    const ribbon={type:'custom',name:'EMA ribbon',silent:true,clip:true,z:1,data:segments.map((_,i)=>[i]),renderItem:(params,api)=>{const segment=segments[params.dataIndex];return {type:'polygon',shape:{points:segment.points.map(([index,price])=>api.coord([timestamp(index),price]))},style:{fill:segment.bull?'#27c98e20':'#ef777c20'}};}};
    const zones=showLevels?(levels?.instrument?.zones||[]).map(zone=>[{name:`${zone.type==='S'?'Supply':zone.type==='D'?'Demand':'Gap'} ${zone.low.toFixed(2)}–${zone.high.toFixed(2)}`,yAxis:zone.low,itemStyle:{color:zone.type==='S'?'#ef777c16':zone.type==='D'?'#2ac9ad16':'#f3c34d12'},label:{show:true,position:'insideTopRight',color:'#b8c9cf',fontSize:10}},{yAxis:zone.high}]):[];
    chart.setOption({animation:false,textStyle:{fontFamily:'Inter',color:'#9aafb9'},grid:{left:16,right:65,top:38,bottom:90},
      tooltip:{trigger:'axis',renderMode:'richText',confine:true,axisPointer:{type:'cross',label:{formatter:p=>p.axisDimension==='x'?clockTime(p.value):money(p.value)}},formatter:rows=>{const row=rows.find(r=>r.seriesType==='candlestick');if(!row)return '';const [time,o,c,l,h]=row.data;const partial=candles[row.dataIndex]?.partial;return `${trade.symbol} · ${journalStamp(time)} ${zoneLabel}${partial?' · Partial bar':''}\nUnderlying open ${money(o)} · close ${money(c)}\nLow ${money(l)} · high ${money(h)}`;}},
      xAxis:{type:'time',min:candles[0].timestamp*1000,max:candles.at(-1).end*1000,axisLine:{lineStyle:{color:'#31474f'}},axisLabel:{color:'#9aafb9',fontSize:10,hideOverlap:true,formatter:value=>displayDay(candles[0].timestamp*1000)===displayDay(candles.at(-1).timestamp*1000)?clockTime(value):`${displayDay(value).slice(5,10)}\n${clockTime(value)}`},splitLine:{show:true,lineStyle:{color:'#20343b'}}},
      yAxis:{type:'value',position:'right',scale:true,...priceRange(...startView),axisLabel:{color:'#9aafb9',fontSize:10,formatter:value=>value.toFixed(2)},splitLine:{lineStyle:{color:'#263b43'}}},
      dataZoom:[{type:'inside',xAxisIndex:0,startValue:startView[0],endValue:startView[1],filterMode:'none',zoomOnMouseWheel:interact,moveOnMouseMove:interact,moveOnMouseWheel:false},{type:'slider',xAxisIndex:0,bottom:16,height:24,startValue:startView[0],endValue:startView[1],showDetail:false,borderColor:'#31474f',fillerColor:'#2ac9ad22',dataBackground:{lineStyle:{color:'#50757e'},areaStyle:{color:'#263b43'}},handleStyle:{color:'#91abb5'}}],
      series:[ribbon,...lines,{type:'candlestick',name:'Underlying price',z:5,encode:{x:0,y:[1,2,3,4]},data:candles.map(c=>[c.timestamp*1000,...c.ohlc]),barMaxWidth:12,itemStyle:{color:'#2ac9ad',color0:'#ef777c',borderColor:'#2ac9ad',borderColor0:'#ef777c'},
        markLine:{silent:true,animation:false,symbolSize:10,data:markers.filter(m=>m.available).map(m=>({name:m.kind==='entry'?'Entry':'Exit',xAxis:m.time*1000,symbol:m.kind==='entry'?['none','arrow']:['arrow','none'],lineStyle:{color:m.kind==='entry'?'#2ac9ad':'#f3c34d',type:'dashed',width:2},label:{show:true,rotate:0,formatter:`${m.kind.toUpperCase()} · ${clockTime(m.time*1000,true)}\n${money(m.kind==='entry'?trade.entryPrice:trade.exitPrice)} option fill`,position:m.kind==='entry'?'insideEndBottom':'insideStartTop',color:m.kind==='entry'?'#2ac9ad':'#f3c34d',backgroundColor:'#0e191ef5',borderColor:m.kind==='entry'?'#2ac9ad':'#f3c34d',borderWidth:1,borderRadius:3,lineHeight:17,fontSize:11,padding:[5,7]}}))},
        markArea:{silent:true,itemStyle:{color:'#8ab2bf0c'},data:[...zones,...(entry&&exit?[[{xAxis:entry.time*1000},{xAxis:exit.time*1000}]]:[])]}}]});
    chart.on('datazoom',()=>{const state=chart.getOption().dataZoom[0],start=candles[0].timestamp*1000,span=candles.at(-1).end*1000-start;const range=[start+span*state.start/100,start+span*state.end/100];viewport.current=range;chart.setOption({yAxis:priceRange(...range)});});
    let frame;const observer=new ResizeObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>!chart.isDisposed()&&chart.resize());});observer.observe(node.current);
    return()=>{cancelAnimationFrame(frame);observer.disconnect();chart.dispose();engine.current=null;};
  },[candles,trade,timeframe,showIndicators,showLevels,levels,clockTime,journalStamp,displayDay,zoneLabel]);
  useEffect(()=>{engine.current?.setOption({dataZoom:[{type:'inside',zoomOnMouseWheel:interact,moveOnMouseMove:interact}]});},[interact]);
  const zoom=factor=>{const chart=engine.current;if(!chart)return;const state=chart.getOption().dataZoom[0],middle=(state.start+state.end)/2,half=Math.max(.25,Math.min(50,(state.end-state.start)*factor/2));chart.dispatchAction({type:'dataZoom',start:Math.max(0,middle-half),end:Math.min(100,middle+half)});};
  const focus=kind=>{const time=markers.find(m=>m.kind===kind)?.time*1000,pad=Number.parseInt(timeframe)*60000*4;engine.current?.dispatchAction({type:'dataZoom',startValue:Math.max(candles[0].timestamp*1000,time-pad),endValue:Math.min(candles.at(-1).end*1000,time+pad)});};
  return <div className="journal-trade-canvas-wrap"><div className="journal-chart-overlays"><label><input type="checkbox" checked={showIndicators} onChange={e=>setShowIndicators(e.target.checked)}/>Indicators</label><label><input type="checkbox" checked={showLevels} onChange={e=>setShowLevels(e.target.checked)}/>Saved zones</label><span>{levels?.instrument?`${levels.instrument.sourceDate} · ${levels.instrument.timeframe} source`:'No matching dated zones'}</span></div><div className="journal-trade-canvas" data-interact={interact} ref={node} role="img" aria-label={`${trade.symbol} ${timeframe} underlying candlesticks. ${markers.map(m=>`${m.kind} at ${journalStamp(m.time*1000)} ${zoneLabel}${m.available?' marked':' has no covering candle'}`).join('. ')}`} style={{touchAction:interact?'none':'pan-y'}}/>
    <div className="journal-trade-chart-tools"><span><i className="entry"/>Entry <i className="exit"/>Exit · execution times</span><div><button type="button" className="text-button" disabled={!markers.find(m=>m.kind==='entry')?.available} onClick={()=>focus('entry')}>Focus entry</button><button type="button" className="text-button" disabled={!markers.find(m=>m.kind==='exit')?.available} onClick={()=>focus('exit')}>Focus exit</button><button type="button" className="icon-button" title="Zoom in" aria-label="Zoom trade chart in" onClick={()=>zoom(.65)}><Plus size={17}/></button><button type="button" className="icon-button" title="Zoom out" aria-label="Zoom trade chart out" onClick={()=>zoom(1.5)}><Minus size={17}/></button><button type="button" className="text-button" onClick={()=>engine.current?.dispatchAction({type:'dataZoom',startValue:home[0],endValue:home[1]})}><ArrowsOutSimple size={16}/>Fit trade</button><button type="button" className="text-button" aria-pressed={interact} onClick={()=>setInteract(v=>!v)}><Hand size={16}/>{interact?'Done interacting':'Interact'}</button></div></div>
    {showIndicators&&<div className="journal-indicator-legend">{overlays.map(([id,label,color])=><span key={id}><i style={{background:color}}/>{label}{!candles.some(c=>finite(c.indicators[id]))?' · unavailable':''}</span>)}</div>}
  </div>;
}
