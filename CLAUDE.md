# CT3000 — Claude context

## Project
React + Supabase trading journal for IBKR traders. Trades are synced via IBKR Flex XML through a Vercel serverless function (`api/sync.js`), built into logical trades (`src/lib/logicalTradeBuilder.js`), and displayed across several screens.

## Key architecture

### Data flow
IBKR Flex XML → `api/sync.js` → `trades` table → `logicalTradeBuilder.js` → `logical_trades` table → screens

### Tables (Supabase)
- `trades` — raw IBKR executions; includes `fx_rate_to_base`, `currency`
- `logical_trades` — FIFO-matched positions built from raw trades; includes `fx_rate_to_base`, `total_realized_pnl`
- `planned_trades` — user trade plans; canonical price columns are `planned_entry_price`, `planned_stop_loss`, `planned_target_price`, `planned_quantity`
- `open_positions` — current open positions from IBKR
- `user_ibkr_credentials` — IBKR token, account_id, last_sync_at, `base_currency`

## Shared helpers — `src/lib/formatters.js`
All formatting and P&L helpers live here. Import from this file; do not define local copies.

| Export | Purpose |
|---|---|
| `pnlBase(t)` | `total_realized_pnl * (fx_rate_to_base \|\| 1)` — converts trade P&L to base currency |
| `currencySymbol(c)` | Maps currency code to symbol: USD→$, JPY→¥, EUR→€, GBP→£ |
| `fmtPrice(n, currency?)` | Price display, e.g. `$1,234.56`; null → `—` |
| `fmtPnl(n, currency?)` | Signed P&L, e.g. `+$1,234.56`; null → `—` |
| `fmtDate(iso)` | Short date, no year: `Apr 11` |
| `fmtDateLong(iso)` | Date with year: `Apr 11, 2026` |
| `fmtShort(n, currency?)` | Compact for chart axes: `+$1.2k` |

## Multi-currency
- IBKR provides `fxRateToBase` per execution in the Flex XML
- `api/sync.js` writes it to `trades.fx_rate_to_base`
- `logicalTradeBuilder.js` propagates the close-time rate to `logical_trades.fx_rate_to_base`
- Account base currency is parsed from the `<AccountInformation currency="...">` XML node and stored in `user_ibkr_credentials.base_currency`
- `DailyViewScreen` and `PerformanceScreen` fetch `base_currency` from `user_ibkr_credentials` on load and pass it to all format functions — never hardcode `'USD'` or `$`

## Field name conventions
Always use the canonical DB column names. Do not use old aliases.

| Concept | Correct column | Old aliases (do not use) |
|---|---|---|
| Entry price | `planned_entry_price` | `entry_price`, `entry` |
| Stop loss | `planned_stop_loss` | `stop_price`, `stop` |
| Target price | `planned_target_price` | `target_price`, `target` |
| Quantity | `planned_quantity` | `shares`, `quantity` |

## Conventions
- All Supabase queries must include `.eq('user_id', ...)` — no exceptions
- `select('*')` is safe; explicit column lists will 400 if a column doesn't exist yet
- Silent errors: always check the `error` field from Supabase responses; `PGRST116` (no rows) is expected for new users
- Format functions: null fallback is always `—`, never `N/A` or `null`
- Do not add dynamic `await import()` — use static imports to avoid webpack chunk hash issues on deploy
