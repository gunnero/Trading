export const formatPrice = value => Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const zoneText = zone => zone ? `${formatPrice(zone.low)}–${formatPrice(zone.high)}` : 'No listed zone';
export const zoneName = type => ({ S: 'Supply', D: 'Demand', G: 'Gap' }[type] || type);
export const formatDate = date => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

const validLevelDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

export function parseLevels(text, sourceDates = {}) {
  const lines = text.trim().split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const match = lines.shift()?.match(/^LVLS\s+(\d{4}-\d{2}-\d{2})$/);
  if (!match || !Number.isFinite(Date.parse(match[1])) || new Date(match[1]).toISOString().slice(0, 10) !== match[1]) throw new Error('Start with a valid date, for example LVLS 2026-10-23.');
  if (!lines.length) throw new Error('Add at least one instrument and its zones.');
  if (!sourceDates || typeof sourceDates !== 'object' || Array.isArray(sourceDates)) throw new Error('Invalid level source dates.');
  const instruments = {};
  lines.forEach((line, i) => {
    const [symbol, rawTimeframe, ...tokens] = line.split('|').map(x => x.trim());
    if (!/^[A-Z0-9.]{1,15}$/.test(symbol) || !rawTimeframe) throw new Error(`Line ${i + 2}: expected SYMBOL|timeframe|zones.`);
    if (instruments[symbol]) throw new Error(`Line ${i + 2}: ${symbol} appears more than once.`);
    const timeframe = { '15min': '15 min', '30min': '30 min', '1hr': '1 h', '1h': '1 h', '4hr': '4 h', '4h': '4 h', 'daily': 'Daily' }[rawTimeframe.toLowerCase()];
    if (!timeframe) throw new Error(`Line ${i + 2}: use 15min, 30min, 1h, 1HR, 4h, 4HR or Daily.`);
    let futures = false;
    const zones = [];
    tokens.forEach(token => {
      if (token === 'FUT') { futures = true; return; }
      const zone = token.match(/^([SDG])\s+(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
      if (!zone) throw new Error(`Line ${i + 2}: invalid zone '${token}'. Use S 708.14-707.23.`);
      const a = Number(zone[2]), b = Number(zone[3]);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) throw new Error(`Line ${i + 2}: zone prices must be positive.`);
      const entry = { type: zone[1], low: Math.min(a, b), high: Math.max(a, b) };
      if (!zones.some(z => z.type === entry.type && z.low === entry.low && z.high === entry.high)) zones.push(entry);
    });
    if (!zones.length) throw new Error(`Line ${i + 2}: add at least one zone for ${symbol}.`);
    const sourceDate = Object.hasOwn(sourceDates, symbol) ? sourceDates[symbol] : match[1];
    if (!validLevelDate(sourceDate) || sourceDate > match[1]) throw new Error(`Invalid level source date for ${symbol}.`);
    instruments[symbol] = { symbol, timeframe, futures, sourceDate, carriedForward: sourceDate < match[1], zones: zones.sort((a, b) => b.high - a.high) };
  });
  if (Object.keys(sourceDates).some(symbol => !Object.hasOwn(instruments, symbol))) throw new Error('Level source dates must belong to supplied instruments.');
  return { date: match[1], instruments };
}

// Keep the supplied row verbatim: only a whole missing instrument is carried forward.
// Dates live alongside the plain-text sheet so TradingView's input format stays intact.
export function mergeLevelSheets(previousText, incomingText, previousDates = {}) {
  const previous = parseLevels(previousText, previousDates), incoming = parseLevels(incomingText);
  if (incoming.date < previous.date) throw new Error(`This sheet is older than your saved ${previous.date} list. Import the same date or a newer daily list.`);
  const rows = text => text.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(1);
  const incomingRows = rows(incomingText), carriedRows = rows(previousText).filter(line => !Object.hasOwn(incoming.instruments, line.split('|')[0].trim()));
  const updated = [], added = [], carried = [], levelSourceDates = {};
  for (const item of Object.values(incoming.instruments)) {
    const old = previous.instruments[item.symbol];
    if (old && old.futures !== item.futures) throw new Error(`${item.symbol}: the asset type differs from your saved levels. Keep the FUT marker for futures.`);
    (old ? updated : added).push(item);
    levelSourceDates[item.symbol] = incoming.date;
  }
  for (const item of Object.values(previous.instruments)) {
    if (Object.hasOwn(incoming.instruments, item.symbol)) continue;
    carried.push(item);
    levelSourceDates[item.symbol] = item.sourceDate;
  }
  const levelText = [`LVLS ${incoming.date}`, ...incomingRows, ...carriedRows].join('\n') + '\n';
  if (levelText.length > 200000) throw new Error('The combined level sheet exceeds the 200 KB workspace limit.');
  return { levelText, levelSourceDates, date: incoming.date, updated, added, carried };
}

export function parseWatchlist(text, { allowEmpty = false } = {}) {
  let group = 'STOCKS';
  const entries = [], seen = new Set();
  for (const item of text.trim().split(/[,\r\n]+/).map(x => x.trim()).filter(Boolean)) {
    if (item.startsWith('###')) { group = item.slice(3); continue; }
    const parts = item.split(':');
    if (parts.length !== 2 || !/^[A-Z0-9_]+$/.test(parts[0]) || !/^[A-Z0-9.!]+$/.test(parts[1])) throw new Error(`Invalid watchlist entry: ${item}`);
    if (seen.has(item)) continue;
    seen.add(item);
    const [exchange, ticker] = parts;
    entries.push({ id: item, exchange, ticker, group, symbol: group === 'FUTURES' ? ticker.replace(/1!$/, '') : ticker });
  }
  if (!entries.length && !allowEmpty) throw new Error('The watchlist is empty.');
  return entries;
}

export function matchingInstrument(entry, sheet) {
  const instrument = sheet.instruments[entry.symbol];
  if (!instrument || instrument.futures !== (entry.group === 'FUTURES')) return null;
  return instrument;
}

export function locate(price, instrument) {
  if (!Number.isFinite(price) || !instrument) return { label: 'No supplied levels', zone: null, supply: null, demand: null };
  const zones = instrument.zones.filter(z => z.type !== 'G');
  const inside = zones.find(z => price >= z.low && price <= z.high);
  const supply = zones.filter(z => z.type === 'S' && z.high >= price).sort((a, b) => a.low - b.low)[0] || null;
  const demand = zones.filter(z => z.type === 'D' && z.low <= price).sort((a, b) => b.high - a.high)[0] || null;
  const nearest = zones.toSorted((a, b) => Math.min(Math.abs(price - a.low), Math.abs(price - a.high)) - Math.min(Math.abs(price - b.low), Math.abs(price - b.high)))[0];
  const near = nearest && Math.min(Math.abs(price - nearest.low), Math.abs(price - nearest.high)) / price < 0.001;
  return { label: inside ? `Testing ${zoneName(inside.type).toLowerCase()}` : near ? `Approaching ${zoneName(nearest.type).toLowerCase()}` : 'Between zones', zone: inside || (near ? nearest : null), supply, demand };
}

export const toneFor = status => status === 'Bullish watch' ? 'green' : status === 'Bearish watch' ? 'red' : status === 'Wait' ? 'amber' : 'muted';
