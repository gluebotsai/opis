import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;

type PerformanceRangeCalendarProps = {
  value: [Dayjs, Dayjs];
  onApply: (start: Dayjs, end: Dayjs) => void;
  onCancel: () => void;
};

function formatDateLabel(value: Dayjs) {
  return value.format("MMM D, YYYY");
}

function normalizeRange(start: Dayjs, end: Dayjs): [Dayjs, Dayjs] {
  return start.isAfter(end, "day") ? [end, start] : [start, end];
}

function getMonthGrid(viewMonth: Dayjs): Dayjs[] {
  const start = viewMonth.startOf("month").startOf("week");
  const end = viewMonth.endOf("month").endOf("week");
  const days: Dayjs[] = [];
  let current = start;
  while (current.isBefore(end) || current.isSame(end, "day")) {
    days.push(current);
    current = current.add(1, "day");
  }
  return days;
}

function isBetween(day: Dayjs, start: Dayjs, end: Dayjs) {
  return !day.isBefore(start, "day") && !day.isAfter(end, "day");
}

function dayFromPoint(clientX: number, clientY: number): Dayjs | null {
  const node = document.elementFromPoint(clientX, clientY);
  const target = node instanceof Element ? node.closest("[data-calendar-day]") : null;
  const key = target?.getAttribute("data-calendar-day");
  return key ? dayjs(key) : null;
}

export function PerformanceRangeCalendar({
  value,
  onApply,
  onCancel,
}: PerformanceRangeCalendarProps) {
  const [viewMonth, setViewMonth] = useState(() => value[1].startOf("month"));
  const [draftStart, setDraftStart] = useState<Dayjs | null>(value[0]);
  const [draftEnd, setDraftEnd] = useState<Dayjs | null>(value[1]);
  const [hoverDay, setHoverDay] = useState<Dayjs | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    origin: string;
    current: string;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    setDraftStart(value[0]);
    setDraftEnd(value[1]);
    setViewMonth(value[1].startOf("month"));
    setHoverDay(null);
  }, [value[0].valueOf(), value[1].valueOf()]);

  const days = useMemo(() => getMonthGrid(viewMonth), [viewMonth]);
  const today = dayjs().startOf("day");

  const previewRange = useMemo(() => {
    if (!draftStart || !hoverDay) return null;
    return normalizeRange(draftStart, hoverDay);
  }, [draftStart, hoverDay]);

  const committedRange = useMemo(() => {
    if (!draftStart || !draftEnd) return null;
    return normalizeRange(draftStart, draftEnd);
  }, [draftStart, draftEnd]);

  const activeRange = hoverDay ? previewRange : committedRange;

  function selectDay(day: Dayjs) {
    if (day.isAfter(today, "day")) return;
    if (draftStart && !draftEnd) {
      commitRange(draftStart, day);
      return;
    }
    setDraftStart(day);
    setDraftEnd(null);
    setHoverDay(null);
  }

  function commitRange(start: Dayjs, end: Dayjs) {
    const [from, to] = normalizeRange(start, end);
    setDraftStart(from);
    setDraftEnd(to);
    setHoverDay(null);
  }

  function updateDragHover(clientX: number, clientY: number) {
    const drag = dragRef.current;
    if (!drag) return;
    const over = dayFromPoint(clientX, clientY);
    if (!over || over.isAfter(today, "day")) return;
    if (over.format("YYYY-MM-DD") !== drag.origin) {
      drag.moved = true;
    }
    drag.current = over.format("YYYY-MM-DD");
    if (!drag.moved) return;
    setDraftStart(dayjs(drag.origin));
    setDraftEnd(null);
    setHoverDay(over);
  }

  function handleGridPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const over = dayFromPoint(event.clientX, event.clientY);
    if (!over || over.isAfter(today, "day")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      origin: over.format("YYYY-MM-DD"),
      current: over.format("YYYY-MM-DD"),
      moved: false,
    };
  }

  function handleGridPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      updateDragHover(event.clientX, event.clientY);
      return;
    }
    if (!draftStart || draftEnd) return;
    const over = dayFromPoint(event.clientX, event.clientY);
    if (!over || over.isAfter(today, "day")) return;
    setHoverDay(over);
  }

  function handleGridPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const origin = dayjs(drag.origin);
    const over = dayFromPoint(event.clientX, event.clientY) ?? dayjs(drag.current);
    if (drag.moved && !over.isAfter(today, "day") && !over.isSame(origin, "day")) {
      commitRange(origin, over);
    } else {
      selectDay(origin);
    }
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  const summary = activeRange
    ? activeRange[0].isSame(activeRange[1], "day")
      ? formatDateLabel(activeRange[0])
      : `${formatDateLabel(activeRange[0])} – ${formatDateLabel(activeRange[1])}`
    : draftStart
      ? "Click an end date"
      : "Click a start date";

  return (
    <div className="w-[19rem]">
      <div className="border-b-[0.6px] border-[#bfbfbf] px-4 py-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-400">
          Custom range
        </p>
        <p className="mt-1 text-sm font-semibold text-neutral-900">{summary}</p>
      </div>

      <div className="px-3 py-3">
        <div className="mb-3 flex items-center justify-between">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => setViewMonth((month) => month.subtract(1, "month"))}
            className="inline-flex size-8 items-center justify-center rounded-lg text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900"
          >
            <ChevronLeft className="size-4" />
          </button>
          <p className="text-sm font-semibold text-neutral-900">{viewMonth.format("MMMM YYYY")}</p>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => setViewMonth((month) => month.add(1, "month"))}
            className="inline-flex size-8 items-center justify-center rounded-lg text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>

        <div
          className="grid grid-cols-7 gap-y-1 select-none touch-none"
          onPointerDown={handleGridPointerDown}
          onPointerMove={handleGridPointerMove}
          onPointerUp={handleGridPointerUp}
          onPointerCancel={handleGridPointerUp}
          onPointerLeave={() => {
            if (!dragRef.current) setHoverDay(null);
          }}
        >
          {WEEKDAYS.map((weekday) => (
            <div
              key={weekday}
              className="flex h-8 items-center justify-center text-[10px] font-medium uppercase tracking-wide text-neutral-400"
            >
              {weekday}
            </div>
          ))}

          {days.map((day) => {
            const inCurrentMonth = day.month() === viewMonth.month();
            const isFuture = day.isAfter(today, "day");
            const isToday = day.isSame(today, "day");
            const isStart = Boolean(
              activeRange && day.isSame(activeRange[0], "day"),
            );
            const isEnd = Boolean(activeRange && day.isSame(activeRange[1], "day"));
            const inRange = Boolean(activeRange && isBetween(day, activeRange[0], activeRange[1]));
            const isSingleDay = isStart && isEnd;

            return (
              <button
                key={day.format("YYYY-MM-DD")}
                type="button"
                data-calendar-day={day.format("YYYY-MM-DD")}
                disabled={isFuture}
                className={cn(
                  "relative flex h-9 items-center justify-center p-0.5 disabled:cursor-not-allowed",
                  inRange && "bg-neutral-100",
                  isStart && !isSingleDay && "rounded-l-full bg-neutral-100",
                  isEnd && !isSingleDay && "rounded-r-full bg-neutral-100",
                )}
              >
                <span
                  className={cn(
                    "pointer-events-none flex size-8 items-center justify-center rounded-full text-xs font-medium transition-colors",
                    (isStart || isEnd) && "bg-neutral-900 text-white shadow-sm",
                    inRange && !isStart && !isEnd && "text-neutral-900",
                    !inRange &&
                      inCurrentMonth &&
                      !isFuture &&
                      "text-neutral-700 hover:bg-neutral-100",
                    !inCurrentMonth && "text-neutral-300",
                    isFuture && "text-neutral-300",
                    isToday && !isStart && !isEnd && "ring-1 ring-neutral-300 ring-inset",
                  )}
                >
                  {day.date()}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t-[0.6px] border-[#bfbfbf] px-4 py-3">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          disabled={!draftStart || !draftEnd}
          onClick={() => {
            if (!draftStart || !draftEnd) return;
            const [start, end] = normalizeRange(draftStart, draftEnd);
            onApply(start, end);
          }}
        >
          Apply
        </Button>
      </div>
    </div>
  );
}
