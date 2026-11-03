# Portfolio Manager

Portfolio Manager tracks whole accounts belonging to named people, with separate platform accounts, holdings, currencies, source details and connection state. It does not allocate ownership shares or place trades.

Trading 212 is the first automatic connector. Its official API supports Invest and Stocks ISA accounts, using an API key and secret. The owner must authorize access and select read permissions for accounts and portfolios, leaving order execution disabled. Enter credentials only through the app’s connection form. The connector cannot independently inspect the key’s granted scopes; it only sends GET requests to the fixed account-summary and positions endpoints. Other platforms support saved snapshots.

The page refreshes connected accounts every minute while visible, with two client workers, shared server in-flight suppression and persisted per-account retry windows. A full summary and positions response must validate before replacing an account snapshot. Errors retain the last successful snapshot with its original fetch time. API fetch time is not a quote observation timestamp, and the two broker reads are not atomic. This is polling rather than a guaranteed real-time streaming feed. Empty successful positions arrays remove closed holdings. Demo accounts are explicitly labeled and excluded from combined totals; repeated broker account IDs within an environment are rejected.

Share prices use the instrument currency; holding values and returns use the primary account currency supplied by `walletImpact`. Cash includes available, order-reserved and pie cash. Realized trading P/L, unrealized P/L and a manually reported total return are separate fields. The connector does not manufacture net deposits, dividends, time-weighted returns, portfolio history or FX conversions. Allocation is based only on known position values, excluding cash. Currency totals use last available snapshots and disclose missing accounts.

## Data and operations

The private `portfolio.sqlite` database resides in `OPENING_BELL_DATA_DIR` alongside the existing databases. It uses WAL, file mode 0600 and revision-checked metadata/import writes. API credentials are encrypted using the existing authentication key with account-specific authenticated context. No credentials are returned to the browser or included in snapshot exports. All routes mount behind the existing owner authentication, origin and CSRF checks. Back up this database and `auth.key` with the other operational state; the general workspace export does not contain it. Snapshot exports preserve account financial data, but exclude people, account labels and connections.

Users can add/rename/remove people and platform accounts, review/import a version-1 JSON snapshot, export an account snapshot, connect or disconnect Trading 212, and search holdings. Removing an account requires confirmation; exporting its snapshot first preserves the financial data. Disconnecting deletes credentials while keeping the last snapshot. Import requires disconnecting first and always becomes a manual snapshot, regardless of the input’s source field.

The empty JSON template is downloadable in the import dialog. Required fields are `version: 1`, a three-letter `currency`, and a `holdings` array. Each holding requires `ticker`, `name` and numeric `quantity`. Optional monetary fields remain null when missing; quantities retain up to eight decimals in the UI. `observedAt` must contain a timezone if known. Screenshots without a verified observation date keep it unknown; file modification times are not used as market timestamps. Use an exact broker instrument identifier or the screenshot’s label without guessing a market-feed mapping.

## Sources and verification

API schemas and authentication were checked against the official documentation on 2026-11-03:

- [Trading 212 account summary](https://docs.trading212.com/api/accounts/getaccountsummary)
- [Trading 212 positions](https://docs.trading212.com/api/positions)
- [Authentication and rate limits](https://docs.trading212.com/api/section/authentication)
- [API key setup and permissions](https://helpcentre.trading212.com/hc/en-us/articles/14584770928157-Trading-212-API-key)

Run `npm run build` and `npm run test:portfolio`. Connector tests use isolated fake account responses. Actual account access remains unverified until an authorized owner connects their credentials. Private imports, photographs and owner screenshots belong only in ignored data/QA directories, never in public source or test fixtures.
