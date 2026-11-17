import {validDay} from './calendar.mjs';

const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const compact = new Intl.NumberFormat('en-US', {notation:'compact', maximumFractionDigits:2});
const exact = new Intl.NumberFormat('en-US', {maximumFractionDigits:2});

export function earningsProviderSymbol(symbol) {
  return typeof symbol === 'string' && /^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)
    ? symbol.replaceAll('.', '-')
    : null;
}

export function earningsReportIdentity(report) {
  const match = /^(\d{4}-\d{2}-\d{2}):([A-Z][A-Z0-9.-]{0,14})$/.exec(report || '');
  return match && validDay(match[1]) ? {date:match[1], symbol:match[2]} : null;
}

export function earningsFiscalMonth(value) {
  const match = /^([A-Z][a-z]{2})\s*\/\s*(\d{4})$/.exec(value || '');
  if (!match) return null;
  const month = months.indexOf(match[1]) + 1;
  return month ? `${match[2]}-${String(month).padStart(2, '0')}` : null;
}

export function formatEarningsRevenue(value, precise = false) {
  if (!Number.isFinite(value?.amount) || !value.currency) return '—';
  return `${(precise ? exact : compact).format(value.amount)} ${value.currency}`;
}

export function revenueSurprise(revenue) {
  const {actual, estimate} = revenue || {};
  if (!actual || !estimate || actual.currency !== estimate.currency || actual.periodEnd !== estimate.periodEnd || estimate.amount <= 0) return null;
  const percent = (actual.amount - estimate.amount) / estimate.amount * 100;
  return Number.isFinite(percent) ? percent : null;
}
