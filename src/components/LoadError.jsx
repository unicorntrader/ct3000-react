import React from 'react';

// Standard error card for failed data loads across the app. Use inside every
// screen/component that fetches from Supabase when the load fails, so the
// user sees a clear message + a retry button instead of a hanging spinner
// or a silently-empty state.
//
// Pair with the standard load pattern:
//   const [loadError, setLoadError] = useState(null);
//   const [reloadKey, setReloadKey] = useState(0);
//   useEffect(() => {
//     setLoading(true);
//     setLoadError(null);
//     (async () => {
//       try {
//         const res = await supabase.from(...)...;
//         if (res.error) throw res.error;
//         setData(res.data);
//       } catch (err) {
//         console.error('[screen] load failed:', err?.message || err);
//         Sentry.captureException(err);
//         setLoadError(err?.message || 'Could not load.');
//       } finally {
//         setLoading(false);
//       }
//     })();
//   }, [..., reloadKey]);
//
// Render:
//   if (loadError) return <LoadError title="Could not load X" message={loadError} onRetry={() => setReloadKey(k => k + 1)} />;
//
// Props:
//   title    — short human-readable header, e.g. "Could not load trades"
//   message  — optional detail, usually the error message string
//   onRetry  — optional callback; omit to hide the retry button
//   compact  — render inline (for sub-sections) instead of full-width (default false)
export default function LoadError({ title = 'Could not load', message, onRetry, compact = false }) {
  return (
    <div className={`bg-red-50 border border-red-100 rounded-xl ${compact ? 'p-3' : 'p-5'}`}>
      <p className={`font-semibold text-red-800 mb-1 ${compact ? 'text-xs' : 'text-sm'}`}>{title}</p>
      {message && (
        <p className={`text-red-600 ${compact ? 'text-xs mb-2' : 'text-sm mb-4'}`}>{message}</p>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          className={`bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 ${
            compact ? 'text-xs px-3 py-1.5' : 'text-sm px-4 py-2'
          }`}
        >
          Try again
        </button>
      )}
    </div>
  );
}
