import {createContext,useContext,useEffect,useId,useRef,useState} from 'react';
import {ChartLine,Stack,PencilSimple,ArrowsOutCardinal,ArrowCounterClockwise,Gear,X,ArrowUpRight} from '@phosphor-icons/react';
import {CHART_DEFAULTS,readChartSettings,chartConfig} from './data/chart-settings.mjs';
import {DRAWING_COLORS} from './data/drawings.mjs';
import {TIMEFRAMES} from './data/candles';
import {INDICATORS} from './ChartIndicators';
import {ZoneRoleStatus} from './ZoneRoles';
import {zoneName,zoneText,formatDate} from './data/market';

const Context=createContext(null);
export function ChartSettingsProvider({workspace,children}){
  const [open,setOpen]=useState(false),settings=readChartSettings(workspace.data);
  function update(change){workspace.update(current=>{
    const previous=readChartSettings(current),next=change(previous);
    return JSON.stringify(previous)===JSON.stringify(next)?current:{...current,chartSettings:next};
  });}
  function global(defaults,all=false){workspace.update(current=>({
    ...current,chartSettings:{...readChartSettings(current),defaults,...(all?{charts:{},intervals:{}}:{})},
    ...(all?{preferences:{...current.preferences,timeframe:defaults.defaultTimeframe}}:{}),
  }));}
  return <Context.Provider value={{settings,update,workspace,saveDefaults:global,openGlobal:()=>setOpen(true)}}>{children}{open&&<GlobalChartSettings initial={settings.defaults} onSave={global} onClose={()=>setOpen(false)}/>}</Context.Provider>;
}
export const useChartSettingsStore=()=>useContext(Context);
export function useSavedChart(scope){
  const context=useContext(Context),config=chartConfig(context.settings,scope);
  function set(change){context.update(current=>{
    const previous=chartConfig(current,scope),next=typeof change==='function'?change(previous):{...previous,...change};
    if(JSON.stringify(previous)===JSON.stringify(next))return current;
    return {...current,charts:{...current.charts,[scope]:next}};
  });}
  function reset(){context.update(current=>{const charts={...current.charts};delete charts[scope];return {...current,charts};});}
  return {config,set,reset,openGlobal:context.openGlobal,status:context.workspace.status};
}
export function useSavedTimeframe(symbol,{primary=false}={}){
  const {settings,workspace}=useContext(Context),frame=symbol==='US2Y'?'D':settings.intervals[symbol]||settings.defaults.defaultTimeframe;
  function change(timeframe){if(!symbol)return;workspace.update(current=>({
    ...current,chartSettings:{...readChartSettings(current),intervals:{...readChartSettings(current).intervals,[symbol]:timeframe}},
    ...(primary?{preferences:{...current.preferences,timeframe}}:{}),
  }));}
  return [frame,change];
}
export function ChartHeader({symbol,marketKey=symbol,timeframe,onTimeframe,source='Yahoo Finance',daily=false,roles}){
  const {config,set,reset,openGlobal,status}=useSavedChart(`${marketKey}|${timeframe}`);
  const icons=[['indicators',daily?'Readings':'Indicators',ChartLine],['levels','Levels',Stack],['drawings','Drawing tools',PencilSimple],['navigation','Chart navigation',ArrowsOutCardinal]];
  return <div className="chart-toolbar compact-chart-header">
    <div className="chart-header-left"><span className="chart-identity"><strong>{symbol||'Select a stock'}</strong> · {timeframe} · {source}</span>
      <div className="chart-header-icons" role="group" aria-label="Chart controls">{icons.filter(([id])=>!daily||id!=='levels').map(([id,label,Icon])=><button key={id} type="button" title={id==='levels'&&roles?.status?`${label} · ${roles.status==='ok'?'confirmed roles':roles.status==='stale'?'cached confirmation':roles.status}`:label} aria-label={label} disabled={!marketKey} aria-expanded={config.panel===id} aria-pressed={config.panel===id} onClick={()=>set({panel:config.panel===id?null:id})}><Icon size={17}/>{id==='levels'&&roles?.status==='stale'&&<i className="chart-control-dot"/>}</button>)}
        <button type="button" title="Reset view and indicators to global defaults · keep drawings" aria-label="Reset view" disabled={!marketKey} onClick={reset}><ArrowCounterClockwise size={17}/></button>
        <button type="button" title="Global chart settings" aria-label="Global chart settings" onClick={openGlobal}><Gear size={17}/></button>
        {status!=='saved'&&<span className={`chart-save-dot ${['error','conflict'].includes(status)?'error':''}`} title={['error','conflict'].includes(status)?'Chart changes not saved. Check workspace save status.':'Saving chart changes…'} aria-label={['error','conflict'].includes(status)?'Chart not saved':'Saving chart changes'}/>}
      </div>
    </div>
    {daily?<span className="muted context-daily-note">Daily data only</span>:<div className="segmented" aria-label="Chart timeframe">{TIMEFRAMES.map(frame=><button type="button" key={frame} aria-pressed={timeframe===frame} className={timeframe===frame?'selected':''} disabled={!marketKey} onClick={()=>onTimeframe(frame)}>{frame}</button>)}</div>}
  </div>;
}
export function ChartLevels({scope,instrument,date,roles,onTradingView,quoteDate}){
  date=instrument?.sourceDate||date;
  const {config,set}=useSavedChart(scope);if(config.panel!=='levels')return null;
  return <div className="chart-settings-panel chart-level-panel" role="region" aria-label="Chart levels settings">
    <div className="chart-panel-heading"><strong>Your levels</strong><span><time dateTime={date}>{date}</time> · {instrument?.timeframe||'No supplied levels'}</span>{onTradingView&&<button type="button" className="text-button" onClick={onTradingView}>gunner’s lvls <ArrowUpRight size={14}/></button>}</div>
    <div className="chart-setting-toggles"><label><input type="checkbox" checked={config.showLevels} onChange={e=>set({showLevels:e.target.checked})}/>Show imported levels</label><button type="button" className="context-level-fit" aria-pressed={config.fitLevels} onClick={()=>set({fitLevels:!config.fitLevels,priceRange:null})}>Fit all levels</button></div>
    {instrument?.carriedForward&&<p className="amber context-levels-date-note">Carried forward from {date}; this instrument was missing from this daily list.</p>}
    {quoteDate&&date!==quoteDate&&<p className="amber context-levels-date-note">Reference sheet {date}; quote session {formatDate(quoteDate)}. Setup comparisons require matching dates.</p>}
    <ZoneRoleStatus roles={roles}/>
    {instrument?<details className="context-levels-details"><summary>View all {instrument.zones.length} {instrument.symbol} levels</summary><ul aria-label={`${instrument.symbol} imported levels`}>{instrument.zones.map((zone,i)=><li key={i}><span className={zone.type==='S'?'red':zone.type==='D'?'green':'amber'}>{zoneName(zone.type)}</span><strong>{zoneText(zone)}</strong></li>)}</ul></details>:<p>No supplied levels for this chart.</p>}
  </div>;
}
export function GlobalChartSettings({initial,onSave,onClose=()=>{},embedded=false}){
  const [draft,setDraft]=useState(()=>structuredClone(initial)),[confirm,setConfirm]=useState(null),dialog=useRef(null),title=useId();
  useEffect(()=>{if(embedded)return;const node=dialog.current,trigger=document.activeElement;node.showModal();return()=>{node.close();if(trigger?.isConnected)trigger.focus({preventScroll:true});};},[embedded]);
  const edit=patch=>{setDraft(value=>({...value,...patch}));setConfirm(null);};
  const Container=embedded?'section':'dialog';
  const commit=(defaults,all=false)=>{onSave(defaults,all);setDraft(structuredClone(defaults));setConfirm(null);onClose();};
  return <Container className={embedded?"global-chart-settings settings-chart-editor":"modal global-chart-settings"} ref={dialog} aria-labelledby={title} onCancel={embedded?undefined:onClose} onClick={embedded?undefined:e=>{if(e.target===e.currentTarget)onClose();}}><div className={embedded?"settings-editor-inner":"modal-inner"}>
    <header className="modal-header"><div><h2 id={title}>{embedded?'Chart defaults':'Global chart settings'}</h2><p>Defaults for new charts and Reset view. Each chart keeps its saved setup.</p></div>{!embedded&&<button type="button" className="icon-button" aria-label="Close chart settings" onClick={onClose}><X size={21}/></button>}</header>
    <div className="global-chart-fields"><label>Default timeframe<select aria-label="Default chart timeframe" value={draft.defaultTimeframe} onChange={e=>edit({defaultTimeframe:e.target.value})}>{TIMEFRAMES.map(frame=><option key={frame}>{frame}</option>)}</select></label><label>Drawing color<select aria-label="Default drawing color" value={draft.drawingColor} onChange={e=>edit({drawingColor:e.target.value})}>{DRAWING_COLORS.map((color,i)=><option key={color} value={color}>{['Amber','Green','Red','Blue','White'][i]}</option>)}</select></label></div>
    <fieldset><legend>Default indicators</legend><div className="global-indicator-grid">{INDICATORS.map(item=><label key={item.key}><input type="checkbox" checked={draft.enabled[item.key]} onChange={e=>edit({enabled:{...draft.enabled,[item.key]:e.target.checked}})}/><i style={{background:item.color}}/>{item.label}</label>)}</div></fieldset>
    <fieldset><legend>Chart display</legend><div className="global-indicator-grid">{[['showLevels','Show imported levels'],['drawingsVisible','Show saved drawings'],['fitLevels','Fit all imported levels'],['fitIndicators','Fit indicators'],['hoverValues','Hover values while Indicators is open']].map(([key,label])=><label key={key}><input type="checkbox" checked={draft[key]} onChange={e=>edit({[key]:e.target.checked})}/>{label}</label>)}</div></fieldset>
    <p className="global-settings-note">Reset view restores the current chart’s zoom, automatic price scale and these display defaults. Drawings and imported levels are kept. Indicator visibility changes the chart display; your strategy checks keep using their configured indicators.</p>
    {confirm&&<div className="global-reset-confirm" role="group" aria-label="Confirm global chart reset"><p>{confirm==='factory'?'Restore the original app defaults and reset every saved chart setup?':'Apply these defaults to every saved chart and reset their timeframes, zoom and price scales?'} Your drawings are kept.</p><button type="button" className="button primary" onClick={()=>commit(confirm==='factory'?structuredClone(CHART_DEFAULTS):draft,true)}>Confirm {confirm==='factory'?'reset':'apply to all'}</button><button type="button" className="button" onClick={()=>setConfirm(null)}>Cancel</button></div>}
    <footer className="global-settings-actions"><button type="button" className="text-button" onClick={()=>setConfirm('factory')}>Restore app defaults</button><button type="button" className="button outline" onClick={()=>setConfirm('all')}>Apply to all charts</button><button type="button" className="button primary" onClick={()=>commit(draft)}>Save defaults</button></footer>
  </div></Container>;
}
