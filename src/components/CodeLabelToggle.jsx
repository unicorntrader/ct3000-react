import React from 'react';
import { useCodeLabels } from '../lib/CodeLabelContext';

// Floating toggle pill. Shown at the bottom-right on every page so users
// in the learning branch can turn labels on/off without remembering the
// keyboard shortcut (Shift+L).
export default function CodeLabelToggle() {
  const { enabled, setEnabled } = useCodeLabels();
  return (
    <button
      type="button"
      onClick={() => setEnabled(x => !x)}
      className={`fixed bottom-20 md:bottom-6 right-6 z-50 px-3 py-2 rounded-full shadow-lg text-xs font-mono font-semibold transition-all ${
        enabled
          ? 'bg-emerald-600 text-white hover:bg-emerald-700'
          : 'bg-gray-900 text-gray-300 hover:bg-gray-800'
      }`}
      title="Toggle code labels — or press Shift+L"
    >
      {enabled ? 'Labels ON · Shift+L' : 'Labels OFF · Shift+L'}
    </button>
  );
}
