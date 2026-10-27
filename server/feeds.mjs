import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { marketDay, validDay, weekRange, validateRange, eventDay } from '../src/data/calendar.mjs';
import { rssImage, createNewsImages } from './news-images.mjs';
import {createSentimentService} from './sentiment.mjs';

export const SOURCES = {
  // Daily fallback. The sentiment resolver also checks an hourly public mirror
  // and chooses by CNN observation time. Neither source bypasses CNN's block.
  sentiment: { name: 'CNN Fear & Greed', url: 'https://edition.cnn.com/markets/fear-and-greed', feed: 'https://raw.githubusercontent.com/whit3rabbit/fear-greed-data/main/json/cnn_output.json', delivery: 'daily', via: { name: 'Community archive', url: 'https://github.com/whit3rabbit/fear-greed-data' } },
  calendar: { name: 'Forex Factory', url: 'https://www.forexfactory.com/calendar', feed: 'https://nfs.faireconomy.media/ff_calendar_thisweek.json' },
  news: { name: 'Yahoo Finance', url: 'https://finance.yahoo.com/' },
};
const PLANNING_SOURCE = { name:'Finance Calendar', url:'https://www.financecalendar.com', feed:'https://www.financecalendar.com/wp-json/fc/v1/calendar' };
const text = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim().slice(0,600) : '';
const iso = value => value != null && value !== '' && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : null;
const score = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
export function parseSentiment(raw) {
  const item = raw?.fear_and_greed;
  const rating = text(item?.rating).toLowerCase();
  if (score(item?.score) === null || !iso(item?.timestamp) || !['extreme fear','fear','neutral','greed','extreme greed'].includes(rating)) throw new Error('The CNN archive returned an unrecognized reading.');
  return { score: item.score, rating, observedAt: iso(item.timestamp), previousClose: score(item.previous_close), previousWeek: score(item.previous_1_week), previousMonth: score(item.previous_1_month) };
}
function readingFreshness(kind, result, now) {
  if (kind !== 'sentiment' || !result.data) return result;
  const age = now - Date.parse(result.data.observedAt);
  // A successful download must not make an old archive look current. Four days
  // accommodates weekends/long weekends; timestamps are always shown as supplied.
  if (!Number.isFinite(age) || age < -5*60_000 || age > 7*24*60*60_000) return { ...result, status:'unavailable', data:null, message:'The automatic source has no recent, valid reading. Retrying automatically.' };
  if (age > 4*24*60*60_000) return { ...result, status:'stale', message:'This reading is over four days old. Waiting for an updated source snapshot.' };
  return result;
}
export function parseCalendar(raw) {
  if (!Array.isArray(raw) || raw.some(row => !row || !text(row.country) || !text(row.title) || !iso(row.date))) throw new Error('The calendar export could not be read.');
  const events = raw.filter(row => row.country === 'USD').map((row, i) => ({ id: `${row.date}-${i}`, title: text(row.title), country: 'US', currency: 'USD', date: iso(row.date), impact: ['High','Medium','Low','Holiday'].includes(row.impact) ? row.impact : 'Other', forecast: text(row.forecast) || null, previous: text(row.previous) || null, actual: text(row.actual) || null }));
  events.sort((a,b) => a.date.localeCompare(b.date));
  const dates = raw.map(x => iso(x.date)).sort();
  return { events, coverageStart: dates[0] || null, coverageEnd: dates.at(-1) || null };
}
const safeLink = value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; } };
export function parsePlanningCalendar(raw, range) {
  if (!Array.isArray(raw?.events) || !Number.isInteger(raw.total) || raw.total !== raw.events.length || raw.from !== range.from || raw.to !== range.to) throw new Error('The future calendar returned an incomplete date range.');
  const seen = new Set();
  const events = raw.events.filter(row => row.country === 'US' && row.category !== 'crypto').map(row => {
    if (!text(row.id) || seen.has(row.id) || !text(row.name || row.title) || !validDay(row.date) || row.date < range.from || row.date > range.to || (row.release_at_utc && !iso(row.release_at_utc))) throw new Error('The future calendar contains an unreadable event.');
    seen.add(row.id);
    const date = row.all_day || !['minute','second'].includes(row.time_precision) ? null : iso(row.release_at_utc);
    const impact = row.category === 'market-holidays' ? 'Holiday' : ({high:'High',medium:'Medium',low:'Low'}[row.impact] || 'Other');
    return {
      id:text(row.id), title:text(row.name || row.title), country:'US', currency:'USD', date,
      calendarDate:date ? marketDay(date) : row.date,
      timeLabel:row.all_day ? 'All day' : row.status === 'estimated' ? 'Tentative' : 'Time TBA',
      impact, forecast:text(row.consensus) || null, previous:text(row.prior) || null, actual:text(row.actual) || null,
      unit:text(row.unit), period:text(row.period), status:text(row.status), dataStale:row.data_stale === true,
      sourceName:text(row.source_name), sourceUrl:safeLink(row.source_url || row.url),
      lastVerifiedAt:iso(row.last_verified_at), note:text(row.note), timeRole:text(row.time_role),
      // Preserve provider credit/rights notices when present. Render as text, never HTML.
      credits:[row.source_license,row.source_rights].filter(Boolean).map(value => JSON.stringify(value)),
    };
  }).sort((a,b) => a.calendarDate.localeCompare(b.calendarDate) || (a.date || '').localeCompare(b.date || '') || a.id.localeCompare(b.id));
  return { events, requestedStart:range.from, requestedEnd:range.to, coverageStart:range.from, coverageEnd:range.to, planning:true };
}
export function normalizeSymbols(input = '') {
  const symbols = [...new Set(input.split(',').filter(Boolean))].sort();
  if (!symbols.length || symbols.length > 60 || symbols.some(s => !/^[A-Z][A-Z0-9.-]{0,11}$/.test(s))) throw new Error('Choose up to 60 U.S. stock or ETF symbols.');
  return symbols;
}
export function parseNews(xml) {
  if (typeof xml !== 'string' || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error('The news feed could not be read.');
  const parsed = new XMLParser({ ignoreAttributes: false, parseTagValue: false }).parse(xml);
  if (!parsed?.rss || !Object.hasOwn(parsed.rss, 'channel')) throw new Error('The news feed could not be read.');
  const items = parsed.rss.channel.item || [];
  const seen = new Set();
  return (Array.isArray(items) ? items : [items]).flatMap(item => {
    let url;
    try { url = new URL(text(item.link)); } catch { return []; }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !text(item.title) || !iso(item.pubDate)) return [];
    url.searchParams.delete('.tsrc');
    const id = url.href;
    if (seen.has(id)) return [];
    seen.add(id);
    return [{ id, title: text(item.title).replace(/<[^>]*>/g,''), url: id, publishedAt: iso(item.pubDate), publisher: url.hostname.replace(/^www\./,''), image:rssImage(item), economy: /\b(fed|federal reserve|inflation|cpi|pce|gdp|payrolls?|jobs|unemployment|treasur(?:y|ies)|yields?|interest rates?|econom(?:y|ic)|recession|tariffs?|consumer sentiment)\b/i.test(text(item.title)) }];
  }).sort((a,b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0,40);
}

// Server-only fixed upstreams. Optional authenticated sentiment is supplied by
// the private connection service; credentials never enter this public cache.
export function createFeedService({ fetcher = fetch, now = () => Date.now(), timeoutMs = 12000, cache = new Map(), onCache = () => {}, sentimentApi } = {}) {
  const pending = new Map();
  function store(key,value) {
    if (cache.size >= 128 && !cache.has(key)) cache.delete(cache.keys().next().value);
    cache.set(key,value);
  }
  const withImages = createNewsImages({fetcher,now,cache,store,timeoutMs});
  const sentiment=createSentimentService({fetcher,now,timeoutMs,cache,onCache,parseSnapshot:parseSentiment,archive:()=>getSource('sentiment'),api:sentimentApi});
  const get=(kind,input)=>kind==='sentiment'?sentiment.get():getSource(kind,input);
  async function getSource(kind, input) {
    if (!SOURCES[kind]) throw new Error('Unknown feed.');
    const range = kind === 'calendar' && input && typeof input === 'object' ? validateRange(input) : null;
    if (range) {
      const current = weekRange(marketDay(now()));
      if (range.from >= current.from && range.to <= current.to) {
        const weekly = await get('calendar');
        // Reuse the published export only when its dates actually belong to this week.
        if (weekly.data?.coverageStart && marketDay(weekly.data.coverageStart) >= current.from && marketDay(weekly.data.coverageEnd) <= current.to) {
          return {...weekly,data:{...weekly.data,requestedStart:range.from,requestedEnd:range.to,events:weekly.data.events.filter(event => eventDay(event) >= range.from && eventDay(event) <= range.to)}};
        }
      }
    }
    const symbols = kind === 'news' ? normalizeSymbols(input) : [];
    const key = range ? `calendar:planning-v1:${range.from}:${range.to}` : kind === 'sentiment' ? 'sentiment:cnn-daily-archive-v1' : `${kind}:${symbols.join(',')}`, source = range ? PLANNING_SOURCE : SOURCES[kind], previous = cache.get(key);
    const {feed:upstream, ...attribution} = source;
    if (pending.has(key)) return pending.get(key);
    if (previous && previous.retryAt > now()) {
      if (previous.result.data && now()-Date.parse(previous.result.fetchedAt) >= 24*60*60_000) return { ...previous.result, status:'unavailable', fetchedAt:null, data:null, message:'The cached reading has expired. Waiting before checking the source again.' };
      // Upgrade pre-image cached headlines without refetching RSS or resetting its backoff/freshness.
      if (kind === 'news' && previous.result.data?.articles.some(article=>!Object.hasOwn(article,'image'))) {
        const work = withImages(previous.result.data.articles).then(articles=>{
          const result = {...previous.result,source:attribution,data:{...previous.result.data,articles}};
          store(key,{...previous,result});onCache(cache);return result;
        });
        pending.set(key,work);
        try { return await work; } finally { pending.delete(key); }
      }
      return readingFreshness(kind, {...previous.result, source:attribution}, now());
    }
    const work = (async () => {
      const checkedAt = new Date(now()).toISOString();
      let result, ttl, retryAfterMs = 0;
      try {
        async function read(url) {
          const response = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: kind === 'news' ? 'application/rss+xml, application/xml' : 'application/json' } });
          if (!response.ok) {
            const retry = response.headers.get('retry-after');
            retryAfterMs = retry ? (/^\d+$/.test(retry) ? Number(retry)*1000 : Math.max(0,Date.parse(retry)-now())) : 0;
            throw new Error(response.status === 429 ? `${source.name} is limiting requests. The app will retry after a pause.` : `${source.name} is unavailable (HTTP ${response.status}).`);
          }
          const body = await response.text();
          if (body.length > 2_000_000) throw new Error('The source response is too large.');
          return body;
        }
        let data;
        if (range) {
          const records = [];
          let total;
          do {
            const query = new URLSearchParams({...range,country:'US',include:'holidays',limit:'500',offset:String(records.length)});
            const page = JSON.parse(await read(`${upstream}?${query}`));
            if (!Array.isArray(page.events) || !Number.isInteger(page.total) || page.total < 0 || page.total > 5000 || page.from !== range.from || page.to !== range.to || (total !== undefined && page.total !== total) || (!page.events.length && records.length < page.total)) throw new Error('The future calendar returned an incomplete date range.');
            total = page.total;
            records.push(...page.events);
          } while (records.length < total);
          data = parsePlanningCalendar({...range,events:records,total},range);
        } else {
          const url = kind === 'news' ? `https://feeds.finance.yahoo.com/rss/2.0/headline?${new URLSearchParams({ s: symbols.join(','), region: 'US', lang: 'en-US' })}` : upstream;
          const body = await read(url);
          data = kind === 'news' ? { articles: await withImages(parseNews(body)), symbols } : kind === 'sentiment' ? parseSentiment(JSON.parse(body)) : parseCalendar(JSON.parse(body));
        }
        if(kind==='sentiment'&&previous?.result.data&&now()-Date.parse(previous.result.fetchedAt)<86400000&&Date.parse(data.observedAt)<Date.parse(previous.result.data.observedAt))throw new Error('The archive returned an older snapshot; keeping the newer cached reading.');
        result = { status: 'ok', source: attribution, fetchedAt: checkedAt, checkedAt, data };
        ttl = kind === 'sentiment' ? 60 * 60_000 : 10 * 60_000;
      } catch (error) {
        const message = error.name === 'TimeoutError' ? `${source.name} did not respond in time.` : error instanceof SyntaxError ? `${source.name} returned an unreadable response.` : error.message;
        // Keep the original successful fetch time when a refresh fails; never relabel cached data as fresh.
        const usable = previous?.result.data && now() - Date.parse(previous.result.fetchedAt) < 24 * 60 * 60_000;
        result = { status: usable ? 'stale' : 'unavailable', source: attribution, fetchedAt: usable ? previous.result.fetchedAt : null, checkedAt, data: usable ? previous.result.data : null, message };
        ttl = Math.max(5 * 60_000, Number.isFinite(retryAfterMs) ? retryAfterMs : 0);
      }
      result = readingFreshness(kind, result, now());
      store(key, { result, retryAt: now() + ttl });
      onCache(cache);
      return result;
    })();
    pending.set(key, work);
    try { return await work; } finally { pending.delete(key); }
  }
  return { get };
}
export function feedMiddleware(service = createFeedService()) {
  return async (req, res, next) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return next();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    if (req.method !== 'GET') { res.statusCode = 405; res.setHeader('Allow', 'GET'); res.end(JSON.stringify({ message: 'GET only.' })); return; }
    const kind = url.pathname.slice(5);
    if (!SOURCES[kind]) { res.statusCode = 404; res.end(JSON.stringify({ message: 'Unknown feed.' })); return; }
    const input = kind === 'calendar' && (url.searchParams.has('from') || url.searchParams.has('to')) ? {from:url.searchParams.get('from'),to:url.searchParams.get('to')} : url.searchParams.get('symbols') || 'SPY,QQQ,IWM,DIA';
    try { res.end(JSON.stringify(await service.get(kind, input))); }
    catch (error) { res.statusCode = 400; res.end(JSON.stringify({ status: 'unavailable', message: error.message })); }
  };
}
