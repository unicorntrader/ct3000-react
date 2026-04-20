import React from 'react';
import ScreenBanner from './ScreenBanner';

// ScreenFrame
// -----------
// Thin wrapper placed around each <Route element={...}> in App.jsx. Renders
// a ScreenBanner above the screen (when learning mode is on) then the screen
// itself. Keeps App.jsx as the single place where screens are annotated,
// so we don't have to touch every screen file.
export default function ScreenFrame({ name, file, db, notes, children }) {
  return (
    <>
      <ScreenBanner name={name} file={file} db={db} notes={notes} />
      {children}
    </>
  );
}
