import { ccCoreHttp } from "@/services/http";
import { apiV1 } from "@/config/api-paths";
import {
  filenameFromContentDisposition,
  performanceExportFilename,
} from "@/features/performance/performance-export";

export type PerformanceRange = "today" | "7d" | "30d";

export type PerformancePeriodSelection =
  | { mode: "preset"; range: PerformanceRange }
  | { mode: "custom"; start: string; end: string };

export type PerformanceOverview = {
  range: PerformanceRange | "custom";
  period: { start: string; end: string };
  kpis: {
    handled: number;
    handledChangePercent: number | null;
    resolutionRate: number;
    avgFirstResponseSeconds: number | null;
    avgHandleSeconds: number | null;
    slaRate: number;
    transferred: number;
    firstResponseCount: number;
    withinSlaCount: number;
  };
  daily: Array<{
    date: string;
    handled: number;
    avgHandleSeconds: number;
  }>;
  channels: Array<{ label: string; value: number }>;
  dispositions: Array<{ label: string; value: number }>;
  agentSentiment: Array<{ label: string; value: number }>;
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

function selectionParams(selection: PerformancePeriodSelection) {
  return selection.mode === "preset"
    ? { range: selection.range }
    : { start: selection.start, end: selection.end };
}

export const performanceApi = {
  async getOverview(selection: PerformancePeriodSelection): Promise<PerformanceOverview> {
    const { data } = await ccCoreHttp.get<PerformanceOverview>(apiV1("/performance/me"), {
      params: selectionParams(selection),
    });
    return data;
  },

  async fetchReportCsv(
    selection: PerformancePeriodSelection,
  ): Promise<{ text: string; filename: string }> {
    const exportedAt = new Date();
    const response = await ccCoreHttp.get<Blob>(apiV1("/performance/me/report"), {
      params: selectionParams(selection),
      responseType: "blob",
    });
    return {
      text: await response.data.text(),
      filename: fileNameFromDisposition(
        response.headers["content-disposition"],
        performanceExportFilename(selection, "csv", exportedAt),
      ),
    };
  },

  async downloadReport(selection: PerformancePeriodSelection): Promise<void> {
    const { text, filename } = await this.fetchReportCsv(selection);
    const { downloadCsvText } = await import("@/features/performance/performance-export");
    downloadCsvText(text, filename);
  },
};
