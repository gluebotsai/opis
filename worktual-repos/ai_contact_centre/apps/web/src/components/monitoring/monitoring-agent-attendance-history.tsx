import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";

import {
  monitoringApi,
  type AgentAttendanceDay,
} from "@/features/monitoring/api";
import { StatusBadge } from "@/components/monitoring/monitoring-shared";
import { cn } from "@/lib/utils";

const STATE_LABELS: Record<string, string> = {
  ready: "Ready",
  not_ready: "Not Ready",
  break: "Break",
  busy: "Busy",
  away: "Away",
  after_contact_work: "After contact work",
  offline: "Offline",
};

function formatDurationSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours <= 0) return `${minutes}m`;
  if (minutes <= 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function formatDayLabel(dateYmd: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${dateYmd}T12:00:00`));
}

const PRESENCE_STATES = [
  "ready",
  "not_ready",
  "break",
  "busy",
  "away",
  "after_contact_work",
  "offline",
] as const;

function durationLines(day: AgentAttendanceDay): Array<{ label: string; value: string }> {
  const extra = Object.keys(day.durationsSeconds)
    .filter((key) => !PRESENCE_STATES.includes(key as (typeof PRESENCE_STATES)[number]))
    .sort();
  return [...PRESENCE_STATES, ...extra].map((key) => ({
    label: STATE_LABELS[key] ?? key.replaceAll("_", " "),
    value: formatDurationSeconds(day.durationsSeconds[key] ?? 0),
  }));
}

export function MonitoringAgentAttendanceHistory({
  agentId,
  compact = false,
  selectedFrom = "",
  selectedTo = "",
  onSelectedRangeChange,
}: {
  agentId: string;
  compact?: boolean;
  selectedFrom?: string;
  selectedTo?: string;
  onSelectedRangeChange?: (from: string, to: string) => void;
}) {
  const [days, setDays] = useState<AgentAttendanceDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const customRange = Boolean(selectedFrom && selectedTo);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params =
      selectedFrom && selectedTo
        ? selectedFrom === selectedTo
          ? { date: selectedFrom }
          : { from: selectedFrom, to: selectedTo }
        : undefined;

    void monitoringApi
      .getAgentAttendance(agentId, params)
      .then((result) => {
        if (cancelled) return;
        const list = "days" in result ? result.days : [result.day];
        setDays([...list].reverse());
      })
      .catch((reason) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : "Unable to load attendance");
        setDays([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [agentId, selectedFrom, selectedTo]);

  return (
    <div className={cn(!compact && "rounded-xl border-[0.6px] border-[#bfbfbf] p-4")}>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-neutral-600">
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
          Loading attendance…
        </div>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : days.length === 0 ? (
        <p className="text-sm text-neutral-600">No attendance history in this range.</p>
      ) : (
        <div className="space-y-3">
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,16.5rem),1fr))] gap-3">
            {days.map((day) => (
              <li key={day.date} className="min-w-0">
                <button
                  type="button"
                  className="h-full w-full min-w-0 text-left"
                  onClick={() => onSelectedRangeChange?.(day.date, day.date)}
                >
                  <AttendanceDayCard day={day} compact={compact} interactive />
                </button>
              </li>
            ))}
          </ul>
          {customRange ? (
            <button
              type="button"
              className="text-sm font-medium text-neutral-600 underline-offset-2 hover:underline"
              onClick={() => onSelectedRangeChange?.("", "")}
            >
              Back to last 7 days
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function AttendanceDayCard({
  day,
  highlighted = false,
  interactive = false,
  compact = false,
}: {
  day: AgentAttendanceDay;
  highlighted?: boolean;
  interactive?: boolean;
  compact?: boolean;
}) {
  const lines = durationLines(day);
  return (
    <div
      className={cn(
        "flex h-full min-w-0 flex-col rounded-xl border-[0.6px] border-[#bfbfbf] bg-white",
        compact ? "p-3" : "p-4",
        highlighted && "bg-neutral-50",
        interactive && "transition-colors hover:bg-neutral-50",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-sm font-semibold text-neutral-900">{formatDayLabel(day.date)}</p>
        <StatusBadge
          label={day.attendance === "present" ? "Present" : "Absent"}
          tone={day.attendance === "present" ? "success" : "neutral"}
        />
      </div>
      {!day.hasHistory ? (
        <p className="mt-3 text-sm text-neutral-600">No history on this day for this agent.</p>
      ) : lines.length > 0 ? (
        <ul className="mt-3 space-y-2.5">
          {lines.map((line) => {
            const zero = line.value === "0s";
            return (
              <li key={line.label} className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-neutral-600">
                  {line.label}
                </span>
                <span
                  className={cn(
                    "shrink-0 text-sm font-semibold tabular-nums",
                    zero ? "text-neutral-400" : "text-[#171717]",
                  )}
                >
                  {line.value}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
