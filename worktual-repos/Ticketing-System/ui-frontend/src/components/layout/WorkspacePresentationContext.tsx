import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export type WorkspacePresentation = 'split' | 'full';

type WorkspacePresentationContextValue = {
  presentation: WorkspacePresentation;
  setPresentation: (next: WorkspacePresentation) => void;
  openFullPage: () => void;
  openSplit: () => void;
};

const WorkspacePresentationContext = createContext<WorkspacePresentationContextValue | null>(null);

export function WorkspacePresentationProvider({ children }: { children: React.ReactNode }) {
  const [presentation, setPresentation] = useState<WorkspacePresentation>('split');
  const openFullPage = useCallback(() => setPresentation('full'), []);
  const openSplit = useCallback(() => setPresentation('split'), []);
  const value = useMemo(
    () => ({ presentation, setPresentation, openFullPage, openSplit }),
    [presentation, openFullPage, openSplit]
  );
  return (
    <WorkspacePresentationContext.Provider value={value}>
      {children}
    </WorkspacePresentationContext.Provider>
  );
}

export function useWorkspacePresentation() {
  const ctx = useContext(WorkspacePresentationContext);
  if (!ctx) {
    throw new Error('useWorkspacePresentation must be used within WorkspacePresentationProvider');
  }
  return ctx;
}
