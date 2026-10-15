import { useState } from "react";
import type { DealHistoryEntry } from "@/services/sales";

const PREVIEW_LIMIT = 5;

export function DealHistoryPanel({
  entries,
  embedded = false,
}: {
  entries: DealHistoryEntry[];
  /** When true, omit outer margin/title (parent tab supplies chrome). */
  embedded?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const preview = entries.slice(0, PREVIEW_LIMIT);
  const hasMore = entries.length > PREVIEW_LIMIT;

  return (
    <section className={embedded ? undefined : "mt-10"}>
      {!embedded ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-text-primary">
              Deal history
            </h2>
            <p className="mt-1 text-sm text-text-caption">
              Stage, value, owner, contact, and company changes · newest first
              {entries.length > 0 ? ` · ${entries.length} total` : null}
            </p>
          </div>
          {hasMore ? (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="text-sm font-medium text-text-link hover:underline"
            >
              View more
            </button>
          ) : null}
        </div>
      ) : null}

      <ul
        className={`${embedded ? "mt-0" : "mt-4"} divide-y divide-border-default overflow-hidden rounded-xl border border-border-default bg-surface`}
      >
        {entries.length === 0 ? (
          <li className="px-5 py-8 text-center text-sm text-text-caption">
            No history yet — stage, value, owner, contact, and company changes
            will appear here.
          </li>
        ) : (
          preview.map((entry) => <HistoryRow key={entry.id} entry={entry} />)
        )}
      </ul>

      {hasMore ? (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex h-9 items-center rounded-lg border border-border-default bg-surface px-4 text-sm font-medium text-text-secondary hover:border-border-focus/40"
          >
            View more ({entries.length - PREVIEW_LIMIT} older)
          </button>
        </div>
      ) : null}

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="deal-history-dialog-title"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border-default bg-surface shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-border-default px-5 py-4">
              <div>
                <h3
                  id="deal-history-dialog-title"
                  className="text-base font-semibold text-text-primary"
                >
                  Deal history
                </h3>
                <p className="mt-1 text-sm text-text-caption">
                  All {entries.length} changes · scroll for older entries
                </p>
              </div>
              <button
                type="button"
                className="text-sm text-text-caption hover:text-text-primary"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
            <ul className="min-h-0 flex-1 divide-y divide-border-default overflow-y-auto">
              {entries.map((entry) => (
                <HistoryRow key={entry.id} entry={entry} />
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function HistoryRow({ entry }: { entry: DealHistoryEntry }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-text-primary">{entry.summary}</p>
        <p className="mt-1 text-xs text-text-caption">{entry.actorLabel}</p>
      </div>
      <time
        className="shrink-0 text-xs text-text-caption"
        dateTime={entry.createdAt}
      >
        {new Date(entry.createdAt).toLocaleString()}
      </time>
    </li>
  );
}
