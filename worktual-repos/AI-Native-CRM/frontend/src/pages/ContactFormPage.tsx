import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { BackLink } from "@/components/ui/BackLink";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Checkbox } from "@/components/ui/Checkbox";
import { Textarea } from "@/components/ui/Textarea";
import {
  LEAD_STATUS_FORM_OPTIONS,
  CONTACT_TYPE_FORM_OPTIONS,
  STATUS_FORM_OPTIONS,
} from "@/components/contacts/contact-labels";
import {
  contactCreateCaption,
  showBantOnContact,
  showCompanyOnContacts,
} from "@/lib/business-type-copy";
import { reconcileLeadStatusWithContactType, resolveContactTypeForChannels } from "@/lib/contact-lifecycle";
import {
  createContact,
  fetchContactFormOptions,
  updateContact,
} from "@/services/contacts";
import type { ContactInput } from "@/services/contact-types";
import { ContactMultiValueInput } from "@/components/contacts/ContactMultiValueInput";
import { ContactFormDuplicateGate } from "@/components/contacts/ContactFormDuplicateGate";
import { ContactFormPageSkeleton } from "./ContactFormPageSkeleton";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";
import { COWORKER_WORKSPACE_SCROLL } from "@/components/coworker/coworker-layout";

type CompanyOption = {
  id: string;
  name: string;
  industry: string | null;
  ownerUserId: string | null;
  locations: Array<{
    id: string;
    name: string;
    type: string;
    ownerUserId: string | null;
  }>;
};

const NEW_COMPANY = "__new__";

/** Matches the bant_*_detail columns, which are VarChar(160). */
const BANT_DETAIL_MAX = 160;

const BANT_CRITERIA = [
  {
    key: "bantBudget",
    detailKey: "bantBudgetDetail",
    label: "Budget",
    placeholder: "What budget did they name?",
  },
  {
    key: "bantAuthority",
    detailKey: "bantAuthorityDetail",
    label: "Authority",
    placeholder: "Who signs it off?",
  },
  {
    key: "bantNeed",
    detailKey: "bantNeedDetail",
    label: "Need",
    placeholder: "What problem are they solving?",
  },
  {
    key: "bantTimeline",
    detailKey: "bantTimelineDetail",
    label: "Timeline",
    placeholder: "When do they want it live?",
  },
] as const satisfies ReadonlyArray<{
  key: keyof ContactInput;
  detailKey: keyof ContactInput;
  label: string;
  placeholder: string;
}>;

const emptyForm: ContactInput = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  title: "",
  companyId: null,
  companyName: "",
  companyDomain: "",
  companyIndustry: "",
  locationId: null,
  ownerUserId: null,
  contactType: "contact",
  leadStatus: "new",
  status: "active",
  notes: "",
  addressLine: "",
  city: "",
  country: "",
  leadSource: "crm",
  secondaryEmails: [],
  secondaryPhones: [],
  bantBudget: false,
  bantAuthority: false,
  bantNeed: false,
  bantTimeline: false,
  bantBudgetDetail: "",
  bantAuthorityDetail: "",
  bantNeedDetail: "",
  bantTimelineDetail: "",
  tags: [],
  customAttributes: {},
};

export function ContactFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const prefillCompanyId = searchParams.get("companyId") ?? "";
  const prefillLocationId = searchParams.get("locationId") ?? "";

  // Create: show form immediately. Edit: wait for contact data.
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [businessType, setBusinessType] = useState<"b2b" | "b2c" | "b2b2c">(
    "b2b",
  );
  const [canAssignOwner, setCanAssignOwner] = useState(false);
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [assignableUsers, setAssignableUsers] = useState<
    Array<{ id: string; label: string; role?: string }>
  >([]);
  const [ownerChangeReason, setOwnerChangeReason] = useState("");
  const [existingOwnerUserId, setExistingOwnerUserId] = useState<
    string | null
  >(null);
  const [contactDisplayName, setContactDisplayName] = useState<string | null>(
    null,
  );
  const [linkedCompanyFallback, setLinkedCompanyFallback] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [verticalFields, setVerticalFields] = useState<
    Array<{
      key: string;
      label: string;
      type: string;
      required?: boolean;
      placeholder?: string;
    }>
  >([]);

  const [form, setForm] = useState<ContactInput>(() => ({
    ...emptyForm,
    locationId: prefillLocationId || null,
  }));
  const [companyMode, setCompanyMode] = useState(prefillCompanyId); // "", NEW_COMPANY, or a company id
  const [tagsInput, setTagsInput] = useState("");
  const [pendingPayload, setPendingPayload] = useState<ContactInput | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isEdit) setLoading(true);
      setError(null);
      try {
        const result = await fetchContactFormOptions(id);
        if (cancelled) return;
        if (!result.ok) {
          setError("Failed to load form.");
          return;
        }
        setBusinessType(result.businessType);
        setCanAssignOwner(result.canAssignOwner);
        setCurrentUserRole(result.currentUserRole ?? null);
        setCurrentUserId(result.currentUserId);
        setCompanies(result.companies);
        setAssignableUsers(result.assignableUsers);
        setVerticalFields(result.contactVerticalFields ?? []);

        const contact = result.contact;
        const p = contact?.person;

        // Create: hydrate options only — do not wipe fields the user may already be typing.
        if (!isEdit) {
          const validPrefillCompany =
            prefillCompanyId &&
            result.companies.some((c) => c.id === prefillCompanyId)
              ? prefillCompanyId
              : "";

          setCompanyMode((prev) => {
            if (prev === NEW_COMPANY) return prev;
            if (prev && prev !== prefillCompanyId) return prev;
            return validPrefillCompany;
          });

          setForm((prev) => {
            const companyIdForLoc =
              (prev.companyId &&
              result.companies.some((c) => c.id === prev.companyId)
                ? prev.companyId
                : null) ||
              validPrefillCompany ||
              "";
            const companyForLocation = result.companies.find(
              (c) => c.id === companyIdForLoc,
            );
            const locationStillValid =
              prev.locationId &&
              companyForLocation?.locations.some(
                (loc) => loc.id === prev.locationId,
              );
            const nextLocationId = locationStillValid
              ? prev.locationId
              : prefillLocationId &&
                  companyForLocation?.locations.some(
                    (loc) => loc.id === prefillLocationId,
                  )
                ? prefillLocationId
                : null;

            return {
              ...prev,
              title:
                prev.title ||
                (result.businessType === "b2c" ? "Customer" : ""),
              locationId: nextLocationId,
            };
          });
          return;
        }

        const crmOwnerUserId = contact?.crm.ownerUserId ?? p?.ownerUserId ?? null;
        setExistingOwnerUserId(crmOwnerUserId);
        setContactDisplayName(contact?.displayName ?? null);

        if (p?.companyId && !result.companies.some((c) => c.id === p.companyId)) {
          setLinkedCompanyFallback({
            id: p.companyId,
            name: p.company?.name ?? "Linked company",
          });
        } else {
          setLinkedCompanyFallback(null);
        }

        const initialCompanyMode = p?.companyId
          ? p.companyId
          : p?.company?.name
            ? NEW_COMPANY
            : prefillCompanyId &&
                result.companies.some((c) => c.id === prefillCompanyId)
              ? prefillCompanyId
              : "";
        setCompanyMode(initialCompanyMode);

        const companyForLocation = result.companies.find(
          (c) => c.id === initialCompanyMode,
        );
        const initialLocationId = p?.locationId
          ? p.locationId
          : prefillLocationId &&
              companyForLocation?.locations.some(
                (loc) => loc.id === prefillLocationId,
              )
            ? prefillLocationId
            : "";

        const initialLifecycle = p?.contactType ?? "contact";
        const initialLeadStatus = reconcileLeadStatusWithContactType(
          initialLifecycle,
          p?.leadStatus ?? "new",
        );

        const selectedLocation = companyForLocation?.locations.find(
          (loc) => loc.id === initialLocationId,
        );
        const locationOwnerId =
          selectedLocation?.ownerUserId?.trim() ||
          companyForLocation?.ownerUserId?.trim() ||
          null;
        const salesCreatesOwn =
          result.currentUserRole === "sales_rep" && !id;
        const initialOwnerUserId =
          initialLifecycle === "lead"
            ? result.canAssignOwner
              ? crmOwnerUserId?.trim() || ""
              : salesCreatesOwn
                ? result.currentUserId || ""
                : ""
            : crmOwnerUserId?.trim() ||
              locationOwnerId ||
              (salesCreatesOwn ? result.currentUserId : "") ||
              "";

        setTagsInput((p?.tags ?? []).join(", "));
        setForm({
          firstName: p?.firstName ?? "",
          lastName: p?.lastName ?? "",
          email: p?.email ?? "",
          phone: p?.phone ?? "",
          title:
            p?.title ?? (result.businessType === "b2c" ? "Customer" : ""),
          companyId: p?.companyId ?? null,
          companyName:
            initialCompanyMode === NEW_COMPANY ? (p?.company?.name ?? "") : "",
          companyDomain: "",
          companyIndustry: "",
          locationId: initialLocationId || null,
          ownerUserId: initialOwnerUserId || null,
          contactType: initialLifecycle,
          leadStatus: initialLeadStatus,
          status: p?.status ?? "active",
          notes: p?.notes ?? "",
          addressLine: p?.addressLine ?? "",
          city: p?.city ?? "",
          country: p?.country ?? "",
          leadSource: p?.leadSource ?? "",
          secondaryEmails: p?.secondaryEmails ?? [],
          secondaryPhones: p?.secondaryPhones ?? [],
          bantBudget: Boolean(p?.bantBudget),
          bantAuthority: Boolean(p?.bantAuthority),
          bantNeed: Boolean(p?.bantNeed),
          bantTimeline: Boolean(p?.bantTimeline),
          bantBudgetDetail: p?.bantBudgetDetail ?? "",
          bantAuthorityDetail: p?.bantAuthorityDetail ?? "",
          bantNeedDetail: p?.bantNeedDetail ?? "",
          bantTimelineDetail: p?.bantTimelineDetail ?? "",
          tags: p?.tags ?? [],
          customAttributes: p?.customAttributes ?? {},
        });
      } catch {
        if (!cancelled) setError("Failed to load form.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isEdit]);

  const CHANNEL_KEYS = new Set([
    "email",
    "phone",
    "secondaryEmails",
    "secondaryPhones",
    "contactType",
  ]);

  const setField = <K extends keyof ContactInput>(
    key: K,
    value: ContactInput[K],
  ) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (CHANNEL_KEYS.has(key)) {
        next.contactType = resolveContactTypeForChannels({
          requested:
            key === "contactType" ? String(value ?? "") : next.contactType,
          existing: prev.contactType,
          email: next.email,
          phone: next.phone,
          secondaryEmails: next.secondaryEmails,
          secondaryPhones: next.secondaryPhones,
        });
        next.leadStatus = reconcileLeadStatusWithContactType(
          next.contactType ?? "contact",
          next.leadStatus ?? "new",
        );
      }
      return next;
    });
  };

  const showCompany =
    showCompanyOnContacts(businessType) ||
    Boolean(prefillCompanyId) ||
    Boolean(form.companyId);
  const showBant = showBantOnContact(businessType);
  const isLeadLifecycle = form.contactType === "lead";
  const leadStatusLocked =
    form.contactType === "customer" || form.contactType === "churned";

  const selectedCompany = companies.find((c) => c.id === companyMode);
  const showNewFields = companyMode === NEW_COMPANY;
  const selectedLocation = selectedCompany?.locations.find(
    (loc) => loc.id === form.locationId,
  );
  const locationOwnerId =
    selectedLocation?.ownerUserId?.trim() ||
    selectedCompany?.ownerUserId?.trim() ||
    null;
  const showLocationPicker = Boolean(selectedCompany) && !showNewFields;

  const companyOptions = useMemo(() => {
    const options = [
      { value: "", label: "No company" },
      ...companies.map((c) => ({
        value: c.id,
        label: c.industry ? `${c.name} · ${c.industry}` : c.name,
      })),
      { value: NEW_COMPANY, label: "+ Create new company…" },
    ];
    if (
      linkedCompanyFallback &&
      !companies.some((c) => c.id === linkedCompanyFallback.id)
    ) {
      options.splice(1, 0, {
        value: linkedCompanyFallback.id,
        label: `${linkedCompanyFallback.name} (linked)`,
      });
    }
    return options;
  }, [companies, linkedCompanyFallback]);

  const locationOptions = useMemo(() => {
    const locs = selectedCompany?.locations ?? [];
    const options = [
      { value: "", label: "No location" },
      ...locs.map((loc) => ({
        value: loc.id,
        label: loc.type === "hq" ? `${loc.name} (HQ)` : loc.name,
      })),
    ];
    if (form.locationId && !options.some((o) => o.value === form.locationId)) {
      options.splice(1, 0, { value: form.locationId, label: "Linked location" });
    }
    return options;
  }, [selectedCompany, form.locationId]);

  const ownerOptions = useMemo(() => {
    const pool = isLeadLifecycle
      ? assignableUsers.filter((u) => u.role === "sales_rep")
      : assignableUsers;
    const options = pool.map((u) => ({
      value: u.id,
      label: u.label,
    }));
    if (
      form.ownerUserId &&
      !options.some((o) => o.value === form.ownerUserId)
    ) {
      options.unshift({
        value: form.ownerUserId,
        label: "Location / current owner",
      });
    }
    return options;
  }, [assignableUsers, form.ownerUserId, isLeadLifecycle]);
  const leadOwnerOptions = useMemo(
    () => [{ value: "", label: "Unassigned (pooled)" }, ...ownerOptions],
    [ownerOptions],
  );
  const lockedOwnerLabel =
    ownerOptions.find((o) => o.value === form.ownerUserId)?.label ??
    (form.ownerUserId
      ? (assignableUsers.find((u) => u.id === form.ownerUserId)?.label ??
        "Location owner")
      : "No location owner set");

  const onCompanyChange = (next: string) => {
    setCompanyMode(next);
    if (next === "" || next === NEW_COMPANY) {
      setField("locationId", null);
      return;
    }
    const nextCompany = companies.find((c) => c.id === next);
    const stillValid = nextCompany?.locations.some(
      (loc) => loc.id === form.locationId,
    );
    if (stillValid) return;
    const nextLocationId =
      prefillLocationId &&
      nextCompany?.locations.some((loc) => loc.id === prefillLocationId)
        ? prefillLocationId
        : "";
    setField("locationId", nextLocationId || null);
    if (!isLeadLifecycle) {
      const nextLoc = nextCompany?.locations.find(
        (loc) => loc.id === nextLocationId,
      );
      const inherited =
        nextLoc?.ownerUserId?.trim() ||
        nextCompany?.ownerUserId?.trim() ||
        (currentUserRole === "sales_rep" ? currentUserId : "") ||
        "";
      setField(
        "ownerUserId",
        (canAssignOwner ? form.ownerUserId || inherited : inherited) || null,
      );
    }
  };

  const onLocationChange = (next: string) => {
    setField("locationId", next || null);
    if (isLeadLifecycle) return;
    const nextLoc = selectedCompany?.locations.find((loc) => loc.id === next);
    const inherited =
      nextLoc?.ownerUserId?.trim() ||
      selectedCompany?.ownerUserId?.trim() ||
      (currentUserRole === "sales_rep" ? currentUserId : "") ||
      "";
    setField(
      "ownerUserId",
      (canAssignOwner ? form.ownerUserId || inherited : inherited) || null,
    );
  };

  const onLifecycleChange = (next: string) => {
    const resolved = resolveContactTypeForChannels({
      requested: next,
      existing: form.contactType,
      email: form.email,
      phone: form.phone,
      secondaryEmails: form.secondaryEmails,
      secondaryPhones: form.secondaryPhones,
    });
    setField("contactType", resolved);
    setField(
      "leadStatus",
      reconcileLeadStatusWithContactType(resolved, form.leadStatus ?? "new"),
    );
    if (resolved === "lead") {
      setField(
        "ownerUserId",
        currentUserRole === "sales_rep" && !isEdit ? currentUserId : null,
      );
      return;
    }
    const inherited =
      (currentUserRole === "sales_rep" ? form.ownerUserId || currentUserId : null) ||
      locationOwnerId ||
      existingOwnerUserId ||
      "";
    setField("ownerUserId", inherited || null);
  };

  const backHref = isEdit
    ? id
      ? `/contact/${id}`
      : "/contact"
    : prefillCompanyId && prefillLocationId
      ? `/company/${prefillCompanyId}/locations/${prefillLocationId}`
      : prefillCompanyId
        ? `/company/${prefillCompanyId}`
        : "/contact";
  const backLabel = isEdit
    ? `Back to ${contactDisplayName ?? "contact"}`
    : prefillCompanyId && prefillLocationId
      ? "Back to location"
      : prefillCompanyId
        ? "Back to company"
        : "Back to contacts";

  const saveContact = async (payload: ContactInput) => {
    setSaving(true);
    setError(null);
    const result =
      isEdit && id ? await updateContact(id, payload) : await createContact(payload);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    navigate(`/contact/${result.id}`);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (showNewFields && !form.companyName?.trim()) {
      setError("Company name is required when creating a new company.");
      return;
    }
    if (
      isLeadLifecycle &&
      canAssignOwner &&
      (form.ownerUserId ?? "") !== (existingOwnerUserId ?? "") &&
      ownerChangeReason.trim().length < 3
    ) {
      setError("A reason is required to assign or reassign a lead.");
      return;
    }
    const payload: ContactInput = {
      ...form,
      companyId:
        companyMode === "" || companyMode === NEW_COMPANY ? null : companyMode,
      companyName: showNewFields ? form.companyName : undefined,
      companyDomain: showNewFields ? form.companyDomain : undefined,
      companyIndustry: showNewFields ? form.companyIndustry : undefined,
      locationId: showLocationPicker ? form.locationId : null,
      leadStatus: leadStatusLocked ? "converted" : form.leadStatus,
      leadSource: isEdit ? form.leadSource?.trim() || null : "crm",
      ownerUserId: isLeadLifecycle
        ? canAssignOwner
          ? form.ownerUserId?.trim() || null
          : currentUserRole === "sales_rep"
            ? currentUserId
            : null
        : form.ownerUserId,
      ownerChangeReason:
        isLeadLifecycle && canAssignOwner
          ? ownerChangeReason.trim()
          : isLeadLifecycle && currentUserRole === "sales_rep"
            ? "Created by this salesperson."
            : null,
      tags: tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    };
    setPendingPayload(payload);
  };

  // Edit still needs contact data before rendering meaningful fields.
  if (isEdit && loading) {
    return <ContactFormPageSkeleton />;
  }

  const formContent = (
    <div
      className={`crm-fade-in mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8 ${COWORKER_WORKSPACE_SCROLL}`}
    >
      {pendingPayload ? (
        <ContactFormDuplicateGate
          excludeContactId={isEdit ? (id ?? null) : null}
          draft={{
            firstName: pendingPayload.firstName,
            lastName: pendingPayload.lastName,
            email: pendingPayload.email,
            phone: pendingPayload.phone ?? "",
            companyId: pendingPayload.companyId ?? "",
            companyName: pendingPayload.companyName ?? "",
            city: pendingPayload.city ?? "",
          }}
          onCancel={() => setPendingPayload(null)}
          onContinueSave={() => {
            const payload = pendingPayload;
            setPendingPayload(null);
            if (payload) void saveContact(payload);
          }}
        />
      ) : null}

      <div className="mb-6">
        <BackLink to={backHref}>{backLabel}</BackLink>
        <h1 className="mt-3 text-xl font-semibold tracking-tight text-text-primary">
          {isEdit ? "Edit contact" : "New contact"}
        </h1>
        <p className="mt-1 text-sm text-text-caption">
          {contactCreateCaption(businessType)}
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-6">
        <section className="rounded-xl border border-border-default bg-surface p-6">
          <h2 className="text-base font-semibold text-text-primary">
            Person details
          </h2>
          <p className="mt-1 text-sm text-text-caption">
            Stored in CDP customer profile
          </p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Input
              label="First name"
              value={form.firstName}
              onChange={(e) => setField("firstName", e.target.value)}
              required
            />
            <Input
              label="Last name"
              value={form.lastName}
              onChange={(e) => setField("lastName", e.target.value)}
            />
            <Input
              label="Email"
              type="email"
              value={form.email}
              onChange={(e) => setField("email", e.target.value)}
            />
            <Input
              label="Phone"
              value={form.phone ?? ""}
              onChange={(e) => setField("phone", e.target.value)}
            />
            <ContactMultiValueInput
              label="Secondary emails"
              kind="email"
              placeholder="alt@company.com"
              addLabel="Add email"
              values={form.secondaryEmails ?? []}
              onChange={(values) => setField("secondaryEmails", values)}
            />
            <ContactMultiValueInput
              label="Secondary phones"
              kind="tel"
              placeholder="+91 98765 0001"
              addLabel="Add phone"
              values={form.secondaryPhones ?? []}
              onChange={(values) => setField("secondaryPhones", values)}
            />
            <Input
              label={businessType === "b2c" ? "Customer type" : "Title"}
              value={form.title ?? ""}
              placeholder={businessType === "b2c" ? "Customer" : "e.g. VP Sales"}
              onChange={(e) => setField("title", e.target.value)}
            />
            <Input
              label="Address"
              value={form.addressLine ?? ""}
              onChange={(e) => setField("addressLine", e.target.value)}
            />
            <Input
              label="Country"
              value={form.country ?? ""}
              onChange={(e) => setField("country", e.target.value)}
            />
          </div>
        </section>

        {showCompany ? (
          <section className="rounded-xl border border-border-default bg-surface p-6">
            <h2 className="text-base font-semibold text-text-primary">
              {businessType === "b2b2c" ? "Company (optional)" : "Company"}
            </h2>
            <p className="mt-1 text-sm text-text-caption">
              {businessType === "b2b2c"
                ? "Link a consumer to an account company when relevant."
                : "Pick an existing Company account or create a new one."}
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Select
                label="Company"
                className="sm:col-span-2"
                value={companyMode}
                onChange={(e) => onCompanyChange(e.target.value)}
                options={companyOptions}
              />

              {showLocationPicker ? (
                <Select
                  label="Company location"
                  className="sm:col-span-2"
                  value={form.locationId ?? ""}
                  onChange={(e) => onLocationChange(e.target.value)}
                  options={locationOptions}
                />
              ) : null}

              {showNewFields ? (
                <>
                  <Input
                    label="New company name"
                    required
                    value={form.companyName ?? ""}
                    onChange={(e) => setField("companyName", e.target.value)}
                    placeholder="e.g. Acme Industries"
                  />
                  <Input
                    label="Domain"
                    value={form.companyDomain ?? ""}
                    onChange={(e) => setField("companyDomain", e.target.value)}
                  />
                  <Input
                    label="Industry"
                    className="sm:col-span-2"
                    value={form.companyIndustry ?? ""}
                    onChange={(e) => setField("companyIndustry", e.target.value)}
                  />
                </>
              ) : selectedCompany ? (
                <p className="text-sm text-text-caption sm:col-span-2">
                  Linked to{" "}
                  <span className="font-medium text-text-primary">
                    {selectedCompany.name}
                  </span>
                  {selectedCompany.industry ? ` · ${selectedCompany.industry}` : ""}.
                  Name and industry sync from the Company record.
                </p>
              ) : (
                <p className="text-sm text-text-caption sm:col-span-2">
                  No company linked. Pick an existing account or create a new one.
                </p>
              )}
            </div>
          </section>
        ) : null}

        <section className="rounded-xl border border-border-default bg-surface p-6">
          <h2 className="text-base font-semibold text-text-primary">
            CRM fields
          </h2>
          <p className="mt-1 text-sm text-text-caption">
            Also stored on the CDP customer profile
          </p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Select
              label="Contact type"
              value={form.contactType ?? "contact"}
              onChange={(e) => onLifecycleChange(e.target.value)}
              options={[...CONTACT_TYPE_FORM_OPTIONS]}
            />
            <p className="-mt-2 text-xs text-text-caption sm:col-span-2">
              A person becomes a lead when they have an email or phone. Name-only
              records stay contacts until a channel is added.
            </p>
            <Select
              label="Status"
              value={form.status ?? "active"}
              onChange={(e) => setField("status", e.target.value)}
              options={[...STATUS_FORM_OPTIONS]}
            />
            <Select
              label="Lead status"
              value={leadStatusLocked ? "converted" : (form.leadStatus ?? "new")}
              disabled={leadStatusLocked}
              onChange={(e) => setField("leadStatus", e.target.value)}
              options={[...LEAD_STATUS_FORM_OPTIONS]}
            />
            {leadStatusLocked ? (
              <p className="-mt-2 text-xs text-text-caption sm:col-span-2">
                Customers and churned contacts use Converted lead status.
              </p>
            ) : null}
            {isEdit ? (
              <Input
                label="Lead source"
                value={form.leadSource ?? ""}
                onChange={(e) => setField("leadSource", e.target.value)}
              />
            ) : null}
            {isLeadLifecycle && !canAssignOwner && currentUserRole !== "sales_rep" ? (
              <p className="text-xs text-text-caption sm:col-span-2">
                Leads stay unassigned until score reaches 40 or a sales user
                claims them. Company owner is not lead ownership.
              </p>
            ) : canAssignOwner ? (
              <div className="flex flex-col gap-2">
                <Select
                  label="Owner"
                  value={form.ownerUserId ?? ""}
                  onChange={(e) => setField("ownerUserId", e.target.value || null)}
                  options={
                    isLeadLifecycle
                      ? leadOwnerOptions
                      : ownerOptions.length > 0
                        ? ownerOptions
                        : [{ value: "", label: "Select owner" }]
                  }
                />
                <p className="text-xs text-text-caption">
                  {isLeadLifecycle
                    ? "Assign a sales rep, or leave the lead pooled. A reason is required when the owner changes. Company owner is not lead ownership."
                    : "Assign any sales user in your organization."}
                </p>
                {isLeadLifecycle &&
                (form.ownerUserId ?? "") !== (existingOwnerUserId ?? "") ? (
                  <Textarea
                    label="Reason for this owner"
                    value={ownerChangeReason}
                    onChange={(e) => setOwnerChangeReason(e.target.value)}
                    placeholder="Why this sales rep should own the lead"
                  />
                ) : null}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium text-text-primary">
                  Owner
                </span>
                <p className="flex h-11 items-center rounded-lg border border-border-default bg-neutral-200 px-3 text-sm text-text-secondary">
                  {lockedOwnerLabel}
                </p>
                <p className="text-xs text-text-caption">
                  {isLeadLifecycle && currentUserRole === "sales_rep" && !isEdit
                    ? "This contact is assigned to you."
                    : "Owner follows the company location. Ask an admin or sales manager to reassign."}
                </p>
              </div>
            )}
            <Input
              label="Tags (comma separated)"
              className="sm:col-span-2"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
            />
            <div className="sm:col-span-2">
              <Textarea
                label="Profile notes"
                value={form.notes ?? ""}
                onChange={(e) => setField("notes", e.target.value)}
                placeholder="Static notes on the contact profile (timeline uses Activity)"
              />
            </div>
          </div>
        </section>

        {showBant ? (
          <section className="rounded-xl border border-border-default bg-surface p-6">
            <h2 className="text-base font-semibold text-text-primary">
              Qualification (BANT)
            </h2>
            <p className="mt-1 text-sm text-text-caption">
              Budget, Authority, Need, Timeline — used to qualify leads for
              conversion.
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {BANT_CRITERIA.map((criterion) => (
                <div
                  key={criterion.key}
                  className="rounded-lg border border-border-default p-3"
                >
                  <Checkbox
                    label={`${criterion.label} confirmed`}
                    checked={Boolean(form[criterion.key])}
                    onChange={(e) => setField(criterion.key, e.target.checked)}
                  />
                  <Input
                    className="mt-2.5"
                    value={String(form[criterion.detailKey] ?? "")}
                    onChange={(e) =>
                      setField(criterion.detailKey, e.target.value)
                    }
                    maxLength={BANT_DETAIL_MAX}
                    placeholder={criterion.placeholder}
                    aria-label={`${criterion.label} details`}
                  />
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {verticalFields.length > 0 ? (
          <section className="rounded-xl border border-border-default bg-surface p-6">
            <h2 className="text-base font-semibold text-text-primary">
              Industry fields
            </h2>
            <p className="mt-1 text-sm text-text-caption">
              Extra attributes from your organization&apos;s industry pack.
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {verticalFields.map((field) => {
                const attrs = form.customAttributes ?? {};
                const value = attrs[field.key];
                if (field.type === "boolean") {
                  return (
                    <Checkbox
                      key={field.key}
                      label={field.label}
                      checked={Boolean(value)}
                      onChange={(e) =>
                        setField("customAttributes", {
                          ...attrs,
                          [field.key]: e.target.checked,
                        })
                      }
                    />
                  );
                }
                return (
                  <Input
                    key={field.key}
                    label={field.label}
                    value={value == null ? "" : String(value)}
                    placeholder={field.placeholder}
                    onChange={(e) =>
                      setField("customAttributes", {
                        ...attrs,
                        [field.key]:
                          field.type === "number"
                            ? e.target.value === ""
                              ? ""
                              : Number(e.target.value)
                            : e.target.value,
                      })
                    }
                  />
                );
              })}
            </div>
          </section>
        ) : null}

        {error ? (
          <p className="text-sm text-text-danger" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={saving}>
            {saving
              ? "Saving…"
              : isEdit
                ? "Save changes"
                : "Create contact"}
          </Button>
          <Link to={backHref}>
            <Button type="button" variant="secondary" disabled={saving}>
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );

  if (!isEdit) return formContent;

  return (
    <AgentModuleShell
      moduleId="contact"
      title={`Edit ${contactDisplayName ?? "contact"}`}
      welcome={`I'm your **contact agent** for **${contactDisplayName ?? "this contact"}**. Ask me about lifecycle stage or lead qualification while you edit the form on the right.`}
      chips={[
        {
          id: "chip-lifecycle",
          label: "What lifecycle stage next?",
          prompt: "What lifecycle stage should this contact move to next?",
        },
      ]}
      surface="detail"
      entityId={id ?? null}
      workspace={formContent}
    />
  );
}
