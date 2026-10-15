import { Popover } from "antd";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import { CalendarRange } from "lucide-react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import { PerformanceRangeCalendar } from "@/components/performance/performance-range-calendar";
import type {
  PerformancePeriodSelection,
  PerformanceRange,
} from "@/features/performance/api";
import { cn } from "@/lib/utils";

const PRESETS: Array<{ range: PerformanceRange; label: string }> = [
  { range: "today", label: "Today" },
  { range: "7d", label: "7D" },
  { range: "30d", label: "30D" },
];

const PRESET_DAY_COUNT: Record<PerformanceRange, number> = {
  today: 1,
  "7d": 7,
  "30d": 30,
};

type SegmentKey = PerformanceRange | "custom";

function selectionToPickerValue(selection: PerformancePeriodSelection): [Dayjs, Dayjs] {
  if (selection.mode === "custom") {
    return [dayjs(selection.start), dayjs(selection.end)];
  }

  const end = dayjs();
  const days = PRESET_DAY_COUNT[selection.range];
  return [end.subtract(days - 1, "day"), end];
}

function formatCustomLabel(selection: Extract<PerformancePeriodSelection, { mode: "custom" }>) {
  const formatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
  return `${formatter.format(new Date(selection.start))} – ${formatter.format(
    new Date(selection.end),
  )}`;
}

type PerformanceDateRangeControlProps = {
  selection: PerformancePeriodSelection;
  onChange: (selection: PerformancePeriodSelection) => void;
  /** Hide Today, 7D, and 30D. The calendar button is the only control. */
  calendarOnly?: boolean;
};

export function PerformanceDateRangeControl({
  selection,
  onChange,
  calendarOnly = false,
}: PerformanceDateRangeControlProps) {
  const [customOpen, setCustomOpen] = useState(false);
  const pickerValue = useMemo(() => selectionToPickerValue(selection), [selection]);
  const isCustom = selection.mode === "custom";
  const activeSegment: SegmentKey =
    customOpen || isCustom ? "custom" : selection.range;

  const containerRef = useRef<HTMLDivElement>(null);
  const segmentRefs = useRef<Partial<Record<SegmentKey, HTMLButtonElement | null>>>({});
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  const updateIndicator = useCallback(() => {
    const container = containerRef.current;
    const activeButton = segmentRefs.current[activeSegment];
    if (!container || !activeButton) return;

    const containerRect = container.getBoundingClientRect();
    const buttonRect = activeButton.getBoundingClientRect();
    setIndicator({
      left: buttonRect.left - containerRect.left,
      width: buttonRect.width,
    });
  }, [activeSegment]);

  useLayoutEffect(() => {
    updateIndicator();
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => updateIndicator());
    observer.observe(container);
    for (const button of Object.values(segmentRefs.current)) {
      if (button) observer.observe(button);
    }

    return () => observer.disconnect();
  }, [updateIndicator, selection, customOpen]);

  const rangeLabel = `${pickerValue[0].format("MMM D")} – ${pickerValue[1].format("MMM D")}`;

  if (calendarOnly) {
    return (
      <Popover
        open={customOpen}
        onOpenChange={setCustomOpen}
        trigger="click"
        placement="bottomRight"
        arrow={false}
        destroyOnHidden
        overlayClassName="performance-range-popover"
        content={
          <PerformanceRangeCalendar
            value={pickerValue}
            onCancel={() => setCustomOpen(false)}
            onApply={(start, end) => {
              onChange({
                mode: "custom",
                start: start.format("YYYY-MM-DD"),
                end: end.format("YYYY-MM-DD"),
              });
              setCustomOpen(false);
            }}
          />
        }
      >
        <button
          type="button"
          aria-label="Recording dates"
          onClick={() => setCustomOpen(true)}
          className="inline-flex h-[38px] shrink-0 cursor-pointer items-center gap-2 rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-3 text-sm text-neutral-900"
        >
          <CalendarRange className="size-[18px] shrink-0" strokeWidth={2.25} aria-hidden />
          <span className="whitespace-nowrap">{rangeLabel}</span>
        </button>
      </Popover>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative inline-flex items-center rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50/90 p-0.5"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute top-0.5 bottom-0.5 rounded-md border border-neutral-900 bg-neutral-900 shadow-sm transition-[left,width] duration-200 ease-out"
        style={{
          left: indicator.left,
          width: indicator.width,
        }}
      />

      {PRESETS.map(({ range, label }) => {
        const active = activeSegment === range;
        return (
          <button
            key={range}
            ref={(node) => {
              segmentRefs.current[range] = node;
            }}
            type="button"
            onClick={() => {
              setCustomOpen(false);
              onChange({ mode: "preset", range });
            }}
            className={cn(
              "relative z-10 cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active ? "text-white" : "text-neutral-600 hover:text-neutral-800",
            )}
          >
            {label}
          </button>
        );
      })}

      <Popover
        open={customOpen}
        onOpenChange={setCustomOpen}
        trigger="click"
        placement="bottomRight"
        arrow={false}
        destroyOnHidden
        overlayClassName="performance-range-popover"
        content={
          <PerformanceRangeCalendar
            value={pickerValue}
            onCancel={() => setCustomOpen(false)}
            onApply={(start, end) => {
              onChange({
                mode: "custom",
                start: start.format("YYYY-MM-DD"),
                end: end.format("YYYY-MM-DD"),
              });
              setCustomOpen(false);
            }}
          />
        }
      >
        <button
          ref={(node) => {
            segmentRefs.current.custom = node;
          }}
          type="button"
          onClick={() => setCustomOpen(true)}
          className={cn(
            "relative z-10 inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            activeSegment === "custom"
              ? "text-white"
              : "text-neutral-600 hover:text-neutral-800",
          )}
        >
          <CalendarRange className="size-3.5 shrink-0" aria-hidden />
          <span className="max-w-[9.5rem] truncate">
            {isCustom ? formatCustomLabel(selection) : "Custom"}
          </span>
        </button>
      </Popover>
    </div>
  );
}
