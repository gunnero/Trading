import {memo, useEffect, useRef} from 'react';

const colors={green:'#27cbb0',red:'#f46f73',amber:'#efbd4e',muted:'#7d929b'};
// A preview needs only a stroke, not an independent interactive chart engine.
export const Sparkline=memo(function Sparkline({tone='green',data=[]}){
  const ref=useRef(null);
  useEffect(()=>{
    const canvas=ref.current;
    let frame;
    const draw=()=>{
      const {width,height}=canvas.getBoundingClientRect();
      if(!width||!height)return;
      const ratio=Math.min(devicePixelRatio||1,2),context=canvas.getContext('2d');
      canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);
      context.scale(ratio,ratio);
      const values=data.filter(value=>typeof value==='number'&&Number.isFinite(value));
      if(values.length<2)return;
      const low=Math.min(...values),span=Math.max(...values)-low;
      context.strokeStyle=colors[tone]||colors.muted;context.lineWidth=1.3;context.lineJoin='round';context.beginPath();
      let connected=false;
      data.forEach((value,index)=>{
        if(typeof value!=='number'||!Number.isFinite(value)){connected=false;return;}
        const x=2+index/Math.max(1,data.length-1)*(width-4),y=span?height-5-(value-low)/span*(height-10):height/2;
        if(connected)context.lineTo(x,y);else context.moveTo(x,y);
        connected=true;
      });
      context.stroke();
    };
    const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(draw);};
    const observer=new ResizeObserver(schedule);observer.observe(canvas);schedule();
    return()=>{observer.disconnect();cancelAnimationFrame(frame);};
  },[tone,data]);
  return <canvas className="sparkline" ref={ref} aria-hidden="true"/>;
});
