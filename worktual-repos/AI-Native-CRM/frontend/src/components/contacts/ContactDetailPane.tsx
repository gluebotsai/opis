import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ContactActivityTimeline } from "@/components/contacts/ContactActivityTimeline";
import { ContactQuickActions } from "@/components/contacts/ContactQuickActions";
import { ContactDetailsCard } from "@/components/contacts/ContactDetailsCard";
import { CompanyDetailsCardLink } from "@/components/contacts/CompanyDetailsCardLink";
import { ContactDuplicateAlert } from "@/components/contacts/ContactDuplicateAlert";
import { DeleteContactButton } from "@/components/contacts/DeleteContactButton";
import { ConvertLeadButton } from "@/components/contacts/ConvertLeadButton";
import { LeadEnrichmentStatusBadge } from "@/components/contacts/LeadEnrichmentStatusBadge";
import { LeadNurtureStatusBadge } from "@/components/contacts/LeadNurtureStatusBadge";
import { LeadLifecycleStatusBadge } from "@/components/contacts/LeadLifecycleStatusBadge";
import { LeadSummaryPanel } from "@/components/ai/LeadSummaryPanel";
import { LeadSummaryAutoRefresh } from "@/components/ai/LeadSummaryAutoRefresh";
import { SalesGuidePanel } from "@/components/contacts/SalesGuidePanel";
import { ContactDetailB2b } from "@/components/contacts/ContactDetailB2b";
import { Customer360Panel } from "@/components/contacts/Customer360Panel";
import { RichStructuredContent } from "@/components/content/RichStructuredContent";
import {
  formatLeadStatus,
  formatContactType,
  formatStatus,
  leadStatusTone,
} from "@/components/contacts/contact-labels";
import { Button } from "@/components/ui/Button";
import { DEAL_STAGE_LABELS } from "@/lib/deal-stages";
import { showBantOnContact } from "@/lib/business-type-copy";
import { fetchContactDetail } from "@/services/contacts";
import { ContactDetailPageSkeleton } from "@/pages/ContactDetailPageSkeleton";
import { displayCompanyLocationLabel } from "@/lib/company-location-label";
import { BackLink } from "@/components/ui/BackLink";
import { PAGE_H1_CLASS } from "@/lib/ui-tones";

type DetailPayload = Extract<
  Awaited<ReturnType<typeof fetchContactDetail>>,
  { ok: true }
>;

export type ContactDetailPaneProps = {
  contactId: string;
  /** Prefer in-shell back over navigating to /contact */
  onBack?: () => void;
  /** When the record was deleted or is inaccessible — refresh list / leave detail */
  onUnavailable?: () => void;
  /** Bump to force reload after chat-driven updates */
  refreshToken?: number;
};

/**
 * Contact detail content for in-shell workspace (and full-page shell).
 */
export function ContactDetailPane({
  contactId,
  onBack,
  onUnavailable,
  refreshToken = 0,
}: ContactDetailPaneProps) {
  const [searchParams] = useSearchParams();
  const focusActivityId = searchParams.get("activity");
  const [data, setData] = useState<DetailPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadedContactId = useRef<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const result = await fetchContactDetail(contactId);
      if (!result.ok) {
        const msg =
          typeof result.error === "string" && result.error.trim()
            ? result.error
            : "Contact not found or access denied.";
        setError(msg);
        setData(null);
        onUnavailable?.();
      } else {
        loadedContactId.current = result.contact.id;
        setData(result);
      }
    } catch {
      setError("Failed to load contact.");
    } finally {
      setLoading(false);
    }
  }, [contactId, onUnavailable]);

  useEffect(() => {
    if (loadedContactId.current !== contactId) setLoading(true);
    void reload();
  }, [reload, refreshToken, contactId]);

  if (loading) {
    return <ContactDetailPageSkeleton />;
  }

  if (error || !data) {
    return (
      <div className="px-6 py-10">
        <p className="text-sm text-text-danger">{error ?? "Not found"}</p>
        {onBack ? (
          <BackLink onClick={onBack} className="mt-3">
            Back to contacts
          </BackLink>
        ) : (
          <BackLink to="/contact" className="mt-3">
            Back to contacts
          </BackLink>
        )}
      </div>
    );
  }

  const { contact, businessType } = data;
  if (businessType === "b2b") {
    return (
      <>
        <LeadSummaryAutoRefresh
          contactId={contactId}
          onRefresh={() => void reload()}
        />
        <ContactDetailB2b
          contactId={contactId}
          data={data}
          onBack={onBack}
          onReload={() => void reload()}
        />
      </>
    );
  }
  const { person, crm, displayName } = contact;
  const showBant = showBantOnContact(businessType);
  const showCompany = data.showCompany;
  const showConvert = data.showConvert;
  const showCommerce = data.showCommerce;
  const showSales = data.showSales;

  const isConvertibleLead =
    person.contactType === "lead" &&
    person.leadStatus !== "converted" &&
    person.leadStatus !== "disqualified";
  const needsCompanyLink = businessType === "b2b2c" && !person.companyId;
  const relatedDeals = data.relatedDeals;
  const primaryDeal = relatedDeals[0] ?? null;

  const companySnapshot = data.companySnapshot as {
    name?: string;
    domain?: string;
    industry?: string;
    employeeCount?: number;
    linkedinUrl?: string;
    ownerUserId?: string;
  } | null;
  const companyLocation = data.companyLocation as
    | {
        id: string;
        name: string;
        city?: string | null;
        address?: string | null;
      }
    | null;
  const companyName = companySnapshot?.name ?? person.company?.name ?? null;
  const companyDomain = companySnapshot?.domain ?? null;
  const companyIndustry = companySnapshot?.industry ?? null;
  const companyEmployees =
    companySnapshot?.employeeCount != null
      ? companySnapshot.employeeCount.toLocaleString()
      : null;
  const companyLinkedIn = companySnapshot?.linkedinUrl ?? null;
  const companyLocationLabel = companyLocation
    ? displayCompanyLocationLabel({
        name: companyLocation.name,
        city: companyLocation.city,
        address: companyLocation.address,
      })
    : null;

  const ownerLabels = data.ownerLabels;
  const assignableUsers = data.assignableUsers ?? [];
  // Contact Owner = CRM profile owner only. Company owner is shown separately.
  const ownerLabel =
    resolveOwnerDisplayName(
      crm.ownerUserId,
      ownerLabels,
      assignableUsers,
    ) ?? "Unassigned";
  const companyOwnerLabel = resolveOwnerDisplayName(
    companySnapshot?.ownerUserId,
    ownerLabels,
    assignableUsers,
  );

  const enrichmentStatus = data.enrichmentStatus as { status?: string } | null;
  const nurtureStatus = data.nurtureStatus as {
    status?: string;
    decision?: string;
    lastSentAt?: string;
    lastError?: string | null;
    rationale?: string | null;
    nextRetryAt?: string | null;
    skipReason?: string | null;
    resultSummary?: unknown;
  } | null;
  const lifecycleStatus = data.lifecycleStatus as {
    status?: string;
    ladder?: string;
    from?: string;
    to?: string;
    reason?: string;
    lastAppliedAt?: string;
  } | null;

  const backControl = onBack ? (
    <BackLink onClick={onBack}>All contacts</BackLink>
  ) : (
    <BackLink to="/contact">All contacts</BackLink>
  );

  return (
    <div className="crm-fade-in h-full min-h-0 w-full overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
      <LeadSummaryAutoRefresh
        contactId={contactId}
        onRefresh={() => void reload()}
      />
      {data.duplicateInfo.duplicates.length ? (
        <ContactDuplicateAlert
          contactId={contactId}
          duplicates={data.duplicateInfo.duplicates}
          onMerged={() => void reload()}
        />
      ) : null}

      <LeadLifecycleStatusBadge
        status={lifecycleStatus?.status ?? null}
        ladder={lifecycleStatus?.ladder ?? null}
        from={lifecycleStatus?.from ?? null}
        to={lifecycleStatus?.to ?? null}
        reason={lifecycleStatus?.reason ?? null}
        lastAppliedAt={lifecycleStatus?.lastAppliedAt ?? null}
      />
      <LeadNurtureStatusBadge
        status={nurtureStatus?.status ?? null}
        decision={nurtureStatus?.decision ?? null}
        lastSentAt={nurtureStatus?.lastSentAt ?? null}
        lastError={nurtureStatus?.lastError ?? null}
        rationale={nurtureStatus?.rationale ?? null}
        nextRetryAt={nurtureStatus?.nextRetryAt ?? null}
        skipReason={nurtureStatus?.skipReason ?? null}
        resultSummary={nurtureStatus?.resultSummary ?? null}
      />

      <div className="mt-4 mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          {backControl}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <h1 className={PAGE_H1_CLASS}>
              {displayName}
            </h1>
            <LeadEnrichmentStatusBadge
              contactId={contactId}
              initialStatus={enrichmentStatus?.status ?? null}
              onRefreshed={() => void reload()}
            />
            {person.leadStatus ? (
              <span
                className={leadStatusTone(person.leadStatus)}
              >
                {formatLeadStatus(person.leadStatus)}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-text-caption">
            {person.title || "Contact"}
            {showCompany && person.company?.name ? (
              <>
                {" · "}
                {person.companyId ? (
                  <Link
                    to={`/company/${person.companyId}`}
                    className="text-text-link hover:underline"
                  >
                    {person.company.name}
                  </Link>
                ) : (
                  person.company.name
                )}
              </>
            ) : null}
          </p>
          {needsCompanyLink ? (
            <p className="mt-2 text-sm text-text-secondary">
              Consumer contact —{" "}
              <Link
                to={`/contact/${contactId}/edit`}
                className="font-medium text-text-link hover:underline"
              >
                link to a company account
              </Link>{" "}
              when this person belongs to an organization.
            </p>
          ) : null}
          <div className="mt-4">
            <ContactQuickActions
              contactId={contactId}
              displayName={displayName}
              email={person.email}
              phone={person.phone}
              assignableUsers={data.assignableUsers}
              currentUserId={data.currentUserId}
              canAssignAssignee={data.canAssignAssignee}
              onChanged={() => void reload()}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {showConvert && isConvertibleLead ? (
            <ConvertLeadButton
              contactId={contactId}
              contactName={displayName}
              companyName={companyName ?? undefined}
              leadStatus={person.leadStatus}
              businessType={businessType}
            />
          ) : null}
          {showSales && relatedDeals.length === 1 && primaryDeal ? (
            <Link to={`/sales/${primaryDeal.id}`}>
              <Button variant="secondary">View deals</Button>
            </Link>
          ) : null}
          {showSales && relatedDeals.length > 1 ? (
            <a href="#contact-deals">
              <Button variant="secondary">
                View deals ({relatedDeals.length})
              </Button>
            </a>
          ) : null}
          {showCommerce ? (
            <Link to={`/commerce?contactId=${contactId}`}>
              <Button variant="secondary">New order</Button>
            </Link>
          ) : null}
          <Link to={`/contact/${contactId}/edit`}>
            <Button variant="primary">Edit</Button>
          </Link>
          <DeleteContactButton
            id={contactId}
            name={displayName}
            onDeleted={onBack}
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ContactDetailsCard
          contactId={contactId}
          displayName={displayName}
          email={person.email}
          phone={person.phone}
          secondaryEmails={person.secondaryEmails ?? []}
          secondaryPhones={person.secondaryPhones ?? []}
          title={person.title}
          addressLine={person.addressLine}
          city={person.city}
          country={person.country}
          ownerLabel={ownerLabel}
        />

        {showCompany ? (
          <CompanyDetailsCardLink companyId={person.companyId}>
            <h2 className="text-base font-semibold text-text-primary">
              Company details
            </h2>
            <dl className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field
                label="Name"
                value={
                  person.companyId && companyName ? (
                    <Link
                      to={`/company/${person.companyId}`}
                      className="font-medium text-text-link hover:underline"
                    >
                      {companyName}
                    </Link>
                  ) : (
                    companyName
                  )
                }
              />
              <Field label="Domain" value={companyDomain} />
              <Field label="Industry" value={companyIndustry} />
              <Field label="Employees" value={companyEmployees} />
              <Field
                label="LinkedIn"
                value={
                  companyLinkedIn ? (
                    <a
                      href={companyLinkedIn}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-text-link hover:underline"
                    >
                      {companyLinkedIn
                        .replace(
                          /^https?:\/\/(www\.)?linkedin\.com\/company\//i,
                          "",
                        )
                        .replace(/\/$/, "") || companyLinkedIn}
                    </a>
                  ) : null
                }
              />
              <Field
                label="Company owner"
                value={ownerShort(companyOwnerLabel)}
              />
              <Field
                label="Location"
                value={
                  person.companyId && companyLocation && companyLocationLabel ? (
                    <Link
                      to={`/company/${person.companyId}/locations/${companyLocation.id}`}
                      className="font-medium text-text-link hover:underline"
                    >
                      {companyLocationLabel}
                    </Link>
                  ) : null
                }
              />
            </dl>
            {needsCompanyLink ? (
              <Link
                to={`/contact/${contactId}/edit`}
                className="mt-4 inline-block"
              >
                <Button variant="secondary">Link company</Button>
              </Link>
            ) : null}
          </CompanyDetailsCardLink>
        ) : (
          <section className="rounded-xl border border-border-default bg-surface p-6">
            <h2 className="text-base font-semibold text-text-primary">
              Consumer profile
            </h2>
            <p className="mt-1 text-sm text-text-caption">
              B2C contacts are person-first. Create orders from Commerce —
              company is not required.
            </p>
          </section>
        )}

        <section className="rounded-xl border border-border-default bg-surface p-6 lg:col-span-2">
          <h2 className="text-base font-semibold text-text-primary">
            CRM fields
          </h2>
          <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field
              label="Contact type"
              value={formatContactType(person.contactType)}
            />
            <Field
              label="Lead status"
              value={formatLeadStatus(person.leadStatus)}
            />
            <Field label="Status" value={formatStatus(crm.status)} />
            <Field
              label="Lead source"
              value={data.utmSource || crm.leadSource || person.leadSource}
            />
            <Field
              label="Tags"
              value={
                (person.tags?.length ? person.tags : null)?.join(", ") ?? null
              }
            />
            <Field label="Owner" value={ownerLabel} />
            <Field
              label="Created"
              value={
                person.createdAt
                  ? new Date(person.createdAt).toLocaleString()
                  : null
              }
            />
            <Field
              label="Updated"
              value={
                person.updatedAt
                  ? new Date(person.updatedAt).toLocaleString()
                  : null
              }
            />
            {person.disqualifyReason ? (
              <Field label="Disqualify reason" value={person.disqualifyReason} />
            ) : null}
            {crm.notes ? (
              <div className="sm:col-span-2 lg:col-span-3">
                <Field label="Profile notes" value={crm.notes} rich />
              </div>
            ) : null}
          </dl>
        </section>

        {showBant ? (
          <section className="rounded-xl border border-border-default bg-surface p-6 lg:col-span-2">
            <h2 className="text-base font-semibold text-text-primary">
              Qualification (BANT)
            </h2>
            <p className="mt-1 text-xs text-text-caption">
              Budget · Authority · Need · Timeline
            </p>
            <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <BantField label="Budget" value={person.bantBudget} detail={person.bantBudgetDetail} />
              <BantField label="Authority" value={person.bantAuthority} detail={person.bantAuthorityDetail} />
              <BantField label="Need" value={person.bantNeed} detail={person.bantNeedDetail} />
              <BantField label="Timeline" value={person.bantTimeline} detail={person.bantTimelineDetail} />
            </dl>
          </section>
        ) : null}

        {showSales ? (
          <section
            id="contact-deals"
            className="scroll-mt-24 rounded-xl border border-border-default bg-surface p-6 lg:col-span-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-text-primary">
                  Deals
                </h2>
                <p className="mt-1 text-xs text-text-caption">
                  Pipeline opportunities linked to this contact
                </p>
              </div>
              {primaryDeal ? (
                <Link to={`/sales/${primaryDeal.id}`}>
                  <Button variant="secondary">
                    {relatedDeals.length === 1
                      ? "Open deal"
                      : "Open latest deal"}
                  </Button>
                </Link>
              ) : null}
            </div>
            {relatedDeals.length === 0 ? (
              <p className="mt-4 text-sm text-text-caption">
                No deals linked to this contact yet.
                {showConvert && isConvertibleLead
                  ? " Convert this lead to create the first opportunity."
                  : null}
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-border-default">
                {relatedDeals.map((deal) => (
                  <li
                    key={deal.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                  >
                    <div className="min-w-0">
                      <Link
                        to={`/sales/${deal.id}`}
                        className="font-medium text-text-link hover:underline"
                      >
                        {deal.title}
                      </Link>
                      <p className="mt-0.5 text-xs text-text-caption">
                        {deal.company?.name ?? "—"}
                      </p>
                    </div>
                    <span className="text-text-secondary">
                      {DEAL_STAGE_LABELS[deal.stage] ?? deal.stage}
                      {deal.amount ? ` · ${deal.amount}` : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {showCommerce ? (
          <section className="rounded-xl border border-border-default bg-surface p-6 lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-text-primary">
                  Orders
                </h2>
                <p className="mt-1 text-xs text-text-caption">
                  Contact-tied commerce orders
                </p>
              </div>
              <Link to={`/commerce?contactId=${contactId}`}>
                <Button variant="secondary">New order</Button>
              </Link>
            </div>
            {data.orders.length === 0 ? (
              <p className="mt-4 text-sm text-text-caption">
                No orders yet for this contact.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-border-default">
                {data.orders.map((raw) => {
                  const o = raw as {
                    id: string;
                    number?: string;
                    status?: string;
                    total?: string | number;
                    currency?: string;
                  };
                  return (
                    <li
                      key={o.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                    >
                      <Link
                        to={`/commerce/${o.id}`}
                        className="font-medium text-text-link hover:underline"
                      >
                        {o.number ?? o.id}
                      </Link>
                      <span className="text-text-secondary">
                        {o.status}
                        {o.total != null
                          ? ` · ${o.currency ?? ""} ${String(o.total)}`
                          : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : null}

        <LeadSummaryPanel contactId={contactId} />

        <SalesGuidePanel
          contactId={contactId}
          displayName={displayName}
          email={person.email ?? ""}
          phone={person.phone}
          companyName={companyName}
          leadStatus={person.leadStatus}
          businessType={businessType}
          onChanged={() => void reload()}
        />

        <Customer360Panel contactId={contactId} />

        <ContactActivityTimeline
          contactId={contactId}
          displayName={displayName}
          email={person.email}
          phone={person.phone}
          activities={data.activities}
          relatedDealActivities={data.relatedDealActivities}
          focusActivityId={focusActivityId}
          assignableUsers={data.assignableUsers}
          currentUserId={data.currentUserId}
          canAssignAssignee={data.canAssignAssignee}
          onChanged={() => void reload()}
        />
      </div>
    </div>
  );
}

function resolveOwnerDisplayName(
  ownerUserId: string | null | undefined,
  ownerLabels: Record<string, string>,
  assignableUsers: Array<{ id: string; label: string }>,
): string | null {
  const id = ownerUserId?.trim();
  if (!id) return null;

  const fromLabels = ownerLabels[id]?.trim();
  if (fromLabels && !looksLikeUserId(fromLabels)) return fromLabels;

  const assignable = assignableUsers.find((u) => u.id === id);
  if (assignable?.label) {
    // label is often "Name (role)" — ownerShort strips the role
    return assignable.label;
  }

  // Never surface raw UUIDs in the UI when the directory lookup misses.
  return null;
}

function looksLikeUserId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
}

function ownerShort(label: string | null | undefined): string {
  if (!label) return "—";
  if (looksLikeUserId(label)) return "—";
  const paren = label.indexOf(" (");
  return paren > 0 ? label.slice(0, paren) : label;
}

function Field({
  label,
  value,
  rich = false,
}: {
  label: string;
  value: ReactNode;
  rich?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-text-caption uppercase">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-text-primary">
        {rich && typeof value === "string" ? (
          <RichStructuredContent text={value} variant="compact" />
        ) : (
          <span className="whitespace-pre-wrap">{value || "—"}</span>
        )}
      </dd>
    </div>
  );
}

function BantField({
  label,
  value,
  detail,
}: {
  label: string;
  value: boolean | null | undefined;
  detail?: string | null;
}) {
  const phrase = detail?.trim() ?? "";
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-text-caption uppercase">
        {label}
      </dt>
      <dd
        className={`mt-1 text-sm font-medium ${
          value ? "text-text-success" : "text-text-caption"
        }`}
      >
        {value ? "Confirmed" : "Pending"}
      </dd>
      {value && phrase ? (
        <p className="mt-1 text-xs font-normal leading-5 text-text-primary">{phrase}</p>
      ) : null}
    </div>
  );
}
