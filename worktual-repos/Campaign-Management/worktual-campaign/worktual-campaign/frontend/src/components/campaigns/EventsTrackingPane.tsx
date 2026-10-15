/** Events tracking pane — Track / Draft tabs for opportunity events. */
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Trash2,
} from "lucide-react";
import { ContentFadeIn } from "@/components/skeleton";
import { Button } from "@/components/ui/Button";
import {
  deleteOpportunityEvent,
  formPublicUrl,
  getOpportunityEvent,
  listDraftEvents,
  listLaunchedEvents,
  opportunityKindLabel,
  updateOpportunityEvent,
  type OpportunityEvent,
  type OpportunityKind,
  type OpportunityStatus,
} from "@/lib/opportunity-events-store";
import { listFormSubmissions, upsertFormSubmissions } from "@/lib/form-submissions-store";
import { fetchPublicFormReplies } from "@/lib/public-forms";

export type EventsTab = "track" | "draft";

const EVENT_TABS: { id: EventsTab; label: string }[] = [
  { id: "track", label: "Track" },
  { id: "draft", label: "Draft" },
];

function parseEventsTab(raw: string | null): EventsTab {
  return raw === "draft" ? "draft" : "track";
}

type Props = {
  /** Deep-link detail (e.g. /events/:eventId). */
  initialEventId?: string | null;
  /** Row highlighted after click — chat focuses on this event. */
  focusedEventId?: string | null;
  /** Track row click → ask co-worker about this event. */
  onFocusEvent?: (event: OpportunityEvent) => void;
  /** Draft row click → open create editor. */
  onOpenDraft?: (eventId: string) => void;
  /** Empty-state primary action (+ menu alternative). */
  onCreateEvent?: (kind: OpportunityKind) => void;
};

function formatTrackMeta(row: OpportunityEvent): string {
  const date = row.launchedAt
    ? new Date(row.launchedAt).toLocaleDateString()
    : "—";
  return `Launched ${date} · ${row.status} · ${opportunityKindLabel(row.kind)}`;
}

function formatTrackSummary(row: OpportunityEvent): string {
  if (row.kind === "form") {
    return `${row.submissionCount} submissions · ${row.openCount} opens · ${row.formFields.length} fields`;
  }
  if (row.description?.trim()) {
    return row.description.trim();
  }
  return `${opportunityKindLabel(row.kind)} event`;
}

function formatDraftMeta(row: OpportunityEvent): string {
  return `Updated ${new Date(row.updatedAt).toLocaleDateString()} · ${row.status} · ${opportunityKindLabel(row.kind)}`;
}

function formatDraftSummary(row: OpportunityEvent): string {
  if (row.description?.trim()) {
    return row.description.trim();
  }
  return "Continue designing this event";
}

/**
 * Events tracking pane — Track / Draft tabs (same UI as campaign monitoring).
 */
export function EventsTrackingPane({
  initialEventId = null,
  focusedEventId = null,
  onFocusEvent,
  onOpenDraft,
  onCreateEvent,
}: Props) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = parseEventsTab(searchParams.get("tab"));
  const [refresh, setRefresh] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialEventId || null,
  );
  void refresh;

  useEffect(() => {
    setSelectedId(initialEventId || null);
  }, [initialEventId]);

  const trackRows = listLaunchedEvents();
  const draftRows = listDraftEvents();
  const rows = tab === "draft" ? draftRows : trackRows;

  const setTab = (next: EventsTab) => {
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (next === "track") n.delete("tab");
        else n.set("tab", next);
        return n;
      },
      { replace: true },
    );
  };

  if (selectedId) {
    return (
      <EventDetailPane
        eventId={selectedId}
        onBack={() => navigate("/events")}
      />
    );
  }

  const emptyHint =
    tab === "draft"
      ? "No draft events yet."
      : "No tracked events yet.";

  const openRow = (row: OpportunityEvent) => {
    if (tab === "draft") {
      if (onOpenDraft) onOpenDraft(row.id);
      else navigate(`/events/create/${row.id}`);
    } else {
      onFocusEvent?.(row);
    }
  };

  const deleteDraft = (row: OpportunityEvent) => {
    if (
      !window.confirm(
        `Delete draft “${row.title}”? This cannot be undone.`,
      )
    ) {
      return;
    }
    deleteOpportunityEvent(row.id);
    setRefresh((t) => t + 1);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-3">
      <div className="mb-3 flex shrink-0 gap-1.5">
        {EVENT_TABS.map(({ id, label }) => {
          const count = id === "draft" ? draftRows.length : trackRows.length;
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${
                active
                  ? "bg-black text-white"
                  : "border border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400"
              }`}
            >
              {label}
              {count > 0 ? (
                <span className={active ? "text-white/80" : "text-neutral-500"}>
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <ContentFadeIn>
            <div className="rounded-2xl border border-dashed border-neutral-200 bg-white px-4 py-10 text-center shadow-sm">
              <p className="text-sm font-medium text-neutral-900">No events</p>
              <p className="mt-1 text-sm text-neutral-500">{emptyHint}</p>
              {onCreateEvent ? (
                <button
                  type="button"
                  onClick={() => onCreateEvent("form")}
                  className="mt-4 inline-flex h-9 items-center justify-center rounded-full bg-black px-4 text-xs font-medium text-white hover:bg-neutral-800"
                >
                  Create event
                </button>
              ) : null}
            </div>
          </ContentFadeIn>
        ) : (
          <ContentFadeIn className="min-h-0 flex-1">
            <ul className="space-y-2">
              {rows.map((row) => {
                const active = tab === "track" && focusedEventId === row.id;
                const meta =
                  tab === "draft"
                    ? formatDraftMeta(row)
                    : formatTrackMeta(row);
                const summary =
                  tab === "draft"
                    ? formatDraftSummary(row)
                    : formatTrackSummary(row);

                return (
                  <li key={row.id}>
                    <div
                      className={`flex w-full items-center gap-2 rounded-2xl border border-neutral-200 bg-white shadow-sm transition-colors hover:bg-neutral-50 ${
                        active ? "ring-2 ring-sky-200 ring-inset" : ""
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => openRow(row)}
                        className="flex min-w-0 flex-1 items-center gap-3 px-3.5 py-3 text-left"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-neutral-900">
                            {row.title}
                          </p>
                          <p className="mt-0.5 truncate text-xs capitalize text-neutral-500">
                            {meta}
                          </p>
                          <p className="mt-1 truncate text-xs text-neutral-700">
                            {summary}
                          </p>
                        </div>
                        <ChevronRight
                          className="size-4 shrink-0 text-neutral-400"
                          strokeWidth={1.75}
                        />
                      </button>
                      {tab === "draft" ? (
                        <button
                          type="button"
                          onClick={() => deleteDraft(row)}
                          className="mr-2 inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-neutral-400 hover:bg-red-50 hover:text-red-600"
                          title="Delete draft"
                          aria-label={`Delete draft ${row.title}`}
                        >
                          <Trash2 className="size-4" strokeWidth={1.75} />
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </ContentFadeIn>
        )}
      </div>
    </div>
  );
}

function EventDetailPane({
  eventId,
  onBack,
}: {
  eventId: string;
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const [tick, setTick] = useState(0);
  const event = getOpportunityEvent(eventId);
  void tick;

  const [copied, setCopied] = useState(false);
  const [submissions, setSubmissions] = useState(() =>
    event?.kind === "form" ? listFormSubmissions(event.id) : [],
  );

  useEffect(() => {
    if (!event || event.kind !== "form") {
      setSubmissions([]);
      return;
    }
    setSubmissions(listFormSubmissions(event.id, event.publicSlug));
    const slug = event.publicSlug;
    if (!slug || !event.launchedAt) return;
    let cancelled = false;
    const load = async () => {
      try {
        const remote = await fetchPublicFormReplies(slug);
        if (cancelled) return;
        upsertFormSubmissions(remote);
        setSubmissions(listFormSubmissions(event.id, slug));
      } catch {
        if (!cancelled) setSubmissions(listFormSubmissions(event.id, slug));
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 8000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [event?.id, event?.kind, event?.publicSlug, event?.launchedAt]);

  if (!event) {
    return (
      <div className="p-4 text-sm text-neutral-500">
        Event not found.{" "}
        <button
          type="button"
          onClick={onBack}
          className="text-neutral-900 underline"
        >
          Back to list
        </button>
      </div>
    );
  }

  const isMonitored =
    Boolean(event.launchedAt) ||
    event.status === "active" ||
    event.status === "ended";

  if (!isMonitored) {
    return (
      <div className="space-y-3 p-4 text-sm text-neutral-500">
        <p>This event is still a draft and is not in Events tracking yet.</p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => navigate(`/events/create/${event.id}`)}
            className="text-neutral-900 underline"
          >
            Open in Create events
          </button>
          <button type="button" onClick={onBack} className="underline">
            Back to list
          </button>
        </div>
      </div>
    );
  }

  const publicUrl =
    event.kind === "form" && event.publicSlug
      ? formPublicUrl(event.publicSlug)
      : null;

  const refresh = () => setTick((t) => t + 1);

  const copyLink = async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const setStatus = (status: OpportunityStatus) => {
    updateOpportunityEvent(event.id, { status });
    refresh();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200 px-3 py-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
        >
          <ArrowLeft className="size-4" strokeWidth={1.75} />
          Back to list
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
              {opportunityKindLabel(event.kind)}
            </p>
            <h2 className="mt-1 text-lg font-semibold text-neutral-900">
              {event.title}
            </h2>
            {event.description ? (
              <p className="mt-2 max-w-xl text-sm text-neutral-600">
                {event.description}
              </p>
            ) : null}
            {event.launchedAt ? (
              <p className="mt-2 text-xs text-neutral-500">
                Launched {new Date(event.launchedAt).toLocaleString()}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-neutral-500">
              <span className="font-medium uppercase tracking-wide">Status</span>
              <select
                value={event.status}
                onChange={(e) =>
                  setStatus(e.target.value as OpportunityStatus)
                }
                className="h-9 rounded-xl border border-neutral-200 bg-white px-3 text-sm capitalize text-neutral-900 outline-none focus:border-neutral-900"
              >
                <option value="active">Active</option>
                <option value="ended">Ended</option>
              </select>
            </label>
            <Button
              type="button"
              variant="secondary"
              className="h-9 text-xs text-red-600"
              onClick={() => {
                if (window.confirm("Delete this event?")) {
                  deleteOpportunityEvent(event.id);
                  onBack();
                }
              }}
            >
              <Trash2 className="mr-1 size-3.5" />
              Delete
            </Button>
          </div>
        </div>

        {event.kind === "form" ? (
          <>
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <StatCard label="Opens" value={event.openCount} />
              <StatCard label="Replies" value={submissions.length} />
              <StatCard label="Fields" value={event.formFields.length} />
            </div>

            {publicUrl ? (
              <div className="mb-4 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3">
                <p className="text-xs font-semibold text-sky-950">
                  Public form URL
                </p>
                <p className="mt-1 break-all font-mono text-sm text-sky-900">
                  {publicUrl}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="brand"
                    className="h-8 text-xs"
                    onClick={() => void copyLink()}
                  >
                    <Copy className="mr-1 size-3.5" />
                    {copied ? "Copied" : "Copy link"}
                  </Button>
                  <a
                    href={publicUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-900 hover:bg-neutral-50"
                  >
                    <ExternalLink className="size-3.5" />
                    Open form
                  </a>
                  <button
                    type="button"
                    onClick={() => navigate(`/events/create/${event.id}`)}
                    className="inline-flex h-8 items-center rounded-lg border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-900 hover:bg-neutral-50"
                  >
                    Edit design
                  </button>
                </div>
              </div>
            ) : null}

            <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-neutral-900">
                Replies ({submissions.length})
              </h3>
              {submissions.length === 0 ? (
                <p className="mt-3 text-sm text-neutral-500">
                  No replies yet. Open the public form and submit a test.
                </p>
              ) : (
                <ul className="mt-3 max-h-[min(560px,50vh)] space-y-2 overflow-y-auto">
                  {submissions.map((s) => (
                    <li
                      key={s.id}
                      className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs"
                    >
                      <p className="text-neutral-500">
                        {new Date(s.createdAt).toLocaleString()}
                      </p>
                      <dl className="mt-1 space-y-0.5 text-neutral-600">
                        {Object.entries(s.answers).map(([k, v]) => (
                          <div key={k}>
                            <span className="font-medium text-neutral-900">
                              {k}:
                            </span>{" "}
                            {v}
                          </div>
                        ))}
                      </dl>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : (
          <div className="rounded-2xl border border-neutral-200 bg-white p-4 text-sm text-neutral-600 shadow-sm">
            <p>
              This is a{" "}
              <span className="font-medium text-neutral-900">
                {opportunityKindLabel(event.kind)}
              </span>{" "}
              opportunity used to time campaigns.
            </p>
            <p className="mt-2 text-xs text-neutral-500">
              Starts:{" "}
              {event.startsAt
                ? new Date(event.startsAt).toLocaleString()
                : "—"}{" "}
              · Ends:{" "}
              {event.endsAt ? new Date(event.endsAt).toLocaleString() : "—"}
            </p>
            <button
              type="button"
              onClick={() => navigate("/campaigns/create")}
              className="mt-4 inline-flex text-sm text-neutral-900 underline"
            >
              Create a campaign for this event
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-neutral-900">{value}</p>
    </div>
  );
}
