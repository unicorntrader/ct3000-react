import React from 'react';
import { useCodeLabels } from '../lib/CodeLabelContext';

// ScreenBanner
// ------------
// Drop one at the very top of a screen component's return JSX:
//   <ScreenBanner name="HomeScreen" file="src/screens/HomeScreen.jsx"
//                 db={['open_positions', 'planned_trades', 'logical_trades']}
//                 notes="Landing page. 30-day KPI + today's list." />
//
// Shows a soft banner naming the screen file and the DB tables it reads.
// Hidden when learning mode is off.
export default function ScreenBanner({ name, file, db = [], notes }) {
  const { enabled } = useCodeLabels();
  if (!enabled) return null;

  return (
    <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50/70 px-3 py-2 text-xs font-mono text-blue-900">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-600 text-white text-[10px] font-semibold">
          SCREEN
        </span>
        <span className="font-semibold">{name}</span>
        <span className="text-blue-700/80">·</span>
        <span className="text-blue-800">{file}</span>
        {db.length > 0 && (
          <>
            <span className="text-blue-700/80">·</span>
            <span className="text-blue-700/80">reads:</span>
            {db.map(t => (
              <span
                key={t}
                className="inline-flex items-center px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 text-[10px] font-semibold"
                title={`Supabase table: ${t}`}
              >
                {t}
              </span>
            ))}
          </>
        )}
      </div>
      {notes && <div className="mt-1 text-[11px] text-blue-800/80">{notes}</div>}
    </div>
  );
}
