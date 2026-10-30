import {lazy, memo, Suspense} from 'react';
export {Sparkline} from './Sparkline';

// The chart engine is downloaded only when a price/yield chart is opened.
const Candles=lazy(()=>import('./ChartCanvas').then(module=>({default:module.PriceChart})));
const Treasury=lazy(()=>import('./ChartCanvas').then(module=>({default:module.TreasuryHistoryChart})));
const Loading=()=> <div className="chart-loading" role="status">Loading chart…</div>;
export const PriceChart=memo(function PriceChart(props){return <Suspense fallback={<Loading/>}><Candles {...props}/></Suspense>;});
export const TreasuryHistoryChart=memo(function TreasuryHistoryChart(props){return <Suspense fallback={<Loading/>}><Treasury {...props}/></Suspense>;});

const GridCandles=lazy(()=>import('./ChartCanvas').then(module=>({default:module.GridChart})));
export const GridChart=memo(function GridChart(props){return <Suspense fallback={<Loading/>}><GridCandles {...props}/></Suspense>;});
