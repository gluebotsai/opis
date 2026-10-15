import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { ArrowLeft } from "lucide-react";
import { CoworkerDraftPanel, DraftPanelFrame } from "@/components/coworker/CoworkerCreateShell";
import { GuidedSetupPanel } from "@/components/coworker/GuidedSetupPanel";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { requiredProgress } from "@/lib/coworker/draft-progress";
import {
  companySetupHeadline,
  companySetupSteps,
  resolveSetupSteps,
} from "@/lib/coworker/guided-setup-steps";
import type { CompanyDraftFields } from "@/services/coworker";
import { createCompany, fetchCompanyFormOptions } from "@/services/companies";

export async function saveCompanyDraft(
  draft: CompanyDraftFields,
  ownerFallback?: string | null,
) {
  if (!draft.name.trim() || !draft.locationName.trim()) {
    const missing: string[] = [];
    if (!draft.name.trim()) missing.push("company name");
    if (!draft.locationName.trim()) missing.push("first location name");
    return {
      ok: false as const,
      error:
        missing.length > 0
          ? `Still need ${missing.join(" and ")} before I can save.`
          : "Company name and first location name are required.",
    };
  }
  return createCompany({
    name: draft.name.trim(),
    domain: draft.domain.trim() || null,
    industry: draft.industry.trim() || null,
    employeeCount: draft.employeeCount.trim() ? Number(draft.employeeCount) : null,
    linkedinUrl: draft.linkedinUrl.trim() || null,
    ownerUserId: draft.ownerUserId.trim() || ownerFallback || null,
    channelRole: draft.channelRole.trim() || null,
    parentCompanyId: draft.parentCompanyId.trim() || null,
    locationName: draft.locationName.trim(),
    locationAddress: draft.locationAddress.trim() || null,
    locationType: draft.locationType === "branch" ? "branch" : "hq",
  });
}

export function emptyCompanyDraft(): CompanyDraftFields {
  return {
    name: "",
    domain: "",
    industry: "",
    locationName: "",
    locationAddress: "",
    locationType: "",
    employeeCount: "",
    linkedinUrl: "",
    ownerUserId: "",
    channelRole: "",
    parentCompanyId: "",
  };
}

export type CompanyCreateDraftPanelProps = {
  draft: CompanyDraftFields;
  onDraftChange: (next: CompanyDraftFields) => void;
  onCreated: (companyId: string) => void;
  onCancel?: () => void;
  patchRef?: MutableRefObject<
    ((patch: Partial<CompanyDraftFields>) => void) | null
  >;
  /** Submit create from chat Confirm. Resolves true or an error string. */
  submitRef?: MutableRefObject<(() => Promise<true | string>) | null>;
  /** Fired when create fails because a company with this name already exists. */
  onDuplicate?: (existingId: string) => void;
  mode?: "guided" | "form";
};

/**
 * Company create form for in-shell workspace (no chat — agent lives in AgentModuleShell).
 */
export function CompanyCreateDraftPanel({
  draft,
  onDraftChange,
  onCreated,
  onCancel,
  patchRef,
  submitRef,
  onDuplicate,
  mode = "guided",
}: CompanyCreateDraftPanelProps) {
  const [canAssignOwner, setCanAssignOwner] = useState(false);
  const [assignableUsers, setAssignableUsers] = useState<
    Array<{ id: string; label: string }>
  >([]);
  const [ownerUserId, setOwnerUserId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    let cancelled = false;
    void fetchCompanyFormOptions()
      .then((opts) => {
        if (cancelled || !opts.ok) return;
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
  }, []);

  const applyPatch = useCallback(
    (patch: Partial<CompanyDraftFields>) => {
      // Merge onto the latest draft — closing over `draft` wiped fields when
      // chat applied a patch then auto-create in the same turn.
      const next = { ...draftRef.current, ...patch };
      draftRef.current = next;
      onDraftChange(next);
    },
    [onDraftChange],
  );

  useEffect(() => {
    if (!patchRef) return;
    patchRef.current = applyPatch;
    return () => {
      patchRef.current = null;
    };
  }, [applyPatch, patchRef]);

  const progress = requiredProgress([
    Boolean(draft.name.trim()),
    Boolean(draft.locationName.trim()),
  ]);

  const ownerOptions = useMemo(() => {
    const options = assignableUsers.map((u) => ({ value: u.id, label: u.label }));
    if (ownerUserId && !options.some((o) => o.value === ownerUserId)) {
      options.unshift({ value: ownerUserId, label: "Current owner" });
    }
    return options;
  }, [assignableUsers, ownerUserId]);

  const doCreate = useCallback(async (): Promise<true | string> => {
    const current = draftRef.current;
    setSaving(true);
    setError(null);
    const result = await saveCompanyDraft(current, ownerUserId);
    setSaving(false);
    if (!result.ok) {
      const msg = result.error || "Couldn't create company.";
      setError(msg);
      if (result.existingId) onDuplicate?.(result.existingId);
      return msg;
    }
    onCreated(result.id);
    return true;
  }, [onCreated, onDuplicate, ownerUserId]);

  useEffect(() => {
    if (!submitRef) return;
    submitRef.current = () => doCreate();
    return () => {
      submitRef.current = null;
    };
  }, [doCreate, submitRef]);

  const guidedSteps = useMemo(
    () => resolveSetupSteps(companySetupSteps, draft),
    [draft],
  );

  if (mode === "guided") {
    return (
      <GuidedSetupPanel
        setupTitle="Company setup"
        headline={companySetupHeadline(draft)}
        steps={guidedSteps}
        error={error}
        onCancel={onCancel}
      />
    );
  }

  return (
    <DraftPanelFrame>
      <CoworkerDraftPanel
        title="Company draft"
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
              {saving ? "Creating…" : "Create company"}
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
          label="Company name"
          required
          value={draft.name}
          onChange={(e) => onDraftChange({ ...draft, name: e.target.value })}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Company domain"
            placeholder="e.g. acme.com"
            value={draft.domain}
            onChange={(e) =>
              onDraftChange({ ...draft, domain: e.target.value })
            }
          />
          <Input
            label="Industry"
            value={draft.industry}
            onChange={(e) =>
              onDraftChange({ ...draft, industry: e.target.value })
            }
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="First location"
            required
            placeholder="e.g. Mumbai"
            value={draft.locationName}
            onChange={(e) =>
              onDraftChange({ ...draft, locationName: e.target.value })
            }
          />
          <Select
            label="Location type"
            value={draft.locationType}
            onChange={(e) =>
              onDraftChange({
                ...draft,
                locationType: e.target.value as "hq" | "branch" | "",
              })
            }
            options={[
              { value: "", label: "Select type…" },
              { value: "hq", label: "HQ" },
              { value: "branch", label: "Branch" },
            ]}
          />
        </div>
        <Input
          label="Location address"
          placeholder="e.g. Nariman Point, Mumbai"
          value={draft.locationAddress}
          onChange={(e) =>
            onDraftChange({ ...draft, locationAddress: e.target.value })
          }
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Company size"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            placeholder="e.g. 250"
            value={draft.employeeCount}
            onChange={(e) =>
              onDraftChange({ ...draft, employeeCount: e.target.value })
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
        </div>
        <Input
          label="LinkedIn URL"
          placeholder="e.g. https://www.linkedin.com/company/acme"
          value={draft.linkedinUrl}
          onChange={(e) =>
            onDraftChange({ ...draft, linkedinUrl: e.target.value })
          }
        />
        {error ? <p className="text-sm text-text-danger">{error}</p> : null}
      </CoworkerDraftPanel>
    </DraftPanelFrame>
  );
}
