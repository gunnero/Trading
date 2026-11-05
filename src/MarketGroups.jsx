import {useDisplayTime} from './DisplayTime';
import {useEffect,useId,useRef,useState} from 'react';
import {CaretLeft,CaretRight,CaretDown,ChartLine,Stack,Gauge,Info} from '@phosphor-icons/react';
import {Sparkline} from './Charts';
import {CONTEXT_INSTRUMENTS} from './data/market-context.mjs';
import {quotePrice,quoteChange,quoteTone,quoteDelay} from './data/quotes.mjs';
import './market-ticker.css';

const icons={indicators:Gauge,futures:ChartLine,funds:Stack};
const labels={indicators:'Market Indicators',futures:'Futures',funds:'Funds / ETFs'};
function readingStatus(result){
  if(!result?.quote)return result?.status==='loading'?'Fetching source…':'No source reading';
  return `${result.status==='stale'?'Cached / old · ':''}${quoteDelay(result.quote)}`;
}

export function MarketGroups({groups,quotes,onOpen}){
  const {quoteStamp}=useDisplayTime(),detailsId=useId(),track=useRef(null);
  const [selected,setSelected]=useState('indicators'),[showSources,setShowSources]=useState(false);
  const [edges,setEdges]=useState({start:true,end:true});
  const group=groups.find(item=>item.id===selected)||groups[0],Icon=icons[group.id]||Gauge;
  useEffect(()=>{
    const node=track.current;
    const update=()=>setEdges({start:node.scrollLeft<=2,end:node.scrollLeft+node.clientWidth>=node.scrollWidth-2});
    node.scrollLeft=0;update();
    const observer=new ResizeObserver(update);observer.observe(node);
    for(const child of node.children)observer.observe(child);
    node.addEventListener('scroll',update,{passive:true});
    return ()=>{observer.disconnect();node.removeEventListener('scroll',update);};
  },[group.id,group.items.length]);
  function scroll(direction){
    const node=track.current;
    node.scrollBy({left:direction*Math.max(160,node.clientWidth*.8),behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  }
  return <section className="market-groups market-ticker" aria-label="Market context">
    <div className="market-ticker-bar">
      <div className="market-ticker-selector">
        <div className="market-ticker-select"><Icon size={20} aria-hidden="true"/><select aria-label="Market group" value={group.id} onChange={event=>setSelected(event.target.value)}>{groups.map(item=><option key={item.id} value={item.id}>{labels[item.id]||item.label}</option>)}</select><CaretDown size={12} aria-hidden="true"/></div>
        <div className="market-ticker-credit"><span>{group.items.length} instruments</span><button type="button" aria-label="Sources and quote times" aria-expanded={showSources} aria-controls={detailsId} onClick={()=>setShowSources(value=>!value)}><Info size={15}/></button></div>
      </div>
      <div className="market-ticker-track" ref={track} role="group" aria-label={group.label}>
        {group.items.map(item=>{
          const {key,label,entry}=item,result=quotes[key],q=result?.quote;
          const metadata=`${readingStatus(result)} · ${q?quoteStamp(q):entry?.id||'Awaiting source'}`;
          return <button type="button" className="market-ticker-quote" key={entry?.id||key} aria-label={`Open ${label} ${CONTEXT_INSTRUMENTS.some(([value])=>value===key)?'chart':'details'}`} aria-haspopup="dialog" title={`${label} · ${metadata}`} onClick={()=>onOpen(group.id,item)}>
            <span className="market-ticker-values"><strong className="market-ticker-symbol">{label}</strong><span className="market-ticker-price">{quotePrice(q)}</span><span className={`market-ticker-change ${quoteTone(q)}`}>{q?quoteChange(q):result?.status==='loading'?'Loading…':'Unavailable'}</span></span>
            {q?.trend?.length>1&&<Sparkline tone={quoteTone(q)} data={q.trend}/>}
            {q&&result.status==='stale'&&<span className="market-ticker-stale">Cached / old</span>}
            <span className="sr-only">{metadata}</span>
          </button>;
        })}
        {!group.items.length&&<p className="market-ticker-empty">Add {group.id==='funds'?'funds or ETFs':'futures'} to your watchlist to see them here.</p>}
      </div>
      <div className="market-ticker-nav" aria-label="Browse market quotes"><button type="button" aria-label="Previous instruments" disabled={edges.start} onClick={()=>scroll(-1)}><CaretLeft size={17}/></button><button type="button" aria-label="Next instruments" disabled={edges.end} onClick={()=>scroll(1)}><CaretRight size={17}/></button></div>
    </div>
    {showSources&&<div className="market-ticker-sources" id={detailsId}><p>{group.source}</p><dl>{group.items.map(({key,label,entry})=><div key={entry?.id||key}><dt>{label}</dt><dd>{readingStatus(quotes[key])}<span>{quotes[key]?.quote?quoteStamp(quotes[key].quote):'Awaiting source'}</span></dd></div>)}</dl></div>}
  </section>;
}
