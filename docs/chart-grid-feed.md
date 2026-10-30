# Chart grid data connection

The Overview → Top / Hot → Grid view uses the existing authenticated market API.
It does not connect to a real-time service. Yahoo snapshots refresh every 60 seconds
while the document is visible; source limits and server cache/backoff still apply.
Only the six displayed listings request charts, with at most three grid chart
requests in flight. Navigation aborts obsolete requests and prevents their results
from appearing under a new listing or interval.

`src/market-feed.js` is the grid's provider boundary. Its `chart(symbol, interval,
signal)` method returns the same normalized chart snapshot used by the full charts:

- exact canonical listing key (`QQQ`, `SPY`, or exchange-qualified U.S. listing);
- requested `timeframe`, `status`, `fetchedAt`, and optional explanatory `message`;
- original `quote.provider`, `observedAt`, `sessionDate`, price and delay metadata;
- ordered source candles with timestamps, exchange dates, OHLC, volume and partial flags;
- indicators computed with full warm-up history, aligned one-for-one with returned
  candles, and per-bar session identifiers for VWAP resets.

The grid checks returned listing and interval before rendering. It preserves
same-scope cached candles on outages with an explicit stale label, and never carries
candles into another interval. Cropping to the latest source session slices the
already-calculated indicators with the candles, preserving their warm-up. The
current API returns a bounded history tail, so “Latest session” is not a guarantee
of coverage from the open. The existing setup endpoint independently checks full
regular-session coverage before qualifying a setup.

## Connecting a future provider

1. Confirm the provider, exchange entitlements, eligible instruments, latency and
   allowed data use. Store credentials server-side using the existing protected
   connection pattern, never in this adapter or workspace preferences.
2. Implement server-side normalization for quotes, chart history, source-timeframe
   zone confirmation and setup history. All four must use compatible provider and
   session definitions. Preserve provenance and do not combine unrelated contract bases.
3. If streaming is supported, use a bounded authenticated subscription for visible
   symbols and merge updates by source timestamp. Cancel on navigation; reconnect
   with backoff and explicit delayed/disconnected states. A stream may invalidate
   chart snapshots, but must not mark an open candle complete or skip missing bars.
4. Update the feed capability/status display from verified server connection state.
   `realtime:false` and the current explicit disconnected copy are intentional;
   changing a label alone does not establish a real-time feed.
5. Verify timestamp monotonicity, duplicate/out-of-order updates, disconnects,
   session boundaries/DST, entitlement errors, symbol changes, and closed-bar
   strategy parity in an isolated workspace before enabling the provider.

Grid preferences are revision-checked in `preferences.chartGrid`. Pins retain exact
listing identity; main chart settings, drawing scopes and setup intervals remain
independent. Mini charts are read-only; expanded charts use the existing saved
indicator/drawing controls. No order routing or options liquidity assessment is added.
