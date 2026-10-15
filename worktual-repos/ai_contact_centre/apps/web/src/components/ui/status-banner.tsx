import type { LucideIcon } from "lucide-react";
import { AlertTriangle, CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type StatusBannerTone = "success" | "warning" | "error" | "info";

const TONE_STYLES: Record<
  StatusBannerTone,
  { wrap: string; icon: string; title: string; body: string; Icon: LucideIcon }
> = {
  success: {
    wrap: "border-emerald-200 bg-emerald-50",
    icon: "text-emerald-600",
    title: "text-emerald-900",
    body: "text-emerald-800",
    Icon: CheckCircle2,
  },
  warning: {
    wrap: "border-amber-200 bg-amber-50",
    icon: "text-amber-600",
    title: "text-amber-950",
    body: "text-amber-900",
    Icon: AlertTriangle,
  },
  error: {
    wrap: "border-red-200 bg-red-50",
    icon: "text-red-600",
    title: "text-red-900",
    body: "text-red-700",
    Icon: CircleAlert,
  },
  info: {
    wrap: "border-[#bfbfbf] bg-neutral-50",
    icon: "text-neutral-600",
    title: "text-neutral-900",
    body: "text-neutral-700",
    Icon: Info,
  },
};

export type StatusBannerProps = {
  tone: StatusBannerTone;
  title?: string;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
  icon?: LucideIcon;
  onDismiss?: () => void;
};

export function StatusBanner({
  tone,
  title,
  children,
  actions,
  className,
  icon: IconOverride,
  onDismiss,
}: StatusBannerProps) {
  const styles = TONE_STYLES[tone];
  const Icon = IconOverride ?? styles.Icon;

  return (
    <div
      role={tone === "error" || tone === "warning" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-xl border-[0.6px] px-3.5 py-3 text-sm",
        styles.wrap,
        className,
      )}
    >
      <Icon className={cn("mt-0.5 size-[18px] shrink-0", styles.icon)} strokeWidth={2.25} />
      <div className="min-w-0 flex-1">
        {title ? <p className={cn("font-semibold", styles.title)}>{title}</p> : null}
        {children ? (
          <div className={cn(title ? "mt-0.5" : null, styles.body)}>{children}</div>
        ) : null}
        {actions ? <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className={cn(
            "grid size-[38px] shrink-0 cursor-pointer place-items-center rounded-lg hover:bg-black/5",
            styles.icon,
          )}
        >
          <X className="size-[18px]" />
        </button>
      ) : null}
    </div>
  );
}
