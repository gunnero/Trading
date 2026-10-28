# Opening Bell — Session Desk

Trading web app in its first implementation phase. SPY and QQQ options planning stays central; ES/NQ and the imported watchlist provide context. The approved design now has a standalone backend and a durable saved workspace. Market briefing adds external sentiment and U.S. events; the dedicated News page carries Yahoo market and watchlist headlines. Yahoo Finance supplies interim stock prices and chart history; an options feed is not connected yet.

## Run locally

```sh
npm install
npm run build
npm start
```

Requires Node 24+ (built-in SQLite). The standalone server binds to `http://127.0.0.1:4173` and serves the built client, workspace API and briefing APIs together. `OPENING_BELL_PORT` changes its port. For development, `npm run dev -- --host 127.0.0.1 --port 4173 --strictPort` uses the same APIs and saved workspace. Only one server should own that port. Owner authentication protects the local app and every data API. No public deployment or brokerage connection is configured; this is a single-owner app.

## Private owner access

Before creating a new account database, optionally set `OPENING_BELL_OWNER_EMAIL`, `OPENING_BELL_OWNER_USERNAME` and `OPENING_BELL_OWNER_NAME` in the server environment. The initial placeholders are `owner@example.com`, `gunner` and `Workspace owner`. Existing databases keep their saved identity and credentials; changing these variables does not overwrite them. Sign in with either email or username. Email is an account identifier, not an email-delivery or verified-email integration. There is no public registration, default password, password in an environment variable, or authentication bypass.

On the server computer, `npm run auth:setup` creates a private, single-use activation link in `.data/owner-setup.html` (expires after 30 minutes). Open it locally, choose a unique 15–128-character password, then follow **Account & security** to enroll an authenticator and save the ten recovery codes. QR codes are generated locally. The activation fragment is removed from browser history immediately; activation files are removed after successful use. Do not share the activation file/link.

Passwords use salted scrypt (`N=131072`, `r=8`, `p=1`). Sessions use random 256-bit opaque tokens in persistent HttpOnly, SameSite=Strict cookies; only token hashes are stored server-side. Sessions last 30 days from sign-in, including inactivity and browser restarts. Cookie Max-Age/Expires match the server's absolute expiry; neither interaction nor background feed polling extends it. Existing sessions retain their original expiry until the next sign-in; expired sessions are never revived. Password changes, authenticator replacement, recovery-code replacement and **Sign out all devices** revoke previous sessions. TOTP codes cannot be replayed; recovery codes are hashed and single use. Login attempts are bounded across processes/restarts, and password hashing concurrency is limited. Protected writes require exact-origin checks and a session-bound CSRF token. Auth/data responses are not cached by the browser.

`.data/auth.sqlite` holds the account, sessions, recovery-code hashes and a bounded security-event history. `.data/auth.key` encrypts authenticator secrets with AES-256-GCM and signs CSRF tokens. The directory is owner-only and the key/database files are mode 0600. Workspace data remains in the existing `.data/workspace.sqlite`; login does not reset it. Back up the whole `.data/` directory securely with the server stopped, retaining the encryption key. These access controls do not encrypt the trading workspace on disk or protect against someone controlling the server OS; use private disk/backup storage.

For a forgotten password or lost authenticator **and** recovery codes, the server owner can run `npm run auth:recover` and open its private local link. Completing recovery resets password/MFA and revokes all sessions, while preserving the workspace. This is an explicit local administrative action, not a public reset endpoint; there is no email reset service. A missing encryption key fails closed and requires restoring the protected backup.

Public hosting is **not enabled**. A future deployment must use the built standalone Node server behind an HTTPS reverse proxy, preserve the configured Host, keep the Node listener bound to loopback, and set `OPENING_BELL_ORIGIN=https://your-real-domain` plus `NODE_ENV=production`. Production refuses to start without the exact HTTPS origin and an activated account with MFA. It uses Secure `__Host-` cookies, HSTS, CSP and frame protection. Forwarded host/IP headers do not grant trust; login throttling behind a reverse proxy remains shared. Activation/recovery must be performed in local mode before returning to public mode. Vite is local-only. The retained Sites worker is static-only and **does not implement authentication or APIs**; it cannot replace this runtime.

Validation: after building, `npm run test:auth` checks server authorization, CSRF/origin failures, expiry, session revocation, password changes, TOTP/recovery replay, persistent throttling, public-mode safeguards, browser enrollment/sign-in/sign-out, responsive forms and Vite file protection. All tests use isolated temporary databases. `npm run test:responsive` and `npm run test:workspace:browser` cover chart interactions and saved-workspace regressions behind real test sessions; production exposes no test login route.

Security implementation references: [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [OWASP CSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), and [OTPAuth](https://hectorm.github.io/otpauth/). Automated checks are evidence for these implemented controls, not a guarantee against every vulnerability.

## Saved workspace

The backend saves imported levels/watchlists, draft plans, review notes, manual CNN readings and the selected instrument/interval in `.data/workspace.sqlite`. The original user files seed a new database once. Reloads and server restarts retain changes; the first chart defaults to QQQ / 4h, then remembers your selection.

Edits autosave after a short delay. A visible status confirms saves or offers recovery. Revision checks reject outdated saves from another tab. Back up unsaved edits before choosing **Load saved version** after a conflict. A failed request retains edits in the tab and offers **Retry save**. **Back up workspace** downloads the current workspace as JSON, including unsaved edits. A backup restore interface is not included in this milestone.

`.data/` is excluded from source packaging. Set `OPENING_BELL_DATA_DIR` to move the SQLite directory. Do not delete that directory to reset a preview: it contains the owner's saved work. The separate `.cache/` directory contains only public feed responses and backoff metadata.

## Workflows

- The sidebar shows the current **U.S. stock-market session**, Skopje date and 24-hour clock, next change/countdown and next regular opening. A compact clock stays visible on tablet/mobile. Click it for local pre-market, regular and after-hours times and separate SPY/QQQ options reference hours.
- SPY/QQQ chart intervals: **2m, 5m, 15m, 30m, 1h, 4h, D, W, M**. Initial default **4h**; subsequent selections persist. Intervals use source candles and the documented session-aware aggregation; missing history is never generated.
- Inspect all 52 supplied watchlist entries and 141 original zones across 40 instruments. Paste or upload replacement watchlists and level sheets with validation.
- Draft conditional options plans with expiration, structure, premium loss budget and notes. Top/Hot ranks eligible watchlist break-and-retest setups using completed candles and EMA/VWAP checks; it is not a calibrated forecast. No options quote or trade execution is connected.
- Open **Market briefing** for sentiment and the U.S. economic calendar.
- Open **News** from the sidebar or the Overview latest-headline card for a full-width feed, led by the latest story and its publisher preview image where available. Other stories have smaller thumbnails or a text layout. Switch between U.S. markets, your watchlist, individual tickers and economy headlines. Source timestamps use Skopje’s 24-hour clock; story links open the original publisher.
- Open **gunner’s lvls** beside the chart or in the briefing toolkit. Copy the current level sheet, open the protected script, and open SPY/QQQ in TradingView with the selected interval. The app independently calculates completed-candle supply/demand flips; it does not execute the protected Pine script or synchronize with TradingView.

## External sources

`server/feeds.mjs` validates and normalizes fixed provider endpoints. `server/index.mjs` serves the APIs in the standalone runtime; `server/vite-feeds.mjs` attaches them to Vite dev and preview. There is no arbitrary-URL proxy. The optional Oanor credential is sent only by the server to its fixed HTTPS API host.

| Source | Behavior | Limits |
|---|---|---|
| [CNN Fear & Greed](https://edition.cnn.com/markets/fear-and-greed) | Automatic score, rating, comparisons and original CNN observation time from the [hourly community mirror](https://github.com/chirag127/fear-greed-index-api), with the [daily archive](https://github.com/whit3rabbit/fear-greed-data) as a backup | The direct CNN endpoint still returns HTTP 418. The app chooses the newest valid CNN observation from the configured [Oanor API](https://www.oanor.dev/api/stockfeargreed-api) and the two public datasets. API access requires the owner’s key; mirror snapshots alone do not reliably match CNN intraday. |
| [Forex Factory calendar](https://www.forexfactory.com/calendar) | Published-week JSON, filtered to U.S. events, for selections within the current week | Missing actuals/revisions remain blank. Its ranged HTML rejected this runtime with HTTP 403; the app does not bypass it. |
| [Finance Calendar](https://www.financecalendar.com/api/) | Automatic future and historical ranges through the documented free, keyless API; U.S. events only, with visible attribution and publisher links | Coverage and impact ratings differ from Forex Factory. Some releases and forecasts are unavailable. Estimated schedules and overdue source verification are marked; date-only events never receive invented release times. |
| [Yahoo Finance](https://finance.yahoo.com/) | Public ticker RSS for SPY/QQQ/IWM/DIA, all eligible watchlist listings, or a selected ticker | 45 of the original 52 entries are U.S.-listed stocks, funds or ADRs. Headlines may concern related companies and overseas events affecting U.S. markets. The economy filter matches headline topics, not a comprehensive economic newswire. Provider coverage is not exhaustive; links may require subscriptions. |

Feeds cache for 10 minutes (CNN archive: one hour); failed requests back off for at least 5 minutes and honor longer `Retry-After` values. Concurrent identical requests share a fetch. A bounded local cache in ignored `.cache/briefing-feeds.json` survives preview restarts. Failed refreshes retain successful data for up to 24 hours with its original fetch time and an explicit cached status. Cached downloads older than that are unavailable. The client checks sources every 10 minutes while mounted. Clearing local cache is not a rate-limit workaround.

CNN observations load automatically; the public mirrors can be hours behind CNN. To connect the optional API, open **Settings → Connections → CNN Fear & Greed**, subscribe to Oanor’s **Free** Stock Market Fear & Greed API plan, and enter the key in the password field. **Connect & check** validates a CNN-specific response before saving. The published free allowance is 12,000 calls/month; ten-minute polling uses at most 4,464 scheduled checks in a 31-day month, plus explicit connection checks. Freshness still depends on the provider, and periodic snapshots can differ from CNN between checks.

The API key is AES-256-GCM encrypted with a separate purpose tag in the existing private authentication database, never returned by the settings endpoint or included in workspace exports, public feed caches, browser storage or the client bundle. Back up `auth.sqlite` and `auth.key` together. Settings use the owner’s existing session, same-origin checks and CSRF protection. Only the fixed Oanor HTTPS URL receives the key; redirects and oversized responses are rejected. Provider retry delays persist across restart. Disconnect removes the key and its cached API reading while preserving community fallbacks. Live provider validation remains pending until the owner supplies a key.

 The hourly source is checked every ten minutes, and the daily archive caches for one hour. Only the mirror’s CNN-specific snapshot is accepted; its generic headline, run date and other markets are ignored. Published values, original rating and observation time stay together, with two-decimal display and visible attribution. During regular market hours, a pre-open reading is labeled awaiting an update; an API observation older than 20 trading-session minutes (90 for hourly mirrors) is labeled delayed. Outdated/cached observations show **Current reading unavailable** above a smaller **Last available snapshot**, with no current gauge or sentiment tint on Overview. A missing session update stays outdated after close or over the weekend; a valid closing reading remains useful while the exchange is closed. Source check time is separate from index reading time. Observation age is checked independently of download time: older than four days is flagged, older than seven days or more than five minutes in the future is rejected. Weekend readings remain useful with their actual date visible. A saved manual reading is an optional outage fallback; automatic data always takes priority when available. There is no direct-CNN block bypass, generated score, or crypto sentiment substitution.

Provider links, observation/publication dates and fetch times remain visible. Article bodies are not copied into the app. No feed is a guaranteed real-time service.

Overview and News share the latest market headlines and their 10-minute refresh. The Overview card shows the actual newest returned story, publisher and Skopje publication time, with explicit cached/unavailable states. “Latest” means publication order; this feed does not supply dependable breaking-news flags or editorial rankings.

News images come from publisher RSS media/enclosure fields or public article Open Graph metadata. The current Yahoo ticker RSS supplies no images, so the first eight stories can receive previews from verified Yahoo Finance, Motley Fool and 24/7 Wall St. pages. Metadata requests use fixed article/image host allowlists, reject redirects, stop at the document head, cap reads at 1 MB and time out after 3 seconds. Each feed uses at most three concurrent lookups. Successful image metadata caches for six hours; misses cache for one hour, and publisher blocks back off for at least one hour or a longer Retry-After. These caches persist with the public feed cache. Images load from the publisher’s CDN with no referrer; no image proxy or stored image copy is created. Missing, unsupported, blocked or broken images leave the headline readable in a text layout.

Calendar navigation offers **Today, Upcoming (14 days), This week, Next week, This month, Next month**, previous/next week arrows and **Choose dates**. Weeks run Sunday–Saturday, and custom selections cover up to 93 days. Date filters follow the U.S. release calendar. Displayed event dates and times use **Europe/Skopje, 24-hour format**, including daylight-saving changes; date-only/all-day schedules retain the published date. Selecting a range fetches it automatically; no event entry, API key or external-site visit is needed. The source appears beside the calendar title. Range-specific caches prevent a previous week from appearing as the new selection. Pagination is completed before a successful response is displayed.

Overview shows the **next high-impact release** from the next 14 days, with its Skopje time and source. It skips past/cancelled/untimed events and advances as time passes. Clicking the card opens Upcoming. Cached schedules and estimated releases are marked.

Calendar impact matches the supplied reference: **yellow Low, orange Medium, red High**, with filled factory icons, text labels and a persistent legend. Holiday/unrated events use gray. Click **Low, Medium, High or Holiday** in the legend to show only that impact; **All** resets the filter. Buttons and the dropdown stay synchronized and support keyboard operation.

## Market session clock

The current session clock is independent of price and economic-news feeds. It uses device time, ticks each second while visible, and resynchronizes on tab focus/visibility changes. Its states are **Pre-market, Market open, After-hours, Market closed, Weekend and Market holiday**, with distinct colors and text. The full session timetable opens by clicking the clock; small screens retain a compact status/time strip above the market context.

`src/data/market-session.mjs` contains the [NYSE published holiday and early-close calendar](https://www.nyse.com/trade/hours-calendars) for 2026–2028, checked October 24, 2026. Stock/ETF sessions follow NYSE Arca: pre-market 04:00–09:30, regular 09:30–16:00, after-hours 16:00–20:00 in New York. Published half-days end regular trading at 13:00 and extended trading at 17:00. The separate eligible SPY/QQQ options regular-hours reference ends at 16:15 (13:15 on half-days), with links to [Nasdaq options hours](https://www.nasdaqtrader.com/Trader.aspx?id=optionshours) and [Cboe sessions](https://www.cboe.com/about/hours/us-options/). Broker cutoffs and access to extended options sessions vary; the stock-session indicator does not establish contract tradability.

Session boundaries are converted using `America/New_York` rules for each scheduled date, then displayed in `Europe/Skopje`; the two regions change daylight-saving time on different dates. Local midnight and after-hours date rollover are shown explicitly. Weekend/holiday searches skip to the next published trading day. Calendar coverage ends December 31, 2028; unsupported dates display **Schedule unknown**, and unknown next sessions have no fabricated countdown. The checked calendar must be maintained when exchange schedules change. Unscheduled closures and trading halts are not monitored.

## Market-data connection

Yahoo Finance supplies interim underlying quotes and history through the server; the two-year Treasury yield uses the official daily Treasury observations. Delayed, cached, missing and extended-hours readings are labeled. Unsupported listings stay unavailable. No broker connection, options chain, spreads or Greeks are supplied. [TradingView's data FAQ](https://en.tradingview.com/widget-docs/faq/data/) explains that paid data subscriptions do not transfer to widgets; this app does not inherit TradingView or broker entitlements.

**Hosting boundary:** the protected scaffold files `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` remain intact. The generated Sites worker serves static assets only. A future Sites deployment must add compatible API/storage infrastructure; uploading `dist` alone will not provide feeds or saved workspaces. Node SQLite cannot run in the retained static Worker. The UI reports an unavailable service if opened without the workspace API.

## Data boundaries

Quotes and candles come from the stated providers; unavailable data never falls back to generated prices. The original design image and isolated test fixtures contain illustrative values. The bundled October 23, 2026 level sheet and watchlist are historical starter references, not current trading signals. The owner's saved workspace, account files, API credentials, actual journal imports, backups and QA captures are excluded from Git.

Source candles are aggregated using their session boundaries, with partial bars marked. EMAs follow the selected interval, while the 20/50/100/200 SMAs use completed daily history. Previous-day references and session VWAP require sufficient observed data. Imported zones are dated references; changing the chart interval does not change their source timeframe. Current flipped roles are not historical backtest coloring.

Level sheets for a different date pause chart/scenario comparisons. S = supply, D = demand, G = gap, consistent with the [indicator description](https://www.tradingview.com/script/seVxGaLs-gunner-s-lvls/). Gap references do not drive the supply/demand scenario engine. Futures contracts and chart-adjustment conventions still require confirmation before live use. BTC spot is not assigned BTC futures levels.

Saved plans preserve their source price, observation time and session date. Legacy sample plans remain labeled as samples. Executed trades are separate journal records entered or imported by the owner. A native mobile app remains a later phase; this is responsive web.

## Source and verification

- UI: `src/App.jsx`, `src/Briefing.jsx`, `src/styles.css`.
- Charts: Apache ECharts loaded through `src/Charts.jsx`; source history in `server/market-data.mjs`, with indicators and aggregation helpers in `src/data/`.
- Parsers and imported fixtures: `src/data/market.js`, `server/seed/levels.txt`, `server/seed/watchlist.txt`.
- Saved workspace: `server/workspace.mjs`, `src/useWorkspace.js`; standalone runtime: `server/index.mjs`.
- Visual reference: `docs/selected-design.png`; Phosphor icons and locally hosted Inter.
- `npm run test:data`: calendar date ranges, pagination, Skopje/US DST transitions, next-high-impact selection, timing precision, per-range caching, provider normalization, automatic CNN archive attribution, old/future observation guards, filtering, missing data, cache/backoff, safe routes, candle aggregation, image metadata normalization, bounded lookups, image host validation and persisted publisher backoff.
- `npm run test:browser`: main workflows, all intervals, TradingView links/copy, imports, plans and responsive web.
- `npm run test:briefing`: actual source responses, separate News navigation and responsive layouts, plus isolated browser fixtures for unavailable/empty/zero states and filters. Test readings are written only to the temporary QA database.
- `npm run test:clock`: isolated browser clock fixtures for session-boundary transitions, holidays, early closes, Skopje midnight/DST, keyboard-accessible hours, expired calendar coverage and desktop/mobile layouts. Calendar calculations also run in `npm run test:data`.
- `npm run test:workspace`: SQLite durability, validation, concurrency and HTTP save behavior.
- `npm run test:workspace:browser`: real server restart, saved state, two-tab conflicts, edits during a save, failed-save retry, JSON backup and calendar colors.
- `npm run test:sites`: preserved worker behavior.

Build before running browser checks. Each npm browser command starts an isolated runtime and temporary SQLite database, then cleans it up. They never mutate the owner's preview workspace. Screenshots/results go to the ignored `docs/qa/` directory. Several browser scripts currently reference the original development machine's Chromium installation; those paths must be adapted on another machine. Scripts that expose `OPENING_BELL_BROWSER` accept an installed browser path.

## Extended-hours price context

Stock and ETF price cards use Yahoo pre-market or after-hours chart observations while the source session is active. They show the source bar timestamp in Skopje and compare the price with the last regular close. Missing observations retain the original regular-session quote and date; stale prices never enable level comparisons. Extended prices are not a guaranteed real-time feed.

Charts, automatic zone flips and break-and-retest confirmation continue to use regular-session candles only. Today’s levels show as ready while awaiting today’s regular-session data, with the opening time converted to Skopje using its actual date and DST. No repeated level import is needed.


### Personal settings

Open **Settings** above the profile at the bottom of the sidebar. Charts manages global defaults and confirmed resets; Connections manages the CNN API; Account links to password/MFA/session controls; Workspace offers the current time-display details and a JSON backup. The selected settings section survives refresh. Market briefing’s **Manage CNN connection** action opens Connections directly. Chart-header gears retain the quick default editor. The sidebar and Settings → Account include **Log out**, with the existing protection for unsaved workspace changes.


### Trade journal

Open **Trade journal** for manual USD option records and reviewed screenshot imports. Add one matched entry/exit quantity, select the trading account, and enter Skopje times. Save notes, tags and your own 2-minute break/retest review. Existing Session review drafts remain separate.

A screenshot shared in this chat can be transcribed into an `opening-bell-journal-v1` JSON file. **Import trades** previews that file; nothing enters performance until reviewed and imported. Private prepared files in `.data/journal-drafts/` appear as a review banner through an authenticated, read-only endpoint. The app does not read image files automatically or connect to Vanquish. Do not put drafts under public assets.

Gross results come from premiums × matched quantity × contract multiplier. Net results require explicitly entered total fees; blank fees and risk remain unknown. Open records are not marked to market. Calendar dates follow Skopje exit dates. Cumulative gross P/L starts at zero for the selected filter, not at an account balance. It cannot measure unrealized intraday peaks or establish prop-firm drawdown/payout compliance.

The journal uses existing workspace autosave/revision checks, is included in workspace backup, and supports reviewed JSON export, duplicate detection, editing and delete/Undo. Current bounds: 2,000 journal records, 1.5 MB journal data, and 2,000 records/2 MB per import (private daily staged drafts remain capped at 500 KB). Run `npm run test:journal` after a production build; browser checks use an isolated account/database.

Selecting a saved trade opens its **Trade chart**: actual underlying stock/ETF candles on the recorded dates, exact entry/exit time markers, and separate option-premium summaries. The default is 2m, with 5m/15m, zoom/pan, a range slider and Fit trade. **Details & notes** retains the existing editor. Chart viewing makes no workspace writes. Yahoo history is requested for at most 31 calendar days using the exchange session date; missing or unavailable historical candles never fall back to today's data. Historical option candles are not connected. On touch screens, enable Interact to pan/zoom and Done interacting to resume page scrolling. Run `npm run test:journal-chart` after building.
