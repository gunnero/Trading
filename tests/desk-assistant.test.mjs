import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {createDeskContext} from '../server/desk-context.mjs';
import {createDeskAssistant, createDeskBudget} from '../server/desk-assistant.mjs';

const now = () => Date.parse('2026-11-27T15:00:00Z'); // U.S. early close
const timestamp = new Date(now()).toISOString();
const workspace = () => ({
  levelText: 'LVLS 2026-11-27\nQQQ|4h|S 602-601\nSPY|30min|D 658-656\n',
  levelSourceDates: {QQQ: '2026-11-26'},
  watchText: '###STOCKS,NASDAQ:NVDA,###FUND,NASDAQ:QQQ,###CRYPTO,BITSTAMP:BTCUSD',
  journal: {trades: [{
    id: 'trade-1', firm: 'Vanquish', account: 'private-account', symbol: 'QQQ',
    optionType: 'CALL', position: 'long', entryAt: timestamp, exitAt: null,
    tags: ['Early entry'], notes: 'private-journal-note',
  }, {
    id: 'trade-2', firm: 'Vanquish', symbol: 'SPY', optionType: 'PUT', position: 'long',
    entryAt: timestamp, exitAt: null, tags: ['Early entry'],
  }]},
});

const feed = (name, data) => ({status: 'ok', source: {name}, fetchedAt: timestamp, data});
function dependencies() {
  return {
    workspace, now,
    accounts: () => [{snapshot: {
      asOf: timestamp, holdings: [{ticker: 'NVDA_US_EQ', instrumentCurrency: 'USD', quantity: 12}],
    }, id: 'private-portfolio-id'}],
    feeds: {get: async kind => {
      if (kind === 'calendar') return {...feed('Economic source', {partialCoverage: true, events: [
        {title: 'Scheduled release', calendarDate: '2026-11-27', date: null, impact: 'High', status: 'estimated', timeLabel: 'Time TBA'},
        {title: 'Out-of-range release', calendarDate: '2026-11-28', date: null, impact: 'High'},
      ]}), message: 'Partial schedule'};
      if (kind === 'news') return feed('Yahoo Finance', {articles: [
        {title: 'A dated headline', publishedAt: timestamp, url: 'https://example.com/news', publisher: 'Publisher'},
        {title: 'An old headline', publishedAt: '2026-11-10T13:00:00Z', publisher: 'Publisher'},
      ]});
      return {status: 'unavailable', data: null, message: 'Source unavailable'};
    }},
    earnings: {get: async ({from}) => feed('Nasdaq', {events: [
      {symbol: 'NVDA', name: 'NVIDIA', date: from, window: 'after', status: 'expected', epsForecast: '1.23'},
      {symbol: 'QQQ', name: 'Fund', date: from, window: 'after', status: 'expected'},
      {symbol: 'OUTSIDE', name: 'Other company', date: from, window: 'after', status: 'expected'},
    ]})},
    market: {quote: async key => key === 'SPY' ? {
      status: 'stale', fetchedAt: timestamp,
      quote: {price: 651, currency: 'USD', observedAt: timestamp, sessionDate: '2026-11-27', session: 'Regular session'},
    } : {status: 'unavailable', quote: null}},
  };
}

test('the daily briefing uses the U.S. session date and preserves source coverage and timestamps', async () => {
  const daily = await createDeskContext(dependencies())();
  const sources = Object.fromEntries(daily.sources.map(source => [source.id, source]));
  assert.equal(daily.day, '2026-11-27');
  assert.match(daily.session.schedule, /15:30–19:00 Skopje.*early close/);
  assert.equal(sources.events.status, 'partial');
  assert.deepEqual(sources.events.rows.map(row => row.title), ['Scheduled release']);
  assert.match(sources.events.rows[0].detail, /Estimated.*Time TBA/);
  assert.deepEqual(sources.earnings.rows.map(row => row.title), ['NVDA · NVIDIA']);
  assert.equal(sources.news.rows.length, 1);
  assert.equal(sources.sentiment.status, 'unavailable');
  assert.equal(sources.sentiment.rows.length, 0);
  assert.match(sources.levels.rows.find(row => row.title.startsWith('QQQ')).detail, /2026-11-26.*Different from this session/);
  assert.match(sources.quotes.rows[0].detail, /Cached or old/);
  assert.equal(sources.quotes.status, 'partial');
});

test('journal lookups filter by symbol, tag and broker and retain no private account or note in their response', async () => {
  const answer = await createDeskContext(dependencies())('Show my QQQ Vanquish trades tagged Early entry');
  assert.equal(answer.topic, 'journal');
  assert.equal(answer.sources.length, 1);
  assert.equal(answer.sources[0].rows[0].route, 'journal/trades/trade-1');
  assert.equal(answer.sources[0].rows.length, 1);
  assert.doesNotMatch(JSON.stringify(answer), /private-account|private-journal-note/);
});

test('the AI endpoint preserves local results on failure, blocks journal transmission and caches matching briefings', async () => {
  const db = new DatabaseSync(':memory:');
  let mode = 'ok', calls = 0;
  const middleware = createDeskAssistant({...dependencies(), db, key: 'test-only', fetcher: async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(init.redirect, 'error');
    const body = JSON.parse(init.body);
    assert.equal(body.store, false);
    assert.equal(body.tools, undefined);
    assert.doesNotMatch(body.input, /private-account|private-journal-note/);
    if (mode === 'quota') return new Response(null, {status: 429});
    const result = {answer: 'The release time is still to be announced.', sourceIds: [mode === 'citation' ? 'invented' : 'events']};
    return Response.json({status: 'completed', output: [{type: 'message', content: [{type: 'output_text', text: JSON.stringify(result)}]}], usage: {input_tokens: 1000, output_tokens: 50}});
  }});
  const server = createServer((req, res) => middleware(req, res, () => res.end()));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const root = `http://127.0.0.1:${server.address().port}/api/desk/`;
  const post = (path, value) => fetch(root + path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(value)});
  try {
    assert.equal((await (await fetch(root + 'status')).json()).aiAvailable, true);
    const baseline = await (await fetch(root + 'briefing')).json();
    assert.equal(baseline.answer, undefined);
    assert.equal(calls, 0);
    const brief = await (await post('briefing', {ai: true})).json();
    assert.deepEqual(brief.answer.sourceIds, ['events']);
    assert.equal((await (await post('briefing', {ai: true})).json()).answer.cached, true);
    const journal = await (await post('ask', {question: 'Show my QQQ trades', ai: true})).json();
    assert.equal(journal.topic, 'journal');
    assert.equal(journal.answer, undefined);
    const holdings = await (await post('ask', {question: 'Which of my holdings report earnings this week?', ai: true})).json();
    assert.equal(holdings.localOnly, true);
    assert.equal(holdings.answer, undefined);
    assert.equal(holdings.sources[0].title, 'Holdings earnings');
    assert.deepEqual(holdings.sources[0].rows.map(row => row.title), ['NVDA · NVIDIA']);
    assert.doesNotMatch(JSON.stringify(holdings), /private-portfolio-id|quantity/);
    assert.equal(calls, 1);
    mode = 'citation';
    const invalid = await (await post('ask', {question: 'Any economic events today?', ai: true})).json();
    assert.match(invalid.aiError, /unknown citation/);
    assert.equal(invalid.sources[0].rows.length, 1);
    mode = 'quota';
    const limited = await (await post('ask', {question: 'What economic releases are today?', ai: true})).json();
    assert.match(limited.aiError, /limiting requests/);
    assert.equal(limited.sources[0].id, 'events');
    assert.equal((await post('ask', {question: 'x'.repeat(610)})).status, 400);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
});

test('the monthly budget reserves spend across service instances before an upstream request', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const service = createDeskBudget(db);
    for (let i = 0; i < 200; i++) assert.equal(service.reserve('2026-11'), true);
    assert.equal(createDeskBudget(db).reserve('2026-11'), false);
    service.settle('2026-11', {input_tokens: 1000, output_tokens: 100});
    assert.equal(service.reserve('2026-11'), false); // $0.097 returned, $0.10 needed
    assert.equal(service.reserve('2026-12'), true);
  } finally { db.close(); }
});
