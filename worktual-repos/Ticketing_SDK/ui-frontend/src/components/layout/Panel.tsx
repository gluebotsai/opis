import React from 'react';

type PanelProps = {
  children: React.ReactNode;
  className?: string;
};

/** Workspace / list panel card — Contact Center token pattern */
export default function Panel({ children, className = '' }: PanelProps) {
  return (
    <div
      className={`rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white shadow-none flex flex-col overflow-hidden ${className}`}
    >
      {children}
    </div>
  );
}
