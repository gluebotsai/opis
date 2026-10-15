import { createContext, useContext, useMemo, type ReactNode } from "react";

type MainFlushContextValue = {
  flush: boolean;
  setFlush: (flush: boolean) => void;
  copilotMinimized: boolean;
  setCopilotMinimized: (minimized: boolean) => void;
  copilotAvailable: boolean;
  setCopilotAvailable: (available: boolean) => void;
};

const MainFlushContext = createContext<MainFlushContextValue>({
  flush: false,
  setFlush: () => {},
  copilotMinimized: false,
  setCopilotMinimized: () => {},
  copilotAvailable: false,
  setCopilotAvailable: () => {},
});

export function MainFlushProvider({
  flush,
  setFlush,
  copilotMinimized,
  setCopilotMinimized,
  copilotAvailable,
  setCopilotAvailable,
  children,
}: {
  flush: boolean;
  setFlush: (flush: boolean) => void;
  copilotMinimized: boolean;
  setCopilotMinimized: (minimized: boolean) => void;
  copilotAvailable: boolean;
  setCopilotAvailable: (available: boolean) => void;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({
      flush,
      setFlush,
      copilotMinimized,
      setCopilotMinimized,
      copilotAvailable,
      setCopilotAvailable,
    }),
    [flush, setFlush, copilotMinimized, setCopilotMinimized, copilotAvailable, setCopilotAvailable],
  );
  return <MainFlushContext.Provider value={value}>{children}</MainFlushContext.Provider>;
}

export function useMainFlush() {
  return useContext(MainFlushContext);
}
