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
    <div className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white px-4 py-3 shadow-none flex flex-col gap-1.5 min-h-[76px]">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold text-neutral-800 leading-tight">
          {label}
        </span>
        {icon && (
          <span className="inline-flex size-[38px] shrink-0 items-center justify-center rounded-xl bg-neutral-50 text-neutral-600 [&_svg]:size-[18px]">
            {icon}
          </span>
        )}
      </div>
      <div className="flex items-end justify-between gap-2 mt-auto">
        <span className="text-[22px] font-bold tabular-nums text-neutral-900 leading-none">{value}</span>
        {badge}
      </div>
      {hint && <p className="text-sm leading-snug text-neutral-500">{hint}</p>}
    </div>
  );
}
