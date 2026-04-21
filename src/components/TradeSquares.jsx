import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
// Streak: consecutive days walking backwards from today that are NOT red.
// Only red (< 50% adherence) breaks the streak. Green, yellow, and gray all
// preserve. Rationale: yellow is partial execution of a real plan — "still
// disciplined, just imperfect" — which shouldn't reset a streak. Red is
// abandonment of the plan, which should. No-trade days (gray) also
// preserve, since no trade means no rule to break.

const PRESETS = [
  { key: 30, label: '30D' },
  { key: 90, label: '90D' },
  { key: 365, label: '365D' },
];

// The grid itself is always this many days wide, regardless of preset.
// 364 = 52 weeks × 7 days. The range preset only controls which squares
// get coloured + which days feed the stats; the grid never resizes.
// Rationale: a fixed-width grid keeps the layout stable when toggling
// ranges and lets the coloured cluster on the right visually demonstrate
// how much history the current stats cover.
const GRID_DAYS = 364;

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Short DOW labels shown on every row of the y-axis. Sun starts the week to
// match JS's Date.getDay() convention (0=Sun); that ordering also puts the
// weekend pair (Sun at top, Sat at bottom) symmetrically on the grid.
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

// Deterministic pseudo-random so the demo grid is stable across renders and
// the preview URL shows the same pattern each visit. Seed from the date
// string so each day has a consistent category.
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

// Synthetic daily_adherence rows with a realistic distribution:
//   ~55% green (disciplined days)
//   ~20% yellow (partial adherence)
//   ~10% red  (rule breaks)
//   ~15% gray (no trade / weekend bias)
// Weekends skew toward gray (no matched trades) to feel like real trading.
// Used when the component is mounted with ?demo=1 so we can preview the UI
// without touching real data or the DB. Always generates a full year so
// the grid stays populated regardless of which preset is selected.
function generateDemoRows() {
  const dates = daysBack(GRID_DAYS);
  const rows = [];
  for (const d of dates) {
    const dow = new Date(d + 'T00:00:00').getDay();
    const r = hashStr(d);

    // Weekends mostly gray, occasionally a late close
    if ((dow === 0 || dow === 6) && r > 0.15) continue;

    // Bucket by uniform roll
    let bucket;
    if (r < 0.55) bucket = 'green';
    else if (r < 0.75) bucket = 'yellow';
    else if (r < 0.85) bucket = 'red';
    else bucket = 'gray';

    if (bucket === 'gray') continue; // no row = gray cell

    // Realistic adherence inside the bucket
    const innerRoll = hashStr(d + ':a');
    let adh;
    if (bucket === 'green')  adh = 90 + Math.round(innerRoll * 10);      // 90–100
    else if (bucket === 'yellow') adh = 50 + Math.round(innerRoll * 39); // 50–89
    else adh = Math.round(innerRoll * 49);                               // 0–49

    // Trade counts — mostly 1–3, occasional busier day
    const countRoll = hashStr(d + ':c');
    const matched = 1 + Math.floor(countRoll * 3); // 1–3
    const offPlan = countRoll > 0.75 ? 1 : 0;
    const needsReview = countRoll > 0.92 ? 1 : 0;

    rows.push({
      date_key: d,
      adherence_score: adh,
      matched_count: matched,
      off_plan_count: offPlan,
      needs_review_count: needsReview,
      trade_count: matched + offPlan + needsReview,
    });
  }
  return rows;
}

// Map a day's row (or null) to a category + Tailwind colour class.
// Category drives the legend + insight text; colour class drives the cell.
// When `inRange` is false (the cell exists on the grid but falls outside
// the user's selected preset), we render a dimmer gray regardless of the
// underlying data — it's visibly "not counted" without hiding the square.
function classifyDay(row, inRange = true) {
  if (!inRange) {
    return { cat: 'outOfRange', cls: 'bg-gray-100 hover:bg-gray-200' };
  }
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
  const [searchParams] = useSearchParams();
  // `?demo=1` — preview mode with deterministic synthetic data. Lets us
  // review the UI on a Vercel preview URL before any user has enough real
  // matched-trade history to populate the grid organically. Real data path
  // is untouched when the flag is absent; nothing is written to the DB.
  const isDemo = searchParams.get('demo') === '1';
  const [range, setRange] = useState(90);
  const [rows, setRows] = useState([]); // raw daily_adherence rows for the window
  const [noteDates, setNoteDates] = useState(() => new Set()); // dates with daily_notes
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (isDemo) {
      // Short-circuit — synthetic rows + synthetic journal markers. Uses the
      // same stable hash so the same days have notes on every render.
      const demoRows = generateDemoRows();
      setRows(demoRows);
      const demoNotes = new Set();
      for (const r of demoRows) {
        // ~55% of active days have a note — feels realistic for a user who
        // journals most of the time but skips occasionally.
        if (hashStr(r.date_key + ':note') > 0.45) demoNotes.add(r.date_key);
      }
      setNoteDates(demoNotes);
      setLoading(false);
      setLoadError(null);
      return;
    }
    if (!userId) return;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        // Always fetch the full grid window — the range preset only scopes
        // colouring + stats, not data retrieval. Fetching a year's worth of
        // per-day rows is cheap (≤ 364 rows per user).
        const from = new Date();
        from.setDate(from.getDate() - (GRID_DAYS - 1));
        const fromKey = from.toISOString().slice(0, 10);
        // Parallel fetch — adherence rows + journal note date_keys. The
        // journal dot indicator overlays the square when the user wrote
        // notes that day, reinforcing the "reflect on the day" habit.
        const [adhRes, notesRes] = await Promise.all([
          supabase
            .from('daily_adherence')
            .select('*')
            .eq('user_id', userId)
            .gte('date_key', fromKey),
          supabase
            .from('daily_notes')
            .select('date_key')
            .eq('user_id', userId)
            .gte('date_key', fromKey),
        ]);
        if (adhRes.error) throw adhRes.error;
        if (notesRes.error) throw notesRes.error;
        setRows(adhRes.data || []);
        setNoteDates(new Set((notesRes.data || []).map(n => n.date_key)));
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
  }, [userId, reloadKey, isDemo]);

  // Index rows by date_key so cell lookup is O(1) during render.
  const byDate = useMemo(() => {
    const m = new Map();
    for (const r of rows) m.set(r.date_key, r);
    return m;
  }, [rows]);

  // Ordered list of dates — always the full grid window (364 days).
  // Range preset no longer slices this; it only controls which cells are
  // "in range" for colouring + stats.
  const dates = useMemo(() => daysBack(GRID_DAYS), []);

  // Classified cells for the grid. `inRange` flags whether the day falls
  // inside the active preset (last `range` days). Out-of-range cells render
  // as dimmed gray regardless of their underlying data.
  const cells = useMemo(
    () => dates.map((d, i) => {
      const daysAgo = GRID_DAYS - 1 - i; // 0 = today, GRID_DAYS-1 = oldest
      const inRange = daysAgo < range;
      const row = byDate.get(d) || null;
      return {
        date: d,
        row,
        hasNote: noteDates.has(d),
        inRange,
        ...classifyDay(row, inRange),
      };
    }),
    [dates, byDate, noteDates, range],
  );

  // In-range cells — the scope for every stat tile and the smart-insight
  // line. Picking a smaller preset shrinks this subset; picking 365D = all.
  const inRangeCells = useMemo(() => cells.filter(c => c.inRange), [cells]);

  // Discipline score: simple average of adherence_score across days that had
  // matched trades, within the selected range only.
  const disciplineScore = useMemo(() => {
    const scored = inRangeCells
      .map(c => c.row)
      .filter(r => r && r.adherence_score != null);
    if (scored.length === 0) return null;
    const sum = scored.reduce((s, r) => s + Number(r.adherence_score), 0);
    return Math.round(sum / scored.length);
  }, [inRangeCells]);

  // Streaks intentionally ignore the range preset — they're lifetime-ish
  // metrics, not scoped stats. Capping "Current streak" at the selected
  // window would under-report real progress (a 90-day streak showing as
  // "30d" when the user picked 30D) and demotivate toggling. Walks the
  // full cells array (which is the fetched year, the practical horizon).
  //
  // STREAK-BREAK RULE: only RED days (<50% adherence) break the streak.
  // Green and gray preserve the streak, and YELLOW (50–89%, partial
  // adherence) also preserves. Rationale: yellow is execution slippage on
  // a plan the trader was still following — a 78% day isn't a rule break,
  // it's imperfect-but-disciplined. Only actual abandonment of the plan
  // (red) should reset the counter. This keeps streaks achievable and
  // makes the metric reward sustained discipline, not perfection.
  //
  // For streak classification we need the raw category regardless of the
  // out-of-range dim flag (otherwise every out-of-range cell would read as
  // "outOfRange" and the walker couldn't tell green from red beyond the
  // preset boundary). Re-classify from the underlying row data.
  const rawClassify = (row) => classifyDay(row, true).cat;
  const isStreakPreserving = (cat) => cat !== 'red';

  // Current streak: walk backwards from today. Stops only on a red day.
  const cleanStreak = useMemo(() => {
    let streak = 0;
    for (let i = cells.length - 1; i >= 0; i--) {
      const cat = rawClassify(cells[i].row);
      if (isStreakPreserving(cat)) streak += 1;
      else break;
    }
    return streak;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells]);

  // Longest streak across the full fetched window — the "beat your PR"
  // number. Same preservation rules as cleanStreak.
  const longestStreak = useMemo(() => {
    let max = 0;
    let cur = 0;
    for (const c of cells) {
      const cat = rawClassify(c.row);
      if (isStreakPreserving(cat)) {
        cur += 1;
        if (cur > max) max = cur;
      } else {
        cur = 0;
      }
    }
    return max;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells]);

  // Per-category counts + trading-day aggregates, scoped to in-range only.
  // One pass, used across the stats grid tiles below.
  const stats = useMemo(() => {
    let green = 0, yellow = 0, red = 0;
    let tradingDays = 0, totalTrades = 0;
    for (const c of inRangeCells) {
      if (c.cat === 'green') green += 1;
      else if (c.cat === 'yellow') yellow += 1;
      else if (c.cat === 'red') red += 1;
      if (c.row && c.row.trade_count > 0) {
        tradingDays += 1;
        totalTrades += Number(c.row.trade_count) || 0;
      }
    }
    return { green, yellow, red, tradingDays, totalTrades };
  }, [inRangeCells]);

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

  // Month-label positions — label the first column of each month. Matches
  // GitHub's contribution graph convention. Uses the earliest real cell in
  // each column to determine which month that column belongs to.
  const monthHeaders = useMemo(() => {
    const headers = new Array(columns.length).fill('');
    let lastMonth = -1;
    for (let ci = 0; ci < columns.length; ci++) {
      const firstCell = columns[ci].find(c => c !== null);
      if (!firstCell) continue;
      const m = new Date(firstCell.date + 'T00:00:00').getMonth();
      if (m !== lastMonth) {
        headers[ci] = MONTH_LABELS[m];
        lastMonth = m;
      }
    }
    return headers;
  }, [columns]);

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

  // Helper for the stats grid — each tile is a small bordered box with a
  // grey label and a bold value. Nullable values render as '—'. Colour only
  // applied when the value carries meaning (discipline %, red/green counts).
  const statTile = (label, value, valueClass = 'text-gray-900') => (
    <div className="rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-2.5">
      <p className="text-[11px] font-medium text-gray-500">{label}</p>
      <p className={`text-lg font-semibold leading-none mt-1 ${valueClass}`}>{value}</p>
    </div>
  );

  const disciplineColor =
    disciplineScore == null ? 'text-gray-400'
    : disciplineScore >= 75 ? 'text-green-600'
    : disciplineScore >= 50 ? 'text-amber-600'
    : 'text-red-500';

  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5 mb-6">
      {/* Title row — title on the left, period selector on the right. */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-700">TradeSquares</h3>
          <span className="text-[11px] text-gray-400">· Discipline, not activity</span>
          {isDemo && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-purple-700 bg-purple-100 px-1.5 py-0.5 rounded ml-1">
              Demo
            </span>
          )}
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

      {/* Stats grid — 2 cols on mobile, 4 on sm+. Two rows of four tiles:
          row 1 focuses on discipline + streaks (the "how am I doing?" view),
          row 2 on activity counts (the "what did I do?" view). */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        {statTile('Discipline', disciplineScore == null ? '—' : `${disciplineScore}%`, disciplineColor)}
        {statTile('Current streak', cleanStreak === 0 ? '—' : `${cleanStreak}d`)}
        {statTile('Longest streak', longestStreak === 0 ? '—' : `${longestStreak}d`)}
        {statTile('Trading days', stats.tradingDays === 0 ? '—' : stats.tradingDays)}
        {statTile('Total trades', stats.totalTrades === 0 ? '—' : stats.totalTrades.toLocaleString())}
        {statTile('Green days', stats.green, stats.green > 0 ? 'text-green-600' : 'text-gray-400')}
        {statTile('Yellow days', stats.yellow, stats.yellow > 0 ? 'text-amber-600' : 'text-gray-400')}
        {statTile('Red days', stats.red, stats.red > 0 ? 'text-red-500' : 'text-gray-400')}
      </div>

      {/* Grid — GitHub-style with month header + DOW labels on the side.
          Cell size 16px with 4px gaps for better mobile/desktop legibility.
          Month labels sit in a thin row above the grid and are placed at the
          first column of each month. DOW labels show Mon/Wed/Fri only to
          keep the left gutter light. */}
      {loading ? (
        <div className="h-28 bg-gray-50 rounded-lg animate-pulse" />
      ) : (
        <div className="overflow-x-auto">
          <div className="flex gap-2 min-w-max">
            {/* DOW labels column — every day labelled (not just Mon/Wed/Fri
                like GitHub). This is a discipline tool, so DOW patterns
                matter; every row deserves a clear anchor. */}
            <div className="flex flex-col gap-1 pt-[18px]">
              {DOW_LABELS.map((label, i) => (
                <div
                  key={i}
                  className="h-4 text-[10px] text-gray-400 leading-4 text-right w-7 pr-1"
                >
                  {label}
                </div>
              ))}
            </div>

            {/* Grid area: month row above, 7xN cells below */}
            <div className="flex flex-col gap-1">
              {/* Month labels — one slot per column; non-empty only on the
                  first column of each month. Width matches cell width so the
                  label sits above the column it belongs to. */}
              <div className="flex gap-1 h-[14px]">
                {monthHeaders.map((m, ci) => (
                  <div
                    key={ci}
                    className="w-4 text-[10px] text-gray-400 leading-[14px] whitespace-nowrap"
                  >
                    {m}
                  </div>
                ))}
              </div>

              {/* Cell grid */}
              <div className="flex gap-1">
                {columns.map((col, ci) => (
                  <div key={ci} className="flex flex-col gap-1">
                    {col.map((cell, ri) => {
                      if (!cell) return <div key={ri} className="w-4 h-4" />;
                      // Tooltip composes the square's full context: date, the
                      // day's adherence (or "no matched trades"), total trade
                      // count, and whether notes were written. The journal
                      // suffix makes the dot's meaning obvious on hover.
                      const basePart = cell.row
                        ? `${cell.date} · ${
                            cell.row.adherence_score != null
                              ? `${Math.round(cell.row.adherence_score)}% adherence`
                              : 'No matched trades'
                          } · ${cell.row.trade_count} trade${cell.row.trade_count !== 1 ? 's' : ''}`
                        : `${cell.date} · No data`;
                      const rangeSuffix = cell.inRange ? '' : ' · Outside selected range';
                      const title = cell.hasNote && cell.inRange
                        ? `${basePart} · ✎ Journalled${rangeSuffix}`
                        : `${basePart}${rangeSuffix}`;
                      return (
                        <button
                          key={ri}
                          title={title}
                          onClick={() => navigate('/daily')}
                          className={`relative w-4 h-4 rounded-[3px] transition-colors ${cell.cls}`}
                          aria-label={title}
                        >
                          {cell.hasNote && cell.inRange && (
                            // Journal-dot indicator — small white dot in the
                            // bottom-right corner. White-on-any-colour with a
                            // faint shadow so it's legible on green / yellow /
                            // red / gray alike. Reinforces the reflection
                            // habit: colour = followed the plan, dot = then
                            // wrote about it. Hidden on out-of-range cells so
                            // the signal is always "in scope".
                            <span
                              className="absolute bottom-[2px] right-[2px] w-[3px] h-[3px] rounded-full bg-white shadow-[0_0_2px_rgba(0,0,0,0.35)] pointer-events-none"
                              aria-hidden
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 mt-3">
        {legendDot('bg-green-500', 'Followed')}
        {legendDot('bg-yellow-400', 'Partial')}
        {legendDot('bg-red-500', 'Broke rules')}
        {legendDot('bg-gray-200', 'No trade')}
        {/* Journal-dot legend — mirrors the overlay on each square. Visual
            shorthand: "this coloured block had a journal note attached". */}
        <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-500">
          <span className="relative inline-block w-2.5 h-2.5 rounded-sm bg-gray-300">
            <span
              className="absolute bottom-[1px] right-[1px] w-[3px] h-[3px] rounded-full bg-white shadow-[0_0_1.5px_rgba(0,0,0,0.35)]"
              aria-hidden
            />
          </span>
          Journalled
        </span>
      </div>

      {/* Empty-state prompt — migration ran but rebuild hasn't populated yet */}
      {isEmpty && (
        <p className="text-[12px] text-gray-400 mt-3">
          No discipline data yet. Run Sync or Rebuild to populate TradeSquares from your existing trades.
        </p>
      )}
    </div>
  );
}
