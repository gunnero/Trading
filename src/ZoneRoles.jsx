import {useDisplayTime} from './DisplayTime';
import {apiFetch} from './auth-client';
import {useEffect,useState,useMemo} from 'react';
import {LEVEL_FRAMES,applyZoneRoles,supportsLevelHistory} from './data/zone-roles.mjs';

import {zoneName,zoneText,formatPrice} from './data/market';

export function useZoneRoles(instrument,date,marketKey,active=true){
  date=instrument?.sourceDate||date;
  const symbol=marketKey||instrument?.symbol,frame=LEVEL_FRAMES[instrument?.timeframe];
  const valid=instrument&&supportsLevelHistory(symbol,frame)&&instrument.futures===['NQ','ES'].includes(symbol);
  const key=valid?`${symbol}:${frame}:${date}`:null,[state,setState]=useState({key:null,status:'loading'});
  useEffect(()=>{
    if(!active){setState({key:null,status:'loading'});return;}
    if(!key)return;
    let cancelled=false,busy=false;const controller=new AbortController();
    async function refresh(){
      if(busy||document.hidden)return;busy=true;
      try{
        const response=await apiFetch(`/api/market/level-history?${new URLSearchParams({symbol,interval:frame,from:date})}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(35000)])});
        if(!response.ok)throw new Error();const body=await response.json();
        if(body.bars&&(body.symbol!==symbol||body.timeframe!==frame||body.from!==date))throw new Error();
        if(!cancelled)setState(previous=>body.status==='unavailable'&&previous.key===key&&previous.bars?{...previous,status:'stale',message:'Refresh unavailable. Last confirmed roles shown.'}:{...body,key});
      }catch{if(!cancelled)setState(previous=>previous.key===key&&previous.bars?{...previous,status:'stale',message:'Refresh unavailable. Last confirmed roles shown.'}:{key,status:'unavailable'});}finally{busy=false;}
    }
    refresh();const timer=setInterval(refresh,60000);document.addEventListener('visibilitychange',refresh);
    return()=>{cancelled=true;controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};
  },[key,active]);
  const result=key&&state.key===key?state:{status:key?'loading':'unsupported'};
  const current=useMemo(()=>{const value=applyZoneRoles(instrument,result.bars);return value?{...value,roleStatus:result.status}:null;},[instrument,result.bars,result.status]);
  return {...result,instrument:current,date,frame};
}
export function ZoneRoleStatus({roles}){
  const {clockStamp,zoneLabel}=useDisplayTime();
  if(!roles?.instrument)return null;
  const {status,instrument,date,through}=roles;
  const title=status==='ok'?`Auto-flip · ${instrument.timeframe} closes`:status==='loading'?'Auto-flip · checking closes':status==='stale'?'Auto-flip · cached confirmation':'Auto-flip paused · imported roles';
  return <details className="zone-role-status"><summary><span className={status==='ok'?'green':'amber'}>{title}</span><span>{through?`Through ${clockStamp(through*1000)} · ${zoneLabel}`:'Waiting for confirmed candles'}</span></summary>
    <p>Supply → demand on a close above the upper edge; demand → supply on a close below the lower edge. Based on available Yahoo {instrument.timeframe} candles from sheet date {date}. Wicks and open candles do not flip a zone. Imported prices stay unchanged. Colors show current confirmed roles across the chart history.</p>
    {status!=='ok'&&<p className="amber">{roles.message||(status==='loading'?'Loading confirmation history. Imported roles shown.':'Confirmation history unavailable. Imported roles shown.')}</p>}
    <ul>{instrument.zones.map(zone=><li key={`${zone.originalType}-${zone.low}-${zone.high}`}><span className={zone.type==='S'?'red':zone.type==='D'?'green':'amber'}>{zoneName(zone.type)}</span><strong>{zoneText(zone)}</strong><small>{zone.lastFlip?`${zoneName(zone.lastFlip.from)} → ${zoneName(zone.lastFlip.to)} · ${clockStamp(zone.lastFlip.at*1000)} ${zoneLabel} · close ${formatPrice(zone.lastFlip.close)}`:`Imported ${zoneName(zone.originalType).toLowerCase()}`}</small></li>)}</ul>
  </details>;
}
