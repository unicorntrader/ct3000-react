import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';

// CodeLabelContext
// ----------------
// Learning-mode only. Controls whether the CodeLabel overlays are visible.
// Toggled by:
//   - keyboard: Shift+L anywhere on the page
//   - a floating pill in the bottom-right (CodeLabelToggle)
// Persisted to localStorage so reloads don't lose your preference.

const LS_KEY = 'ct3000-code-labels-on';

const CodeLabelContext = createContext({ enabled: true, setEnabled: () => {} });

export function CodeLabelProvider({ children }) {
  const [enabled, setEnabled] = useState(() => {
    try {
      const v = localStorage.getItem(LS_KEY);
      return v === null ? true : v === '1';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, enabled ? '1' : '0'); } catch {}
  }, [enabled]);

  useEffect(() => {
    const onKey = (e) => {
      // Shift+L toggles. Ignore when typing in inputs.
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      if (e.shiftKey && (e.key === 'L' || e.key === 'l')) {
        e.preventDefault();
        setEnabled(x => !x);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const value = useMemo(() => ({ enabled, setEnabled }), [enabled]);
  return <CodeLabelContext.Provider value={value}>{children}</CodeLabelContext.Provider>;
}

export function useCodeLabels() {
  return useContext(CodeLabelContext);
}
