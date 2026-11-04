import {useState} from 'react';
import {ArrowsClockwise,CaretRight,Newspaper} from '@phosphor-icons/react';
import {PageHeader} from './PageHeader';
import {NewsImage} from './Briefing';
import {useDisplayTime} from './DisplayTime';
import {useFeed,useMinuteClock,Unavailable} from './Feeds';
import {quotePrice,quoteTone,quoteDelay} from './data/quotes.mjs';
import './news.css';

const YAHOO='https://finance.yahoo.com/';
function NewsQuotes({quotes,onOpen}){
  const {quoteStamp}=useDisplayTime();
  return <section className="news-quotes" aria-label="Market context">{['NQ','ES','VIX'].map(symbol=>{
    const result=quotes[symbol],q=result?.quote,percent=q?.changePercent;
    const detail=q?`Yahoo Finance · ${quoteDelay(q)} · ${quoteStamp(q)}${result.status==='stale'?' · Cached / old quote':''}`:result?.message||'Source reading unavailable';
    return <button key={symbol} aria-label={`Open ${symbol} chart`} aria-haspopup="dialog" title={detail} onClick={()=>onOpen(symbol)}><strong>{symbol}</strong><span>{quotePrice(q)}</span><b className={quoteTone(q)}>{Number.isFinite(percent)?`${percent>=0?'+':''}${percent.toFixed(2)}%`:'—'}</b>{(!q||result.status==='stale')&&<small className="amber">{q?'Cached':result?.status==='loading'?'Loading…':'Unavailable'}</small>}<span className="sr-only">{detail}</span></button>;
  })}</section>;
}
function Article({article,lead=false}){
  const {marketTime,zoneLabel}=useDisplayTime();
  return <a className={`news-article ${lead?'news-lead':''}`} href={article.url} target="_blank" rel="noopener noreferrer">
    <NewsImage image={article.image} priority={lead}/><div className="news-article-copy">
      {lead&&<span className="news-lead-label">Latest headline</span>}<h3>{article.title}</h3>
      <div className="news-article-meta"><span className="news-meta">{article.publisher}<span>·</span>{article.publishedAt?<time dateTime={article.publishedAt}>{marketTime(article.publishedAt)} {zoneLabel}</time>:<span>Time not supplied</span>}</span>{lead&&<span className="news-read-original">Read original article<CaretRight size={14}/></span>}</div>
      {lead&&<p className="news-image-note">Publisher images appear when available.</p>}
    </div>{!lead&&<CaretRight size={15}/>}</a>;
}
function articleGroups(articles,now,displayDay,marketTime){
  const groups=new Map(),today=displayDay(now);
  for(const article of articles){
    const time=Date.parse(article.publishedAt),day=Number.isFinite(time)?displayDay(time):null;
    const label=!day?'Time not supplied':day===today?(time>=now-2*60*60*1000?'Newest':'Earlier today'):marketTime(time,{hour:undefined,minute:undefined,year:'numeric'});
    if(!groups.has(label))groups.set(label,[]);
    groups.get(label).push(article);
  }
  return [...groups];
}
export default function NewsPage({watchlist,marketFeed,quotes,onOpenMarket}){
  const {marketTime,clockTime,displayDay,zoneLabel,quoteStamp}=useDisplayTime(),now=useMinuteClock();
  const [scope,setScope]=useState('markets'),[selected,setSelected]=useState('all'),[economy,setEconomy]=useState(false);
  const stocks=watchlist.filter(x=>['STOCKS','FUND','DEPOSITARY RECEIPT'].includes(x.group)&&['NASDAQ','NYSE','AMEX','CBOE','NYSEARCA','NYSEAMERICAN','BATS'].includes(x.exchange));
  const current=selected==='all'||stocks.some(s=>s.symbol===selected)?selected:'all';
  const symbols=current==='all'?stocks.map(s=>s.symbol):[current];
  const watchFeed=useFeed(scope==='watchlist'&&symbols.length?`/api/news?symbols=${encodeURIComponent([...new Set(symbols)].sort().join(','))}`:null);
  const feed=scope==='markets'?marketFeed:watchFeed,emptyWatch=scope==='watchlist'&&!symbols.length;
  const articles=(feed.data?.articles||[]).filter(a=>!economy||a.economy),lead=articles[0];
  const groups=articleGroups(articles.slice(1),now,displayDay,marketTime),stamp=feed.fetchedAt;
  const status=emptyWatch?'No listings':feed.status==='loading'?'Loading…':feed.status==='stale'?'Cached':feed.status==='unavailable'?'Unavailable':null;
  const source=<div className="news-source-status"><span>Source: <a href={YAHOO} target="_blank" rel="noopener noreferrer">Yahoo Finance</a>{stamp&&<> · Last refresh: <time dateTime={stamp} title={`${marketTime(stamp)} ${zoneLabel}`}>{displayDay(stamp)===displayDay(now)?clockTime(stamp):marketTime(stamp)} {zoneLabel}</time></>}{status&&<span className="amber"> · {status}</span>}</span><button className="icon-button" aria-label="Refresh source" title="Refresh headlines" onClick={feed.refresh} disabled={emptyWatch||feed.status==='loading'||feed.refreshing}><ArrowsClockwise size={17}/></button></div>;
  return <div className="news-page"><PageHeader title="News" description="Headlines for your U.S. session." actions={source} beforeNavigation={<NewsQuotes quotes={quotes} onOpen={onOpenMarket}/>}/>
    <section className="news-panel" aria-label="Market and watchlist news">
      <div className="news-controls"><div className="segmented" role="group" aria-label="News scope">{[['markets','U.S. market'],['watchlist','My watchlist']].map(([value,label])=><button key={value} className={scope===value?'selected':''} aria-pressed={scope===value} onClick={()=>{setScope(value);if(value==='markets')setSelected('all');}}>{label}</button>)}</div><select aria-label="News symbol" value={current} onChange={e=>{setSelected(e.target.value);setScope('watchlist');}}><option value="all">Ticker: All</option>{stocks.map(s=><option key={s.id} value={s.symbol}>{s.symbol}</option>)}</select><label className="check-label"><input type="checkbox" checked={economy} onChange={e=>setEconomy(e.target.checked)} aria-label="Economy headlines only"/>Economy only</label></div>
      {emptyWatch?<div className="feed-empty"><strong>No U.S. listings in this watchlist</strong><p>Add stocks, ETFs or ADRs to follow their news.</p></div>:!feed.data?<Unavailable feed={feed}/>:!lead?<div className="feed-empty"><Newspaper size={26}/><strong>No headlines returned for this selection</strong><p>Try another ticker or turn off the economy filter.</p></div>:<div className="news-list"><Article article={lead} lead/>{groups.map(([label,items])=><section className="news-group" key={label} aria-label={label}><h2>{label}</h2>{items.map(article=><Article key={article.id} article={article}/>)}</section>)}</div>}
      {feed.status==='stale'&&<p className="news-warning" role="status">Showing cached headlines while the source reconnects.</p>}
      <footer className="news-footer"><div><span>Automatic refresh: every 10 min.</span><span>Source: Yahoo Finance{status?` (${status.toLowerCase()})`:''}.</span></div><details><summary>Source details</summary><p>{scope==='markets'?'Headlines from SPY, QQQ, IWM and DIA feeds.':`Yahoo headlines for ${current==='all'?'the U.S.-listed stocks, ETFs and ADRs in your watchlist':current}.`} {economy?'Economy view matches topics such as the Fed, inflation and jobs in returned headlines.':'Publisher selection may include related companies and global stories affecting U.S. markets.'} Newest groups articles from the last two hours today in {zoneLabel}. Original articles may require a subscription.</p><p>Market context uses Yahoo Finance quotes. {['NQ','ES','VIX'].map(symbol=>{const result=quotes[symbol],q=result?.quote;return <span key={symbol}>{symbol}: {q?`${quoteDelay(q)} · ${quoteStamp(q)}${result.status==='stale'?' · Cached / old':''}`:'Unavailable'}. </span>;})}</p></details></footer>
    </section>
  </div>;
}
