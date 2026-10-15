import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;

type PerformanceDayCalendarProps = {
  value: Dayjs | null;
  onApply: (day: Dayjs) => void;
  onCancel: () => void;
};

function formatDateLabel(value: Dayjs) {
  return value.format("MMM D, YYYY");
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

/** Single-day picker matching dashboard Custom range calendar theme. */
export function PerformanceDayCalendar({
  value,
  onApply,
  onCancel,
}: PerformanceDayCalendarProps) {
  const [viewMonth, setViewMonth] = useState(() => (value ?? dayjs()).startOf("month"));
  const [draftDay, setDraftDay] = useState<Dayjs | null>(value);

  useEffect(() => {
    setDraftDay(value);
    setViewMonth((value ?? dayjs()).startOf("month"));
  }, [value?.valueOf()]);

  const days = useMemo(() => getMonthGrid(viewMonth), [viewMonth]);
  const today = dayjs().startOf("day");

  return (
    <div className="w-[19rem]">
      <div className="border-b-[0.6px] border-[#bfbfbf] px-4 py-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-400">
          Select day
        </p>
        <p className="mt-1 text-sm font-semibold text-neutral-900">
          {draftDay ? formatDateLabel(draftDay) : "Pick a date"}
        </p>
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

        <div className="grid grid-cols-7 gap-y-1">
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
            const isSelected = Boolean(draftDay && day.isSame(draftDay, "day"));

            return (
              <button
                key={day.format("YYYY-MM-DD")}
                type="button"
                disabled={isFuture}
                onClick={() => {
                  if (isFuture) return;
                  setDraftDay(day);
                }}
                className="relative flex h-9 items-center justify-center p-0.5 disabled:cursor-not-allowed"
              >
                <span
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full text-xs font-medium transition-colors",
                    isSelected && "bg-neutral-900 text-white shadow-sm",
                    !isSelected &&
                      inCurrentMonth &&
                      !isFuture &&
                      "text-neutral-700 hover:bg-neutral-100",
                    !inCurrentMonth && "text-neutral-300",
                    isFuture && "text-neutral-300",
                    isToday && !isSelected && "ring-1 ring-neutral-300 ring-inset",
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
          disabled={!draftDay}
          onClick={() => {
            if (!draftDay) return;
            onApply(draftDay);
          }}
        >
          Apply
        </Button>
      </div>
    </div>
  );
}
