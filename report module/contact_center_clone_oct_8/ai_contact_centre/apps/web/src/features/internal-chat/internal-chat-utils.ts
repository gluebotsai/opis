import type { InternalChatMember, InternalChatMessage, InternalChatRoom, InternalChatRoomTab } from "./types";

export function memberById(members: InternalChatMember[], userId: string) {
  return members.find((member) => member.userId === userId);
}

export function roomHasUnread(room: InternalChatRoom): boolean {
  return roomUnreadCount([], room) > 0;
}

export function roomUnreadCount(
  messages: InternalChatMessage[],
  room: InternalChatRoom,
  currentUserId?: string,
): number {
  if (!room.lastMessageAt) return 0;

  const lastReadMs = room.lastReadAt ? new Date(room.lastReadAt).getTime() : 0;
  const unreadFromMessages = messages.filter((message) => {
    if (message.roomId !== room.id) return false;
    if (currentUserId && message.senderUserId === currentUserId) return false;
    return new Date(message.createdAt).getTime() > lastReadMs;
  }).length;

  if (unreadFromMessages > 0) return unreadFromMessages;

  if (!room.lastReadAt) return 1;
  return new Date(room.lastMessageAt).getTime() > lastReadMs ? 1 : 0;
}

export function totalUnreadCount(rooms: InternalChatRoom[]): number {
  return rooms.filter(roomHasUnread).length;
}

export function roomDisplayName(
  room: InternalChatRoom,
  members: InternalChatMember[],
  currentUserId: string,
): string {
  if (room.type === "group") return room.name;
  const otherMemberId = room.memberIds.find((id) => id !== currentUserId);
  const other = otherMemberId ? memberById(members, otherMemberId) : undefined;
  return other?.name ?? room.name;
}

export function roomMessages(messages: InternalChatMessage[], roomId: string) {
  return messages
    .filter((message) => message.roomId === roomId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export function searchRooms(
  rooms: InternalChatRoom[],
  members: InternalChatMember[],
  currentUserId: string,
  query: string,
): InternalChatRoom[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return rooms;
  return rooms.filter((room) => {
    const label = roomDisplayName(room, members, currentUserId).toLowerCase();
    const preview = room.lastMessagePreview?.toLowerCase() ?? "";
    return label.includes(normalized) || preview.includes(normalized);
  });
}

export function filterRoomsByTab(rooms: InternalChatRoom[], tab: InternalChatRoomTab): InternalChatRoom[] {
  switch (tab) {
    case "unread":
      return rooms.filter(roomHasUnread);
    case "groups":
      return rooms.filter((room) => room.type === "group");
    case "favourite":
      return rooms.filter((room) => room.favourite);
    case "all":
    default:
      return rooms;
  }
}

export function roomTabCounts(rooms: InternalChatRoom[]): Record<InternalChatRoomTab, number> {
  return {
    all: rooms.length,
    unread: rooms.filter(roomHasUnread).length,
    groups: rooms.filter((room) => room.type === "group").length,
    favourite: rooms.filter((room) => room.favourite).length,
  };
}

export function formatChatTimestamp(iso: string, now = Date.now()): string {
  const date = new Date(iso);
  const diffMs = now - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);
  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return date.toLocaleDateString(undefined, { weekday: "short" });
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatMessageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function presenceLabel(presence: InternalChatMember["presence"]): string {
  if (presence === "offline") return "Offline";
  return "Online";
}

export function presenceDotClass(presence: InternalChatMember["presence"]): string {
  if (presence === "offline") return "bg-neutral-300";
  return "bg-emerald-500";
}
