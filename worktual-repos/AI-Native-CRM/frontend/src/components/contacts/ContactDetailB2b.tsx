import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Building2,
  Calendar,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FileText,
  Globe,
  Headset,
  Mail,
  MapPin,
  MessageCircle,
  MessageSquare,
  MessagesSquare,
  Phone,
  Share2,
  StickyNote,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { ContactActivityTimeline } from "@/components/contacts/ContactActivityTimeline";
import { ContactQuickActions, QUICK_ACTION_MENU_ITEM_CLASS } from "@/components/contacts/ContactQuickActions";
import { ContactDuplicateAlert } from "@/components/contacts/ContactDuplicateAlert";
import { DeleteContactButton } from "@/components/contacts/DeleteContactButton";
import { ConvertLeadButton } from "@/components/contacts/ConvertLeadButton";
import { LeadEnrichmentStatusBadge } from "@/components/contacts/LeadEnrichmentStatusBadge";
import { LeadNurtureStatusBadge } from "@/components/contacts/LeadNurtureStatusBadge";
import { LeadLifecycleStatusBadge } from "@/components/contacts/LeadLifecycleStatusBadge";
import { LeadScoreBadge } from "@/components/contacts/LeadScoreBadge";
import { SalesGuidePanel } from "@/components/contacts/SalesGuidePanel";
import { Customer360Panel } from "@/components/contacts/Customer360Panel";
import { NoteAttachmentsList } from "@/components/contacts/NoteAttachmentPreview";
import { LeadSummaryAutoRefresh } from "@/components/ai/LeadSummaryAutoRefresh";
import { EmailComposeDialog } from "@/components/email/EmailComposeDialog";
import {
  formatContactType,
  formatLeadStatus,
  leadStatusTone,
} from "@/components/contacts/contact-labels";
import { ActivityTypeIcon } from "@/lib/activity-type-style";
import { Button } from "@/components/ui/Button";
import { DEAL_STAGE_LABELS } from "@/lib/deal-stages";
import { displayCompanyLocationLabel } from "@/lib/company-location-label";
import { sanitizeActivityDisplayText } from "@/lib/activity-display";
import { hrefForActivity } from "@/lib/activity-href";
import { ChannelSummaryBriefView } from "@/components/contacts/ChannelSummaryBrief";
import {
  buildChannelSections,
  cleanSummaryText,
  eventSummaryBrief,
  intelligenceOverview,
  parseChannelSummary,
  type ChannelSection,
  type IntelligenceChannelId,
} from "@/lib/contact-intelligence";
import { normalizeEmailDisplayText } from "@/lib/email-body";
import { parseNoteBody } from "@/lib/note-body";
import { RichStructuredContent } from "@/components/content/RichStructuredContent";
import { fetchContactDetail } from "@/services/contacts";
import type { ContactActivityDetail } from "@/services/contacts";
import {
  draftNbaFollowUpEmail,
  fetchLeadSummary,
  mergeLeadScoreStatus,
} from "@/services/leadSummary";
import type {
  LeadScoreStatusView,
  LeadSummaryView,
} from "@/services/leadSummary";

type DetailPayload = Extract<
  Awaited<ReturnType<typeof fetchContactDetail>>,
  { ok: true }
>;

type TabId =
  | "overview"
  | "deals"
  | "emails"
  | "calls"
  | "meetings"
  | "tasks"
  | "notes"
  | "files"
  | "insights";

function isContactTab(value: string | null): value is TabId {
  return TABS.some((item) => item.id === value);
}

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "deals", label: "Deals" },
  { id: "emails", label: "Emails" },
  { id: "calls", label: "Calls" },
  { id: "meetings", label: "Meetings" },
  { id: "tasks", label: "Tasks" },
  { id: "notes", label: "Notes" },
  { id: "files", label: "Files" },
  { id: "insights", label: "Insights" },
];

const RAIL_FILTERS = [
  { id: "all", label: "All" },
  { id: "email", label: "Emails" },
  { id: "call", label: "Calls" },
  { id: "meeting", label: "Meetings" },
  { id: "note", label: "Notes" },
] as const;

type RailFilter = (typeof RAIL_FILTERS)[number]["id"];

const INTENT_TONE: Record<string, string> = {
  "High buying intent": "bg-[#e8f8ef] text-text-success",
  "Active engagement": "bg-neutral-100 text-neutral-900",
  Exploratory: "bg-[#fff8e8] text-text-warning",
  "New lead": "bg-neutral-100 text-text-secondary",
  Converted: "bg-[#e8f8ef] text-text-success",
  Disqualified: "bg-neutral-100 text-text-caption",
};

export function ContactDetailB2b({
  contactId,
  data,
  onBack,
  onReload,
}: {
  contactId: string;
  data: DetailPayload;
  onBack?: () => void;
  onReload: () => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const focusActivityId = searchParams.get("activity");
  const requestedTab = searchParams.get("tab");
  const tab: TabId = isContactTab(requestedTab) ? requestedTab : "overview";
  const selectTab = (next: TabId) => {
    const nextParams = new URLSearchParams(searchParams);
    if (next === "overview") nextParams.delete("tab");
    else nextParams.set("tab", next);
    setSearchParams(nextParams, { replace: true });
  };
  const [railExpanded, setRailExpanded] = useState(false);
  const [followUp, setFollowUp] = useState<{
    subject: string;
    message: string;
  } | null>(null);
  const [followUpBusy, setFollowUpBusy] = useState(false);
  const [followUpError, setFollowUpError] = useState<string | null>(null);
  const intelligence = useLeadIntelligence(contactId, data.leadScore ?? null);

  const { contact } = data;
  const { person, crm, displayName } = contact;
  const showConvert = data.showConvert;
  const showSales = data.showSales;

  const isConvertibleLead =
    person.contactType === "lead" &&
    person.leadStatus !== "converted" &&
    person.leadStatus !== "disqualified";

  const companySnapshot = data.companySnapshot as {
    name?: string;
    domain?: string;
    industry?: string;
    employeeCount?: number;
    ownerUserId?: string;
  } | null;
  const companyLocation = data.companyLocation as {
    id: string;
    name: string;
    city?: string | null;
    address?: string | null;
  } | null;

  const companyName = companySnapshot?.name ?? person.company?.name ?? null;
  const companyDomain = companySnapshot?.domain?.trim() || null;
  const industry = companySnapshot?.industry ?? null;
  const companySize = formatCompanySize(
    data.companySize,
    companySnapshot?.employeeCount,
  );
  const locationLabel = headerLocation(person, companyLocation);
  const contactAddress = person.addressLine?.trim() || null;
  const companyAddress = companyLocation?.address?.trim() || null;
  const companyLocationLabel =
    companyLocation != null
      ? displayCompanyLocationLabel({
          name: companyLocation.name,
          city: companyLocation.city,
        })
      : null;
  const ownerLabel =
    resolveOwnerDisplayName(
      crm.ownerUserId,
      data.ownerLabels,
      data.assignableUsers ?? [],
    ) ?? "Unassigned";

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

  const bant = {
    budget: person.bantBudget,
    authority: person.bantAuthority,
    need: person.bantNeed,
    timeline: person.bantTimeline,
    budgetDetail: person.bantBudgetDetail,
    authorityDetail: person.bantAuthorityDetail,
    needDetail: person.bantNeedDetail,
    timelineDetail: person.bantTimelineDetail,
  };

  const emails = uniqueValues([person.email, ...(person.secondaryEmails ?? [])]);
  const phones = uniqueValues([
    person.phone,
    ...(person.secondaryPhones ?? []),
  ]);

  const relatedDeals = data.relatedDeals;
  const primaryDeal = relatedDeals[0] ?? null;
  const files = noteFiles(data.activities);

  return (
    <div className="@container crm-fade-in flex h-full max-h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden px-4 py-5 sm:px-6 sm:py-6">
      <LeadSummaryAutoRefresh
        contactId={contactId}
        onRefresh={intelligence.reload}
        inFlight={intelligence.inFlight}
      />

      <div className="space-y-3">
        {data.duplicateInfo.duplicates.length ? (
          <ContactDuplicateAlert
            contactId={contactId}
            duplicates={data.duplicateInfo.duplicates}
            onMerged={onReload}
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
      </div>

      <nav className="mt-4 flex items-center gap-2 text-sm text-text-caption">
        {onBack ? (
          <button
            type="button"
            className="font-medium text-text-secondary hover:text-text-primary hover:underline"
            onClick={onBack}
          >
            Contacts
          </button>
        ) : (
          <Link
            to="/contact"
            className="font-medium text-text-secondary hover:text-text-primary hover:underline"
          >
            Contacts
          </Link>
        )}
        <ChevronRight className="size-3.5" strokeWidth={1.75} aria-hidden />
        <span className="truncate text-text-primary">{displayName}</span>
      </nav>

      <header className="mt-4 flex flex-col gap-3 @xl:flex-row @xl:items-start @xl:justify-between">
        <div className="flex min-w-0 flex-1 gap-4">
          <div
            className="flex size-14 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-base font-semibold text-text-primary"
            aria-hidden
          >
            {initials(displayName, person.firstName, person.lastName)}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="break-words text-xl font-semibold tracking-tight text-text-primary">
                {displayName}
              </h1>
              {person.leadStatus ? (
                <span className={leadStatusTone(person.leadStatus)}>
                  {formatLeadStatus(person.leadStatus)}
                </span>
              ) : null}
              <LeadEnrichmentStatusBadge
                contactId={contactId}
                initialStatus={enrichmentStatus?.status ?? null}
                onRefreshed={onReload}
              />
            </div>
            <p className="mt-1 break-words text-sm text-text-secondary">
              {person.title || "Contact"}
              {companyName ? (
                <>
                  {" · "}
                  {person.companyId ? (
                    <Link
                      to={`/company/${person.companyId}`}
                      className="font-medium text-text-link hover:underline"
                    >
                      {companyName}
                    </Link>
                  ) : (
                    companyName
                  )}
                </>
              ) : null}
            </p>
            <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-secondary">
              {person.email ? (
                <li className="inline-flex min-w-0 items-center gap-1.5">
                  <Mail className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                  <span className="min-w-0 break-all">{person.email}</span>
                </li>
              ) : null}
              {person.phone ? (
                <li className="inline-flex items-center gap-1.5">
                  <Phone className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                  <span>{person.phone}</span>
                </li>
              ) : null}
              {locationLabel ? (
                <li className="inline-flex min-w-0 items-center gap-1.5">
                  <MapPin className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                  <span className="min-w-0 break-words">{locationLabel}</span>
                </li>
              ) : null}
            </ul>
          </div>
        </div>

        <div className="shrink-0 @xl:pt-0.5">
          <ContactQuickActions
            variant="toolbar"
            contactId={contactId}
            displayName={displayName}
            email={person.email}
            phone={person.phone}
            assignableUsers={data.assignableUsers}
            currentUserId={data.currentUserId}
            canAssignAssignee={data.canAssignAssignee}
            onChanged={onReload}
            menuExtras={
              <>
                {showConvert && isConvertibleLead ? (
                  <ConvertLeadButton
                    menuItem
                    contactId={contactId}
                    contactName={displayName}
                    companyName={companyName ?? undefined}
                    leadStatus={person.leadStatus}
                    businessType="b2b"
                  />
                ) : null}
                {showSales && relatedDeals.length === 1 && primaryDeal ? (
                  <Link
                    to={`/sales/${primaryDeal.id}`}
                    role="menuitem"
                    className={QUICK_ACTION_MENU_ITEM_CLASS}
                  >
                    View deals
                  </Link>
                ) : null}
                {showSales && relatedDeals.length > 1 ? (
                  <button
                    type="button"
                    role="menuitem"
                    className={QUICK_ACTION_MENU_ITEM_CLASS}
                    onClick={() => selectTab("deals")}
                  >
                    View deals ({relatedDeals.length})
                  </button>
                ) : null}
                <Link
                  to={`/contact/${contactId}/edit`}
                  role="menuitem"
                  className={QUICK_ACTION_MENU_ITEM_CLASS}
                >
                  Edit
                </Link>
                <DeleteContactButton
                  menuItem
                  id={contactId}
                  name={displayName}
                  onDeleted={onBack}
                />
              </>
            }
          />
        </div>
      </header>

      <section
        className="mt-5 grid grid-cols-2 gap-3 @3xl:grid-cols-4"
        aria-label="Contact summary"
      >
        <Kpi
          icon={<UserRound className="size-4" strokeWidth={1.75} />}
          label="Contact Type"
          value={formatContactType(person.contactType)}
        />
        <Kpi
          icon={<span className="size-2 rounded-full bg-text-success" />}
          label="Lead Status"
          value={
            person.leadStatus ? (
              <span className={leadStatusTone(person.leadStatus)}>
                {formatLeadStatus(person.leadStatus)}
              </span>
            ) : (
              "—"
            )
          }
        />
        <Kpi
          icon={<Globe className="size-4" strokeWidth={1.75} />}
          label="Lead Source"
          value={data.utmSource || crm.leadSource || person.leadSource}
        />
        <Kpi
          icon={<UserRound className="size-4" strokeWidth={1.75} />}
          label="Owner"
          value={ownerShort(ownerLabel)}
        />
      </section>

      <div
        className="mt-5 flex gap-1 overflow-x-auto border-b border-border-default"
        role="tablist"
        aria-label="Contact sections"
      >
        {TABS.map((item) => {
          const selected = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`contact-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`contact-panel-${item.id}`}
              className={`shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium ${
                selected
                  ? "border-neutral-900 text-text-primary"
                  : "border-transparent text-text-caption hover:text-text-secondary"
              }`}
              onClick={() => selectTab(item.id)}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <div
        className={
          tab === "overview"
            ? "mt-5 min-h-0 flex-1 overflow-y-auto @3xl:overflow-hidden"
            : "mt-5 min-h-0 flex-1 overflow-y-auto"
        }
        role="tabpanel"
        id={`contact-panel-${tab}`}
        aria-labelledby={`contact-tab-${tab}`}
      >
        {tab === "overview" ? (
          <div className="flex flex-col gap-4 @3xl:h-full @3xl:min-h-0 @3xl:flex-row @3xl:overflow-hidden">
            <div className="min-w-0 flex-1 @3xl:min-h-0 @3xl:overflow-y-auto">
              <div className="grid grid-cols-1 items-start gap-4 @5xl:grid-cols-[minmax(20rem,24rem)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-4">
              <Card
                title="Contact Details"
                icon={<UserRound className="size-4" strokeWidth={1.75} />}
                action={
                  <Link
                    to={`/contact/${contactId}/edit`}
                    className="text-sm font-medium text-text-link hover:underline"
                  >
                    Edit
                  </Link>
                }
              >
                <dl className="space-y-3">
                  <DetailRow label="Name" value={displayName} />
                  <DetailRow
                    label="Email"
                    value={emails.length ? emails.join(", ") : null}
                  />
                  <DetailRow
                    label="Phone"
                    value={phones.length ? phones.join(", ") : null}
                  />
                  <DetailRow label="Title" value={person.title} />
                  <DetailRow
                    label="City"
                    value={person.city?.trim() || companyLocation?.city || null}
                    showEmpty
                  />
                  <DetailRow label="Country" value={person.country} showEmpty />
                  <DetailRow label="Address" value={contactAddress} showEmpty />
                  <DetailRow
                    label="Created"
                    value={
                      person.createdAt
                        ? formatActivityWhen(person.createdAt)
                        : null
                    }
                  />
                </dl>
              </Card>
              <Card
                title="Company Details"
                icon={<Building2 className="size-4" strokeWidth={1.75} />}
                action={
                  person.companyId ? (
                    <Link
                      to={`/company/${person.companyId}`}
                      className="text-sm font-medium text-text-link hover:underline"
                    >
                      View
                    </Link>
                  ) : (
                    <Link
                      to={`/contact/${contactId}/edit`}
                      className="text-sm font-medium text-text-link hover:underline"
                    >
                      Link company
                    </Link>
                  )
                }
              >
                <dl className="space-y-3">
                  <DetailRow
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
                  <DetailRow label="Domain" value={companyDomain} />
                  <DetailRow label="Industry" value={industry} />
                  <DetailRow label="Company Size" value={companySize} />
                  <DetailRow label="Location" value={companyLocationLabel} />
                  <DetailRow label="Address" value={companyAddress} />
                </dl>
              </Card>
            </div>
            <div className="min-w-0 space-y-4">
              <AiContactIntelligence
                loading={intelligence.loading}
                summary={intelligence.summary}
                scoreStatus={intelligence.scoreStatus}
                lastActivityAt={latestActivityAt([
                  ...data.activities.filter(
                    (activity) => !isCampaignNurturePlaceholder(activity.subject),
                  ),
                  ...data.relatedDealActivities,
                ])}
                activities={data.activities.filter(
                  (activity) => !isCampaignNurturePlaceholder(activity.subject),
                )}
                followUpBusy={followUpBusy}
                followUpError={followUpError}
                onSendFollowUp={async (nextStep) => {
                  setFollowUpError(null);
                  setFollowUpBusy(true);
                  try {
                    const result = await draftNbaFollowUpEmail(
                      contactId,
                      nextStep,
                    );
                    if (!result.ok) {
                      setFollowUpError(
                        result.error || "Could not draft that follow-up.",
                      );
                      return;
                    }
                    setFollowUp({
                      subject: result.subject,
                      message: result.body,
                    });
                  } catch {
                    setFollowUpError("Could not draft that follow-up. Try again.");
                  } finally {
                    setFollowUpBusy(false);
                  }
                }}
              />
              <BantCard contactId={contactId} bant={bant} />
              {showSales ? (
                <DealsCard
                  deals={relatedDeals}
                  convertible={Boolean(showConvert && isConvertibleLead)}
                  contactId={contactId}
                  displayName={displayName}
                  companyName={companyName}
                  leadStatus={person.leadStatus}
                  onViewAll={() => selectTab("deals")}
                />
              ) : null}
            </div>
              </div>
            </div>
            <div className="flex min-h-0 w-full flex-col @3xl:h-full @3xl:w-[18.5rem] @3xl:shrink-0">
            <ActivityRail
              activities={[
                ...data.activities
                  .filter((activity) => !isCampaignNurturePlaceholder(activity.subject))
                  .map((activity) => ({
                  id: activity.id,
                  source: "contact" as const,
                  type: activity.type,
                  subject: activity.subject,
                  body: activity.body,
                  createdAt: activity.createdAt,
                  dueAt: activity.dueAt,
                  emailDirection: activity.emailDirection,
                  folder: activity.folder,
                  threadId: activity.threadId,
                  gmailThreadId: activity.gmailThreadId,
                })),
                ...data.relatedDealActivities.map((activity) => ({
                  id: activity.id,
                  source: "deal" as const,
                  type: activity.type,
                  subject: activity.subject,
                  body: activity.body,
                  createdAt: activity.createdAt,
                  dueAt: activity.dueAt,
                })),
              ]}
              expanded={railExpanded}
              onExpandedChange={setRailExpanded}
              focusId={tab === "overview" ? focusActivityId : null}
              onViewNotes={() => selectTab("notes")}
              onViewCalls={() => selectTab("calls")}
            />
            </div>
          </div>
        ) : null}

        {tab === "deals" ? (
          showSales ? (
            <DealsCard
              deals={relatedDeals}
              convertible={Boolean(showConvert && isConvertibleLead)}
              contactId={contactId}
              displayName={displayName}
              companyName={companyName}
              leadStatus={person.leadStatus}
              expanded
            />
          ) : (
            <EmptyPanel title="Deals" body="Sales is not enabled for this account." />
          )
        ) : null}

        {tab === "emails" ? (
          <ContactActivityTimeline
            embedded
            lockedType="email"
            title="Emails"
            focusActivityId={focusActivityId}
            contactId={contactId}
            displayName={displayName}
            email={person.email}
            phone={person.phone}
            activities={data.activities.filter(
              (activity) => !isCampaignNurturePlaceholder(activity.subject),
            )}
            relatedDealActivities={data.relatedDealActivities}
            assignableUsers={data.assignableUsers}
            currentUserId={data.currentUserId}
            canAssignAssignee={data.canAssignAssignee}
            onChanged={onReload}
          />
        ) : null}

        {tab === "calls" ? (
          <ContactActivityTimeline
            embedded
            lockedType="call"
            title="Calls"
            focusActivityId={focusActivityId}
            contactId={contactId}
            displayName={displayName}
            email={person.email}
            phone={person.phone}
            activities={data.activities}
            relatedDealActivities={data.relatedDealActivities}
            assignableUsers={data.assignableUsers}
            currentUserId={data.currentUserId}
            canAssignAssignee={data.canAssignAssignee}
            onChanged={onReload}
          />
        ) : null}

        {tab === "meetings" ? (
          <ContactActivityTimeline
            embedded
            lockedType="meeting"
            title="Meetings"
            focusActivityId={focusActivityId}
            contactId={contactId}
            displayName={displayName}
            email={person.email}
            phone={person.phone}
            activities={data.activities}
            relatedDealActivities={data.relatedDealActivities}
            assignableUsers={data.assignableUsers}
            currentUserId={data.currentUserId}
            canAssignAssignee={data.canAssignAssignee}
            onChanged={onReload}
          />
        ) : null}

        {tab === "tasks" ? (
          <ContactActivityTimeline
            embedded
            lockedType="task"
            title="Tasks"
            focusActivityId={focusActivityId}
            contactId={contactId}
            displayName={displayName}
            email={person.email}
            phone={person.phone}
            activities={data.activities}
            relatedDealActivities={data.relatedDealActivities}
            assignableUsers={data.assignableUsers}
            currentUserId={data.currentUserId}
            canAssignAssignee={data.canAssignAssignee}
            onChanged={onReload}
          />
        ) : null}

        {tab === "notes" ? (
          <ContactActivityTimeline
            embedded
            suppressEmptyState={Boolean(crm.notes?.trim())}
            leadingContent={
              crm.notes?.trim() ? (
                /* The profile note lives on the contact record, not the
                   timeline. It was saved on the form and then never shown. */
                <div className="rounded-xl border border-border-default bg-subtle p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-text-caption">
                    Profile note
                  </p>
                  <div className="mt-2">
                    <RichStructuredContent text={crm.notes} variant="compact" />
                  </div>
                </div>
              ) : null
            }
            lockedType="note"
            title="Notes"
            focusActivityId={focusActivityId}
            contactId={contactId}
            displayName={displayName}
            email={person.email}
            phone={person.phone}
            activities={data.activities}
            relatedDealActivities={data.relatedDealActivities}
            assignableUsers={data.assignableUsers}
            currentUserId={data.currentUserId}
            canAssignAssignee={data.canAssignAssignee}
            onChanged={onReload}
          />
        ) : null}

        {tab === "files" ? (
          <Card
            title="Files"
            icon={<FileText className="size-4" strokeWidth={1.75} />}
          >
            {files.length === 0 ? (
              <p className="text-sm text-text-caption">
                No files yet. Attachments added to notes show up here.
              </p>
            ) : (
              <ul className="space-y-4">
                {files.map((file) => (
                  <li key={file.key}>
                    <p className="mb-2 text-xs text-text-caption">
                      {formatActivityWhen(file.createdAt)}
                      {file.note ? ` · ${file.note}` : ""}
                    </p>
                    <NoteAttachmentsList attachments={[file.attachment]} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : null}

        <div className={tab === "insights" ? "space-y-4" : "hidden"}>
          <SalesGuidePanel
            contactId={contactId}
            displayName={displayName}
            email={person.email ?? ""}
            phone={person.phone}
            companyName={companyName}
            leadStatus={person.leadStatus}
            businessType="b2b"
            onChanged={onReload}
          />
          <Customer360Panel contactId={contactId} />
        </div>
      </div>

      {followUp != null ? (
        <EmailComposeDialog
          initialContact={{
            id: contactId,
            displayName,
            email: person.email,
            phone: person.phone,
          }}
          initialTo={person.email}
          initialSubject={followUp.subject}
          initialMessage={followUp.message}
          onClose={() => setFollowUp(null)}
          onSent={onReload}
        />
      ) : null}
    </div>
  );
}

function scoreFromContact(
  leadScore: DetailPayload["leadScore"],
): LeadScoreStatusView {
  if (!leadScore) return null;
  const score = leadScore.score ?? leadScore.previousScore;
  if (score == null) return null;
  return {
    status: leadScore.status,
    score,
    fitScore: leadScore.fitScore,
    intentScore: leadScore.intentScore,
    scoreDelta: null,
    grade: leadScore.grade,
    band: leadScore.band,
    rationale: leadScore.rationale,
    factors: [],
    positiveReasons: [],
    negativeReasons: [],
    behaviouralPositiveReasons: [],
    behaviouralNegativeReasons: [],
    behaviouralReasons: [],
    pillars: null,
    nextBestAction: null,
    salesReady: false,
    previousScore: leadScore.previousScore ?? leadScore.score,
    updatedAt: leadScore.updatedAt,
  };
}

function useLeadIntelligence(
  contactId: string,
  leadScore: DetailPayload["leadScore"],
) {
  const seeded = scoreFromContact(leadScore);
  const [summary, setSummary] = useState<LeadSummaryView | null>(null);
  const [scoreStatus, setScoreStatus] = useState<LeadScoreStatusView>(seeded);
  const [loading, setLoading] = useState(true);
  const contactRef = useRef(contactId);
  contactRef.current = contactId;
  const seededRef = useRef(seeded);
  seededRef.current = seeded;

  const reload = useCallback(async () => {
    const requested = contactId;
    try {
      const result = await fetchLeadSummary(contactId);
      if (contactRef.current !== requested || !result.ok) return;
      setSummary(result.summary);
      setScoreStatus((current) => mergeLeadScoreStatus(current, result.scoreStatus));
    } finally {
      if (contactRef.current === requested) setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    setSummary(null);
    setScoreStatus(seededRef.current);
  }, [contactId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const inFlight =
    (scoreStatus?.status === "pending" ||
      scoreStatus?.status === "scoring" ||
      scoreStatus?.status === "queued") &&
    scoreStatus?.score == null;

  return { summary, scoreStatus, loading, reload, inFlight };
}

function EngagementSummary({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [text]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open) {
      setOverflows(true);
      return;
    }
    setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [text, open]);

  return (
    <div className="mt-2">
      <p
        ref={ref}
        className={`whitespace-pre-wrap break-words text-sm leading-6 text-text-primary ${
          open ? "" : "line-clamp-3"
        }`}
      >
        {text}
      </p>
      {overflows ? (
        <button
          type="button"
          className="mt-1 text-xs font-medium text-text-link hover:underline"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}

const CHANNEL_ICON: Record<IntelligenceChannelId, LucideIcon> = {
  email: Mail,
  call: Phone,
  meeting: Calendar,
  sms: MessageSquare,
  whatsapp: MessageCircle,
  chat: MessagesSquare,
  social: Share2,
  ccaas: Headset,
  note: StickyNote,
};

function ChannelSummaryCard({ channel }: { channel: ChannelSection }) {
  const [open, setOpen] = useState(true);
  const Icon = CHANNEL_ICON[channel.id];
  const lines = channel.items.flatMap((item, index) => {
    const text = cleanSummaryText(item.text);
    if (!text) return [];
    return [{ key: `${channel.id}-${item.sourceId ?? index}`, text }];
  });
  const detail = cleanSummaryText(channel.detail);
  if (!lines.length && !detail) return null;

  return (
    <div className="rounded-lg border border-border-default bg-subtle/40 p-3">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon className="size-4 shrink-0 text-text-secondary" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 text-xs font-semibold text-text-secondary">
          {channel.label}
        </span>
        {open ? (
          <ChevronUp className="size-4 shrink-0 text-text-caption" strokeWidth={1.75} />
        ) : (
          <ChevronDown className="size-4 shrink-0 text-text-caption" strokeWidth={1.75} />
        )}
      </button>
      {open ? (
        <>
          {lines.length ? (
            <ul className="mt-2 space-y-2">
              {lines.map((line) => (
                <li key={line.key} className="text-sm leading-6 text-text-primary">
                  {line.text}
                </li>
              ))}
            </ul>
          ) : null}
          {detail ? (
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-text-primary">
              {detail}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function AiContactIntelligence({
  loading,
  summary,
  scoreStatus,
  lastActivityAt,
  activities,
  followUpBusy,
  followUpError,
  onSendFollowUp,
}: {
  loading: boolean;
  summary: LeadSummaryView | null;
  scoreStatus: LeadScoreStatusView;
  lastActivityAt: string | null;
  activities: ContactActivityDetail[];
  followUpBusy: boolean;
  followUpError: string | null;
  onSendFollowUp: (nextStep: string) => void;
}) {
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const nextStep =
    summary?.recommendedAction?.trim() ||
    scoreStatus?.nextBestAction?.trim() ||
    "";
  const omniBrief = parseChannelSummary(summary?.omniChannelSummary);
  const eventBrief = eventSummaryBrief(summary);
  const overview = cleanSummaryText(intelligenceOverview(summary));
  const channels = buildChannelSections({
    summary: summary
      ? {
          ...summary,
          omniChannelSummary: omniBrief ? null : summary.omniChannelSummary,
          citations: omniBrief
            ? (summary.citations ?? []).filter((line) => line.sourceKind !== "omni")
            : summary.citations,
        }
      : summary,
    activities,
  });
  const updatedLabel = lastActivityAt ? formatActivityWhen(lastActivityAt) : "";
  const intent = summary?.intent ?? null;
  const rationale = cleanSummaryText(
    scoreStatus?.rationale?.replace(/\s*Guardrails:.*$/s, ""),
  );
  const statedNext = cleanSummaryText(nextStep);
  const summarySource = [
    omniBrief?.narrative,
    ...(omniBrief?.channels.map((line) => `${line.label}: ${line.text}`) ?? []),
    ...(omniBrief?.notes ?? []),
    summary?.summary,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  const nextStepInSummary =
    statedNext.length > 0 && summarySource.includes(statedNext.toLowerCase());
  const fit = scoreStatus?.fitScore;
  const intentScore = scoreStatus?.intentScore;

  return (
    <Card
      title="AI Contact Intelligence"
      icon={<span className="text-xs font-semibold text-text-caption">AI</span>}
      action={
        updatedLabel ? (
          <span className="text-xs text-text-caption">Updated {updatedLabel}</span>
        ) : null
      }
    >
      {loading && !summary && !scoreStatus && !overview && channels.length === 0 ? (
        <p className="text-sm text-text-caption">Reading this contact…</p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-4 @md/card:flex-row @md/card:items-start">
            <div className="flex shrink-0 flex-col items-start gap-2">
              <LeadScoreBadge
                status={scoreStatus?.status ?? null}
                score={scoreStatus?.score ?? scoreStatus?.previousScore ?? null}
                showLabel={false}
                size="lg"
              />
              {rationale ? (
                <Button
                  variant="secondary"
                  className="h-8 px-2.5 text-xs"
                  aria-expanded={reasoningOpen}
                  onClick={() => setReasoningOpen((open) => !open)}
                >
                  Why this score
                </Button>
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {intent ? (
                  <span
                    className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      INTENT_TONE[intent] ?? "bg-neutral-100 text-text-secondary"
                    }`}
                  >
                    {intent}
                  </span>
                ) : null}
                {typeof fit === "number" || typeof intentScore === "number" ? (
                  <span className="text-xs text-text-caption">
                    {typeof fit === "number" ? `Fit ${fit}` : null}
                    {typeof fit === "number" && typeof intentScore === "number"
                      ? " · "
                      : null}
                    {typeof intentScore === "number" ? `Intent ${intentScore}` : null}
                  </span>
                ) : null}
              </div>
              {eventBrief && (eventBrief.narrative || eventBrief.notes.length > 0) ? (
                <div className="mt-2">
                  <ChannelSummaryBriefView
                    brief={{ ...eventBrief, channels: [] }}
                  />
                </div>
              ) : overview ? (
                <EngagementSummary text={overview} />
              ) : null}
            </div>
          </div>

          {reasoningOpen && rationale ? (
            <div className="rounded-lg border border-border-default bg-surface px-3 py-3">
              <p className="text-xs font-semibold text-text-secondary">Score reason</p>
              <p className="mt-1 text-sm leading-6 text-text-primary">{rationale}</p>
            </div>
          ) : null}

          {channels.length ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                By channel
              </p>
              <div className="mt-2 space-y-3">
                {channels.map((channel) => (
                  <ChannelSummaryCard key={channel.id} channel={channel} />
                ))}
              </div>
            </div>
          ) : null}

          {nextStepInSummary ? (
          <div className="rounded-lg border border-border-default bg-subtle/40 p-3">
            <p className="text-xs font-semibold text-text-secondary">Next best action</p>
            <p className="mt-2 text-sm leading-6 text-text-primary">{statedNext}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="primary"
                className="h-8 px-3 text-xs"
                disabled={followUpBusy}
                onClick={() => onSendFollowUp(statedNext)}
              >
                {followUpBusy ? "Drafting…" : "Send follow-up"}
              </Button>
            </div>
            {followUpError ? (
              <p className="mt-2 text-xs text-red-600">{followUpError}</p>
            ) : null}
          </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}

function BantCard({
  contactId,
  bant,
}: {
  contactId: string;
  bant: {
    budget: boolean | null | undefined;
    authority: boolean | null | undefined;
    need: boolean | null | undefined;
    timeline: boolean | null | undefined;
    budgetDetail?: string | null;
    authorityDetail?: string | null;
    needDetail?: string | null;
    timelineDetail?: string | null;
  };
}) {
  return (
    <Card
      title="Qualification (BANT)"
      action={
        <Link
          to={`/contact/${contactId}/edit`}
          className="text-sm font-medium text-text-link hover:underline"
        >
          Edit
        </Link>
      }
    >
      <dl className="grid grid-cols-2 gap-y-4 @sm/card:grid-cols-4 @sm/card:divide-x @sm/card:divide-border-default">
        <BantItem label="Budget" value={bant.budget} detail={bant.budgetDetail} />
        <BantItem label="Authority" value={bant.authority} detail={bant.authorityDetail} />
        <BantItem label="Need" value={bant.need} detail={bant.needDetail} />
        <BantItem label="Timeline" value={bant.timeline} detail={bant.timelineDetail} />
      </dl>
    </Card>
  );
}

function DealsCard({
  deals,
  convertible,
  contactId,
  displayName,
  companyName,
  leadStatus,
  expanded = false,
  onViewAll,
}: {
  deals: DetailPayload["relatedDeals"];
  convertible: boolean;
  contactId: string;
  displayName: string;
  companyName: string | null;
  leadStatus: string;
  expanded?: boolean;
  onViewAll?: () => void;
}) {
  const visible = expanded ? deals : deals.slice(0, 3);
  return (
    <Card
      title="Deals"
      icon={<Building2 className="size-4" strokeWidth={1.75} />}
      action={
        deals.length > 0 && onViewAll ? (
          <button
            type="button"
            className="text-sm font-medium text-text-link hover:underline"
            onClick={onViewAll}
          >
            View all deals
          </button>
        ) : null
      }
    >
      {deals.length === 0 ? (
        <div className="flex flex-col items-center px-4 py-6 text-center">
          <FileText className="size-8 text-text-caption" strokeWidth={1.5} />
          <p className="mt-3 text-sm font-medium text-text-primary">No active deals</p>
          <p className="mt-1 text-sm text-text-caption">
            This contact is not associated with any deals yet.
          </p>
          {convertible ? (
            <div className="mt-4">
              <ConvertLeadButton
                contactId={contactId}
                contactName={displayName}
                companyName={companyName ?? undefined}
                leadStatus={leadStatus}
                businessType="b2b"
              />
            </div>
          ) : null}
        </div>
      ) : (
        <ul className="divide-y divide-border-default">
          {visible.map((deal) => (
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
                {deal.amount ? ` · ${deal.amount}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ActivityRail({
  activities,
  expanded,
  onExpandedChange,
  focusId = null,
  onViewNotes,
  onViewCalls,
}: {
  activities: Array<{
    id: string;
    source: "contact" | "deal";
    type: string;
    subject: string;
    body: string | null;
    createdAt: string;
    dueAt?: string | null;
    emailDirection?: "outbound" | "inbound" | null;
    folder?: string | null;
    threadId?: string | null;
    gmailThreadId?: string | null;
  }>;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  focusId?: string | null;
  onViewNotes: () => void;
  onViewCalls: () => void;
}) {
  const navigate = useNavigate();
  const scrolledFocusId = useRef<string | null>(null);
  const [filter, setFilter] = useState<RailFilter>("all");
  const sorted = [...activities].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const filtered =
    filter === "all" ? sorted : sorted.filter((activity) => activity.type === filter);
  const visible = filtered;

  useEffect(() => {
    if (!focusId) return;
    const node = document.getElementById(`contact-activity-${focusId}`);
    if (node) {
      if (scrolledFocusId.current === focusId) return;
      scrolledFocusId.current = focusId;
      node.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (!expanded) onExpandedChange(true);
  }, [focusId, expanded, visible.length, onExpandedChange]);

  return (
    <aside className="flex w-full min-w-0 flex-col rounded-xl border border-border-default bg-surface p-4 @3xl:h-full @3xl:min-h-0 @3xl:overflow-hidden">
      <h2 className="shrink-0 text-sm font-semibold text-text-primary">
        Activity & Communication
      </h2>
      <div className="mt-3 flex shrink-0 flex-wrap gap-1" role="tablist" aria-label="Activity filters">
        {RAIL_FILTERS.map((item) => {
          const selected = filter === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                selected
                  ? "bg-neutral-900 text-white"
                  : "text-text-caption hover:bg-neutral-100 hover:text-text-primary"
              }`}
              onClick={() => {
                setFilter(item.id);
                onExpandedChange(false);
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {filtered.length === 0 ? (
        <p className="mt-4 text-sm text-text-caption">No activity in this view yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border-default @3xl:min-h-0 @3xl:flex-1 @3xl:overflow-y-auto @3xl:overscroll-y-contain">
          {visible.map((activity) => {
            const href = hrefForActivity(activity);
            const isNote = activity.type === "note";
            const isCall = activity.type === "call" && activity.source === "contact";
            const clickable = Boolean(href) || isNote || isCall;
            const open = () => {
              if (isNote) {
                onViewNotes();
                return;
              }
              if (isCall) {
                onViewCalls();
                window.requestAnimationFrame(() => {
                  document
                    .getElementById(`contact-activity-${activity.id}`)
                    ?.scrollIntoView({ behavior: "smooth", block: "center" });
                });
                return;
              }
              if (href) navigate(href);
            };
            return (
            <li
              key={`${activity.source}-${activity.id}`}
              id={
                activity.source === "contact"
                  ? `contact-activity-${activity.id}`
                  : undefined
              }
              className={`flex scroll-mt-24 gap-3 py-3 ${
                focusId && activity.id === focusId
                  ? "rounded-md bg-neutral-50 ring-1 ring-neutral-300"
                  : ""
              }`}
            >
              <ActivityTypeIcon type={activity.type} size="sm" />
              <div className="min-w-0 flex-1">
                {clickable ? (
                  <button
                    type="button"
                    className="-mx-1 w-[calc(100%+0.5rem)] min-w-0 rounded-md px-1 py-0.5 text-left hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
                    onClick={open}
                  >
                    <p className="text-sm font-medium text-text-primary">
                      {activityHeading(activity)}
                    </p>
                    <p className="text-xs text-text-caption">
                      {formatActivityWhen(activity.createdAt)}
                    </p>
                    <p
                      className={`mt-1 line-clamp-2 break-words text-sm ${
                        href || isCall ? "text-text-link" : "text-text-secondary"
                      }`}
                    >
                      {activity.type === "email"
                        ? normalizeEmailDisplayText(activity.subject)
                        : sanitizeActivityDisplayText(activity.subject)}
                    </p>
                  </button>
                ) : (
                  <>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                      <p className="text-sm font-medium text-text-primary">
                        {activityHeading(activity)}
                      </p>
                    </div>
                    <p className="text-xs text-text-caption">
                      {formatActivityWhen(activity.createdAt)}
                    </p>
                    <p className="mt-1 line-clamp-2 break-words text-sm text-text-secondary">
                      {sanitizeActivityDisplayText(activity.subject)}
                    </p>
                  </>
                )}
              </div>
            </li>
            );
          })}
        </ul>
      )}
      {filter === "note" && filtered.length > 0 ? (
        <button
          type="button"
          className="mt-2 block text-sm font-medium text-text-link hover:underline"
          onClick={onViewNotes}
        >
          Open notes
        </button>
      ) : null}
      {filter === "call" && filtered.length > 0 ? (
        <button
          type="button"
          className="mt-2 block text-sm font-medium text-text-link hover:underline"
          onClick={onViewCalls}
        >
          Open call transcripts
        </button>
      ) : null}
    </aside>
  );
}

function Card({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="@container/card min-w-0 rounded-xl border border-border-default bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-text-primary">
          {icon ? <span className="text-text-caption">{icon}</span> : null}
          {title}
        </h2>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Kpi({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border-default bg-surface px-4 py-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-text-secondary">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-xs text-text-caption">{label}</p>
        <div className="mt-0.5 break-words text-sm font-medium text-text-primary">
          {value || "—"}
        </div>
      </div>
    </div>
  );
}

function hasDetailValue(value: ReactNode): boolean {
  if (value == null || value === false) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  return true;
}

/** Empty fields stay hidden unless showEmpty (city / country / address). */
function DetailRow({
  label,
  value,
  showEmpty = false,
}: {
  label: string;
  value: ReactNode;
  showEmpty?: boolean;
}) {
  if (!showEmpty && !hasDetailValue(value)) return null;
  return (
    <div className="grid grid-cols-[6.75rem_minmax(0,1fr)] items-baseline gap-x-3">
      <dt className="text-sm text-text-caption">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-text-primary">
        {hasDetailValue(value) ? value : "—"}
      </dd>
    </div>
  );
}

function BantItem({
  label,
  value,
  detail,
}: {
  label: string;
  value: boolean | null | undefined;
  detail?: string | null;
}) {
  const confirmed = value === true;
  const phrase = detail?.trim() ?? "";
  return (
    <div className="min-w-0 px-3 first:pl-0 last:pr-0">
      <dt className="text-xs text-text-caption">{label}</dt>
      <dd
        className={`mt-1 text-sm font-medium ${
          confirmed ? "text-text-success" : "text-text-caption"
        }`}
      >
        {confirmed ? "Confirmed" : "Pending"}
      </dd>
      {confirmed && phrase ? (
        <p className="mt-1 text-xs font-normal leading-5 text-text-primary">{phrase}</p>
      ) : null}
    </div>
  );
}

function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <Card title={title}>
      <p className="text-sm text-text-caption">{body}</p>
    </Card>
  );
}

function uniqueValues(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function formatCompanySize(
  band: string | null | undefined,
  count: number | null | undefined,
): string | null {
  const trimmed = band?.trim();
  if (trimmed) return trimmed;
  if (typeof count === "number" && Number.isFinite(count)) {
    return count.toLocaleString();
  }
  return null;
}

function headerLocation(
  person: DetailPayload["contact"]["person"],
  companyLocation: { city?: string | null; address?: string | null; name?: string } | null,
): string | null {
  const parts = uniqueValues([
    person.city,
    companyLocation?.city,
    person.country,
  ]);
  if (parts.length) return parts.join(", ");
  return companyLocation
    ? displayCompanyLocationLabel({
        name: companyLocation.name ?? "",
        city: companyLocation.city,
        address: companyLocation.address,
      })
    : null;
}

function initials(displayName: string, firstName: string, lastName: string): string {
  const first = firstName.trim();
  const last = lastName.trim();
  if (first || last) {
    return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase() || "?";
  }
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]!.charAt(0)}${parts[parts.length - 1]!.charAt(0)}`.toUpperCase();
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
  const assignable = assignableUsers.find((user) => user.id === id);
  if (assignable?.label) return assignable.label;
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

function latestActivityAt(
  activities: Array<{ createdAt: string }>,
): string | null {
  let best = Number.NEGATIVE_INFINITY;
  let iso: string | null = null;
  for (const activity of activities) {
    const time = Date.parse(activity.createdAt);
    if (!Number.isFinite(time) || time < best) continue;
    best = time;
    iso = activity.createdAt;
  }
  return iso;
}

function formatActivityWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function isCampaignNurturePlaceholder(subject: string): boolean {
  return /^Nurture \(Campaign personalised\) — run /i.test(subject.trim());
}

function activityHeading(activity: {
  type: string;
  subject: string;
  emailDirection?: "outbound" | "inbound" | null;
  folder?: string | null;
}): string {
  if (activity.type === "email") {
    if (activity.emailDirection === "inbound" || activity.folder === "inbox") {
      return "Email received";
    }
    if (activity.emailDirection === "outbound" || activity.folder === "sent") {
      return "Email sent";
    }
    return "Email";
  }
  if (activity.type === "call") {
    const blob = `${activity.subject}`.toLowerCase();
    if (blob.includes("inbound")) return "Inbound call";
    if (blob.includes("outbound")) return "Outbound call";
    return "Call";
  }
  if (activity.type === "meeting") return "Meeting scheduled";
  if (activity.type === "note") return "Note added";
  if (activity.type === "task") return "Task";
  if (activity.type === "sms") return "SMS";
  return activity.type.charAt(0).toUpperCase() + activity.type.slice(1);
}

function noteFiles(activities: DetailPayload["activities"]) {
  return activities.flatMap((activity) => {
    if (activity.type !== "note") return [];
    const parsed = parseNoteBody(activity.body);
    return parsed.attachments.map((attachment, index) => ({
      key: `${activity.id}-${index}-${attachment.filename}`,
      attachment,
      createdAt: activity.createdAt,
      note: parsed.plain || activity.subject,
    }));
  });
}
