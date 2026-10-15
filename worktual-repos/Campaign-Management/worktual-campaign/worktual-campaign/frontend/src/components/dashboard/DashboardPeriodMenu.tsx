import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { addMonths, monthLabel } from "@/lib/campaign-calendar";
import {
  normalizeYmdRange,
  rangeLabel,
  type PerformanceCustomRange,
  type PerformanceRange,
} from "@/lib/dashboard-metrics";

const PRESETS: { id: Exclude<PerformanceRange, "custom">; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "weekly", label: "Last week" },
  { id: "monthly", label: "Last month" },
  { id: "all", label: "All" },
];

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

type Cell = { ymd: string; day: number; inMonth: boolean };

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function ymdOf(y: number, m: number, d: number) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function todayIstYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function monthAnchorFor(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

function buildPickerGrid(anchor: string): Cell[] {
  const [y, m] = anchor.split("-").map(Number);
  const startPad = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const prevMonthDays = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
  const cells: Cell[] = [];

  for (let i = 0; i < startPad; i++) {
    const day = prevMonthDays - startPad + i + 1;
    const pm = m === 1 ? 12 : m - 1;
    const py = m === 1 ? y - 1 : y;
    cells.push({ ymd: ymdOf(py, pm, day), day, inMonth: false });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ ymd: ymdOf(y, m, day), day, inMonth: true });
  }
  while (cells.length % 7 !== 0) {
    const extra = cells.length - startPad - daysInMonth + 1;
    const nm = m === 12 ? 1 : m + 1;
    const ny = m === 12 ? y + 1 : y;
    cells.push({ ymd: ymdOf(ny, nm, extra), day: extra, inMonth: false });
  }
  return cells;
}

type Props = {
  range: PerformanceRange;
  customRange: PerformanceCustomRange | null;
  onChange: (
    range: PerformanceRange,
    custom: PerformanceCustomRange | null,
  ) => void;
};

export function DashboardPeriodMenu({ range, customRange, onChange }: Props) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const [viewMonth, setViewMonth] = useState(() =>
    monthAnchorFor(customRange?.to || todayIstYmd()),
  );
  const [draftFrom, setDraftFrom] = useState<string | null>(
    customRange?.from ?? null,
  );
  const [draftTo, setDraftTo] = useState<string | null>(customRange?.to ?? null);

  const cells = useMemo(() => buildPickerGrid(viewMonth), [viewMonth]);
  const today = todayIstYmd();
  const label = rangeLabel(range, customRange);

  const place = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
  };

  useEffect(() => {
    if (!open) return;
    place();
    setDraftFrom(customRange?.from ?? null);
    setDraftTo(customRange?.to ?? null);
    setViewMonth(monthAnchorFor(customRange?.to || todayIstYmd()));
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) {
        return;
      }
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onReposition = () => place();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, customRange]);

  const pickPreset = (id: Exclude<PerformanceRange, "custom">) => {
    onChange(id, null);
    setDraftFrom(null);
    setDraftTo(null);
    setOpen(false);
  };

  const pickDay = (ymd: string) => {
    if (!draftFrom || draftTo) {
      setDraftFrom(ymd);
      setDraftTo(null);
      return;
    }
    const next = normalizeYmdRange(draftFrom, ymd);
    setDraftFrom(next.from);
    setDraftTo(next.to);
    onChange("custom", next);
    setOpen(false);
  };

  const inDraft = (ymd: string) => {
    if (!draftFrom) return false;
    const end = draftTo || draftFrom;
    const a = draftFrom <= end ? draftFrom : end;
    const b = draftFrom <= end ? end : draftFrom;
    return ymd >= a && ymd <= b;
  };

  const isEdge = (ymd: string) =>
    ymd === draftFrom || ymd === (draftTo || (draftFrom && !draftTo ? draftFrom : null));

  return (
    <div className="flex items-center">
      <button
        ref={triggerRef}
        type="button"
        id="dashboard-perf-range"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Performance range"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-[38px] min-w-[5.5rem] items-center justify-between gap-2 rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50 px-3 text-sm font-medium text-neutral-900 transition-colors hover:bg-white focus:outline-none focus:ring-2 focus:ring-neutral-200"
      >
        <span className="max-w-[9.5rem] truncate">{label}</span>
        <ChevronDown className="size-[18px] shrink-0 text-neutral-500" strokeWidth={2.25} />
      </button>

      {open && pos
        ? createPortal(
            <div
              ref={panelRef}
              role="listbox"
              style={{ top: pos.top, right: pos.right }}
              className="fixed z-[80] w-[272px] rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-2 shadow-none"
            >
              <div className="space-y-1 p-1">
                {PRESETS.map((opt) => {
                  const selected = range === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => pickPreset(opt.id)}
                      className={`flex h-[38px] w-full items-center rounded-lg px-3 text-left text-sm font-medium ${
                        selected
                          ? "bg-[#171717] text-white"
                          : "text-neutral-900 hover:bg-neutral-50"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              <div className="mt-1 rounded-xl bg-neutral-50 px-2.5 pb-3 pt-2">
                <div className="mb-2 flex items-center justify-between">
                  <button
                    type="button"
                    className="inline-flex size-7 items-center justify-center rounded-lg text-neutral-600 hover:bg-white"
                    aria-label="Previous month"
                    onClick={() => setViewMonth((m) => addMonths(m, -1))}
                  >
                    <ChevronLeft className="size-[14px]" strokeWidth={2.25} />
                  </button>
                  <p className="text-sm font-semibold text-neutral-800">
                    {monthLabel(viewMonth)}
                  </p>
                  <button
                    type="button"
                    className="inline-flex size-7 items-center justify-center rounded-lg text-neutral-600 hover:bg-white"
                    aria-label="Next month"
                    onClick={() => setViewMonth((m) => addMonths(m, 1))}
                  >
                    <ChevronRight className="size-[14px]" strokeWidth={2.25} />
                  </button>
                </div>
                <div className="grid grid-cols-7 gap-y-1 text-center">
                  {WEEKDAYS.map((d, i) => (
                    <span
                      key={`${d}-${i}`}
                      className="pb-1 text-[11px] font-medium text-neutral-400"
                    >
                      {d}
                    </span>
                  ))}
                  {cells.map((cell) => {
                    const selected = inDraft(cell.ymd);
                    const edge = isEdge(cell.ymd);
                    const isToday = cell.ymd === today;
                    return (
                      <button
                        key={cell.ymd}
                        type="button"
                        onClick={() => pickDay(cell.ymd)}
                        className={`mx-auto flex size-8 items-center justify-center rounded-lg text-[11px] font-medium ${
                          edge
                            ? "bg-[#171717] text-white"
                            : selected
                              ? "bg-neutral-200 text-neutral-900"
                              : cell.inMonth
                                ? "text-neutral-800 hover:bg-white"
                                : "text-neutral-300 hover:bg-white"
                        } ${isToday && !selected ? "ring-1 ring-[#bfbfbf]" : ""}`}
                      >
                        {cell.day}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 px-1 text-[11px] text-neutral-500">
                  Click a start date, then an end date.
                </p>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
