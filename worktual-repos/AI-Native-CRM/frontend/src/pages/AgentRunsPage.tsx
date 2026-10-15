import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import { Bot, ExternalLink, ListTree, Loader2 } from "lucide-react";
import { BackLink } from "@/components/ui/BackLink";
import {
  AGENT_RANGE_OPTIONS,
  parseAgentRange,
  type AgentRangeId,
} from "@/lib/agents-dashboard";
import {
  fetchAgentRunsPage,
  isAgentRunId,
  type AgentRunId,
  type AgentRunSummary,
} from "@/services/agents";
import { canViewAgents, normalizeRole } from "@/lib/rbac";
import { useAppSelector } from "@/store";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";
import {
  agentReasonTextClass,
  humanizeAgentReason,
  humanizeAgentStatus,
} from "@/lib/agent-run-display";
import {
  chipClass,
  PAGE_H1_CLASS,
  TONE_DANGER,
  TONE_INFO,
  TONE_MUTED,
  TONE_SUCCESS,
  TONE_WARNING,
} from "@/lib/ui-tones";

const PAGE_SIZE = 25;

/** Statuses for agents with no job table — derived from `agent_step_events`. */
const EVENT_BACKED_STATUSES = ["failed", "skipped", "running", "ok"];

const AGENT_RUN_LABELS: Record<AgentRunId, { title: string; description: string }> = {
  lead_enrichment: {
    title: "Lead enrichment — recent runs",
    description:
      "Every enrichment run with its curated, step-by-step trace. Select a run to see exactly what the agent did.",
  },
  lead_scoring: {
    title: "Lead scoring — recent runs",
    description:
      "Every scoring run with its curated, step-by-step trace. Select a run to see exactly what the agent did.",
  },
  lead_nurture: {
    title: "Lead nurture — recent runs",
    description:
      "Every nurture decision with its curated, step-by-step trace. Select a run to see exactly what the agent did.",
  },
  lead_lifecycle: {
    title: "Lead lifecycle — recent runs",
    description:
      "Every lifecycle move with its curated, step-by-step trace. Select a run to see exactly what the agent did.",
  },
  email_auto_reply: {
    title: "Email auto-reply — recent runs",
    description:
      "Every inbound auto-reply decision with its curated, step-by-step trace. Select a run to see exactly what the agent did.",
  },
  lead_summary: {
    title: "Lead summary — recent runs",
    description:
      "Every executive summary generation with its curated, step-by-step trace. Select a run to see exactly what the agent did.",
  },
  sales_assignment: {
    title: "Sales assignment — recent runs",
    description:
      "Every owner-assignment run with its curated, step-by-step trace. Select a run to see exactly what the agent did.",
  },
  meeting_brief: {
    title: "Meeting brief — recent runs",
    description:
      "Every booking-brief email with its curated, step-by-step trace. Select a run to see exactly what the agent did.",
  },
  meeting_reminder: {
    title: "Meeting reminder — recent runs",
    description:
      "Every T-24h/T-1h reminder email with its curated, step-by-step trace. Select a run to see exactly what the agent did.",
  },
  meeting_miss_escalation: {
    title: "Meeting miss escalation — recent runs",
    description:
      "Every admin escalation email with its curated, step-by-step trace. Select a run to see exactly what the agent did.",
  },
  meeting_mom: {
    title: "Minutes of Meeting — recent runs",
    description:
      "Every MoM generation with its curated, step-by-step trace. Select a run to see exactly what the agent did.",
  },
  post_meeting_process: {
    title: "Post-meeting process — recent runs",
    description:
      "Every post-meeting analysis with its curated, step-by-step trace: proposal/quote drafts for sales (CRM-BOT notify), never auto customer commercial mail.",
  },
  pipeline_forecast: {
    title: "Pipeline forecast audit — recent runs",
    description:
      "Every forecast judgment with its curated, step-by-step trace. The agent only flags — it never changes a deal's stage or close date.",
  },
  sales_coach: {
    title: "Sales & pre-sales coach — recent runs",
    description:
      "Every coaching pass with its curated, step-by-step trace. Trace shows agent progress only — the full coaching note stays private to the rep; managers and admins receive a performance summary.",
  },
  compliance_privacy: {
    title: "Compliance & privacy control — recent runs",
    description:
      "Every classification of a flagged inbound email with its curated, step-by-step trace. The agent only applies a reversible opt-out or queues a deletion/access request — an admin must confirm before any data is deleted.",
  },
  invoice_escalation: {
    title: "Invoice escalation — recent runs",
    description:
      "Every collections-risk assessment of an overdue invoice with its curated, step-by-step trace. The agent only writes severity/reason/drafts — a human always copies/sends the reminder.",
  },
  expansion_matcher: {
    title: "Expansion & revenue matcher — recent runs",
    description:
      "Every upsell/cross-sell assessment of an account's own closed-won deal history with its curated, step-by-step trace. The agent only writes signal/reason/drafts — a human always reviews and reaches out.",
  },
  prospect_search: {
    title: "Prospect search — recent runs",
    description:
      "Every multi-source prospect search (Apollo / ZoomInfo / Lusha / BuiltWith) kicked off from Contact chat.",
  },
  prospect_qualify: {
    title: "Prospect qualify — recent runs",
    description:
      "Every LLM rank of searched candidates vs ICP, competitors, and product fit.",
  },
  prospect_personnel: {
    title: "Prospect personnel — recent runs",
    description:
      "Every personnel fill pass that attaches contacts to shortlisted accounts.",
  },
  proposal_corpus: {
    title: "Proposal pattern learning — recent runs",
    description:
      "Corpus ingest → structure → pair → playbook synthesize jobs from Configuration uploads.",
  },
  proposal_generate: {
    title: "Proposal generate from pattern — recent runs",
    description:
      "Deal-side generation that profiles a requirement, matches a learned pattern, and fills sections with KB + products.",
  },
};

const AGENT_RUN_STATUSES: Record<AgentRunId, string[]> = {
  lead_enrichment: ["enriched", "skipped", "failed", "running", "pending"],
  lead_scoring: ["scored", "failed", "scoring", "pending"],
  lead_nurture: ["sent", "waited", "skipped", "failed", "analyzing", "pending"],
  lead_lifecycle: [
    "applied",
    "waited",
    "skipped",
    "failed",
    "analyzing",
    "pending",
  ],
  email_auto_reply: [
    "replied",
    "awaiting_demo",
    "escalated",
    "skipped",
    "failed",
    "analyzing",
    "pending",
  ],
  lead_summary: EVENT_BACKED_STATUSES,
  sales_assignment: EVENT_BACKED_STATUSES,
  meeting_brief: EVENT_BACKED_STATUSES,
  meeting_reminder: EVENT_BACKED_STATUSES,
  meeting_miss_escalation: EVENT_BACKED_STATUSES,
  meeting_mom: EVENT_BACKED_STATUSES,
  post_meeting_process: EVENT_BACKED_STATUSES,
  pipeline_forecast: EVENT_BACKED_STATUSES,
  sales_coach: EVENT_BACKED_STATUSES,
  compliance_privacy: EVENT_BACKED_STATUSES,
  invoice_escalation: EVENT_BACKED_STATUSES,
  expansion_matcher: EVENT_BACKED_STATUSES,
  prospect_search: EVENT_BACKED_STATUSES,
  prospect_qualify: EVENT_BACKED_STATUSES,
  prospect_personnel: EVENT_BACKED_STATUSES,
  proposal_corpus: EVENT_BACKED_STATUSES,
  proposal_generate: EVENT_BACKED_STATUSES,
};

function statusTone(status: string): string {
  const key = status.toLowerCase();
  if (key === "failed") return TONE_DANGER;
  if (["enriched", "scored", "sent", "applied", "replied", "ok"].includes(key)) {
    return TONE_SUCCESS;
  }
  if (["skipped", "waited", "awaiting_demo", "escalated"].includes(key)) {
    return TONE_WARNING;
  }
  if (["running", "pending", "scoring", "analyzing"].includes(key)) {
    return TONE_INFO;
  }
  return TONE_MUTED;
}

export function AgentRunsPage() {
  const user = useAppSelector((s) => s.auth.user);
  const navigate = useNavigate();
  const { agentId: rawAgentId } = useParams<{ agentId: string }>();
  const agentId: AgentRunId | null =
    rawAgentId && isAgentRunId(rawAgentId) ? rawAgentId : null;
  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = searchParams.get("status");
  const range = parseAgentRange(searchParams.get("range"));

  const [runs, setRuns] = useState<AgentRunSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (offset: number, append: boolean) => {
      if (!agentId) return;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const page = await fetchAgentRunsPage(agentId, {
          limit: PAGE_SIZE,
          offset,
          status: statusFilter,
          range,
        });
        const nextRuns = page.runs;
        const nextTotal = page.total;
        setRuns((prev) => (append ? [...prev, ...nextRuns] : nextRuns));
        setTotal(nextTotal);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load runs.");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [agentId, statusFilter, range],
  );

  useEffect(() => {
    void load(0, false);
  }, [load]);

  const setStatusFilter = (next: string | "all") => {
    const params = new URLSearchParams(searchParams);
    params.set("range", range);
    if (next === "all") params.delete("status");
    else params.set("status", next);
    setSearchParams(params, { replace: true });
  };

  const setRange = (next: AgentRangeId) => {
    if (next === range) return;
    const params = new URLSearchParams(searchParams);
    params.set("range", next);
    setSearchParams(params, { replace: true });
  };

  if (!canViewAgents(normalizeRole(user?.role))) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <p className="text-sm text-text-caption">
          Agents is available to admins and sales managers only.
        </p>
        <BackLink to="/dashboard" className="mt-3">
          Back to dashboard
        </BackLink>
      </div>
    );
  }

  if (!agentId) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <p className="text-sm text-text-caption">Unknown agent.</p>
        <BackLink to={`/agents?range=${range}`} className="mt-3">
          Back to agents
        </BackLink>
      </div>
    );
  }

  const labels = AGENT_RUN_LABELS[agentId];
  const statusOptions = AGENT_RUN_STATUSES[agentId];
  const canLoadMore = runs.length < total;

  const workspace = (
    <div className="crm-fade-in mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <BackLink to={`/agents?range=${range}`}>Back to agents</BackLink>

      <p className="mt-2 text-xs text-text-caption">
        {AGENT_RANGE_OPTIONS.find((opt) => opt.id === range)?.label ?? "Last 1 day"}
      </p>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className={`flex items-center gap-2 ${PAGE_H1_CLASS}`}>
            <Bot className="size-5 text-brand" strokeWidth={2} />
            {labels.title}
          </h1>
          <p className="mt-1 max-w-xl text-sm text-text-caption">
            {labels.description}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-1.5">
        {[{ id: "all", label: "All" }, ...statusOptions.map((s) => ({ id: s, label: humanizeAgentStatus(s) }))].map(
          (opt) => {
            const active = opt.id === "all" ? !statusFilter : statusFilter === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setStatusFilter(opt.id)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? "border-brand bg-brand/10 text-brand"
                    : "border-border-default text-text-secondary hover:bg-state-hover"
                }`}
              >
                {opt.label}
              </button>
            );
          },
        )}
      </div>

      <section className="mt-5 min-w-0 overflow-hidden rounded-xl border border-border-default bg-surface shadow-sm">
        <div className="flex items-center justify-between border-b border-border-default/80 bg-subtle/50 px-4 py-3">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-text-caption uppercase">
            <ListTree className="size-3.5" />
            Runs {total > 0 ? `(${total})` : ""}
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center px-4 py-10">
            <Loader2 className="size-5 animate-spin text-text-caption" />
          </div>
        ) : error ? (
          <p className="px-4 py-6 text-sm text-text-danger">{error}</p>
        ) : runs.length === 0 ? (
          <p className="px-4 py-6 text-sm text-text-caption">
            No runs in this window.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border-default/70 text-[11px] font-medium tracking-wide text-text-caption uppercase">
                  <th className="px-4 py-2 font-medium">Subject</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Updated</th>
                  <th className="px-4 py-2 text-right font-medium">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default/70">
                {runs.map((run) => (
                  <tr
                    key={run.jobId}
                    onClick={() =>
                      navigate(`/agents/${agentId}/runs/${run.jobId}?range=${range}`)
                    }
                    className="cursor-pointer transition-colors hover:bg-subtle/60"
                  >
                    <td className="min-w-0 px-4 py-3">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-medium text-text-primary">
                          {run.contactId
                            ? run.contactName || "Unknown contact"
                            : run.subjectLabel || "Run"}
                        </span>
                        {run.contactId ? (
                          <Link
                            to={`/contact/${run.contactId}`}
                            onClick={(e) => e.stopPropagation()}
                            title="Open contact record"
                            className="shrink-0 text-text-caption hover:text-brand"
                          >
                            <ExternalLink className="size-3.5" />
                          </Link>
                        ) : run.subjectHref ? (
                          <Link
                            to={run.subjectHref}
                            onClick={(e) => e.stopPropagation()}
                            title="Open record"
                            className="shrink-0 text-text-caption hover:text-brand"
                          >
                            <ExternalLink className="size-3.5" />
                          </Link>
                        ) : null}
                      </span>
                      <span className="block truncate text-xs text-text-caption">
                        {run.companyName || run.contactEmail || run.contactId || run.subjectHref}
                      </span>
                      {run.lastError ? (
                        <span
                          className={`mt-0.5 block truncate text-xs ${agentReasonTextClass(run.status)}`}
                        >
                          {humanizeAgentReason(run.lastError)}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className={chipClass(statusTone(run.status))}>
                        {humanizeAgentStatus(run.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-text-caption whitespace-nowrap">
                      {new Date(run.updatedAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right align-top text-xs text-text-caption whitespace-nowrap">
                      {run.durationMs != null
                        ? `${(run.durationMs / 1000).toFixed(1)}s`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {canLoadMore ? (
          <div className="border-t border-border-default/70 px-4 py-3">
            <button
              type="button"
              onClick={() => void load(runs.length, true)}
              disabled={loadingMore}
              className="w-full rounded-lg border border-border-default px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-state-hover disabled:opacity-60"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );

  return (
    <AgentModuleShell
      moduleId="agents"
      title="Agents"
      welcome="I'm your **agents agent**. Ask me about enrichment, scoring, nurture, or meeting reminder performance — the run history stays fully usable on the right."
      surface="list"
      workspaceTitle="Recent runs"
      workspaceHeaderActions={
        <div
          className="inline-flex rounded-lg border border-border-default bg-surface p-0.5"
          role="group"
          aria-label="Time range"
        >
          {AGENT_RANGE_OPTIONS.map((opt) => {
            const active = opt.id === range;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setRange(opt.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "bg-brand text-white"
                    : "text-text-secondary hover:bg-state-hover hover:text-text-primary"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      }
      workspace={workspace}
    />
  );
}
