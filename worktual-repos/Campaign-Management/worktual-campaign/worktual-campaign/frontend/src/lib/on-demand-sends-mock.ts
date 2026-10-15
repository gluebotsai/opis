/**
 * On-demand send UI types + formatters. Live data comes from /api/campaigns/on-demand.
 */

import { formatMonitoringDateTime } from "@/lib/campaign-monitoring-summary";

export type OnDemandRunStatus =
  | "pending_analysis"
  | "ready"
  | "scheduled"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type OnDemandStepStatus = "done" | "active" | "pending" | "failed" | "skipped";

export type OnDemandChecklistStep = {
  id: string;
  label: string;
  detail?: string;
  status: OnDemandStepStatus;
  at: string | null;
};

export type OnDemandRun = {
  id: string;
  title: string;
  source: "agent" | "spoke" | "internal" | "hub";
  status: OnDemandRunStatus;
  channel: "email" | "whatsapp" | "push" | "multi";
  audienceCount: number;
  sent: number;
  failed: number;
  pending: number;
  opens?: number;
  clicks?: number;
  /** null when no open-tracked channel delivery. */
  openRate?: number | null;
  /** null when no click-tracked channel delivery. */
  clickRate?: number | null;
  channelMetrics?: Array<{
    channel: string;
    sent: number;
    delivered: number;
    opens: number;
    clicks: number;
    openRate: number | null;
    clickRate: number | null;
  }>;
  scheduledAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Short content preview for list/detail */
  contentPreview: string;
  /** Optional contact hint shown in UI */
  audienceHint: string;
  /** Exact inbound request (chat / spoke payload) */
  requestText: string;
  /** Organized fields for the request summary UI */
  requestSummary: Array<{ label: string; value: string }>;
  /** What the agent understood */
  agentThought: string[];
  /** Template library name, or null if inline */
  templateName: string | null;
  templateId: string | null;
  subject: string;
  bodyPreview: string;
  /** Request → agent → plan → send checklist */
  checklist: OnDemandChecklistStep[];
};


export function onDemandStatusLabel(status: OnDemandRunStatus): string {
  switch (status) {
    case "pending_analysis":
      return "Analyzing";
    case "ready":
      return "Ready";
    case "scheduled":
      return "Scheduled";
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

export function onDemandStatusClass(status: OnDemandRunStatus): string {
  switch (status) {
    case "completed":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "running":
      return "border-sky-200 bg-sky-50 text-sky-900";
    case "scheduled":
    case "ready":
      return "border-amber-200 bg-amber-50 text-amber-900";
    case "failed":
    case "cancelled":
      return "border-red-200 bg-red-50 text-red-800";
    default:
      return "border-neutral-200 bg-neutral-50 text-neutral-700";
  }
}

export function onDemandSourceLabel(
  source: OnDemandRun["source"] | string,
): string {
  if (source === "spoke") return "Spoke";
  if (source === "hub") return "Hub";
  if (source === "internal") return "Internal";
  return "Agent";
}

/** Strip trailing ISO timestamps from auto-generated run titles. */
export function formatOnDemandDisplayTitle(title: string): string {
  const t = String(title || "").trim();
  if (!t) return "On-demand send";
  const isoSuffix = /\s(\d{4}-\d{2}-\d{2}T[^\s]+)$/;
  const m = t.match(isoSuffix);
  if (!m) return t;
  const base = t.slice(0, m.index).trim();
  const when = formatMonitoringDateTime(m[1]);
  return base ? `${base} · ${when}` : when;
}

/** Same meta rhythm as Live/Scheduled/Past monitoring rows. */
export function formatOnDemandListMeta(run: OnDemandRun): string {
  const when = formatMonitoringDateTime(run.createdAt || run.updatedAt);
  return `Launched ${when} · ${onDemandStatusLabel(run.status)}`;
}

/** Delivery/audience line under the title — mirrors monitoring summary. */
export function formatOnDemandListSummary(run: OnDemandRun): string {
  const bits = [
    onDemandSourceLabel(run.source),
    String(run.channel || "email"),
    `${(Number(run.audienceCount) || 0).toLocaleString()} contacts`,
    `${(Number(run.sent) || 0).toLocaleString()} sent`,
  ];
  if ((Number(run.failed) || 0) > 0) {
    bits.push(`${(Number(run.failed) || 0).toLocaleString()} failed`);
  }
  if ((Number(run.pending) || 0) > 0) {
    bits.push(`${(Number(run.pending) || 0).toLocaleString()} pending`);
  }
  const hint = String(run.audienceHint || "").trim();
  if (hint) bits.push(hint);
  return bits.join(" · ");
}

/** One-line Hub activity for the dashboard card: request + outcome (no run title). */
export function formatHubOnDemandBrief(run: OnDemandRun): string {
  const raw = String(run.requestText || run.bodyPreview || "").replace(/\s+/g, " ").trim();
  const request =
    raw.length > 0
      ? raw.length > 110
        ? `${raw.slice(0, 107).trim()}…`
        : raw
      : "Hub triggered an on-demand send.";

  let outcome: string;
  if (run.status === "failed" || run.status === "cancelled") {
    outcome = "could not complete.";
  } else if ((Number(run.failed) || 0) > 0 && (Number(run.sent) || 0) === 0) {
    outcome = "send failed.";
  } else if ((Number(run.sent) || 0) > 0 || run.status === "completed") {
    const sent = Number(run.sent) || 0;
    outcome =
      sent > 0
        ? `sent (${sent.toLocaleString()} delivered).`
        : "completed.";
  } else if ((Number(run.pending) || 0) > 0 || run.status === "running" || run.status === "scheduled") {
    outcome = "queued / in progress.";
  } else {
    outcome = "no delivery yet.";
  }

  return `${request} Outcome: ${outcome}`;
}

export function onDemandStepStatusClass(status: OnDemandStepStatus): string {
  switch (status) {
    case "done":
      return "border-emerald-500 bg-emerald-500 text-white";
    case "active":
      return "border-sky-500 bg-sky-500 text-white";
    case "failed":
      return "border-red-500 bg-red-500 text-white";
    case "skipped":
      return "border-neutral-300 bg-neutral-100 text-neutral-500";
    default:
      return "border-neutral-300 bg-white text-neutral-400";
  }
}

/** Map API on-demand run → UI model (keeps mock pages typed). */
export function mapApiRunToOnDemandRun(api: {
  id: string;
  title: string;
  status: string;
  source?: string;
  channels?: string[];
  audienceCount?: number;
  audienceHint?: string;
  sent?: number;
  failed?: number;
  pending?: number;
  opens?: number;
  clicks?: number;
  openRate?: number | null;
  clickRate?: number | null;
  channelMetrics?: OnDemandRun["channelMetrics"];
  requestText?: string;
  subject?: string;
  bodyPreview?: string;
  createdAt?: string;
  updatedAt?: string;
  scheduledAt?: string | null;
  checklist?: OnDemandChecklistStep[];
  agentThought?: string[];
}): OnDemandRun {
  const statusRaw = String(api.status || "").toLowerCase();
  let status: OnDemandRunStatus = "ready";
  if (statusRaw === "live") status = "running";
  else if (statusRaw === "scheduled") status = "scheduled";
  else if (statusRaw === "completed") status = "completed";
  else if (statusRaw === "cancelled") status = "cancelled";
  else if (statusRaw === "failed") status = "failed";
  else if (statusRaw === "draft") status = "pending_analysis";

  const channels = (api.channels || []).map((c) => String(c).toLowerCase());
  let channel: OnDemandRun["channel"] = "email";
  if (channels.length > 1) channel = "multi";
  else if (channels[0] === "whatsapp") channel = "whatsapp";
  else if (channels[0] === "push" || channels[0] === "web") channel = "push";

  const requestText = String(api.requestText || "");
  const subject = String(api.subject || "").trim() || "On-demand message";
  const bodyPreview = String(api.bodyPreview || requestText || "");
  const audienceCount = Number(api.audienceCount) || 0;
  const nowIso = new Date().toISOString();
  const sourceRaw = String(api.source || "").toLowerCase();
  const source: OnDemandRun["source"] =
    sourceRaw === "spoke" ||
    sourceRaw === "hub" ||
    sourceRaw === "internal"
      ? sourceRaw
      : "agent";

  return {
    id: String(api.id || ""),
    title: String(api.title || "On-demand send"),
    source,
    status,
    channel,
    audienceCount,
    sent: Number(api.sent) || 0,
    failed: Number(api.failed) || 0,
    pending: Number(api.pending) || 0,
    opens: Number(api.opens) || 0,
    clicks: Number(api.clicks) || 0,
    openRate: api.openRate ?? null,
    clickRate: api.clickRate ?? null,
    channelMetrics: Array.isArray(api.channelMetrics)
      ? api.channelMetrics
      : [],
    scheduledAt: api.scheduledAt ?? null,
    createdAt: String(api.createdAt || nowIso),
    updatedAt: String(api.updatedAt || nowIso),
    contentPreview: subject
      ? `Subject: ${subject}`
      : requestText.slice(0, 80),
    audienceHint: String(api.audienceHint || ""),
    requestText,
    requestSummary: [
      {
        label: "Source",
        value: onDemandSourceLabel(source),
      },
      { label: "Channels", value: channels.join(", ") || "—" },
      {
        label: "Audience",
        value: String(api.audienceHint || audienceCount || "—"),
      },
      { label: "When", value: "Now" },
    ],
    agentThought:
      Array.isArray(api.agentThought) && api.agentThought.length
        ? api.agentThought.map((t) => String(t)).filter(Boolean)
        : ["Launched via on-demand API"],
    templateName: null,
    templateId: null,
    subject,
    bodyPreview,
    checklist: Array.isArray(api.checklist)
      ? api.checklist.filter(
          (s): s is OnDemandChecklistStep =>
            Boolean(s && typeof s === "object" && (s as OnDemandChecklistStep).id),
        )
      : [],
  };
}
