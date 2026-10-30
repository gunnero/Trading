import {apiFetch} from './auth-client';
// Provider boundary: a future authenticated server adapter must preserve exact listing,
// interval, observation/fetch times, session dates, partial bars and indicator alignment.
// A subscription may invalidate snapshots, but must not bypass setup/closed-bar checks.
export const marketFeed=Object.freeze({
  id:'yahoo',label:'Yahoo Finance',realtime:false,refreshMs:60000,
  async chart(symbol,interval,signal){
    const response=await apiFetch('/api/market/chart?'+new URLSearchParams({symbol,interval}),{signal});
    if(!response.ok)throw new Error('Chart unavailable.');
    const body=await response.json();
    if(body.symbol!==symbol||body.timeframe!==interval||!['ok','stale','unavailable'].includes(body.status))throw new Error('Chart identity unavailable.');
    return body;
  },
});
