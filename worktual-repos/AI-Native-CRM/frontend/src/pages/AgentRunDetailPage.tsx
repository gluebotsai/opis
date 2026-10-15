import { Link, useParams, useSearchParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { Bot, Loader2 } from "lucide-react";
import { BackLink } from "@/components/ui/BackLink";
import {
  fetchAgentRunSteps,
  isAgentRunId,
  type AgentRunDetail,
  type AgentRunId,
} from "@/services/agents";
import {
  AGENT_STEP_ORDERS,
  AgentStepTimeline,
} from "@/components/contacts/AgentStepTimeline";
import { canViewAgents, normalizeRole } from "@/lib/rbac";
import { parseAgentRange } from "@/lib/agents-dashboard";
import { useAppSelector } from "@/store";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";
import {
  humanizeAgentReason,
  humanizeAgentStatus,
  isAgentFailureStatus,
  isAgentSkipStatus,
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

export function AgentRunDetailPage() {
  const user = useAppSelector((s) => s.auth.user);
  const { agentId: rawAgentId, jobId } = useParams<{
    agentId: string;
    jobId: string;
  }>();
  const agentId: AgentRunId | null =
    rawAgentId && isAgentRunId(rawAgentId) ? rawAgentId : null;
  const [searchParams] = useSearchParams();
  const range = parseAgentRange(searchParams.get("range"));
  const [detail, setDetail] = useState<AgentRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!agentId || !jobId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchAgentRunSteps(agentId, jobId)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load this run.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, jobId]);

  if (!canViewAgents(normalizeRole(user?.role))) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
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
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <p className="text-sm text-text-caption">Unknown agent.</p>
        <BackLink to={`/agents?range=${range}`} className="mt-3">
          Back to agents
        </BackLink>
      </div>
    );
  }

  const run = detail?.run;

  const workspace = (
    <div className="crm-fade-in mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <BackLink to={`/agents/${agentId}/runs?range=${range}`}>
        Back to recent runs
      </BackLink>

      {loading ? (
        <div className="mt-8 flex items-center justify-center py-10">
          <Loader2 className="size-5 animate-spin text-text-caption" />
        </div>
      ) : error ? (
        <p className="mt-4 text-sm text-text-danger">{error}</p>
      ) : !run ? (
        <p className="mt-4 text-sm text-text-caption">Run not found.</p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className={`flex items-center gap-2 ${PAGE_H1_CLASS}`}>
                <Bot className="size-5 text-brand" strokeWidth={2} />
                {run.contactId ? (
                  <Link
                    to={`/contact/${run.contactId}`}
                    className="truncate hover:text-brand hover:underline"
                  >
                    {run.contactName || "Unknown contact"}
                  </Link>
                ) : (
                  <span className="truncate">No contact (company-level)</span>
                )}
              </h1>
              <p className="mt-1 max-w-xl text-sm text-text-caption">
                {run.companyName || run.contactEmail || run.contactId}
              </p>
            </div>
            <span className={chipClass(statusTone(run.status))}>
              {humanizeAgentStatus(run.status)}
            </span>
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-border-default/70 bg-subtle/30 px-3 py-2.5">
              <dt className="text-[11px] font-medium tracking-wide text-text-caption uppercase">
                Updated
              </dt>
              <dd className="mt-0.5 text-sm text-text-primary">
                {new Date(run.updatedAt).toLocaleString()}
              </dd>
            </div>
            <div className="rounded-lg border border-border-default/70 bg-subtle/30 px-3 py-2.5">
              <dt className="text-[11px] font-medium tracking-wide text-text-caption uppercase">
                Duration
              </dt>
              <dd className="mt-0.5 text-sm text-text-primary">
                {run.durationMs != null
                  ? `${(run.durationMs / 1000).toFixed(1)}s`
                  : "—"}
              </dd>
            </div>
            <div className="rounded-lg border border-border-default/70 bg-subtle/30 px-3 py-2.5">
              <dt className="text-[11px] font-medium tracking-wide text-text-caption uppercase">
                Attempts
              </dt>
              <dd className="mt-0.5 text-sm text-text-primary">
                {run.attempts}
              </dd>
            </div>
            <div className="rounded-lg border border-border-default/70 bg-subtle/30 px-3 py-2.5">
              <dt className="text-[11px] font-medium tracking-wide text-text-caption uppercase">
                Job
              </dt>
              <dd className="mt-0.5 truncate text-sm text-text-primary" title={run.jobId}>
                {run.jobId}
              </dd>
            </div>
          </dl>

          {run.lastError ? (
            <p
              className={
                isAgentFailureStatus(run.status)
                  ? "mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-text-danger"
                  : isAgentSkipStatus(run.status)
                    ? "mt-4 rounded-lg border border-border-default bg-subtle px-3 py-2 text-sm text-text-caption"
                    : "mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-text-warning"
              }
            >
              {humanizeAgentReason(run.lastError)}
            </p>
          ) : null}

          <div className="mt-6 rounded-xl border border-border-default bg-surface p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-text-primary">
              Agent activity
            </h2>
            <AgentStepTimeline
              steps={detail.steps}
              order={AGENT_STEP_ORDERS[agentId]}
            />
          </div>
        </>
      )}
    </div>
  );

  return (
    <AgentModuleShell
      moduleId="agents"
      title="Agents"
      welcome="I'm your **agents agent**. Ask me about enrichment, scoring, nurture, or meeting reminder performance — this run's activity stays fully usable on the right."
      surface="list"
      workspace={workspace}
    />
  );
}
