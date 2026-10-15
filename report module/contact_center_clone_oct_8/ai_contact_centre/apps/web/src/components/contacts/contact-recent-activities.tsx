import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";

import { MonitoringConversationDetailSections } from "@/components/monitoring/monitoring-conversation-lifecycle";
import { MonitoringDrawer } from "@/components/monitoring/monitoring-shared";
import { listRowDividerClassName, listRowTimestampClassName } from "@/components/ui/list-row";
import { WorkspaceChannelIcon } from "@/components/workspace/workspace-channel-icon";
import { WorkspaceDirectionIcon } from "@/components/workspace/workspace-contact-meta-row";
import { formatActivityOutcome } from "@/features/contacts/activity-outcome";
import { contactsApi } from "@/features/contacts/api";
import type { CustomerInteractionHistory } from "@/features/workspace/types";
import {
  formatConversationTime,
  mapWorkspaceChannel,
  resolveWorkspaceConversationDirection,
  workspaceChannelMeta,
} from "@/features/workspace/workspace-utils";
import { cn } from "@/lib/utils";

type ContactRecentActivitiesProps = {
  contactId: string;
  /** @deprecated Unused — activity titles use channel, not contact name. */
  contactName?: string;
};

type SelectedActivity = {
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

function activityQueueName(queue: string): string {
  return queue.trim() || "Unassigned";
}

function activityHandledLabel(agentConnected: boolean | undefined): string {
  return agentConnected ? "Agent handled" : "Bot handled";
}

function activityQueueLabel(queue: string, agentConnected: boolean | undefined): string {
  return `${activityQueueName(queue)} (${activityHandledLabel(agentConnected)})`;
}

export function ContactRecentActivities({
  contactId,
}: ContactRecentActivitiesProps) {
  const [items, setItems] = useState<CustomerInteractionHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<SelectedActivity | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setExpanded(false);
    void contactsApi
      .listContactInteractions(contactId, { offset: 0, limit: 8 })
      .then((page) => {
        if (cancelled) return;
        setItems(
          page.interactions.map((interaction) => ({
            ...interaction,
            channel: mapWorkspaceChannel(interaction.channel),
          })),
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setItems([]);
        setError(err instanceof Error ? err.message : "Failed to load activities");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  function openConversation(entry: CustomerInteractionHistory) {
    const channelMeta = workspaceChannelMeta(entry.channel);
    const queue = activityQueueLabel(entry.queue, entry.agentConnected);
    setSelected({
      conversationId: entry.conversationId,
      channelLabel: channelMeta.label,
      queue,
      subject: channelMeta.label,
      isPast: isPastInteractionStatus(entry.status),
    });
  }

  return (
    <>
      <div className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white px-4 py-4 shadow-none">
        <div>
          <p className="text-base font-semibold text-neutral-900">Previous interactions</p>
          <p className="mt-0.5 text-sm text-neutral-600">
            Chats, calls, and emails linked to this contact
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-neutral-600">
            <LoaderCircle className="size-4 animate-spin" />
            Loading activities…
          </div>
        ) : error ? (
          <p className="mt-3 text-sm text-red-600">{error}</p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-2 py-10 text-center">
            <p className="text-sm font-medium text-neutral-800">No activity found</p>
            <p className="mt-1 text-sm text-neutral-600">
              Chats, calls, and emails linked to this contact will appear here.
            </p>
          </div>
        ) : (
          <>
          <ul className={cn("mt-3", expanded && "max-h-80 overflow-y-auto overscroll-contain")}>
            {(expanded ? items.slice(0, 8) : items.slice(0, 4)).map((entry) => {
              const channelMeta = workspaceChannelMeta(entry.channel);
              const outcome = formatActivityOutcome(entry);
              const direction = resolveWorkspaceConversationDirection(
                entry.direction,
                entry.subject,
              );

              return (
                <li key={entry.id} className={listRowDividerClassName()}>
                  <button
                    type="button"
                    onClick={() => openConversation(entry)}
                    className={cn(
                      "w-full rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-neutral-50",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <WorkspaceChannelIcon
                        channel={entry.channel}
                        className="mt-0.5 size-[24px] shrink-0 rounded-[4px]"
                      />
                      <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-6 gap-y-[4px]">
                        <p className="min-w-0 truncate text-sm font-semibold text-neutral-900">
                          {channelMeta.label}
                        </p>
                        <p className={listRowTimestampClassName}>
                          {formatConversationTime(entry.occurredAt)}
                        </p>
                        <p className="col-span-2 min-w-0 truncate text-sm font-normal text-[#3f3f49]">
                          {outcome}
                        </p>
                        <p className="col-span-2 flex min-w-0 items-center gap-1.5 text-[12px] text-[#3f3f49]">
                          <WorkspaceDirectionIcon direction={direction} />
                          <span className="shrink-0">
                            {direction === "outbound" ? "Outgoing" : "Incoming"}
                          </span>
                          <span className="truncate rounded-md bg-neutral-100 px-1.5 py-0.5 font-medium text-[#3f3f49]">
                            {activityHandledLabel(entry.agentConnected)}
                          </span>
                        </p>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
          {items.length > 4 ? (
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              className="mt-2 text-sm font-semibold text-neutral-900"
            >
              {expanded ? "Show less" : "View more"}
            </button>
          ) : null}
          </>
        )}
      </div>

      <MonitoringDrawer
        open={Boolean(selected)}
        title={selected?.subject ?? "Conversation"}
        subtitle={
          selected ? `${selected.channelLabel} · ${selected.queue}` : undefined
        }
        onClose={() => setSelected(null)}
        widthClass="max-w-3xl"
      >
        {selected ? (
          <MonitoringConversationDetailSections
            conversationId={selected.conversationId}
            contactId={contactId}
            isPast={selected.isPast}
            contextRows={
              <>
                <DetailRow label="Channel" value={selected.channelLabel} />
                <DetailRow label="Subject" value={selected.subject} />
                <DetailRow label="Queue" value={selected.queue} />
              </>
            }
          />
        ) : null}
      </MonitoringDrawer>
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b-[0.6px] border-[#bfbfbf] pb-2 last:border-b-0 last:pb-0">
      <span className="text-xs text-neutral-600">{label}</span>
      <span className="text-xs font-medium text-neutral-900">{value}</span>
    </div>
  );
}
