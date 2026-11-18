// A fixed illustration for the settings editor. No listing or workspace data is involved.
import {chartIndicators} from './data/indicators.mjs';

const day = 86400;
const sessionLength = 390 * 60;
const intradayMinutes = {'2m':2, '5m':5, '15m':15, '30m':30, '1h':60, '4h':240};
const finalDay = Date.UTC(2026, 10, 4, 14, 30) / 1000;
const closingPath = [701, 700, 698, 696, 694, 692, 692.5, 693, 696, 697, 697.5, 698, 700, 699.5, 700, 702, 703, 704, 703, 704, 705, 706, 708, 709, 708.5, 707.85];

function exampleDays() {
  const starts = [];
  for (let stamp = finalDay; starts.length < 1650; stamp -= day) {
    const weekday = new Date(stamp * 1000).getUTCDay();
    if (weekday !== 0 && weekday !== 6) starts.push(stamp);
  }
  let open = 690;
  return starts.reverse().map((start, i) => {
    const date = new Date(start * 1000).toISOString().slice(0, 10);
    const offset = i - (starts.length - closingPath.length);
    const history = 689 + 7 * Math.sin(i / 24) + 4 * Math.cos(i / 61);
    const blend = Math.max(0, Math.min(1, (offset + 30) / 30));
    const close = closingPath[offset] ?? history + (closingPath[0] - history) * blend;
    const ohlc = [open, close, Math.min(open, close) - .6, Math.max(open, close) + .7];
    open = close;
    return {start, timestamp:start, end:start + sessionLength, date, sessionDate:date, volume:12000 + i % 37 * 20, ohlc};
  });
}

function intradayBars(daily, minutes) {
  const count = Math.ceil(390 / minutes);
  return daily.slice(-Math.ceil(90 / count)).flatMap((row, d) => {
    const [first, last, low, high] = row.ohlc;
    let open = first;
    return Array.from({length:count}, (_, i) => {
      const timestamp = row.start + i * minutes * 60;
      const end = Math.min(row.end, timestamp + minutes * 60);
      const t = (end - row.start) / sessionLength;
      const wave = .53 * Math.sin(t * Math.PI * 4 + d) * Math.sin(t * Math.PI);
      const close = i === count - 1 ? last : first + (last - first) * t + wave;
      const ohlc = [open, close, Math.max(low, Math.min(open, close) - .18), Math.min(high, Math.max(open, close) + .22)];
      open = close;
      return {...row, timestamp, end, ohlc, volume:row.volume * (end - timestamp) / sessionLength};
    });
  });
}

function periodBars(days, frame) {
  if (frame === 'D') return days;
  const bars = [];
  let priorKey;
  for (const row of days) {
    const key = frame === 'M' ? row.date.slice(0, 7) : Math.floor((row.timestamp / day + 3) / 7);
    if (key !== priorKey) {
      bars.push({...row, ohlc:[...row.ohlc]});
      priorKey = key;
    } else {
      const bar = bars.at(-1);
      bar.ohlc[1] = row.ohlc[1];
      bar.ohlc[2] = Math.min(bar.ohlc[2], row.ohlc[2]);
      bar.ohlc[3] = Math.max(bar.ohlc[3], row.ohlc[3]);
      bar.end = row.end;
      bar.lastDate = row.date;
      bar.volume += row.volume;
    }
  }
  return bars;
}

export function chartDefaultsExample(frame) {
  const daily = exampleDays();
  const rows = intradayMinutes[frame] ? intradayBars(daily, intradayMinutes[frame]) : periodBars(daily, frame).slice(-90);
  const limit = 52;
  const {series} = chartIndicators({rows, dailyRows:daily, frame, limit, now:finalDay * 1000 + day * 1000});
  return {bars:rows.slice(-limit), series};
}
