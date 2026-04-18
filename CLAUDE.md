# CT3000 — Claude context

## Project
React + Supabase trading journal for IBKR traders. Trades are synced via IBKR Flex XML through a Vercel serverless function (`api/sync.js`), built into logical trades server-side (`api/lib/logicalTradeBuilder.js`, invoked from `api/rebuild.js`), and displayed across several screens.

## Key architecture

### Data flow
IBKR Flex XML → `api/sync.js` → `trades` table → `api/lib/logicalTradeBuilder.js` (via `api/rebuild.js`) → `logical_trades` table → screens

The browser never runs FIFO — it only reads the finished `logical_trades` rows.

### Tables (Supabase)
Core trading data:
- `trades` — raw IBKR executions; includes `fx_rate_to_base`, `currency`
- `logical_trades` — FIFO-matched positions built from raw trades; `matching_status` is one of `matched` / `needs_review` / `off_plan`; also includes `fx_rate_to_base`, `total_realized_pnl`, `planned_trade_id`, `user_reviewed` (true = user's decision is preserved across rebuilds)
- `logical_trade_executions` — join table linking `trades` rows to their `logical_trades` parent (execution_type, quantity_applied) — FIFO provenance
- `open_positions` — current open positions from IBKR
- `securities` — instrument metadata cache: `conid`, `symbol`, `multiplier`, `currency`, `underlying_*`

Plans & matching:
- `planned_trades` — user trade plans; canonical price columns are `planned_entry_price`, `planned_stop_loss`, `planned_target_price`, `planned_quantity`
- `planned_trade_executions` — links a `logical_trade` to the `planned_trade` it matched; carries `matching_confidence` + `matched_by` (required)
- `playbooks` — reusable trade setups/strategies referenced by `planned_trades.playbook_id`
- `missed_trades` — trades the user wanted but didn't take (noted_entry_price, noted_at, thesis)

Journaling & review:
- `daily_notes` — per-day notes on `DailyViewScreen` (unique per user+date_key)
- `weekly_reviews` — weekly retrospective (worked / didnt_work / recurring / action), unique per user+week_key

User & account:
- `user_ibkr_credentials` — IBKR token, account_id, last_sync_at, `base_currency`
- `user_subscriptions` — Stripe state: `stripe_customer_id`, `subscription_status`, `trial_ends_at`, `is_comped`, `has_seen_welcome`, `ibkr_connected`, `demo_seeded`
- `anonymous_sessions` — 48h ephemeral pre-signup sessions; converts to real user on signup
- `invited_users` — beta invite tokens (email, token, redeemed_at, redeemed_by)

Ops / admin:
- `admin_actions` — admin moderation audit log (action_type, target_user_id, expires_at)
- `app_settings` — global key/value store
- `ghost_webhook_events` — inbound webhook events from Ghost CMS (membership sync)

Baseline DDL lives in `supabase/migrations/00000000000000_baseline_schema.sql` (reference-only snapshot; incremental changes go in dated migrations alongside it).

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
- `api/lib/logicalTradeBuilder.js` propagates the close-time rate to `logical_trades.fx_rate_to_base`
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

## Data-loading pattern (required)
Every `useEffect` that loads data from Supabase MUST use the standard load pattern so
failures never result in a hanging spinner or silently empty screen. The components
directory exports `<LoadError>` for the error UI.

```js
import * as Sentry from '@sentry/react';
import LoadError from '../components/LoadError';

const [loading, setLoading]   = useState(true);
const [loadError, setLoadError] = useState(null);
const [reloadKey, setReloadKey] = useState(0);

useEffect(() => {
  if (!userId) return;
  setLoading(true);
  setLoadError(null);
  (async () => {
    try {
      const res = await supabase.from('...').select('*').eq('user_id', userId);
      if (res.error) throw res.error;    // Supabase returns errors as a field, not rejection
      setData(res.data || []);
    } catch (err) {
      console.error('[screen-name] load failed:', err?.message || err);
      Sentry.withScope((scope) => {
        scope.setTag('screen', 'screen-name');
        scope.setTag('step', 'load');
        Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
      });
      setLoadError(err?.message || 'Could not load.');
    } finally {
      setLoading(false);
    }
  })();
}, [userId, reloadKey]);

if (loadError) return <LoadError title="Could not load X" message={loadError} onRetry={() => setReloadKey(k => k + 1)} />;
if (loading)   return <SkeletonOrSpinner />;
```

This applies to ALL screens AND sub-modules (Playbooks, Missed Trades, etc.). Any new
data-loading surface that doesn't follow this pattern is a bug.
