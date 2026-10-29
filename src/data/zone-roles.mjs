import {isEquityKey} from './instruments.mjs';
export const LEVEL_FRAMES={'15 min':'15m','30 min':'30m','1 h':'1h','4 h':'4h',Daily:'D'};
export const supportsLevelHistory=(symbol,frame)=>(isEquityKey(symbol)||['NQ','ES'].includes(symbol))&&Object.values(LEVEL_FRAMES).includes(frame);
export function applyZoneRoles(instrument,bars=[]){
  if(!instrument)return null;
  const ordered=[...bars].filter(bar=>bar.closed===true&&Number.isFinite(bar.close)&&Number.isFinite(bar.end)).sort((a,b)=>a.end-b.end);
  return {...instrument,zones:instrument.zones.map(zone=>{
    let type=zone.type,lastFlip=null,flipCount=0;const seen=new Set();
    for(const bar of ordered){
      if(seen.has(bar.end))continue;seen.add(bar.end);
      const next=type==='S'&&bar.close>zone.high?'D':type==='D'&&bar.close<zone.low?'S':type;
      if(next!==type){lastFlip={from:type,to:next,at:bar.end,close:bar.close};flipCount++;type=next;}
    }
    return {...zone,type,originalType:zone.type,lastFlip,flipCount};
  })};
}
