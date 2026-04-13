import React from 'react';
import { usePrivacy } from '../lib/PrivacyContext';

/**
 * Renders `••••` when privacy mode is on, otherwise renders the value as-is.
 * Usage: <PrivacyValue value={fmtPnl(row.pnl)} />
 */
export default function PrivacyValue({ value }) {
  const { isPrivate } = usePrivacy();
  if (!isPrivate) return <>{value}</>;
  // Vary dot count by content length so values don't all look identical
  const contentLen = String(value).replace(/[^a-zA-Z0-9]/g, '').length;
  const dots = contentLen <= 2 ? '••' : contentLen <= 6 ? '••••' : '••••••';
  return <span className="tracking-widest select-none text-gray-400">{dots}</span>;
}
