import {useId, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {INDICATORS} from './ChartIndicators';
import {ribbonSegments} from './data/indicators.mjs';
import {chartDefaultsExample} from './chart-defaults-example.mjs';

const left = 4, top = 11;
const bands = [[708.8, 710.1, '#e86c83'], [702.4, 704.1, '#79c58d'], [678.8, 680.2, '#79c58d']];
const seriesNames = {ema9:'EMA 9', ema21:'EMA 21', vwap:'VWAP', pdh:'Prev. high', pdl:'Prev. low', pdc:'Prev. close'};
const dateLabel = new Intl.DateTimeFormat('en-US', {month:'short', day:'numeric', timeZone:'UTC'});
const monthLabel = new Intl.DateTimeFormat('en-US', {month:'short', year:'2-digit', timeZone:'UTC'});
const timeLabel = new Intl.DateTimeFormat('en-GB', {hour:'2-digit', minute:'2-digit', timeZone:'UTC'});
function linePath(values, x, y, sessions) {
  return values.map((v, i) => Number.isFinite(v) ? (i === 0 || !Number.isFinite(values[i-1]) || (sessions && sessions[i].start !== sessions[i-1].start) ? 'M' : 'L') + x(i) + ' ' + y(v) : '').join(' ');
}

export function ChartDefaultsPreview({draft}) {
  const frame = draft.defaultTimeframe;
  const {bars, series} = useMemo(() => chartDefaultsExample(frame), [frame]);
  const [cursor, setCursor] = useState(null);
  const clip = useId(), plot = useRef(null);
  const [width, setWidth] = useState(590);
  useLayoutEffect(() => {
    const element = plot.current;
    const resize = () => setWidth(Math.max(200, Math.round(element.getBoundingClientRect().width)));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const height = Math.min(355, Math.max(190, width * .46)), right = width - 58, bottom = height - 31;
  const enabled = INDICATORS.filter(item => draft.enabled[item.key] && item.series.some(key => series[key].some(Number.isFinite)));
  const prices = bars.flatMap(bar => bar.ohlc.slice(2));
  if (draft.fitLevels && draft.showLevels) prices.push(...bands.flatMap(([low, high]) => [low, high]));
  if (draft.fitIndicators) for (const item of enabled) for (const key of item.series) prices.push(...series[key].filter(Number.isFinite));
  const floor = Math.min(...prices), ceiling = Math.max(...prices), pad = Math.max(.2, (ceiling - floor) * .10);
  const roughStep = (ceiling - floor + 2 * pad) / 8;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const step = [1, 2, 2.5, 5, 10].find(n=>n*magnitude>=roughStep) * magnitude;
  const min = Math.floor((floor-pad) / step) * step, max = Math.ceil((ceiling+pad) / step) * step;
  const ticks = Array.from({length:Math.round((max-min)/step)+1}, (_, i)=>max - i*step);
  const spacing = (right - left) / (bars.length + 6);
  const x = i => left + (i + .6) * spacing;
  const y = v => bottom - (v - min) / (max - min) * (bottom - top);
  const last = bars.at(-1).ohlc[1];
  const sameDay = bars[0].date === bars.at(-1).date;
  const axisDate = sameDay ? timeLabel : ['W','M'].includes(frame) ? monthLabel : dateLabel;
  const indexes = (width < 370 ? [0, .5, 1] : [0, .25, .5, .75, 1]).map(f => Math.round((bars.length - 1) * f));
  const hovered = draft.hoverValues && cursor !== null ? bars[cursor] : null;
  const sma = enabled.some(item => item.key.startsWith('sma'));
  const previous = enabled.some(item => item.cross);
  const legend = [
    [draft.enabled.ema, 'EMA 9 / 21', '#777383'], [enabled.some(i => i.key === 'vwap'), 'Session VWAP', '#443058'],
    [previous, 'Previous day', '#a18330'], [sma, 'Daily SMAs', '#148790'],
    [draft.showLevels, 'Imported levels', '#79c58d'], [draft.drawingsVisible, 'Drawing', draft.drawingColor],
  ];
  function move(event) {
    if (!draft.hoverValues) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const at = (event.clientX - rect.left) * width / rect.width;
    if (at < left || at > right || (event.clientY - rect.top) * height / rect.height > bottom) {
      setCursor(null);
      return;
    }
    setCursor(Math.max(0, Math.min(bars.length - 1, Math.round((at - left) / spacing - .6))));
  }
  return <section className="cd-card cd-preview">
    <h3>Chart preview</h3><p>Illustrative candles · {frame} · enabled overlays</p>
    <div className="cd-plot" ref={plot}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Illustrative ${frame} candlestick chart`} tabIndex={draft.hoverValues ? 0 : undefined}
        onPointerMove={move} onPointerLeave={() => setCursor(null)} onBlur={() => setCursor(null)}
        onKeyDown={e => {if (draft.hoverValues && ['ArrowLeft','ArrowRight'].includes(e.key)) {e.preventDefault();setCursor(i => Math.max(0, Math.min(bars.length - 1, (i ?? bars.length - 1) + (e.key === 'ArrowLeft' ? -1 : 1))));}}}>
        <defs><clipPath id={clip}><rect x={left} y={top} width={right-left} height={bottom-top}/></clipPath></defs>
        {ticks.map((value, i) => {
          return <g key={i}><line className="cd-gridline" x1={left} x2={right} y1={y(value)} y2={y(value)}/>{Math.abs(y(value) - y(last)) > 13 && <text x={right+8} y={y(value)+4}>{value.toFixed(2)}</text>}</g>;
        })}
        {indexes.map(i => <g key={i}><line className="cd-gridline" x1={x(i)} x2={x(i)} y1={top} y2={bottom}/><text x={x(i)} y={bottom+20} textAnchor={i === 0 ? 'start' : 'middle'}>{axisDate.format(bars[i].timestamp*1000)}</text></g>)}
        <g clipPath={`url(#${clip})`}>
          {draft.showLevels && <g data-overlay="levels">{bands.map(([low, high, color]) => <rect key={low} x={x(21)} y={y(high)} width={right-x(21)} height={y(low)-y(high)} fill={color} opacity=".32"/>)}</g>}
          {draft.enabled.ema && <g>{ribbonSegments(series.ema9, series.ema21).map((segment, i) => <polygon key={i} points={segment.points.map(([index, v]) => [x(index), y(v)].join(',')).join(' ')} fill={segment.bull ? '#168450' : '#d85166'} opacity=".12"/>)}</g>}
          {enabled.map(item => <g key={item.key} data-overlay={item.key}>{item.series.map(key =>
            item.cross ? <path key={key} d={series[key].map((v, i) => Number.isFinite(v) ? `M${x(i)-1.4} ${y(v)}h2.8m-1.4 -1.4v2.8` : '').join(' ')} fill="none" stroke={item.color} strokeWidth=".8"/> :
            <path key={key} d={linePath(series[key], x, y, key==='vwap' ? bars : null)} stroke={key==='ema21' ? '#9e9aa7' : item.color} fill="none" strokeWidth={key==='vwap' ? 2 : 1.45}/>)}</g>)}
          {bars.map(({ohlc:[open, close, low, high]}, i) => <g key={i} fill={close>=open?'#118650':'#d63e54'} stroke={close>=open?'#118650':'#d63e54'}><line x1={x(i)} x2={x(i)} y1={y(high)} y2={y(low)}/><rect x={x(i)-spacing*.29} width={spacing*.58} y={Math.min(y(open), y(close))} height={Math.max(1, Math.abs(y(open)-y(close)))}/></g>)}
          {draft.drawingsVisible && <line data-overlay="drawing" x1={x(15)} x2={x(44)} y1={y(bars[15].ohlc[2] - pad*.45)} y2={y(bars[44].ohlc[2]-pad*.45)} stroke={draft.drawingColor} strokeDasharray="5 4" strokeWidth="1.75"/>}
          <line x1={left} x2={right} y1={y(last)} y2={y(last)} stroke="var(--primary)" strokeDasharray="4 3" opacity=".7"/>
          {hovered && <line x1={x(cursor)} x2={x(cursor)} y1={top} y2={bottom} stroke="var(--muted)" strokeDasharray="3 3"/>}
        </g>
        <rect x={right} width="55" height="17" y={y(last)-8.5} rx="3" fill="var(--primary)"/><text className="cd-last-price" x={right+27.5} y={y(last)+4} textAnchor="middle">{last.toFixed(2)}</text>
      </svg>
      {hovered && <div className="cd-reading"><strong>{dateLabel.format(hovered.timestamp*1000)} · {frame}</strong><span>Close {hovered.ohlc[1].toFixed(2)}</span>{enabled.flatMap(item => item.series.map(key => <span key={key}>{seriesNames[key] || key.toUpperCase()} {series[key][cursor]?.toFixed(2) ?? '—'}</span>))}</div>}
    </div>
    <div className="cd-legend">{legend.filter(([on]) => on).map(([, label, color]) => <span key={label}><i style={{background:color}}/>{label}</span>)}</div>
  </section>;
}
