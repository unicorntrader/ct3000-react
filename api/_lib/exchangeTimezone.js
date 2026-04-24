'use strict';

const { fromZonedTime } = require('date-fns-tz');

// IBKR Flex Query reports trade timestamps as wall-clock values in the
// exchange's local timezone, with no timezone annotation. Without the
// mapping below we'd treat them as UTC, which makes COUR fills on NYSE
// (recorded by IBKR as 16:13 ET) end up displayed as 16:13 UTC -- which
// is 19:13 in Cyprus, four hours wrong.
//
// Map exchange code -> IANA timezone. Add an entry whenever IBKR routes a
// fill through a venue we haven't seen before. Unknowns fall back to ET
// (logged) since the vast majority of routed fills are US venues.
const EXCHANGE_TZ = {
  // ── US equity venues ────────────────────────────────────────────
  NASDAQ:   'America/New_York',
  NYSE:     'America/New_York',
  ARCA:     'America/New_York',
  AMEX:     'America/New_York',
  BATS:     'America/New_York',
  IEX:      'America/New_York',
  DARK:     'America/New_York',
  IBKRATS:  'America/New_York',
  DRCTEDGE: 'America/New_York',
  EDGEA:    'America/New_York',
  EDGEX:    'America/New_York',
  PSX:      'America/New_York',
  PINK:     'America/New_York',

  // ── US options venues ───────────────────────────────────────────
  CBOE:     'America/New_York',
  CBOE2:    'America/New_York',
  NASDAQBX: 'America/New_York',
  PHLX:     'America/New_York',
  BOX:      'America/New_York',
  GEMINI:   'America/New_York',
  MIAX:     'America/New_York',
  NASDAQOM: 'America/New_York',
  ISE:      'America/New_York',

  // ── London ──────────────────────────────────────────────────────
  LSE:      'Europe/London',

  // ── Forex ───────────────────────────────────────────────────────
  // IBKR's FX venues report 24h continuous markets; UTC is the
  // sensible canonical choice (matches the user's spec).
  IDEALFX:  'UTC',
  THFXCFD:  'UTC',
};

// "--" appears on synthetic book entries (e.g. option expiry assignments)
// where there's no real venue. IBKR reports the dateTime as 16:20 ET (US
// option close); ET is the right interpretation.
EXCHANGE_TZ['--'] = 'America/New_York';

const FALLBACK_TZ = 'America/New_York';

function tzForExchange(exchange) {
  if (!exchange) return FALLBACK_TZ;
  if (EXCHANGE_TZ[exchange]) return EXCHANGE_TZ[exchange];
  // Log + fall back. We'd rather sync correctly-ish than fail; an unknown
  // venue lands an entry in Sentry-watched logs so we can add it later.
  console.warn(`[exchangeTimezone] unknown exchange "${exchange}" -- falling back to ${FALLBACK_TZ}`);
  return FALLBACK_TZ;
}

// Convert an IBKR Flex datetime ("YYYYMMDD;HHMMSS" or "YYYY-MM-DDTHH:MM:SS"
// without tz) plus the exchange code into a real ISO 8601 UTC string.
//
// Examples:
//   ibkrDateToUtcIso("20260423;161343", "NASDAQ")
//     -> "2026-04-23T20:13:43.000Z"   (16:13 EDT == 20:13 UTC in April)
//   ibkrDateToUtcIso("20260408;100300", "DARK")
//     -> "2026-04-08T14:03:00.000Z"
//   ibkrDateToUtcIso("20260327;050132", "IDEALFX")
//     -> "2026-03-27T05:01:32.000Z"   (UTC-mapped venue, no shift)
//
// Returns null on unparseable input. Caller is expected to treat null as
// "skip / log warning" -- a row with no timestamp is unusable downstream.
function ibkrDateToUtcIso(dt, exchange) {
  if (!dt) return null;

  // Accept both IBKR compact and ISO-shaped inputs. Either way, derive the
  // wall-clock components -- we'll attach the timezone ourselves.
  let yyyy, mm, dd, hh, mi, ss;
  if (dt.length >= 10 && dt[4] === '-') {
    // "2026-04-23T16:13:43" or "2026-04-23 16:13:43"
    const m = dt.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return null;
    [, yyyy, mm, dd, hh, mi, ss] = m;
    ss = ss || '00';
  } else {
    // "20260423;161343"
    const [date, time] = dt.split(';');
    if (!date || date.length < 8) return null;
    yyyy = date.slice(0, 4);
    mm = date.slice(4, 6);
    dd = date.slice(6, 8);
    if (time && time.length >= 6) {
      hh = time.slice(0, 2);
      mi = time.slice(2, 4);
      ss = time.slice(4, 6);
    } else {
      hh = '00'; mi = '00'; ss = '00';
    }
  }

  const localStr = `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`;
  const tz = tzForExchange(exchange);
  const utcDate = fromZonedTime(localStr, tz);
  if (isNaN(utcDate.getTime())) return null;
  return utcDate.toISOString();
}

module.exports = { ibkrDateToUtcIso, tzForExchange, EXCHANGE_TZ };
