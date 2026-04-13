import React from 'react';
import { usePrivacy } from '../lib/PrivacyContext';

/**
 * Renders `••••` when privacy mode is on, otherwise renders the value as-is.
 * Usage: <PrivacyValue value={fmtPnl(row.pnl)} />
 */
export default function PrivacyValue({ value }) {
  const { isPrivate } = usePrivacy();
  if (!isPrivate) return <>{value}</>;
  return <span className="tracking-widest select-none text-gray-400">•••</span>;
}
