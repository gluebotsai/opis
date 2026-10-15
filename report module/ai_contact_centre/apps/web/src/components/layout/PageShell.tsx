import type { ReactNode } from "react";

import { KpiCard } from "@/components/ui/kpi-card";
import { cn } from "@/lib/utils";

type PageHeaderProps = {
  scopeLabel: string;
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
};

/** Reference UI page header — scope pill, eyebrow, title, optional CTA. */
export function PageHeader({
  scopeLabel,
  eyebrow,
  title,
  description,
  action,
}: PageHeaderProps) {
  return (
    <div className="mb-5">
      <span className="inline-flex items-center rounded-full bg-neutral-200/80 px-3 py-1 text-xs font-medium text-neutral-700">
        {scopeLabel}
      </span>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-neutral-600">{eyebrow}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-neutral-900 sm:text-3xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-600">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}

type StatCardProps = {
  label: string;
  value: string | number;
  caption?: string;
  icon?: ReactNode;
  className?: string;
};

/** Reference UI KPI tile — dashboard outline theme. */
export function StatCard({ label, value, caption, icon, className }: StatCardProps) {
  return (
    <KpiCard
      label={label}
      value={value}
      caption={caption}
      className={className}
      header={
        icon ? (
          <div className="flex size-8 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600">
            {icon}
          </div>
        ) : undefined
      }
    />
  );
}

type SummaryRailProps = {
  children: ReactNode;
  className?: string;
};

/** Reference UI right rail (~280px) for list/form pages. */
export function SummaryRail({ children, className }: SummaryRailProps) {
  return (
    <aside className={cn("flex w-full shrink-0 flex-col gap-4 lg:w-[280px]", className)}>
      {children}
    </aside>
  );
}

type SummaryCardProps = {
  title: string;
  children: ReactNode;
};

export function SummaryCard({ title, children }: SummaryCardProps) {
  return (
    <div className="rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white p-5 shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-600">
        {title}
      </p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

type ListPageLayoutProps = {
  children: ReactNode;
  rail?: ReactNode;
};

/** Reference UI list layout — main table + optional right rail. */
export function ListPageLayout({ children, rail }: ListPageLayoutProps) {
  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1">{children}</div>
      {rail}
    </div>
  );
}
