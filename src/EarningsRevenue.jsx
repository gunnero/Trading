import {useEffect, useRef, useState} from 'react';
import {useDisplayTime} from './DisplayTime';
import {useFeed} from './Feeds';
import {earningsFiscalMonth, earningsReportIdentity, formatEarningsRevenue} from './data/earnings-revenue.mjs';

export function useEarningsRevenue(event, active = true) {
  const month = earningsReportIdentity(event?.id) && earningsFiscalMonth(event.fiscalQuarter);
  const endpoint = month ? `/api/earnings/revenue?${new URLSearchParams({report:event.id,period:month,state:event.status})}` : null;
  const feed = useFeed(endpoint, active);
  if (!month) return {status:'missing',reason:'Verified U.S. ticker or fiscal period is unavailable.'};
  if (feed.data?.id === event.id) {
    // A refresh can change the period or publish EPS while an older lookup is cached.
    const actual = feed.data.actual?.periodEnd?.startsWith(month) ? feed.data.actual : null;
    const estimate = feed.data.estimate?.periodEnd?.startsWith(month) && (event.status !== 'reported' || feed.data.estimate.captured) ? feed.data.estimate : null;
    return {...feed.data,actual,estimate,status:feed.status === 'stale' ? 'stale' : feed.data.status};
  }
  return {status:feed.status,reason:feed.message};
}

export function revenueDetail(revenue) {
  if (revenue.status === 'loading') return 'Checking Yahoo Finance';
  if (revenue.status === 'unavailable') return 'Revenue source unavailable';
  if (revenue.status === 'stale') return 'Cached · Yahoo Finance';
  return revenue.reason || 'No matching value from Yahoo Finance';
}

export function RevenueCell({event, kind}) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const {marketTime, zoneLabel} = useDisplayTime();
  useEffect(() => {
    const row = ref.current.closest('tr');
    if (!row || typeof IntersectionObserver === 'undefined') {setVisible(true);return;}
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {rootMargin:'100px 0px'});
    observer.observe(row);
    return () => observer.disconnect();
  }, []);
  const revenue = useEarningsRevenue(event, visible);
  const value = kind === 'any' ? revenue.actual || revenue.estimate : revenue[kind];
  const estimate = value && value === revenue.estimate;
  const stamp = value && Number.isFinite(Date.parse(value.fetchedAt)) ? `${marketTime(value.fetchedAt)} ${zoneLabel}` : '';
  const label = value ? `${estimate ? 'Estimated' : 'Reported'} revenue: ${formatEarningsRevenue(value,true)} · Yahoo Finance${stamp ? ` · Fetched ${stamp}` : ''}${revenue.status === 'stale' ? ' · Cached' : ''}` : revenueDetail(revenue);
  return <span className="earnings-revenue-value" ref={ref} title={label} aria-label={label}>
    {formatEarningsRevenue(value)}{kind === 'any' && value && <small>{estimate?'Estimate':'Reported'}</small>}{value && revenue.status === 'stale' && <small>Cached</small>}
  </span>;
}
