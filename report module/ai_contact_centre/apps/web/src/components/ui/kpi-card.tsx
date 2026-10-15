import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Base shell only — size-specific height/padding applied in `KpiCard`. */
export const kpiCardClassName =
  "flex min-w-0 flex-col rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white shadow-none";

export const kpiCardMdClassName = "h-full min-h-[136px] px-3.5 py-4";

export const kpiCardSmClassName = "h-auto min-h-0 rounded-xl px-2.5 py-1.5";

export const kpiCardLabelClassName = "truncate capitalize text-neutral-900";

export const kpiCardValueClassName =
  "font-bold leading-none tracking-tight text-neutral-900 tabular-nums";

export const kpiCardCaptionClassName =
  "min-w-0 truncate text-[11px] leading-snug text-neutral-600";

type KpiCardProps = {
  label: string;
  value: string | number;
  caption?: string;
  className?: string;
  valueClassName?: string;
  header?: ReactNode;
  /** Compact tile for sidebar summary panels. */
  size?: "md" | "sm";
};

/** Shared KPI tile shell — soft card theme. */
export function KpiCard({
  label,
  value,
  caption,
  className,
  valueClassName,
  header,
  size = "md",
}: KpiCardProps) {
  const compact = size === "sm";

  return (
    <div
      className={cn(
        kpiCardClassName,
        compact ? kpiCardSmClassName : kpiCardMdClassName,
        className,
      )}
    >
      {header}
      <p
        className={cn(
          kpiCardLabelClassName,
          header && "mt-1",
          compact
            ? "text-[11px] font-semibold tracking-wide"
            : "text-[14px] font-bold tracking-[0.08em]",
        )}
      >
        {label}
      </p>
      <p
        className={cn(
          kpiCardValueClassName,
          compact ? "mt-0.5 text-sm" : "mt-2 text-[20px]",
          valueClassName,
        )}
      >
        {value}
      </p>
      {caption ? (
        <p className={cn(kpiCardCaptionClassName, compact ? "mt-1" : "mt-3")}>{caption}</p>
      ) : null}
    </div>
  );
}
