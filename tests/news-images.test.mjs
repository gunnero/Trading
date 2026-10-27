import test from 'node:test';
import assert from 'node:assert/strict';
import {createFeedService,parseNews} from '../server/feeds.mjs';
import {newsImageUrl,parseArticleImage} from '../server/news-images.mjs';
const date='Sat, 24 Oct 2026 15:00:00 GMT';
const rss=items=>`<rss xmlns:media="http://search.yahoo.com/mrss/"><channel>${items.map(({url='https://finance.yahoo.com/news/fed.html',media=''})=>`<item><title>Fed announcement</title><link>${url}</link><pubDate>${date}</pubDate>${media}</item>`).join('')}</channel></rss>`;
const photo='https://s.yimg.com/finance/photo.jpg';
const html=`<html><head><meta content="${photo}?a=1&amp;b=2" property="og:image"><meta property='og:image:alt' content='Market &amp; stocks'></head><body>Not imported</body></html>`;
const htmlResponse=body=>new Response(body,{headers:{'Content-Type':'text/html; charset=utf-8'}});

test('RSS and Open Graph preserve real images and decode metadata without accepting unsafe hosts',()=>{
 const article=parseNews(rss([{media:`<media:content medium="image" url="${photo}"/>`}]))[0];
 assert.deepEqual(article.image,{url:photo,alt:''});
 assert.deepEqual(parseArticleImage(html),{url:`${photo}?a=1&b=2`,alt:'Market & stocks'});
 assert.deepEqual(parseArticleImage(`<meta name="twitter:image" content="${photo}">`),{url:photo,alt:''});
 for(const url of ['http://s.yimg.com/image.jpg','https://s.yimg.com:8443/image.jpg','https://localhost/a','https://127.0.0.1/a','https://s.yimg.com.evil.com/a','https://x:y@s.yimg.com/a','javascript:alert(1)','data:image/png;base64,abc']) {
  assert.equal(newsImageUrl(url),null);
  assert.equal(parseArticleImage(`<meta property="og:image" content="${url}">`),null);
 }
 assert.equal(parseNews(rss([{media:`<enclosure type="video/mp4" url="${photo}"/>`}]))[0].image,null);
});

test('News images share a persisted cache across symbols and retain source publication timestamps',async()=>{
 let requests=0;const cache=new Map();const now=()=>Date.parse('2026-10-24T16:00:00Z');
 const service=createFeedService({cache,now,fetcher:async(url,options)=>{
  if(url.includes('/rss/'))return new Response(rss([{}]));
  requests++;assert.equal(options.redirect,'error');return htmlResponse(html);
 }});
 const [first,second]=await Promise.all([service.get('news','SPY'),service.get('news','QQQ')]);
 assert.equal(requests,1);assert.equal(first.status,'ok');assert.deepEqual(first.data.articles,second.data.articles);
 assert.equal(first.data.articles[0].publishedAt,'2026-10-24T15:00:00.000Z');
 assert.equal(first.data.articles[0].image.url,`${photo}?a=1&b=2`);
 const restored=createFeedService({now,cache:new Map(JSON.parse(JSON.stringify([...cache]))),fetcher:async url=>{
  assert.ok(url.includes('/rss/'));return new Response(rss([{}]));
 }});
 assert.equal((await restored.get('news','IWM')).data.articles[0].image.url,`${photo}?a=1&b=2`);
});

test('Image requests are bounded, skip unknown publishers and keep headlines when a preview fails',async()=>{
 let requests=0;
 const articles=Array.from({length:12},(_,i)=>({url:`https://finance.yahoo.com/news/${i}.html`}));
 const service=createFeedService({fetcher:async url=>{
  if(url.includes('/rss/'))return new Response(rss(articles));
  requests++;if(url.endsWith('/0.html'))throw new Error('Timeout');
  if(url.endsWith('/1.html'))return htmlResponse('<head>No image</head>');
  return htmlResponse(html);
 }});
 const result=await service.get('news','SPY');
 assert.equal(result.status,'ok');assert.equal(result.data.articles.length,12);assert.equal(requests,8);
 assert.equal(result.data.articles.filter(a=>a.image).length,6);
 const unknown=createFeedService({fetcher:async url=>{
  assert.ok(url.includes('/rss/'));return new Response(rss([{url:'https://unknown.example/story'},{url:'https://finance.yahoo.com:8443/story'}]));
 }});
 assert.equal((await unknown.get('news','QQQ')).data.articles.length,2);
});

test('Publisher blocks back off across articles and survive restarts without making news unavailable',async()=>{
 let requests=0,time=Date.parse('2026-10-24T16:00:00Z');const cache=new Map();
 const service=createFeedService({cache,now:()=>time,fetcher:async url=>{
  if(url.includes('/rss/'))return new Response(rss([{url:`https://finance.yahoo.com/news/${new URL(url).searchParams.get('s')}.html`}]));
  requests++;return new Response('',{status:429,headers:{'Retry-After':'7200'}});
 }});
 assert.equal((await service.get('news','SPY')).status,'ok');assert.equal(requests,1);
 time+=61*60_000;
 assert.equal((await service.get('news','QQQ')).data.articles[0].image,null);assert.equal(requests,1);
 const restored=createFeedService({now:()=>time,cache:new Map(JSON.parse(JSON.stringify([...cache]))),fetcher:async url=>{
  assert.ok(url.includes('/rss/'));return new Response(rss([{url:'https://finance.yahoo.com/news/IWM.html'}]));
 }});
 assert.equal((await restored.get('news','IWM')).status,'ok');
 time+=60*60_000;await service.get('news','DIA');assert.equal(requests,2);
});

test('Existing text-only feed caches gain previews without refetching RSS or changing freshness/backoff',async()=>{
 const time=Date.parse('2026-10-24T16:00:00Z'),fetchedAt='2026-10-24T15:50:00Z',retryAt=time+60_000;
 const oldArticles=parseNews(rss([{}]));delete oldArticles[0].image;
 const cache=new Map([['news:SPY',{result:{status:'stale',fetchedAt,data:{articles:oldArticles,symbols:['SPY']}},retryAt}]]);
 let requests=0;
 const service=createFeedService({cache,now:()=>time,fetcher:async url=>{requests++;assert.ok(!url.includes('/rss/'));return htmlResponse(html);}});
 const result=await service.get('news','SPY');
 assert.equal(result.status,'stale');assert.equal(result.fetchedAt,fetchedAt);assert.equal(cache.get('news:SPY').retryAt,retryAt);
 assert.equal(result.data.articles[0].image.url,`${photo}?a=1&b=2`);
 await service.get('news','SPY');assert.equal(requests,1);
});
