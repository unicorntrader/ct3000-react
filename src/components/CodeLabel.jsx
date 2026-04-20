import React from 'react';
import { useCodeLabels } from '../lib/CodeLabelContext';

// CodeLabel
// ---------
// A tiny colored pill that labels the UI box it wraps with the code name
// (component function name, sub-component, or just a human-meaningful label
// pointing at where the behavior lives in the source).
//
// Two usage shapes:
//
//   1. As a wrapper that outlines the box:
//        <CodeLabel name="StatCard" file="TradeInlineDetail.jsx">
//          <div>...ui...</div>
//        </CodeLabel>
//
//   2. As an inline tag placed in flow (no outlining):
//        <CodeLabel inline name="fmtSymbol()" />
//
// Colors map to type so the eye can skim:
//   - screen   (blue)    — top-level route components
//   - component (purple) — reusable UI components
//   - fn       (green)   — named functions / helpers
//   - hook     (amber)   — useEffect / useMemo blocks
//   - db       (rose)    — supabase queries / tables
//
// All labels are hidden unless learning mode is on (Shift+L toggles).

const TYPE_STYLES = {
  screen:    'bg-blue-600 text-white',
  component: 'bg-purple-600 text-white',
  fn:        'bg-emerald-600 text-white',
  hook:      'bg-amber-500 text-white',
  db:        'bg-rose-600 text-white',
};

const OUTLINE_COLOR = {
  screen:    'ring-2 ring-blue-300',
  component: 'ring-2 ring-purple-300',
  fn:        'ring-2 ring-emerald-300',
  hook:      'ring-2 ring-amber-300',
  db:        'ring-2 ring-rose-300',
};

export default function CodeLabel({
  name,
  file,
  type = 'component',
  inline = false,
  children,
  className = '',
}) {
  const { enabled } = useCodeLabels();

  // When labels are off, pass through as if the wrapper weren't there.
  if (!enabled) {
    if (inline) return null;
    return <>{children}</>;
  }

  const pillStyle = TYPE_STYLES[type] || TYPE_STYLES.component;
  const pillClass = `inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-mono font-semibold leading-none ${pillStyle}`;
  const tooltip = file ? `${name} — ${file}` : name;

  if (inline) {
    return (
      <span className={pillClass} title={tooltip}>
        {name}
      </span>
    );
  }

  const outline = OUTLINE_COLOR[type] || OUTLINE_COLOR.component;
  return (
    <div className={`relative ${outline} rounded-md ${className}`}>
      <div className="absolute -top-2 left-2 z-10 pointer-events-none">
        <span className={pillClass} title={tooltip}>
          {name}
        </span>
      </div>
      {children}
    </div>
  );
}
