import {useState} from 'react';
import {MagnifyingGlassPlus,MagnifyingGlassMinus,ArrowCounterClockwise,CaretLeft,CaretRight} from '@phosphor-icons/react';
export function useChartNavigation(key,count,axes=[0,1],endOfData=100,persist){
  const [state,setState]=useState({key,start:0,end:100});
  const view=persist?.view||(state.key===key?state:{key,start:0,end:100}),minSpan=Math.min(100,800/Math.max(1,count));
  function setView(range){
    const start=Math.max(0,Math.min(100,Number(range.start))),end=Math.max(start,Math.min(100,Number(range.end)));
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return;
    if(Math.abs(view.start-start)<.0001&&Math.abs(view.end-end)<.0001)return;
    if(persist){persist.onChange({start,end});return;}
    setState(previous=>previous.key===key&&Math.abs(previous.start-start)<.0001&&Math.abs(previous.end-end)<.0001?previous:{key,start,end});
  }
  function zoom(factor){
    const width=Math.min(100,Math.max(minSpan,(view.end-view.start)*factor));
    // Keep the latest candles in view when zooming through the chart's right-hand label space.
    const edge=factor<1&&view.end>endOfData?Math.min(view.end,endOfData+width*.12):view.end;
    const end=Math.max(width,edge);setView({start:end-width,end});
  }
  function pan(direction){const width=view.end-view.start,start=Math.max(0,Math.min(100-width,view.start+direction*width*.25));setView({start,end:start+width});}
  const reset=()=>setView({start:0,end:100});
  function onKeyDown(event){
    if(event.key==='+'||event.key==='=')zoom(.65);else if(event.key==='-')zoom(1/.65);else if(event.key==='ArrowLeft')pan(-1);else if(event.key==='ArrowRight')pan(1);else if(event.key==='Home'||event.key==='0')reset();else return;
    event.preventDefault();
  }
  const common={xAxisIndex:axes,filterMode:'none',start:view.start,end:view.end,minSpan};
  return {view,setView,zoom,pan,reset,onKeyDown,dataZoom:[
    {...common,id:'inside-zoom',type:'inside',zoomOnMouseWheel:true,moveOnMouseMove:true,moveOnMouseWheel:false,preventDefaultMouseMove:true},
    {...common,id:'range-zoom',type:'slider',height:18,bottom:7,left:12,right:68,showDetail:false,borderColor:'#30464e',backgroundColor:'#101c22',fillerColor:'#2ac9ad24',handleStyle:{color:'#89aaa9',borderColor:'#27cbb0'},dataBackground:{lineStyle:{color:'#607d84'},areaStyle:{color:'#263c43'}},selectedDataBackground:{lineStyle:{color:'#48ad9f'},areaStyle:{color:'#204b44'}},brushSelect:false},
  ]};
}
export function ChartNavigation({navigation,count,label='candles',priceScale,onReset,compact=false}){
  const {view,zoom,pan}=navigation;
  const reset=()=>{if(onReset)onReset();else{navigation.reset();priceScale?.reset();}};
  return <div className="chart-navigation" aria-label="Chart navigation">
    <div><button type="button" aria-label="Zoom in" title="Zoom in (+)" onClick={()=>zoom(.65)}><MagnifyingGlassPlus size={17}/></button><button type="button" aria-label="Zoom out" title="Zoom out (−)" disabled={view.end-view.start>=99.99} onClick={()=>zoom(1/.65)}><MagnifyingGlassMinus size={17}/></button><button type="button" aria-label="Pan earlier" title="Pan earlier (←)" disabled={view.start<=.001} onClick={()=>pan(-1)}><CaretLeft size={17}/></button><button type="button" aria-label="Pan later" title="Pan later (→)" disabled={view.end>=99.999} onClick={()=>pan(1)}><CaretRight size={17}/></button>{!compact&&<button type="button" className="chart-reset" onClick={reset}><ArrowCounterClockwise size={15}/>Reset view</button>}</div>
    {priceScale&&<button type="button" className="chart-auto-price" aria-pressed={!priceScale.manual} title="Restore automatic price scale (A). You can also double-click the price axis." onClick={priceScale.reset}>Auto price</button>}
    <small>Scroll / pinch to zoom · drag to pan{priceScale?' · drag price axis to scale':''}</small><output aria-label="Visible chart range">{count} {label}</output>
  </div>;
}
