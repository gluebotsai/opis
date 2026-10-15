const NLP_SERVICE_URL = process.env.NLP_SERVICE_URL ?? "http://localhost:8000";
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY;

export type ExecutiveSummaryRequest = {
  periodLabel: string;
  scheduleLabel: string;
  orgKpis: Record<string, number | null>;
  teamRollup?: Record<string, number>;
  topPerformers?: Array<{ name: string; handled: number; slaRate: number }>;
  needsAttention?: Array<{ name: string; handled: number; slaRate: number; reason: string }>;
  channelMixTop3?: Array<{ channel: string; sharePercent: number }>;
  dispositionMixTop3?: Array<{ disposition: string; sharePercent: number }>;
  includedSections: string[];
};

export type ExecutiveSummaryResponse = {
  summary: string;
  highlights: string[];
  improvementSuggestions?: string[];
};

export type AgentPerformanceSummaryRequest = {
  periodLabel: string;
  scheduleLabel: string;
  agentName: string;
  agentKpis: Record<string, number | null>;
  channelMixTop3?: Array<{ channel: string; sharePercent: number }>;
  dispositionMixTop3?: Array<{ disposition: string; sharePercent: number }>;
  includedSections: string[];
};

export async function fetchExecutiveSummary(
  organizationId: string,
  input: ExecutiveSummaryRequest,
): Promise<ExecutiveSummaryResponse | null> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-tenant-id": organizationId,
    };
    if (INTERNAL_SERVICE_KEY) {
      headers["x-internal-service-key"] = INTERNAL_SERVICE_KEY;
    }

    const response = await fetch(`${NLP_SERVICE_URL}/internal/v1/reports/executive-summary`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
    if (!response.ok) return null;
    return (await response.json()) as ExecutiveSummaryResponse;
  } catch {
    return null;
  }
}

export async function fetchAgentPerformanceSummary(
  organizationId: string,
  input: AgentPerformanceSummaryRequest,
): Promise<ExecutiveSummaryResponse | null> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-tenant-id": organizationId,
    };
    if (INTERNAL_SERVICE_KEY) {
      headers["x-internal-service-key"] = INTERNAL_SERVICE_KEY;
    }

    const response = await fetch(
      `${NLP_SERVICE_URL}/internal/v1/reports/agent-performance-summary`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(input),
      },
    );
    if (!response.ok) return null;
    return (await response.json()) as ExecutiveSummaryResponse;
  } catch {
    return null;
  }
}

const CHAT_SERVICE_URL = process.env.CHAT_SERVICE_URL ?? "http://localhost:3002";

export type SendReportEmailInput = {
  organizationId: string;
  channelConfigId: string;
  fromEmail: string;
  fromName?: string | null;
  replyTo?: string | null;
  toEmail: string;
  subject: string;
  pdfBuffer: Buffer;
  fileName: string;
};

export async function sendReportEmail(
  input: SendReportEmailInput,
): Promise<{ ok: true; fromEmail: string } | { ok: false; error: string }> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-tenant-id": input.organizationId,
    };
    if (INTERNAL_SERVICE_KEY) {
      headers["x-internal-service-key"] = INTERNAL_SERVICE_KEY;
    }

    const response = await fetch(`${CHAT_SERVICE_URL}/internal/v1/email/send-report`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        organizationId: input.organizationId,
        channelConfigId: input.channelConfigId,
        fromEmail: input.fromEmail,
        fromName: input.fromName,
        replyTo: input.replyTo,
        toEmail: input.toEmail,
        subject: input.subject,
        fileName: input.fileName,
        pdfBase64: input.pdfBuffer.toString("base64"),
        body:
          "Your scheduled Worktual performance report is attached as a PDF. " +
          "This message was generated automatically.",
      }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
      return { ok: false, error: body.message ?? body.error ?? `HTTP ${response.status}` };
    }

    const body = (await response.json()) as { fromEmail?: string };
    return { ok: true, fromEmail: body.fromEmail ?? input.fromEmail };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Email send failed" };
  }
}
