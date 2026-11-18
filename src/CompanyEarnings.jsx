import {useEffect, useMemo, useRef, useState} from 'react';
import {CalendarBlank, ChartBar, Stack} from '@phosphor-icons/react';
import {formatDate} from './data/market';
import {marketDay} from './data/calendar.mjs';
import {earningsComparison, reportedRevenue} from './data/company-earnings.mjs';
import './company-earnings.css';

const number = (value, options = {}) => Number.isFinite(value)
  ? value.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2, ...options})
  : '—';
const percent = value => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${number(value)}%` : '—';
const quarter = period => period.replace(/^([1-4])Q(\d{4})$/, 'Q$1 $2');

function EarningsChart({rows, revenue = false, currency}) {
  const element = useRef(null);
  const values = rows.flatMap(row => revenue ? [row.revenue] : [row.actual, row.estimate]).filter(Number.isFinite);
  const available = values.length > 0;
  const largest = Math.max(0, ...values.map(Math.abs));
  const scale = revenue && largest >= 1e9 ? 1e9 : revenue && largest >= 1e6 ? 1e6 : 1;
  const unit = scale === 1e9 ? 'billions' : scale === 1e6 ? 'millions' : '';
  const showEstimates = !revenue && rows.some(row => Number.isFinite(row.estimate));

  useEffect(() => {
    if (!available) return;
    let active = true, chart, observer;
    import('./earnings-chart.mjs').then(core => {
      if (!active) return;
      chart = core.init(element.current);
      function bars(field, name, style) {
        return {
          name, type: 'bar', barGap: '4%', barMaxWidth: 48, itemStyle: style,
          data: rows.map(row => Number.isFinite(row[field]) ? row[field] / scale : null),
          label: {show: true, position: 'outside', fontSize: 10, color: '#251b3a',
            formatter: point => number(point.value, {minimumFractionDigits: revenue ? 0 : 2})},
          labelLayout: {hideOverlap: true}
        };
      }
      const series = [bars(revenue ? 'revenue' : 'actual', 'Reported', {color: '#713bdd'})];
      if (showEstimates) series.push(bars('estimate', 'Estimate', {
        color: '#e4d9fa', borderColor: '#ad8be6', borderWidth: 1
      }));
      chart.setOption({
        animation: false, textStyle: {fontFamily: 'Inter, sans-serif', color: '#251b3a'},
        grid: {left: 3, right: 6, top: 22, bottom: 4, containLabel: true},
        tooltip: {trigger: 'axis', confine: true},
        xAxis: {type: 'category', data: rows.map(r => quarter(r.period)), axisTick: {show: false},
          axisLine: {lineStyle: {color: '#d6cde8'}}, axisLabel: {fontSize: 10, interval: 0, color: '#554969'}},
        yAxis: {type: 'value', splitNumber: 5, axisLabel: {fontSize: 10, color: '#6f6483'},
          splitLine: {lineStyle: {color: '#e3dcef'}}},
        series
      });
      observer = new ResizeObserver(() => chart.resize());
      observer.observe(element.current);
    }).catch(() => {});
    return () => { active = false; observer?.disconnect(); chart?.dispose(); };
  }, [rows, revenue, scale, available, showEstimates]);

  return <section className="company-earnings-chart">
    <div className="company-eps-heading">
      <h4>{revenue ? `Revenue · ${[currency || 'currency unspecified', unit].filter(Boolean).join(' ')}` : 'EPS per listed share'}</h4>
      {available && <div className="company-eps-legend"><span>Reported</span>{showEstimates && <span>Estimate</span>}</div>}
    </div>
    {available
      ? <div key="chart" ref={element} className="company-eps-canvas" role="img" aria-label={revenue
        ? 'Reported revenue by fiscal quarter. Exact values follow in the table.'
        : 'Actual versus estimated EPS by fiscal quarter. Exact values follow in the table.'}/>
      : <div key="empty" className="company-chart-empty">No reported {revenue ? 'revenue' : 'EPS'} supplied for these fiscal quarters.</div>}
  </section>;
}

function ReportHistory({rows, latestReport, currency}) {
  return <section className="company-earnings-results">
    <div className="company-history-heading">
      <h3>Earnings history</h3>
      {latestReport && <span><CalendarBlank size={15}/>Previous report: {formatDate(latestReport)}</span>}
    </div>
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Previous earnings reports">
      <table>
        <thead><tr>{['Fiscal quarter', 'Report date', 'EPS reported', 'EPS estimate', 'Revenue', 'Status'].map(label =>
          <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{rows.map(row => {
          const comparison = earningsComparison(row);
          const reported = Number.isFinite(row.actual);
          return <tr key={row.end || row.period}>
            <th scope="row">{quarter(row.period)}{row.end && <small>Ended {formatDate(row.end)}</small>}</th>
            <td>{row.reported ? formatDate(row.reported) : '—'}</td>
            <td>{number(row.actual)}</td><td>{number(row.estimate)}</td>
            <td>{number(row.revenue, {notation: 'compact', minimumFractionDigits: 0})}{Number.isFinite(row.revenue) && currency ? ` ${currency}` : ''}</td>
            <td><span className={`company-report-status ${reported ? 'green' : 'muted'}`}>{reported ? 'Reported' : 'Pending'}</span>
              {(comparison.difference !== null || comparison.percent !== null) && <small className="company-surprise"
                title={comparison.derived ? 'Calculated from reported and estimated EPS' : 'Yahoo earnings comparison'}>
                {comparison.difference !== null && comparison.result} {comparison.percent !== null && percent(comparison.percent)}
              </small>}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <p className="company-earnings-coverage">EPS is per listed share. Revenue uses the statement currency. Historical revenue estimates are unavailable. A dash indicates a missing figure.</p>
  </section>;
}

function CorporateEarnings({data, source}) {
  const [selected, setSelected] = useState(null);
  const [year, setYear] = useState('all');
  const earnings = data.earnings;
  const series = earnings.series?.length ? earnings.series : [{id: 'default', basis: earnings.basis, history: earnings.history}];
  const active = series.find(item => item.id === (selected || earnings.defaultSeries)) || series[0];
  const all = useMemo(() => active.history.toReversed().map(row => ({
    ...row, revenue: reportedRevenue(row, data.quarterly)
  })), [active.history, data.quarterly]);
  const years = [...new Set(all.map(row => /\d{4}/.exec(row.period)?.[0]).filter(Boolean))].sort().reverse();
  const selectedYear = years.includes(year) ? year : 'all';
  const rows = useMemo(() => selectedYear === 'all' ? all : all.filter(row => row.period.includes(selectedYear)), [all, selectedYear]);
  const chartRows = useMemo(() => rows.slice(0, 4).toReversed(), [rows]);
  const latest = all[0], comparison = latest && earningsComparison(latest);
  const currency = earnings.currency || data.financialCurrency;
  const today = marketDay(Date.now());
  const future = earnings.dates.filter(day => day >= today);
  const dates = future.length ? future : earnings.dates;
  return <div className="company-earnings">
    <div className="company-earnings-banner">
      <div><h3>Earnings</h3><p>Quarterly earnings per listed share and revenue for {data.name}.</p></div>
      <div className="company-next-report"><CalendarBlank size={22}/><div>
        <span>{future.length || !dates.length ? 'Next report' : 'Latest listed report date'}</span>
        <strong>{dates.map(formatDate).join(' – ') || 'Date not supplied'}{dates.length > 0 && earnings.estimated === true && ' · Estimated'}</strong>
        <p>{future.length ? 'Exact release time not supplied' : dates.length ? 'Past date · next release not supplied' : 'Schedule unavailable'}</p>
        <small>{source}</small>
      </div></div>
    </div>
    {all.length > 0 && <div className="company-earnings-filters">
      <span>{active.basis} · {all.length} available quarter{all.length === 1 ? '' : 's'}</span>
      {series.length > 1 && <label>EPS basis<select aria-label="EPS basis" value={active.id} onChange={event => setSelected(event.target.value)}>
        {series.map(item => <option key={item.id} value={item.id}>{item.basis}</option>)}</select></label>}
      <label>Fiscal year<select aria-label="Fiscal year" value={selectedYear} onChange={event => setYear(event.target.value)}>
        <option value="all">All available</option>{years.map(y => <option key={y}>{y}</option>)}</select></label>
    </div>}
    {rows.length > 0 ? <>
      <div className="company-earnings-charts"><EarningsChart rows={chartRows}/><EarningsChart rows={chartRows} revenue currency={currency}/></div>
      <ReportHistory rows={rows} latestReport={all.find(row => row.reported)?.reported} currency={currency}/>
    </> : <div className="company-earnings-empty"><ChartBar size={22}/><p>No previous earnings supplied for this company.</p></div>}
    <details className="company-disclosure"><summary>Reporting basis &amp; coverage</summary>
      {latest && <p className="company-earnings-summary">Latest actual EPS: {number(latest.actual)} · Consensus: {number(latest.estimate)} · <span className={comparison.tone}>{comparison.result} {comparison.percent !== null && percent(comparison.percent)}</span></p>}
      <p>Yahoo supplies recent quarters, not the company’s full lifetime history. Charts show up to four selected quarters. The table includes every selected quarter. GAAP and Non-GAAP results use different accounting bases.</p>
      <p>The feed does not specify an EPS currency or supply historical revenue estimates. Revenue is matched to the published fiscal period. Calculated surprises use the difference from the estimate divided by its absolute value. Estimated report dates can change.</p>
    </details>
  </div>;
}

export function CompanyEarnings({data, status, message, source}) {
  if (!data) return <div className="empty" role="status">
    <h3>{status === 'loading' ? 'Loading earnings…' : 'Earnings unavailable'}</h3>
    <p>{message || 'Fetching reported results for this company.'}</p></div>;
  if (data.fund) return <section className="company-earnings-empty">
    <Stack size={24}/><div><h3>Earnings reports do not apply to this fund</h3>
      <p>See Overview and Financials for fund information and distributions.</p></div></section>;
  return <CorporateEarnings data={data} source={source}/>;
}
