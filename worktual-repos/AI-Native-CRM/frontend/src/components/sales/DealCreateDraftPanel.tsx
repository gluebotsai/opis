import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { ArrowLeft } from "lucide-react";
import {
  DealDuplicateWarning,
  useDealDuplicateCheck,
} from "@/components/sales/DealDuplicateWarning";
import {
  CoworkerDraftPanel,
  DraftPanelFrame,
} from "@/components/coworker/CoworkerCreateShell";
import { GuidedSetupPanel } from "@/components/coworker/GuidedSetupPanel";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { DEAL_STAGE_OPTIONS, normalizeDealStage } from "@/lib/deal-stages";
import { requiredProgress } from "@/lib/coworker/draft-progress";
import { humanLabel, looksLikeBareId } from "@/lib/coworker/human-name";
import {
  dealSetupHeadline,
  dealSetupSteps,
  resolveSetupSteps,
} from "@/lib/coworker/guided-setup-steps";
import type { DealDraftFields } from "@/services/coworker";
import { createCompany, fetchCompanyLocations } from "@/services/companies";
import {
  createDeal,
  fetchDealFormOptions,
  type DealFormOptions,
} from "@/services/sales";

export function emptyDealDraft(
  partial?: Partial<DealDraftFields>,
): DealDraftFields {
  return {
    title: "",
    stage: "",
    amount: "",
    companyId: "",
    companyName: "",
    locationId: "",
    contactId: "",
    contactName: "",
    currency: "",
    notes: "",
    expectedCloseDate: "",
    ...partial,
  };
}

export type DealCreateDraftPanelProps = {
  draft: DealDraftFields;
  onDraftChange: (next: DealDraftFields) => void;
  onCreated: (dealId: string) => void;
  onCancel?: () => void;
  patchRef?: MutableRefObject<
    ((patch: Partial<DealDraftFields>) => void) | null
  >;
  submitRef?: MutableRefObject<(() => Promise<true | string>) | null>;
  mode?: "guided" | "form";
};

/**
 * Deal create form for in-shell workspace (no chat — agent lives in AgentModuleShell).
 */
export function DealCreateDraftPanel({
  draft,
  onDraftChange,
  onCreated,
  onCancel,
  patchRef,
  submitRef,
  mode = "guided",
}: DealCreateDraftPanelProps) {
  const [options, setOptions] = useState<DealFormOptions | null>(null);
  const [optsReady, setOptsReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [companyMenuOpen, setCompanyMenuOpen] = useState(false);
  const skipDupForChatRef = useRef(false);

  const {
    checking: checkingDup,
    duplicates,
    acknowledged: duplicateAck,
    setAcknowledged: setDuplicateAck,
    blocked: duplicateBlocked,
  } = useDealDuplicateCheck({
    enabled: Boolean(draft.companyId),
    companyId: draft.companyId,
    contactId: draft.contactId,
  });

  useEffect(() => {
    let cancelled = false;
    void fetchDealFormOptions()
      .then((opts) => {
        if (cancelled) return;
        setOptions(opts);
        // Sync label if company already chosen (agent seed / restore)
        if (draft.companyId && !humanLabel(draft.companyName)) {
          const match = opts.companies.find((c) => c.id === draft.companyId);
          const name = humanLabel(match?.name);
          if (match && name) {
            onDraftChange({
              ...draft,
              companyName: name,
              locationId: draft.locationId || match.locations[0]?.id || "",
            });
          }
        }
      })
      .catch(() => setError("Failed to load form options."))
      .finally(() => {
        if (!cancelled) setOptsReady(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init once
  }, []);

  const companies = options?.companies ?? [];
  const locations = useMemo(() => {
    const company = companies.find((c) => c.id === draft.companyId);
    return company?.locations ?? [];
  }, [companies, draft.companyId]);

  const contacts = useMemo(() => {
    if (!options) return [];
    return options.contacts.filter(
      (c) => !c.companyId || c.companyId === draft.companyId,
    );
  }, [options, draft.companyId]);

  const companySuggestions = useMemo(() => {
    const q = draft.companyName.trim().toLowerCase();
    const list = q
      ? companies.filter((c) => c.name.toLowerCase().includes(q))
      : companies;
    return list.slice(0, 8);
  }, [companies, draft.companyName]);

  const matchedCompany = useMemo(() => {
    const q = draft.companyName.trim().toLowerCase();
    if (!q) return null;
    return (
      companies.find((c) => c.name.toLowerCase() === q) ??
      (draft.companyId
        ? (companies.find((c) => c.id === draft.companyId) ?? null)
        : null)
    );
  }, [companies, draft.companyId, draft.companyName]);

  const isNewCompany =
    Boolean(draft.companyName.trim()) &&
    !matchedCompany &&
    !draft.companyId;

  useEffect(() => {
    if (!draft.locationId) return;
    if (!locations.some((l) => l.id === draft.locationId)) {
      onDraftChange({ ...draft, locationId: locations[0]?.id ?? "" });
    }
  }, [locations, draft, onDraftChange]);

  const applyPatch = useCallback(
    (patch: Partial<DealDraftFields>) => {
      const next = { ...draft, ...patch };
      if (typeof patch.stage === "string") {
        const resolved = normalizeDealStage(patch.stage);
        if (resolved) next.stage = resolved;
        else next.stage = draft.stage;
      }
      if (patch.companyId && patch.companyId !== draft.companyId) {
        const company = companies.find((c) => c.id === patch.companyId);
        const name = humanLabel(company?.name);
        if (company && name) {
          next.companyName = name;
          if (!patch.locationId) {
            next.locationId = company.locations[0]?.id ?? "";
          }
          if (!patch.contactId) next.contactId = "";
        } else {
          next.companyId = humanLabel(draft.companyName) ? draft.companyId : "";
          next.companyName = humanLabel(draft.companyName) || "";
          if (!next.companyId) next.locationId = "";
        }
      }
      if (
        typeof patch.companyName === "string" &&
        patch.companyName.trim() &&
        !patch.companyId
      ) {
        if (looksLikeBareId(patch.companyName)) {
          next.companyName = humanLabel(draft.companyName) || "";
          if (!next.companyName) {
            next.companyId = "";
            next.locationId = "";
          }
        } else {
          const match = companies.find(
            (c) =>
              c.name.toLowerCase() === patch.companyName!.trim().toLowerCase() &&
              humanLabel(c.name),
          );
          if (match) {
            next.companyId = match.id;
            next.companyName = match.name;
            if (!patch.locationId) {
              next.locationId = match.locations[0]?.id ?? "";
            }
          } else {
            next.companyId = "";
            next.locationId = "";
          }
        }
      }
      onDraftChange(next);
    },
    [companies, draft, onDraftChange],
  );

  useEffect(() => {
    if (!patchRef) return;
    patchRef.current = applyPatch;
    return () => {
      patchRef.current = null;
    };
  }, [applyPatch, patchRef]);

  const progress = requiredProgress([
    Boolean(draft.title.trim()),
    Boolean(draft.companyId || draft.companyName.trim()),
    Boolean(draft.companyId ? draft.locationId : draft.companyName.trim()),
    Boolean(draft.stage),
  ]);

  const pickCompany = (company: (typeof companies)[number]) => {
    onDraftChange({
      ...draft,
      companyId: company.id,
      companyName: company.name,
      contactId: "",
      locationId: company.locations[0]?.id ?? "",
    });
    setCompanyMenuOpen(false);
  };

  const onCompanyNameChange = (value: string) => {
    const match = companies.find(
      (c) => c.name.toLowerCase() === value.trim().toLowerCase(),
    );
    if (match) {
      onDraftChange({
        ...draft,
        companyName: value,
        companyId: match.id,
        locationId: match.locations[0]?.id ?? "",
        contactId: "",
      });
    } else {
      onDraftChange({
        ...draft,
        companyName: value,
        companyId: "",
        locationId: "",
        contactId: "",
      });
    }
    setCompanyMenuOpen(true);
  };

  const doCreate = async (): Promise<true | string> => {
    setError(null);
    const allowDup = skipDupForChatRef.current || !duplicateBlocked;
    skipDupForChatRef.current = false;
    if (!allowDup) {
      const msg =
        "An open deal already exists for this company/contact. Acknowledge the warning on the form, or say continue anyway.";
      setError(msg);
      return msg;
    }
    if (!progress.ready) {
      const msg = "Title and company are required.";
      setError(msg);
      return msg;
    }

    setSaving(true);
    let companyId = draft.companyId;
    let locationId = draft.locationId;

    if (!companyId && draft.companyName.trim()) {
      const existing = companies.find(
        (c) =>
          c.name.toLowerCase() === draft.companyName.trim().toLowerCase(),
      );
      if (existing) {
        companyId = existing.id;
        locationId = existing.locations[0]?.id ?? "";
      } else {
        const created = await createCompany({
          name: draft.companyName.trim(),
          locationName: "Headquarters",
          locationType: "hq",
        });
        if (!created.ok) {
          setSaving(false);
          setError(created.error);
          return created.error || "Couldn't create company.";
        }
        companyId = created.id;
        const locs = await fetchCompanyLocations(companyId).catch(() => null);
        locationId =
          locs && locs.ok
            ? (locs.locations.find((l) => l.type === "hq")?.id ??
              locs.locations[0]?.id ??
              "")
            : "";
        if (!locationId) {
          setSaving(false);
          const msg =
            "Company was created but no location was found. Open the company and add a location, then retry.";
          setError(msg);
          return msg;
        }
      }
    }

    if (!companyId || !locationId) {
      setSaving(false);
      const msg = "Title, company, and location are required.";
      setError(msg);
      return msg;
    }

    const result = await createDeal({
      title: draft.title,
      stage: normalizeDealStage(draft.stage) ?? "qualification",
      amount: draft.amount.trim() ? Number(draft.amount) : null,
      companyId,
      locationId,
      contactId: draft.contactId || null,
      notes: draft.notes || null,
      expectedCloseDate: draft.expectedCloseDate || null,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return result.error || "Couldn't create deal.";
    }
    onCreated(result.id);
    return true;
  };

  const requestCreate = useCallback(async (): Promise<true | string> => {
    if (!progress.ready) {
      const missing: string[] = [];
      if (!draft.title.trim()) missing.push("title");
      if (!draft.companyId && !draft.companyName.trim()) missing.push("company");
      const msg =
        missing.length > 0
          ? `Still need ${missing.join(" and ")} before I can save.`
          : "Title and company are required.";
      setError(msg);
      return msg;
    }
    if (duplicateBlocked) {
      setDuplicateAck(true);
      skipDupForChatRef.current = true;
    }
    return doCreate();
    // doCreate closes over latest draft each render; refresh when essentials change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    progress.ready,
    draft,
    duplicateBlocked,
    setDuplicateAck,
    companies,
    onCreated,
  ]);

  useEffect(() => {
    if (!submitRef) return;
    submitRef.current = requestCreate;
    return () => {
      submitRef.current = null;
    };
  }, [requestCreate, submitRef]);

  const guidedSteps = useMemo(() => {
    const defs = dealSetupSteps(
      (id) => companies.find((c) => c.id === id)?.name ?? null,
      (id) => {
        const c = options?.contacts.find((x) => x.id === id);
        return c?.displayName || c?.email || null;
      },
    );
    return resolveSetupSteps(defs, draft);
  }, [companies, draft, options?.contacts]);

  if (mode === "guided") {
    const dupHint =
      duplicates.length > 0 && !duplicateAck
        ? "An open deal already exists for this company/contact — confirm in chat to continue anyway."
        : null;
    return (
      <GuidedSetupPanel
        setupTitle="Deal setup"
        headline={dealSetupHeadline(draft)}
        steps={guidedSteps}
        error={error || dupHint}
        onCancel={onCancel}
      />
    );
  }

  return (
    <DraftPanelFrame>
      <CoworkerDraftPanel
        title="Deal draft"
        progressLabel={`${progress.filled}/${progress.total} ready`}
        progressRatio={progress.ratio}
        footer={
          <>
            <Button
              type="button"
              variant="primary"
              disabled={saving || checkingDup || !progress.ready}
              onClick={() => void doCreate()}
            >
              {saving ? "Creating…" : "Create deal"}
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
          label="Title"
          value={draft.title}
          onChange={(e) => onDraftChange({ ...draft, title: e.target.value })}
          required
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="relative flex w-full flex-col gap-2">
            <label className="text-sm font-medium text-text-primary">
              Company
            </label>
            <input
              type="text"
              required
              autoComplete="off"
              placeholder={
                !optsReady ? "Loading companies…" : "Type a company name…"
              }
              value={draft.companyName}
              disabled={!optsReady && companies.length === 0}
              onChange={(e) => onCompanyNameChange(e.target.value)}
              onFocus={() => setCompanyMenuOpen(true)}
              onBlur={() => window.setTimeout(() => setCompanyMenuOpen(false), 150)}
              className="h-11 w-full rounded-lg border border-border-default bg-surface px-3 text-sm text-text-primary transition-colors focus:border-border-focus focus:outline-none focus:ring-2 focus:ring-border-focus/20 disabled:bg-neutral-200"
            />
            {companyMenuOpen && optsReady ? (
              <ul className="absolute top-full right-0 left-0 z-30 mt-1 max-h-44 overflow-y-auto rounded-lg border border-border-default bg-surface py-1 shadow-lg">
                {companySuggestions.length === 0 ? (
                  <li className="px-3 py-2 text-xs text-text-caption">
                    {draft.companyName.trim()
                      ? `Create new company “${draft.companyName.trim()}”`
                      : "Start typing to search companies"}
                  </li>
                ) : (
                  companySuggestions.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="flex w-full px-3 py-2 text-left text-sm text-text-primary hover:bg-state-hover"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pickCompany(c)}
                      >
                        {c.name}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
            {isNewCompany ? (
              <p className="text-xs text-text-caption">
                New company — we’ll create it with an HQ when you save the deal.
              </p>
            ) : null}
          </div>
          {draft.companyId ? (
            <Select
              label="Location"
              required
              value={draft.locationId}
              onChange={(e) =>
                onDraftChange({ ...draft, locationId: e.target.value })
              }
              options={
                locations.length > 0
                  ? locations.map((l) => ({
                      value: l.id,
                      label: `${l.name} (${l.type === "hq" ? "HQ" : "Branch"})`,
                    }))
                  : [{ value: "", label: "No locations — add one first" }]
              }
            />
          ) : (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-text-primary">
                Location
              </span>
              <p className="flex h-11 items-center rounded-lg border border-border-default bg-neutral-200 px-3 text-sm text-text-secondary">
                {isNewCompany ? "Headquarters (new)" : "Pick a company first"}
              </p>
            </div>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Contact"
            value={draft.contactId}
            onChange={(e) =>
              onDraftChange({ ...draft, contactId: e.target.value })
            }
            options={[
              { value: "", label: "No contact" },
              ...contacts.map((c) => ({
                value: c.id,
                label: `${c.displayName} · ${c.email}`,
              })),
            ]}
          />
          <Select
            label="Stage"
            value={draft.stage}
            onChange={(e) => onDraftChange({ ...draft, stage: e.target.value })}
            options={DEAL_STAGE_OPTIONS}
          />
        </div>

        <DealDuplicateWarning
          checking={checkingDup}
          duplicates={duplicates}
          acknowledged={duplicateAck}
          onAcknowledge={() => {
            setDuplicateAck(true);
            setError(null);
          }}
          onNavigateAway={onCancel}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Amount"
            type="number"
            min={0}
            step="0.01"
            value={draft.amount}
            onChange={(e) =>
              onDraftChange({ ...draft, amount: e.target.value })
            }
          />
          <Input
            label="Expected close date"
            type="date"
            value={draft.expectedCloseDate}
            onChange={(e) =>
              onDraftChange({ ...draft, expectedCloseDate: e.target.value })
            }
          />
        </div>
        <Textarea
          label="Notes"
          value={draft.notes}
          onChange={(e) => onDraftChange({ ...draft, notes: e.target.value })}
        />
        {error ? <p className="text-sm text-text-danger">{error}</p> : null}
      </CoworkerDraftPanel>
    </DraftPanelFrame>
  );
}
