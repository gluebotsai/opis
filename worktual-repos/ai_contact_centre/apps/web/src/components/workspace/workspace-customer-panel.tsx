import { useCallback, useEffect, useMemo, useState, type ReactNode, type UIEvent } from "react";
import {
  ChevronDown,
  ChevronLeft,
  History,
  Layers,
  ShoppingBag,
  StickyNote,
  Ticket,
} from "lucide-react";

import { EmbeddedCopilotPanel } from "@/components/assistant/embedded-copilot-panel";
import { MonitoringConversationDetailSections } from "@/components/monitoring/monitoring-conversation-lifecycle";
import { MonitoringDrawer } from "@/components/monitoring/monitoring-shared";
import { WorkspaceContactMetaRow } from "@/components/workspace/workspace-contact-meta-row";
import { WorkspaceNotesTab, CustomerNotesBlock } from "@/components/workspace/workspace-notes-tab";
import { KpiCard } from "@/components/ui/kpi-card";
import { PanelLoader } from "@/components/ui/panel-loader";
import { IconButton, segmentTabClassName } from "@/components/ui/button";
import { listRowButtonClassName, listRowDividerClassName, listRowTimestampClassName } from "@/components/ui/list-row";
import { ProfileDetailList, ProfileDetailRow } from "@/components/ui/profile-detail-row";
import { OmniChannelSummaryContent } from "@/components/workspace/workspace-omni-channel-summary";
import { WorkspaceCustomerOrderDialog } from "@/components/workspace/workspace-customer-order-dialog";
import { OrdersList, TicketsList } from "@/components/workspace/workspace-customer-records";
import { WorkspaceCustomerTicketDialog } from "@/components/workspace/workspace-customer-ticket-dialog";
import { profileAvatarClassName, profileInitials, resolveProfileDisplayName } from "@/lib/avatar-utils";
import { useCustomerInteractions } from "@/features/workspace/use-customer-interactions";
import { useCustomerOrders } from "@/features/workspace/use-customer-orders";
import { useCustomerTickets } from "@/features/workspace/use-customer-tickets";
import { useOmniChannelSummary } from "@/features/workspace/use-omni-channel-summary";
import { useWorkspaceNotes } from "@/features/workspace/use-workspace-notes";
import { plainTextMessageBody } from "@/features/workspace/api";
import type {
  CustomerInteractionHistory,
  CustomerOrder,
  CustomerTicket,
  WorkspaceConversation,
  WorkspaceTransferMetadata,
} from "@/features/workspace/types";
import {
  formatConversationTime,
  mapWorkspaceChannel,
  resolveWorkspaceConversationDirection,
  workspaceChannelMeta,
} from "@/features/workspace/workspace-utils";
import { WorkspaceEmptyState } from "@/components/workspace/workspace-empty-state";
import { WorkspaceCustomerPanelSkeleton } from "@/components/workspace/workspace-side-skeletons";
import { contentPanelHeaderBorderClassName } from "@/lib/panel-chrome";
import { cn } from "@/lib/utils";

type SelectedPreviousInteraction = {
  conversationId: string;
  channelLabel: string;
  queue: string;
  subject: string;
  isPast: boolean;
};

function isPastInteractionStatus(status: string | undefined): boolean {
  const normalized = (status ?? "").toLowerCase();
  return (
    normalized === "resolved" ||
    normalized === "closed" ||
    normalized === "ended" ||
    normalized === "completed"
  );
}

function activityQueueLabel(queue: string, agentConnected: boolean | undefined): string {
  const name = queue.trim() || "Unassigned";
  return `${name} (${agentConnected ? "Agent handled" : "Bot handled"})`;
}

function transferTargetName(transfer: WorkspaceTransferMetadata): string {
  return (
    transfer.acceptedAgentName?.trim() ||
    transfer.offeredAgentName?.trim() ||
    transfer.targetAgentName?.trim() ||
    "—"
  );
}

function transferQueueName(transfer: WorkspaceTransferMetadata): string {
  return (
    transfer.sourceQueueName?.trim() ||
    transfer.targetQueueName?.trim() ||
    transfer.toQueueName?.trim() ||
    "—"
  );
}

type WorkspaceSideTab = "info" | "coworker" | "notes";

const TABS: { id: WorkspaceSideTab; label: string; compactLabel: string }[] = [
  { id: "info", label: "Customer info", compactLabel: "Info" },
  { id: "coworker", label: "Co-worker", compactLabel: "Co-worker" },
  { id: "notes", label: "My notes", compactLabel: "Notes" },
];

type WorkspaceCustomerPanelProps = {
  conversation: WorkspaceConversation | null;
  /** Inbox/bootstrap loading — show panel skeleton while nothing is selected. */
  loading?: boolean;
  /** Side data waits until the open conversation's latest messages are on screen. */
  detailsReady?: boolean;
  activeConversationId: string;
  activeHistoryMessageId?: string | null;
  onSelectHistory: (conversationId: string, messageId: string) => void;
  onOpenQueue?: (queueId: string) => void;
  onBack?: () => void;
};

export function WorkspaceCustomerPanel({
  conversation,
  loading = false,
  detailsReady = false,
  activeConversationId,
  activeHistoryMessageId,
  onOpenQueue,
  onBack,
}: WorkspaceCustomerPanelProps) {
  const [tab, setTab] = useState<WorkspaceSideTab>("info");

  useEffect(() => {
    setTab("info");
  }, [conversation?.id]);

  if (!conversation) {
    if (loading) {
      return <WorkspaceCustomerPanelSkeleton />;
    }
    return (
      <div className="flex h-full min-h-0 flex-col bg-white">
        {onBack ? (
          <div className={cn("shrink-0 px-2 py-1.5", contentPanelHeaderBorderClassName)}>
            <IconButton variant="ghostIcon" onClick={onBack} aria-label="Back to conversation">
              <ChevronLeft />
            </IconButton>
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
          <WorkspaceEmptyState
            variant="customer"
            title="No conversation selected"
            description="Choose a conversation to view customer info and notes."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-white">
      <div className={cn("min-w-0 shrink-0 px-3 py-2.5", contentPanelHeaderBorderClassName)}>
        <div className="flex w-full min-w-0 items-center gap-1">
          {onBack ? (
            <IconButton
              variant="ghostIcon"
              className="shrink-0"
              onClick={onBack}
              aria-label="Back to conversation"
            >
              <ChevronLeft />
            </IconButton>
          ) : null}
          <div className="flex min-w-0 flex-1 gap-0.5">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={segmentTabClassName({
                active: tab === item.id,
                className: "min-w-0 flex-1 gap-1 px-1.5",
              })}
            >
              <span className="min-w-0 truncate xl:hidden">{item.compactLabel}</span>
              <span className="hidden min-w-0 truncate xl:inline">{item.label}</span>
            </button>
          ))}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "info" ? (
          <CustomerInfoTab
            conversation={conversation}
            detailsReady={detailsReady}
            activeConversationId={activeConversationId}
            activeHistoryMessageId={activeHistoryMessageId}
          />
        ) : null}
        {tab === "coworker" ? (
          <div className="flex h-full min-h-0 flex-col overflow-hidden">
            <EmbeddedCopilotPanel onOpenQueue={onOpenQueue} embedded />
          </div>
        ) : null}
        {tab === "notes" ? <WorkspaceNotesTab conversation={conversation} /> : null}
      </div>
    </div>
  );
}

function hasCustomerLifetimeValue(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed !== "—" && trimmed !== "-";
}

function hasCustomerOpenTickets(count: number): boolean {
  return count > 0;
}

function formatContactField(value: string | undefined | null): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "—";
}

function formatLastContact(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "—";
  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) return formatConversationTime(trimmed);
  return trimmed;
}

function contactEnrichmentLabel(
  outcome: WorkspaceConversation["customer"]["contactEnrichmentOutcome"],
): string | null {
  if (outcome === "linked_existing" || outcome === "merged_existing") {
    return "Existing contact";
  }
  if (outcome === "created" || outcome === "enriched" || outcome === "no_change") {
    return "Contact updated";
  }
  return null;
}

type CustomerInfoSection = "notes" | "omni" | "history" | "transfer" | "orders" | "tickets" | null;

function CustomerInfoCollapsibleSection({
  title,
  icon,
  expanded,
  onToggle,
  children,
  className,
}: {
  title: string;
  icon?: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", expanded && "flex min-h-0 flex-1 flex-col", className)}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-neutral-50"
        aria-expanded={expanded}
      >
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-neutral-900">
          {icon}
          <span className="truncate">{title}</span>
        </h2>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-neutral-400 transition-transform duration-200",
            expanded && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>
      {expanded ? children : null}
    </div>
  );
}

function CustomerInfoTab({
  conversation,
  detailsReady,
  activeConversationId,
  activeHistoryMessageId,
}: {
  conversation: WorkspaceConversation;
  detailsReady: boolean;
  activeConversationId: string;
  activeHistoryMessageId?: string | null;
}) {
  const { customer } = conversation;
  const profileName = customer.name;
  const enrichmentLabel = contactEnrichmentLabel(customer.contactEnrichmentOutcome);
  const detailContactId = detailsReady ? customer.contactId : null;
  const {
    history,
    loading,
    loadingMore,
    hasMore,
    loadMore,
  } = useCustomerInteractions({
    contactId: detailContactId,
    visitorId: detailsReady && !customer.contactId ? customer.id : undefined,
  });
  const previousInteractions = history.filter(
    (interaction) => interaction.conversationId !== conversation.id,
  );
  const successfulTransfers = (conversation.transferHistory ?? []).filter((transfer) => {
    const onThisConversation =
      transfer.conversationId == null || String(transfer.conversationId) === conversation.id;
    return onThisConversation && (transfer.state === "accepted" || transfer.state === "completed");
  });
  const {
    summary: omniChannelSummary,
    updatedAt: omniChannelSummaryUpdatedAt,
    loading: omniSummaryLoading,
  } = useOmniChannelSummary(detailContactId);
  const { orders } = useCustomerOrders(detailContactId);
  const { tickets } = useCustomerTickets(detailContactId);
  const [selectedOrder, setSelectedOrder] = useState<CustomerOrder | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<CustomerTicket | null>(null);
  const [selectedInteraction, setSelectedInteraction] = useState<SelectedPreviousInteraction | null>(
    null,
  );

  useEffect(() => {
    setSelectedOrder(null);
    setSelectedTicket(null);
    setSelectedInteraction(null);
  }, [conversation.id, customer.contactId]);
  // Prefer Omni channel summary on land; fall back to history when there is no contact.
  const { customerNotes } = useWorkspaceNotes({
    conversationId: conversation.id,
    visitorId: customer.id,
    contactId: customer.contactId,
    includeCommon: false,
  });
  const [expandedSection, setExpandedSection] = useState<CustomerInfoSection>(
    customer.contactId ? "omni" : "history",
  );

  const sectionOrder = useMemo(() => {
    const order: Array<Exclude<CustomerInfoSection, null>> = [];
    if (customerNotes.length > 0) order.push("notes");
    if (customer.contactId) order.push("omni");
    if (orders.length > 0) order.push("orders");
    if (tickets.length > 0) order.push("tickets");
    if (successfulTransfers.length > 0) order.push("transfer");
    order.push("history");
    return order;
  }, [customer.contactId, customerNotes.length, orders.length, tickets.length, successfulTransfers.length]);

  const toggleSection = useCallback(
    (section: Exclude<CustomerInfoSection, null>) => {
      setExpandedSection((current) => {
        if (current !== section) return section;
        const index = sectionOrder.indexOf(section);
        if (index < 0 || index === sectionOrder.length - 1) return null;
        return sectionOrder[index + 1] ?? null;
      });
    },
    [sectionOrder],
  );

  useEffect(() => {
    setExpandedSection(customer.contactId ? "omni" : "history");
  }, [conversation.id, customer.contactId]);

  const showLifetimeValue = hasCustomerLifetimeValue(customer.lifetimeValue);
  const showOpenTickets = hasCustomerOpenTickets(customer.openTickets);
  const kpiCardCount = Number(showLifetimeValue) + Number(showOpenTickets);

  const handleHistoryScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (expandedSection !== "history" || !hasMore || loadingMore) return;
      const target = event.currentTarget;
      const remaining =
        target.scrollHeight - target.scrollTop - target.clientHeight;
      if (remaining <= 96) {
        loadMore();
      }
    },
    [expandedSection, hasMore, loadMore, loadingMore],
  );

  const notesExpanded = expandedSection === "notes";
  const historyExpanded = expandedSection === "history";
  const transferExpanded = expandedSection === "transfer";
  const ordersExpanded = expandedSection === "orders";
  const ticketsExpanded = expandedSection === "tickets";
  const omniExpanded = expandedSection === "omni";
  const anySectionExpanded =
    historyExpanded || notesExpanded || omniExpanded || transferExpanded || ordersExpanded || ticketsExpanded;

  const profileDetails = (
      <div className="min-w-0 px-4 pt-3 pb-4">
        <div className="space-y-3 xl:space-y-4">
          <div className="flex items-center gap-2.5">
            <div className={profileAvatarClassName(customer.id, "size-10 shrink-0 text-xs")}>
              {profileInitials(profileName)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate capitalize text-[18px] font-semibold leading-snug text-neutral-900">
                {profileName}
              </p>
              {enrichmentLabel ? (
                <span className="mt-1 inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                  {enrichmentLabel}
                </span>
              ) : null}
            </div>
          </div>

          {kpiCardCount > 0 ? (
            <div
              className={cn("grid gap-3", kpiCardCount === 2 ? "grid-cols-2" : "grid-cols-1")}
            >
              {showLifetimeValue ? (
                <KpiCard label="Lifetime value" value={customer.lifetimeValue} />
              ) : null}
              {showOpenTickets ? (
                <KpiCard
                  label="Open tickets"
                  value={customer.openTickets}
                  valueClassName="text-amber-700"
                />
              ) : null}
            </div>
          ) : null}

          <ProfileDetailList>
            <ProfileDetailRow label="Email">
              {formatContactField(customer.email)}
            </ProfileDetailRow>
            <ProfileDetailRow label="Phone">
              {formatContactField(customer.phone)}
            </ProfileDetailRow>
            <ProfileDetailRow label="Company">
              {formatContactField(customer.company)}
            </ProfileDetailRow>
            <ProfileDetailRow label="Location">
              {formatContactField(customer.location)}
            </ProfileDetailRow>
            <ProfileDetailRow label="Address">
              {formatContactField(customer.address)}
            </ProfileDetailRow>
            <ProfileDetailRow label="Preferred language">
              {formatContactField(customer.language)}
            </ProfileDetailRow>
            <ProfileDetailRow label="Last contact">
              {formatLastContact(customer.lastContact)}
            </ProfileDetailRow>
          </ProfileDetailList>
        </div>
      </div>
  );

  const transferHistory =
    successfulTransfers.length > 0 ? (
      <div
        className={cn(
          "border-t-[0.6px] border-[#bfbfbf]",
          transferExpanded && "flex min-h-0 flex-1 flex-col",
        )}
      >
        <CustomerInfoCollapsibleSection
          title="Transfer history of this conversation"
          expanded={transferExpanded}
          onToggle={() => toggleSection("transfer")}
          className={transferExpanded ? "flex min-h-0 flex-1 flex-col" : undefined}
        >
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain border-t-[0.6px] border-[#bfbfbf] px-4 pt-3 pb-4">
            {successfulTransfers.map((transfer) => (
              <ProfileDetailList key={transfer.id ?? `${transfer.requestedAt}-${transfer.acceptedAt}`}>
                <ProfileDetailRow label="Transferred to">{transferTargetName(transfer)}</ProfileDetailRow>
                <ProfileDetailRow label="Queue">{transferQueueName(transfer)}</ProfileDetailRow>
              </ProfileDetailList>
            ))}
          </div>
        </CustomerInfoCollapsibleSection>
      </div>
    ) : null;

  const omniSection = customer.contactId ? (
    <div
      className={cn(
        "border-t-[0.6px] border-[#bfbfbf]",
        omniExpanded && "flex min-h-0 flex-1 flex-col",
      )}
    >
      <CustomerInfoCollapsibleSection
        title="Omni channel summary"
        icon={<Layers className="size-[18px] shrink-0" strokeWidth={2.25} aria-hidden="true" />}
        expanded={omniExpanded}
        onToggle={() => toggleSection("omni")}
        className={omniExpanded ? "flex min-h-0 flex-1 flex-col" : undefined}
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
          <OmniChannelSummaryContent
            summary={omniChannelSummary}
            updatedAt={omniChannelSummaryUpdatedAt}
            loading={omniSummaryLoading}
          />
        </div>
      </CustomerInfoCollapsibleSection>
    </div>
  ) : null;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <div
        className={cn(
          "min-h-0 overscroll-contain",
          anySectionExpanded ? "max-h-[42%] shrink-0 overflow-y-auto" : "shrink-0",
        )}
      >
        {profileDetails}
      </div>
      {customerNotes.length > 0 ? (
      <div
        className={cn(
          "border-t-[0.6px] border-[#bfbfbf]",
          notesExpanded && "flex min-h-0 flex-1 flex-col",
        )}
      >
        <CustomerInfoCollapsibleSection
          title={`Customer notes (${customerNotes.length})`}
          icon={<StickyNote className="size-[18px] shrink-0" strokeWidth={2.25} aria-hidden="true" />}
          expanded={notesExpanded}
          onToggle={() => toggleSection("notes")}
          className={notesExpanded ? "flex min-h-0 flex-1 flex-col" : undefined}
        >
          <CustomerNotesBlock notes={customerNotes} />
        </CustomerInfoCollapsibleSection>
      </div>
      ) : null}
      {omniSection}
      {orders.length > 0 ? (
        <div
          className={cn(
            "border-t-[0.6px] border-[#bfbfbf]",
            ordersExpanded && "flex min-h-0 flex-1 flex-col",
          )}
        >
          <CustomerInfoCollapsibleSection
            title={`Orders (${orders.length})`}
            icon={<ShoppingBag className="size-[18px] shrink-0" strokeWidth={2.25} aria-hidden="true" />}
            expanded={ordersExpanded}
            onToggle={() => toggleSection("orders")}
            className={ordersExpanded ? "flex min-h-0 flex-1 flex-col" : undefined}
          >
            <OrdersList orders={orders} onSelect={setSelectedOrder} />
          </CustomerInfoCollapsibleSection>
        </div>
      ) : null}
      {tickets.length > 0 ? (
        <div
          className={cn(
            "border-t-[0.6px] border-[#bfbfbf]",
            ticketsExpanded && "flex min-h-0 flex-1 flex-col",
          )}
        >
          <CustomerInfoCollapsibleSection
            title={`Tickets (${tickets.length})`}
            icon={<Ticket className="size-[18px] shrink-0" strokeWidth={2.25} aria-hidden="true" />}
            expanded={ticketsExpanded}
            onToggle={() => toggleSection("tickets")}
            className={ticketsExpanded ? "flex min-h-0 flex-1 flex-col" : undefined}
          >
            <TicketsList tickets={tickets} onSelect={setSelectedTicket} />
          </CustomerInfoCollapsibleSection>
        </div>
      ) : null}
      <WorkspaceCustomerOrderDialog order={selectedOrder} onClose={() => setSelectedOrder(null)} />
      <WorkspaceCustomerTicketDialog ticket={selectedTicket} onClose={() => setSelectedTicket(null)} />
      {transferHistory}

      <div
        className={cn(
          "border-t-[0.6px] border-[#bfbfbf] bg-white",
          historyExpanded ? "flex min-h-0 flex-1 flex-col" : "shrink-0",
        )}
      >
        <button
          type="button"
          onClick={() => toggleSection("history")}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-neutral-50"
          aria-expanded={historyExpanded}
        >
          <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-neutral-900">
            <History className="size-[18px] shrink-0" strokeWidth={2.25} aria-hidden="true" />
            <span className="truncate">Previous interactions</span>
          </h2>
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-neutral-400 transition-transform duration-200",
              historyExpanded && "rotate-180",
            )}
            aria-hidden="true"
          />
        </button>
        {historyExpanded ? (
          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
            onScroll={handleHistoryScroll}
          >
            {loading ? (
              <div className="px-4 py-4">
                <PanelLoader label="Loading interactions…" />
              </div>
            ) : previousInteractions.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
                <p className="text-sm font-medium text-neutral-800">No previous interactions</p>
                <p className="mt-1 text-sm text-neutral-600">Nothing to show yet.</p>
              </div>
            ) : (
              <ul className="px-1 pb-1">
                {previousInteractions.map((entry) => (
                  <CustomerHistoryItem
                    key={entry.id}
                    entry={entry}
                    customerId={customer.id}
                    profileName={resolveProfileDisplayName(entry.subject, customer.name)}
                    isActive={
                      entry.conversationId === activeConversationId &&
                      entry.messageId === activeHistoryMessageId
                    }
                    onSelect={() => {
                      const channelMeta = workspaceChannelMeta(mapWorkspaceChannel(entry.channel));
                      setSelectedInteraction({
                        conversationId: entry.conversationId,
                        channelLabel: channelMeta.label,
                        queue: activityQueueLabel(entry.queue, entry.agentConnected),
                        subject: channelMeta.label,
                        isPast: isPastInteractionStatus(entry.status),
                      });
                    }}
                  />
                ))}
                {loadingMore ? (
                  <li>
                    <PanelLoader inline label="Loading more interactions…" />
                  </li>
                ) : null}
              </ul>
            )}
          </div>
        ) : null}
      </div>
      {anySectionExpanded ? null : <div className="min-h-0 flex-1" />}
      <MonitoringDrawer
        open={Boolean(selectedInteraction)}
        title={selectedInteraction?.subject ?? "Conversation"}
        subtitle={
          selectedInteraction
            ? `${selectedInteraction.channelLabel} · ${selectedInteraction.queue}`
            : undefined
        }
        onClose={() => setSelectedInteraction(null)}
        widthClass="max-w-3xl"
      >
        {selectedInteraction ? (
          <MonitoringConversationDetailSections
            conversationId={selectedInteraction.conversationId}
            contactId={customer.contactId}
            isPast={selectedInteraction.isPast}
            contextRows={
              <>
                <PreviousInteractionDetailRow
                  label="Channel"
                  value={selectedInteraction.channelLabel}
                />
                <PreviousInteractionDetailRow
                  label="Subject"
                  value={selectedInteraction.subject}
                />
                <PreviousInteractionDetailRow label="Queue" value={selectedInteraction.queue} />
              </>
            }
          />
        ) : null}
      </MonitoringDrawer>
    </div>
  );
}

function PreviousInteractionDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b-[0.6px] border-[#bfbfbf] pb-2 last:border-b-0 last:pb-0">
      <span className="text-xs text-neutral-600">{label}</span>
      <span className="text-xs font-medium text-neutral-900">{value}</span>
    </div>
  );
}

function CustomerHistoryItem({
  entry,
  customerId,
  profileName,
  isActive,
  onSelect,
}: {
  entry: CustomerInteractionHistory;
  customerId: string;
  profileName: string;
  isActive: boolean;
  onSelect: () => void;
}) {
  const channel = mapWorkspaceChannel(entry.channel);
  const channelMeta = workspaceChannelMeta(channel);

  return (
    <li className={listRowDividerClassName()}>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          listRowButtonClassName,
          isActive ? "bg-neutral-100" : "hover:bg-neutral-50",
        )}
      >
        <div className="flex items-start gap-2.5">
          <div className={profileAvatarClassName(customerId, "size-10 shrink-0 text-xs")}>
            {profileInitials(profileName)}
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-semibold leading-5 text-neutral-900">{entry.subject}</p>
              <span className={listRowTimestampClassName}>
                {formatConversationTime(entry.occurredAt)}
              </span>
            </div>
            <p className="line-clamp-2 text-sm leading-snug text-neutral-600">
              {plainTextMessageBody(entry.botMemory?.rollingSummary ?? entry.summary)}
            </p>
            <WorkspaceContactMetaRow
              channel={channel}
              channelLabel={channelMeta.label}
              queueLabel={entry.queue}
              direction={resolveWorkspaceConversationDirection(entry.direction, entry.subject)}
            />
          </div>
        </div>
      </button>
    </li>
  );
}
