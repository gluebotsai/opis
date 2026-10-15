import { ChevronDown, MessageSquarePlus, Plus, Search, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { InternalChatGroupAvatar } from "@/components/internal-chat/internal-chat-group-avatar";
import { Button, IconButton, segmentTabClassName } from "@/components/ui/button";
import { listRowDividerClassName, listRowTimestampClassName } from "@/components/ui/list-row";
import { PanelScrollArea } from "@/components/ui/panel-scroll-area";
import {
  filterRoomsByTab,
  formatChatTimestamp,
  memberById,
  presenceDotClass,
  presenceLabel,
  roomDisplayName,
  roomUnreadCount,
  roomTabCounts,
  searchRooms,
} from "@/features/internal-chat/internal-chat-utils";
import type { InternalChatMember, InternalChatMessage, InternalChatRoom, InternalChatRoomTab } from "@/features/internal-chat/types";
import { profileAvatarClassName, profileInitials } from "@/lib/avatar-utils";
import { contentPanelHeaderBorderClassName } from "@/lib/panel-chrome";
import { cn } from "@/lib/utils";

type InternalChatRoomListPanelProps = {
  rooms: InternalChatRoom[];
  messages: InternalChatMessage[];
  members: InternalChatMember[];
  currentUserId: string;
  selectedRoomId: string | null;
  isAdmin: boolean;
  onSelectRoom: (roomId: string) => void;
  onStartChat?: () => void;
  onCreateGroup?: () => void;
};

const TABS: { id: InternalChatRoomTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "groups", label: "Groups" },
  { id: "favourite", label: "Favourite" },
];

function InternalChatNewActions({
  onStartChat,
  onCreateGroup,
  compact = false,
}: {
  onStartChat?: () => void;
  onCreateGroup?: () => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  if (!onStartChat && !onCreateGroup) return null;

  if (onStartChat && !onCreateGroup) {
    if (compact) {
      return (
        <IconButton onClick={onStartChat} aria-label="New chat">
          <MessageSquarePlus />
        </IconButton>
      );
    }
    return (
      <Button onClick={onStartChat}>
        <MessageSquarePlus className="size-[18px]" aria-hidden />
        New chat
      </Button>
    );
  }

  if (!onStartChat && onCreateGroup) {
    if (compact) {
      return (
        <IconButton onClick={onCreateGroup} aria-label="New group">
          <Users />
        </IconButton>
      );
    }
    return (
      <Button onClick={onCreateGroup}>
        <Users className="size-[18px]" aria-hidden />
        New group
      </Button>
    );
  }

  return (
    <div className="relative" ref={menuRef}>
      {compact ? (
        <IconButton
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label="New"
        >
          <Plus />
        </IconButton>
      ) : (
        <Button
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label="New"
        >
          <Plus className="size-[18px]" aria-hidden />
          New
          <ChevronDown className="size-4" aria-hidden />
        </Button>
      )}
      {open ? (
        <div
          role="menu"
          className="absolute top-full right-0 z-20 mt-1 w-44 overflow-hidden rounded-xl border-[0.6px] border-[#bfbfbf] bg-white py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onStartChat?.();
            }}
            className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-50"
          >
            <MessageSquarePlus className="size-[18px] shrink-0 text-neutral-900" aria-hidden />
            New chat
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onCreateGroup?.();
            }}
            className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-50"
          >
            <Users className="size-[18px] shrink-0 text-neutral-900" aria-hidden />
            New group
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function InternalChatRoomListPanel({
  rooms,
  messages,
  members,
  currentUserId,
  selectedRoomId,
  isAdmin,
  onSelectRoom,
  onStartChat,
  onCreateGroup,
}: InternalChatRoomListPanelProps) {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<InternalChatRoomTab>("all");
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const tabCounts = roomTabCounts(rooms);
  const currentUser = memberById(members, currentUserId);
  const visibleRooms = filterRoomsByTab(
    searchRooms(rooms, members, currentUserId, search),
    tab,
  ).sort((a, b) => {
    const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    return bTime - aTime;
  });

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div
        className={cn(
          "hidden shrink-0 items-center justify-between gap-3 px-4 py-3 xl:flex",
          contentPanelHeaderBorderClassName,
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative shrink-0">
            <span
              className={profileAvatarClassName(
                currentUser?.name ?? "User",
                "size-10 text-xs",
              )}
              aria-hidden
            >
              {profileInitials(currentUser?.name ?? "User")}
            </span>
            {currentUser ? (
              <span
                className={cn(
                  "absolute right-0 bottom-0 size-2.5 rounded-full ring-2 ring-white",
                  presenceDotClass(currentUser.presence),
                )}
                title={presenceLabel(currentUser.presence)}
              />
            ) : null}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-[18px] font-semibold text-neutral-900">
              {currentUser?.name ?? "You"}
            </h2>
            <p className="mt-0.5 truncate text-sm text-neutral-600">
              {currentUser?.title ?? "Internal Chat"}
            </p>
          </div>
        </div>
        <InternalChatNewActions
          onStartChat={onStartChat}
          onCreateGroup={isAdmin ? onCreateGroup : undefined}
        />
      </div>

      <div className="shrink-0 space-y-3 px-3 pt-3 pb-2 xl:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-neutral-900" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search chats…"
              className="h-[38px] w-full rounded-lg border-[0.6px] border-[#bfbfbf] bg-neutral-50 pr-3 pl-9 text-sm text-neutral-900 outline-none placeholder:text-neutral-600 focus:border-neutral-400 focus:bg-white focus:ring-2 focus:ring-neutral-200"
            />
          </div>
          <div className="xl:hidden">
            <InternalChatNewActions
              compact
              onStartChat={onStartChat}
              onCreateGroup={isAdmin ? onCreateGroup : undefined}
            />
          </div>
        </div>

        <div className="min-w-0 overflow-x-auto">
          <div className="grid min-w-full grid-cols-4 gap-1">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={segmentTabClassName({
                  active: tab === item.id,
                  className: "w-full gap-0.5 px-1.5 whitespace-nowrap",
                })}
              >
                <span className="truncate">{item.label}</span>
                {tabCounts[item.id] > 0 ? (
                  <span className={cn("shrink-0", tab === item.id ? "text-white/70" : "text-neutral-900")}>
                    {tabCounts[item.id]}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      </div>

      <PanelScrollArea className="min-h-0 flex-1">
        {visibleRooms.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <Users className="size-8 text-neutral-300" />
            <p className="mt-3 text-sm font-medium text-neutral-700">No chats found</p>
            <p className="mt-1 text-xs text-neutral-600">
              {tab === "all"
                ? onStartChat
                  ? "Start a new chat or create a group to message your team."
                  : isAdmin
                    ? "Create a group to start messaging your team."
                    : "You are not in any chats yet."
                : `No ${tab === "favourite" ? "favourite" : tab} chats right now.`}
            </p>
          </div>
        ) : (
          <ul>
            {visibleRooms.map((room) => {
              const label = roomDisplayName(room, members, currentUserId);
              const unreadCount = roomUnreadCount(messages, room, currentUserId);
              const isSelected = room.id === selectedRoomId;
              const dmMember =
                room.type === "dm"
                  ? memberById(
                      members,
                      room.memberIds.find((memberId) => memberId !== currentUserId) ?? "",
                    )
                  : null;
              return (
                <li
                  key={room.id}
                  className={listRowDividerClassName("4")}
                >
                  <button
                    type="button"
                    onClick={() => onSelectRoom(room.id)}
                    className={cn(
                      "flex w-full cursor-pointer items-start gap-3 px-4 py-4 text-left transition",
                      isSelected ? "bg-neutral-100" : "hover:bg-neutral-50",
                    )}
                  >
                    <div className="relative shrink-0">
                      {room.type === "group" ? (
                        <InternalChatGroupAvatar
                          name={label}
                          avatarUrl={room.avatarUrl}
                          className="size-10 text-xs"
                        />
                      ) : (
                        <span
                          className={profileAvatarClassName(label, "size-10 text-xs")}
                          aria-hidden
                        >
                          {profileInitials(label)}
                        </span>
                      )}
                      {dmMember ? (
                        <span
                          className={cn(
                            "absolute right-0 bottom-0 size-2.5 rounded-full ring-2 ring-white",
                            presenceDotClass(dmMember.presence),
                          )}
                          title={presenceLabel(dmMember.presence)}
                        />
                      ) : null}
                    </div>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span
                          className="truncate text-sm font-medium text-neutral-800"
                        >
                          {label}
                        </span>
                        {room.lastMessageAt ? (
                          <span className={listRowTimestampClassName}>
                            {formatChatTimestamp(room.lastMessageAt, nowTick)}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 flex items-center gap-2">
                        <span className="truncate text-xs text-neutral-600">
                          {room.lastMessagePreview ?? "No messages yet"}
                        </span>
                        {unreadCount > 0 ? (
                          <span
                            className="ml-auto flex size-5 shrink-0 items-center justify-center rounded-full bg-red-500 text-[10px] font-semibold leading-none text-white"
                            aria-label={`${unreadCount} unread messages`}
                          >
                            {unreadCount > 99 ? "99+" : unreadCount}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </PanelScrollArea>
    </div>
  );
}
