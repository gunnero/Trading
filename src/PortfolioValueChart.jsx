import {useEffect,useState,useId,useRef} from 'react';
import {useDisplayTime} from './DisplayTime';
import {chartLimitOrders,limitOrderLabel,limitOrderDescription,layoutLimitOrders} from './data/chart-limit-orders.mjs';
const money=(v,c)=>Number.isFinite(v)&&c?new Intl.NumberFormat('en-US',{style:'currency',currency:c,maximumFractionDigits:2}).format(v):'—';
function accountScale(low,high){
  const target=(high-low)/5,unit=10**Math.floor(Math.log10(target));
  const step=unit*[1,2,2.5,5,10].find(n=>n*unit>=target);
  const first=Math.floor(low/step),last=Math.ceil(high/step);
  return Array.from({length:last-first+1},(_,index)=>(first+index)*step);
}
export function PortfolioValueChart({points,currency,title="Account value history",reference,levels=[],orderLines=[],accountHistory=false}){
  const [index,setIndex]=useState(null),[width,setWidth]=useState(1000),ref=useRef(null),id=useId(),{clockStamp,clockTime,displayDay,briefingTime,clockDate}=useDisplayTime();
  useEffect(()=>{const element=ref.current;if(!element)return;let active=true;const observer=new ResizeObserver(()=>{if(active)setWidth(Math.max(240,element.clientWidth));});observer.observe(element);return()=>{active=false;observer.disconnect();};},[points.length>0]);
  if(!points.length)return null;
  const orderReferences=chartLimitOrders(orderLines,{green:'var(--green)',red:'var(--red)'}),orderValues=orderReferences.map(line=>line.value);
  const low=Math.min(...points.map(p=>p.value),...orderValues,reference?.value??Infinity),high=Math.max(...points.map(p=>p.value),...orderValues,reference?.value??-Infinity),padding=Math.max(1,(high-low)*.12);
  const ticks=accountHistory?accountScale(low-padding,high+padding):[low-padding,(low+high)/2,high+padding];
  const min=ticks[0],max=ticks.at(-1),left=accountHistory?0:60,right=width-(accountHistory?66:40),top=accountHistory?11:20,bottom=175;
  const start=points[0].at,end=points.at(-1).at,x=p=>left+(end===start?0.5:(p.at-start)/(end-start))*(right-left),y=p=>bottom-(p.value-min)/(max-min)*(bottom-top);
  const selected=Math.min(index??points.length-1,points.length-1),chosen=points[selected],line=points.map((p,i)=>`${i?'L':'M'} ${x(p)} ${y(p)}`).join(' '),color='var(--primary)';
  const orderLayout=layoutLimitOrders(orderReferences,{min,max,top:20,bottom:175,reserved:reference?[{top:y(reference)-24,bottom:y(reference)+4}]:[]}),labelWidth=Math.max(0,Math.min(270,width-116));
  const readout=<div className="pm-history-readout" aria-live="polite">{clockStamp(chosen.at)} <b>{money(chosen.value,currency)}</b>{chosen.estimated&&<span> · estimated daily balance</span>}</div>;
  const sameDay=displayDay(start)===displayDay(end),dateTickCount=start===end?1:width<480?3:width<720?4:5;
  const dateTicks=Array.from({length:dateTickCount},(_,i)=>start+(end-start)*i/Math.max(1,dateTickCount-1));
  return <div ref={ref} className={`pm-performance-chart${accountHistory?' pm-account-area-chart':''}`}>
    {!accountHistory&&readout}
    <svg viewBox={`0 0 ${width} 210`} role="img" aria-labelledby={id} data-limit-order-count={orderReferences.length} onPointerMove={e=>{const rect=e.currentTarget.getBoundingClientRect(),at=start+Math.max(0,Math.min(1,((e.clientX-rect.left)/rect.width*width-left)/(right-left)))*(end-start);let nearest=0;points.forEach((p,i)=>{if(Math.abs(p.at-at)<Math.abs(points[nearest].at-at))nearest=i;});setIndex(nearest);}}>
      <title id={id}>{title}{orderReferences.length?`. Limit orders: ${orderReferences.map(limitOrderDescription).join('; ')}. Read-only price references; crowded labels are detailed in the order list.`:''}</title>
      {ticks.map(v=><g key={v}><line x1={left} x2={right} y1={y({value:v})} y2={y({value:v})} stroke="var(--border)"/><text x={accountHistory?right+7:50} y={y({value:v})+4} textAnchor={accountHistory?'start':'end'} fill="var(--muted)" fontSize="11">{new Intl.NumberFormat('en-US',{notation:Math.abs(v)>=100000?'compact':'standard',maximumFractionDigits:max-min<2?2:max-min<20?1:0}).format(v)}</text></g>)}
      {accountHistory&&dateTicks.map(at=>{
        const tickX=x({at}),anchor=tickX===left?'start':tickX===right?'end':'middle';
        return <g key={at}><line x1={tickX} x2={tickX} y1={top} y2={bottom} stroke="var(--border)"/><text x={tickX} y="192" textAnchor={anchor} fill="var(--muted)" fontSize="11">{sameDay?clockTime(at):briefingTime(at,{hour:undefined,minute:undefined})}{!sameDay&&end-start<=7*86400000&&<tspan x={tickX} dy="12">{clockDate(at).split(',')[0]}</tspan>}</text></g>;
      })}
      {levels.filter(z=>z.low<=max&&z.high>=min).map((z,i)=><rect key={i} x="60" width={width-100} y={y({value:Math.min(max,z.high)})} height={Math.max(1,y({value:Math.max(min,z.low)})-y({value:Math.min(max,z.high)}))} fill={z.type==='S'?'#ef6971':z.type==='D'?'var(--green)':'#e7be67'} opacity=".16"/>)}
      {reference&&<g data-average-line="true"><line x1="60" x2={width-40} y1={y({value:reference.value})} y2={y({value:reference.value})} stroke="var(--primary)" strokeDasharray="6 5"/><text x="62" y={y({value:reference.value})-6} fill="var(--primary)" fontSize="11">Average {money(reference.value,currency)}</text></g>}
      {accountHistory&&points.length>1&&<path d={`${line} L ${x(points.at(-1))} ${bottom} H ${x(points[0])} Z`} fill={color} opacity=".11"/>}
      <path d={line} fill="none" stroke={color} strokeWidth={accountHistory?1.6:2}/>
      <circle cx={x(chosen)} cy={y(chosen)} r="4" fill={color}/>
      {orderLayout.map((order,index)=><g key={order.id??index} data-limit-order-id={order.id} data-order-side={order.side} opacity={order.stale ? .65 : 1}>
        <line x1="60" x2={width-40} y1={order.y} y2={order.y} stroke={order.color} strokeWidth="1.5" strokeDasharray="6 6" strokeDashoffset={order.side==='SELL'?6:0}/>
        {order.labelY!==null&&<>
          {Math.abs(order.y-order.labelY)>4&&<line x1="64" x2="64" y1={order.y} y2={order.labelY} stroke={order.color} opacity=".7"/>}
          <svg x="68" y={order.labelY-16} width={labelWidth} height="32" style={{width:labelWidth,height:32,minHeight:0}} overflow="hidden" aria-hidden="true">
            <rect width={labelWidth} height="32" rx="3" fill="var(--panel)" fillOpacity=".96"/>
            <text x="5" y="12" fill={order.color} fontSize="10" fontWeight="500">{limitOrderLabel(order).split('\n').map((text,index)=><tspan key={index} x="5" dy={index?13:0}>{text}</tspan>)}</text>
          </svg>
        </>}
      </g>)}
      {!accountHistory&&<><text x="60" y="204" fill="var(--muted)" fontSize="11">{sameDay?clockTime(start):displayDay(start)}</text><text x={width-40} y="204" textAnchor="end" fill="var(--muted)" fontSize="11">{sameDay?clockTime(end):displayDay(end)}</text></>}
    </svg>
    {accountHistory&&readout}
    {points.length>1&&<input type="range" aria-label="Chart observation" min="0" max={points.length-1} value={selected} onChange={e=>setIndex(+e.target.value)}/>}</div>;
}
