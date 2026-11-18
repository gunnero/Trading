import {useState} from 'react';
import {ArrowsClockwise, ArrowSquareOut, CaretDown, CaretUp, Info, Newspaper} from '@phosphor-icons/react';
import {useDisplayTime} from './DisplayTime';
import {useFeed} from './Feeds';
import {NewsImage} from './Briefing';
import './company-news.css';

const pageSize = 5;

export function CompanyNews({symbol, children}) {
  const [limit, setLimit] = useState(pageSize);
  const feed = useFeed(`/api/news?symbols=${encodeURIComponent(symbol.replaceAll('.', '-'))}`);
  const {marketTime, clockStamp, zoneLabel} = useDisplayTime();
  const articles = feed.data?.articles || [];
  const hasMore = articles.length > limit;
  const loading = feed.status === 'loading';
  const unavailable = feed.status === 'unavailable';
  const cached = feed.status === 'stale';
  const busy = loading || feed.refreshing;

  return <section className="company-news" aria-label={`${symbol} news`}>
    <header className="company-news-heading">
      <h2>{symbol} headlines</h2>
      <button className="icon-button" aria-label="Refresh headlines" disabled={busy} onClick={feed.refresh}>
        <ArrowsClockwise size={21}/>
      </button>
      {feed.fetchedAt && <span>{cached ? 'Cached' : 'Updated'} <time dateTime={feed.fetchedAt}>{clockStamp(feed.fetchedAt)} {zoneLabel}</time></span>}
    </header>
    <p className="company-news-note"><Info size={17}/>Yahoo Finance headlines · Open the original publisher to read the article</p>

    {loading && <div className="company-news-notice" role="status"><ArrowsClockwise size={18}/>Loading headlines…</div>}
    {articles.length > 0 && <ul className="company-news-list">
      {articles.slice(0, limit).map((article, index) => <li key={article.id}>
        <a className={`company-news-article${index === 0 ? ' company-news-lead' : ''}`}
          href={article.url} target="_blank" rel="noopener noreferrer">
          <NewsImage image={article.image} priority={index === 0}/>
          <div className="company-news-copy">
            {index === 0 && <span className="news-lead-label">Latest headline</span>}
            <h3>{article.title}</h3>
            <p>{article.publisher} · {article.publishedAt
              ? <time dateTime={article.publishedAt}>{marketTime(article.publishedAt)} {zoneLabel}</time>
              : 'Time not supplied'}</p>
          </div>
          <ArrowSquareOut size={18} aria-hidden="true"/>
        </a>
      </li>)}
    </ul>}
    {feed.data && !articles.length && !cached && <div className="company-news-notice" role="status">
      <Newspaper size={18}/>No headlines returned for {symbol}.
    </div>}
    {articles.length > pageSize && <div className="company-news-pagination">
      <span role="status">Showing {Math.min(limit, articles.length)} of {articles.length} headlines</span>
      <button className="button" onClick={() => setLimit(value => hasMore ? value + pageSize : pageSize)}>
        {hasMore ? <>Show more <CaretDown size={14}/></> : <>Show less <CaretUp size={14}/></>}
      </button>
    </div>}
    {(unavailable || cached) && <div className="company-news-notice" role="status">
      <Info size={18}/><span>{cached && articles.length ? 'Showing cached headlines from the last update.' : 'Headlines temporarily unavailable.'}</span>
      <button disabled={busy} onClick={feed.refresh}>Retry</button>
    </div>}
    <details className="company-disclosure company-news-sources">
      <summary>Sources &amp; refresh</summary>
      <p>This tab checks Yahoo Finance for headlines every 10 minutes. The ticker feed may include related companies and global stories. Publishers may require a subscription.</p>
      {(unavailable || cached) && feed.message && <p>{feed.message}</p>}
      {children}
    </details>
  </section>;
}
