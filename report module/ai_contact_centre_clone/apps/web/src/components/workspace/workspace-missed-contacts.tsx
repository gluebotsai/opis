import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, PhoneMissed } from "lucide-react";

import { Button } from "@/components/ui/button";
import { listRowDividerClassName } from "@/components/ui/list-row";
import {
  missedContactsApi,
  type AgentMissedContact,
} from "@/features/workspace/missed-contacts-api";
import { useWorkspaceSocket } from "@/features/workspace/use-workspace-socket";
import { mapWorkspaceChannel } from "@/features/workspace/workspace-utils";
import { cn } from "@/lib/utils";

function channelLabel(channel: string): string {
  const mapped = mapWorkspaceChannel(channel);
  if (mapped === "chat") return "live chat";
  if (mapped === "whatsapp") return "WhatsApp";
  if (mapped === "instagram") return "Instagram";
  if (mapped === "facebook") return "Facebook";
  if (mapped === "email") return "email";
  if (mapped === "voice") return "call";
  return channel;
}

function missedContactTitle(item: AgentMissedContact): string {
  return `Missed ${channelLabel(item.channel)}`;
}

function formatMissedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function dedupeMissedContacts(items: AgentMissedContact[]): AgentMissedContact[] {
  const byConversation = new Map<string, AgentMissedContact>();
  for (const item of items) {
    const existing = byConversation.get(item.conversationId);
    if (!existing || new Date(item.missedAt).getTime() >= new Date(existing.missedAt).getTime()) {
      byConversation.set(item.conversationId, item);
    }
  }
  return [...byConversation.values()].sort(
    (left, right) => new Date(right.missedAt).getTime() - new Date(left.missedAt).getTime(),
  );
}

export function WorkspaceMissedContacts() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AgentMissedContact[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await missedContactsApi.list();
      setItems(dedupeMissedContacts(result.items));
      setUnreadCount(result.unreadCount);
    } catch {
      // Keep last known state when refresh fails.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useWorkspaceSocket({
    onMissedContactCreated: (payload) => {
      setUnreadCount(payload.unreadCount);
      setItems((current) => {
        const nextItem: AgentMissedContact = {
          id: payload.item.id,
          conversationId: payload.item.conversationId,
          contactId: null,
          queueId: null,
          channel: payload.item.channel,
          reason: payload.item.reason as AgentMissedContact["reason"],
          customerName: payload.item.customerName,
          customerEmail: null,
          customerPhone: null,
          offeredAt: null,
          missedAt: payload.item.missedAt,
          acknowledgedAt: null,
        };
        const withoutDuplicate = current.filter(
          (item) => item.id !== nextItem.id && item.conversationId !== nextItem.conversationId,
        );
        return dedupeMissedContacts([nextItem, ...withoutDuplicate]);
      });
    },
  });

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  async function handleOpenMenu() {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen) {
      await refresh();
    }
  }

  async function acknowledgeItem(id: string) {
    const result = await missedContactsApi.acknowledge(id);
    setUnreadCount(result.unreadCount);
    setItems((current) =>
      current.map((item) =>
        item.id === id ? { ...item, acknowledgedAt: result.item.acknowledgedAt } : item,
      ),
    );
  }

  async function acknowledgeAll() {
    const result = await missedContactsApi.acknowledgeAll();
    setUnreadCount(result.unreadCount);
    setItems((current) =>
      current.map((item) => ({
        ...item,
        acknowledgedAt: item.acknowledgedAt ?? new Date().toISOString(),
      })),
    );
  }

  return (
    <div ref={menuRef} className="relative">
      <Button
        variant="panelIcon"
        aria-label="Missed contacts"
        className="relative text-neutral-700"
        onClick={() => void handleOpenMenu()}
      >
        <Bell />
        {unreadCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex size-[15px] items-center justify-center rounded-full bg-red-500 text-[10px] font-semibold leading-none text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </Button>

      {open ? (
        <div className="absolute right-0 top-full z-30 mt-2 w-[22rem] overflow-hidden rounded-xl border-[0.6px] border-[#bfbfbf] bg-white shadow-xl">
          <div className="flex items-center justify-between border-b-[0.6px] border-[#bfbfbf] px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-neutral-900">Missed contacts</p>
              <p className="text-xs text-neutral-600">Contacts you did not answer in time</p>
            </div>
            {unreadCount > 0 ? (
              <button
                type="button"
                className="text-xs font-medium text-neutral-600 hover:text-neutral-900"
                onClick={() => void acknowledgeAll()}
              >
                Mark all read
              </button>
            ) : null}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {loading && items.length === 0 ? (
              <p className="px-4 py-6 text-sm text-neutral-600">Loading…</p>
            ) : null}
            {!loading && items.length === 0 ? (
              <p className="px-4 py-6 text-sm text-neutral-600">No missed contacts</p>
            ) : null}
            {items.map((item) => {
              const unread = !item.acknowledgedAt;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={cn(
                    "flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left transition hover:bg-neutral-50",
                    listRowDividerClassName("4"),
                    unread && "bg-amber-50/40",
                  )}
                  onClick={() => {
                    if (unread) void acknowledgeItem(item.id);
                  }}
                >
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-700">
                    <PhoneMissed className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-neutral-900">
                        {item.customerName}
                      </span>
                      {unread ? (
                        <span className="size-2 shrink-0 rounded-full bg-red-500" />
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-xs text-neutral-600">
                      {missedContactTitle(item)}
                    </span>
                    <span className="mt-1 block text-[11px] text-neutral-400">
                      {formatMissedAt(item.missedAt)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
