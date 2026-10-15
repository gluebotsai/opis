import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

type CoworkerContextValue = {
  open: boolean;
  setOpen: (next: boolean) => void;
  openChat: () => void;
  closeChat: () => void;
  toggleChat: () => void;
};

const CoworkerContext = createContext<CoworkerContextValue | null>(null);

export function CoworkerProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const openChat = useCallback(() => setOpen(true), []);
  const closeChat = useCallback(() => setOpen(false), []);
  const toggleChat = useCallback(() => setOpen((v) => !v), []);
  const value = useMemo(
    () => ({ open, setOpen, openChat, closeChat, toggleChat }),
    [open, openChat, closeChat, toggleChat]
  );
  return <CoworkerContext.Provider value={value}>{children}</CoworkerContext.Provider>;
}

export function useCoworker() {
  const ctx = useContext(CoworkerContext);
  if (!ctx) throw new Error('useCoworker must be used within CoworkerProvider');
  return ctx;
}
