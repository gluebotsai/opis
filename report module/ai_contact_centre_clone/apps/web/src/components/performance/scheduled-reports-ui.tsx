import { App, Popover } from "antd";
import {
  Calendar,
  CalendarClock,
  CalendarDays,
  Clock3,
  Download,
  ListChecks,
  Pause,
  Pencil,
  Play,
  Plus,
  Send,
  Timer,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { NativeSelectSm } from "@/components/ui/native-select";
import { PanelScrollArea } from "@/components/ui/panel-scroll-area";
import { cn } from "@/lib/utils";
import { downloadPdfBlob } from "@/features/performance/performance-export";

import {
  reportsApi,
  agentReportsApi,
  type AgentScheduledReportDraftInput,
  type ScheduledReportDraftInput,
  type ScheduledReportRun,
} from "@/features/reports/api";
import {
  requestDashboardCaptureForSchedule,
} from "@/features/reports/dashboard-capture";

export type ScheduledReportPeriod = "yesterday" | "7d" | "30d";
export type ScheduledReportSchedule =
  | "every_1h"
  | "every_2h"
  | "every_3h"
  | "every_6h"
  | "daily"
  | "weekly"
  | "monthly";
export type ScheduledReportWeekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";
export type ScheduledReportSendMode = "start_of_shift" | "end_of_shift" | "custom_time";

export type ScheduledReportIncludedSections = {
  dashboardKpis: boolean;
  agentTable: boolean;
  aiSummary: boolean;
};

export type ScheduledReportDraft = {
  id: string;
  name: string;
  period: ScheduledReportPeriod;
  /** How often the report is sent (UI label: Schedule). */
  schedule: ScheduledReportSchedule;
  weekday: ScheduledReportWeekday;
  monthDay: number;
  sendMode: ScheduledReportSendMode;
  sendAt: string;
  timeZone: string;
  formats: { pdf: boolean; csv: boolean };
  includedSections: ScheduledReportIncludedSections;
  enabled: boolean;
  createdAt: string;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
};

type ScheduledReportsUiProps = {
  mode: "create" | "manage" | null;
  audience?: "admin" | "agent";
  onClose: () => void;
  onOpenCreate: () => void;
};

const SCHEDULE_OPTIONS: Array<{ value: ScheduledReportSchedule; label: string }> = [
  { value: "every_1h", label: "Every 1 hour" },
  { value: "every_2h", label: "Every 2 hours" },
  { value: "every_3h", label: "Every 3 hours" },
  { value: "every_6h", label: "Every 6 hours" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Every week" },
  { value: "monthly", label: "Every month" },
];

const WEEKDAY_OPTIONS: Array<{ value: ScheduledReportWeekday; label: string }> = [
  { value: "monday", label: "Monday" },
  { value: "tuesday", label: "Tuesday" },
  { value: "wednesday", label: "Wednesday" },
  { value: "thursday", label: "Thursday" },
  { value: "friday", label: "Friday" },
  { value: "saturday", label: "Saturday" },
  { value: "sunday", label: "Sunday" },
];

const SCHEDULE_LABEL: Record<ScheduledReportSchedule, string> = Object.fromEntries(
  SCHEDULE_OPTIONS.map((row) => [row.value, row.label]),
) as Record<ScheduledReportSchedule, string>;

const WEEKDAY_LABEL: Record<ScheduledReportWeekday, string> = Object.fromEntries(
  WEEKDAY_OPTIONS.map((row) => [row.value, row.label]),
) as Record<ScheduledReportWeekday, string>;

function periodForSchedule(schedule: ScheduledReportSchedule): ScheduledReportPeriod {
  if (schedule === "weekly") return "7d";
  if (schedule === "monthly") return "30d";
  return "yesterday";
}

function isSchedule(value: string): value is ScheduledReportSchedule {
  return SCHEDULE_OPTIONS.some((row) => row.value === value);
}

function isWeekday(value: string): value is ScheduledReportWeekday {
  return WEEKDAY_OPTIONS.some((row) => row.value === value);
}

/** Store 1–30; February uses at most 28. */
function normalizeMonthDay(value: unknown, forFebruary = false): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 1;
  const capped = Math.min(30, Math.max(1, Math.round(n)));
  return forFebruary ? Math.min(capped, 28) : capped;
}

function scheduleIcon(schedule: ScheduledReportSchedule) {
  if (schedule === "weekly") return Calendar;
  if (schedule === "monthly") return CalendarDays;
  if (schedule.startsWith("every_")) return Timer;
  return Clock3;
}

function formatSendAtDisplay(sendAt: string): string {
  const { hour, minute } = parseSendAt(sendAt);
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${String(hour12).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function parseSendAt(sendAt: string): { hour: number; minute: number } {
  const [hh = "08", mm = "00"] = (sendAt || "08:00").split(":");
  const hour = Number(hh);
  const minute = Number(mm);
  return {
    hour: Number.isFinite(hour) ? Math.min(23, Math.max(0, hour)) : 8,
    minute: Number.isFinite(minute) ? Math.min(59, Math.max(0, minute)) : 0,
  };
}

function composeSendAt(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function formatHourChip(hour: number): string {
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12} ${suffix}`;
}

const MINUTE_VALUES = Array.from({ length: 60 }, (_, value) => value);

function sendAtTriggerLabel(row: ScheduledReportDraft): string {
  const time = formatSendAtDisplay(row.sendAt || "08:00");
  if (row.schedule === "weekly") {
    return `${WEEKDAY_LABEL[row.weekday]} · ${time}`;
  }
  if (row.schedule === "monthly") {
    return `Day ${row.monthDay} · ${time}`;
  }
  return time;
}

function sendAtPanelTitle(schedule: ScheduledReportSchedule): string {
  if (schedule === "weekly") return "Day & time";
  if (schedule === "monthly") return "Date & time";
  return "Send at";
}

function defaultDraft(
  partial?: Partial<ScheduledReportDraft>,
  audience: "admin" | "agent" = "admin",
): ScheduledReportDraft {
  const schedule = isSchedule(partial?.schedule ?? "") ? partial!.schedule! : "daily";
  return {
    id: partial?.id ?? crypto.randomUUID(),
    name: partial?.name ?? (audience === "agent" ? "My performance report" : "Daily dashboard KPIs"),
    period: partial?.period ?? periodForSchedule(schedule),
    schedule,
    weekday: isWeekday(partial?.weekday ?? "") ? partial!.weekday! : "monday",
    monthDay: normalizeMonthDay(partial?.monthDay ?? 1),
    sendMode: "custom_time",
    sendAt: partial?.sendAt ?? "08:00",
    timeZone: partial?.timeZone ?? "Asia/Kolkata",
    formats: partial?.formats ?? { pdf: true, csv: false },
    includedSections: partial?.includedSections ?? {
      dashboardKpis: true,
      agentTable: audience === "admin",
      aiSummary: true,
    },
    enabled: partial?.enabled ?? true,
    createdAt: partial?.createdAt ?? new Date().toISOString(),
    lastRunAt: partial?.lastRunAt ?? null,
    nextRunAt: partial?.nextRunAt ?? null,
  };
}

function isIntervalSchedule(schedule: ScheduledReportSchedule): boolean {
  return schedule.startsWith("every_");
}

function scheduleSummary(row: ScheduledReportDraft): string {
  const parts = [SCHEDULE_LABEL[row.schedule]];
  if (row.schedule === "weekly") parts.push(WEEKDAY_LABEL[row.weekday]);
  if (row.schedule === "monthly") parts.push(`Day ${row.monthDay}`);
  if (!isIntervalSchedule(row.schedule)) parts.push(formatSendAtDisplay(row.sendAt || "08:00"));
  return parts.join(" · ");
}

function formatNextRunAt(row: ScheduledReportDraft): string | null {
  if (!row.enabled) return "Paused";
  if (!row.nextRunAt) return null;
  try {
    const formatted = new Intl.DateTimeFormat("en-IN", {
      timeZone: row.timeZone || "Asia/Kolkata",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(row.nextRunAt));
    return `Next send ${formatted}`;
  } catch {
    return null;
  }
}

function isSuccessfulRunStatus(status: string): boolean {
  return status === "succeeded" || status === "manual_succeeded";
}

function latestRunLabel(run: ScheduledReportRun): string {
  if (isSuccessfulRunStatus(run.status)) return `Last sent · ${run.periodLabel}`;
  if (run.status === "running") return "Sending…";
  const reason = run.errorMessage?.trim() || run.errorCode || "send failed";
  return `Last send failed · ${reason}`;
}

function buildScheduledReportDownloadFilename(
  scheduleName: string,
  periodLabel: string,
  sendAt: string,
): string {
  const datePart = periodLabel.replace(/\s*\([^)]+\)\s*$/, "").trim();
  const timePart = formatSendAtDisplay(sendAt).replace(":", "-");
  const base = `${scheduleName.trim()} ${datePart} ${timePart}`;
  const safe = base
    .replace(/[<>:"/\\|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return `${safe || "scheduled-report"}.pdf`;
}

type LatestSentRun = {
  runId: string;
  label: string;
  fileName: string | null;
  succeeded: boolean;
};

export function ScheduledReportsUi({
  mode,
  audience = "admin",
  onClose,
  onOpenCreate,
}: ScheduledReportsUiProps) {
  const reportsClient = audience === "agent" ? agentReportsApi : reportsApi;
  const isAgentAudience = audience === "agent";
  const { message } = App.useApp();
  const [schedules, setSchedules] = useState<ScheduledReportDraft[]>([]);
  const [editing, setEditing] = useState<ScheduledReportDraft | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recipientEmail, setRecipientEmail] = useState<string | null>(null);
  const [fromEmail, setFromEmail] = useState<string | null>(null);
  const [mailReady, setMailReady] = useState(false);
  const [latestRuns, setLatestRuns] = useState<Record<string, LatestSentRun>>({});
  const [downloadingRunId, setDownloadingRunId] = useState<string | null>(null);

  const loadManageModal = async () => {
    setLoading(true);
    setError(null);
    try {
      const [mailbox, scheduleResult, runs] = await Promise.all([
        reportsClient.fetchMailboxStatus(),
        reportsClient.listSchedules(),
        reportsClient.listRuns().catch(() => [] as ScheduledReportRun[]),
      ]);
      setRecipientEmail(mailbox.recipientEmail ?? scheduleResult.recipientEmail);
      setFromEmail(mailbox.fromEmail);
      setMailReady(mailbox.ready);
      setSchedules(scheduleResult.schedules);
      const latestBySchedule: Record<string, LatestSentRun> = {};
      for (const run of runs) {
        if (latestBySchedule[run.scheduledReportId]) continue;
        const schedule = scheduleResult.schedules.find((row) => row.id === run.scheduledReportId);
        const succeeded = isSuccessfulRunStatus(run.status);
        latestBySchedule[run.scheduledReportId] = {
          runId: run.id,
          label: latestRunLabel(run),
          succeeded,
          fileName:
            succeeded && schedule
              ? buildScheduledReportDownloadFilename(schedule.name, run.periodLabel, schedule.sendAt)
              : null,
        };
      }
      setLatestRuns(latestBySchedule);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load schedules");
    } finally {
      setLoading(false);
    }
  };

  const markLatestSentRun = (
    scheduleId: string,
    run: { id: string; periodLabel: string },
    scheduleName: string,
    sendAt: string,
  ) => {
    setLatestRuns((current) => ({
      ...current,
      [scheduleId]: {
        runId: run.id,
        label: `Last sent · ${run.periodLabel}`,
        fileName: buildScheduledReportDownloadFilename(scheduleName, run.periodLabel, sendAt),
        succeeded: true,
      },
    }));
  };

  useEffect(() => {
    if (mode) void loadManageModal();
  }, [mode]);

  useEffect(() => {
    if (mode === "create") {
      setEditing(defaultDraft(undefined, audience));
    } else {
      setEditing(null);
      setDeleteId(null);
    }
  }, [mode]);

  const deleteTarget = useMemo(
    () => schedules.find((row) => row.id === deleteId) ?? null,
    [deleteId, schedules],
  );

  if (!mode) return null;

  function toApiInput(draft: ScheduledReportDraft) {
    const base = {
      name: draft.name.trim() || (isAgentAudience ? "My performance report" : "Dashboard report"),
      period: draft.period,
      schedule: draft.schedule,
      weekday: draft.weekday,
      monthDay: draft.monthDay,
      sendMode: draft.sendMode,
      sendAt: draft.sendAt,
      timeZone: draft.timeZone,
      formats: {
        pdf: true,
        csv: draft.formats.csv,
      },
      enabled: draft.enabled,
    };
    if (isAgentAudience) {
      return {
        ...base,
        includedSections: {
          performanceKpis: draft.includedSections.dashboardKpis,
          aiSummary: draft.includedSections.aiSummary,
        },
      };
    }
    return {
      ...base,
      includedSections: draft.includedSections,
    };
  }

  async function upsertSchedule(draft: ScheduledReportDraft) {
    const hasSection = isAgentAudience
      ? draft.includedSections.dashboardKpis || draft.includedSections.aiSummary
      : draft.includedSections.dashboardKpis ||
        draft.includedSections.agentTable ||
        draft.includedSections.aiSummary;
    if (!hasSection) {
      setError("Select at least one report section.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const isExistingSchedule =
        /^\d+$/.test(draft.id) && schedules.some((row) => row.id === draft.id);
      const input = toApiInput(draft);
      if (isExistingSchedule && isAgentAudience) {
        await agentReportsApi.updateSchedule(
          draft.id,
          input as AgentScheduledReportDraftInput,
        );
        message.success("Schedule updated.");
      } else if (isExistingSchedule) {
        await reportsApi.updateSchedule(draft.id, input as ScheduledReportDraftInput);
        message.success("Schedule updated.");
      } else if (isAgentAudience) {
        await agentReportsApi.createSchedule(input as AgentScheduledReportDraftInput);
        message.success("Report schedule saved.");
      } else {
        await reportsApi.createSchedule(input as ScheduledReportDraftInput);
        message.success("Report schedule saved.");
      }

      if (mode === "create") {
        onClose();
      } else {
        setEditing(null);
        try {
          await loadManageModal();
        } catch {
          // Save succeeded; list refresh can fail without blocking the success UX.
        }
      }
    } catch (cause) {
      const saveError = cause instanceof Error ? cause.message : "Failed to save schedule";
      setError(saveError);
      message.error(saveError);
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(id: string) {
    const row = schedules.find((item) => item.id === id);
    if (!row) return;
    await reportsClient.updateSchedule(id, { enabled: !row.enabled });
    await loadManageModal();
  }

  async function confirmDelete() {
    if (!deleteId) return;
    await reportsClient.deleteSchedule(deleteId);
    setDeleteId(null);
    setLatestRuns((current) => {
      const next = { ...current };
      delete next[deleteId];
      return next;
    });
    await loadManageModal();
  }

  async function runNow(id: string) {
    setRunningId(id);
    setError(null);
    try {
      const row = schedules.find((item) => item.id === id);
      const capturedPng =
        !isAgentAudience && row?.includedSections.dashboardKpis
          ? await requestDashboardCaptureForSchedule(row.period, row.timeZone)
          : null;
      const dashboardImageBase64 = capturedPng
        ? capturedPng.replace(/^data:image\/png;base64,/, "")
        : undefined;
      const result = isAgentAudience
        ? await reportsClient.runNow(id)
        : await reportsClient.runNow(
            id,
            dashboardImageBase64 ? { dashboardImageBase64 } : undefined,
          );
      if (result.status === "failed") {
        const sendError =
          result.errorMessage ?? result.errorCode ?? "Report email could not be sent.";
        setError(sendError);
        message.error(sendError);
        return;
      }

      const runs = await reportsClient.listRuns(id);
      const sentRun =
        runs.find((run) => run.id === result.runId) ??
        runs.find((run) => run.status === "succeeded" || run.status === "manual_succeeded");
      if (sentRun && row) {
        markLatestSentRun(id, sentRun, row.name, row.sendAt);
      }
      message.success("Report sent. Your schedule is unchanged.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Send failed");
      message.error(cause instanceof Error ? cause.message : "Send failed");
    } finally {
      setRunningId(null);
    }
  }

  async function downloadSentRun(sentRun: LatestSentRun) {
    if (!sentRun.fileName) return;
    setDownloadingRunId(sentRun.runId);
    try {
      const pdf = await reportsClient.fetchRunPdf(sentRun.runId);
      downloadPdfBlob(pdf.blob, sentRun.fileName);
    } catch (cause) {
      const downloadError =
        cause instanceof Error ? cause.message : "Unable to download report PDF";
      message.error(downloadError);
    } finally {
      setDownloadingRunId(null);
    }
  }

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[70] bg-black/30 backdrop-blur-[1px]"
        role="presentation"
        onClick={onClose}
      />

      {mode === "manage" && !editing ? (
        <div
          className="fixed inset-0 z-[71] grid place-items-center p-4 sm:p-6"
          role="presentation"
          onClick={onClose}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="manage-schedules-title"
            className="flex h-[min(85vh,720px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b-[0.6px] border-[#bfbfbf] px-5 py-4">
              <div>
                <h2 id="manage-schedules-title" className="text-sm font-semibold text-neutral-900">
                  {isAgentAudience ? "Scheduled performance reports" : "Scheduled reports"}
                </h2>
                <p className="mt-0.5 text-sm text-neutral-600">
                  {recipientEmail
                    ? `Reports email to your login address (${recipientEmail}).`
                    : isAgentAudience
                      ? "Reports email to your agent login address."
                      : "Reports email to your admin login address."}
                </p>
                {!mailReady ? (
                  <p className="mt-1 text-xs text-amber-700">
                    Configure a CCaaS email channel with ccaas_handler=internal before reports can
                    send.
                  </p>
                ) : fromEmail ? (
                  <p className="mt-1 text-xs text-neutral-600">From: {fromEmail}</p>
                ) : null}
                {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                className="grid size-8 place-items-center rounded-lg text-neutral-600 hover:bg-neutral-100"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="flex items-center justify-between gap-2 border-b-[0.6px] border-[#bfbfbf] px-5 py-3">
              <p className="text-xs text-neutral-600">
                {schedules.length === 0
                  ? "No schedules yet"
                  : `${schedules.length} schedule${schedules.length === 1 ? "" : "s"}`}
              </p>
              <Button
                variant="primary"
                className="h-[38px]"
                onClick={() => {
                  onOpenCreate();
                }}
              >
                <Plus className="size-3.5" aria-hidden />
                New schedule
              </Button>
            </div>

            <PanelScrollArea className="min-h-0 flex-1 px-5 py-4">
              {loading ? (
                <p className="text-xs text-neutral-600">Loading schedules…</p>
              ) : schedules.length === 0 ? (
                <div className="flex min-h-[360px] flex-1 flex-col items-center justify-center rounded-xl border-[0.6px] border-dashed border-[#bfbfbf] bg-neutral-50 px-6 text-center">
                  <div className="flex size-11 items-center justify-center rounded-xl bg-white shadow-sm">
                    <ListChecks className="size-5 text-neutral-600" aria-hidden />
                  </div>
                  <p className="mt-3 text-sm font-medium text-neutral-800">No scheduled reports</p>
                  <p className="mt-1 max-w-xs text-xs text-neutral-600">
                    Create a schedule to email dashboard KPIs hourly, daily, weekly, or monthly.
                  </p>
                </div>
              ) : (
                <ul className="space-y-3">
                  {schedules.map((row) => {
                    const latestRun = latestRuns[row.id];
                    const nextRunLabel = formatNextRunAt(row);
                    return (
                    <li
                      key={row.id}
                      className="overflow-hidden rounded-xl border-[0.6px] border-[#bfbfbf] bg-white transition-colors hover:border-[#bfbfbf]"
                    >
                      <div className="p-4 pb-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-sm font-semibold text-neutral-900">
                                {row.name}
                              </p>
                              <span
                                className={cn(
                                  "inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset",
                                  row.enabled
                                    ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
                                    : "bg-neutral-100 text-neutral-600 ring-neutral-200",
                                )}
                              >
                                {row.enabled ? "On" : "Paused"}
                              </span>
                            </div>
                            <p className="mt-1 text-[11px] text-neutral-600">{scheduleSummary(row)}</p>
                            {nextRunLabel ? (
                              <p className="mt-0.5 text-[11px] text-neutral-600">{nextRunLabel}</p>
                            ) : null}
                            {latestRun ? (
                              <p
                                className={cn(
                                  "mt-0.5 text-[11px]",
                                  latestRun.succeeded ? "text-neutral-400" : "text-red-600",
                                )}
                              >
                                {latestRun.label}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 border-t-[0.6px] border-[#bfbfbf] px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                        <div className="flex flex-wrap gap-1.5">
                          {latestRun?.succeeded && latestRun.fileName ? (
                            <Button
                              variant="secondary"
                              className="h-7 gap-1 px-2.5 text-[11px]"
                              disabled={downloadingRunId === latestRun.runId}
                              onClick={() => void downloadSentRun(latestRun)}
                            >
                              <Download className="size-3" aria-hidden />
                              {downloadingRunId === latestRun.runId ? "Downloading…" : "Download"}
                            </Button>
                          ) : null}
                          <Button
                            variant="primary"
                            className="h-7 gap-1 px-2.5 text-[11px]"
                            disabled={runningId === row.id}
                            onClick={() => void runNow(row.id)}
                          >
                            <Send className="size-3" aria-hidden />
                            {runningId === row.id ? "Preparing & sending…" : "Send now"}
                          </Button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <Button
                            variant="secondary"
                            className="h-7 gap-1 px-2.5 text-[11px]"
                            onClick={() => setEditing(row)}
                          >
                            <Pencil className="size-3" aria-hidden />
                            Edit
                          </Button>
                          <Button
                            variant="secondary"
                            className="h-7 gap-1 px-2.5 text-[11px]"
                            onClick={() => toggleEnabled(row.id)}
                          >
                            {row.enabled ? (
                              <Pause className="size-3" aria-hidden />
                            ) : (
                              <Play className="size-3" aria-hidden />
                            )}
                            {row.enabled ? "Pause" : "Resume"}
                          </Button>
                          <Button
                            variant="destructive"
                            className="h-7 gap-1 px-2.5 text-[11px]"
                            onClick={() => setDeleteId(row.id)}
                          >
                            <Trash2 className="size-3" aria-hidden />
                            Delete
                          </Button>
                        </div>
                      </div>
                    </li>
                    );
                  })}
                </ul>
              )}
            </PanelScrollArea>
          </div>
        </div>
      ) : null}

      {editing ? (
        <div
          className="fixed inset-0 z-[72] grid place-items-center p-4 sm:p-6"
          role="presentation"
          onClick={() => {
            if (mode === "manage") setEditing(null);
            else onClose();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="schedule-report-form-title"
            className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b-[0.6px] border-[#bfbfbf] px-5 py-4">
              <div className="flex items-start gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-neutral-100">
                  <CalendarClock className="size-5 text-neutral-700" aria-hidden />
                </div>
                <div>
                  <h2
                    id="schedule-report-form-title"
                    className="text-sm font-semibold text-neutral-900"
                  >
                    {schedules.some((row) => row.id === editing.id)
                      ? isAgentAudience
                        ? "Edit performance schedule"
                        : "Edit schedule"
                      : isAgentAudience
                        ? "Schedule performance report"
                        : "Schedule report"}
                  </h2>
                  <p className="mt-0.5 text-sm text-neutral-600">
                    {isAgentAudience
                      ? "PDF report with your performance KPIs and optional AI summary"
                      : "PDF report with selected dashboard sections"}
                  </p>
                  {recipientEmail ? (
                    <p className="mt-0.5 text-sm text-neutral-600">
                      Sent to {recipientEmail}
                      {fromEmail ? ` · From ${fromEmail}` : ""}
                    </p>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => {
                  if (mode === "manage") setEditing(null);
                  else onClose();
                }}
                className="grid size-8 place-items-center rounded-lg text-neutral-600 hover:bg-neutral-100"
              >
                <X className="size-4" />
              </button>
            </div>

            <PanelScrollArea className="min-h-0 flex-1 px-5 py-4">
              <div className="space-y-4">
                <Field label="Name">
                  <input
                    value={editing.name}
                    onChange={(event) =>
                      setEditing({ ...editing, name: event.target.value })
                    }
                    className="h-9 w-full rounded-lg border-[0.6px] border-[#bfbfbf] bg-white px-3 text-sm text-neutral-800 outline-none focus:border-neutral-400"
                    placeholder="Daily dashboard KPIs"
                  />
                </Field>

                <Field label="Schedule">
                  <NativeSelectSm
                    value={editing.schedule}
                    onChange={(event) => {
                      const schedule = event.target.value as ScheduledReportSchedule;
                      setEditing({
                        ...editing,
                        schedule,
                        period: periodForSchedule(schedule),
                        sendMode: "custom_time",
                      });
                    }}
                    className="h-9 w-full bg-white"
                    wrapperClassName="w-full"
                  >
                    {SCHEDULE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </NativeSelectSm>
                </Field>

                <Field label="Include in report">
                  <div className="space-y-2 rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50 px-3 py-2.5">
                    {(
                      isAgentAudience
                        ? ([
                            ["dashboardKpis", "My performance KPIs"],
                            ["aiSummary", "AI performance summary"],
                          ] as const)
                        : ([
                            ["dashboardKpis", "Dashboard KPIs"],
                            ["agentTable", "Agent performance table"],
                            ["aiSummary", "AI executive summary"],
                          ] as const)
                    ).map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2 text-sm text-neutral-800">
                        <input
                          type="checkbox"
                          checked={editing.includedSections[key]}
                          onChange={(event) =>
                            setEditing({
                              ...editing,
                              includedSections: {
                                ...editing.includedSections,
                                [key]: event.target.checked,
                              },
                            })
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </Field>

                <div
                  className={cn(
                    "grid grid-cols-1 gap-3",
                    !isIntervalSchedule(editing.schedule) && "sm:grid-cols-2",
                  )}
                >
                  {!isIntervalSchedule(editing.schedule) ? (
                    <Field label="Send at">
                      <SendAtPicker
                        draft={editing}
                        onChange={(patch) =>
                          setEditing({ ...editing, ...patch, sendMode: "custom_time" })
                        }
                      />
                    </Field>
                  ) : null}
                  <Field label="Timezone">
                    <NativeSelectSm
                      value={editing.timeZone}
                      onChange={(event) =>
                        setEditing({ ...editing, timeZone: event.target.value })
                      }
                      className="h-9 w-full bg-white"
                      wrapperClassName="w-full"
                    >
                      <option value="Asia/Kolkata">Asia/Kolkata</option>
                      <option value="UTC">UTC</option>
                      <option value="America/New_York">America/New_York</option>
                      <option value="Europe/London">Europe/London</option>
                    </NativeSelectSm>
                  </Field>
                </div>

                <div className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-neutral-50 px-3 py-2.5">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-600">
                    Preview
                  </p>
                  <p className="mt-1 text-xs font-medium text-neutral-800">
                    {scheduleSummary(editing)} · {editing.timeZone}
                  </p>
                  <p className="mt-0.5 text-[11px] text-neutral-600">
                    Includes:{" "}
                    {[
                      editing.includedSections.dashboardKpis
                        ? isAgentAudience
                          ? "My performance KPIs"
                          : "Dashboard KPIs"
                        : null,
                      !isAgentAudience && editing.includedSections.agentTable ? "Agent table" : null,
                      editing.includedSections.aiSummary ? "AI summary" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Nothing selected"}
                  </p>
                </div>
              </div>
            </PanelScrollArea>

            <div className="flex items-center justify-end gap-2 border-t-[0.6px] border-[#bfbfbf] px-5 py-4">
              {error ? (
                <p className="mr-auto text-xs text-red-600">{error}</p>
              ) : null}
              <Button
                variant="secondary"
                onClick={() => {
                  if (mode === "manage") setEditing(null);
                  else onClose();
                }}
              >
                Cancel
              </Button>
              <Button variant="primary" disabled={saving} onClick={() => void upsertSchedule(editing)}>
                {saving ? "Saving…" : "Save schedule"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div
          className="fixed inset-0 z-[73] grid place-items-center p-4"
          role="presentation"
          onClick={() => setDeleteId(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-schedule-title"
            className="w-full max-w-sm rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="delete-schedule-title" className="text-sm font-semibold text-neutral-900">
              Delete schedule?
            </h2>
            <p className="mt-1 text-xs leading-5 text-neutral-600">
              Stop sending <span className="font-medium text-neutral-800">{deleteTarget.name}</span>?
              This only removes the schedule — past emails are not deleted.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleteId(null)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={confirmDelete}>
                Delete
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>,
    document.body,
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="block space-y-1.5">
      <span className="text-[11px] font-medium text-neutral-600">{label}</span>
      {children}
    </div>
  );
}

function sendAtPanelWidth(schedule: ScheduledReportSchedule): string {
  if (schedule === "monthly") return "w-[26rem]";
  if (schedule === "weekly") return "w-[24rem]";
  return "w-[22rem]";
}

function SendAtChip({
  active,
  onClick,
  children,
  className,
  title,
  size = "sm",
  shape = "circle",
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
  title?: string;
  size?: "sm" | "md";
  shape?: "circle" | "pill";
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "flex shrink-0 items-center justify-center font-medium transition-colors",
        shape === "pill"
          ? "h-7 min-w-[2.85rem] rounded-full px-1.5 text-[10px]"
          : size === "md"
            ? "size-8 rounded-full text-[11px]"
            : "size-7 rounded-full text-[10px]",
        active
          ? "bg-neutral-900 text-white shadow-sm"
          : "text-neutral-700 hover:bg-neutral-100",
        className,
      )}
    >
      {children}
    </button>
  );
}

function SendAtTimeSection({
  hour,
  minute,
  onHourChange,
  onMinuteChange,
  hourCols = 8,
}: {
  hour: number;
  minute: number;
  onHourChange: (value: number) => void;
  onMinuteChange: (value: number) => void;
  hourCols?: 6 | 8;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_4.5rem] items-start gap-3">
      <div>
        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-neutral-600">
          Hour
        </p>
        <div
          className={cn(
            "grid h-[6.75rem] place-items-center content-start gap-x-1 gap-y-2",
            hourCols === 8 ? "grid-cols-8" : "grid-cols-6",
          )}
        >
          {Array.from({ length: 24 }, (_, value) => (
            <SendAtChip
              key={value}
              active={hour === value}
              onClick={() => onHourChange(value)}
              shape="pill"
            >
              {formatHourChip(value)}
            </SendAtChip>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-center text-[10px] font-medium uppercase tracking-wide text-neutral-600">
          Min
        </p>
        <div className="picker-scroll h-[6.75rem]">
          <div className="flex flex-col gap-1">
            {MINUTE_VALUES.map((value) => (
              <SendAtChip
                key={value}
                active={minute === value}
                onClick={() => onMinuteChange(value)}
                className="mx-auto shrink-0"
              >
                :{String(value).padStart(2, "0")}
              </SendAtChip>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SendAtColumnPicker({
  schedule,
  weekday,
  monthDay,
  hour,
  minute,
  onWeekdayChange,
  onMonthDayChange,
  onHourChange,
  onMinuteChange,
}: {
  schedule: ScheduledReportSchedule;
  weekday: ScheduledReportWeekday;
  monthDay: number;
  hour: number;
  minute: number;
  onWeekdayChange: (value: ScheduledReportWeekday) => void;
  onMonthDayChange: (value: number) => void;
  onHourChange: (value: number) => void;
  onMinuteChange: (value: number) => void;
}) {
  if (schedule === "monthly") {
    return (
      <div>
        <div>
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-neutral-600">
            Date
          </p>
          <div className="grid grid-cols-10 place-items-center gap-1">
            {Array.from({ length: 30 }, (_, index) => {
              const day = index + 1;
              return (
                <SendAtChip
                  key={day}
                  active={monthDay === day}
                  onClick={() => onMonthDayChange(day)}
                >
                  {day}
                </SendAtChip>
              );
            })}
          </div>
        </div>

        <div className="mt-2.5 border-t-[0.6px] border-[#bfbfbf] pt-2.5">
          <SendAtTimeSection
            hour={hour}
            minute={minute}
            onHourChange={onHourChange}
            onMinuteChange={onMinuteChange}
            hourCols={8}
          />
        </div>
      </div>
    );
  }

  if (schedule === "weekly") {
    return (
      <div>
        <div>
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-neutral-600">
            Day
          </p>
          <div className="grid grid-cols-7 place-items-center gap-1">
            {WEEKDAY_OPTIONS.map((option) => (
              <SendAtChip
                key={option.value}
                active={weekday === option.value}
                onClick={() => onWeekdayChange(option.value)}
                size="md"
                title={option.label}
              >
                {option.label.slice(0, 2)}
              </SendAtChip>
            ))}
          </div>
        </div>

        <div className="mt-2.5 border-t-[0.6px] border-[#bfbfbf] pt-2.5">
          <SendAtTimeSection
            hour={hour}
            minute={minute}
            onHourChange={onHourChange}
            onMinuteChange={onMinuteChange}
            hourCols={6}
          />
        </div>
      </div>
    );
  }

  return (
    <SendAtTimeSection
      hour={hour}
      minute={minute}
      onHourChange={onHourChange}
      onMinuteChange={onMinuteChange}
      hourCols={6}
    />
  );
}

function SendAtPicker({
  draft,
  onChange,
}: {
  draft: ScheduledReportDraft;
  onChange: (patch: Partial<ScheduledReportDraft>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draftWeekday, setDraftWeekday] = useState(draft.weekday);
  const [draftMonthDay, setDraftMonthDay] = useState(draft.monthDay);
  const initialTime = parseSendAt(draft.sendAt || "08:00");
  const [draftHour, setDraftHour] = useState(initialTime.hour);
  const [draftMinute, setDraftMinute] = useState(initialTime.minute);
  const Icon = scheduleIcon(draft.schedule);

  useEffect(() => {
    if (!open) return;
    setDraftWeekday(draft.weekday);
    setDraftMonthDay(draft.monthDay);
    const { hour, minute } = parseSendAt(draft.sendAt || "08:00");
    setDraftHour(hour);
    setDraftMinute(minute);
  }, [open, draft.weekday, draft.monthDay, draft.sendAt]);

  const draftSendAt = composeSendAt(draftHour, draftMinute);

  const draftPreview = useMemo(
    () => ({
      ...draft,
      weekday: draftWeekday,
      monthDay: draftMonthDay,
      sendAt: draftSendAt,
    }),
    [draft, draftWeekday, draftMonthDay, draftSendAt],
  );

  function applyDraft() {
    onChange({
      weekday: draftWeekday,
      monthDay: draftMonthDay,
      sendAt: draftSendAt,
    });
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="topLeft"
      arrow={false}
      destroyOnHidden
      overlayClassName="performance-range-popover"
      content={
        <div className={sendAtPanelWidth(draft.schedule)}>
          <div className="border-b-[0.6px] border-[#bfbfbf] px-4 py-2.5">
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-600">
              {sendAtPanelTitle(draft.schedule)}
            </p>
            <p className="mt-0.5 text-sm font-semibold text-neutral-900">
              {sendAtTriggerLabel(draftPreview)}
            </p>
          </div>

          <div className="px-3 py-2.5">
            <SendAtColumnPicker
              schedule={draft.schedule}
              weekday={draftWeekday}
              monthDay={draftMonthDay}
              hour={draftHour}
              minute={draftMinute}
              onWeekdayChange={setDraftWeekday}
              onMonthDayChange={setDraftMonthDay}
              onHourChange={setDraftHour}
              onMinuteChange={setDraftMinute}
            />
            {draft.schedule === "monthly" && draftMonthDay > 28 ? (
              <p className="mt-2 text-[10px] text-neutral-600">
                In February this falls to the 28th.
              </p>
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-2 px-4 py-2.5">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={applyDraft}>
              Apply
            </Button>
          </div>
        </div>
      }
    >
      <button
        type="button"
        className={cn(
          "flex h-9 w-full items-center gap-2 rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50/90 px-2.5 text-left text-xs font-medium text-neutral-800 outline-none transition hover:border-[#bfbfbf]",
          open && "border-neutral-900 bg-white shadow-sm",
        )}
      >
        <Icon className="size-3.5 shrink-0 text-neutral-600" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{sendAtTriggerLabel(draft)}</span>
      </button>
    </Popover>
  );
}
