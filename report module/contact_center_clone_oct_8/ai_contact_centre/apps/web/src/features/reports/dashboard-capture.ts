import type { PerformancePeriodSelection } from "@/features/performance/api";

type ScheduledReportPeriod = "yesterday" | "7d" | "30d";

export const SCHEDULED_REPORT_CAPTURE_REQUEST = "worktual:scheduled-report-capture-request";
export const SCHEDULED_REPORT_CAPTURE_RESPONSE = "worktual:scheduled-report-capture-response";
export const DASHBOARD_SET_SELECTION_EVENT = "worktual:dashboard-set-selection";

export function scheduledReportPeriodToSelection(
  period: ScheduledReportPeriod,
  timeZone: string,
): PerformancePeriodSelection {
  if (period === "7d") return { mode: "preset", range: "7d" };
  if (period === "30d") return { mode: "preset", range: "30d" };

  const yesterday = new Date(Date.now() - 86_400_000);
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(yesterday);
  return { mode: "custom", start: ymd, end: ymd };
}

export function requestDashboardCaptureForSchedule(
  period: ScheduledReportPeriod,
  timeZone: string,
  timeoutMs = 20_000,
): Promise<string | null> {
  return new Promise((resolve) => {
    const requestId = crypto.randomUUID();

    function onResponse(event: Event) {
      const detail = (event as CustomEvent<{ requestId: string; png?: string | null }>).detail;
      if (detail.requestId !== requestId) return;
      window.clearTimeout(timer);
      window.removeEventListener(SCHEDULED_REPORT_CAPTURE_RESPONSE, onResponse);
      resolve(detail.png ?? null);
    }

    const timer = window.setTimeout(() => {
      window.removeEventListener(SCHEDULED_REPORT_CAPTURE_RESPONSE, onResponse);
      resolve(null);
    }, timeoutMs);

    window.addEventListener(SCHEDULED_REPORT_CAPTURE_RESPONSE, onResponse);
    window.dispatchEvent(
      new CustomEvent(SCHEDULED_REPORT_CAPTURE_REQUEST, {
        detail: { requestId, period, timeZone },
      }),
    );
  });
}
