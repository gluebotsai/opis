import { useMemo, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import {
  Bot,
  ClipboardList,
  FormInput,
  LineChart,
  Megaphone,
  Radar,
  Sparkles,
  Users,
} from "lucide-react";
import {
  formatWindowRange,
  getAgentWorkSnapshot,
  listAgentPerformanceCards,
  subscribeAgentWorkLog,
  type AgentOutcomeTone,
  type AgentPerformanceCard,
  type AgentWorkAgentId,
  type AgentWorkWindow,
} from "@/lib/agent-work-log-store";

const WINDOWS: { id: AgentWorkWindow; label: string }[] = [
  { id: "1h", label: "Last 1 hour" },
  { id: "1d", label: "Last 1 day" },
  { id: "7d", label: "Last 7 days" },
];

function agentIcon(id: AgentWorkAgentId) {
  switch (id) {
    case "recommendations":
      return Sparkles;
    case "create_campaign":
      return Megaphone;
    case "forms":
      return FormInput;
    case "reports":
      return LineChart;
    case "monitoring":
      return Radar;
    case "contacts":
      return Users;
    default:
      return ClipboardList;
  }
}

function toneClass(tone: AgentOutcomeTone): string {
  switch (tone) {
    case "success":
      return "bg-emerald-50 text-emerald-800 ring-emerald-200";
    case "warn":
      return "bg-amber-50 text-amber-800 ring-amber-200";
    case "danger":
      return "bg-rose-50 text-rose-800 ring-rose-200";
    case "info":
      return "bg-sky-50 text-sky-800 ring-sky-200";
    default:
      return "bg-neutral-100 text-neutral-600 ring-neutral-200";
  }
}

function barColor(tone: AgentOutcomeTone): string {
  switch (tone) {
    case "success":
      return "bg-emerald-500";
    case "warn":
      return "bg-amber-400";
    case "danger":
      return "bg-rose-500";
    case "info":
      return "bg-sky-500";
    default:
      return "bg-neutral-300";
  }
}

function OutcomeBar({ card }: { card: AgentPerformanceCard }) {
  const total = card.outcomes.reduce((n, o) => n + o.count, 0);
  if (total <= 0) {
    return (
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
        <div className="h-full w-0 bg-neutral-300" />
      </div>
    );
  }
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
      {card.outcomes
        .filter((o) => o.count > 0)
        .map((o) => (
          <div
            key={o.key}
            className={`h-full ${barColor(o.tone)}`}
            style={{ width: `${(o.count / total) * 100}%` }}
            title={`${o.label}: ${o.count}`}
          />
        ))}
    </div>
  );
}

function AgentCard({ card }: { card: AgentPerformanceCard }) {
  const Icon = agentIcon(card.agentId);
  return (
    <article className="flex flex-col rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-white">
          <Icon className="size-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <Link
              to={card.href}
              className="text-sm font-semibold text-neutral-900 hover:underline"
            >
              {card.label}
            </Link>
            <span className="shrink-0 text-xs tabular-nums text-neutral-500">
              {card.runs} run{card.runs === 1 ? "" : "s"}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] leading-snug text-neutral-500">
            {card.description}
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-medium tracking-wide text-neutral-400 uppercase">
            {card.runs > 0 ? "Mix of outcomes" : "No runs in window"}
          </p>
        </div>
        <OutcomeBar card={card} />
        <div className="flex flex-wrap gap-1.5">
          {card.outcomes.map((o) => (
            <span
              key={o.key}
              className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${toneClass(o.tone)}`}
            >
              {o.label}
              <span className="tabular-nums opacity-80">{o.count}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="mt-3 border-t border-neutral-100 pt-3">
        <p className="mb-1.5 text-[10px] font-medium tracking-wide text-neutral-400 uppercase">
          Live queue
        </p>
        <div className="flex flex-wrap gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-md bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-800 ring-1 ring-inset ring-sky-200">
            Pending
            <span className="tabular-nums opacity-80">{card.pending}</span>
          </span>
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800 ring-1 ring-inset ring-emerald-200">
            Running
            <span className="tabular-nums opacity-80">{card.running}</span>
          </span>
        </div>
      </div>
    </article>
  );
}

/**
 * Events tracking — CRM-style agent performance workspace.
 */
export function AgentsWorkTodayPanel() {
  useSyncExternalStore(subscribeAgentWorkLog, getAgentWorkSnapshot, () => []);
  const [window, setWindow] = useState<AgentWorkWindow>("1d");

  const cards = useMemo(() => listAgentPerformanceCards(window), [window]);
  const rangeLabel = useMemo(() => formatWindowRange(window), [window]);
  const totalRuns = cards.reduce((n, c) => n + c.runs, 0);

  return (
    <section className="shrink-0 border-b border-neutral-200 bg-neutral-50/90 px-3 py-4 sm:px-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <span className="inline-flex size-7 items-center justify-center rounded-lg bg-white text-neutral-800 shadow-sm ring-1 ring-neutral-200">
              <Bot className="size-3.5" strokeWidth={1.75} />
            </span>
            <h2 className="text-sm font-semibold text-neutral-900">Agents</h2>
          </div>
          <p className="max-w-xl text-[11px] leading-snug text-neutral-500">
            Performance for each proactive Campaign agent in the selected
            window — recommendations, create campaign, forms, events, and
            monitoring.
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-1.5 sm:items-end">
          <div className="inline-flex rounded-xl border border-neutral-200 bg-white p-0.5 shadow-sm">
            {WINDOWS.map((w) => {
              const active = window === w.id;
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => setWindow(w.id)}
                  className={`rounded-[10px] px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                    active
                      ? "bg-neutral-900 text-white"
                      : "text-neutral-600 hover:bg-neutral-50"
                  }`}
                >
                  {w.label}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] tabular-nums text-neutral-400">
            {rangeLabel}
            {totalRuns > 0 ? ` · ${totalRuns} runs` : ""}
          </p>
        </div>
      </div>

      <div className="flex max-h-[28rem] flex-col gap-3 overflow-y-auto">
        {cards.map((card) => (
          <AgentCard key={card.agentId} card={card} />
        ))}
      </div>
    </section>
  );
}
