import React, { createContext, useContext, useState } from 'react';

const PrivacyContext = createContext({ isPrivate: false, togglePrivacy: () => {} });

export function PrivacyProvider({ children }) {
  const [isPrivate, setIsPrivate] = useState(false);
  const togglePrivacy = () => setIsPrivate(v => !v);
  return (
    <PrivacyContext.Provider value={{ isPrivate, togglePrivacy }}>
      {children}
    </PrivacyContext.Provider>
  );
}

export function usePrivacy() {
  return useContext(PrivacyContext);
}
