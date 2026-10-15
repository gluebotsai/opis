import React from 'react';

type PanelProps = {
  children: React.ReactNode;
  className?: string;
};

/** Workspace / list panel card — Contact Center token pattern */
export default function Panel({ children, className = '' }: PanelProps) {
  return (
    <div
      className={`rounded-2xl border border-neutral-200 bg-white shadow-sm flex flex-col overflow-hidden ${className}`}
    >
      {children}
    </div>
  );
}
