import { humanizeAgentReason } from "@/lib/agent-run-display";
import { Check, Loader2, Minus, X } from "lucide-react";

export type AgentStepStatus = "started" | "ok" | "failed" | "skipped";

export type AgentStepItem = {
  step: string;
  label: string;
  status: AgentStepStatus;
  detail?: unknown;
  errorReason?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
};

/**
 * Fixed pipeline order per agent so the timeline never depends on write
 * timing — steps not yet reached render as pending/grayed placeholders.
 */
export const LEAD_ENRICHMENT_STEP_ORDER: Array<{ step: string; label: string }> = [
  { step: "load_context", label: "Loading contact & company context" },
  { step: "normalize", label: "Checking what needs to be filled" },
  { step: "search_ddg", label: "Searching the web for the official site" },
  {
    step: "rank_candidates",
    label: "Identifying the company (Wikidata / web ranking)",
  },
  { step: "fetch_pages", label: "Reading the company website" },
  {
    step: "extract_bs4",
    label: "Extracting firmographic details from the page",
  },
  {
    step: "validate",
    label: "Validating extracted fields against company identity",
  },
  {
    step: "map_fields_via_llm",
    label: "Asking the AI to fill remaining fields",
  },
  { step: "persist", label: "Saving enrichment results" },
];

export const LEAD_SCORING_STEP_ORDER: Array<{ step: string; label: string }> = [
  { step: "load_context", label: "Loading contact & company context" },
  { step: "compute", label: "Scoring fit & intent" },
];

export const LEAD_NURTURE_STEP_ORDER: Array<{ step: string; label: string }> = [
  { step: "load_context", label: "Loading contact context" },
  { step: "decide", label: "Deciding whether to nurture, wait, or skip" },
  { step: "compose", label: "Composing re-engagement email" },
  { step: "persist", label: "Saving nurture decision" },
];

export const LEAD_LIFECYCLE_STEP_ORDER: Array<{ step: string; label: string }> = [
  { step: "load_context", label: "Loading contact & deal context" },
  { step: "decide", label: "Deciding the next lifecycle move" },
  { step: "persist", label: "Applying the lifecycle move" },
];

export const EMAIL_AUTO_REPLY_STEP_ORDER: Array<{ step: string; label: string }> = [
  { step: "load_context", label: "Loading the inbound message & thread context" },
  { step: "classify", label: "Classifying sensitivity & intent" },
  { step: "compose_or_escalate", label: "Composing a reply or escalating" },
  { step: "persist", label: "Saving the auto-reply outcome" },
];

export const LEAD_SUMMARY_STEP_ORDER: Array<{ step: string; label: string }> = [
  { step: "load_context", label: "Loading contact, score & activity context" },
  { step: "generate", label: "Writing the executive summary" },
  { step: "persist", label: "Saving the summary to the contact" },
];

export const SALES_ASSIGNMENT_STEP_ORDER: Array<{ step: string; label: string }> = [
  { step: "load_candidates", label: "Loading candidate sales reps" },
  { step: "resolve", label: "Choosing the best-fit owner" },
];

export const MEETING_BRIEF_STEP_ORDER: Array<{ step: string; label: string }> = [
  { step: "normalize", label: "Loading meeting & lead context" },
  { step: "compose", label: "Composing the brief/reminder email" },
];

export const MEETING_MISS_ESCALATION_STEP_ORDER: Array<{ step: string; label: string }> = [
  { step: "analyze", label: "Analyzing meeting-miss importance & evidence" },
  { step: "compose_email", label: "Composing the admin escalation email" },
];

export const MEETING_MOM_STEP_ORDER: Array<{ step: string; label: string }> = [
  { step: "normalize", label: "Preparing the transcript" },
  { step: "extract", label: "Extracting minutes of meeting" },
];

export const POST_MEETING_PROCESS_STEP_ORDER: Array<{ step: string; label: string }> = [
  { step: "normalize", label: "Preparing the transcript" },
  { step: "analyze", label: "Analyzing follow-ups & next steps" },
];

export const PIPELINE_FORECAST_STEP_ORDER: Array<{ step: string; label: string }> = [
  { step: "load_context", label: "Loading deal, quote & activity context" },
  { step: "decide", label: "Judging forecast realism" },
  { step: "persist", label: "Saving forecast category & confidence" },
];

export const SALES_COACH_STEP_ORDER: Array<{ step: string; label: string }> = [
  { step: "normalize", label: "Preparing the transcript" },
  { step: "assess", label: "Assessing discovery, objections & methodology" },
];

export const COMPLIANCE_PRIVACY_STEP_ORDER: Array<{ step: string; label: string }> = [
  { step: "normalize", label: "Preparing the email for review" },
  { step: "classify", label: "Classifying the privacy request" },
];

export const INVOICE_ESCALATION_STEP_ORDER: Array<{ step: string; label: string }> = [
  { step: "load_context", label: "Loading invoice, deal & payment history" },
  { step: "decide", label: "Judging collections risk" },
  { step: "persist", label: "Saving severity & drafting reminder" },
];

export const EXPANSION_MATCHER_STEP_ORDER: Array<{ step: string; label: string }> = [
  { step: "load_context", label: "Loading account deal history & catalog" },
  { step: "decide", label: "Judging expansion signal" },
  { step: "persist", label: "Saving signal & drafting outreach" },
];

/** Lookup so run pages can stay agent-agnostic instead of switching on agentId. */
export const AGENT_STEP_ORDERS: Record<string, Array<{ step: string; label: string }>> = {
  lead_enrichment: LEAD_ENRICHMENT_STEP_ORDER,
  lead_scoring: LEAD_SCORING_STEP_ORDER,
  lead_nurture: LEAD_NURTURE_STEP_ORDER,
  lead_lifecycle: LEAD_LIFECYCLE_STEP_ORDER,
  email_auto_reply: EMAIL_AUTO_REPLY_STEP_ORDER,
  lead_summary: LEAD_SUMMARY_STEP_ORDER,
  sales_assignment: SALES_ASSIGNMENT_STEP_ORDER,
  meeting_brief: MEETING_BRIEF_STEP_ORDER,
  // Same LangGraph module as meeting_brief; only the emitted `agent` string
  // (and step labels — "reminder" vs "brief") differ. Timeline steps line up.
  meeting_reminder: MEETING_BRIEF_STEP_ORDER,
  meeting_miss_escalation: MEETING_MISS_ESCALATION_STEP_ORDER,
  meeting_mom: MEETING_MOM_STEP_ORDER,
  post_meeting_process: POST_MEETING_PROCESS_STEP_ORDER,
  pipeline_forecast: PIPELINE_FORECAST_STEP_ORDER,
  sales_coach: SALES_COACH_STEP_ORDER,
  compliance_privacy: COMPLIANCE_PRIVACY_STEP_ORDER,
  invoice_escalation: INVOICE_ESCALATION_STEP_ORDER,
  expansion_matcher: EXPANSION_MATCHER_STEP_ORDER,
};

function durationLabel(startedAt?: string | null, endedAt?: string | null): string | null {
  if (!startedAt || !endedAt) return null;
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Short, curated chips from a step's `detail` — never a raw JSON dump. */
function DetailChips({ detail }: { detail: unknown }) {
  if (!detail || typeof detail !== "object") return null;
  const entries = Object.entries(detail as Record<string, unknown>).filter(
    ([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0),
  );
  if (entries.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {entries.map(([key, value]) => (
        <span
          key={key}
          className="inline-flex items-center rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] text-text-secondary"
        >
          {formatDetailValue(key, value)}
        </span>
      ))}
    </div>
  );
}

function formatDetailValue(key: string, value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return `${key}: none`;
    const shown = value.slice(0, 4).join(", ");
    return value.length > 4 ? `${key}: ${shown}, +${value.length - 4} more` : `${key}: ${shown}`;
  }
  if (typeof value === "boolean") return value ? key : `${key}: no`;
  return `${key}: ${String(value)}`;
}

function StepIcon({ status }: { status: AgentStepStatus | "pending" }) {
  if (status === "ok") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[#e8f8ef] text-text-success">
        <Check className="size-3" strokeWidth={3} />
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[#fdecea] text-text-danger">
        <X className="size-3" strokeWidth={3} />
      </span>
    );
  }
  if (status === "skipped") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-text-caption">
        <Minus className="size-3" strokeWidth={3} />
      </span>
    );
  }
  if (status === "started") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[#fff8e8] text-text-warning">
        <Loader2 className="size-3 animate-spin" strokeWidth={3} />
      </span>
    );
  }
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-dashed border-border-default" />
  );
}

/**
 * Curated step-by-step trace for a proactive agent run — a timeline, not a
 * log dump. Steps not yet present in `steps` render as pending placeholders
 * in the fixed pipeline order.
 */
export function AgentStepTimeline({
  steps,
  order = LEAD_ENRICHMENT_STEP_ORDER,
  emptyMessage = "No activity recorded for this run yet.",
}: {
  steps: AgentStepItem[];
  order?: Array<{ step: string; label: string }>;
  emptyMessage?: string;
}) {
  const byStep = new Map(steps.map((s) => [s.step, s]));

  if (steps.length === 0) {
    return <p className="text-sm text-text-secondary">{emptyMessage}</p>;
  }

  return (
    <ol className="space-y-3">
      {order.map(({ step, label }) => {
        const item = byStep.get(step);
        const status: AgentStepStatus | "pending" = item?.status ?? "pending";
        const displayLabel = item?.label || label;
        const duration = item ? durationLabel(item.startedAt, item.endedAt) : null;
        return (
          <li key={step} className="flex items-start gap-2.5">
            <StepIcon status={status} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`text-sm ${
                    status === "pending"
                      ? "text-text-caption"
                      : "font-medium text-text-primary"
                  }`}
                >
                  {displayLabel}
                </span>
                {duration ? (
                  <span className="shrink-0 text-[11px] text-text-caption">{duration}</span>
                ) : null}
              </div>
              {item?.status === "failed" && item.errorReason ? (
                <p className="mt-0.5 text-xs text-text-danger">
                  {humanizeAgentReason(item.errorReason)}
                </p>
              ) : null}
              {item?.status === "skipped" && item.errorReason ? (
                <p className="mt-0.5 text-xs text-text-caption">
                  {humanizeAgentReason(item.errorReason)}
                </p>
              ) : null}
              {item ? <DetailChips detail={item.detail} /> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
