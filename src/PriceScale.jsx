import {useEffect,useRef,useState} from 'react';
function scaledRange(range,factor){const center=(range.min+range.max)/2,half=Math.max(1e-7,Math.min(1e9,(range.max-range.min)*factor))/2;return {min:center-half,max:center+half};}

// Persist view ranges independently of source quotes and level prices.
export function usePriceScale(key,automatic,{top=5,bottom=68,persist}={}){
  const [state,setState]=useState({key,range:null}),drag=useRef(null),current=useRef(null);
  const selected=persist?persist.range:state.key===key?state.range:null,manual=!!selected,range=selected||automatic;
  const change=next=>persist?persist.onChange(next):setState({key,range:next});
  current.current={key,range,change};
  const reset=()=>{drag.current=null;change(null);};
  useEffect(()=>{drag.current=null;},[key]);
  useEffect(()=>{
    function move(event){
      const start=drag.current;if(!start||start.id!==event.pointerId)return;
      if(start.key!==current.current.key){drag.current=null;return;}
      const dy=event.clientY-start.y;if(Math.abs(dy)<3)return;
      const span=start.max-start.min;
      const offset=dy/start.height*span;
      current.current.change(start.mode==='scale'?scaledRange(start,Math.exp(Math.max(-5,Math.min(5,dy/start.height*3)))):{min:start.min+offset,max:start.max+offset});
    }
    function end(event){const start=drag.current;if(start&&(event.type==='blur'||start.id===event.pointerId)){delete start.element.dataset.priceCursor;drag.current=null;}}
    window.addEventListener('pointermove',move,true);window.addEventListener('pointerup',end,true);window.addEventListener('pointercancel',end,true);window.addEventListener('blur',end);
    return()=>{window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',end,true);window.removeEventListener('pointercancel',end,true);window.removeEventListener('blur',end);};
  },[]);
  function position(event){const rect=event.currentTarget.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;return {height:Math.max(1,rect.height-top-bottom),axis:x>=rect.width-68&&y>=top&&y<=rect.height-bottom,plot:x>=10&&x<rect.width-68&&y>=top&&y<=rect.height-bottom};}
  function onPointerDownCapture(event){
    if(!event.isPrimary){drag.current=null;return;}
    if(event.button!==0)return;
    const hit=position(event);if(!hit.axis&&!(hit.plot&&event.pointerType==='mouse'))return;
    if(hit.axis){event.preventDefault();event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);}
    drag.current={...range,key,id:event.pointerId,y:event.clientY,height:hit.height,element:event.currentTarget,mode:hit.axis?'scale':'pan'};
    event.currentTarget.dataset.priceCursor=hit.axis?'scale':'pan';
  }
  function onPointerMoveCapture(event){event.currentTarget.dataset.priceCursor=drag.current?.mode==='scale'||position(event).axis?'scale':drag.current?'pan':'';}
  function onDoubleClickCapture(event){if(position(event).axis){event.preventDefault();event.stopPropagation();reset();}}
  function onKeyDown(event){
    const span=range.max-range.min;
    if(event.key==='Home'||event.key==='0'){reset();return false;}
    if(event.key==='a'||event.key==='A')reset();
    else if(event.key==='ArrowUp'||event.key==='ArrowDown'){
      const offset=span*(event.key==='ArrowUp'?-.1:.1);change({min:range.min+offset,max:range.max+offset});
    }else if(event.shiftKey&&['+','=','-','_'].includes(event.key)){
      change(scaledRange(range,['-','_'].includes(event.key)?1.25:.8));
    }else return false;
    event.preventDefault();return true;
  }
  return {range,manual,reset,onKeyDown,handlers:{onPointerDownCapture,onPointerMoveCapture,onDoubleClickCapture,onPointerLeave:event=>{if(!drag.current)delete event.currentTarget.dataset.priceCursor;}},attributes:{'data-price-scale':manual?'manual':'auto','data-price-min':range.min,'data-price-max':range.max}};
}
