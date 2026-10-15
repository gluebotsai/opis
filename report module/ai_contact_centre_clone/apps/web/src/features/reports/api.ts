import { ccCoreHttp } from "@/services/http";
import { apiV1 } from "@/config/api-paths";

import type {
  ScheduledReportDraft,
  ScheduledReportPeriod,
  ScheduledReportSchedule,
  ScheduledReportSendMode,
  ScheduledReportWeekday,
} from "@/components/performance/scheduled-reports-ui";

export type ReportIncludedSections = {
  dashboardKpis: boolean;
  agentTable: boolean;
  aiSummary: boolean;
};

export type ScheduledReportRecord = Omit<ScheduledReportDraft, "recipients"> & {
  includedSections: ReportIncludedSections;
  nextRunAt: string | null;
  lastRunAt: string | null;
  updatedAt: string;
};

export type ScheduledReportRun = {
  id: string;
  scheduledReportId: string;
  status: string;
  periodLabel: string;
  sentToEmail: string | null;
  sentFromEmail: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  finishedAt: string | null;
  createdAt: string;
};

export type ReportMailboxStatus = {
  ready: boolean;
  fromEmail: string | null;
  recipientEmail: string | null;
};

function mapSchedule(record: ScheduledReportRecord): ScheduledReportDraft {
  return {
    id: record.id,
    name: record.name,
    period: record.period,
    schedule: record.schedule,
    weekday: record.weekday,
    monthDay: record.monthDay,
    sendMode: record.sendMode,
    sendAt: record.sendAt,
    timeZone: record.timeZone,
    formats: record.formats,
    includedSections: record.includedSections,
    enabled: record.enabled,
    createdAt: record.createdAt,
    lastRunAt: record.lastRunAt,
    nextRunAt: record.nextRunAt,
  };
}

export type ScheduledReportDraftInput = {
  name: string;
  period: ScheduledReportPeriod;
  schedule: ScheduledReportSchedule;
  weekday: ScheduledReportWeekday;
  monthDay: number;
  sendMode: ScheduledReportSendMode;
  sendAt: string;
  timeZone: string;
  formats: { pdf: boolean; csv: boolean };
  includedSections: ReportIncludedSections;
  enabled: boolean;
};

export const reportsApi = {
  async fetchMailboxStatus(): Promise<ReportMailboxStatus> {
    const { data } = await ccCoreHttp.get<ReportMailboxStatus>(apiV1("/reports/mailbox-status"));
    return data;
  },

  async listSchedules(): Promise<{
    schedules: ScheduledReportDraft[];
    recipientEmail: string | null;
  }> {
    const { data } = await ccCoreHttp.get<{
      schedules: ScheduledReportRecord[];
      recipientEmail: string | null;
    }>(apiV1("/reports/schedules"));
    return {
      schedules: data.schedules.map(mapSchedule),
      recipientEmail: data.recipientEmail,
    };
  },

  async createSchedule(input: ScheduledReportDraftInput): Promise<ScheduledReportDraft> {
    const { data } = await ccCoreHttp.post<{ schedule: ScheduledReportRecord }>(
      apiV1("/reports/schedules"),
      input,
    );
    return mapSchedule(data.schedule);
  },

  async updateSchedule(
    id: string,
    input: Partial<ScheduledReportDraftInput>,
  ): Promise<ScheduledReportDraft> {
    const { data } = await ccCoreHttp.patch<{ schedule: ScheduledReportRecord }>(
      apiV1(`/reports/schedules/${id}`),
      input,
    );
    return mapSchedule(data.schedule);
  },

  async deleteSchedule(id: string): Promise<void> {
    await ccCoreHttp.delete(apiV1(`/reports/schedules/${id}`));
  },

  async runNow(
    id: string,
    options?: { dashboardImageBase64?: string },
  ): Promise<{
    runId: string;
    status: "succeeded" | "failed";
    errorCode?: string | null;
    errorMessage?: string | null;
  }> {
    const { data } = await ccCoreHttp.post<{
      runId: string;
      status: "succeeded" | "failed";
      errorCode?: string | null;
      errorMessage?: string | null;
    }>(
      apiV1(`/reports/schedules/${id}/run-now`),
      options?.dashboardImageBase64
        ? { dashboardImageBase64: options.dashboardImageBase64 }
        : undefined,
    );
    return data;
  },

  async listRuns(scheduleId?: string): Promise<ScheduledReportRun[]> {
    const { data } = await ccCoreHttp.get<{ runs: ScheduledReportRun[] }>(
      apiV1("/reports/runs"),
      { params: scheduleId ? { scheduleId } : undefined },
    );
    return data.runs;
  },

  async fetchRunPdf(
    runId: string,
    options?: { inline?: boolean },
  ): Promise<{ blob: Blob; filename: string }> {
    const response = await ccCoreHttp.get<Blob>(apiV1(`/reports/runs/${runId}/pdf`), {
      params: options?.inline ? { disposition: "inline" } : undefined,
      responseType: "blob",
    });
    const disposition = response.headers["content-disposition"];
    const match = disposition?.match(/filename="?([^"]+)"?/i);
    return {
      blob: new Blob([response.data], { type: "application/pdf" }),
      filename: match?.[1] ?? `scheduled-report-${runId}.pdf`,
    };
  },
};

export type AgentReportIncludedSections = {
  performanceKpis: boolean;
  aiSummary: boolean;
};

export type AgentScheduledReportRecord = Omit<ScheduledReportDraft, "includedSections"> & {
  includedSections: AgentReportIncludedSections;
  nextRunAt: string | null;
  lastRunAt: string | null;
  updatedAt: string;
};

export type AgentScheduledReportDraftInput = {
  name: string;
  period: ScheduledReportPeriod;
  schedule: ScheduledReportSchedule;
  weekday: ScheduledReportWeekday;
  monthDay: number;
  sendMode: ScheduledReportSendMode;
  sendAt: string;
  timeZone: string;
  formats: { pdf: boolean; csv: boolean };
  includedSections: AgentReportIncludedSections;
  enabled: boolean;
};

function mapAgentSchedule(record: AgentScheduledReportRecord): ScheduledReportDraft {
  return {
    id: record.id,
    name: record.name,
    period: record.period,
    schedule: record.schedule,
    weekday: record.weekday,
    monthDay: record.monthDay,
    sendMode: record.sendMode,
    sendAt: record.sendAt,
    timeZone: record.timeZone,
    formats: record.formats,
    includedSections: {
      dashboardKpis: record.includedSections.performanceKpis,
      agentTable: false,
      aiSummary: record.includedSections.aiSummary,
    },
    enabled: record.enabled,
    createdAt: record.createdAt,
    lastRunAt: record.lastRunAt,
    nextRunAt: record.nextRunAt,
  };
}

export const agentReportsApi = {
  async fetchMailboxStatus(): Promise<ReportMailboxStatus> {
    const { data } = await ccCoreHttp.get<ReportMailboxStatus>(
      apiV1("/reports/agent/mailbox-status"),
    );
    return data;
  },

  async listSchedules(): Promise<{
    schedules: ScheduledReportDraft[];
    recipientEmail: string | null;
  }> {
    const { data } = await ccCoreHttp.get<{
      schedules: AgentScheduledReportRecord[];
      recipientEmail: string | null;
    }>(apiV1("/reports/agent/schedules"));
    return {
      schedules: data.schedules.map(mapAgentSchedule),
      recipientEmail: data.recipientEmail,
    };
  },

  async createSchedule(input: AgentScheduledReportDraftInput): Promise<ScheduledReportDraft> {
    const { data } = await ccCoreHttp.post<{ schedule: AgentScheduledReportRecord }>(
      apiV1("/reports/agent/schedules"),
      input,
    );
    return mapAgentSchedule(data.schedule);
  },

  async updateSchedule(
    id: string,
    input: Partial<AgentScheduledReportDraftInput>,
  ): Promise<ScheduledReportDraft> {
    const { data } = await ccCoreHttp.patch<{ schedule: AgentScheduledReportRecord }>(
      apiV1(`/reports/agent/schedules/${id}`),
      input,
    );
    return mapAgentSchedule(data.schedule);
  },

  async deleteSchedule(id: string): Promise<void> {
    await ccCoreHttp.delete(apiV1(`/reports/agent/schedules/${id}`));
  },

  async runNow(id: string): Promise<{
    runId: string;
    status: "succeeded" | "failed";
    errorCode?: string | null;
    errorMessage?: string | null;
  }> {
    const { data } = await ccCoreHttp.post<{
      runId: string;
      status: "succeeded" | "failed";
      errorCode?: string | null;
      errorMessage?: string | null;
    }>(apiV1(`/reports/agent/schedules/${id}/run-now`));
    return data;
  },

  async listRuns(scheduleId?: string): Promise<ScheduledReportRun[]> {
    const { data } = await ccCoreHttp.get<{ runs: ScheduledReportRun[] }>(
      apiV1("/reports/agent/runs"),
      { params: scheduleId ? { scheduleId } : undefined },
    );
    return data.runs;
  },

  async fetchRunPdf(
    runId: string,
    options?: { inline?: boolean },
  ): Promise<{ blob: Blob; filename: string }> {
    const response = await ccCoreHttp.get<Blob>(apiV1(`/reports/agent/runs/${runId}/pdf`), {
      params: options?.inline ? { disposition: "inline" } : undefined,
      responseType: "blob",
    });
    const disposition = response.headers["content-disposition"];
    const match = disposition?.match(/filename="?([^"]+)"?/i);
    return {
      blob: new Blob([response.data], { type: "application/pdf" }),
      filename: match?.[1] ?? `scheduled-report-${runId}.pdf`,
    };
  },
};
