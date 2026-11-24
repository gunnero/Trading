import {formatPrice, zoneText} from './market.js';
import {CONFIRMATION_WINDOW, RETEST_WINDOW} from './retests.mjs';

const price = value => Number.isFinite(value) ? formatPrice(value) : 'unavailable';
const rule = (id, label, state, detail, at) => ({id, label, state, detail, at});
const barCount = count => `${count} ${count === 1 ? 'candle' : 'candles'}`;
const rules = [
  ['break', 'Closed break'],
  ['retest', 'Separate retest'],
  ['ema', '9 / 21 EMA'],
  ['vwap', 'Session VWAP'],
  ['timing', 'Confirmation window'],
  ['location', 'Quote and zone proximity'],
];

const missing = {
  'no-levels': 'A supply or demand zone from your saved levels is required.',
  'awaiting-session': 'Waiting for regular-session candles and a usable regular-session quote.',
  dated: 'The saved levels and quote are from different sessions.',
  stale: 'The source data is cached or old. Current checks are paused.',
  loading: 'Waiting for the setup scan to finish.',
  unavailable: 'Yahoo setup candles or the regular-session quote are unavailable.',
  insufficient: 'Some required regular-session candles are missing.',
};

export function explainSetup(result) {
  const {stage = 'loading', evidence, zone} = result || {};
  if (!zone || !evidence) {
    if (stage === 'waiting-break') {
      const summary = result.barCount === 0
        ? 'No regular-session candle has closed yet.'
        : 'No completed candle has closed through a full supply or demand zone.';
      return {summary, checks: [
        rule('break', 'Closed break', 'pending', summary),
        ...rules.slice(1).map(([id, label]) => rule(id, label, 'pending', 'Waiting for a qualifying break.')),
      ]};
    }
    const summary = result?.message || missing[stage] || missing.unavailable;
    const state = ['loading', 'awaiting-session'].includes(stage) ? 'pending' : 'unavailable';
    return {summary, checks: rules.map(([id, label]) => rule(id, label, state))};
  }

  const bull = result.direction === 'bullish';
  const side = bull ? 'above' : 'below', area = bull ? 'supply' : 'demand';
  const retested = Number.isFinite(result.confirmedAt);
  const expired = evidence.candleStage === 'expired';
  const complete = `A closed candle broke ${side} ${area} at ${price(result.breakClose)}.`;
  let summary = retested
    ? `The break closed ${side} ${area}, and a separate candle confirmed the retest.`
    : `The break closed ${side} ${area}. A separate retest hasn’t confirmed.`;
  if (stage === 'invalidated') summary += ' The latest quote crossed the far side of the zone.';
  else if (expired) summary += retested ? ' The confirmation has aged out.' : ' The retest window has expired.';
  else if (stage === 'extended') summary += ' The latest quote is too far from the broken edge.';
  else if (stage === 'indicator-conflict') summary += ' EMA or VWAP alignment failed.';
  else if (stage === 'indicators-unavailable') summary += ' Some indicator evidence is unavailable.';
  if (stage !== 'invalidated' && retested && evidence.quoteOnBreakSide === false) summary += ' The latest quote has returned to the broken edge or into the zone.';

  const readings = result.indicators || {};
  function alignment(id, label, values, missingDetail, index) {
    const passed = result.checks?.[index]?.passed;
    let state = 'unavailable', detail = missingDetail;
    if (passed === false) {
      state = 'failed';
      detail = retested ? 'The retest candle, latest closed candle and quote need to agree.' : 'The latest candle or quote is out of alignment.';
    } else if (passed === true) {
      state = retested ? 'passed' : 'pending';
      detail = retested ? 'Aligned at confirmation and on the latest candle and quote.' : 'Aligned so far. Confirmation also needs a separate retest candle.';
    }
    return rule(id, label, state, `${detail} ${values}`);
  }

  const distance = Number.isFinite(result.distance) ? result.distance : null;
  const location = evidence.invalidated || evidence.quoteOnBreakSide === false || distance > 1 ? 'failed'
    : distance === null || evidence.quoteOnBreakSide === null ? 'unavailable' : 'passed';
  const locationDetail = evidence.invalidated ? `The quote crossed the far edge at ${price(result.invalidation)}.`
    : distance === null ? 'A usable quote is required.'
      : `Quote ${price(result.quote?.price)} is ${distance.toFixed(2)} zone widths from ${price(evidence.edge)}. Limit 1 width (${price(evidence.width)}); quote must remain ${side} the edge for confirmation.`;

  return {summary, checks: [
    rule('break', 'Closed break', 'passed', `${complete} Zone ${zoneText(zone)}.`, result.breakAt),
    rule('retest', 'Separate retest', retested ? 'passed' : expired || evidence.invalidated ? 'failed' : 'pending',
      retested ? `A later candle touched the zone and closed ${side} the edge at ${price(result.confirmClose)}.`
        : `A later candle must touch ${zoneText(zone)} and close strictly ${side} ${price(evidence.edge)}.`, result.confirmedAt),
    alignment('ema', '9 / 21 EMA', `Latest EMA 9 ${price(readings.ema9)} · EMA 21 ${price(readings.ema21)}.`, 'EMA evidence is incomplete.', 0),
    alignment('vwap', 'Session VWAP', `Latest VWAP ${price(readings.vwap)}.`, 'Session VWAP evidence is incomplete.', 1),
    rule('timing', 'Confirmation window', expired ? 'failed' : retested ? 'passed' : 'pending', retested
      ? `Confirmation was ${barCount(evidence.barsSinceConfirmation)} ago. It expires after ${barCount(CONFIRMATION_WINDOW)}.`
      : `${barCount(evidence.barsSinceBreak)} since the break. Retest window ${barCount(RETEST_WINDOW)}.`),
    rule('location', 'Quote and zone proximity', location, locationDetail),
  ]};
}
