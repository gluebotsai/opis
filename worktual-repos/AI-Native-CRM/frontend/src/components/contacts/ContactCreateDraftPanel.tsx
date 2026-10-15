import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { ArrowLeft } from "lucide-react";
import { ContactFormDuplicateGate } from "@/components/contacts/ContactFormDuplicateGate";
import {
  LEAD_STATUS_FORM_OPTIONS,
  CONTACT_TYPE_FORM_OPTIONS,
} from "@/components/contacts/contact-labels";
import { CoworkerDraftPanel, DraftPanelFrame } from "@/components/coworker/CoworkerCreateShell";
import { GuidedSetupPanel } from "@/components/coworker/GuidedSetupPanel";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { showCompanyOnContacts } from "@/lib/business-type-copy";
import { resolveContactTypeForChannels } from "@/lib/contact-lifecycle";
import { requiredProgress } from "@/lib/coworker/draft-progress";
import {
  contactSetupHeadline,
  contactSetupSteps,
  resolveSetupSteps,
} from "@/lib/coworker/guided-setup-steps";
import type { ContactDraftFields } from "@/services/coworker";
import {
  createContact,
  fetchContactFormOptions,
  findContactDuplicates,
  type DuplicateCandidateView,
} from "@/services/contacts";
import { useAppSelector } from "@/store";

export const NEW_COMPANY = "__new__";

function splitValues(raw: string): string[] {
  return raw
    .split(/[,;\n]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function distinctSecondaryEmails(
  raw: string,
  primary: string,
): string[] {
  const primaryNormalized = primary.trim().toLowerCase();
  return splitValues(raw).filter(
    (value, index, all) =>
      value.toLowerCase() !== primaryNormalized &&
      all.findIndex(
        (candidate) => candidate.toLowerCase() === value.toLowerCase(),
      ) === index,
  );
}

function comparablePhone(value: string): string {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  return digits || trimmed.toLowerCase();
}

function distinctSecondaryPhones(
  raw: string,
  primary: string,
): string[] {
  const primaryComparable = comparablePhone(primary);
  return splitValues(raw).filter(
    (value, index, all) =>
      comparablePhone(value) !== primaryComparable &&
      all.findIndex(
        (candidate) => comparablePhone(candidate) === comparablePhone(value),
      ) === index,
  );
}

function withResolvedContactType(draft: ContactDraftFields): ContactDraftFields {
  const secondaryEmails = distinctSecondaryEmails(
    draft.secondaryEmails,
    draft.email,
  );
  const secondaryPhones = distinctSecondaryPhones(
    draft.secondaryPhones,
    draft.phone,
  );
  return {
    ...draft,
    secondaryEmails: secondaryEmails.join(", "),
    secondaryPhones: secondaryPhones.join(", "),
    contactType: resolveContactTypeForChannels({
      requested: draft.contactType,
      existing: draft.contactType,
      email: draft.email,
      phone: draft.phone,
      secondaryEmails,
      secondaryPhones,
    }),
  };
}

export function emptyContactDraft(): ContactDraftFields {
  return {
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    title: "",
    companyId: "",
    locationId: "",
    companyName: "",
    companyDomain: "",
    companyIndustry: "",
    contactType: "",
    leadStatus: "",
    notes: "",
    city: "",
    country: "",
    addressLine: "",
    leadSource: "crm",
    status: "",
    ownerUserId: "",
    tags: "",
    secondaryEmails: "",
    secondaryPhones: "",
    bantBudget: "",
    bantAuthority: "",
    bantNeed: "",
    bantTimeline: "",
    skippedOptional: "",
  };
}

export type ContactCreateDraftPanelProps = {
  draft: ContactDraftFields;
  onDraftChange: (next: ContactDraftFields) => void;
  onCreated: (contactId: string) => void;
  onCancel?: () => void;
  /** Apply patches from the agent chat */
  patchRef?: MutableRefObject<
    ((patch: Partial<ContactDraftFields>) => void) | null
  >;
  /** Submit create from chat Confirm. Duplicate review stays in chat (no modal);
   * the Create button still uses ContactFormDuplicateGate. Resolves true on
   * success, or a chat message / error string on failure. */
  submitRef?: MutableRefObject<(() => Promise<true | string>) | null>;
  /** Called when chat duplicate review finds candidates (for agent open-by-id). */
  onDuplicatesFound?: (duplicates: DuplicateCandidateView[]) => void;
  /** guided = chat progress panel; form = editable fields (manual / ?form=1) */
  mode?: "guided" | "form";
};

/**
 * Contact create form for in-shell workspace (no chat — agent lives in AgentModuleShell).
 */
export function ContactCreateDraftPanel({
  draft,
  onDraftChange,
  onCreated,
  onCancel,
  patchRef,
  submitRef,
  onDuplicatesFound,
  mode = "guided",
}: ContactCreateDraftPanelProps) {
  const user = useAppSelector((s) => s.auth.user);
  const businessType = user?.businessType ?? "b2b";
  const showCompany = showCompanyOnContacts(businessType);

  const [companies, setCompanies] = useState<
    Array<{
      id: string;
      name: string;
      locations: Array<{ id: string; name: string; type: string }>;
    }>
  >([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dupOpen, setDupOpen] = useState(false);
  const [optsReady, setOptsReady] = useState(false);
  const liveDraftRef = useRef(draft);
  liveDraftRef.current = draft;
  const pendingSubmitRef = useRef<((result: true | string) => void) | null>(
    null,
  );
  /** Chat already warned about duplicates — next chat create may proceed. */
  const chatDupAckRef = useRef(false);
  const dupIdentityKey = `${draft.firstName}|${draft.lastName}|${draft.email}|${draft.phone}`;
  useEffect(() => {
    chatDupAckRef.current = false;
  }, [dupIdentityKey]);

  useEffect(() => {
    let cancelled = false;
    void fetchContactFormOptions()
      .then((opts) => {
        if (cancelled || !opts.ok) return;
        setCompanies(opts.companies);
      })
      .catch(() => setError("Failed to load form options."))
      .finally(() => {
        if (!cancelled) setOptsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const applyPatch = useCallback(
    (patch: Partial<ContactDraftFields>) => {
      const next = { ...draft, ...patch };
      // Agent typed a new company name without picking an existing id → create mode.
      if (
        patch.companyName?.trim() &&
        (patch.companyId === undefined || patch.companyId === "")
      ) {
        next.companyId = NEW_COMPANY;
        next.locationId = "";
      }
      if (
        patch.companyId &&
        patch.companyId !== draft.companyId &&
        patch.companyId !== NEW_COMPANY &&
        !patch.locationId
      ) {
        const c = companies.find((x) => x.id === patch.companyId);
        next.locationId = c?.locations[0]?.id ?? "";
        next.companyName = "";
        next.companyDomain = "";
        next.companyIndustry = "";
      }
      if (patch.companyId === NEW_COMPANY || patch.companyId === "") {
        next.locationId = "";
      }
      onDraftChange(withResolvedContactType(next));
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

  const locations = useMemo(() => {
    if (draft.companyId === NEW_COMPANY) return [];
    const c = companies.find((x) => x.id === draft.companyId);
    return c?.locations ?? [];
  }, [companies, draft.companyId]);

  const creatingCompany = draft.companyId === NEW_COMPANY;

  const progress = requiredProgress([
    Boolean(draft.firstName.trim()),
    Boolean(draft.email.trim()) || Boolean(draft.phone.trim()),
  ]);

  const resolvePending = (result: true | string) => {
    const resolve = pendingSubmitRef.current;
    pendingSubmitRef.current = null;
    resolve?.(result);
  };

  const doCreate = async (): Promise<true | string> => {
    const d = liveDraftRef.current;
    const typedName = d.companyName.trim();
    const selectedId =
      d.companyId && d.companyId !== NEW_COMPANY ? d.companyId : "";
    const matchByName =
      !selectedId && typedName
        ? companies.find(
            (c) => c.name.toLowerCase() === typedName.toLowerCase(),
          )
        : undefined;
    const companyId = selectedId || matchByName?.id || null;
    const creatingNewCompany = !companyId && Boolean(typedName);
    const secondaryEmails = distinctSecondaryEmails(
      d.secondaryEmails,
      d.email,
    );
    const secondaryPhones = distinctSecondaryPhones(
      d.secondaryPhones,
      d.phone,
    );
    if (d.companyId === NEW_COMPANY && !typedName) {
      const msg = "Company name is required when creating a new company.";
      setError(msg);
      resolvePending(msg);
      return msg;
    }
    setSaving(true);
    setError(null);
    const result = await createContact({
      firstName: d.firstName,
      lastName: d.lastName,
      email: d.email,
      phone: d.phone || null,
      title: d.title || null,
      companyId,
      locationId: companyId
        ? d.locationId || matchByName?.locations[0]?.id || null
        : null,
      companyName: creatingNewCompany ? typedName : null,
      companyDomain: creatingNewCompany
        ? d.companyDomain.trim() || null
        : null,
      companyIndustry: creatingNewCompany
        ? d.companyIndustry.trim() || null
        : null,
      contactType: resolveContactTypeForChannels({
        requested: d.contactType,
        existing: "contact",
        email: d.email,
        phone: d.phone,
        secondaryEmails,
        secondaryPhones,
      }),
      leadStatus: d.leadStatus.trim() || "new",
      notes: d.notes || null,
      city: d.city || null,
      country: d.country || null,
      addressLine: d.addressLine || null,
      leadSource: "crm",
      status: d.status || "active",
      ownerUserId: d.ownerUserId.trim() || null,
      tags: d.tags
        .split(/[,;\n]+/)
        .map((t) => t.trim())
        .filter(Boolean),
      secondaryEmails,
      secondaryPhones,
      bantBudget:
        d.bantBudget.trim() === ""
          ? null
          : ["true", "yes", "y", "1"].includes(d.bantBudget.trim().toLowerCase()),
      bantAuthority:
        d.bantAuthority.trim() === ""
          ? null
          : ["true", "yes", "y", "1"].includes(
              d.bantAuthority.trim().toLowerCase(),
            ),
      bantNeed:
        d.bantNeed.trim() === ""
          ? null
          : ["true", "yes", "y", "1"].includes(d.bantNeed.trim().toLowerCase()),
      bantTimeline:
        d.bantTimeline.trim() === ""
          ? null
          : ["true", "yes", "y", "1"].includes(
              d.bantTimeline.trim().toLowerCase(),
            ),
    });
    setSaving(false);
    setDupOpen(false);
    if (!result.ok) {
      setError(result.error);
      const msg = result.error || "Couldn't create contact.";
      resolvePending(msg);
      return msg;
    }
    onCreated(result.id);
    resolvePending(true);
    return true;
  };

  const onCreateClick = () => {
    if (!progress.ready) {
      setError("First name is required.");
      return;
    }
    setDupOpen(true);
  };

  const formatDuplicatesForChat = useCallback(
    (duplicates: DuplicateCandidateView[]) => {
      const lines = duplicates.slice(0, 5).map((dup) => {
        const why = dup.reasons.map((r) => r.label).join("; ");
        const bits = [dup.email, dup.phone, dup.companyName]
          .filter(Boolean)
          .join(" · ");
        return `• **${dup.displayName}**${bits ? ` — ${bits}` : ""}${
          why ? ` (${why})` : ""
        }`;
      });
      const more =
        duplicates.length > 5
          ? `\n• …and ${duplicates.length - 5} more.`
          : "";
      return (
        `I found ${duplicates.length} possible duplicate` +
        `${duplicates.length === 1 ? "" : "s"} before saving:\n` +
        `${lines.join("\n")}${more}\n\n` +
        `Say **save anyway** to create a new contact, or **cancel** to stop. ` +
        `You can also say **open the existing one** to view a duplicate.`
      );
    },
    [],
  );

  const requestCreate = useCallback(async (): Promise<true | string> => {
    const d = liveDraftRef.current;
    if (!d.firstName.trim()) {
      const msg = "Still need first name before I can save.";
      setError(msg);
      return msg;
    }

    if (!d.email.trim() && !d.phone.trim()) {
      const msg = "Email or phone number is required before I can save.";
      setError(msg);
      return msg;
    }

    // Chat path: keep duplicate review in conversation (no modal).
    if (!chatDupAckRef.current) {
      const found = await findContactDuplicates({
        firstName: d.firstName,
        lastName: d.lastName,
        email: d.email,
        phone: d.phone || null,
        companyId: d.companyId || null,
        companyName: d.companyName || null,
        city: d.city || null,
      });
      if (found.ok && found.duplicates.length > 0) {
        chatDupAckRef.current = true;
        onDuplicatesFound?.(found.duplicates);
        const msg = formatDuplicatesForChat(found.duplicates);
        setError(null);
        return msg;
      }
    }
    chatDupAckRef.current = false;
    return doCreate();
    // doCreate closes over latest draft/helpers each render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formatDuplicatesForChat]);

  useEffect(() => {
    if (!submitRef) return;
    submitRef.current = requestCreate;
    return () => {
      submitRef.current = null;
    };
  }, [requestCreate, submitRef]);

  const guidedSteps = useMemo(() => {
    const defs = contactSetupSteps((id) => {
      const c = companies.find((x) => x.id === id);
      return c?.name ?? null;
    }).filter((s) => (s.id === "company" ? showCompany : true));
    return resolveSetupSteps(defs, draft);
  }, [companies, draft, showCompany]);

  if (mode === "guided") {
    return (
      <>
        <GuidedSetupPanel
          setupTitle="Contact setup"
          headline={contactSetupHeadline(draft)}
          steps={guidedSteps}
          essentialsReady={Boolean(
            draft.firstName.trim() &&
              (draft.email.trim() || draft.phone.trim()),
          )}
          error={error}
          onCancel={() => {
            chatDupAckRef.current = false;
            onCancel?.();
          }}
        />
        {dupOpen ? (
          <ContactFormDuplicateGate
            draft={{
              firstName: draft.firstName,
              lastName: draft.lastName,
              email: draft.email,
              phone: draft.phone,
              companyId: draft.companyId,
              companyName: draft.companyName,
              city: draft.city,
            }}
            onContinueSave={() => void doCreate()}
            onCancel={() => {
              setDupOpen(false);
              resolvePending("cancelled");
            }}
          />
        ) : null}
      </>
    );
  }

  return (
    <>
      <DraftPanelFrame>
        <CoworkerDraftPanel
          title="Contact draft"
          progressLabel={`${progress.filled}/${progress.total} ready`}
          progressRatio={progress.ratio}
          footer={
            <>
              <Button
                type="button"
                variant="primary"
                disabled={saving || !progress.ready}
                onClick={onCreateClick}
              >
                {saving ? "Creating…" : "Create contact"}
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
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="First name"
              value={draft.firstName}
              onChange={(e) =>
                onDraftChange({ ...draft, firstName: e.target.value })
              }
            />
            <Input
              label="Last name"
              value={draft.lastName}
              onChange={(e) =>
                onDraftChange({ ...draft, lastName: e.target.value })
              }
            />
          </div>
          <Input
            label="Email"
            type="email"
            value={draft.email}
            onChange={(e) =>
              onDraftChange(
                withResolvedContactType({ ...draft, email: e.target.value }),
              )
            }
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Phone"
              value={draft.phone}
              onChange={(e) =>
                onDraftChange(
                  withResolvedContactType({ ...draft, phone: e.target.value }),
                )
              }
            />
            <Input
              label="Job title"
              value={draft.title}
              onChange={(e) =>
                onDraftChange({ ...draft, title: e.target.value })
              }
            />
          </div>
          {showCompany ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className={creatingCompany ? "sm:col-span-2" : undefined}>
                <Select
                  label="Company"
                  value={draft.companyId}
                  onChange={(e) => {
                    const companyId = e.target.value;
                    if (companyId === NEW_COMPANY) {
                      onDraftChange({
                        ...draft,
                        companyId: NEW_COMPANY,
                        locationId: "",
                      });
                      return;
                    }
                    if (!companyId) {
                      onDraftChange({
                        ...draft,
                        companyId: "",
                        locationId: "",
                        companyName: "",
                        companyDomain: "",
                        companyIndustry: "",
                      });
                      return;
                    }
                    const c = companies.find((x) => x.id === companyId);
                    onDraftChange({
                      ...draft,
                      companyId,
                      companyName: "",
                      companyDomain: "",
                      companyIndustry: "",
                      locationId: c?.locations[0]?.id ?? "",
                    });
                  }}
                  options={
                    !optsReady && companies.length === 0
                      ? [{ value: "", label: "Loading companies…" }]
                      : [
                          { value: "", label: "No company" },
                          ...companies.map((c) => ({
                            value: c.id,
                            label: c.name,
                          })),
                          {
                            value: NEW_COMPANY,
                            label: "+ Create new company…",
                          },
                        ]
                  }
                />
              </div>
              {!creatingCompany ? (
                <Select
                  label="Location"
                  value={draft.locationId}
                  disabled={!draft.companyId}
                  onChange={(e) =>
                    onDraftChange({ ...draft, locationId: e.target.value })
                  }
                  options={[
                    {
                      value: "",
                      label: draft.companyId
                        ? "No location"
                        : "Select a company first",
                    },
                    ...locations.map((l) => ({
                      value: l.id,
                      label: `${l.name} (${l.type})`,
                    })),
                  ]}
                />
              ) : null}
              {creatingCompany ? (
                <>
                  <Input
                    label="New company name"
                    required
                    value={draft.companyName}
                    onChange={(e) =>
                      onDraftChange({ ...draft, companyName: e.target.value })
                    }
                    placeholder="e.g. Acme Industries"
                  />
                  <Input
                    label="Domain"
                    value={draft.companyDomain}
                    onChange={(e) =>
                      onDraftChange({
                        ...draft,
                        companyDomain: e.target.value,
                      })
                    }
                    placeholder="acme.com"
                  />
                  <Input
                    label="Industry"
                    className="sm:col-span-2"
                    value={draft.companyIndustry}
                    onChange={(e) =>
                      onDraftChange({
                        ...draft,
                        companyIndustry: e.target.value,
                      })
                    }
                  />
                  <p className="text-xs text-text-caption sm:col-span-2">
                    A headquarters location is created with the company. You can
                    add more locations from the company page after save.
                  </p>
                </>
              ) : null}
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Contact type"
              value={draft.contactType}
              onChange={(e) =>
                onDraftChange(
                  withResolvedContactType({
                    ...draft,
                    contactType: e.target.value,
                  }),
                )
              }
              options={CONTACT_TYPE_FORM_OPTIONS}
            />
            <Select
              label="Lead status"
              value={draft.leadStatus}
              onChange={(e) =>
                onDraftChange({ ...draft, leadStatus: e.target.value })
              }
              options={LEAD_STATUS_FORM_OPTIONS}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="City"
              value={draft.city}
              onChange={(e) =>
                onDraftChange({ ...draft, city: e.target.value })
              }
            />
            <Input
              label="Country"
              value={draft.country}
              onChange={(e) =>
                onDraftChange({ ...draft, country: e.target.value })
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
      {dupOpen ? (
        <ContactFormDuplicateGate
          draft={{
            firstName: draft.firstName,
            lastName: draft.lastName,
            email: draft.email,
            phone: draft.phone,
            companyId: draft.companyId,
            companyName: draft.companyName,
            city: draft.city,
          }}
          onContinueSave={() => void doCreate()}
          onCancel={() => {
            setDupOpen(false);
            resolvePending("cancelled");
          }}
        />
      ) : null}
    </>
  );
}
