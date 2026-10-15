import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MutableRefObject,
} from "react";
import { ArrowLeft } from "lucide-react";
import {
  CoworkerDraftPanel,
  DraftPanelFrame,
} from "@/components/coworker/CoworkerCreateShell";
import { GuidedSetupPanel } from "@/components/coworker/GuidedSetupPanel";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { requiredProgress } from "@/lib/coworker/draft-progress";
import {
  locationSetupHeadline,
  locationSetupSteps,
  resolveSetupSteps,
} from "@/lib/coworker/guided-setup-steps";
import type { LocationDraftFields } from "@/services/coworker";
import { createLocation, fetchLocationFormOptions } from "@/services/companies";

export function emptyLocationDraft(_hasHq = false): LocationDraftFields {
  return {
    name: "",
    type: "",
    address: "",
    industry: "",
  };
}

export type LocationCreateDraftPanelProps = {
  companyId: string;
  draft: LocationDraftFields;
  onDraftChange: (next: LocationDraftFields) => void;
  onCreated: (locationId: string) => void;
  onCancel?: () => void;
  /** Known from company detail list — form opens immediately without waiting. */
  hasHq?: boolean;
  patchRef?: MutableRefObject<
    ((patch: Partial<LocationDraftFields>) => void) | null
  >;
  mode?: "guided" | "form";
};

/**
 * Location create form for in-shell workspace on company detail.
 * Renders immediately; owner options load in the background.
 */
export function LocationCreateDraftPanel({
  companyId,
  draft,
  onDraftChange,
  onCreated,
  onCancel,
  hasHq: hasHqProp = false,
  patchRef,
  mode = "guided",
}: LocationCreateDraftPanelProps) {
  const [hasHq, setHasHq] = useState(hasHqProp);
  const [canAssignOwner, setCanAssignOwner] = useState(false);
  const [assignableUsers, setAssignableUsers] = useState<
    Array<{ id: string; label: string }>
  >([]);
  const [ownerUserId, setOwnerUserId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHasHq(hasHqProp);
  }, [hasHqProp]);

  useEffect(() => {
    let cancelled = false;
    void fetchLocationFormOptions(companyId)
      .then((opts) => {
        if (cancelled || !opts.ok) {
          if (!cancelled && opts && !opts.ok) setError(opts.error);
          return;
        }
        setHasHq(opts.hasHq);
        setCanAssignOwner(opts.canAssignOwner);
        setAssignableUsers(opts.assignableUsers);
        setOwnerUserId(opts.currentUserId ?? "");
      })
      .catch(() => {
        /* Form stays usable; owner picker just won't appear. */
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const canChooseHq = !hasHq;

  useEffect(() => {
    if (hasHq && draft.type === "hq") {
      onDraftChange({ ...draft, type: "branch" });
    }
    // Sync type once HQ constraint is known
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHq]);

  const applyPatch = useCallback(
    (patch: Partial<LocationDraftFields>) => {
      const next = { ...draft, ...patch };
      if (!canChooseHq) next.type = "branch";
      onDraftChange(next);
    },
    [canChooseHq, draft, onDraftChange],
  );

  useEffect(() => {
    if (!patchRef) return;
    patchRef.current = applyPatch;
    return () => {
      patchRef.current = null;
    };
  }, [applyPatch, patchRef]);

  const progress = requiredProgress([Boolean(draft.name.trim())]);

  const ownerOptions = useMemo(() => {
    const options = assignableUsers.map((u) => ({
      value: u.id,
      label: u.label,
    }));
    if (ownerUserId && !options.some((o) => o.value === ownerUserId)) {
      options.unshift({ value: ownerUserId, label: "Current owner" });
    }
    return options;
  }, [assignableUsers, ownerUserId]);

  const doCreate = async () => {
    if (!progress.ready) {
      setError("Location name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    const result = await createLocation(companyId, {
      name: draft.name.trim(),
      type:
        (canChooseHq ? draft.type : "branch") === "branch" ? "branch" : "hq",
      address: draft.address.trim() || null,
      industry: draft.industry.trim() || null,
      ownerUserId: ownerUserId || null,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onCreated(result.id);
  };

  const guidedSteps = useMemo(
    () => resolveSetupSteps(locationSetupSteps, draft),
    [draft],
  );

  if (mode === "guided") {
    return (
      <GuidedSetupPanel
        setupTitle="Location setup"
        headline={locationSetupHeadline(draft)}
        steps={guidedSteps}
        error={error}
        onCancel={onCancel}
      />
    );
  }

  return (
    <DraftPanelFrame>
      <CoworkerDraftPanel
        title="Location draft"
        progressLabel={`${progress.filled}/${progress.total} ready`}
        progressRatio={progress.ratio}
        footer={
          <>
            <Button
              type="button"
              variant="primary"
              disabled={saving || !progress.ready}
              onClick={() => void doCreate()}
            >
              {saving ? "Creating…" : "Create location"}
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
        <Input
          label="Location name"
          required
          placeholder="e.g. Bengaluru"
          value={draft.name}
          onChange={(e) => onDraftChange({ ...draft, name: e.target.value })}
        />
        {canChooseHq ? (
          <Select
            label="Type"
            value={draft.type}
            onChange={(e) =>
              onDraftChange({
                ...draft,
                type: e.target.value as "hq" | "branch" | "",
              })
            }
            options={[
              { value: "", label: "Select type…" },
              { value: "hq", label: "HQ" },
              { value: "branch", label: "Branch" },
            ]}
          />
        ) : (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-text-primary">Type</span>
            <p className="flex h-11 items-center rounded-lg border border-border-default bg-neutral-200 px-3 text-sm text-text-secondary">
              Branch
              <span className="ml-2 text-xs text-text-caption">
                (HQ already exists)
              </span>
            </p>
          </div>
        )}
        <Input
          label="Address"
          placeholder="e.g. Whitefield, Bengaluru"
          value={draft.address}
          onChange={(e) =>
            onDraftChange({ ...draft, address: e.target.value })
          }
        />
        <Input
          label="Industry"
          value={draft.industry}
          onChange={(e) =>
            onDraftChange({ ...draft, industry: e.target.value })
          }
        />
        {canAssignOwner && ownerOptions.length > 0 ? (
          <Select
            label="Owner"
            value={ownerUserId}
            onChange={(e) => setOwnerUserId(e.target.value)}
            options={ownerOptions}
          />
        ) : null}
        {error ? <p className="text-sm text-text-danger">{error}</p> : null}
      </CoworkerDraftPanel>
    </DraftPanelFrame>
  );
}
