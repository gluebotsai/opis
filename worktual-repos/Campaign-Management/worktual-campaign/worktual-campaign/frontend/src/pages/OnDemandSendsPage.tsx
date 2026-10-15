import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { ContentFadeIn } from "@/components/skeleton";
import { MonitorBucketTabs } from "@/components/campaigns/MonitorBucketTabs";
import { CampaignsPageSkeleton } from "@/pages/CampaignsPageSkeleton";
import { useEmbedPageReady } from "@/hooks/useEmbedPageReady";
import {
  formatOnDemandDisplayTitle,
  formatOnDemandListMeta,
  formatOnDemandListSummary,
  mapApiRunToOnDemandRun,
  type OnDemandRun,
} from "@/lib/on-demand-sends-mock";
import { listOnDemandRunsApi } from "@/services/on-demand.service";
import { fetchDashboard } from "@/services/campaigns.service";

function RunRow({ run }: { run: OnDemandRun }) {
  const meta = formatOnDemandListMeta(run);
  const summary = formatOnDemandListSummary(run);
  return (
    <li>
      <Link
        to={`/campaigns/on-demand/${run.id}`}
        className="flex w-full items-center gap-3 rounded-2xl border border-neutral-200 bg-white px-3.5 py-3 text-left shadow-sm transition-colors hover:bg-neutral-50"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-neutral-900">
            {formatOnDemandDisplayTitle(run.title)}
          </p>
          <p className="mt-0.5 truncate text-xs text-neutral-500">
            {meta}
          </p>
          <p className="mt-1 truncate text-xs text-neutral-700" title={summary}>
            {summary}
          </p>
        </div>
        <ChevronRight
          className="size-4 shrink-0 text-neutral-400"
          strokeWidth={1.75}
        />
      </Link>
    </li>
  );
}

/**
 * Campaign Monitor → On-demand list.
 * Same chrome + row rhythm as Live / Scheduled / Past.
 */
export function OnDemandSendsPage() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<OnDemandRun[]>([]);
  const [onDemandCount, setOnDemandCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEmbedPageReady(!loading);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [apiRuns, counts] = await Promise.all([
          listOnDemandRunsApi(),
          fetchDashboard().catch(() => null),
        ]);
        if (cancelled) return;
        setRuns(
          apiRuns.map((row) => {
            try {
              return mapApiRunToOnDemandRun(row);
            } catch {
              return mapApiRunToOnDemandRun({
                id: String(row?.id || "unknown"),
                title: "On-demand send",
                status: "ready",
              });
            }
          }),
        );
        setOnDemandCount(
          typeof counts?.onDemand === "number"
            ? counts.onDemand
            : apiRuns.length,
        );
        setError(null);
      } catch {
        if (!cancelled) {
          setRuns([]);
          setOnDemandCount(0);
          setError("Could not load on-demand sends.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f3f4f6]">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col px-4 py-5 sm:px-6">
        <MonitorBucketTabs active="on-demand" onDemandCount={onDemandCount} />

        {error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : loading ? (
          <CampaignsPageSkeleton />
        ) : runs.length === 0 ? (
          <ContentFadeIn>
            <div className="rounded-2xl border border-dashed border-neutral-200 bg-white px-6 py-16 text-center shadow-sm">
              <p className="text-sm font-medium text-neutral-900">
                No on-demand sends
              </p>
              <p className="mt-1 text-sm text-neutral-500">
                Hub and agent triggered sends will show here — same list style as
                Live / Scheduled / Past.
              </p>
              <button
                type="button"
                onClick={() => navigate("/campaigns/create/on-demand")}
                className="mt-4 inline-flex h-9 items-center justify-center rounded-full bg-black px-4 text-xs font-medium text-white hover:bg-neutral-800"
              >
                New on-demand send
              </button>
            </div>
          </ContentFadeIn>
        ) : (
          <ContentFadeIn className="min-h-0 flex-1 overflow-y-auto pb-6">
            <ul className="space-y-2">
              {runs.map((run) => (
                <RunRow key={run.id} run={run} />
              ))}
            </ul>
          </ContentFadeIn>
        )}
      </div>
    </div>
  );
}
