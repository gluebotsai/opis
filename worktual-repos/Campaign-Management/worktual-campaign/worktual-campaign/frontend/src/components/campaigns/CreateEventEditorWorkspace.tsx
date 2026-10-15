import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import {
  Copy,
  ExternalLink,
  Loader2,
  Plus,
  Redo2,
  Rocket,
  Undo2,
} from "lucide-react";
import { CreateEventEditorSkeleton } from "@/components/campaigns/CreateEventEditorSkeleton";
import { FormDesignAgentPanel } from "@/components/events/FormDesignAgentPanel";
import { FormLivePreview } from "@/components/events/FormLivePreview";
import { ModuleSplitWorkspace } from "@/components/layout/ModuleSplitWorkspace";
import { WorkspacePanel } from "@/components/layout/WorkspacePanel";
import { Button } from "@/components/ui/Button";
import {
  discardPendingOpportunityEvent,
  formPublicUrl,
  getOpportunityEvent,
  launchOpportunityEvent,
  opportunityKindLabel,
  persistOpportunityEvent,
  updateOpportunityEvent,
  type FormFieldDef,
  type FormFieldType,
  type FormTheme,
  type OpportunityEvent,
} from "@/lib/opportunity-events-store";
import { appendAgentWork } from "@/lib/agent-work-log-store";
import { publishPublicForm } from "@/lib/public-forms";
import {
  findDraftByFormEventId,
  startCampaignFromFormEvent,
} from "@/lib/start-campaign-from-form";

type DesignSnapshot = {
  title: string;
  description: string;
  thankYouMessage: string;
  formFields: FormFieldDef[];
  theme: FormTheme;
};

type LeftTab = "agent" | "manual";

const FIELD_TYPES: FormFieldType[] = ["text", "email", "tel", "textarea"];

function snapshotFromEvent(event: OpportunityEvent): DesignSnapshot {
  return {
    title: event.title,
    description: event.description,
    thankYouMessage: event.thankYouMessage,
    formFields: event.formFields.map((f) => ({ ...f })),
    theme: { ...event.theme },
  };
}

/**
 * Create campaign → Create event editor (requires :eventId).
 * Forms: design agent chat + optional manual Quick UI + live preview.
 */
export function CreateEventEditorWorkspace() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState<OpportunityEvent | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "missing">(
    "loading",
  );
  const [copied, setCopied] = useState(false);
  const [leftTab, setLeftTab] = useState<LeftTab>("agent");
  const [statusNote, setStatusNote] = useState(
    "Ask the agent to design fields and style — or use Manual for quick edits.",
  );
  const [publishing, setPublishing] = useState(false);
  const [undoStack, setUndoStack] = useState<DesignSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<DesignSnapshot[]>([]);
  const eventRef = useRef<OpportunityEvent | null>(null);

  const refreshEvent = useCallback((id: string) => {
    const next = getOpportunityEvent(id);
    setEvent(next);
    eventRef.current = next;
  }, []);

  const pushUndo = useCallback(() => {
    const current = eventRef.current;
    if (!current) return;
    setUndoStack((prev) => [...prev.slice(-19), snapshotFromEvent(current)]);
    setRedoStack([]);
  }, []);

  const applySnapshot = (snap: DesignSnapshot) => {
    const current = eventRef.current;
    if (!current) return;
    updateOpportunityEvent(current.id, {
      title: snap.title,
      description: snap.description,
      thankYouMessage: snap.thankYouMessage,
      formFields: snap.formFields.map((f) => ({ ...f })),
      theme: { ...snap.theme },
    });
    refreshEvent(current.id);
  };

  const undo = () => {
    const current = eventRef.current;
    if (!current || undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    setRedoStack((s) => [...s, snapshotFromEvent(current)]);
    applySnapshot(prev);
    setStatusNote("Undid last change.");
  };

  const redo = () => {
    const current = eventRef.current;
    if (!current || redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((s) => s.slice(0, -1));
    setUndoStack((s) => [...s, snapshotFromEvent(current)]);
    applySnapshot(next);
    setStatusNote("Redid change.");
  };

  const syncLiveForm = useCallback(async (row: OpportunityEvent) => {
    if (!row.launchedAt || !row.publicSlug) return;
    try {
      await publishPublicForm(row);
    } catch {
      /* live form stays on last successful publish */
    }
  }, []);

  const patchEvent = (
    patch: Parameters<typeof updateOpportunityEvent>[1],
    opts?: { recordUndo?: boolean },
  ) => {
    if (!event) return;
    persistOpportunityEvent(event.id);
    if (opts?.recordUndo) pushUndo();
    updateOpportunityEvent(event.id, patch);
    refreshEvent(event.id);
    const next = getOpportunityEvent(event.id);
    if (next) void syncLiveForm(next);
  };

  const onDesignApplied = useCallback(
    (summary?: string) => {
      if (!eventId) return;
      refreshEvent(eventId);
      setStatusNote(summary || "Form updated from agent.");
      const next = getOpportunityEvent(eventId);
      if (next) void syncLiveForm(next);
    },
    [eventId, refreshEvent, syncLiveForm],
  );

  useEffect(() => {
    if (!eventId) {
      setLoadState("missing");
      setEvent(null);
      return;
    }
    const existing = getOpportunityEvent(eventId);
    if (!existing) {
      setLoadState("missing");
      setEvent(null);
      return;
    }
    setEvent(existing);
    eventRef.current = existing;
    setLoadState("ready");
  }, [eventId]);

  useEffect(() => {
    return () => {
      if (eventId) discardPendingOpportunityEvent(eventId);
    };
  }, [eventId]);

  const onLaunch = async () => {
    if (!event) return;
    if (event.kind !== "form") {
      const ok = window.confirm(
        `Launch this ${opportunityKindLabel(event.kind).toLowerCase()}? It will appear under Events tracking for monitoring.`,
      );
      if (!ok) return;
      const launched = launchOpportunityEvent(event.id);
      if (launched) {
        appendAgentWork({
          agentId: "forms",
          action: "event_launched",
          summary: `Launched ${opportunityKindLabel(launched.kind).toLowerCase()} for tracking`,
          eventId: launched.id,
          eventTitle: launched.title,
          href: `/events/${launched.id}`,
          sourceKey: `event-launch-${launched.id}`,
        });
        navigate(`/events/${launched.id}`);
      }
      return;
    }

    if (event.launchedAt) {
      persistOpportunityEvent(event.id);
      const { path, resumed } = startCampaignFromFormEvent(event);
      appendAgentWork({
        agentId: "forms",
        action: "event_launched",
        summary: resumed
          ? `Continued campaign for form “${event.title}”`
          : `Started campaign chat for form “${event.title}”`,
        eventId: event.id,
        eventTitle: event.title,
        href: path,
        sourceKey: `form-campaign-${event.id}`,
      });
      navigate(path, {
        state: { listHref: `/events/create/${event.id}` },
      });
      return;
    }

    const ok = window.confirm(
      "Looks good? This will publish the form and generate a public URL. Replies will show in Events tracking.",
    );
    if (!ok) return;

    setPublishing(true);
    try {
      const launched = launchOpportunityEvent(event.id);
      if (!launched?.publicSlug) {
        setStatusNote("Could not generate a public URL.");
        return;
      }
      await publishPublicForm(launched);
      refreshEvent(launched.id);
      appendAgentWork({
        agentId: "forms",
        action: "event_launched",
        summary: `Published form “${launched.title}”`,
        eventId: launched.id,
        eventTitle: launched.title,
        href: `/events/${launched.id}`,
        sourceKey: `form-publish-${launched.id}`,
      });
      navigate(`/events/${launched.id}`);
    } catch (err) {
      refreshEvent(event.id);
      setStatusNote(
        err instanceof Error
          ? `${err.message} Start the campaign backend so the public URL works on other devices.`
          : "Could not publish the form. Start the campaign backend and try again.",
      );
    } finally {
      setPublishing(false);
    }
  };

  const copyLink = async () => {
    if (!event?.publicSlug) return;
    const url = formPublicUrl(event.publicSlug);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  if (loadState === "missing") {
    return <Navigate to="/events?tab=draft" replace />;
  }

  if (loadState === "loading" || !event) {
    return <CreateEventEditorSkeleton />;
  }

  if (event.kind !== "form") {
    return (
      <NonFormEventEditor
        event={event}
        onRefresh={() => refreshEvent(event.id)}
        onLaunch={onLaunch}
      />
    );
  }

  const publicUrl =
    event.launchedAt && event.publicSlug
      ? formPublicUrl(event.publicSlug)
      : null;
  const formCampaignDraft = findDraftByFormEventId(event.id);
  const launchLabel = publishing
    ? "Publishing…"
    : event.launchedAt
      ? formCampaignDraft
        ? "Continue campaign"
        : "Create campaign"
      : "Publish form";

  const manualPanel = (
    <div className="overflow-y-auto p-4 sm:p-5">
      <p className="mb-3 text-xs font-semibold tracking-wide text-text-caption uppercase">
        Form details
      </p>
      <label className="mb-3 block text-xs text-text-caption">
        Title
        <input
          value={event.title}
          onChange={(e) => patchEvent({ title: e.target.value })}
          className="mt-1 h-9 w-full rounded-md border border-border-default px-3 text-sm text-text-primary"
        />
      </label>
      <label className="mb-3 block text-xs text-text-caption">
        Description
        <textarea
          value={event.description}
          onChange={(e) => patchEvent({ description: e.target.value })}
          rows={2}
          className="mt-1 w-full rounded-md border border-border-default px-3 py-2 text-sm text-text-primary"
        />
      </label>
      <label className="mb-4 block text-xs text-text-caption">
        Thank-you message
        <textarea
          value={event.thankYouMessage}
          onChange={(e) => patchEvent({ thankYouMessage: e.target.value })}
          rows={2}
          className="mt-1 w-full rounded-md border border-border-default px-3 py-2 text-sm text-text-primary"
        />
      </label>

      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold tracking-wide text-text-caption uppercase">
          Fields
        </p>
        <Button
          type="button"
          variant="secondary"
          className="h-8 text-xs"
          onClick={() => {
            const field: FormFieldDef = {
              id: crypto.randomUUID(),
              label: "New field",
              type: "text",
              required: false,
            };
            patchEvent(
              { formFields: [...event.formFields, field] },
              { recordUndo: true },
            );
            setStatusNote("Added a field.");
          }}
        >
          <Plus className="mr-1 size-3.5" />
          Add field
        </Button>
      </div>

      <ul className="mb-5 space-y-3">
        {event.formFields.length === 0 ? (
          <li className="rounded-lg border border-dashed border-border-default px-3 py-4 text-sm text-text-caption">
            No fields yet. Ask the agent, or click Add field.
          </li>
        ) : null}
        {event.formFields.map((f) => (
          <li
            key={f.id}
            className="rounded-lg border border-border-default p-3"
          >
            <div className="mb-2 flex gap-2">
              <input
                value={f.label}
                onChange={(e) => {
                  patchEvent({
                    formFields: event.formFields.map((x) =>
                      x.id === f.id ? { ...x, label: e.target.value } : x,
                    ),
                  });
                }}
                className="h-8 min-w-0 flex-1 rounded-md border border-border-default px-2 text-sm"
                placeholder="Label"
              />
              <select
                value={f.type}
                onChange={(e) => {
                  patchEvent(
                    {
                      formFields: event.formFields.map((x) =>
                        x.id === f.id
                          ? {
                              ...x,
                              type: e.target.value as FormFieldType,
                            }
                          : x,
                      ),
                    },
                    { recordUndo: true },
                  );
                }}
                className="h-8 rounded-md border border-border-default bg-surface px-2 text-xs"
              >
                {FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <input
              value={f.placeholder || ""}
              onChange={(e) => {
                patchEvent({
                  formFields: event.formFields.map((x) =>
                    x.id === f.id
                      ? { ...x, placeholder: e.target.value }
                      : x,
                  ),
                });
              }}
              className="mb-2 h-8 w-full rounded-md border border-border-default px-2 text-sm"
              placeholder="Placeholder"
            />
            <input
              value={f.defaultValue || ""}
              onChange={(e) => {
                patchEvent({
                  formFields: event.formFields.map((x) =>
                    x.id === f.id
                      ? { ...x, defaultValue: e.target.value }
                      : x,
                  ),
                });
              }}
              className="mb-2 h-8 w-full rounded-md border border-border-default px-2 text-sm"
              placeholder="Default value"
            />
            <div className="flex items-center justify-between">
              <label className="inline-flex items-center gap-2 text-xs text-text-caption">
                <input
                  type="checkbox"
                  checked={f.required}
                  onChange={(e) => {
                    patchEvent(
                      {
                        formFields: event.formFields.map((x) =>
                          x.id === f.id
                            ? { ...x, required: e.target.checked }
                            : x,
                        ),
                      },
                      { recordUndo: true },
                    );
                  }}
                />
                Required
              </label>
              <button
                type="button"
                className="text-xs text-text-danger"
                onClick={() => {
                  patchEvent(
                    {
                      formFields: event.formFields.filter(
                        (x) => x.id !== f.id,
                      ),
                    },
                    { recordUndo: true },
                  );
                  setStatusNote("Removed a field.");
                }}
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>

      <p className="mb-2 text-xs font-semibold tracking-wide text-text-caption uppercase">
        Style
      </p>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs text-text-caption">
          Primary
          <input
            type="color"
            value={event.theme.primaryColor}
            onChange={(e) =>
              patchEvent(
                {
                  theme: {
                    ...event.theme,
                    primaryColor: e.target.value,
                  },
                },
                { recordUndo: true },
              )
            }
            className="mt-1 h-8 w-full cursor-pointer"
          />
        </label>
        <label className="block text-xs text-text-caption">
          Background
          <input
            type="color"
            value={event.theme.backgroundColor}
            onChange={(e) =>
              patchEvent(
                {
                  theme: {
                    ...event.theme,
                    backgroundColor: e.target.value,
                  },
                },
                { recordUndo: true },
              )
            }
            className="mt-1 h-8 w-full cursor-pointer"
          />
        </label>
        <label className="col-span-2 block text-xs text-text-caption">
          Button text
          <input
            value={event.theme.buttonText}
            onChange={(e) =>
              patchEvent({
                theme: { ...event.theme, buttonText: e.target.value },
              })
            }
            className="mt-1 h-8 w-full rounded-md border border-border-default px-2 text-sm"
          />
        </label>
      </div>
    </div>
  );

  return (
    <ModuleSplitWorkspace
      leftFr={40}
      leftTitle="Form co-worker"
      rightTitle="Live preview"
      leftHeaderActions={
        <div className="flex rounded-lg border border-border-default p-0.5 text-[11px]">
          <button
            type="button"
            className={`rounded-md px-2 py-1 font-medium ${
              leftTab === "agent"
                ? "bg-neutral-900 text-white"
                : "text-text-caption hover:text-text-primary"
            }`}
            onClick={() => setLeftTab("agent")}
          >
            Agent
          </button>
          <button
            type="button"
            className={`rounded-md px-2 py-1 font-medium ${
              leftTab === "manual"
                ? "bg-neutral-900 text-white"
                : "text-text-caption hover:text-text-primary"
            }`}
            onClick={() => setLeftTab("manual")}
          >
            Manual
          </button>
        </div>
      }
      rightHeaderActions={
        <div className="flex gap-1">
          <Button
            type="button"
            variant="secondary"
            className="h-7 px-2 text-xs"
            disabled={undoStack.length === 0}
            onClick={undo}
            title="Undo"
          >
            <Undo2 className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="h-7 px-2 text-xs"
            disabled={redoStack.length === 0}
            onClick={redo}
            title="Redo"
          >
            <Redo2 className="size-3.5" />
          </Button>
        </div>
      }
      toolbar={
        <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 rounded-2xl border border-neutral-200 bg-white px-3 py-3 shadow-sm sm:px-4">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-text-primary">
              Create event · Form
            </h1>
            <p className="text-xs text-text-caption">{statusNote}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {publicUrl ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-9 text-xs"
                  onClick={() => void copyLink()}
                >
                  <Copy className="mr-1 size-3.5" />
                  {copied ? "Copied" : "Copy link"}
                </Button>
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-9 items-center gap-1 rounded-xl border border-neutral-200 bg-white px-3 text-xs font-medium shadow-sm hover:bg-neutral-50"
                >
                  <ExternalLink className="size-3.5" />
                  Preview URL
                </a>
              </>
            ) : null}
            <Button
              type="button"
              variant="brand"
              className="h-9"
              onClick={() => void onLaunch()}
              disabled={publishing}
            >
              <Rocket className="mr-1.5 size-4" strokeWidth={1.75} />
              {launchLabel}
            </Button>
          </div>
        </div>
      }
      left={
        leftTab === "agent" ? (
          <FormDesignAgentPanel
            eventId={event.id}
            eventRef={eventRef}
            onBeforeDesignApply={pushUndo}
            onDesignApplied={onDesignApplied}
          />
        ) : (
          manualPanel
        )
      }
      right={<FormLivePreview event={event} />}
    />
  );
}

function NonFormEventEditor({
  event,
  onRefresh,
  onLaunch,
}: {
  event: OpportunityEvent;
  onRefresh: () => void;
  onLaunch: () => void;
}) {
  const kindLabel = opportunityKindLabel(event.kind);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4 sm:p-5">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-text-primary">
            Create event · {kindLabel}
          </h1>
          <p className="text-xs text-text-caption">
            Edit details below. Design tools for this type are not available yet.
          </p>
        </div>
        <Button
          type="button"
          variant="brand"
          className="h-9"
          onClick={onLaunch}
          disabled={Boolean(event.launchedAt)}
        >
          <Rocket className="mr-1.5 size-4" strokeWidth={1.75} />
          {event.launchedAt ? "Launched" : "Launch event"}
        </Button>
      </div>

      <WorkspacePanel className="mx-auto w-full max-w-xl" padded>
        <label className="mb-3 block text-xs text-text-caption">
          Title
          <input
            value={event.title}
            onChange={(e) => {
              updateOpportunityEvent(event.id, { title: e.target.value });
              onRefresh();
            }}
            className="mt-1 h-9 w-full rounded-xl border border-neutral-200 px-3 text-sm text-text-primary"
          />
        </label>
        <label className="block text-xs text-text-caption">
          Description
          <textarea
            value={event.description}
            onChange={(e) => {
              updateOpportunityEvent(event.id, {
                description: e.target.value,
              });
              onRefresh();
            }}
            rows={4}
            className="mt-1 w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm text-text-primary"
          />
        </label>
      </WorkspacePanel>
    </div>
  );
}
