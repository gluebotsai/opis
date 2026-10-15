import React from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';

export type AnalyticsKpiTint =
  | 'volume'
  | 'success'
  | 'time'
  | 'handle'
  | 'sla'
  | 'handoff'
  | 'trend'
  | 'default';

const TINT: Record<AnalyticsKpiTint, string> = {
  volume: 'bg-blue-100 text-blue-600',
  success: 'bg-emerald-100 text-emerald-600',
  time: 'bg-cyan-100 text-cyan-600',
  handle: 'bg-violet-100 text-violet-600',
  sla: 'bg-amber-100 text-amber-600',
  handoff: 'bg-rose-100 text-rose-600',
  trend: 'bg-indigo-100 text-indigo-600',
  default: 'bg-neutral-100 text-neutral-600',
};

type AnalyticsKpiCardProps = {
  label: string;
  value: string;
  change: string;
  up?: boolean;
  icon: React.ReactNode;
  tint?: AnalyticsKpiTint;
  className?: string;
};

/** Reports / Analytics KPI — white card, 38×38 tinted tile, no shadow. */
export default function AnalyticsKpiCard({
  label,
  value,
  change,
  up,
  icon,
  tint = 'default',
  className = '',
}: AnalyticsKpiCardProps) {
  return (
    <div
      className={`flex min-h-[136px] flex-col gap-2 rounded-xl border-[0.6px] border-[#bfbfbf] bg-white px-4 py-4 text-neutral-900 shadow-none ${className}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold leading-tight text-neutral-800">{label}</span>
        <span
          className={`inline-flex size-[38px] shrink-0 items-center justify-center rounded-xl [&_svg]:size-[18px] ${TINT[tint]}`}
        >
          {icon}
        </span>
      </div>
      <div className="text-[22px] font-bold tabular-nums leading-none text-neutral-900">{value}</div>
      <div className="mt-auto flex items-center gap-1 text-sm text-neutral-500">
        {up === true ? (
          <ArrowUpRight className="size-[18px] shrink-0 stroke-[2.25] text-emerald-600" />
        ) : up === false ? (
          <ArrowDownRight className="size-[18px] shrink-0 stroke-[2.25] text-rose-600" />
        ) : null}
        <span className="break-words leading-snug">{change}</span>
      </div>
    </div>
  );
}
