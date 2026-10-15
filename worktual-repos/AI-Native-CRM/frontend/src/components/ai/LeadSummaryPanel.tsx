import { Sparkles } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { fetchLeadSummary, mergeLeadScoreStatus } from "@/services/leadSummary";
import type { LeadScoreStatusView, LeadSummaryView } from "@/services/leadSummary";
import { ChannelSummaryBriefView } from "@/components/contacts/ChannelSummaryBrief";
import { LeadScoreBadge } from "@/components/contacts/LeadScoreBadge";
import { LeadSummaryAutoRefresh } from "@/components/ai/LeadSummaryAutoRefresh";
import { Skeleton } from "@/components/skeleton/Skeleton";
import { SkeletonText } from "@/components/skeleton/SkeletonText";
import {
  cleanSummaryText,
  eventSummaryBrief,
  isPastedSource,
  parseChannelSummary,
} from "@/lib/contact-intelligence";

const INTENT_STYLES: Record<string, string> = {
  "High buying intent": "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  "Active engagement": "bg-brand/10 text-brand border-brand/30",
  Exploratory: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  "New lead": "bg-surface-muted text-text-caption border-border-default",
  Converted: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  Disqualified: "bg-surface-muted text-text-caption border-border-default",
};

function Shell({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border-default bg-surface p-6 lg:col-span-2">
      {children}
    </section>
  );
}

function Header({ intent }: { intent?: string | null }) {
  const style =
    (intent && INTENT_STYLES[intent]) ||
    "bg-surface-muted text-text-caption border-border-default";
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold text-text-primary">
          <Sparkles className="size-4 text-brand" strokeWidth={2} />
          AI lead summary
        </h2>
      </div>
      {intent ? (
        <span
          className={`rounded-full border px-2.5 py-1 text-xs font-medium ${style}`}
        >
          {intent}
        </span>
      ) : null}
    </div>
  );
}

/** Drop Next step from body when we already render it in the callout below. */
function summaryBodyWithoutNextStep(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const heading = line.trim().replace(/:$/, "");
    if (/^next(?:\s+best)?\s+step$/i.test(heading) || /^recommended(?:\s+next)?\s+action$/i.test(heading)) {
      skipping = true;
      continue;
    }
    if (skipping) {
      // Stop skipping when another section heading appears.
      if (
        heading &&
        /^(situation|company|engagement|opportunity|person|profile|summary|why|highlights|risks)$/i.test(
          heading,
        )
      ) {
        skipping = false;
        out.push(line);
      }
      continue;
    }
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function LeadSummaryPanelSkeleton() {
  return (
    <Shell>
      <div aria-hidden>
        <SkeletonText width={96} height={20} />
        <div className="mt-2">
          <Skeleton height={56} width={56} borderRadius={999} />
        </div>
      </div>
      <div className="mt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SkeletonText width={140} height={20} />
          <Skeleton height={24} width={96} borderRadius={999} />
        </div>
        <div className="mt-4 space-y-2" aria-hidden>
          <SkeletonText width="100%" />
          <SkeletonText width="92%" />
          <SkeletonText width="76%" />
          <SkeletonText width={132} height={12} className="mt-3" />
        </div>
      </div>
    </Shell>
  );
}

/**
 * Vite port of src/components/ai/LeadSummaryPanel.tsx (a Next RSC). Fetches
 * the same GET /api/contacts/:id/summary payload the RSC computed server-side
 * and re-fetches on the SSE "summary" event, same as LeadSummaryAutoRefresh.
 */
export function LeadSummaryPanel({ contactId }: { contactId: string }) {
  const [summary, setSummary] = useState<LeadSummaryView | null>(null);
  const [scoreStatus, setScoreStatus] = useState<LeadScoreStatusView>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetchLeadSummary(contactId);
      if (res.ok) {
        setSummary(res.summary);
        setScoreStatus((current) => mergeLeadScoreStatus(current, res.scoreStatus));
      }
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !summary && !scoreStatus) return <LeadSummaryPanelSkeleton />;

  const scoreInFlight =
    (scoreStatus?.status === "pending" ||
      scoreStatus?.status === "scoring" ||
      scoreStatus?.status === "queued") &&
    scoreStatus?.score == null;

  const eventBrief = eventSummaryBrief(summary);
  const omniBrief = parseChannelSummary(summary?.omniChannelSummary);
  const summaryBody = summary ? summaryBodyWithoutNextStep(summary.summary) : "";
  const bodyBrief = eventBrief || omniBrief ? null : parseChannelSummary(summaryBody);

  return (
    <Shell>
      <LeadSummaryAutoRefresh
        contactId={contactId}
        onRefresh={load}
        inFlight={scoreInFlight}
      />

      <LeadScoreBadge
        status={scoreStatus?.status ?? null}
        score={scoreStatus?.score ?? scoreStatus?.previousScore ?? null}
      />

      {scoreStatus?.status === "scored" && scoreStatus.rationale ? (
        <p className="mt-3 text-sm leading-relaxed text-text-secondary">
          {cleanSummaryText(scoreStatus.rationale.replace(/\s*Guardrails:.*$/s, ""))}
        </p>
      ) : null}

      <div className="mt-5">
        <Header intent={summary?.intent} />

        {summary ? (
          <>
            {eventBrief ? (
              <div className="mt-4">
                <ChannelSummaryBriefView brief={eventBrief} />
              </div>
            ) : bodyBrief ? (
              <div className="mt-4">
                <ChannelSummaryBriefView brief={bodyBrief} />
              </div>
            ) : summaryBody && !isPastedSource(summaryBody) ? (
              <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-6 text-text-primary">
                {cleanSummaryText(summaryBody)}
              </p>
            ) : null}
            <p className="mt-3 text-xs text-text-caption">
              {summary.source === "ai"
                ? "Generated by AI · "
                : summary.source === "heuristic"
                  ? "Offline fallback · "
                  : ""}
              updated {new Date(summary.updatedAt).toLocaleString()}
            </p>
          </>
        ) : scoreStatus?.rationale ? (
          <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-text-primary">
            {cleanSummaryText(scoreStatus.rationale.replace(/\s*Guardrails:.*$/s, ""))}
          </p>
        ) : null}
        {scoreStatus?.status === "scored" && scoreStatus.source === "heuristic" ? (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
            Score used offline fallback (LLM unavailable).
          </p>
        ) : null}
      </div>
    </Shell>
  );
}
