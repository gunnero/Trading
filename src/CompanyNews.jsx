import {ArrowsClockwise,ArrowUpRight,Info,Newspaper} from '@phosphor-icons/react';
import {useDisplayTime} from './DisplayTime';
import {useFeed,Unavailable} from './Feeds';
import {NewsImage} from './Briefing';

export function CompanyNews({symbol}){
 const feed=useFeed(`/api/news?symbols=${encodeURIComponent(symbol)}`),{marketTime,clockStamp,zoneLabel}=useDisplayTime();
 const articles=feed.data?.articles||[];
 return <section className="company-news" aria-label={`${symbol} news`}>
  <header><h2>{symbol} headlines</h2><button className="icon-button" aria-label="Refresh headlines" disabled={feed.status==='loading'||feed.refreshing} onClick={feed.refresh}><ArrowsClockwise size={20}/></button>{feed.fetchedAt&&<span>Updated {clockStamp(feed.fetchedAt)} {zoneLabel}</span>}</header>
  <p className="company-news-note"><Info size={16}/>Yahoo Finance headlines · Open the original publisher to read the article</p>
  {!feed.data?<Unavailable feed={feed}/>:!articles.length?<div className="feed-empty"><Newspaper size={24}/><strong>No headlines returned for {symbol}</strong><p>The publisher has no recent stories for this listing.</p></div>:<div className="company-news-list">{articles.map((a,i)=><a key={a.id} className={`company-news-article ${i===0?'company-news-lead':''}`} href={a.url} target="_blank" rel="noopener noreferrer"><NewsImage image={a.image} priority={i===0}/><div>{i===0&&<span className="news-lead-label">Latest headline</span>}<h3>{a.title}</h3><p>{a.publisher} · {a.publishedAt?<time dateTime={a.publishedAt}>{marketTime(a.publishedAt)} {zoneLabel}</time>:'Time not supplied'}</p></div><ArrowUpRight size={18}/></a>)}</div>}
  {feed.status==='stale'&&<p className="company-news-warning" role="status"><Info size={16}/>Showing cached headlines while the source reconnects. <button onClick={feed.refresh}>Retry</button></p>}
  <details className="company-disclosure"><summary>Sources & refresh</summary><p>Yahoo Finance · refreshes automatically every 10 minutes. Publisher selection may include related companies and global stories. Preview images appear only when supplied. Original articles may require a subscription.</p></details>
 </section>;
}
