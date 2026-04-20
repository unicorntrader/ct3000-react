import React, { useState } from 'react';
import { useCodeLabels } from '../lib/CodeLabelContext';

// A small collapsible legend pinned to the top-left that explains what the
// colored labels mean. Only shown in learning mode.
export default function CodeLabelLegend() {
  const { enabled } = useCodeLabels();
  const [open, setOpen] = useState(false);
  if (!enabled) return null;

  return (
    <div className="fixed top-20 md:top-24 left-4 z-40">
      <button
        type="button"
        onClick={() => setOpen(x => !x)}
        className="px-2 py-1 rounded-md bg-gray-900 text-white text-[10px] font-mono font-semibold shadow-lg hover:bg-gray-800"
        title="Show legend"
      >
        {open ? '× Close legend' : '?  Legend'}
      </button>
      {open && (
        <div className="mt-2 bg-white border border-gray-200 rounded-lg shadow-xl p-3 w-64 text-xs space-y-2">
          <p className="font-semibold text-gray-900 text-sm mb-1">Code labels</p>
          <p className="text-gray-600 leading-snug">
            Every colored pill names a real thing in the source tree. Hover a pill
            to see the file. Press <span className="font-mono bg-gray-100 px-1 rounded">Shift+L</span> to hide all labels.
          </p>
          <div className="space-y-1 pt-1">
            <Row color="bg-blue-600"    label="SCREEN"    desc="Top-level route (files in src/screens/)" />
            <Row color="bg-purple-600"  label="component" desc="Reusable UI (files in src/components/)" />
            <Row color="bg-emerald-600" label="fn()"      desc="Named function or helper" />
            <Row color="bg-amber-500"   label="hook"      desc="useEffect / useMemo block" />
            <Row color="bg-rose-600"    label="db"        desc="Supabase table read/write" />
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ color, label, desc }) {
  return (
    <div className="flex items-start gap-2">
      <span className={`inline-flex shrink-0 items-center px-1.5 py-0.5 rounded ${color} text-white text-[10px] font-mono font-semibold leading-none mt-0.5`}>
        {label}
      </span>
      <span className="text-gray-700 text-[11px] leading-snug">{desc}</span>
    </div>
  );
}
