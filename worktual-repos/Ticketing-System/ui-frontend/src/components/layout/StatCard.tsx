import React from 'react';

/** Mini metric card — matches Contact Center overview / queues stats */
export default function StatCard({
  label,
  value,
  hint,
  icon,
  badge,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-3 py-2.5 shadow-sm flex flex-col gap-1.5 min-h-[76px]">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] font-medium tracking-wide uppercase text-neutral-400 leading-tight">
          {label}
        </span>
        {icon && (
          <span className="shrink-0 text-neutral-500 [&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</span>
        )}
      </div>
      <div className="flex items-end justify-between gap-2 mt-auto">
        <span className="text-lg font-semibold tabular-nums text-neutral-900 leading-none">{value}</span>
        {badge}
      </div>
      {hint && <p className="text-[11px] text-neutral-500 leading-snug">{hint}</p>}
    </div>
  );
}
