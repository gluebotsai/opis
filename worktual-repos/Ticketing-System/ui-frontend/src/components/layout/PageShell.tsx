import React from 'react';

type PageShellProps = {
  children: React.ReactNode;
  className?: string;
  id?: string;
  /** Extra eyebrow / actions row under global header title */
  actions?: React.ReactNode;
  /**
   * When true, omit outer canvas padding — content lives inside a
   * CoworkerSplitWorkspace / WorkspacePanel card (Contact Center pattern).
   */
  embedded?: boolean;
  /**
   * Child fills remaining height and manages its own scroll
   * (e.g. tickets table). Default scrolls the whole page content.
   */
  fillHeight?: boolean;
};

export default function PageShell({
  children,
  className = '',
  id,
  actions,
  embedded = false,
  fillHeight = false,
}: PageShellProps) {
  const pad = embedded
    ? 'p-3 sm:p-4 h-full min-h-0 min-w-0 flex flex-col overflow-hidden'
    : 'px-4 py-4 sm:px-6 sm:py-5 h-full min-h-0 min-w-0 flex flex-col overflow-hidden';

  return (
    <div id={id} className={`${pad} ${className}`}>
      {actions && (
        <div className="mb-3 sm:mb-4 flex flex-col gap-2 shrink-0 min-w-0 w-full">
          {actions}
        </div>
      )}
      <div
        className={`flex flex-1 min-h-0 min-w-0 flex-col ${
          fillHeight ? 'overflow-hidden h-full' : 'overflow-y-auto overflow-x-hidden'
        }`}
      >
        {children}
      </div>
    </div>
  );
}
