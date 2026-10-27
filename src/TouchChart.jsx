import {useEffect,useState} from 'react';
import {HandTap,Check} from '@phosphor-icons/react';

export function TouchChart({scope,panel,children}){
  const [touch,setTouch]=useState(()=>matchMedia('(pointer:coarse)').matches);
  const [active,setActive]=useState(false);
  useEffect(()=>{const query=matchMedia('(pointer:coarse)'),update=()=>setTouch(query.matches);query.addEventListener('change',update);return()=>query.removeEventListener('change',update);},[]);
  useEffect(()=>setActive(false),[scope]);
  useEffect(()=>{if(panel==='drawings'||panel==='navigation')setActive(true);},[panel]);
  return <div className="touch-chart-shell" data-touch-active={!touch||active}>
    {touch&&<div className="touch-chart-control"><span>{active?'Pinch to zoom · drag to pan':'Scroll the page freely'}</span><button type="button" className="text-button" aria-pressed={active} onClick={()=>setActive(value=>!value)}>{active?<Check size={17}/>:<HandTap size={17}/>} {active?'Done':'Interact with chart'}</button></div>}
    {children}
  </div>;
}
