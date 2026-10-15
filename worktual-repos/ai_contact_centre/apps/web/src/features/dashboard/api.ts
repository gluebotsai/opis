import { ccCoreHttp } from "@/services/http";
import { apiV1 } from "@/config/api-paths";
import type { PerformancePeriodSelection } from "@/features/performance/api";
import { dashboardExportFilename } from "@/features/dashboard/dashboard-export";
import { filenameFromContentDisposition } from "@/features/performance/performance-export";

export type DashboardOverview = {
  range: "today" | "7d" | "30d" | "custom";
  period: { start: string; end: string };
  agent: { id: string; name: string } | null;
  kpis: {
    handled: number;
    handledChangePercent: number | null;
    resolutionRate: number;
    avgFirstResponseSeconds: number | null;
    avgHandleSeconds: number | null;
    slaRate: number;
    transferred: number;
    totalAssigned: number;
    resolved: number;
    firstResponseCount: number;
    withinSlaCount: number;
  };
  daily: Array<{
    date: string;
    handled: number;
    avgHandleSeconds: number;
  }>;
  channels: Array<{
    label: string;
    value: number;
    channel?: string;
    handler?: "ai" | "agent";
  }>;
  dispositions: Array<{ label: string; value: number }>;
  presenceMix: Array<{
    state: string;
    label: string;
    seconds: number;
    percent: number;
  }>;
  recent: Array<{
    id: string;
    channel: string;
    status: string;
    subject: string | null;
    visitorId: string | null;
    assignedAt: string | null;
    firstResponseAt: string | null;
    endedAt: string | null;
    resolution: string | null;
    disposition: string | null;
  }>;
};

function fileNameFromDisposition(disposition: string | undefined, fallback: string): string {
  return filenameFromContentDisposition(disposition, fallback);
}

function selectionParams(selection: PerformancePeriodSelection, agentId?: string | null) {
  const params =
    selection.mode === "preset"
      ? { range: selection.range }
      : { start: selection.start, end: selection.end };
  return agentId ? { ...params, agentId } : params;
}

export const dashboardApi = {
  async getOverview(
    selection: PerformancePeriodSelection,
    agentId?: string | null,
  ): Promise<DashboardOverview> {
    const { data } = await ccCoreHttp.get<DashboardOverview>(apiV1("/dashboard/overview"), {
      params: selectionParams(selection, agentId),
    });
    return data;
  },

  async fetchReportCsv(
    selection: PerformancePeriodSelection,
    agentId?: string | null,
  ): Promise<{ text: string; filename: string }> {
    const exportedAt = new Date();
    const response = await ccCoreHttp.get<Blob>(apiV1("/dashboard/overview/report"), {
      params: selectionParams(selection, agentId),
      responseType: "blob",
    });
    return {
      text: await response.data.text(),
      filename: fileNameFromDisposition(
        response.headers["content-disposition"],
        dashboardExportFilename(selection, "csv", exportedAt),
      ),
    };
  },

  async downloadReport(
    selection: PerformancePeriodSelection,
    agentId?: string | null,
  ): Promise<void> {
    const { text, filename } = await this.fetchReportCsv(selection, agentId);
    const { downloadCsvText } = await import("@/features/performance/performance-export");
    downloadCsvText(text, filename);
  },
};
