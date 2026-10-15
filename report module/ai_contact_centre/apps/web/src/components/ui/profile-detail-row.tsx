import type { ReactNode } from "react";

import { PanelScrollArea } from "@/components/ui/panel-scroll-area";
import { cn } from "@/lib/utils";

export const PROFILE_EMPTY_FACT = "—";

/** Card used on contact and task profile panels. */
export function ProfileSection({
  title,
  description,
  children,
  headerAction,
  className,
  scrollable = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  headerAction?: ReactNode;
  className?: string;
  /** Pin the card and scroll overflowing body content. */
  scrollable?: boolean;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border-[0.6px] border-[#bfbfbf] bg-white shadow-none",
        scrollable
          ? "flex min-h-0 min-w-0 flex-col overflow-hidden"
          : "px-4 py-4",
        className,
      )}
    >
      <div className={cn("flex items-start gap-2", scrollable && "shrink-0 px-4 pt-4")}>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-neutral-900">{title}</p>
          {description ? <p className="mt-0.5 text-sm text-neutral-600">{description}</p> : null}
        </div>
        {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
      </div>
      {scrollable ? (
        <PanelScrollArea className="mt-3 px-4 pb-4">{children}</PanelScrollArea>
      ) : (
        <div className="mt-3">{children}</div>
      )}
    </section>
  );
}

export function ProfileFact({
  label,
  value,
  children,
  wrap = false,
}: {
  label: string;
  value?: string;
  children?: ReactNode;
  wrap?: boolean;
}) {
  const empty = value === PROFILE_EMPTY_FACT;
  return (
    <div className="flex min-w-0 flex-col gap-[4px]">
      <p className="text-[12px] text-neutral-600">{label}</p>
      {children ?? (
        <p
          className={cn(
            "text-sm font-semibold",
            wrap ? "break-words" : "truncate",
            empty ? "text-neutral-400" : "text-neutral-900",
          )}
        >
          {value}
        </p>
      )}
    </div>
  );
}

export function ProfileFactGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-x-6 gap-y-[14px] sm:grid-cols-2">{children}</div>;
}

/** Bordered label/value list used on contact and agent profiles. */
export function ProfileDetailList({
  children,
  className,
  embedded = false,
}: {
  children: ReactNode;
  className?: string;
  /** Drop the outer card chrome when nested inside another bordered container. */
  embedded?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[max-content_minmax(0,1fr)]",
        !embedded && "rounded-xl border-[0.6px] border-[#bfbfbf] bg-white px-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ProfileDetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const placeholder = children === "—" || children === "" || children == null;
  const textValue = typeof children === "string" || typeof children === "number";
  const valueClassName = cn(
    "min-w-0 font-semibold",
    textValue && "truncate",
    placeholder ? "text-neutral-400" : "text-[#171717]",
  );
  return (
    <div className="col-span-2 grid grid-cols-subgrid items-center gap-x-8 border-b-[0.6px] border-[#e5e5e5] py-1.5 text-[14px] leading-5 last:border-b-0">
      <span className="whitespace-nowrap font-medium text-neutral-600">{label}</span>
      {textValue ? (
        <span className={valueClassName}>{children}</span>
      ) : (
        <div className={valueClassName}>{children}</div>
      )}
    </div>
  );
}
