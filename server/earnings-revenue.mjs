import {mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {marketDay, validDay} from '../src/data/calendar.mjs';
import {earningsFiscalMonth, earningsProviderSymbol} from '../src/data/earnings-revenue.mjs';
import {exchangeInstant, tradingDay} from '../src/data/market-session.mjs';

const US_EXCHANGES = new Set(['NMS','NGM','NCM','NYQ','ASE','BTS','BATS','PCX','CBOE']);
const QUARTER = /^[1-4]Q\d{4}$/;
const DAY = 86400000;
const MAX_ESTIMATES = 3000;
const MAX_QUEUED_REPORTS = 48;
const currencyCode = value => /^[A-Z]{3}$/.test(value || '');
const amount = Number.isFinite;

function issuerName(name) {
  return String(name || '').normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '')
    .replace(/\([^)]*\)\s*$/, '').replace(/[^a-z0-9]+/g, ' ').trim()
    .replace(/^the\s+/, '').replace(/(?:\s+(?:inc|incorporated|corp|corporation|ltd|limited|co|company|plc|llc|sa|se|ag|nv))+$/, '');
}

function matchingQuarter(event, data, month) {
  const rows = [...(data.earnings.history || []), ...(data.earnings.series || []).flatMap(series => series.history)];
  const matches = new Map();
  for (const row of rows) {
    if (row.reported !== event.date || !validDay(row.end) || !row.end.startsWith(month) || row.end >= event.date || !QUARTER.test(row.period)) continue;
    matches.set(`${row.end}:${row.period}`, row);
  }
  return matches.size === 1 ? matches.values().next().value : null;
}

export function matchEarningsRevenue(event, snapshot, now = Date.now()) {
  const data = snapshot?.data;
  const month = earningsFiscalMonth(event.fiscalQuarter);
  const issuer = issuerName(event.name);
  const currency = data?.earnings?.currency;
  if (!month || !issuer || !data || data.symbol !== earningsProviderSymbol(event.symbol) || data.type !== 'EQUITY' || data.currency !== 'USD' || !US_EXCHANGES.has(data.exchange) || !currencyCode(currency) || ![data.name,data.shortName].some(name => issuerName(name) === issuer)) return null;

  const actualPeriod = event.date <= marketDay(now) ? matchingQuarter(event, data, month) : null;
  const quarterRows = actualPeriod ? (data.quarterly || []).filter(row => row.fiscalQuarter === actualPeriod.period) : [];
  const actual = quarterRows.length === 1 && amount(quarterRows[0].revenue)
    ? {amount:quarterRows[0].revenue, currency, periodEnd:actualPeriod.end, fiscalQuarter:actualPeriod.period, fetchedAt:snapshot.fetchedAt}
    : null;
  const e = data.earnings;
  const hasReport = [e.history || [], ...(e.series || []).map(series => series.history)].some(rows =>
    rows.some(row => row.period === e.period && validDay(row.reported)));
  const estimate = event.status === 'expected' && event.date >= marketDay(now) && !actual && !hasReport &&
      amount(e.revenueEstimate) && QUARTER.test(e.period) && validDay(e.periodEnd) && e.periodEnd.startsWith(month) && e.periodEnd < event.date &&
      e.dates?.length === 1 && e.dates[0] === event.date
    ? {amount:e.revenueEstimate, currency, periodEnd:e.periodEnd, fiscalQuarter:e.period, fetchedAt:snapshot.fetchedAt}
    : null;
  return {issuer, actual, estimate};
}

function estimateCutoff(event) {
  const close = event.window === 'after' && tradingDay(event.date).close;
  return Date.parse(close || exchangeInstant(event.date, 0));
}

export function createEarningsRevenueService({companies, cachePath, now = Date.now} = {}) {
  const estimates = new Map();
  const pending = new Map();
  if (cachePath) {
    try {
      const saved = JSON.parse(readFileSync(cachePath, 'utf8'));
      if (saved.version === 1) {
        for (const [key, value] of saved.entries.slice(-MAX_ESTIMATES)) {
          const at = Date.parse(value?.fetchedAt);
          if (typeof key === 'string' && key.length < 55 && typeof value?.issuer === 'string' && amount(value.amount) && currencyCode(value.currency) &&
              validDay(value.periodEnd) && QUARTER.test(value.fiscalQuarter) && at <= now() && now() - at < 450 * DAY) estimates.set(key, value);
        }
      }
    } catch { /* Optional public data cache. */ }
  }
  function remember(key, value) {
    if (estimates.get(key)?.fetchedAt >= value.fetchedAt) return;
    estimates.delete(key);
    estimates.set(key, value);
    while (estimates.size > MAX_ESTIMATES) estimates.delete(estimates.keys().next().value);
    if (!cachePath) return;
    try {
      mkdirSync(dirname(cachePath), {recursive:true});
      const temp = `${cachePath}.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify({version:1, entries:[...estimates]}), {mode:0o600});
      renameSync(temp, cachePath);
    } catch { /* The current process can still use the estimate. */ }
  }
  async function collect(event, key) {
    const snapshot = await companies.getEarnings(event.symbol);
    if (!snapshot.data) return {status:'unavailable', reason:'Yahoo Finance revenue is temporarily unavailable.'};
    const matched = matchEarningsRevenue(event, snapshot, now());
    if (!matched) return {status:'missing', reason:'Company or fiscal period could not be verified.'};
    const {actual, estimate, issuer} = matched;
    if (estimate && snapshot.status === 'ok' && Date.parse(estimate.fetchedAt) < estimateCutoff(event)) {
      remember(key, {...estimate, issuer});
    }
    const saved = estimates.get(key);
    const comparable = actual && saved?.issuer === issuer && saved.periodEnd === actual.periodEnd && saved.fiscalQuarter === actual.fiscalQuarter &&
      saved.currency === actual.currency && Date.parse(saved.fetchedAt) < estimateCutoff(event);
    if (!actual && !estimate) return {status:'missing', reason:'No matching quarterly revenue and report date from Yahoo Finance.'};
    return {status:snapshot.status === 'stale' ? 'stale' : 'ok', actual, estimate:comparable ? {...saved, captured:true} : estimate};
  }
  async function get(event) {
    const month = earningsFiscalMonth(event.fiscalQuarter);
    if (!earningsProviderSymbol(event.symbol) || !month) {
      return {status:'missing', reason:'Verified U.S. ticker or fiscal period is unavailable.'};
    }
    const key = `${event.id}|${month}`;
    const requestKey = `${key}|${event.status}`;
    if (pending.has(requestKey)) return pending.get(requestKey);
    if (pending.size >= MAX_QUEUED_REPORTS) return {status:'unavailable', reason:'Revenue checks are busy. Please retry.'};
    const work = collect(event, key).finally(() => pending.delete(requestKey));
    pending.set(requestKey, work);
    return work;
  }
  return {get};
}
