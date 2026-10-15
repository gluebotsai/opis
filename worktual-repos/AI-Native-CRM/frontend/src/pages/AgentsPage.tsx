import { Link, useSearchParams } from "react-router-dom";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Bot,
  CalendarClock,
  ChevronRight,
  ClipboardList,
  FileText,
  Gauge,
  GraduationCap,
  ListTree,
  Mail,
  MapPin,
  Receipt,
  Reply,
  Rocket,
  Route,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Workflow,
} from "lucide-react";
import {
  AGENT_RANGE_OPTIONS,
  parseAgentRange,
  type AgentMetricCard,
  type AgentRangeId,
  type AgentsDashboardPayload,
} from "@/lib/agents-dashboard";
import { canViewAgents, normalizeRole } from "@/lib/rbac";
import {
  fetchAgentsDashboard,
  isAgentRunId,
  type AgentRunId,
} from "@/services/agents";
import { useAppSelector } from "@/store";
import { AgentsPageSkeleton } from "./AgentsPageSkeleton";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";
import { MODULE_WORKSPACE_DESCRIPTION } from "@/lib/module-workspace-copy";
import { BackLink } from "@/components/ui/BackLink";
import {
  chipClass,
  TONE_DANGER,
  TONE_INFO,
  TONE_MUTED,
  TONE_SUCCESS,
  TONE_WARNING,
} from "@/lib/ui-tones";

const RANGE_SHORT: Record<AgentRangeId, string> = {
  "1h": "last hour",
  "1d": "last day",
  "7d": "last 7 days",
};

/** Count noun for “Completed in …” — specific to what each agent finishes. */
function agentCompletionUnit(
  agentId: string,
  count: number,
): { singular: string; plural: string; label: string } {
  const units: Record<string, { singular: string; plural: string }> = {
    lead_enrichment: { singular: "enrichment", plural: "enrichments" },
    lead_scoring: { singular: "score", plural: "scores" },
    lead_summary: { singular: "summary", plural: "summaries" },
    lead_lifecycle: { singular: "stage move", plural: "stage moves" },
    sales_assignment: { singular: "assignment", plural: "assignments" },
    email_auto_reply: { singular: "reply", plural: "replies" },
    lead_nurture: { singular: "nurture send", plural: "nurture sends" },
    meeting_brief: { singular: "brief", plural: "briefs" },
    meeting_reminder: { singular: "reminder", plural: "reminders" },
    post_meeting_process: { singular: "follow-up", plural: "follow-ups" },
    meeting_miss_escalation: { singular: "escalation", plural: "escalations" },
    meeting_mom: { singular: "MoM", plural: "MoMs" },
    pipeline_forecast: { singular: "forecast audit", plural: "forecast audits" },
    sales_coach: { singular: "coaching insight", plural: "coaching insights" },
    compliance_privacy: { singular: "privacy action", plural: "privacy actions" },
    invoice_escalation: { singular: "escalation", plural: "escalations" },
    expansion_matcher: { singular: "signal", plural: "signals" },
    prospect_search: { singular: "search", plural: "searches" },
    prospect_qualify: { singular: "qualify", plural: "qualifies" },
    prospect_personnel: { singular: "personnel fill", plural: "personnel fills" },
    proposal_corpus: { singular: "corpus job", plural: "corpus jobs" },
    proposal_generate: { singular: "pattern generate", plural: "pattern generates" },
  };
  const pair = units[agentId] ?? { singular: "job", plural: "jobs" };
  return {
    ...pair,
    label: count === 1 ? pair.singular : pair.plural,
  };
}

export function AgentsPage() {
  const user = useAppSelector((s) => s.auth.user);
  const [searchParams, setSearchParams] = useSearchParams();
  const range = parseAgentRange(searchParams.get("range"));
  const [data, setData] = useState<AgentsDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchAgentsDashboard(range);
      setData(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agents.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  const setRange = (next: AgentRangeId) => {
    if (next === range) return;
    setSearchParams({ range: next }, { replace: true });
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

  if (loading && !data) {
    return (
      <AgentModuleShell
        moduleId="agents"
        title="Agents"
        welcome="I'm your **agents agent**. Ask me about enrichment, scoring, nurture, or meeting reminder performance — the agent dashboard stays fully usable on the right."
        chips={[
          {
            id: "chip-explain",
            label: "Explain agent performance",
            prompt: "Explain how my AI agents are performing right now",
          },
        ]}
        surface="list"
        workspace={<AgentsPageSkeleton />}
      />
    );
  }

  if (!data) {
    return (
      <AgentModuleShell
        moduleId="agents"
        title="Agents"
        welcome="I'm your **agents agent**. Ask me about enrichment, scoring, nurture, or meeting reminder performance — the agent dashboard stays fully usable on the right."
        surface="list"
        workspace={
          <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
            <p className="text-sm text-red-700">
              {error ?? "Agent data is unavailable right now."}
            </p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-3 text-sm font-medium text-text-link hover:underline"
            >
              Retry
            </button>
          </div>
        }
      />
    );
  }

  const workspace = (
    <div className="crm-fade-in mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <p className="text-xs text-text-caption">
        {new Date(data.since).toLocaleString()} →{" "}
        {new Date(data.until).toLocaleString()}
      </p>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-2">
        {data.agents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            range={range}
            footer={
              isAgentRunId(agent.id) ? (
                <AgentRunsLink agentId={agent.id} range={range} />
              ) : null
            }
          />
        ))}
      </div>

      <p className="mt-8 text-xs text-text-caption">
        Agents run on create, engagement signals, meeting schedule, and cron.{" "}
        <Link to="/contact" className="text-brand hover:underline">
          Open contacts
        </Link>{" "}
        or the calendar to review enrichment, nurture, lifecycle, and meeting
        reminder activity.
      </p>
    </div>
  );

  return (
    <AgentModuleShell
      moduleId="agents"
      title="Agents"
      welcome="I'm your **agents agent**. Ask me about enrichment, scoring, nurture, or meeting reminder performance — the agent dashboard stays fully usable on the right."
      chips={[
        {
          id: "chip-explain",
          label: "Explain agent performance",
          prompt: "Explain how my AI agents are performing right now",
        },
        {
          id: "chip-meeting-reminder",
          label: "Meeting reminder agent",
          prompt: "How is the meeting reminder agent performing?",
        },
      ]}
      surface="list"
      workspaceTitle="Agents"
      workspaceSubtitle={MODULE_WORKSPACE_DESCRIPTION.agents}
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
      onAfterTool={() => void load()}
    />
  );
}

function AgentCard({
  agent,
  range,
  footer,
}: {
  agent: AgentMetricCard;
  range: AgentRangeId;
  footer?: ReactNode;
}) {
  const outcomes = agent.breakdown.filter(
    (row) => !row.label.toLowerCase().includes("now"),
  );
  const live = agent.breakdown.filter((row) =>
    row.label.toLowerCase().includes("now"),
  );
  const outcomeTotal = outcomes.reduce((sum, row) => sum + row.count, 0);
  const rangePhrase = RANGE_SHORT[range];
  const iconTone =
    agent.id === "lead_enrichment"
      ? "bg-brand/10 text-brand"
      : agent.id === "lead_scoring"
        ? "bg-violet-500/10 text-violet-700"
        : agent.id === "lead_nurture"
          ? "bg-sky-500/10 text-sky-700"
          : agent.id === "lead_lifecycle"
            ? "bg-indigo-500/10 text-indigo-700"
            : agent.id === "sales_assignment"
              ? "bg-teal-500/10 text-teal-700"
              : agent.id === "email_auto_reply"
                ? "bg-amber-500/10 text-amber-700"
                : agent.id === "meeting_reminder"
                  ? "bg-rose-500/10 text-rose-700"
                  : agent.id === "meeting_brief"
                    ? "bg-orange-500/10 text-orange-700"
                    : agent.id === "post_meeting_process"
                      ? "bg-fuchsia-500/10 text-fuchsia-700"
                      : agent.id === "meeting_miss_escalation"
                        ? "bg-red-500/10 text-red-700"
                        : agent.id === "meeting_mom"
                          ? "bg-cyan-500/10 text-cyan-700"
                          : agent.id === "pipeline_forecast"
                            ? "bg-lime-500/10 text-lime-700"
                            : agent.id === "sales_coach"
                              ? "bg-purple-500/10 text-purple-700"
                              : agent.id === "compliance_privacy"
                                ? "bg-slate-500/10 text-slate-700"
                                : agent.id === "invoice_escalation"
                                  ? "bg-red-600/10 text-red-700"
                                  : agent.id === "expansion_matcher"
                                    ? "bg-green-500/10 text-green-700"
                                    : "bg-emerald-500/10 text-emerald-600";

  const AgentIcon =
    agent.id === "lead_enrichment"
      ? Bot
      : agent.id === "lead_scoring"
        ? Gauge
        : agent.id === "lead_nurture"
          ? Mail
          : agent.id === "lead_lifecycle"
            ? Route
            : agent.id === "sales_assignment"
              ? MapPin
              : agent.id === "email_auto_reply"
                ? Reply
                : agent.id === "meeting_reminder"
                  ? CalendarClock
                  : agent.id === "meeting_brief"
                    ? FileText
                    : agent.id === "post_meeting_process"
                      ? Workflow
                      : agent.id === "meeting_miss_escalation"
                        ? AlertTriangle
                        : agent.id === "meeting_mom"
                          ? ClipboardList
                          : agent.id === "pipeline_forecast"
                            ? TrendingUp
                            : agent.id === "sales_coach"
                              ? GraduationCap
                              : agent.id === "compliance_privacy"
                                ? ShieldCheck
                                : agent.id === "invoice_escalation"
                                  ? Receipt
                                  : agent.id === "expansion_matcher"
                                    ? Rocket
                                    : Sparkles;

  const completionUnit = agentCompletionUnit(agent.id, agent.total);

  return (
    <section className="flex h-full flex-col overflow-hidden rounded-xl border border-border-default bg-surface shadow-sm">
      <div className="shrink-0 border-b border-border-default/80 bg-subtle/50 px-5 py-4">
        <div className="flex items-start gap-3">
          <span
            className={`mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-lg ${iconTone}`}
          >
            <AgentIcon className="size-4" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h2 className="text-base font-semibold text-text-primary">
                {agent.name}
              </h2>
              {footer}
            </div>
            <p className="mt-0.5 text-xs leading-4 text-text-caption">
              {agent.description}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium tracking-wide text-text-caption uppercase">
              Completed in {rangePhrase}
            </p>
            <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-text-primary">
              {agent.total}
              <span className="ml-2 text-sm font-medium text-text-secondary">
                {completionUnit.label}
              </span>
            </p>
          </div>
          {outcomeTotal > 0 ? (
            <OutcomeBar outcomes={outcomes} total={outcomeTotal} />
          ) : (
            <p className="rounded-md border border-dashed border-border-default px-2.5 py-1.5 text-xs text-text-caption">
              No completed {completionUnit.plural} yet
            </p>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">
        <p className="text-[11px] font-medium tracking-wide text-text-caption uppercase">
          Outcomes
        </p>
        <ul className="mt-2 grid grid-cols-3 gap-2">
          {outcomes.map((row) => (
            <MetricBox
              key={row.label}
              label={row.label}
              count={row.count}
            />
          ))}
        </ul>

        {live.length > 0 ? (
          <>
            <p className="mt-4 text-[11px] font-medium tracking-wide text-text-caption uppercase">
              Live queue
            </p>
            <ul className="mt-2 grid grid-cols-3 gap-2">
              {live.map((row) => (
                <MetricBox
                  key={row.label}
                  label={row.label.replace(/ now$/i, "")}
                  count={row.count}
                />
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </section>
  );
}

/** Shared outcome / live-queue tile — badge on top, count below. */
function MetricBox({ label, count }: { label: string; count: number }) {
  return (
    <li className="rounded-lg border border-border-default/70 bg-subtle/30 px-2.5 py-2.5">
      <span
        className={`${chipClass(outcomeChipTone(label))} max-w-full truncate`}
      >
        {label}
      </span>
      <p className="mt-1 text-lg font-semibold tabular-nums text-text-primary">
        {count}
      </p>
    </li>
  );
}

/**
 * Link into the dedicated "Recent runs" page — a full page (not a dropdown)
 * so the run history stays usable as it grows over time. Shared by every
 * agent that has a job table + contactId (see AGENT_RUN_IDS).
 */
function AgentRunsLink({
  agentId,
  range,
}: {
  agentId: AgentRunId;
  range: AgentRangeId;
}) {
  return (
    <Link
      to={`/agents/${agentId}/runs?range=${range}`}
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border-default bg-surface px-2 py-1 text-[11px] font-medium tracking-wide text-text-secondary uppercase hover:border-brand/40 hover:text-brand"
    >
      <ListTree className="size-3.5" />
      Recent runs
      <ChevronRight className="size-3.5" />
    </Link>
  );
}

function outcomeChipTone(label: string): string {
  const key = label.toLowerCase();
  if (key.includes("failed")) return TONE_DANGER;
  if (
    key.includes("enriched") ||
    key.includes("ai-generated") ||
    key === "ai" ||
    key.includes("sent") ||
    key.includes("replied") ||
    key.includes("scored") ||
    key.includes("grade a") ||
    key.includes("completed") ||
    key.includes("owner brief") ||
    key.includes("customer email")
  ) {
    return TONE_SUCCESS;
  }
  if (
    key.includes("skipped") ||
    key.includes("rule") ||
    key.includes("waited") ||
    key.includes("escalated") ||
    key.includes("grade b") ||
    key.includes("24h") ||
    key.includes("1h") ||
    key.includes("notify-only") ||
    key.includes("notify only") ||
    key.includes("offline") ||
    key.includes("fallback")
  ) {
    return TONE_WARNING;
  }
  if (
    key.includes("running") ||
    key.includes("pending") ||
    key.includes("analyzing") ||
    key.includes("demo pending")
  ) {
    return TONE_INFO;
  }
  return TONE_MUTED;
}

function OutcomeBar({
  outcomes,
  total,
}: {
  outcomes: Array<{ label: string; count: number }>;
  total: number;
}) {
  const colorFor = (label: string) => {
    const tone = outcomeChipTone(label);
    if (tone === TONE_SUCCESS) return "bg-[#0e8f50]";
    if (tone === TONE_DANGER) return "bg-text-danger";
    if (tone === TONE_WARNING) return "bg-text-warning";
    if (tone === TONE_INFO) return "bg-brand";
    return "bg-text-caption";
  };

  return (
    <div className="w-full max-w-[11rem]">
      <div
        className="flex h-2 overflow-hidden rounded-full bg-border-default/60"
        title={outcomes.map((o) => `${o.label}: ${o.count}`).join(" · ")}
      >
        {outcomes.map((row) => {
          if (row.count <= 0) return null;
          const pct = Math.max(4, Math.round((row.count / total) * 100));
          return (
            <span
              key={row.label}
              className={`${colorFor(row.label)} h-full`}
              style={{ width: `${pct}%` }}
            />
          );
        })}
      </div>
      <p className="mt-1.5 text-[10px] leading-3 text-text-caption">
        Mix of outcomes in this window
      </p>
    </div>
  );
}
