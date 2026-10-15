import { ChevronRight, FileText, Layers } from "lucide-react";
import {
  listDraftEvents,
  listLaunchedEvents,
  opportunityKindLabel,
  type OpportunityEvent,
} from "@/lib/opportunity-events-store";
import { DASHBOARD_PREVIEW_LIMIT } from "@/components/dashboard/DashboardCampaignMonitoringPreview";

function formatMeta(row: OpportunityEvent): string {
  if (row.launchedAt) {
    return `Launched ${new Date(row.launchedAt).toLocaleDateString()} · ${row.status}`;
  }
  return `Updated ${new Date(row.updatedAt).toLocaleDateString()} · ${row.status}`;
}

function formatSummary(row: OpportunityEvent): string {
  if (row.kind === "form") {
    return `${row.submissionCount} submissions · ${row.openCount} opens · ${row.formFields.length} fields`;
  }
  if (row.description?.trim()) return row.description.trim();
  return `${opportunityKindLabel(row.kind)} event`;
}

export function pickDashboardEventPreview(
  limit = DASHBOARD_PREVIEW_LIMIT,
): OpportunityEvent[] {
  const launched = listLaunchedEvents();
  const drafts = listDraftEvents();
  return [...launched, ...drafts].slice(0, limit);
}

type Props = {
  onViewAll: () => void;
  onSelectEvent?: (id: string) => void;
};

/**
 * Overview bottom preview — max 5 events; View all opens in-dashboard events tracking.
 */
export function DashboardEventsTrackingPreview({
  onViewAll,
  onSelectEvent,
}: Props) {
  const launched = listLaunchedEvents();
  const drafts = listDraftEvents();
  const preview = pickDashboardEventPreview();

  return (
    <section className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-4 shadow-none sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold capitalize text-neutral-900">
            Events tracking
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-medium text-neutral-600">
            <span className="inline-flex items-center gap-1 rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50 px-2 py-0.5">
              <Layers className="size-3 text-neutral-600" strokeWidth={2.25} />
              {launched.length} Track
            </span>
            <span className="inline-flex items-center gap-1 rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50 px-2 py-0.5">
              <FileText className="size-3 text-neutral-600" strokeWidth={2.25} />
              {drafts.length} Draft
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onViewAll}
          className="shrink-0 text-xs font-medium text-neutral-900 hover:underline"
        >
          View all →
        </button>
      </div>

      {preview.length === 0 ? (
        <p className="mt-4 py-8 text-center text-sm text-neutral-500">
          No opportunity events yet.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-neutral-200 border-t border-neutral-200">
          {preview.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() =>
                  onSelectEvent ? onSelectEvent(row.id) : onViewAll()
                }
                className="flex w-full items-start gap-3 py-3 text-left transition-colors hover:bg-neutral-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-neutral-900">
                      {row.title}
                    </p>
                    <span className="rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
                      {opportunityKindLabel(row.kind)}
                    </span>
                    <span className="rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50 px-2 py-0.5 text-[11px] font-medium capitalize text-neutral-600">
                      {row.status}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-neutral-500">
                    {formatSummary(row)}
                  </p>
                  <p className="mt-1 text-[11px] text-neutral-400">
                    {formatMeta(row)}
                  </p>
                </div>
                <ChevronRight
                  className="mt-1 size-[18px] shrink-0 text-neutral-400"
                  strokeWidth={2.25}
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
