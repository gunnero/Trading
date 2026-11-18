import {useChartPalette} from './appearance';
import {useDisplayTime} from './DisplayTime';
import {useEffect,useMemo,useRef,useState} from 'react';
import * as echarts from 'echarts/core';
import {CandlestickChart,LineChart,CustomChart} from 'echarts/charts';
import {GridComponent,TooltipComponent,DataZoomComponent,MarkLineComponent,MarkAreaComponent} from 'echarts/components';
import {CanvasRenderer} from 'echarts/renderers';
import {Plus,Minus,ArrowsOutSimple,Hand,SkipBack,SkipForward,CaretLeft,CaretRight,Play,Pause} from '@phosphor-icons/react';
import {money,optionPremium} from './data/journal.mjs';
import {tradeViewport} from './data/journal-chart.mjs';
import {ribbonSegments} from './data/indicators.mjs';
echarts.use([CandlestickChart,LineChart,CustomChart,GridComponent,TooltipComponent,DataZoomComponent,MarkLineComponent,MarkAreaComponent,CanvasRenderer]);
const overlaySeries = palette => [['ema9','9 EMA',palette.chartEma],['ema21','21 EMA','#a09ba9'],['vwap','Session VWAP',palette.chartVwap],['pdh','Previous high','#4caf50'],['pdl','Previous low','#ef3e52'],['pdc','Previous close','#9e7c08'],['sma20','20 SMA · 1D','#0b829d'],['sma50','50 SMA · 1D','#9e7c08'],['sma100','100 SMA · 1D','#16834d'],['sma200','200 SMA · 1D','#ef3e52']];
const finite=n=>typeof n==='number'&&Number.isFinite(n);
export default function JournalTradeCanvas({trade,candles:history,markers:executions,timeframe,levels,observedThrough}){
  const palette = useChartPalette();
  const overlays = useMemo(() => overlaySeries(palette), [palette]);
  const {clockTime,journalStamp,zoneLabel,displayDay}=useDisplayTime();
  const node=useRef(),engine=useRef(),[interact,setInteract]=useState(()=>matchMedia('(pointer:fine)').matches);
  const [showIndicators,setShowIndicators]=useState(true),[showLevels,setShowLevels]=useState(true),viewport=useRef(null);
  const home=useMemo(()=>tradeViewport(trade,history,timeframe),[trade,history,timeframe]);
  const steps=useMemo(()=>history.filter(c=>c.end*1000>home[0]&&c.timestamp*1000<home[1]&&!c.partial&&c.end<=observedThrough),[history,home,observedThrough]);
  const [cursor,setCursor]=useState(null),[playing,setPlaying]=useState(false);
  const last=steps.length-1,index=cursor===null?last:Math.min(cursor,last);
  const cutoff=cursor===null?null:steps[index]?.end;
  const candles=useMemo(()=>cutoff==null?history:history.filter(c=>c.end<=cutoff&&!c.partial),[history,cutoff]);
  const markers=useMemo(()=>cutoff==null?executions:executions.filter(m=>m.available&&m.bar.end<=cutoff&&!m.bar.partial),[executions,cutoff]);
  function seek(next){
    setPlaying(false);
    viewport.current=home;
    setCursor(Math.max(0,Math.min(last,next)));
  }
  function togglePlay(){
    if(playing){setPlaying(false);return;}
    viewport.current=home;
    if(cursor===null||index===last)setCursor(0);
    setPlaying(true);
  }
  useEffect(()=>{
    if(!playing)return;
    if(index>=last){setPlaying(false);return;}
    const timer=setTimeout(()=>setCursor(index+1),650);
    return ()=>clearTimeout(timer);
  },[playing,index,last]);
  useEffect(()=>{
    const chart=echarts.init(node.current,null,{renderer:'canvas',devicePixelRatio:Math.min(devicePixelRatio||1,2)});engine.current=chart;
    let frame;
    const observer=new ResizeObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>!chart.isDisposed()&&chart.resize());});
    observer.observe(node.current);
    return()=>{cancelAnimationFrame(frame);observer.disconnect();chart.dispose();engine.current=null;};
  },[]);
  useEffect(()=>{
    const chart=engine.current;
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
    const ribbon={type:'custom',name:'EMA ribbon',silent:true,clip:true,z:1,data:segments.map((_,i)=>[i]),renderItem:(params,api)=>{const segment=segments[params.dataIndex];return {type:'polygon',shape:{points:segment.points.map(([index,price])=>api.coord([timestamp(index),price]))},style:{fill:segment.bull?'#27c98e20':'#bb304a20'}};}};
    const zones=showLevels?(levels?.instrument?.zones||[]).map(zone=>[{name:`${zone.type==='S'?'Supply':zone.type==='D'?'Demand':'Gap'} ${zone.low.toFixed(2)}–${zone.high.toFixed(2)}`,yAxis:zone.low,itemStyle:{color:zone.type==='S'?'#bb304a16':zone.type==='D'?'#087a4b16':'#f3c34d12'},label:{show:true,position:'insideTopRight',color:palette.muted,fontSize:10}},{yAxis:zone.high}]):[];
    chart.setOption({animation:false,textStyle:{fontFamily:'Inter',color:palette.muted},grid:{left:12,right:54,top:24,bottom:62},
      tooltip:{backgroundColor:palette.panel,borderColor:palette.border,textStyle:{color:palette.text},trigger:'axis',renderMode:'richText',confine:true,axisPointer:{type:'cross',label:{formatter:p=>p.axisDimension==='x'?clockTime(p.value):money(p.value)}},formatter:rows=>{const row=rows.find(r=>r.seriesType==='candlestick');if(!row)return '';const [time,o,c,l,h]=row.data;const partial=candles[row.dataIndex]?.partial;return `${trade.symbol} · ${journalStamp(time)} ${zoneLabel}${partial?' · Partial bar':''}\nUnderlying open ${money(o)} · close ${money(c)}\nLow ${money(l)} · high ${money(h)}`;}},
      xAxis:{type:'time',min:history[0].timestamp*1000,max:history.at(-1).end*1000,axisLine:{lineStyle:{color:palette.border}},axisLabel:{color:palette.muted,fontSize:10,hideOverlap:true,formatter:value=>displayDay(history[0].timestamp*1000)===displayDay(history.at(-1).timestamp*1000)?clockTime(value):`${displayDay(value).slice(5,10)}\n${clockTime(value)}`},splitLine:{show:true,lineStyle:{color:palette.chartGrid}}},
      yAxis:{type:'value',position:'right',scale:true,...priceRange(...startView),axisLabel:{color:palette.muted,fontSize:10,formatter:value=>value.toFixed(2)},splitLine:{lineStyle:{color:palette.border}}},
      dataZoom:[{type:'inside',xAxisIndex:0,startValue:startView[0],endValue:startView[1],filterMode:'none',zoomOnMouseWheel:interact,moveOnMouseMove:interact,moveOnMouseWheel:false},{type:'slider',xAxisIndex:0,bottom:5,height:15,startValue:startView[0],endValue:startView[1],showDetail:false,borderColor:palette.border,fillerColor:'#087a4b22',dataBackground:{lineStyle:{color:palette.chartAxis},areaStyle:{color:palette.border}},handleStyle:{color:palette.chartEstimate}}],
      series:[ribbon,...lines,{type:'candlestick',name:'Underlying price',z:5,encode:{x:0,y:[1,2,3,4]},data:candles.map(c=>[c.timestamp*1000,...c.ohlc]),barMaxWidth:12,itemStyle:{color:palette.green,color0:palette.red,borderColor:palette.green,borderColor0:palette.red},
        markLine:{silent:true,animation:false,symbolSize:7,data:markers.filter(m=>m.available).map(m=>({name:m.kind==='entry'?'Entry':'Exit',xAxis:m.time*1000,symbol:m.kind==='entry'?['none','arrow']:['arrow','none'],lineStyle:{color:palette.primary,type:'dashed',width:1},label:{show:true,rotate:0,formatter:`${m.kind.toUpperCase()} · ${clockTime(m.time*1000,true)}\n${optionPremium(m.kind==='entry'?trade.entryPrice:trade.exitPrice)} option fill`,position:m.kind==='entry'?'insideEndBottom':'insideStartTop',color:palette.primary,backgroundColor:palette.selection,borderColor:palette.border,borderWidth:1,borderRadius:3,lineHeight:17,fontSize:10,padding:[2,4]}}))},
        markArea:{silent:true,itemStyle:{color:'#8ab2bf0c'},data:[...zones,...(entry&&exit?[[{xAxis:entry.time*1000},{xAxis:exit.time*1000}]]:[])]}}]},{notMerge:true});
    chart.on('datazoom',()=>{const state=chart.getOption().dataZoom[0],start=history[0].timestamp*1000,span=history.at(-1).end*1000-start;const range=[start+span*state.start/100,start+span*state.end/100];viewport.current=range;chart.setOption({yAxis:priceRange(...range)});});
    return()=>chart.off('datazoom');
  },[candles,markers,history,home,trade,timeframe,interact,showIndicators,showLevels,levels,clockTime,journalStamp,displayDay,zoneLabel, palette, overlays]);
  const zoom=factor=>{const chart=engine.current;if(!chart)return;const state=chart.getOption().dataZoom[0],middle=(state.start+state.end)/2,half=Math.max(.25,Math.min(50,(state.end-state.start)*factor/2));chart.dispatchAction({type:'dataZoom',start:Math.max(0,middle-half),end:Math.min(100,middle+half)});};
  const focus=kind=>{const time=markers.find(m=>m.kind===kind)?.time*1000,pad=Number.parseInt(timeframe)*60000*4;engine.current?.dispatchAction({type:'dataZoom',startValue:Math.max(history[0].timestamp*1000,time-pad),endValue:Math.min(history.at(-1).end*1000,time+pad)});};
  const lastInView=candles.findLast(c=>c.timestamp*1000<home[1]&&c.end*1000>home[0]);
  return <div className="journal-trade-canvas-wrap">
    {showIndicators&&lastInView&&<div className="review-readings" aria-label="Indicator readings at the last replay candle">
      <span>{clockTime(lastInView.timestamp*1000)} {zoneLabel}</span>
      {overlays.slice(0,3).map(([key,name,color])=><span key={key}><i style={{background:color}}/>{name} <b>{finite(lastInView.indicators[key])?lastInView.indicators[key].toFixed(2):'—'}</b></span>)}
    </div>}
    <div className="journal-trade-canvas" data-interact={interact} ref={node} role="img" aria-label={`${trade.symbol} ${timeframe} underlying candlesticks. ${markers.map(m=>`${m.kind} at ${journalStamp(m.time*1000)} ${zoneLabel}${m.available?' marked':' has no covering candle'}`).join('. ')}`} style={{touchAction:interact?'none':'pan-y'}}/>
    {steps.length>0&&<div className="review-player" role="group" aria-label="Underlying candle playback">
      <div className="review-play-buttons">
        <button aria-label="First candle" disabled={index===0} onClick={()=>seek(0)}><SkipBack/></button>
        <button aria-label="Previous candle" disabled={index===0} onClick={()=>seek(index-1)}><CaretLeft/></button>
        <button className="play" aria-label={playing?'Pause replay':'Play replay'} disabled={last<1} onClick={togglePlay}>{playing?<Pause weight="fill"/>:<Play weight="fill"/>}</button>
        <button aria-label="Next candle" disabled={index>=last} onClick={()=>seek(index+1)}><CaretRight/></button>
        <button aria-label="Last candle" disabled={index>=last} onClick={()=>seek(last)}><SkipForward/></button>
        <output>{clockTime(steps[index].end*1000,true)} / {clockTime(steps[last].end*1000,true)} {zoneLabel}</output>
      </div>
      <input type="range" aria-label="Replay candle" aria-valuetext={journalStamp(steps[index].end*1000)} min={0} max={last} value={index} disabled={last<1} onChange={e=>seek(Number(e.target.value))}/>
    </div>}
    {!steps.length&&<p className="journal-help">No completed candles for playback in this trade window.</p>}
    <details className="review-chart-settings"><summary>Chart controls &amp; indicators</summary><div className="journal-chart-overlays"><label><input type="checkbox" checked={showIndicators} onChange={e=>setShowIndicators(e.target.checked)}/>Indicators</label><label><input type="checkbox" checked={showLevels} onChange={e=>setShowLevels(e.target.checked)}/>Saved zones</label><span>{levels?.instrument?`${levels.instrument.sourceDate} · ${levels.instrument.timeframe} source`:'No matching dated zones'}</span></div>    <div className="journal-trade-chart-tools"><span><i className="entry"/>Entry <i className="exit"/>Exit · execution times</span><div><button type="button" className="text-button" disabled={!markers.find(m=>m.kind==='entry')?.available} onClick={()=>focus('entry')}>Focus entry</button><button type="button" className="text-button" disabled={!markers.find(m=>m.kind==='exit')?.available} onClick={()=>focus('exit')}>Focus exit</button><button type="button" className="icon-button" title="Zoom in" aria-label="Zoom trade chart in" onClick={()=>zoom(.65)}><Plus size={17}/></button><button type="button" className="icon-button" title="Zoom out" aria-label="Zoom trade chart out" onClick={()=>zoom(1.5)}><Minus size={17}/></button><button type="button" className="text-button" onClick={()=>{setPlaying(false);setCursor(null);viewport.current=home;engine.current?.dispatchAction({type:'dataZoom',startValue:home[0],endValue:home[1]});}}><ArrowsOutSimple size={16}/>Fit trade</button><button type="button" className="text-button" aria-pressed={interact} onClick={()=>setInteract(v=>!v)}><Hand size={16}/>{interact?'Done interacting':'Interact'}</button></div></div>
    {showIndicators&&<div className="journal-indicator-legend">{overlays.map(([id,label,color])=><span key={id}><i style={{background:color}}/>{label}{!candles.some(c=>finite(c.indicators[id]))?' · unavailable':''}</span>)}</div>}
  </details></div>;
}
