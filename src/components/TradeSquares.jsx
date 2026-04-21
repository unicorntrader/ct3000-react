import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Sentry from '@sentry/react';
import { supabase } from '../lib/supabaseClient';

// ─── TradeSquares ─────────────────────────────────────────────────────────────
// A GitHub-style contribution grid, but for trading discipline instead of
// activity. Each cell is a calendar day coloured by that day's average
// adherence across matched trades. Clicking a cell navigates to DailyViewScreen
// so the user can drill into the trades and notes behind the signal.
//
// Data source: `daily_adherence` table, populated server-side by api/rebuild.js
// after logical_trades are rebuilt. If the table is empty (user hasn't run
// rebuild yet since the migration), the grid renders all-gray with a prompt.
//
// Colour rules (see migration header for the "why" behind each):
//   gray   → adherence_score is null (no matched trades on that day)
//   green  → adherence ≥ 90
//   yellow → adherence 50–89
//   red    → adherence < 50
//
// Streak: consecutive days working backwards from today that are GREEN OR
// GRAY. Rationale (product decision): a no-trade day did not break any rule,
// so it preserves the streak. Only yellow/red days break it.

const PRESETS = [
  { key: 30, label: '30D' },
  { key: 90, label: '90D' },
];

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Generate an array of YYYY-MM-DD strings for the last N days, oldest first.
function daysBack(n) {
  const out = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// Map a day's row (or null) to a category + Tailwind colour class.
// Category drives the legend + insight text; colour class drives the cell.
function classifyDay(row) {
  if (!row || row.adherence_score == null) {
    return { cat: 'gray', cls: 'bg-gray-200 hover:bg-gray-300' };
  }
  const s = Number(row.adherence_score);
  if (s >= 90) return { cat: 'green',  cls: 'bg-green-500 hover:bg-green-600' };
  if (s >= 50) return { cat: 'yellow', cls: 'bg-yellow-400 hover:bg-yellow-500' };
  return           { cat: 'red',    cls: 'bg-red-500 hover:bg-red-600' };
}

export default function TradeSquares({ userId }) {
  const navigate = useNavigate();
  const [range, setRange] = useState(90);
  const [rows, setRows] = useState([]); // raw daily_adherence rows for the window
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const from = new Date();
        from.setDate(from.getDate() - (range - 1));
        const fromKey = from.toISOString().slice(0, 10);
        const res = await supabase
          .from('daily_adherence')
          .select('*')
          .eq('user_id', userId)
          .gte('date_key', fromKey);
        if (res.error) throw res.error;
        setRows(res.data || []);
      } catch (err) {
        console.error('[trade-squares] load failed:', err?.message || err);
        Sentry.withScope((scope) => {
          scope.setTag('component', 'TradeSquares');
          scope.setTag('step', 'load');
          Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
        });
        setLoadError(err?.message || 'Could not load discipline data.');
      } finally {
        setLoading(false);
      }
    })();
  }, [userId, range, reloadKey]);

  // Index rows by date_key so cell lookup is O(1) during render.
  const byDate = useMemo(() => {
    const m = new Map();
    for (const r of rows) m.set(r.date_key, r);
    return m;
  }, [rows]);

  // Ordered list of dates + classified cells for the window.
  const dates = useMemo(() => daysBack(range), [range]);
  const cells = useMemo(
    () => dates.map(d => ({ date: d, row: byDate.get(d) || null, ...classifyDay(byDate.get(d)) })),
    [dates, byDate],
  );

  // Discipline score: simple average of adherence_score across days that had
  // matched trades. Days without matched trades don't count (they have no
  // signal to average — same convention as the per-day colour).
  const disciplineScore = useMemo(() => {
    const scored = rows.filter(r => r.adherence_score != null);
    if (scored.length === 0) return null;
    const sum = scored.reduce((s, r) => s + Number(r.adherence_score), 0);
    return Math.round(sum / scored.length);
  }, [rows]);

  // Clean streak: walk backwards from today, counting consecutive non-broken
  // days. Green AND gray both preserve the streak (gray = no trade = no
  // violation). Yellow and red break it.
  const cleanStreak = useMemo(() => {
    let streak = 0;
    for (let i = cells.length - 1; i >= 0; i--) {
      const c = cells[i];
      if (c.cat === 'green' || c.cat === 'gray') streak += 1;
      else break;
    }
    return streak;
  }, [cells]);

  // Group cells into weekly columns for the 7×N grid. GitHub convention:
  // each column = one week, rows = day-of-week (Sun at top). To align the
  // first column's Sunday with the actual weekday of the earliest cell,
  // we pad the top of the first column with empty slots.
  const columns = useMemo(() => {
    if (cells.length === 0) return [];
    const cols = [];
    const first = cells[0];
    const firstDow = new Date(first.date + 'T00:00:00').getDay(); // 0=Sun
    // Build the first column with `firstDow` empty leading slots
    let cur = new Array(firstDow).fill(null);
    for (const cell of cells) {
      cur.push(cell);
      if (cur.length === 7) {
        cols.push(cur);
        cur = [];
      }
    }
    if (cur.length > 0) {
      while (cur.length < 7) cur.push(null); // pad trailing
      cols.push(cur);
    }
    return cols;
  }, [cells]);

  // Smart insight: pick the most telling 1-liner from a few deterministic
  // checks. Runs only when we have enough signal (≥5 days with data).
  const insight = useMemo(() => {
    const scored = rows.filter(r => r.adherence_score != null);
    if (scored.length < 5) return null;

    // Pattern 1: "You break rules on Fridays" — worst day-of-week by avg score
    const byDow = Array.from({ length: 7 }, () => ({ sum: 0, n: 0 }));
    for (const r of scored) {
      const dow = new Date(r.date_key + 'T00:00:00').getDay();
      byDow[dow].sum += Number(r.adherence_score);
      byDow[dow].n += 1;
    }
    const dowScores = byDow.map((b, i) => ({ i, avg: b.n > 0 ? b.sum / b.n : null, n: b.n }));
    const eligible = dowScores.filter(d => d.n >= 2);
    if (eligible.length >= 2) {
      const worstDow = [...eligible].sort((a, b) => a.avg - b.avg)[0];
      const bestDow  = [...eligible].sort((a, b) => b.avg - a.avg)[0];
      if (bestDow.avg - worstDow.avg >= 20) {
        return `Discipline is strongest on ${DOW_LABELS[bestDow.i]}s and weakest on ${DOW_LABELS[worstDow.i]}s.`;
      }
    }

    // Pattern 2: "Best adherence on days with ≤N trades" — compare low-volume
    // days against high-volume days. Uses trade_count to avoid recomputing.
    const withCount = rows.filter(r => r.adherence_score != null && r.trade_count > 0);
    if (withCount.length >= 6) {
      const counts = withCount.map(r => r.trade_count).sort((a, b) => a - b);
      const median = counts[Math.floor(counts.length / 2)];
      const low  = withCount.filter(r => r.trade_count <= median);
      const high = withCount.filter(r => r.trade_count > median);
      if (low.length >= 3 && high.length >= 3) {
        const avg = arr => arr.reduce((s, r) => s + Number(r.adherence_score), 0) / arr.length;
        const lowAvg = avg(low);
        const highAvg = avg(high);
        if (lowAvg - highAvg >= 15) {
          return `Adherence is notably higher on days with ≤${median} trades — a case for fewer, higher-quality setups.`;
        }
      }
    }

    return null;
  }, [rows]);

  // Empty-state: migration ran but no rows yet (rebuild hasn't populated).
  const isEmpty = !loading && rows.length === 0;

  const legendDot = (cls, label) => (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-500">
      <span className={`inline-block w-2.5 h-2.5 rounded-sm ${cls}`} />
      {label}
    </span>
  );

  if (loadError) {
    return (
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5 mb-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">TradeSquares</h3>
        </div>
        <p className="text-sm text-red-500 mt-2">{loadError}</p>
        <button
          onClick={() => setReloadKey(k => k + 1)}
          className="mt-2 text-xs font-semibold text-blue-600 hover:text-blue-700"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5 mb-6">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-700">TradeSquares</h3>
            <p className="text-[11px] text-gray-400 mt-0.5">Discipline, not activity</p>
          </div>
          <div className="hidden sm:flex items-center gap-5 pl-5 border-l border-gray-100">
            <div>
              <p className="text-[11px] font-medium text-gray-400">Discipline</p>
              <p className={`text-lg font-semibold leading-none ${
                disciplineScore == null ? 'text-gray-400'
                  : disciplineScore >= 75 ? 'text-green-600'
                  : disciplineScore >= 50 ? 'text-amber-600'
                  : 'text-red-500'
              }`}>
                {disciplineScore == null ? '—' : `${disciplineScore}%`}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-medium text-gray-400">Clean streak</p>
              <p className="text-lg font-semibold leading-none text-gray-900">
                {cleanStreak === 0 ? '—' : `${cleanStreak}d`}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {PRESETS.map(p => (
            <button
              key={p.key}
              onClick={() => setRange(p.key)}
              className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors ${
                range === p.key
                  ? 'bg-blue-600 text-white border-transparent'
                  : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Mobile stats row (shown below title on small screens) */}
      <div className="flex items-center gap-5 mb-4 sm:hidden">
        <div>
          <p className="text-[11px] font-medium text-gray-400">Discipline</p>
          <p className={`text-base font-semibold leading-none ${
            disciplineScore == null ? 'text-gray-400'
              : disciplineScore >= 75 ? 'text-green-600'
              : disciplineScore >= 50 ? 'text-amber-600'
              : 'text-red-500'
          }`}>
            {disciplineScore == null ? '—' : `${disciplineScore}%`}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-medium text-gray-400">Clean streak</p>
          <p className="text-base font-semibold leading-none text-gray-900">
            {cleanStreak === 0 ? '—' : `${cleanStreak}d`}
          </p>
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="h-24 bg-gray-50 rounded-lg animate-pulse" />
      ) : (
        <div className="overflow-x-auto">
          <div className="flex gap-[3px] min-w-max">
            {columns.map((col, ci) => (
              <div key={ci} className="flex flex-col gap-[3px]">
                {col.map((cell, ri) => {
                  if (!cell) return <div key={ri} className="w-[14px] h-[14px]" />;
                  const title = cell.row
                    ? `${cell.date} · ${
                        cell.row.adherence_score != null
                          ? `${Math.round(cell.row.adherence_score)}% adherence`
                          : 'No matched trades'
                      } · ${cell.row.trade_count} trade${cell.row.trade_count !== 1 ? 's' : ''}`
                    : `${cell.date} · No data`;
                  return (
                    <button
                      key={ri}
                      title={title}
                      onClick={() => navigate('/daily')}
                      className={`w-[14px] h-[14px] rounded-sm transition-colors ${cell.cls}`}
                      aria-label={title}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 mt-3">
        {legendDot('bg-green-500', 'Followed')}
        {legendDot('bg-yellow-400', 'Partial')}
        {legendDot('bg-red-500', 'Broke rules')}
        {legendDot('bg-gray-200', 'No trade')}
      </div>

      {/* Smart insight line */}
      {insight && (
        <p className="text-[12px] text-gray-500 mt-3 italic">{insight}</p>
      )}

      {/* Empty-state prompt — migration ran but rebuild hasn't populated yet */}
      {isEmpty && (
        <p className="text-[12px] text-gray-400 mt-3">
          No discipline data yet. Run Sync or Rebuild to populate TradeSquares from your existing trades.
        </p>
      )}
    </div>
  );
}
