import {addDays, eventDay, marketDay, validDay, weekRange} from '../src/data/calendar.mjs';
import {marketSession} from '../src/data/market-session.mjs';
import {createDisplayTime} from '../src/data/display-time.mjs';
import {earningsMatches, reportWindow} from '../src/data/earnings.mjs';
import {formatPrice, parseLevels, zoneName} from '../src/data/market.js';
import {readWatchlist} from '../src/data/watchlist.mjs';
import {JOURNAL_TAGS, journalDay} from '../src/data/journal.mjs';
import {journalBroker} from '../src/data/journal-brokers.mjs';
import {chartableEntry, stockEntry} from '../src/data/instruments.mjs';
import {portfolioListing} from '../src/data/portfolio-listings.mjs';
import {quoteKey} from '../src/data/quotes.mjs';

const marketNews = 'SPY,QQQ,IWM,DIA';
const mainSymbols = ['SPY', 'QQQ'];
const bounded = (value, limit = 240) => typeof value === 'string' ? value.slice(0, limit) : '';

function result(id, title, route, feed, rows, {empty, limited = false} = {}) {
  return {
    id, title, route, source: feed.source?.name || title, href: feed.source?.url || null,
    status: feed.status === 'ok' && !feed.data?.partialCoverage ? 'ok' : feed.data ? 'partial' : 'unavailable',
    asOf: feed.fetchedAt || null, message: bounded(feed.message) || (!rows.length ? empty || null : null),
    rows, limited,
  };
}

async function read(work) {
  try { return await work(); }
  catch { return {status: 'unavailable', data: null, message: 'This source is temporarily unavailable.'}; }
}

function identify(question, watchlist, sheet, journal) {
  const q = question.toLowerCase();
  const symbols = [...new Set([...mainSymbols, ...Object.keys(sheet.instruments), ...watchlist.map(item => item.symbol), ...journal.map(item => item.symbol)])];
  const mentions = new Set(question.toUpperCase().match(/[A-Z][A-Z0-9.]*[A-Z0-9]|[A-Z]/g) || []);
  const explicit = new Set(question.match(/\$[A-Z][A-Z0-9.]*|\b[A-Z]{2,}[A-Z0-9.]*/g)?.map(v => v.replace(/^\$/, '').replace(/\.$/, '')) || []);
  const named = symbols.filter(symbol => explicit.has(symbol) || symbol.length > 2 && mentions.has(symbol) && !['ALL', 'ARE', 'FOR', 'GAP', 'HAS', 'NOW', 'OUT', 'THE', 'WAS', 'YOU'].includes(symbol)).slice(0, 4);
  const tag = JOURNAL_TAGS.find(item => q.includes(item.toLowerCase())) || null;
  const unknown = /\$([a-z][a-z0-9.]{0,11})/i.exec(question)?.[1]?.replace(/\.$/, '').toUpperCase();
  let topic = 'general';
  if (tag || /\b(journal|trades?|executions|fills|p&l)\b/.test(q)) topic = 'journal';
  else if (/\b(earnings|reporting|eps)\b/.test(q)) topic = 'earnings';
  else if (/\b(news|headlines?)\b/.test(q)) topic = 'news';
  else if (/\b(levels?|zones?|supply|demand|gap)\b/.test(q)) topic = 'levels';
  else if (/\b(fear|greed|sentiment)\b/.test(q)) topic = 'sentiment';
  else if (/\b(calendar|economic|cpi|jobs|inflation|fed|release|events?|market hours|market open|market close)\b/.test(q)) topic = 'events';
  else if (/\b(price|quote|quotes|trading at)\b/.test(q)) topic = 'quotes';
  else if (/\b(brief|briefing|session|today)\b/.test(q)) topic = 'briefing';
  return {topic, symbols: unknown && !symbols.includes(unknown) ? [unknown] : named, tag, q};
}

function scopeDay(day, q, {defaultWeek = false, includeElapsed = false} = {}) {
  if (/\btomorrow\b/.test(q)) return {from: addDays(day, 1), to: addDays(day, 1)};
  if (/\byesterday\b/.test(q)) return {from: addDays(day, -1), to: addDays(day, -1)};
  const iso = q.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  if (validDay(iso)) return {from: iso, to: iso};
  if (/\bnext week\b/.test(q)) return weekRange(addDays(day, 7));
  if (/\blast week\b/.test(q)) return weekRange(addDays(day, -7));
  if (includeElapsed && /\b(this|current) week\b/.test(q)) return weekRange(day);
  if (/\b(this|current) week\b/.test(q) || defaultWeek && !/\btoday\b/.test(q)) return {from: day, to: weekRange(day).to};
  return {from: day, to: day};
}

export function createDeskContext({workspace, feeds, earnings, market, accounts = () => [], now = Date.now}) {
  return async function context(question = '') {
    const data = workspace();
    const at = now(), day = marketDay(at), display = createDisplayTime(data.displayTime);
    const session = marketSession(at);
    const schedule = session.today.kind === 'session'
      ? `Regular session ${display.clockRange(session.today.open, session.today.close)} ${display.zoneLabel}${session.today.early ? ' · early close' : ''}.`
      : session.detail + '.';
    const sheet = parseLevels(data.levelText, data.levelSourceDates);
    const watchlist = readWatchlist(data.watchText);
    const journal = data.journal?.trades || [];
    const intent = identify(question, watchlist, sheet, journal);
    const {topic, symbols, tag, q} = intent;
    const group = !question ? 'briefing' : topic;
    const all = group === 'briefing' || group === 'general';
    const holdings = /\b(holdings?|portfolio|positions?|stocks? (i|we) own)\b/.test(q);
    const localOnly = group === 'journal' || holdings;
    const selected = id => all || group === id;
    const work = [];
    const time = value => display.clockStamp(value) + ' ' + display.zoneLabel;
    if (selected('events')) {
      const range = all ? {from: day, to: day} : scopeDay(day, q);
      work.push(read(() => feeds.get('calendar', range)).then(feed => {
        const items = (feed.data?.events || []).filter(event => eventDay(event) >= range.from && eventDay(event) <= range.to);
        const rows = items.slice(0, 12).map(event => ({
          title: event.title, detail: [event.date ? time(event.date) : eventDay(event), event.impact, event.status === 'cancelled' ? 'Cancelled' : event.status === 'estimated' ? 'Estimated' : '', !event.date ? event.timeLabel || 'Time not supplied' : '', event.actual != null ? `Actual ${event.actual}` : '', event.forecast != null ? `Forecast ${event.forecast}` : ''].filter(Boolean).join(' · '),
          href: event.sourceUrl || null,
        }));
        return result('events', 'Economic events', 'markets/calendar', feed, rows, {empty: `No U.S. releases listed for ${range.from}${range.to === range.from ? '' : ` to ${range.to}`}.`, limited: items.length > rows.length});
      }));
    }
    if (selected('earnings')) {
      const range = all ? {from: day, to: day} : scopeDay(day, q, {defaultWeek: true});
      const snapshots = holdings ? accounts().flatMap(account => account.snapshot ? [account.snapshot] : []) : [];
      const listings = holdings ? snapshots.flatMap(snapshot => snapshot.holdings.map(holding => portfolioListing(holding, watchlist)).filter(stockEntry)) : watchlist;
      const title = holdings ? 'Holdings earnings' : 'Watchlist earnings';
      const upstream = holdings && !listings.length
        ? Promise.resolve({status: 'unavailable', message: 'No verified U.S. company listings in your saved portfolio snapshots.'})
        : read(() => earnings.get(range));
      work.push(upstream.then(feed => {
        const items = earningsMatches(feed.data?.events || [], listings).filter(event => {
          const named = symbols.some(symbol => symbol.replaceAll('.', '-') === event.symbol.replaceAll('.', '-'));
          return symbols.length && !holdings ? named : event.watchEntries.length && (!symbols.length || named);
        });
        const rows = items.slice(0, 15).map(event => ({
          title: `${event.symbol} · ${event.name}`, detail: [event.date, reportWindow(event.window), event.status === 'reported' ? 'Reported' : 'Expected', event.epsActual != null ? `EPS ${event.epsActual}` : '', event.epsForecast != null ? `Estimate ${event.epsForecast}` : ''].filter(Boolean).join(' · '),
        }));
        const scope = holdings ? 'verified companies in your saved holdings' : symbols.length ? symbols.join(', ') : 'your watchlist';
        const source = result('earnings', title, holdings ? 'portfolio/insights/calendar' : 'markets/earnings', feed, rows, {empty: `No earnings listed for ${scope} in the available schedule (${range.from}${range.to === range.from ? '' : ` to ${range.to}`}).`, limited: items.length > rows.length});
        if (holdings && listings.length) {
          const oldest = snapshots.map(snapshot => snapshot.fetchedAt || snapshot.asOf).filter(value => Number.isFinite(Date.parse(value))).sort()[0];
          source.message = [source.message, `From saved holdings snapshots${oldest ? ' · oldest dated ' + time(oldest) : ''}. Only verified U.S. company listings are included.`].filter(Boolean).join(' ');
        }
        return source;
      }));
    }
    if (selected('news')) {
      const eligible = symbols.filter(symbol => mainSymbols.includes(symbol) || watchlist.some(item => item.symbol === symbol && chartableEntry(item)));
      const scope = !all && symbols.length ? eligible.join(',') : marketNews;
      work.push((scope ? read(() => feeds.get('news', scope)) : Promise.resolve({status: 'unavailable', message: 'Ticker headlines need a supported U.S. watchlist listing.'})).then(feed => {
        const items = (feed.data?.articles || []).filter(article => Date.parse(article.publishedAt) <= at && at - Date.parse(article.publishedAt) <= 3 * 86400000);
        const rows = items.slice(0, 5).map(article => ({
          title: article.title, detail: `${article.publisher} · ${time(article.publishedAt)}`, href: article.url,
        }));
        return result('news', 'Recent headlines', 'markets/news', feed, rows, {empty: 'No headlines in the last three days.', limited: items.length > rows.length});
      }));
    }
    if (selected('sentiment')) {
      work.push(read(() => feeds.get('sentiment')).then(feed => {
        const item = feed.data;
        const rows = item && Number.isFinite(item.score) && item.observedAt ? [{
          title: `${Math.round(item.score)} / 100 · ${item.rating}`, detail: `CNN observation · ${time(item.observedAt)}`,
        }] : [];
        return result('sentiment', 'Fear & Greed', 'sentiment', feed, rows);
      }));
    }
    if (market && selected('quotes')) {
      const names = symbols.length && question ? symbols : mainSymbols;
      work.push(Promise.all(names.map(async symbol => {
        const entries = watchlist.filter(item => item.symbol === symbol && chartableEntry(item));
        const key = mainSymbols.includes(symbol) ? symbol : entries.length === 1 ? quoteKey(entries[0]) : null;
        const item = key ? await read(() => market.quote(key)) : null;
        return {symbol, item};
      })).then(items => {
        const rows = items.map(({symbol, item}) => {
          const quote = item?.quote;
          if (!quote || !Number.isFinite(quote.price)) return {title: symbol, detail: 'No usable quote for this listing.'};
          return {
            title: `${symbol} · ${formatPrice(quote.price)}${quote.currency ? ' ' + quote.currency : ''}`,
            detail: [quote.session, quote.sessionDate, quote.observedAt ? time(quote.observedAt) : '', item.status === 'stale' ? 'Cached or old' : '', quote.delayMinutes ? `${quote.delayMinutes} min source delay` : 'Delivery may be delayed'].filter(Boolean).join(' · '),
            href: quote.sourceUrl,
          };
        });
        const available = items.filter(({item}) => item?.quote);
        const feed = {
          status: available.length === items.length && available.every(({item}) => item.status === 'ok') ? 'ok' : 'stale',
          data: available.length ? {} : null, fetchedAt: available.map(({item}) => item.fetchedAt).filter(Boolean).sort()[0],
          source: {name: 'Yahoo Finance', url: 'https://finance.yahoo.com/'},
        };
        return result('quotes', 'Market quotes', 'overview', feed, rows);
      }));
    }
    if (selected('levels')) {
      const names = symbols.length && !all ? symbols : mainSymbols;
      const rows = names.flatMap(symbol => {
        const instrument = Object.hasOwn(sheet.instruments, symbol) ? sheet.instruments[symbol] : null;
        if (!instrument) return [];
        const zones = instrument.zones.slice(0, 8).map(zone => `${zoneName(zone.type)} ${zone.low}–${zone.high}`);
        return [{
          title: `${symbol} · ${instrument.timeframe} levels`,
          detail: [instrument.sourceDate, instrument.sourceDate !== day ? 'Different from this session date' : '', instrument.futures ? 'Futures reference' : '', zones.join(' · '), instrument.zones.length > zones.length ? 'More in Key levels' : ''].filter(Boolean).join(' · '),
        }];
      });
      work.push(Promise.resolve(result('levels', 'Saved levels', 'levels', {status: 'ok', source: {name: 'Your imported level sheet'}}, rows, {empty: `No saved levels for ${names.join(', ')}.`})));
    }
    if (group === 'journal') {
      const broker = /\bvanquish\b/.test(q) ? 'trades' : /\b(ibkr|interactive brokers)\b/.test(q) ? 'ibkr' : /\b(trading\s*212|t212)\b/.test(q) ? 'broker' : null;
      const range = /\b(today|tomorrow|yesterday|this week|current week|next week|last week|\d{4}-\d{2}-\d{2})\b/.test(q) ? scopeDay(journalDay(at), q, {includeElapsed: true}) : null;
      const items = journal.filter(trade => {
        const date = journalDay(trade.entryAt);
        return (!broker || journalBroker(trade) === broker) && (!symbols.length || symbols.includes(trade.symbol)) && (!tag || trade.tags.includes(tag)) && (!range || date >= range.from && date <= range.to);
      }).sort((a, b) => b.entryAt.localeCompare(a.entryAt));
      const rows = items.slice(0, 12).map(trade => {
        const section = journalBroker(trade);
        return {
          title: `${trade.symbol} · ${trade.optionType} · ${trade.position}`,
          detail: [time(trade.entryAt), trade.exitAt ? 'Closed' : 'Open', ...trade.tags].join(' · '),
          route: section === 'trades' ? `journal/trades/${encodeURIComponent(trade.id)}` : `journal/${section}`,
        };
      });
      work.push(Promise.resolve(result('journal', 'Saved journal entries', 'journal', {
        status: 'ok', source: {name: 'Your saved workspace journal'},
        message: `${items.length} matching entr${items.length === 1 ? 'y' : 'ies'}${tag ? ` tagged ${tag}` : ''}${range ? ` (${range.from}${range.to !== range.from ? ' to ' + range.to : ''}, Skopje entry dates)` : ''}. Synced broker journals are available separately in Journal.`,
      }, rows, {limited: items.length > rows.length})));
    }
    return {
      day, generatedAt: new Date(at).toISOString(), topic: group, localOnly,
      session: {label: session.label, schedule, nextOpen: session.nextOpen},
      sources: await Promise.all(work),
    };
  };
}
