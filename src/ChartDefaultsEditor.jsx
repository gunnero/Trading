import {useId, useState} from 'react';
import {ArrowClockwise, BookmarkSimple, CaretDown, FloppyDisk, Info, Stack} from '@phosphor-icons/react';
import {TIMEFRAMES} from './data/candles';
import {DRAWING_PALETTE} from './data/drawings.mjs';
import {INDICATORS} from './ChartIndicators';
import {ChartDefaultsPreview} from './ChartDefaultsPreview';
import './chart-defaults.css';

function Switch({label, checked, onChange, mixed=false}) {
  return <label className="cd-switch">
    <input aria-label={label} type="checkbox" checked={checked} ref={el=>{if(el)el.indeterminate=mixed;}} onChange={e=>onChange(e.target.checked)}/>
    <span aria-hidden="true"/>
  </label>;
}

function Row({title, hint, children}) {
  return <div className="cd-row"><div className="cd-row-copy"><strong>{title}</strong><small>{hint}</small></div>{children}</div>;
}

function Indicators({draft, edit}) {
  const [expanded, setExpanded] = useState({});
  const id = useId();
  const groups = [
    {title:'EMA 9/21 ribbon', hint:'Exponential moving averages over 9 and 21 bars.', keys:['ema']},
    {title:'Session VWAP', hint:'Volume-weighted average price for the current session.', keys:['vwap']},
    {title:'Previous day H/L/C', hint:'High, low and close from the previous day.', keys:['pdh','pdl','pdc']},
    {title:'Daily SMA 20/50/100/200', hint:'Simple moving averages based on daily closes.', keys:['sma20','sma50','sma100','sma200']},
  ];
  function change(keys, value) {
    edit({enabled:{...draft.enabled, ...Object.fromEntries(keys.map(key=>[key,value]))}});
  }
  return <section className="cd-card"><h3>Indicators</h3>{groups.map(({title, hint, keys}) => {
    const first = keys[0], multi = keys.length > 1, all = keys.every(k=>draft.enabled[k]);
    const mixed = !all && keys.some(k=>draft.enabled[k]);
    const label = multi ? title : INDICATORS.find(item=>item.key===first).label;
    return <div className="cd-setting" key={first}>
      <Row title={multi ? <button type="button" className="cd-disclose" aria-expanded={!!expanded[first]} aria-controls={id+first} onClick={()=>setExpanded({...expanded,[first]:!expanded[first]})}>{title}<CaretDown size={14}/></button> : title} hint={hint}>
        <Switch label={label} checked={all} mixed={mixed} onChange={value=>change(keys,value)}/>
      </Row>
      {multi && <div className="cd-individual" id={id+first} hidden={!expanded[first]}>{INDICATORS.filter(item=>keys.includes(item.key)).map(item=><label key={item.key}><input type="checkbox" checked={draft.enabled[item.key]} onChange={e=>change([item.key],e.target.checked)}/>{item.label}</label>)}</div>}
    </div>;
  })}</section>;
}

function SavedSetups({setups}) {
  const scopes = Object.keys(setups).sort();
  return <details className="cd-saved"><summary><BookmarkSimple size={21}/><strong>Saved chart setups</strong><span>{scopes.length} {scopes.length===1?'setup':'setups'}</span><CaretDown size={16}/></summary>
    {scopes.length ? <ul>{scopes.map(scope => {
      const [listing, frame] = scope.split('|');
      return <li key={scope}><strong>{listing}</strong><span>{frame}</span></li>;
    })}</ul> : <p>Customizing a chart saves its setup here.</p>}
  </details>;
}

export function ChartDefaultsEditor({draft, edit, setups, onSave, onApply, onRestore}) {
  return <>
    <div className="cd-columns">
      <div className="cd-stack">
        <section className="cd-card"><h3>General</h3>
          <Row title="Default interval" hint="Timeframe for new charts."><select aria-label="Default chart timeframe" value={draft.defaultTimeframe} onChange={e=>edit({defaultTimeframe:e.target.value})}>{TIMEFRAMES.map(t=><option key={t}>{t}</option>)}</select></Row>
          <Row title="Show imported levels" hint="Display your imported zones on new charts."><Switch label="Show imported levels" checked={draft.showLevels} onChange={showLevels=>edit({showLevels})}/></Row>
          <Row title="Fit mode" hint="Price scale used when you reset the view."><div className="cd-segment" role="group" aria-label="Fit mode">{[[false,'Prices'],[true,'All levels']].map(([fitLevels,label])=><button type="button" key={label} aria-pressed={draft.fitLevels===fitLevels} onClick={()=>edit({fitLevels})}>{label}</button>)}</div></Row>
          <Row title="Hover readings" hint="Show cursor values when the Indicators panel is open."><Switch label="Hover readings" checked={draft.hoverValues} onChange={hoverValues=>edit({hoverValues})}/></Row>
          <details className="cd-scale"><summary>Scale options</summary><label><input type="checkbox" checked={draft.fitIndicators} onChange={e=>edit({fitIndicators:e.target.checked})}/>Fit indicators</label></details>
        </section>
        <Indicators draft={draft} edit={edit}/>
      </div>
      <div className="cd-stack">
        <ChartDefaultsPreview key={draft.defaultTimeframe} draft={draft}/>
        <section className="cd-card"><h3>Drawings</h3>
          <Row title="Drawing visibility" hint="Show your saved lines, zones and notes."><Switch label="Show saved drawings" checked={draft.drawingsVisible} onChange={drawingsVisible=>edit({drawingsVisible})}/></Row>
          <Row title="Drawing color" hint="Default color for new drawings."><div className="cd-color"><i aria-hidden="true" style={{background:draft.drawingColor}}/><select aria-label="Default drawing color" value={draft.drawingColor} onChange={e=>edit({drawingColor:e.target.value})}>{Object.entries(DRAWING_PALETTE).map(([value, name])=><option key={value} value={value}>{name}</option>)}</select></div></Row>
        </section>
        <SavedSetups setups={setups}/>
      </div>
    </div>
    <footer className="cd-actions">
      <button type="button" className="button primary" onClick={onSave}><FloppyDisk size={18}/>Save defaults</button>
      <button type="button" className="button outline" onClick={onApply}><Stack size={18}/>Apply to all charts</button>
      <button type="button" className="cd-restore" onClick={onRestore}><ArrowClockwise size={18}/>Restore app defaults</button>
      <p><Info size={18}/>Reset view keeps your drawings. Applying defaults replaces saved chart setups.</p>
    </footer>
  </>;
}
