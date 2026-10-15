import { ChevronRight, X } from "lucide-react";
import { type ReactNode } from "react";

import { useCopilotWorkspacePanels } from "@/components/assistant/copilot-workspace";
import { listRowButtonClassName, listRowDividerClassName } from "@/components/ui/list-row";
import { PanelScrollArea } from "@/components/ui/panel-scroll-area";
import { SegmentTabs } from "@/components/ui/segment-tabs";
import type { QueueSnapshot } from "@/features/monitoring/types";
import { formatMonitoringDuration } from "@/components/monitoring/monitoring-utils";
import { profileAvatarClassName } from "@/lib/avatar-utils";
import { cn } from "@/lib/utils";

export { SegmentTabs as MonitoringSegmentTabs };

/** Card grid when the monitoring panel is expanded or co-worker is minimized. */
export function useMonitoringCardLayout(): { cardLayout: boolean; fullWidth: boolean } {
  const ctx = useCopilotWorkspacePanels();
  if (!ctx) {
    return { cardLayout: false, fullWidth: false };
  }
  return {
    cardLayout: ctx.copilotMinimized || ctx.expandedSide === "right",
    fullWidth: ctx.copilotMinimized,
  };
}

export type MonitoringItemLayout = "list" | "cards";

export type MonitoringListMetaItem = {
  label: string;
  value: ReactNode;
};

function MonitoringListMeta({ items }: { items: MonitoringListMetaItem[] }) {
  return (
    <dl className="mt-1.5 grid grid-cols-[5.75rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs leading-4">
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className="text-neutral-400">{item.label}</dt>
          <dd className="flex min-w-0 items-center text-neutral-700">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function LivePulse({ connected = true }: { connected?: boolean }) {
  if (!connected) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
        <span className="size-2 rounded-full bg-amber-500" />
        Stale
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
      <span className="relative flex size-2">
        <span
          className={cn(
            "absolute inline-flex size-full rounded-full bg-emerald-500 opacity-75",
            connected && "animate-ping",
          )}
        />
        <span className="relative inline-flex size-2 rounded-full bg-emerald-600" />
      </span>
      Live
    </span>
  );
}

export function MonitoringSection({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-[11px] text-neutral-600">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function MonitoringDrawer({
  open,
  title,
  subtitle,
  onClose,
  children,
  widthClass = "max-w-lg",
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  widthClass?: string;
}) {
  if (!open) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Close dialog"
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="monitoring-drawer-title"
          className={cn(
            "flex h-[min(90vh,880px)] w-full flex-col overflow-hidden rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white shadow-2xl",
            widthClass,
          )}
        >
          <div className="flex shrink-0 items-start justify-between gap-3 border-b-[0.6px] border-[#bfbfbf] px-4 py-3 sm:px-5 sm:py-4">
            <div className="min-w-0">
              <h2 id="monitoring-drawer-title" className="truncate text-sm font-semibold text-neutral-900">
                {title}
              </h2>
              {subtitle ? (
                <p className="mt-0.5 truncate text-[11px] text-neutral-600">{subtitle}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 rounded-lg p-1 text-neutral-600 hover:bg-neutral-100 hover:text-neutral-800"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-4 sm:px-5 sm:py-5">
            {children}
          </div>
        </div>
      </div>
    </>
  );
}

export function StatusBadge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
}) {
  const toneClass =
    tone === "success"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
      : tone === "warning"
        ? "bg-amber-50 text-amber-700 ring-amber-100"
        : tone === "danger"
          ? "bg-rose-50 text-rose-700 ring-rose-100"
          : tone === "info"
            ? "bg-sky-50 text-sky-700 ring-sky-100"
            : "bg-neutral-100 text-neutral-700 ring-neutral-200";

  return (
    <span className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-none ring-1 ring-inset", toneClass)}>
      {label}
    </span>
  );
}

export function CapacityBar({ active, max }: { active: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((active / max) * 100)) : 0;
  const tone =
    pct >= 100 ? "bg-rose-500" : pct >= 75 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100">
        <div className={cn("h-full rounded-full transition-all duration-500", tone)} style={{ width: `${pct}%` }} />
      </div>
      <span className="shrink-0 text-[11px] font-medium tabular-nums text-neutral-700">
        {active}/{max}
      </span>
    </div>
  );
}

export function formatDuration(seconds: number): string {
  return formatMonitoringDuration(Math.max(0, Math.floor(seconds)));
}

export function formatMonitoringDateTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function humanizeMonitoringCode(value: string): string {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function conversationTotalSeconds(input: {
  createdAt: string;
  endedAt: string | null;
  resolvedAt: string | null;
  isClosed?: boolean;
}): number {
  const endIso = input.endedAt ?? input.resolvedAt;
  const endMs = endIso ? Date.parse(endIso) : Date.now();
  const startMs = Date.parse(input.createdAt);
  if (!Number.isFinite(endMs) || !Number.isFinite(startMs)) return 0;
  return Math.max(0, Math.floor((endMs - startMs) / 1000));
}

export function formatClock(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export function slaTone(sla: string): "success" | "warning" | "danger" | "neutral" {
  if (sla === "healthy") return "success";
  if (sla === "at_risk") return "warning";
  if (sla === "breached") return "danger";
  return "neutral";
}

export function agentStatusTone(status: string): "success" | "warning" | "danger" | "info" | "neutral" {
  if (status === "available") return "success";
  if (status === "busy") return "info";
  if (status === "wrap-up") return "warning";
  if (status === "away") return "warning";
  return "neutral";
}

export function agentStatusLabel(status: string): string {
  return status
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("-");
}

export function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - date.getTime()) / 60_000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffMin < 24 * 60) return `${Math.floor(diffMin / 60)}h ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function MonitoringFilterPills<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ id: T; label: string; count?: number }>;
  onChange: (value: T) => void;
}) {
  const visible = options.filter((option) => option.count == null || option.count > 0);
  if (visible.length === 0) return null;

  return (
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {visible.map((option) => {
        const active = value === option.id;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className={cn(
              "inline-flex h-7 shrink-0 cursor-pointer items-center whitespace-nowrap rounded-full border px-2 text-xs font-medium transition-colors",
              active
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-200 bg-white text-neutral-600 hover:border-[#bfbfbf] hover:bg-neutral-50",
            )}
          >
            {option.label}
            {option.count != null ? ` (${option.count})` : ""}
          </button>
        );
      })}
    </div>
  );
}

export function MonitoringEmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-14 text-center">
      <div className="flex size-10 items-center justify-center rounded-xl bg-neutral-100">
        <span className="text-sm text-neutral-600">—</span>
      </div>
      <p className="mt-3 text-sm font-medium text-neutral-800">{title}</p>
      {description ? <p className="mt-1 text-xs text-neutral-600">{description}</p> : null}
    </div>
  );
}

export function MonitoringTabShell({
  toolbar,
  children,
}: {
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {toolbar ? (
        <div className="shrink-0 space-y-2 px-3 pt-3 pb-3 xl:p-4">{toolbar}</div>
      ) : null}
      <PanelScrollArea className="min-h-0 flex-1 px-3 py-3">{children}</PanelScrollArea>
    </div>
  );
}

export function MonitoringListRow({
  seed,
  initials,
  title,
  trailing,
  trailingBottom,
  subtitle,
  subtitleIcon,
  detail,
  meta,
  badges,
  badgesPlacement = "inline",
  selected = false,
  layout = "list",
  onClick,
}: {
  seed: string;
  initials: string;
  title: string;
  trailing?: ReactNode;
  trailingBottom?: ReactNode;
  subtitle?: string;
  subtitleIcon?: ReactNode;
  detail?: string;
  meta?: MonitoringListMetaItem[];
  badges?: ReactNode;
  badgesPlacement?: "inline" | "below";
  selected?: boolean;
  layout?: MonitoringItemLayout;
  onClick?: () => void;
}) {
  if (layout === "cards") {
    return (
      <li className="min-h-0">
        <button
          type="button"
          onClick={onClick}
          className={cn(
            "flex h-full w-full flex-col rounded-xl border bg-white p-4 text-left shadow-sm transition-colors",
            selected
              ? "border-neutral-900 ring-1 ring-neutral-900"
              : "border-neutral-200 hover:border-[#bfbfbf] hover:bg-neutral-50",
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-start gap-3">
              <div className={profileAvatarClassName(seed, "size-10 shrink-0 text-xs")}>
                {initials}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-neutral-900">{title}</p>
                {subtitle ? (
                  <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-neutral-600">
                    {subtitleIcon ? (
                      <span className="inline-flex size-6 shrink-0 items-center justify-center [&>span]:!size-6">
                        {subtitleIcon}
                      </span>
                    ) : null}
                    <span className="truncate">{subtitle}</span>
                  </p>
                ) : null}
              </div>
            </div>
            {trailingBottom ? (
              <span className="shrink-0 text-sm tabular-nums text-neutral-400">
                {trailingBottom}
              </span>
            ) : null}
          </div>
          {detail ? <p className="mt-3 text-sm text-neutral-600">{detail}</p> : null}
          {badges ? (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">{badges}</div>
          ) : null}
        </button>
      </li>
    );
  }

  return (
    <li className={listRowDividerClassName()}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          listRowButtonClassName,
          "group flex items-start gap-3",
          selected ? "bg-neutral-100" : "hover:bg-neutral-50",
        )}
      >
        <div className={profileAvatarClassName(seed, "size-10 shrink-0 text-xs")}>{initials}</div>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium leading-5 text-neutral-900">{title}</span>
            {badges && badgesPlacement === "inline" ? (
              <div className="flex shrink-0 items-center gap-1.5">{badges}</div>
            ) : null}
          </div>
          {meta && meta.length > 0 ? (
            <MonitoringListMeta items={meta} />
          ) : (
            <>
              {subtitle ? (
                <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm leading-5 text-neutral-600">
                  {subtitleIcon ? (
                    <span className="inline-flex size-6 shrink-0 items-center justify-center [&>span]:!size-6">
                      {subtitleIcon}
                    </span>
                  ) : null}
                  <span className="truncate">{subtitle}</span>
                </p>
              ) : null}
              {detail ? (
                <p className="mt-0.5 truncate text-sm leading-5 text-neutral-600">{detail}</p>
              ) : null}
              {badges && badgesPlacement === "below" ? (
                <div
                  className={cn(
                    "mt-1 flex flex-wrap items-center gap-1.5",
                    subtitleIcon && "pl-[30px]",
                  )}
                >
                  {badges}
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5 self-start pl-1">
          {trailingBottom ? (
            <span className="whitespace-nowrap text-sm leading-5 tabular-nums text-neutral-400">
              {trailingBottom}
            </span>
          ) : null}
          {trailing ? <div className="flex items-center gap-1.5">{trailing}</div> : null}
          <ChevronRight className="size-4 shrink-0 text-neutral-300" aria-hidden="true" />
        </div>
      </button>
    </li>
  );
}

export function MonitoringList({
  children,
  layout = "list",
  fullWidth = false,
}: {
  children: ReactNode;
  layout?: MonitoringItemLayout;
  fullWidth?: boolean;
}) {
  if (layout === "cards") {
    return (
      <ul
        className={cn(
          "grid gap-3",
          fullWidth
            ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
            : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3",
        )}
      >
        {children}
      </ul>
    );
  }
  return <ul>{children}</ul>;
}

function queueCardStatusLabel(status: QueueSnapshot["status"]): string {
  if (status === "healthy") return "Healthy";
  if (status === "watch") return "Watch";
  return "Critical";
}

function queueCardStatusTone(status: QueueSnapshot["status"]): "success" | "warning" | "danger" {
  if (status === "healthy") return "success";
  if (status === "watch") return "warning";
  return "danger";
}

export function MonitoringQueueCards({
  queues,
  fullWidth = false,
  className,
  onSelectQueue,
}: {
  queues: QueueSnapshot[];
  fullWidth?: boolean;
  className?: string;
  onSelectQueue?: (queue: QueueSnapshot) => void;
}) {
  return (
    <div
      className={cn(
        "grid gap-3",
        fullWidth
          ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3",
        className,
      )}
    >
      {queues.map((queue) => (
        <button
          key={queue.id}
          type="button"
          onClick={() => onSelectQueue?.(queue)}
          className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-4 text-left shadow-sm transition-colors hover:border-[#bfbfbf] hover:bg-neutral-50"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-neutral-900">{queue.name}</p>
              <p className="mt-0.5 text-[11px] text-neutral-600">{queue.readyAgents} agents ready</p>
            </div>
            <StatusBadge
              label={queueCardStatusLabel(queue.status)}
              tone={queueCardStatusTone(queue.status)}
            />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-neutral-600">Waiting</p>
              <p className="mt-1 text-lg font-semibold text-amber-700">{queue.waiting}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-neutral-600">Active</p>
              <p className="mt-1 text-lg font-semibold text-emerald-700">{queue.active}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-neutral-600">Bot</p>
              <p className="mt-1 text-lg font-semibold text-indigo-700">{queue.botActive}</p>
            </div>
          </div>
          {queue.oldestWaitSeconds != null ? (
            <p className="mt-3 border-t-[0.6px] border-[#bfbfbf] pt-3 text-xs text-neutral-600">
              Longest wait {formatDuration(queue.oldestWaitSeconds)}
            </p>
          ) : null}
        </button>
      ))}
    </div>
  );
}
