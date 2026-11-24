import {addDays} from './calendar.mjs';
import {JOURNAL_ZONE, REVIEW_ITEMS, journalDay, roundMoney, tradeResult} from './journal.mjs';

const groups = [
  ['followed', 'Followed rules'],
  ['early', 'Early or chased entry'],
  ['other', 'Other or unclassified'],
  ['mixed', 'Conflicting records'],
];

const hasTag = (trade, value) => trade.tags.some(tag => tag.toLowerCase() === value.toLowerCase());
const sorted = trades => [...trades].sort((left, right) => right.exitAt.localeCompare(left.exitAt));
export const coachAccount = trade => JSON.stringify([trade.firm, trade.account]);

function entryEvidence(trade) {
  const failures = REVIEW_ITEMS.filter(([key]) => trade.review?.[key] === false).map(([key]) => key);
  const allPassed = REVIEW_ITEMS.every(([key]) => trade.review?.[key] === true);
  const plan = hasTag(trade, 'Followed plan');
  const early = hasTag(trade, 'Early entry');
  const chased = hasTag(trade, 'Chased entry');
  const followed = plan || allPassed;
  const group = followed && (early || chased || failures.length > 0) ? 'mixed'
    : followed ? 'followed'
      : early || chased ? 'early' : 'other';
  return {group, early, chased, failures};
}

function summarize(id, label, trades) {
  let wins = 0, losses = 0, total = 0;
  for (const trade of trades) {
    const {gross} = tradeResult(trade);
    if (gross > 0) wins++;
    if (gross < 0) losses++;
    total += gross;
  }
  const count = trades.length;
  const notes = sorted(trades).filter(trade => trade.notes?.trim());
  return {id, label, count, wins, losses, flat: count - wins - losses, average: count ? roundMoney(total / count) : null, notes};
}

function improvement(records, counts, early, chased) {
  const count = records.length;
  if (!count) return null;
  if (counts.early) {
    if (chased > early) return {
      action: 'Write down how far price is from the broken edge before each entry.',
      reason: `${chased} of ${counts.early} early or chased trades were tagged Chased entry.`,
      measure: 'At the end of next week, count how many entries were outside your zone proximity limit.',
    };
    return {
      action: 'Record the close time of the separate retest candle before each entry.',
      reason: `${early} of ${counts.early} early or chased trades were tagged Early entry.`,
      measure: 'Next week, count how many entries happened before a retest close.',
    };
  }
  if (counts.mixed) return {
    action: 'Reconcile your entry tags and rule checks when you review each trade.',
    reason: `${counts.mixed} of ${count} closed trades had conflicting saved evidence.`,
    measure: 'Next week, count how many closed trades still have conflicting tags or checks.',
  };
  const failed = REVIEW_ITEMS.map(([key, label]) => ({
    label, count: records.filter(record => record.evidence.failures.includes(key)).length,
  })).sort((a, b) => b.count - a.count)[0];
  if (failed.count) return {
    action: `Record a yes or no for “${failed.label}” before logging each entry.`,
    reason: `You marked that check as missed on ${failed.count} of ${count} closed trades.`,
    measure: 'Next week, compare how often that check was met.',
  };
  if (counts.other) return {
    action: 'Complete the four entry checks when you review each closed trade.',
    reason: `${counts.other} of ${count} closed trades lacked evidence for either comparison group.`,
    measure: 'Next week, count how many closed trades have all four checks recorded.',
  };
  return {
    action: 'Record one sentence about what you saw on the retest for each closed trade.',
    reason: count === 1 ? 'The only trade in this view was marked as following your rules.' : `All ${count} trades in this view are marked as following your rules.`,
    measure: 'Next week, check how many reviews identify the candle that confirmed the retest.',
  };
}

export function journalCoach(trades, {period = '30', account = '', now = Date.now()} = {}) {
  const to = journalDay(now);
  const from = period === 'all' ? null : addDays(to, period === '7' ? -6 : -29);
  const closed = trades.filter(trade => {
    if (!trade.exitAt || Date.parse(trade.exitAt) > now || account && coachAccount(trade) !== account) return false;
    return !from || journalDay(trade.exitAt) >= from;
  });
  const records = closed.map(trade => ({trade, evidence: entryEvidence(trade)}));
  const partitions = groups.map(([id, label]) => summarize(id, label, records.filter(record => record.evidence.group === id).map(record => record.trade)));
  const counts = Object.fromEntries(partitions.map(group => [group.id, group.count]));
  const tagged = records.filter(record => record.evidence.group === 'early');
  const early = tagged.filter(record => record.evidence.early).length;
  const chased = tagged.filter(record => record.evidence.chased).length;
  return {
    from, to, timeZone: JOURNAL_ZONE, total: closed.length, partitions, counts, early, chased,
    improvement: improvement(records, counts, early, chased),
  };
}
