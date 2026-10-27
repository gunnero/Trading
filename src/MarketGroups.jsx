import {useState} from 'react';
import {CaretRight,CaretDown,ChartLine,Stack,Gauge} from '@phosphor-icons/react';
import {Sparkline} from './Charts';
import {CONTEXT_INSTRUMENTS} from './data/market-context.mjs';
import {quotePrice,quoteChange,quoteTone,quoteDelay,quoteStamp} from './data/quotes.mjs';

const icons={indicators:Gauge,futures:ChartLine,funds:Stack};
export function MarketGroups({groups,quotes,onOpen}){
  const [compact]=useState(()=>window.matchMedia('(max-width:1100px)').matches);
  return <section className="market-groups macro-strip" aria-label="Market context">{groups.map(group=>{
    const Icon=icons[group.id];
    return <details className={`market-group market-group-${group.id}`} key={group.id} open={!compact}>
      <summary><Icon size={17}/><h2>{group.label}</h2><span className="market-group-count">{group.items.length}</span><CaretDown size={15} className="market-group-chevron"/></summary>
      <div className="market-group-list" role="group" aria-label={group.label} tabIndex={0}>
        {group.items.map(({key,label,entry})=>{const result=quotes[key],q=result?.quote;return <button type="button" className="market-group-quote" key={entry?.id||key} aria-label={`Open ${label} ${CONTEXT_INSTRUMENTS.some(([item])=>item===key)?'chart':'details'}`} aria-haspopup="dialog" onClick={()=>onOpen(group.id,{key,label,entry})}>
          <span className="market-quote-main"><strong className="market-quote-symbol">{label}</strong>{q?.trend?.length>1?<Sparkline tone={quoteTone(q)} data={q.trend}/>:<span/>}<strong className="market-quote-price">{quotePrice(q)}</strong><span className={`market-quote-change ${quoteTone(q)}`}>{q?quoteChange(q):result?.status==='loading'?'Loading…':'Unavailable'}</span><CaretRight size={13}/></span>
          <span className="market-quote-meta"><span className={result?.status==='stale'?'amber':''}>{q?`${result.status==='stale'?'Cached / old · ':''}${quoteDelay(q)}`:result?.status==='loading'?'Fetching source…':'No source reading'}</span><span>{q?quoteStamp(q):entry?.id||'Awaiting source'}</span></span>
        </button>;})}
        {!group.items.length&&<p className="market-group-empty">Add {group.id==='funds'?'funds or ETFs':'futures'} to your watchlist to see them here.</p>}
      </div>
      <p className="market-group-source"><span>{group.source}</span>{group.items.length>5&&<span className="market-group-more">Scroll for more ↓</span>}</p>
    </details>;
  })}</section>;
}
