import {useDisplayTime} from './DisplayTime';
import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { LineChart, CandlestickChart, BarChart, CustomChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, MarkAreaComponent, MarkLineComponent, DataZoomComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { formatPrice, zoneName, zoneText } from './data/market';

import {ribbonSegments} from './data/indicators.mjs';
import {INDICATORS,IndicatorControls,validIndicator} from './ChartIndicators';
import {ChartNavigation,useChartNavigation} from './ChartNavigation';
import {usePriceScale} from './PriceScale';
import {TouchChart} from './TouchChart';
import {DrawingChart} from './ChartDrawings';
import {useSavedChart} from './ChartSettings';

echarts.use([LineChart, CandlestickChart, BarChart, CustomChart, GridComponent, TooltipComponent, MarkAreaComponent, MarkLineComponent, DataZoomComponent, CanvasRenderer]);
const colors = { green: '#27cbb0', red: '#f46f73', amber: '#efbd4e', muted: '#7d929b' };
function useChart(option,onZoom) {
  const ref = useRef(null),instance=useRef(null),zoomCallback=useRef(onZoom),[ready,setReady]=useState(null);zoomCallback.current=onZoom;
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, null, { renderer: 'canvas', devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2) });
    instance.current=chart;setReady(chart);
    chart.on('datazoom',()=>{const zoom=chart.getOption().dataZoom?.[0];if(zoom)zoomCallback.current?.({start:zoom.start,end:zoom.end});});
    let resizeFrame;
    const observer = new ResizeObserver(() => { cancelAnimationFrame(resizeFrame); resizeFrame=requestAnimationFrame(()=>{if(!chart.isDisposed())chart.resize();}); });
    observer.observe(ref.current);
    return () => { observer.disconnect(); cancelAnimationFrame(resizeFrame); chart.dispose();instance.current=null; };
  }, []);
  useEffect(()=>{instance.current?.setOption(option,{replaceMerge:['series']});if(option.tooltip?.showContent===false)instance.current?.dispatchAction({type:'hideTip'});},[option]);
  return {ref,chart:ready};
}
export function PriceChart({ symbol, drawingKey=symbol, instrument, timeframe, candles, price, percent = false, indicators }) {
  const {clockStamp,zoneLabel}=useDisplayTime();
  const scope=`${drawingKey}|${timeframe}`,settings=useSavedChart(scope),{config}=settings;
  const {enabled,fitIndicators,fitLevels}=config;
  const setEnabled=change=>settings.set(current=>({...current,enabled:typeof change==='function'?change(current.enabled):change}));
  const setFitIndicators=fitIndicators=>settings.set({fitIndicators,priceRange:null});
  const plotted=INDICATORS.filter(item=>enabled[item.key]).flatMap(item=>item.series.filter(key=>indicators?.series?.[key]?.some(validIndicator)).map(key=>({...item,id:key,values:indicators.series[key],name:key==='ema9'?'9 EMA':key==='ema21'?'21 EMA':item.label})));
  const formatValue=value=>percent?`${value.toFixed(3)}%`:formatPrice(value);
  const data = candles.map(row=>({...row,label:['D','W','M'].includes(timeframe)?row.date.slice(0,timeframe==='M'?7:10):clockStamp(row.timestamp*1000).replace(' · ','\n'),time:['D','W','M'].includes(timeframe)?row.date:clockStamp(row.timestamp*1000)+` ${zoneLabel}`}));
  const labels = [...data.map(row => row.label), ...Array.from({length:Math.ceil(data.length*.25)},()=> '')];
  const navigation=useChartNavigation(`${symbol}:${timeframe}`,labels.length,[0,1],(data.length-1)/(labels.length-1)*100,{view:config.timeRange,onChange:timeRange=>settings.set({timeRange})});
  const first=Math.min(data.length-1,Math.floor(navigation.view.start/100*(labels.length-1))),last=Math.min(data.length,Math.ceil(navigation.view.end/100*(labels.length-1))+1),visibleData=data.slice(first,last);
  const fittedZones=config.showLevels&&fitLevels&&instrument?instrument.zones:[];
  const indicatorValues=fitIndicators?plotted.flatMap(item=>item.values.slice(first,last).filter(validIndicator)):[];
  const low = Math.min(...visibleData.map(row=>row.ohlc[2]),...fittedZones.map(z=>z.low),...indicatorValues), high = Math.max(...visibleData.map(row=>row.ohlc[3]),...fittedZones.map(z=>z.high),...indicatorValues);
  const padding = Math.max(percent ? 0.005 : 1.8, (high-low)*.12);
  const scale=percent?1000:1;
  const priceScale=usePriceScale(scope,{min:Math.floor((low-padding)*scale)/scale,max:Math.ceil((high+padding)*scale)/scale},{persist:{range:config.priceRange,onChange:priceRange=>settings.set({priceRange})}});
  const {min,max}=priceScale.range;
  const tickInterval = Math.max(1, Math.ceil((labels.length*(navigation.view.end-navigation.view.start)/100)/6)-1);
  const visibleZones = config.showLevels?(instrument?.zones.filter(z => z.low <= max && z.high >= min) || []):[];
  // Dense daily zones can overlap when a real history spans a wider price range.
  const labelCenters=[],labeledZones=new Set(),labelGap=(max-min)*.065;
  for(const zone of [...visibleZones].sort((a,b)=>Math.abs((a.low+a.high)/2-price)-Math.abs((b.low+b.high)/2-price))){
    if(zone.high>min+labelGap&&labelCenters.every(center=>Math.abs(zone.high-center)>labelGap)){labeledZones.add(zone);labelCenters.push(zone.high);}
  }
  const ribbon=enabled.ema?ribbonSegments(indicators?.series?.ema9||[],indicators?.series?.ema21||[]):[];
  const overlaySeries=plotted.map(item=>({
    type:'line',id:item.id,name:item.name,data:item.values,showSymbol:!!item.cross,showAllSymbol:!!item.cross,
    symbol:item.cross?'path://M-3,-.5L-.5,-.5L-.5,-3L.5,-3L.5,-.5L3,-.5L3,.5L.5,.5L.5,3L-.5,3L-.5,.5L-3,.5Z':'none',symbolSize:6,
    connectNulls:false,lineStyle:{color:item.color,width:item.cross?0:1.3,type:'solid'},itemStyle:{color:item.color},z:4,
  }));
  // Break VWAP at session boundaries without discarding the first value in each session.
  const vwapIndex=overlaySeries.findIndex(item=>item.id==='vwap');
  if(vwapIndex>=0){
    const original=overlaySeries.splice(vwapIndex,1)[0],groups=new Map();
    original.data.forEach((value,index)=>{const session=indicators.sessions[index];if(!groups.has(session))groups.set(session,Array(data.length).fill(null));groups.get(session)[index]=value;});
    for(const [session,values] of groups)overlaySeries.push({...original,id:`vwap-${session}`,data:values,showSymbol:values.filter(validIndicator).length===1,symbol:'circle',symbolSize:3});
  }
  const option = {
    animation: false,
    textStyle: { fontFamily: 'Inter, sans-serif', color: '#b6c4cd' },
    grid: [{ left: 10, right: 68, top: 5, bottom: 68 }, { left: 10, right: 68, bottom: 68, height: 40 }],
    dataZoom:navigation.dataZoom,
    tooltip: { showContent:config.panel==='indicators'&&config.hoverValues, className:'chart-hover-details', trigger: 'axis', confine:true, backgroundColor: '#18262c', borderColor: '#34474f', textStyle: { color: '#e9f0f3', fontSize: 12 }, axisPointer: { type: 'cross', label: { backgroundColor: '#29434b' } }, formatter: params => {
      const candle = params.find(p => p.seriesType === 'candlestick');
      if (!candle) return '';
      const row = data[candle.dataIndex];
      if (!row) return '';
      const indicatorText=plotted.filter(item=>validIndicator(item.values[candle.dataIndex])).map(item=>`<br/><span style="color:${item.color}">●</span> ${item.name}: ${formatValue(item.values[candle.dataIndex])}`).join('');
      return `${symbol} · ${row.time} · Yahoo Finance${row.partial ? ' · Partial bar' : ''}<br/>Open ${formatValue(row.ohlc[0])} &nbsp; Close ${formatValue(row.ohlc[1])}<br/>Low ${formatValue(row.ohlc[2])} &nbsp; High ${formatValue(row.ohlc[3])}${indicatorText}`;
    } },
    xAxis: [
      { type: 'category', data: labels, boundaryGap: true, axisLine: { lineStyle: { color: '#26383f' } }, axisTick: { show: false }, axisLabel: { show: false }, splitLine: { show: true, interval: tickInterval, lineStyle: { color: '#1d2c33', width: 1 } } },
      { gridIndex: 1, type: 'category', data: labels, boundaryGap: true, axisLine: { lineStyle: { color: '#34464f' } }, axisTick: { show: false }, axisLabel: { color: '#9aafb9', fontSize: 10, lineHeight: 13, interval: tickInterval, hideOverlap: true } },
    ],
    yAxis: [
      { min, max, splitNumber: 6, type: 'value', position: 'right', axisLabel: { color: '#aebfc8', fontSize: 11, formatter: n => percent?`${n.toFixed(3)}%`:n.toFixed(2) }, splitLine: { lineStyle: { color: '#24353c' } }, axisLine: { show: true, lineStyle: { color: '#455963' } } },
      { gridIndex: 1, type: 'value', show: false },
    ],
    series: [
      { type: 'candlestick', id:'price',name: 'Yahoo price', data: data.map(x => x.ohlc), barMaxWidth: 18, itemStyle: { color: colors.green, color0: '#de6e71', borderColor: colors.green, borderColor0: '#de6e71' },
        markArea: { silent: true, data: visibleZones.filter(z => z.low !== z.high).map(z => [
          { name: `${zoneName(z.type)}  ${zoneText(z)}`, yAxis: z.low, itemStyle: { color: z.type === 'S' ? '#ef747324' : z.type === 'D' ? '#29c5b029' : '#efbd4e24', borderColor: z.type === 'S' ? '#ad5c5966' : z.type === 'D' ? '#288b8066' : '#efbd4e66', borderWidth: 1 }, label: { show: labeledZones.has(z), position: 'insideTopRight', color: '#e0e8ec', fontSize: 12, padding: [7, 8] } }, { yAxis: z.high }
        ]) },
        markLine: { silent: true, symbol: ['none', 'none'], lineStyle: { color: '#efbd4e', type: 'dotted', width: 1 }, label: { position: 'end', formatter: formatValue(price), color: '#10191c', fontWeight: 700, backgroundColor: '#efbd4e', padding: [5, 5], borderRadius: 3, fontSize: 11 }, data: [{ yAxis: price },...visibleZones.filter(z=>z.low===z.high).map(z=>({yAxis:z.low,lineStyle:{color:z.type==='S'?colors.red:z.type==='D'?colors.green:colors.amber,type:'solid'},label:{show:labeledZones.has(z),position:'insideEndTop',formatter:`${zoneName(z.type)}  ${formatValue(z.low)}`,color:'#e0e8ec',backgroundColor:'transparent',fontWeight:400}}))] }
      },
      { type: 'bar', id:'volume',xAxisIndex: 1, yAxisIndex: 1, data: data.map(x => ({ value: x.volume, itemStyle: { color: x.ohlc[1] >= x.ohlc[0] ? '#27cbb03d' : '#f46f734a' } })), silent: true, barMaxWidth: 18 },
      {type:'custom',id:'ema-ribbon',name:'9 / 21 EMA ribbon',silent:true,clip:true,z:1,data:ribbon.map((_,i)=>[i,0]),renderItem:(params,api)=>{
        const segment=ribbon[params.dataIndex];
        return {type:'polygon',shape:{points:segment.points.map(([x,y])=>{const point=api.coord([Math.floor(x),y]);return [point[0]+(x-Math.floor(x))*api.size([1,0])[0],point[1]];})},style:{fill:segment.bull?'#08998138':'#f2364538'}};
      }},
      ...overlaySeries,
    ]
  };
  const {ref,chart:instance} = useChart(option,navigation.setView);
  return <>{config.panel==='indicators'&&<IndicatorControls indicators={indicators} enabled={enabled} setEnabled={setEnabled} fit={fitIndicators} setFit={setFitIndicators} formatValue={formatValue}/>} {config.panel==='navigation'&&<ChartNavigation navigation={navigation} count={visibleData.length} priceScale={priceScale} onReset={settings.reset} compact/>}<TouchChart scope={scope} panel={config.panel}><DrawingChart scope={`${drawingKey}|${timeframe}`} symbol={symbol} timeframe={timeframe} times={data.map(row=>row.timestamp)} instance={instance} formatValue={formatValue}><div ref={ref} className="price-chart" role="img" tabIndex={0} {...priceScale.handlers} {...priceScale.attributes} onKeyDown={event=>{if(event.key==='Home'||event.key==='0'){event.preventDefault();settings.reset();}else if(!priceScale.onKeyDown(event))navigation.onKeyDown(event);}} data-view-start={navigation.view.start.toFixed(2)} data-view-end={navigation.view.end.toFixed(2)} aria-label={`${symbol} Yahoo Finance ${timeframe} candlestick chart. ${data.length} actual candles. Last chart quote ${price}${percent?' percent':''}.${instrument?` ${visibleZones.length} of ${instrument.zones.length} imported reference levels in view.`:''} Indicators: ${plotted.map(item=>item.name).join(', ')||'unavailable or hidden'}. Drag the price axis to scale; double-click it to restore auto. Use plus/minus to zoom time, Shift plus/minus to scale price, arrows to pan, Home to reset.`} /></DrawingChart></TouchChart></>;
}

export function TreasuryHistoryChart({points}) {
  const settings=useSavedChart('US2Y|D'),{config}=settings;
  const navigation=useChartNavigation('US2Y',points.length,[0],100,{view:config.timeRange,onChange:timeRange=>settings.set({timeRange})}),first=Math.floor(navigation.view.start/100*(points.length-1)),last=Math.ceil(navigation.view.end/100*(points.length-1))+1;
  const values=points.map(point=>point.price),visible=values.slice(first,last),low=Math.min(...visible),high=Math.max(...visible),padding=Math.max(.02,(high-low)*.12);
  const priceScale=usePriceScale('US2Y',{min:Math.floor((low-padding)*100)/100,max:Math.ceil((high+padding)*100)/100},{top:18,bottom:62,persist:{range:config.priceRange,onChange:priceRange=>settings.set({priceRange})}});
  const {ref,chart:instance}=useChart({
    animation:false,textStyle:{fontFamily:'Inter, sans-serif',color:'#b6c4cd'},grid:{left:12,right:68,top:18,bottom:62},dataZoom:navigation.dataZoom,
    tooltip:{showContent:config.panel==='indicators'&&config.hoverValues,className:'chart-hover-details',trigger:'axis',backgroundColor:'#18262c',borderColor:'#34474f',textStyle:{color:'#e9f0f3',fontSize:12},formatter:params=>{const point=points[params[0]?.dataIndex];return point?`${point.date} · U.S. Treasury<br/>2-year par yield: ${point.price.toFixed(2)}%`:'';}},
    xAxis:{type:'category',data:points.map(point=>point.date),boundaryGap:false,axisLine:{lineStyle:{color:'#34464f'}},axisTick:{show:false},axisLabel:{color:'#9aafb9',fontSize:10,interval:Math.max(1,Math.floor(points.length/5)),hideOverlap:true}},
    yAxis:{type:'value',position:'right',...priceScale.range,axisLabel:{color:'#aebfc8',fontSize:11,formatter:n=>`${n.toFixed(2)}%`},splitLine:{lineStyle:{color:'#24353c'}}},
    series:[{type:'line',data:values,showSymbol:points.length===1,symbolSize:6,connectNulls:false,lineStyle:{color:colors.green,width:2},itemStyle:{color:colors.green},areaStyle:{color:'#27cbb012'}}],
  },navigation.setView);
  return <>{config.panel==='indicators'&&<div className="chart-settings-panel">Treasury daily observations · hover the plot to inspect a published yield. Candlestick indicators are not applied.</div>}{config.panel==='navigation'&&<ChartNavigation navigation={navigation} count={visible.length} label="observations" priceScale={priceScale} onReset={settings.reset} compact/>}<TouchChart scope="US2Y|D" panel={config.panel}><DrawingChart scope="US2Y|D" symbol="US 2Y" timeframe="D" times={points.map(point=>Date.parse(point.date)/1000)} instance={instance} formatValue={value=>`${value.toFixed(2)}%`} top={18} bottom={62}><div ref={ref} className="price-chart" role="img" tabIndex={0} {...priceScale.handlers} {...priceScale.attributes} onKeyDown={event=>{if(event.key==='Home'||event.key==='0'){event.preventDefault();settings.reset();}else if(!priceScale.onKeyDown(event))navigation.onKeyDown(event);}} data-view-start={navigation.view.start.toFixed(2)} data-view-end={navigation.view.end.toFixed(2)} aria-label={`US 2Y U.S. Treasury daily yield chart. ${points.length} published observations from ${points[0].date} to ${points.at(-1).date}. Last yield ${points.at(-1).price} percent. Drag the price axis to scale; double-click it to restore auto. Use plus/minus to zoom time, Shift plus/minus to scale price, arrows to pan, Home to reset.`}/></DrawingChart></TouchChart></>;
}

// Read-only overview: independent of full-chart saved axes, panels and drawings.
export function GridChart({symbol,timeframe,candles,indicators,instrument,provider}){
  const {clockStamp,zoneLabel}=useDisplayTime();
  const low=Math.min(...candles.map(row=>row.ohlc[2])),high=Math.max(...candles.map(row=>row.ohlc[3]));
  const padding=Math.max((high-low)*.12,high*.001),min=low-padding,max=high+padding;
  const zones=instrument?.zones.filter(zone=>zone.low<=max&&zone.high>=min)||[];
  const overlays=[['ema9','EMA 9','#b9c7cd'],['ema21','EMA 21','#748990'],['vwap','VWAP','#ffffff']].flatMap(([id,name,color])=>{
    const values=indicators?.series?.[id];if(!values?.some(validIndicator))return [];
    if(id!=='vwap')return [{id,name,type:'line',data:values,showSymbol:false,connectNulls:false,lineStyle:{color,width:1.2},silent:true}];
    const groups=new Map();values.forEach((value,index)=>{const session=indicators.sessions?.[index]||candles[index]?.date;if(!groups.has(session))groups.set(session,Array(candles.length).fill(null));groups.get(session)[index]=value;});
    return [...groups].map(([session,data])=>({id:`vwap-${session}`,name,type:'line',data,showSymbol:false,connectNulls:false,lineStyle:{color,width:1.2},silent:true}));
  });
  const {ref}=useChart({animation:false,textStyle:{fontFamily:'Inter, sans-serif'},grid:[{left:8,right:58,top:12,bottom:36},{left:8,right:58,bottom:36,height:28}],
    tooltip:{show:false},
    xAxis:[{type:'category',data:candles.map(row=>row.timestamp),boundaryGap:true,axisLabel:{show:false},axisTick:{show:false},axisLine:{show:false}},
      {type:'category',gridIndex:1,data:candles.map(row=>candles[0].date===candles.at(-1).date?clockStamp(row.timestamp*1000).split(' · ').at(-1):clockStamp(row.timestamp*1000).replace(' · ','\n')),axisLabel:{color:'#91a5af',fontSize:10,lineHeight:13,hideOverlap:true,interval:Math.max(1,Math.floor(candles.length/4))},axisTick:{show:false},axisLine:{lineStyle:{color:'#293940'}}}],
    yAxis:[{type:'value',position:'right',min,max,splitNumber:4,axisLabel:{color:'#aebfc8',fontSize:10,formatter:value=>value.toFixed(2)},splitLine:{lineStyle:{color:'#233239'}}},{type:'value',gridIndex:1,show:false}],
    series:[{id:'candles',type:'candlestick',data:candles.map(row=>row.ohlc),itemStyle:{color:colors.green,color0:colors.red,borderColor:colors.green,borderColor0:colors.red},barMaxWidth:10,
      markArea:{silent:true,data:zones.filter(zone=>zone.low!==zone.high).map(zone=>[{yAxis:zone.low,itemStyle:{color:zone.type==='S'?'#ef747324':zone.type==='D'?'#29c5b029':'#efbd4e24'}},{yAxis:zone.high}])},
      markLine:{silent:true,symbol:['none','none'],label:{show:false},data:zones.filter(zone=>zone.low===zone.high).map(zone=>({yAxis:zone.low,lineStyle:{color:zone.type==='S'?colors.red:zone.type==='D'?colors.green:colors.amber,width:1}}))}},
      {id:'volume',type:'bar',xAxisIndex:1,yAxisIndex:1,silent:true,data:candles.map(row=>({value:row.volume,itemStyle:{color:row.ohlc[1]>=row.ohlc[0]?'#27cbb03d':'#f46f734a'}}))},...overlays],
  });
  return <div ref={ref} className="grid-mini-chart" role="img" aria-label={`${symbol} ${timeframe} ${provider} chart · ${candles.length} available candles · ${zoneLabel} time · EMA 9/21 and VWAP when available`}/>;
}
