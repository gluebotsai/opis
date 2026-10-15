import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ChevronUp, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDeleteButton } from "@/components/ui/ConfirmDeleteButton";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { BackLink } from "@/components/ui/BackLink";
import { Textarea } from "@/components/ui/Textarea";
import { displayCompanyLocationLabel } from "@/lib/company-location-label";
import {
  DEAL_STAGE_LABELS,
  DEAL_STAGE_OPTIONS,
  formatMoneyFull,
  stageBadgeClass,
} from "@/lib/deal-stages";
import {
  ACTIVITY_TYPE_LABELS,
  ActivityTypeBadge,
  ActivityTypeIcon,
} from "@/lib/activity-type-style";
import {
  AddNoteDialog,
  AddTaskDialog,
  ContactQuickActions,
  ScheduleMeetingDialog,
  SmsSendDialog,
} from "@/components/contacts/ContactQuickActions";
import { ContactDetailsCard } from "@/components/contacts/ContactDetailsCard";
import { NoteActivityDetails } from "@/components/contacts/NoteActivityDetails";
import { RichStructuredContent } from "@/components/content/RichStructuredContent";
import { EmailBodyContent } from "@/components/inbox/EmailBodyContent";
import { MeetingActivityDetails } from "@/components/contacts/MeetingActivityDetails";
import { CallActivityDetails } from "@/components/contacts/CallActivityDetails";
import { DispositionTag } from "@/components/contacts/DispositionTag";
import { normalizeEmailDisplayText } from "@/lib/email-body";
import { CallLogDialog } from "@/components/email/CallLogDialog";
import { EmailComposeDialog } from "@/components/email/EmailComposeDialog";
import { DealRecordEditDialog } from "@/components/sales/DealRecordEditDialog";
import { DealProposalsPanel } from "@/components/sales/DealProposalsPanel";
import { DealQuotesPanel } from "@/components/sales/DealQuotesPanel";
import { emptyQuoteDraft } from "@/components/sales/QuoteCreateDraftPanel";
import { DealContractsPanel } from "@/components/sales/DealContractsPanel";
import { DealBuyingGroupPanel } from "@/components/sales/DealBuyingGroupPanel";
import { DealHistoryPanel } from "@/components/sales/DealHistoryPanel";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";
import type { CoworkerSuggestion } from "@/components/coworker/types";
import { DealDetailPageSkeleton } from "@/pages/DealDetailPageSkeleton";
import { deleteActivity as deleteContactActivity } from "@/services/contacts";
import { reassignDeal } from "@/services/home";
import {
  createDealActivity,
  deleteDeal,
  deleteDealActivity,
  fetchDeal,
  fetchDealHistory,
  updateDeal,
  updateDealStage,
  type ClosedWonExtras,
  type DealActivityRow,
  type DealHistoryEntry,
} from "@/services/sales";
import type { AgentToolProposal, QuoteDraftFields } from "@/services/coworker";
import { createQuote } from "@/services/quotes";
import {
  PAGE_H1_CLASS,
  SECTION_H2_CLASS,
  SUCCESS_FLASH_CLASS,
} from "@/lib/ui-tones";

const ACTIVITY_TAB_TYPES: Array<{ id: string; label: string }> = [
  { id: "note", label: "Notes" },
  { id: "call", label: "Call" },
  { id: "email", label: "Email" },
  { id: "sms", label: "SMS" },
  { id: "task", label: "Task" },
  { id: "meeting", label: "Schedule" },
];

const LOG_ACTIVITY_MENU: Array<{ id: string; label: string }> = [
  { id: "note", label: "Note" },
  { id: "call", label: "Call" },
  { id: "email", label: "Email" },
  { id: "sms", label: "SMS" },
  { id: "task", label: "Task" },
  { id: "meeting", label: "Schedule" },
];

type MainTab =
  | "activities"
  | "note"
  | "call"
  | "email"
  | "sms"
  | "task"
  | "meeting"
  | "proposals"
  | "quotes"
  | "history"
  | "overview";

type FeedFilter = string | "all" | "history";
type FeedSort = "newest" | "oldest";
type FeedTimeRange =
  | "all"
  | "today"
  | "yesterday"
  | "last_7_days"
  | "last_30_days"
  | "this_month"
  | "last_month";

const FEED_TIME_RANGE_OPTIONS: Array<{ value: FeedTimeRange; label: string }> =
  [
    { value: "all", label: "All time" },
    { value: "today", label: "Today" },
    { value: "yesterday", label: "Yesterday" },
    { value: "last_7_days", label: "Last 7 days" },
    { value: "last_30_days", label: "Last 30 days" },
    { value: "this_month", label: "This month" },
    { value: "last_month", label: "Last month" },
  ];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function feedTimeRangeBounds(
  range: FeedTimeRange,
  now = new Date(),
): { start: number; end: number } | null {
  if (range === "all") return null;

  const today = startOfDay(now);
  const endOfToday = new Date(today);
  endOfToday.setDate(endOfToday.getDate() + 1);

  if (range === "today") {
    return { start: today.getTime(), end: endOfToday.getTime() };
  }

  if (range === "yesterday") {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return { start: yesterday.getTime(), end: today.getTime() };
  }

  if (range === "last_7_days") {
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    return { start: start.getTime(), end: endOfToday.getTime() };
  }

  if (range === "last_30_days") {
    const start = new Date(today);
    start.setDate(start.getDate() - 29);
    return { start: start.getTime(), end: endOfToday.getTime() };
  }

  if (range === "this_month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: start.getTime(), end: endOfToday.getTime() };
  }

  // last_month
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 1);
  return { start: start.getTime(), end: end.getTime() };
}

type ActivitySource = "deal" | "contact";

type FeedItem =
  | {
      kind: "activity";
      id: string;
      activityId: string;
      source: ActivitySource;
      type: string;
      title: string;
      detail: string | null;
      dueAt: string | null;
      createdAt: string;
      sortAt: number;
      transcriptText?: string | null;
      transcriptSource?: string | null;
      disposition?: string | null;
    }
  | {
      kind: "history";
      id: string;
      title: string;
      detail: string;
      createdAt: string;
      sortAt: number;
    };

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-text-caption uppercase">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-text-primary">{value || "—"}</dd>
    </div>
  );
}

function ownerShort(label: string | null): string {
  if (!label) return "—";
  const paren = label.indexOf(" (");
  return paren > 0 ? label.slice(0, paren) : label;
}

export function DealDetailPage() {
  const { dealId } = useParams<{ dealId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<
    Awaited<ReturnType<typeof fetchDeal>> | null
  >(null);

  const [history, setHistory] = useState<DealHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityLogType, setActivityLogType] = useState<string>("note");
  const [lostReasonOpen, setLostReasonOpen] = useState(false);
  const [wonConfirmOpen, setWonConfirmOpen] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [pendingStage, setPendingStage] = useState<string | null>(null);
  const [wonSummary, setWonSummary] = useState<ClosedWonExtras | null>(null);
  const [quoteCreateOpen, setQuoteCreateOpen] = useState(false);
  const [quoteDraft, setQuoteDraft] = useState<QuoteDraftFields>(() =>
    emptyQuoteDraft({ dealId: dealId ?? "" }),
  );
  const quoteDraftPatchRef = useRef<
    ((patch: Partial<QuoteDraftFields>) => void) | null
  >(null);
  const quoteDraftSubmitRef = useRef<(() => Promise<true | string>) | null>(
    null,
  );
  const [convertProposalId, setConvertProposalId] = useState<string | null>(
    null,
  );
  const [feedFilter, setFeedFilter] = useState<FeedFilter>("all");
  const [feedSort, setFeedSort] = useState<FeedSort>("newest");
  const [feedTimeRange, setFeedTimeRange] = useState<FeedTimeRange>("all");
  const [activitySearch, setActivitySearch] = useState("");
  const [logMenuOpen, setLogMenuOpen] = useState(false);
  const logMenuRef = useRef<HTMLDivElement>(null);
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<MainTab>(
    requestedTab === "quotes" || requestedTab === "proposals" ? requestedTab : "activities",
  );
  const [quotesTabVisited, setQuotesTabVisited] = useState(false);

  useEffect(() => {
    if (activeTab === "quotes" || quoteCreateOpen) {
      setQuotesTabVisited(true);
    }
  }, [activeTab, quoteCreateOpen]);

  const reload = async () => {
    if (!dealId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDeal(dealId);
      setResult(data);
      if (!data.ok) setError(data.error);
    } catch {
      setError("Failed to load deal.");
    } finally {
      setLoading(false);
    }
  };

  const reloadHistory = async () => {
    if (!dealId) return;
    setHistoryLoading(true);
    const historyResult = await fetchDealHistory(dealId);
    setHistoryLoading(false);
    if (historyResult.ok) setHistory(historyResult.items);
  };

  useEffect(() => {
    void reload();
    void reloadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  useEffect(() => {
    if (!logMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!logMenuRef.current?.contains(event.target as Node)) {
        setLogMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLogMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [logMenuOpen]);

  useEffect(() => {
    setLogMenuOpen(false);
  }, [activeTab]);

  if (loading && !result) {
    return (
      <AgentModuleShell
        moduleId="sales"
        title="Deal"
        welcome="I'm your **Worktual co-worker**. I can update details, move the stage, or remove this deal once it loads on the right."
        surface="detail"
        entityId={dealId ?? null}
        workspace={<DealDetailPageSkeleton />}
      />
    );
  }

  if (!result || !result.ok) {
    return (
      <AgentModuleShell
        moduleId="sales"
        title="Deal"
        welcome="I'm your **Worktual co-worker**. I can update details, move the stage, or remove this deal. The workspace stays on the right."
        surface="detail"
        entityId={dealId ?? null}
        workspace={
          <div className="px-6 py-10">
            <p className="text-sm text-text-danger">{error ?? "Not found"}</p>
            <BackLink to="/sales" className="mt-3">
              Back to sales
            </BackLink>
          </div>
        }
      />
    );
  }

  const d = result.deal;
  const contact = result.contact;
  const company = result.company;

  const activityFeedItems: Extract<FeedItem, { kind: "activity" }>[] = [
    ...d.activities.map((activity: DealActivityRow) => ({
      kind: "activity" as const,
      id: `deal-activity-${activity.id}`,
      activityId: activity.id,
      source: "deal" as const,
      type: activity.type,
      title: activity.subject,
      detail: activity.body,
      dueAt: activity.dueAt,
      createdAt: activity.createdAt,
      sortAt: new Date(activity.createdAt).getTime(),
    })),
    ...result.contactActivities.map((activity) => ({
      kind: "activity" as const,
      id: `contact-activity-${activity.id}`,
      activityId: activity.id,
      source: "contact" as const,
      type: activity.type,
      title: activity.subject,
      detail: activity.body,
      dueAt: activity.dueAt,
      createdAt: activity.createdAt,
      sortAt: new Date(activity.createdAt).getTime(),
      transcriptText: activity.transcriptText ?? null,
      transcriptSource: activity.transcriptSource ?? null,
      disposition: activity.disposition ?? null,
    })),
  ];

  const historyFeedItems: FeedItem[] = history.map((entry) => ({
    kind: "history" as const,
    id: `history-${entry.id}`,
    title: entry.summary,
    detail: entry.actorLabel,
    createdAt: entry.createdAt,
    sortAt: new Date(entry.createdAt).getTime(),
  }));

  const tabActivityType: string | null =
    activeTab === "activities" ||
    activeTab === "proposals" ||
    activeTab === "quotes" ||
    activeTab === "history"
      ? null
      : activeTab;

  const unifiedFeed = (() => {
    const q = activitySearch.trim().toLowerCase();
    let items: FeedItem[] =
      activeTab === "activities"
        ? [...activityFeedItems, ...historyFeedItems]
        : tabActivityType
          ? activityFeedItems.filter((item) => item.type === tabActivityType)
          : [];

    if (activeTab === "activities") {
      if (feedFilter === "history") {
        items = items.filter((item) => item.kind === "history");
      } else if (feedFilter !== "all") {
        items = items.filter(
          (item) => item.kind === "activity" && item.type === feedFilter,
        );
      }
    }

    if (q) {
      items = items.filter((item) => {
        const hay = `${item.title} ${item.detail ?? ""}`.toLowerCase();
        return hay.includes(q);
      });
    }

    const bounds = feedTimeRangeBounds(feedTimeRange);
    if (bounds) {
      items = items.filter(
        (item) => item.sortAt >= bounds.start && item.sortAt < bounds.end,
      );
    }

    items.sort((a, b) =>
      feedSort === "newest" ? b.sortAt - a.sortAt : a.sortAt - b.sortAt,
    );
    return items;
  })();

  const channelContact = contact
    ? {
        contactId: contact.id,
        displayName: contact.displayName,
        email: contact.email,
        phone: contact.phone,
      }
    : d.contactId
      ? {
          contactId: d.contactId,
          displayName: d.contactName || "Contact",
          email: d.contactEmail || "",
          phone: null as string | null,
        }
      : null;

  const openLog = (type: string) => {
    setError(null);
    if (type === "sms") {
      const phone = channelContact?.phone?.replace(/[^\d+]/g, "") ?? "";
      if (!phone) {
        setError("Add a phone number on the contact to log SMS.");
        return;
      }
      setActivityLogType("sms");
      setActivityOpen(true);
      return;
    }
    if ((type === "email" || type === "meeting") && !channelContact) {
      setError("Link a contact to this deal to use email and schedule.");
      return;
    }
    setActivityLogType(type);
    setActivityOpen(true);
  };

  const applyStage = async (stage: string, reason?: string) => {
    if (!dealId) return;
    setError(null);
    setPending(true);
    const stageResult = await updateDealStage(dealId, stage, reason);
    setPending(false);
    if (!stageResult.ok) {
      setError(stageResult.error);
      return;
    }
    setLostReasonOpen(false);
    setWonConfirmOpen(false);
    setLostReason("");
    setPendingStage(null);
    if (stageResult.wonExtras) setWonSummary(stageResult.wonExtras);
    await reload();
  };

  const onStageChange = (stage: string) => {
    if (stage === d.stage) return;
    if (stage === "closed_lost") {
      setPendingStage(stage);
      setLostReasonOpen(true);
      return;
    }
    if (stage === "closed_won") {
      setPendingStage(stage);
      setWonConfirmOpen(true);
      return;
    }
    void applyStage(stage);
  };

  const onDelete = async () => {
    if (!dealId) return { ok: false as const, error: "Missing deal id." };
    const deleteResult = await deleteDeal(dealId);
    if (!deleteResult.ok) {
      return { ok: false as const, error: deleteResult.error };
    }
    return { ok: true as const };
  };

  const closeActivityLog = () => setActivityOpen(false);

  const logDisplayName = channelContact?.displayName ?? d.title ?? "Deal";
  const logContactId = channelContact?.contactId ?? d.contactId ?? "";

  const openQuoteCreate = () => {
    setActiveTab("quotes");
    setQuoteCreateOpen(true);
    setQuoteDraft(emptyQuoteDraft({ dealId: d.id }));
  };

  const onQuoteDraftPatch = (patch: Partial<QuoteDraftFields>) => {
    setQuoteDraft((prev) => ({
      ...prev,
      ...patch,
      dealId: d.id,
      addonQuantities: {
        ...(prev.addonQuantities ?? {}),
        ...(patch.addonQuantities ?? {}),
      },
    }));
    if (quoteDraftPatchRef.current) {
      quoteDraftPatchRef.current(patch);
    } else if (
      typeof patch.dealId === "string" ||
      typeof patch.productId === "string" ||
      typeof patch.quantity === "string"
    ) {
      openQuoteCreate();
    }
  };

  const chips: CoworkerSuggestion[] = [
    {
      id: "chip-create-proposal",
      label: "Create proposal",
      prompt: `Create a proposal for "${d.title}"`,
    },
    {
      id: "chip-next-stage",
      label: "Suggest next stage",
      prompt: `What stage should "${d.title}" move to next, and why?`,
    },
    {
      id: "chip-quote",
      label: "Draft a quote",
      prompt: `Help me draft a quote for "${d.title}"`,
    },
    {
      id: "chip-log-activity",
      label: "Log an activity",
      prompt: "Help me log an activity on this deal",
    },
  ];

  const workspace = (
    <div className="min-h-full bg-subtle">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-0 lg:flex-row">
        {/* Left rail — about deal / contact / company */}
        <aside className="w-full shrink-0 border-b border-border-default bg-subtle lg:w-[340px] lg:border-r lg:border-b-0">
          <div className="sticky top-0 max-h-dvh space-y-4 overflow-y-auto p-4 sm:p-5">
            <BackLink to="/sales">Back to sales</BackLink>

            <div className="rounded-xl border border-border-default bg-surface p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-text-primary">
                  {d.companyName}
                  {d.locationName ? ` ${d.locationName}` : ""}
                </h2>
                <span
                  className={`rounded-md px-2 py-0.5 text-xs font-medium ${stageBadgeClass(d.stage)}`}
                >
                  {DEAL_STAGE_LABELS[d.stage] ?? d.stage}
                </span>
              </div>

              <dl className="mt-5 space-y-3">
                <Field label="Deal name" value={d.title} />
                <Field
                  label="Deal amount"
                  value={formatMoneyFull(d.amount, d.amountCurrency)}
                />
                <Field
                  label="Expected close"
                  value={
                    d.expectedCloseDate
                      ? new Date(d.expectedCloseDate).toLocaleDateString()
                      : "—"
                  }
                />
                <Field label="Deal owner" value={ownerShort(d.ownerName)} />
                <div>
                  <dt className="text-xs font-medium tracking-wide text-text-caption uppercase">
                    Stage
                  </dt>
                  <dd className="mt-1">
                    <Select
                      options={[...DEAL_STAGE_OPTIONS]}
                      value={d.stage}
                      disabled={pending}
                      onChange={(e) => onStageChange(e.target.value)}
                      aria-label="Deal stage"
                    />
                  </dd>
                </div>
              </dl>

              {channelContact ? (
                <div className="mt-5 w-full">
                  <ContactQuickActions
                    contactId={channelContact.contactId}
                    displayName={channelContact.displayName}
                    email={channelContact.email}
                    phone={channelContact.phone}
                    dealId={d.id}
                    stretched
                    onChanged={() => void reload()}
                  />
                </div>
              ) : null}
            </div>

            {contact ? (
              <ContactDetailsCard
                stacked
                contactId={contact.id}
                displayName={contact.displayName}
                email={contact.email}
                phone={contact.phone}
                secondaryEmails={contact.secondaryEmails}
                secondaryPhones={contact.secondaryPhones}
                title={contact.title}
                addressLine={contact.addressLine}
                city={contact.city}
                country={contact.country}
                ownerLabel={contact.ownerName}
              />
            ) : d.contactId ? (
              <ContactDetailsCard
                stacked
                contactId={d.contactId}
                displayName={d.contactName || "Contact"}
                email={d.contactEmail || ""}
                phone={null}
                secondaryEmails={[]}
                secondaryPhones={[]}
                title={null}
                addressLine={null}
                city={null}
                country={null}
                ownerLabel={null}
              />
            ) : (
              <section className="rounded-xl border border-border-default bg-surface p-4">
                <h2 className="text-base font-semibold text-text-primary">
                  Contact details
                </h2>
                <p className="mt-3 text-sm text-text-caption">
                  No contact linked to this deal.
                </p>
              </section>
            )}

            <section className="rounded-xl border border-border-default bg-surface p-4">
              <h2 className="text-base font-semibold text-text-primary">
                Company details
              </h2>
              <dl className="mt-5 grid grid-cols-1 gap-4">
                <Field
                  label="Name"
                  value={
                    <Link
                      to={`/company/${company.id}`}
                      className="font-medium text-text-link hover:underline"
                    >
                      {company.name}
                    </Link>
                  }
                />
                <Field label="Domain" value={company.domain} />
                <Field label="Industry" value={company.industry} />
                <Field
                  label="Employees"
                  value={
                    company.employeeCount != null
                      ? company.employeeCount.toLocaleString()
                      : null
                  }
                />
                <Field label="Owner" value={ownerShort(company.ownerName)} />
                <Field
                  label="Location"
                  value={
                    displayCompanyLocationLabel({ name: d.locationName }) ? (
                      <Link
                        to={`/company/${d.companyId}/locations/${d.locationId}`}
                        className="font-medium text-text-link hover:underline"
                      >
                        {displayCompanyLocationLabel({ name: d.locationName })}
                      </Link>
                    ) : null
                  }
                />
              </dl>
            </section>

            {d.companyId ? (
              <DealBuyingGroupPanel dealId={d.id} companyId={d.companyId} />
            ) : null}
          </div>
        </aside>

        {/* Main column */}
        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className={PAGE_H1_CLASS}>
                {d.title}
              </h1>
              <p className="mt-1.5 text-sm text-text-caption">
                <Link
                  to={`/company/${d.companyId}`}
                  className="hover:text-brand"
                >
                  {d.companyName}
                </Link>
                {" · "}
                <Link
                  to={`/company/${d.companyId}/locations/${d.locationId}`}
                  className="hover:text-brand"
                >
                  {d.locationName}
                </Link>
                {" · "}
                Owner: {ownerShort(d.ownerName)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {d.contactId ? (
                <Link to={`/contact/${d.contactId}`}>
                  <Button variant="secondary">View contact</Button>
                </Link>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                onClick={() => setEditOpen(true)}
              >
                Edit
              </Button>
              <ConfirmDeleteButton
                name={d.title}
                entityLabel="deal"
                consequence="This permanently removes the deal and its activities."
                onConfirm={onDelete}
                onSuccess={() => navigate("/sales")}
              />
            </div>
          </div>

          {error ? (
            <p className="mt-4 text-sm text-text-danger">{error}</p>
          ) : null}

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-border-default bg-surface px-4 py-3">
              <p className="text-xs font-medium text-text-caption">
                Deal amount
              </p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-text-primary">
                {formatMoneyFull(d.amount, d.amountCurrency)}
              </p>
            </div>
            <div className="rounded-xl border border-border-default bg-surface px-4 py-3">
              <p className="text-xs font-medium text-text-caption">Stage</p>
              <p className="mt-1 text-lg font-semibold text-text-primary">
                {DEAL_STAGE_LABELS[d.stage] ?? d.stage}
              </p>
            </div>
            <div className="rounded-xl border border-border-default bg-surface px-4 py-3">
              <p className="text-xs font-medium text-text-caption">
                Proposals
              </p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-text-primary">
                {result.proposalCount}
              </p>
            </div>
            <div className="rounded-xl border border-border-default bg-surface px-4 py-3">
              <p className="text-xs font-medium text-text-caption">Quotes</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-text-primary">
                {result.quoteCount}
              </p>
            </div>
          </div>

          {(d.stage === "closed_won" || wonSummary) && (
            <section className={`mt-5 ${SUCCESS_FLASH_CLASS} p-5`}>
              <h2 className={SECTION_H2_CLASS}>
                Closed Won checklist
              </h2>
              <ul className="mt-3 space-y-2 text-sm text-text-secondary">
                <li>
                  {d.contactId || wonSummary?.contactId ? (
                    <>
                      Contact marked customer
                      {d.contactId ? (
                        <>
                          {" · "}
                          <Link
                            to={`/contact/${d.contactId}`}
                            className="text-text-link hover:underline"
                          >
                            View contact
                          </Link>
                        </>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-amber-800">
                      No contact on this deal — customer promotion skipped.
                      Link a contact before closing for full handoff.
                    </span>
                  )}
                </li>
                <li>
                  {d.contracts.length > 0 || wonSummary?.contractId ? (
                    <>
                      Contract{" "}
                      {wonSummary?.contractCreated ? "created" : "on file"}
                      {d.contracts[0] ? (
                        <span className="text-text-caption">
                          {" "}
                          · {d.contracts[0].title}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-text-caption">No contract yet</span>
                  )}
                </li>
                <li>
                  {wonSummary?.serviceHandoff?.ok ? (
                    <>
                      Service handoff sent
                      {wonSummary.serviceHandoff.externalId ? (
                        <span className="text-text-caption">
                          {" "}
                          · {wonSummary.serviceHandoff.externalId}
                        </span>
                      ) : null}
                    </>
                  ) : wonSummary?.serviceHandoff?.skipped ? (
                    <span className="text-text-caption">
                      Service handoff skipped
                    </span>
                  ) : wonSummary?.serviceHandoff?.error ? (
                    <span className="text-amber-800">
                      Service handoff failed: {wonSummary.serviceHandoff.error}
                    </span>
                  ) : (
                    <span className="text-text-caption">
                      Service handoff pending
                    </span>
                  )}
                </li>
              </ul>
            </section>
          )}

          {d.contracts.length > 0 ? (
            <section className="mt-5 rounded-xl border border-border-default bg-surface p-5">
              <h2 className="text-sm font-semibold text-text-primary">
                Contracts
              </h2>
              <ul className="mt-3 divide-y divide-border-default">
                {d.contracts.map((c) => (
                  <li key={c.id} className="py-3 text-sm">
                    <p className="font-medium text-text-primary">{c.title}</p>
                    <p className="mt-1 text-text-caption">
                      {new Date(c.startsAt).toLocaleDateString()}
                      {c.endsAt
                        ? ` → ${new Date(c.endsAt).toLocaleDateString()}`
                        : ""}
                      {c.arr
                        ? ` · ARR ${formatMoneyFull(String(c.arr), d.amountCurrency)}`
                        : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* Tabs */}
          <div className="mt-6 border-b border-border-default">
            <div className="flex flex-wrap gap-1">
              {(
                [
                  ["activities", "All activities"],
                  ...ACTIVITY_TAB_TYPES.map((t) => [t.id, t.label] as const),
                  ["proposals", "Proposals"],
                  ["quotes", "Quotes"],
                  ["history", "Deal history"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setActiveTab(id as MainTab);
                    setActivitySearch("");
                    if (id === "activities") setFeedFilter("all");
                  }}
                  className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                    activeTab === id
                      ? "border-brand text-brand"
                      : "border-transparent text-text-caption hover:text-text-primary"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5">
            {activeTab === "activities" || tabActivityType ? (
              <section>
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {activeTab === "activities" ? (
                      <div className="w-[11.5rem]">
                        <Select
                          value={feedFilter}
                          onChange={(e) => setFeedFilter(e.target.value)}
                          options={[
                            { value: "all", label: "All types" },
                            ...ACTIVITY_TAB_TYPES.map((t) => ({
                              value: t.id,
                              label: t.label,
                            })),
                            { value: "history", label: "History" },
                          ]}
                          aria-label="Filter by type"
                          className="h-10"
                        />
                      </div>
                    ) : null}
                    <div className="w-[11.5rem]">
                      <Select
                        value={feedTimeRange}
                        onChange={(e) =>
                          setFeedTimeRange(e.target.value as FeedTimeRange)
                        }
                        options={FEED_TIME_RANGE_OPTIONS}
                        aria-label="Filter by time"
                        className="h-10"
                      />
                    </div>
                    <div className="min-w-[12rem] flex-1">
                      <Input
                        value={activitySearch}
                        onChange={(e) => setActivitySearch(e.target.value)}
                        placeholder={
                          activeTab === "activities"
                            ? "Search activities & history"
                            : `Search ${(ACTIVITY_TYPE_LABELS[tabActivityType!] ?? tabActivityType!).toLowerCase()}s`
                        }
                        aria-label="Search feed"
                        className="h-10"
                      />
                    </div>
                    <div className="w-[10.5rem]">
                      <Select
                        value={feedSort}
                        onChange={(e) =>
                          setFeedSort(e.target.value as FeedSort)
                        }
                        options={[
                          { value: "newest", label: "Newest first" },
                          { value: "oldest", label: "Oldest first" },
                        ]}
                        aria-label="Sort activities"
                        className="h-10"
                      />
                    </div>
                    {activeTab === "activities" ? (
                      <div className="relative" ref={logMenuRef}>
                        <Button
                          type="button"
                          variant="primary"
                          aria-expanded={logMenuOpen}
                          aria-haspopup="menu"
                          onClick={() => setLogMenuOpen((open) => !open)}
                        >
                          <Plus className="size-4" strokeWidth={2} />
                          Log activity
                          <ChevronUp
                            className={`size-4 transition-transform ${
                              logMenuOpen ? "" : "rotate-180"
                            }`}
                            strokeWidth={2}
                          />
                        </Button>
                        {logMenuOpen ? (
                          <div
                            role="menu"
                            aria-label="Choose activity type"
                            className="absolute right-0 bottom-full z-20 mb-2 min-w-[12rem] overflow-hidden rounded-xl border border-border-default bg-surface py-1 shadow-lg"
                          >
                            {LOG_ACTIVITY_MENU.map((opt) => (
                              <button
                                key={opt.id}
                                type="button"
                                role="menuitem"
                                className="flex w-full items-center px-3.5 py-2 text-left text-sm text-text-primary hover:bg-subtle"
                                onClick={() => {
                                  setLogMenuOpen(false);
                                  openLog(opt.id);
                                }}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="primary"
                        onClick={() => openLog(tabActivityType!)}
                      >
                        <Plus className="size-4" strokeWidth={2} />
                        {tabActivityType === "meeting"
                          ? "Schedule event"
                          : `Log ${(ACTIVITY_TYPE_LABELS[tabActivityType!] ?? tabActivityType!).toLowerCase()}`}
                      </Button>
                    )}
                  </div>
                </div>

                <ul className="mt-4 divide-y divide-border-default overflow-hidden rounded-xl border border-border-default bg-surface">
                  {unifiedFeed.length === 0 ? (
                    <li className="px-5 py-8 text-center text-sm text-text-caption">
                      {activeTab === "activities"
                        ? "No activities or history yet."
                        : `No ${(ACTIVITY_TYPE_LABELS[tabActivityType!] ?? tabActivityType!).toLowerCase()}s yet.`}
                    </li>
                  ) : (
                    unifiedFeed.map((item) =>
                      item.kind === "history" ? (
                        <li
                          key={item.id}
                          className="flex flex-wrap items-start justify-between gap-3 px-5 py-4"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-md bg-subtle px-2 py-0.5 text-xs font-medium text-text-secondary">
                                History
                              </span>
                              <span className="text-xs text-text-caption">
                                {new Date(item.createdAt).toLocaleString()}
                              </span>
                            </div>
                            <p className="mt-1 text-sm font-medium text-text-primary">
                              {item.title}
                            </p>
                            <p className="mt-1 text-xs text-text-caption">
                              {item.detail}
                            </p>
                          </div>
                        </li>
                      ) : (
                        <li
                          key={item.id}
                          className="flex items-start justify-between gap-4 px-5 py-4"
                        >
                          <div className="flex min-w-0 items-start gap-3">
                            <ActivityTypeIcon
                              type={item.type}
                              className="mt-0.5"
                            />
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <ActivityTypeBadge type={item.type} />
                                <span className="text-xs text-text-caption">
                                  {new Date(item.createdAt).toLocaleString()}
                                </span>
                              </div>
                              {item.type === "note" ? (
                                <NoteActivityDetails
                                  body={item.detail || item.title}
                                />
                              ) : item.type === "email" ? (
                                <>
                                  <p className="mt-1 text-sm font-medium text-text-primary">
                                    {normalizeEmailDisplayText(item.title)}
                                  </p>
                                  {item.detail ? (
                                    <div className="mt-1.5 min-w-0 w-full">
                                      <EmailBodyContent
                                        text={item.detail}
                                        subject={normalizeEmailDisplayText(
                                          item.title,
                                        )}
                                      />
                                    </div>
                                  ) : null}
                                </>
                              ) : item.type === "meeting" ? (
                                <MeetingActivityDetails
                                  activityId={
                                    item.source === "contact"
                                      ? item.activityId
                                      : undefined
                                  }
                                  contactId={
                                    item.source === "contact"
                                      ? d.contactId
                                      : null
                                  }
                                  subject={item.title}
                                  body={item.detail}
                                  dueAt={item.dueAt}
                                  disposition={item.disposition}
                                />
                              ) : item.type === "call" &&
                                item.source === "contact" ? (
                                <CallActivityDetails
                                  activityId={item.activityId}
                                  subject={item.title}
                                  body={item.detail}
                                  transcriptText={item.transcriptText}
                                  transcriptSource={item.transcriptSource}
                                  disposition={item.disposition}
                                  contactDisplayName={
                                    d.contactName ||
                                    channelContact?.displayName ||
                                    "Contact"
                                  }
                                />
                              ) : (
                                <>
                                  <p className="mt-1 text-sm font-medium text-text-primary">
                                    {item.title}
                                  </p>
                                  {item.type === "email" || item.type === "sms" ? (
                                    <div className="mt-1.5">
                                      <DispositionTag label={item.disposition} />
                                    </div>
                                  ) : null}
                                  {item.detail ? (
                                    <RichStructuredContent
                                      className="mt-1.5"
                                      text={item.detail}
                                      variant="compact"
                                    />
                                  ) : null}
                                  {item.dueAt ? (
                                    <p className="mt-1 text-xs text-text-caption">
                                      Due{" "}
                                      {new Date(item.dueAt).toLocaleString()}
                                    </p>
                                  ) : null}
                                </>
                              )}
                            </div>
                          </div>
                          <ConfirmDeleteButton
                            name={item.title}
                            entityLabel="activity"
                            compact
                            consequence={
                              item.source === "contact"
                                ? "This permanently removes the activity from this contact."
                                : "This permanently removes the activity from this deal."
                            }
                            disabled={pending}
                            onConfirm={async () => {
                              if (item.source === "contact") {
                                if (!d.contactId) {
                                  return {
                                    ok: false,
                                    error: "Contact not linked to this deal.",
                                  };
                                }
                                const activityResult =
                                  await deleteContactActivity(
                                    d.contactId,
                                    item.activityId,
                                  );
                                if (!activityResult.ok) {
                                  return {
                                    ok: false,
                                    error:
                                      activityResult.error ??
                                      "Failed to delete activity.",
                                  };
                                }
                                return { ok: true };
                              }
                              const activityResult = await deleteDealActivity(
                                d.id,
                                item.activityId,
                              );
                              if (!activityResult.ok) {
                                return {
                                  ok: false,
                                  error:
                                    activityResult.error ??
                                    "Failed to delete activity.",
                                };
                              }
                              return { ok: true };
                            }}
                            onSuccess={() => void reload()}
                          />
                        </li>
                      ),
                    )
                  )}
                </ul>
              </section>
            ) : null}

            {activeTab === "proposals" ? (
              <DealProposalsPanel
                dealId={d.id}
                onConvertToQuote={(proposalId) => {
                  void (async () => {
                    const result = await createQuote({
                      dealId: d.id,
                      proposalId,
                      fromTemplate: true,
                      lines: [],
                    });
                    if (!result.ok) {
                      setError(result.error);
                      setActiveTab("quotes");
                      return;
                    }
                    navigate(`/sales/quotes/${result.id}`);
                  })();
                }}
              />
            ) : null}

            {quotesTabVisited ? (
              <div className={activeTab === "quotes" ? undefined : "hidden"}>
                <DealQuotesPanel
                  dealId={d.id}
                  initialProposalId={convertProposalId}
                  createOpen={quoteCreateOpen}
                  onCreateOpenChange={(open) => {
                    setQuoteCreateOpen(open);
                    if (open) {
                      setQuoteDraft(emptyQuoteDraft({ dealId: d.id }));
                    }
                    if (!open) setConvertProposalId(null);
                  }}
                  patchRef={quoteDraftPatchRef}
                  submitRef={quoteDraftSubmitRef}
                  onDraftChange={setQuoteDraft}
                />
              </div>
            ) : null}

            {activeTab === "overview" ? (
              <section className="mt-8 space-y-3">
                <h2 className={SECTION_H2_CLASS}>Contracts</h2>
                <DealContractsPanel dealId={d.id} />
              </section>
            ) : null}

            {activeTab === "history" ? (
              historyLoading && history.length === 0 ? (
                <p className="text-sm text-text-caption">
                  Loading history…
                </p>
              ) : (
                <DealHistoryPanel entries={history} embedded />
              )
            ) : null}
          </div>
        </main>
      </div>

      {editOpen ? (
        <DealRecordEditDialog
          deal={{
            id: d.id,
            title: d.title,
            stage: d.stage,
            amount: d.amount,
            contactId: d.contactId,
            contactName: d.contactName,
            contactEmail: d.contactEmail,
            notes: d.notes,
            expectedCloseDate: d.expectedCloseDate,
            companyId: d.companyId,
            companyName: d.companyName,
            locationId: d.locationId,
            locationName: d.locationName,
            locationType: d.locationType,
          }}
          company={{
            id: company.id,
            name: company.name,
            domain: company.domain,
            industry: company.industry,
            employeeCount: company.employeeCount,
          }}
          onClose={() => setEditOpen(false)}
          onSaved={() => void reload()}
          onWonExtras={(extras) => setWonSummary(extras)}
        />
      ) : null}

      {activityOpen && activityLogType === "sms" && channelContact ? (
        <SmsSendDialog
          displayName={channelContact.displayName}
          phone={channelContact.phone}
          onClose={closeActivityLog}
          onConfirmSent={async (body) => {
            const result = await createDealActivity(d.id, {
              type: "sms",
              subject: `SMS to ${channelContact.displayName}`,
              body,
            });
            if (result.ok) void reload();
            return result.ok
              ? { ok: true }
              : { ok: false, error: result.error };
          }}
        />
      ) : null}

      {activityOpen && activityLogType === "note" ? (
        <AddNoteDialog
          contactId={logContactId}
          dealId={d.id}
          displayName={logDisplayName}
          onClose={closeActivityLog}
          onChanged={() => void reload()}
        />
      ) : null}

      {activityOpen && activityLogType === "task" ? (
        <AddTaskDialog
          contactId={logContactId}
          dealId={d.id}
          displayName={logDisplayName}
          onClose={closeActivityLog}
          onChanged={() => void reload()}
        />
      ) : null}

      {activityOpen && activityLogType === "meeting" && channelContact ? (
        <ScheduleMeetingDialog
          contactId={channelContact.contactId}
          displayName={channelContact.displayName}
          email={channelContact.email}
          onClose={closeActivityLog}
          onChanged={() => void reload()}
        />
      ) : null}

      {activityOpen && activityLogType === "call" ? (
        <CallLogDialog
          initialContact={
            channelContact
              ? {
                  id: channelContact.contactId,
                  displayName: channelContact.displayName,
                  email: channelContact.email,
                  phone: channelContact.phone,
                }
              : null
          }
          initialPhone={channelContact?.phone ?? ""}
          dealId={d.id}
          onClose={closeActivityLog}
          onLogged={() => void reload()}
        />
      ) : null}

      {activityOpen && activityLogType === "email" && channelContact ? (
        <EmailComposeDialog
          initialContact={{
            id: channelContact.contactId,
            displayName: channelContact.displayName,
            email: channelContact.email,
            phone: channelContact.phone,
          }}
          initialTo={channelContact.email}
          onClose={closeActivityLog}
          onSent={() => void reload()}
        />
      ) : null}

      {lostReasonOpen && pendingStage === "closed_lost" ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
          <div className="w-full max-w-md rounded-2xl border border-border-default bg-surface p-5 shadow-lg">
            <h3 className="text-base font-semibold text-text-primary">
              Mark as lost
            </h3>
            <p className="mt-1 text-sm text-text-caption">
              Add a short reason for the loss.
            </p>
            <Textarea
              className="mt-4"
              label="Lost reason"
              value={lostReason}
              onChange={(e) => setLostReason(e.target.value)}
              rows={3}
            />
            <div className="mt-4 flex gap-2">
              <Button
                variant="primary"
                disabled={pending || !lostReason.trim()}
                onClick={() =>
                  void applyStage("closed_lost", lostReason.trim())
                }
              >
                Confirm lost
              </Button>
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => {
                  setLostReasonOpen(false);
                  setPendingStage(null);
                  setLostReason("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {wonConfirmOpen && pendingStage === "closed_won" ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
          <div className="w-full max-w-md rounded-2xl border border-border-default bg-surface p-5 shadow-lg">
            <h3 className="text-base font-semibold text-text-primary">
              Mark as won
            </h3>
            <p className="mt-1 text-sm text-text-caption">
              This will promote the contact to customer and start contract /
              service handoff.
            </p>
            <div className="mt-4 flex gap-2">
              <Button
                variant="primary"
                disabled={pending}
                onClick={() => void applyStage("closed_won")}
              >
                Confirm won
              </Button>
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => {
                  setWonConfirmOpen(false);
                  setPendingStage(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );

  return (
    <AgentModuleShell
      moduleId="sales"
      title={d.title || "Deal"}
      welcome={`I'm your **Worktual co-worker** for **${d.title}**. I can update the deal, create a **proposal** from a BRD, or generate a **quote** from a proposal or a BRD. The record stays on the right.`}
      chips={chips}
      surface="detail"
      workspaceMode="detail"
      entityId={d.id}
      workspace={workspace}
      draft={quoteCreateOpen ? quoteDraft : null}
      onDraftPatch={(patch) =>
        onQuoteDraftPatch(patch as Partial<QuoteDraftFields>)
      }
      onWorkspaceCommand={(tool) => {
        if (tool.name !== "set_workspace") return false;
        const mode = String(tool.args.mode || "");
        if (mode === "list") {
          navigate("/sales");
          return true;
        }
        if (mode === "create") {
          navigate("/sales?view=create");
          return true;
        }
        if (mode === "create_quote") {
          openQuoteCreate();
          return true;
        }
        if (mode === "detail") {
          const entityId =
            typeof tool.args.entityId === "string" ? tool.args.entityId : undefined;
          if (entityId && entityId !== d.id) {
            navigate(`/sales/${entityId}`);
            return true;
          }
          return true;
        }
        return false;
      }}
      onToolConfirm={async (tool: AgentToolProposal) => {
        if (tool.name === "propose_reassign_deal_owner") {
          const id = String(tool.args.dealId || d.id || "");
          const ownerUserId = String(tool.args.ownerUserId || "");
          if (!id || !ownerUserId) return false;
          const result = await reassignDeal({ dealId: id, ownerUserId });
          if (!result.ok) return result.error || false;
          void reload();
          return true;
        }
        if (tool.name === "propose_update_deal") {
          const id = String(tool.args.dealId || d.id || "");
          if (!id) return false;
          const detail = await fetchDeal(id);
          if (!detail.ok) return false;
          const deal = detail.deal;
          const body: Record<string, unknown> = {
            title: deal.title,
            stage: deal.stage,
            amount: deal.amount,
            companyId: deal.companyId,
            locationId: deal.locationId,
            contactId: deal.contactId,
            notes: deal.notes,
            expectedCloseDate: deal.expectedCloseDate
              ? deal.expectedCloseDate.slice(0, 10)
              : null,
          };
          let changed = false;
          for (const key of [
            "title",
            "amount",
            "notes",
            "expectedCloseDate",
          ] as const) {
            const val = tool.args[key];
            if (typeof val === "string" && val.trim()) {
              body[key] = val.trim();
              changed = true;
            }
          }
          const stageVal =
            typeof tool.args.stage === "string" ? tool.args.stage.trim() : "";
          if (stageVal && stageVal !== deal.stage) {
            const stageResult = await updateDealStage(id, stageVal);
            if (!stageResult.ok) return stageResult.error || false;
            changed = true;
          }
          if (!changed) return false;
          const result = await updateDeal(id, body);
          if (!result.ok) return result.error || false;
          void reload();
          return true;
        }
        if (tool.name === "propose_delete_deal") {
          const id = String(tool.args.dealId || d.id || "");
          if (!id) return false;
          const result = await deleteDeal(id);
          if (!result.ok) return result.error || false;
          navigate("/sales");
          return true;
        }
        if (tool.name === "propose_create_quote") {
          const proposalId = String(tool.args.proposalId || "").trim();
          if (proposalId) {
            const result = await createQuote({
              dealId: d.id,
              proposalId,
              fromTemplate: true,
              lines: [],
            });
            if (!result.ok) return result.error || false;
            navigate(`/sales/quotes/${result.id}`);
            return true;
          }
          setActiveTab("quotes");
          setQuoteCreateOpen(true);
          return false;
        }
        // propose_create_proposal is handled by AgentModuleShell (supports
        // attached requirement PDF from chat).
        return false;
      }}
      onAfterTool={() => void reload()}
    />
  );
}
