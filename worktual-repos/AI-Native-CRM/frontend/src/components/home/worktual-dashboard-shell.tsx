import {
  Children,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import { Info } from "lucide-react";
import {
  WORKTUAL_CHART_CARD,
  WORKTUAL_DASHBOARD_CLUSTER,
  WORKTUAL_HAIRLINE,
  WORKTUAL_KPI_CARD,
  WORKTUAL_KPI_ROW,
  WORKTUAL_KPI_ROW_FLUID,
  WORKTUAL_KPI_ROW_PAIR,
  WORKTUAL_KPI_ROW_TRIPLE,
  WORKTUAL_SEGMENT_SHELL,
  WORKTUAL_KPI_ICON_TILE,
  WORKTUAL_TAB_BUTTON,
  WORKTUAL_TAB_TRACK,
} from "@/lib/worktual-control-tokens";

/** Worktual UI system — shared dashboard chrome (see worktual-ui-system SKILL). */
export {
  WORKTUAL_CARD_RADIUS,
  WORKTUAL_CHART_CARD,
  WORKTUAL_CONTROL_RADIUS,
  WORKTUAL_DASHBOARD_CLUSTER,
  WORKTUAL_HEADER_CONTROL,
  WORKTUAL_ICON_BUTTON,
  WORKTUAL_ICON_BUTTON_COMPOSER,
  WORKTUAL_KPI_CARD,
  WORKTUAL_KPI_ROW,
  WORKTUAL_KPI_ROW_FLUID,
  WORKTUAL_KPI_ROW_PAIR,
  WORKTUAL_KPI_ROW_TRIPLE,
  WORKTUAL_MOBILE_TAB_PILL,
  WORKTUAL_MOBILE_TAB_SHELL,
  WORKTUAL_TAB_BUTTON,
  WORKTUAL_REPORT_SURFACE,
  WORKTUAL_SEGMENT_SHELL,
  WORKTUAL_SURFACE_ROW,
  WORKTUAL_SURFACE_SECTION,
  WORKTUAL_HAIRLINE,
  WORKTUAL_TAB_TRACK,
} from "@/lib/worktual-control-tokens";

export const WORKTUAL_CANVAS = "bg-[#f3f4f6]";
export const WORKTUAL_PANEL = "bg-white shadow-none";
export const WORKTUAL_KPI_ICON_TONES = [
  "bg-blue-100 text-blue-600",
  "bg-emerald-100 text-emerald-600",
  "bg-cyan-100 text-cyan-600",
  "bg-violet-100 text-violet-600",
  "bg-amber-100 text-amber-600",
  "bg-rose-100 text-rose-600",
  "bg-teal-100 text-teal-600",
  "bg-indigo-100 text-indigo-600",
] as const;

export function WorktualDashboardPanel({
  children,
  className = "",
  header,
  tabs,
  busy,
}: {
  children: ReactNode;
  className?: string;
  /** Optional in-panel title row (above tabs). */
  header?: ReactNode;
  /** Tab strip — rendered inside the shared dashboard cluster. */
  tabs?: ReactNode;
  busy?: boolean;
}) {
  if (header == null && tabs == null) {
    return (
      <section className={`${WORKTUAL_PANEL} overflow-hidden ${className}`}>
        {children}
      </section>
    );
  }

  return (
    <section className={`${WORKTUAL_PANEL} overflow-hidden ${className}`}>
      <div
        className={`${WORKTUAL_DASHBOARD_CLUSTER} ${busy ? "opacity-70" : ""}`}
      >
        {header ? (
          <div className={`border-b ${WORKTUAL_HAIRLINE}`}>{header}</div>
        ) : null}
        {tabs}
        {children}
      </div>
    </section>
  );
}

export function WorktualHeaderCopy({
  title,
  subtitle,
  description,
}: {
  title: string;
  subtitle?: string;
  description?: string;
}) {
  return (
    <div className="min-w-0">
      <h2 className="text-lg font-semibold tracking-tight text-neutral-900">
        {title}
      </h2>
      {subtitle ? (
        <p className="mt-0.5 text-sm text-neutral-500">{subtitle}</p>
      ) : null}
      {description ? (
        <p className="mt-1.5 text-sm text-neutral-900">{description}</p>
      ) : null}
    </div>
  );
}

/** In-panel header (tabs sit below). */
export function WorktualPanelHeader({
  title,
  subtitle,
  description,
  actions,
}: {
  title: string;
  subtitle?: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header
      className={`flex flex-wrap items-start justify-between gap-3 border-b ${WORKTUAL_HAIRLINE} px-4 py-3`}
    >
      <WorktualHeaderCopy
        title={title}
        subtitle={subtitle}
        description={description}
      />
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </header>
  );
}

export type WorktualWorkspaceHeaderState = {
  leading: ReactNode;
  actions?: ReactNode;
  tall?: boolean;
};

export function WorktualSectionHeader({
  title,
  subtitle,
  description,
}: {
  title?: string;
  subtitle?: string;
  description?: string;
}) {
  return (
    <div className="space-y-1">
      {title ? (
        <h3 className="text-sm font-medium text-neutral-900">{title}</h3>
      ) : null}
      {subtitle ? (
        <p className="text-sm text-neutral-500">{subtitle}</p>
      ) : null}
      {description ? (
        <p className="text-sm text-neutral-500">{description}</p>
      ) : null}
    </div>
  );
}

export function WorktualLineTabs<T extends string>({
  tabs,
  active,
  onChange,
  ariaLabel,
}: {
  tabs: Array<{ id: T; label: string; icon?: LucideIcon }>;
  active: T;
  onChange: (id: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className={WORKTUAL_TAB_TRACK} role="tablist" aria-label={ariaLabel}>
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(tab.id)}
              className={`${WORKTUAL_TAB_BUTTON} ${
                selected
                  ? "bg-neutral-900 text-white shadow-sm"
                  : "text-neutral-500 hover:text-neutral-900"
              }`}
            >
              {Icon ? <Icon className="size-3.5 shrink-0" strokeWidth={2.25} /> : null}
              <span className="truncate">{tab.label}</span>
            </button>
          );
        })}
    </div>
  );
}

export function WorktualSegmentControl({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <div
      className={WORKTUAL_SEGMENT_SHELL}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={`inline-flex h-full items-center rounded-md px-2.5 text-sm font-medium transition-colors disabled:opacity-50 ${
              active
                ? "border border-neutral-900 bg-neutral-900 text-white shadow-sm"
                : "text-neutral-500 hover:text-neutral-900"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function WorktualKpiValue({ value }: { value: string }) {
  return (
    <p className="mt-3 text-[1.375rem] font-bold leading-none tracking-tight text-neutral-900 tabular-nums sm:text-[22px]">
      {value}
    </p>
  );
}

function WorktualInfoTooltip({ text }: { text: string }) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  function placeAndOpen() {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({
      top: rect.top - 8,
      left: rect.left + rect.width / 2,
    });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const hide = () => setOpen(false);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [open]);

  return (
    <span
      ref={rootRef}
      className="inline-flex shrink-0"
      onMouseEnter={placeAndOpen}
      onMouseLeave={() => setOpen(false)}
      onFocus={placeAndOpen}
      onBlur={() => setOpen(false)}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <Info
        className="size-3.5 text-neutral-400"
        strokeWidth={2.25}
        aria-label={text}
        tabIndex={0}
      />
      {open && typeof document !== "undefined"
        ? createPortal(
            <span
              role="tooltip"
              className="pointer-events-none fixed z-[200] max-w-[240px] -translate-x-1/2 -translate-y-full rounded-md bg-[#1a1a22] px-2.5 py-1.5 text-xs font-medium leading-snug text-text-on-dark shadow-lg ring-1 ring-white/15"
              style={{ top: pos.top, left: pos.left }}
            >
              {text}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}

export function WorktualKpiCard({
  label,
  value,
  hint,
  infoTooltip,
  href,
  icon: Icon,
  iconClassName = WORKTUAL_KPI_ICON_TONES[0],
  changePct,
  compareLabel,
  onClick,
}: {
  label: string;
  value: string;
  hint?: string;
  /** Hover text for the info icon; defaults to `hint` when set. */
  infoTooltip?: string;
  href?: string;
  icon: LucideIcon;
  iconClassName?: string;
  changePct?: number | null;
  compareLabel?: string;
  onClick?: () => void;
}) {
  const tooltipText = infoTooltip ?? hint;

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="text-sm font-semibold text-neutral-800">{label}</p>
          {tooltipText ? <WorktualInfoTooltip text={tooltipText} /> : null}
        </div>
        <span
          className={`${WORKTUAL_KPI_ICON_TILE} ${iconClassName}`}
        >
          <Icon className="size-[18px]" strokeWidth={2.25} />
        </span>
      </div>
      <WorktualKpiValue value={value} />
      {changePct != null ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-neutral-500">
          <span>{compareLabel ?? "vs prior period"}</span>
          <span
            className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
              changePct >= 0
                ? "bg-emerald-50 text-emerald-600"
                : "bg-rose-50 text-rose-500"
            }`}
          >
            {changePct >= 0 ? "+" : ""}
            {changePct}%
          </span>
        </div>
      ) : hint ? (
        <p className="mt-3 text-sm text-neutral-500">{hint}</p>
      ) : null}
    </>
  );

  const className = WORKTUAL_KPI_CARD;

  if (href) {
    return (
      <a href={href} className={className}>
        {body}
      </a>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${className} text-left`}>
        {body}
      </button>
    );
  }
  return <div className={className}>{body}</div>;
}

export function WorktualChartCard({
  title,
  headline,
  subtitle,
  children,
}: {
  title: string;
  headline?: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className={`flex h-full flex-col ${WORKTUAL_CHART_CARD}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-bold capitalize text-neutral-900">
              {title}
            </h3>
            <Info
              className="size-3.5 text-neutral-400"
              strokeWidth={2.25}
              aria-hidden
            />
          </div>
          {subtitle ? (
            <p className="mt-0.5 text-sm text-neutral-500">{subtitle}</p>
          ) : null}
        </div>
        {headline ? (
          <span className="shrink-0 text-sm font-semibold tabular-nums text-neutral-900">
            {headline}
          </span>
        ) : null}
      </div>
      <div className="mt-4 min-h-0 flex-1">{children}</div>
    </section>
  );
}

export type WorktualKpiGridLayout = "auto" | "rows-3-3-2";

function WorktualKpiGridRows({
  rows,
  allItems,
  ariaLabel,
}: {
  rows: ReactNode[][];
  allItems: ReactNode[];
  ariaLabel: string;
}) {
  return (
    <div className="@container/kpis" aria-label={ariaLabel}>
      <div className={`${WORKTUAL_KPI_ROW_FLUID} @[42rem]/kpis:hidden`}>
        {allItems}
      </div>
      <div className="hidden @[42rem]/kpis:flex flex-col gap-4">
        {rows.map((row, rowIndex) => (
          <div
            key={rowIndex}
            className={
              row.length === 2 ? WORKTUAL_KPI_ROW_PAIR : WORKTUAL_KPI_ROW_TRIPLE
            }
          >
            {row}
          </div>
        ))}
      </div>
    </div>
  );
}

export function WorktualKpiGrid({
  children,
  title,
  subtitle,
  description,
  layout = "auto",
}: {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  description?: string;
  /** `rows-3-3-2` — two rows of three, then one full-width row of two. */
  layout?: WorktualKpiGridLayout;
}) {
  const ariaLabel = title ?? "Key metrics";
  const items = Children.toArray(children);
  const gridBody =
    layout === "rows-3-3-2" ? (
      <WorktualKpiGridRows
        ariaLabel={ariaLabel}
        allItems={items}
        rows={[
          items.slice(0, 3),
          items.slice(3, 6),
          items.slice(6),
        ].filter((row) => row.length > 0)}
      />
    ) : (
      <div className={`@container/kpis ${WORKTUAL_KPI_ROW}`} aria-label={ariaLabel}>
        {children}
      </div>
    );

  const showHeader = title != null || subtitle != null || description != null;

  return (
    <div className="space-y-4">
      {showHeader ? (
        <WorktualSectionHeader
          title={title}
          subtitle={subtitle}
          description={description}
        />
      ) : null}
      {gridBody}
    </div>
  );
}

export function WorktualTableShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className={WORKTUAL_CHART_CARD}>
      <h3 className="text-sm font-bold text-neutral-900">{title}</h3>
      {subtitle ? (
        <p className="mt-0.5 text-sm text-neutral-500">{subtitle}</p>
      ) : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function worktualTableClass() {
  return "min-w-full text-sm";
}

export function worktualTableHeadClass() {
  return "border-b border-neutral-200 bg-neutral-50 text-left text-[11px] font-medium uppercase tracking-[0.12em] text-neutral-400";
}

export function worktualTableRowClass() {
  return "border-b border-neutral-200 last:border-0";
}
