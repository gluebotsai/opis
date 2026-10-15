import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MutableRefObject,
} from "react";
import { ArrowLeft } from "lucide-react";
import { CoworkerDraftPanel, DraftPanelFrame } from "@/components/coworker/CoworkerCreateShell";
import { GuidedSetupPanel } from "@/components/coworker/GuidedSetupPanel";
import { ACTIVITY_TYPE_OPTIONS } from "@/lib/activity-type-style";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { requiredProgress } from "@/lib/coworker/draft-progress";
import {
  activitySetupHeadline,
  activitySetupSteps,
  resolveSetupSteps,
} from "@/lib/coworker/guided-setup-steps";
import type { ActivityDraftFields } from "@/services/coworker";
import { createContactActivity } from "@/services/contacts";
import { fetchDealFormOptions } from "@/services/sales";

export function emptyActivityDraft(
  partial?: Partial<ActivityDraftFields>,
): ActivityDraftFields {
  return {
    contactId: "",
    type: "",
    subject: "",
    body: "",
    dueAt: "",
    skippedOptional: "",
    ...partial,
  };
}

export type ActivityLogDraftPanelProps = {
  draft: ActivityDraftFields;
  onDraftChange: (next: ActivityDraftFields) => void;
  onCreated: (activityId: string) => void;
  onCancel?: () => void;
  patchRef?: MutableRefObject<
    ((patch: Partial<ActivityDraftFields>) => void) | null
  >;
  submitRef?: MutableRefObject<(() => Promise<true | string>) | null>;
  mode?: "guided" | "form";
};

/**
 * Activity log form for in-shell workspace (no chat — agent lives in AgentModuleShell).
 */
export function ActivityLogDraftPanel({
  draft,
  onDraftChange,
  onCreated,
  onCancel,
  patchRef,
  submitRef,
  mode = "guided",
}: ActivityLogDraftPanelProps) {
  const [optsReady, setOptsReady] = useState(false);
  const [contacts, setContacts] = useState<
    Array<{ id: string; displayName: string; email: string }>
  >([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchDealFormOptions()
      .then((opts) => {
        if (cancelled || !opts.ok) return;
        setContacts(opts.contacts);
      })
      .catch(() => setError("Failed to load form options."))
      .finally(() => {
        if (!cancelled) setOptsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const progress = requiredProgress([
    Boolean(draft.contactId),
    Boolean(draft.subject.trim()),
  ]);

  const applyPatch = useCallback(
    (patch: Partial<ActivityDraftFields>) => {
      onDraftChange({
        ...draft,
        ...patch,
      });
    },
    [draft, onDraftChange],
  );

  useEffect(() => {
    if (!patchRef) return;
    patchRef.current = applyPatch;
    return () => {
      patchRef.current = null;
    };
  }, [applyPatch, patchRef]);

  const doCreate = useCallback(async (): Promise<true | string> => {
    if (!progress.ready) {
      const msg = "Contact and subject are required.";
      setError(msg);
      return msg;
    }
    setSaving(true);
    setError(null);
    const result = await createContactActivity(draft.contactId, {
      type: draft.type || "note",
      subject: draft.subject.trim(),
      body: draft.body.trim() || null,
      dueAt: draft.dueAt || null,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return result.error || "Couldn't log activity.";
    }
    onCreated(result.id);
    return true;
  }, [draft, onCreated, progress.ready]);

  const requestCreate = useCallback((): Promise<true | string> => {
    if (!progress.ready) {
      const msg = "Contact and subject are required before I can save.";
      setError(msg);
      return Promise.resolve(msg);
    }
    return doCreate();
  }, [doCreate, progress.ready]);

  useEffect(() => {
    if (!submitRef) return;
    submitRef.current = requestCreate;
    return () => {
      submitRef.current = null;
    };
  }, [requestCreate, submitRef]);

  const onCreateClick = () => {
    void doCreate();
  };

  const guidedSteps = useMemo(() => {
    const defs = activitySetupSteps(
      (id) => {
        const c = contacts.find((x) => x.id === id);
        return c ? `${c.displayName} · ${c.email}` : null;
      },
    );
    return resolveSetupSteps(defs, draft);
  }, [contacts, draft]);

  if (mode === "guided") {
    return (
      <GuidedSetupPanel
        setupTitle="Activity setup"
        headline={activitySetupHeadline(draft)}
        steps={guidedSteps}
        error={error}
        onCancel={onCancel}
      />
    );
  }

  return (
    <DraftPanelFrame>
      <CoworkerDraftPanel
        title="Activity draft"
        progressLabel={`${progress.filled}/${progress.total} ready`}
        progressRatio={progress.ratio}
        footer={
          <>
            <Button
              type="button"
              variant="primary"
              disabled={saving || !progress.ready}
              onClick={() => void onCreateClick()}
            >
              {saving ? "Logging…" : "Log activity"}
            </Button>
            {onCancel ? (
                <Button type="button" variant="secondary" onClick={onCancel}>
                  <ArrowLeft className="size-4" strokeWidth={1.75} />
                  Back
                </Button>
            ) : null}
          </>
        }
      >
        <Select
          label="Contact"
          required
          value={draft.contactId}
          onChange={(e) =>
            onDraftChange({ ...draft, contactId: e.target.value })
          }
          options={
            !optsReady && contacts.length === 0
              ? [{ value: "", label: "Loading contacts…" }]
              : [
                  { value: "", label: "Select a contact…" },
                  ...contacts.map((c) => ({
                    value: c.id,
                    label: `${c.displayName} · ${c.email}`,
                  })),
                ]
          }
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Type"
            value={draft.type}
            onChange={(e) => onDraftChange({ ...draft, type: e.target.value })}
            options={[
              { value: "", label: "Select type…" },
              ...ACTIVITY_TYPE_OPTIONS,
            ]}
          />
          <Input
            label="Due"
            type="datetime-local"
            value={draft.dueAt}
            onChange={(e) => onDraftChange({ ...draft, dueAt: e.target.value })}
          />
        </div>
        <Input
          label="Subject"
          required
          value={draft.subject}
          onChange={(e) =>
            onDraftChange({ ...draft, subject: e.target.value })
          }
        />
        <Textarea
          label="Details"
          value={draft.body}
          onChange={(e) => onDraftChange({ ...draft, body: e.target.value })}
        />
        {error ? <p className="text-sm text-text-danger">{error}</p> : null}
      </CoworkerDraftPanel>
    </DraftPanelFrame>
  );
}
