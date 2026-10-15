import { useEffect, useRef, type UIEvent } from "react";
import { Search } from "lucide-react";

import { PanelRefreshButton } from "@/components/assistant/copilot-workspace";
import { WorkspaceEmptyState } from "@/components/workspace/workspace-empty-state";
import { WorkspaceInboxSkeleton } from "@/components/workspace/workspace-inbox-skeleton";

import { WorkspaceContactMetaRow } from "@/components/workspace/workspace-contact-meta-row";
import { segmentTabClassName } from "@/components/ui/button";
import { listRowButtonClassName, listRowDividerClassName, listRowTimestampClassName } from "@/components/ui/list-row";
import { PanelScrollArea } from "@/components/ui/panel-scroll-area";
import { profileAvatarClassName, profileInitials } from "@/lib/avatar-utils";
import { contentPanelHeaderBorderClassName } from "@/lib/panel-chrome";
import type { WorkspaceConversation, WorkspaceInboxTab } from "@/features/workspace/types";
import { workspaceChannelMeta, formatConversationTime, formatQueueLabel, inboxActivityAt, isEmailChannel, resolveWorkspaceConversationTitle, resolveWorkspaceEmailSubjectLine } from "@/features/workspace/workspace-utils";
import { cn } from "@/lib/utils";

type WorkspaceInboxPanelProps = {
  conversations: WorkspaceConversation[];
  selectedId: string;
  tab: WorkspaceInboxTab;
  search: string;
  counts: Record<WorkspaceInboxTab, number>;
  loading?: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  loadError?: string | null;
  onTabChange: (tab: WorkspaceInboxTab) => void;
  onSearchChange: (value: string) => void;
  onSelect: (id: string) => void;
  onRefresh?: () => void;
  onLoadMore?: () => void;
};

const TABS: { id: WorkspaceInboxTab; label: string }[] = [
  { id: "open", label: "Ongoing" },
  { id: "transferred", label: "Transferred" },
  { id: "closed", label: "Closed" },
];

export function WorkspaceInboxPanel({
  conversations,
  selectedId,
  tab,
  search,
  counts,
  loading = false,
  loadingMore = false,
  hasMore = false,
  loadError = null,
  onTabChange,
  onSearchChange,
  onSelect,
  onRefresh,
  onLoadMore,
}: WorkspaceInboxPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const onLoadMoreRef = useRef(onLoadMore);
  const fillAttemptsRef = useRef(0);
  const filledCountRef = useRef(conversations.length);
  onLoadMoreRef.current = onLoadMore;

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    if (!hasMore || loading || loadingMore) return;
    const element = event.currentTarget;
    const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (remaining < 120) onLoadMoreRef.current?.();
  }

  useEffect(() => {
    fillAttemptsRef.current = 0;
  }, [tab]);

  useEffect(() => {
    if (conversations.length !== filledCountRef.current) {
      filledCountRef.current = conversations.length;
      fillAttemptsRef.current = 0;
    }
    if (!hasMore || loading || loadingMore) return;
    const element = scrollRef.current;
    if (!element) return;
    if (element.scrollHeight - element.clientHeight >= 120) return;
    if (fillAttemptsRef.current >= 3) return;
    fillAttemptsRef.current += 1;
    onLoadMoreRef.current?.();
  }, [conversations.length, hasMore, loading, loadingMore]);
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-white">
      <div
        className={cn(
          "hidden shrink-0 items-center justify-between gap-2 px-4 py-3 xl:flex",
          contentPanelHeaderBorderClassName,
        )}
      >
        <div className="min-w-0">
          <h2 className="text-[18px] font-semibold text-neutral-900">Inbox</h2>
          <p className="mt-0.5 text-sm text-neutral-600">Conversations assigned</p>
        </div>
        {onRefresh ? (
          <PanelRefreshButton onClick={onRefresh} refreshing={loading} />
        ) : null}
      </div>

      <div className="shrink-0 space-y-3 px-3 pt-3 pb-2 xl:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-neutral-900" />
            <input
              type="search"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search…"
              className="h-[38px] w-full rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50 pr-3 pl-9 text-sm outline-none placeholder:text-neutral-600 focus:border-neutral-400 focus:bg-white focus:ring-2 focus:ring-neutral-200"
            />
          </div>
          {onRefresh ? (
            <div className="xl:hidden">
              <PanelRefreshButton onClick={onRefresh} refreshing={loading} />
            </div>
          ) : null}
        </div>

        <div className="min-w-0 overflow-x-auto">
          <div className="grid min-w-full grid-cols-[repeat(3,minmax(max-content,1fr))] gap-1">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onTabChange(item.id)}
                className={segmentTabClassName({
                  active: tab === item.id,
                  className: "w-full whitespace-nowrap",
                })}
              >
                {item.label}
                {counts[item.id] > 0 ? (
                  <span className={cn("ml-1", tab === item.id ? "text-white/70" : "text-neutral-400")}>
                    {counts[item.id]}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      </div>

      <PanelScrollArea
        ref={scrollRef}
        className="min-h-0 flex-1 px-3 pt-1 pb-3 xl:pt-2"
        onScroll={handleScroll}
      >
        {loading ? (
          <WorkspaceInboxSkeleton />
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
            <p className="text-sm font-medium text-red-600">{loadError}</p>
            {onRefresh ? (
              <button
                type="button"
                onClick={onRefresh}
                className="text-sm font-medium text-neutral-700 underline"
              >
                Retry
              </button>
            ) : null}
          </div>
        ) : conversations.length === 0 ? (
          <WorkspaceEmptyState
            variant="inbox"
            title="No conversations"
            description="Nothing in this tab yet."
            compact
          />
        ) : (
          <ul>
            {conversations.map((conversation) => {
              const channel = workspaceChannelMeta(conversation.channel);
              const isSelected = conversation.id === selectedId;
              const unreadCount = conversation.unreadCount ?? 0;
              const showUnreadBadge = !isSelected && unreadCount > 0;
              const isEmail = isEmailChannel(conversation.channel);
              const queueLabel = formatQueueLabel(conversation.queue);
              const title = resolveWorkspaceConversationTitle({
                customerName: conversation.customer.name,
                channel: conversation.channel,
                subject: conversation.subject,
              });
              const emailSubjectLine = isEmail
                ? resolveWorkspaceEmailSubjectLine(conversation.subject)
                : null;

              return (
                <li key={conversation.id} className={listRowDividerClassName()}>
                  <button
                    type="button"
                    onClick={() => onSelect(conversation.id)}
                    className={cn(
                      listRowButtonClassName,
                      isSelected ? "bg-neutral-100" : "hover:bg-neutral-50",
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      <div
                        className={profileAvatarClassName(
                          conversation.customer.id,
                          "size-[38px] text-[14px]",
                        )}
                      >
                        {profileInitials(title)}
                      </div>
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p
                            className={cn(
                              "min-w-0 truncate capitalize text-[14px] leading-5",
                              conversation.unread ? "font-semibold text-neutral-900" : "text-neutral-800",
                              isEmail && "font-medium",
                            )}
                          >
                            {title}
                          </p>
                          <span className="flex shrink-0 items-center gap-1.5">
                            {showUnreadBadge ? (
                              <span
                                className="flex size-5 items-center justify-center rounded-full bg-neutral-900 text-[10px] font-semibold leading-none text-white"
                                aria-label={`${unreadCount} unread messages`}
                              >
                                {unreadCount > 9 ? "9+" : unreadCount}
                              </span>
                            ) : null}
                            <span className={listRowTimestampClassName}>
                              {formatConversationTime(inboxActivityAt(conversation))}
                            </span>
                          </span>
                        </div>
                        {isEmail ? (
                          <p className="truncate text-xs leading-4 text-neutral-600">
                            {emailSubjectLine ?? conversation.customer.email}
                          </p>
                        ) : null}
                        {conversation.preview ? (
                          <p className="line-clamp-2 text-xs leading-snug text-neutral-600">
                            {conversation.preview}
                          </p>
                        ) : null}
                        <WorkspaceContactMetaRow
                          channel={conversation.channel}
                          channelLabel={channel.label}
                          queueLabel={queueLabel}
                          direction={conversation.direction}
                        />
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {loadingMore ? (
          <p className="py-3 text-center text-sm text-neutral-600">Loading more conversations…</p>
        ) : null}
      </PanelScrollArea>
    </div>
  );
}
