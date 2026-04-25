// Historical OHLC bars for the trade-review chart in TradeInlineDetail.
//
// Wraps Alpaca's /v2/stocks/{symbol}/bars (free IEX feed) so we don't
// expose API keys to the browser, can rate-limit / cache server-side
// later, and can fall back to other providers without changing the
// client. JWT-gated + subscription-gated like every other paid endpoint.
//
// GET /api/ohlc?symbol=AAPL&timeframe=5m&from=2026-04-01T13:30:00Z&to=2026-04-25T20:00:00Z
//
// Response (bars[] = chronological, oldest first):
//   { source: 'alpaca', bars: [{ time, open, high, low, close }] }
// On non-equity / unsupported / no-data: { source: 'none', bars: [] }
// On Alpaca error: 502 with { error: '...' }

const { createClient } = require('@supabase/supabase-js');
const { captureServerError } = require('./_lib/sentry');
const { requireActiveSubscription } = require('./_lib/requireActiveSubscription');

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://ct3000-react.vercel.app';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Our chart's timeframe labels → Alpaca's vocabulary.
const TF_MAP = {
  '1m': '1Min',
  '5m': '5Min',
  '15m': '15Min',
  '1h': '1Hour',
  '1D': '1Day',
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(authHeader.slice(7));
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  const userId = user.id;

  const sub = await requireActiveSubscription(userId, supabaseAdmin);
  if (!sub.ok) {
    return res.status(402).json({ error: sub.reason });
  }

  const { symbol, timeframe, from, to } = req.query;
  if (!symbol || !timeframe || !from || !to) {
    return res.status(400).json({ error: 'Missing required query params: symbol, timeframe, from, to' });
  }
  const alpacaTf = TF_MAP[timeframe];
  if (!alpacaTf) {
    return res.status(400).json({ error: `Unsupported timeframe: ${timeframe}` });
  }

  const apiKey = process.env.ALPACA_API_KEY_ID;
  const apiSecret = process.env.ALPACA_API_SECRET_KEY;
  if (!apiKey || !apiSecret) {
    console.error('[ohlc] missing ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY env vars');
    return res.status(500).json({ error: 'OHLC provider not configured' });
  }

  // Sanitise symbol — Alpaca expects bare ticker for equities. If the
  // user trades options (OSI-formatted symbols), Alpaca's stocks endpoint
  // will return empty bars; we surface that with source:'none' so the UI
  // can show a "no chart" state instead of pretending we have data.
  const cleanSymbol = String(symbol).trim().toUpperCase();

  // Cap to Alpaca's max-per-page so we don't accidentally page. The chart
  // panel asks for a tight window already (~600 bars max).
  const url = new URL(`https://data.alpaca.markets/v2/stocks/${encodeURIComponent(cleanSymbol)}/bars`);
  url.searchParams.set('timeframe', alpacaTf);
  url.searchParams.set('start', from);
  url.searchParams.set('end', to);
  url.searchParams.set('limit', '10000');
  url.searchParams.set('adjustment', 'split');
  url.searchParams.set('feed', 'iex');
  url.searchParams.set('sort', 'asc');

  try {
    const upstream = await fetch(url.toString(), {
      headers: {
        'APCA-API-KEY-ID': apiKey,
        'APCA-API-SECRET-KEY': apiSecret,
        'Accept': 'application/json',
      },
    });

    if (upstream.status === 404 || upstream.status === 422) {
      // Alpaca returns 422 for unknown symbols / non-equity instruments.
      return res.status(200).json({ source: 'none', bars: [], reason: 'Symbol not supported by Alpaca free tier' });
    }
    if (!upstream.ok) {
      const text = await upstream.text();
      console.error(`[ohlc] alpaca ${upstream.status}: ${text.slice(0, 300)}`);
      return res.status(502).json({ error: `Provider error (${upstream.status})` });
    }

    const json = await upstream.json();
    const rawBars = Array.isArray(json.bars) ? json.bars : [];
    const bars = rawBars.map(b => ({
      time: Math.floor(new Date(b.t).getTime() / 1000),
      open: b.o,
      high: b.h,
      low: b.l,
      close: b.c,
    }));

    return res.status(200).json({
      source: bars.length ? 'alpaca' : 'none',
      bars,
    });
  } catch (err) {
    console.error('[ohlc] fetch failed:', err?.message || err);
    await captureServerError(err, { userId, route: 'ohlc', step: 'alpaca-fetch', symbol: cleanSymbol });
    return res.status(502).json({ error: err?.message || 'OHLC fetch failed' });
  }
};
