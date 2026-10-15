function roomSegment(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required for a tenant-scoped Socket.IO room`);
  }
  return encodeURIComponent(normalized);
}

export function organizationRoom(organizationId: string): string {
  return `org:${roomSegment(organizationId, "organizationId")}`;
}

export function userRoom(organizationId: string, userId: string): string {
  return `${organizationRoom(organizationId)}:user:${roomSegment(userId, "userId")}`;
}

export function conversationRoom(organizationId: string, conversationId: string): string {
  return `${organizationRoom(organizationId)}:conversation:${roomSegment(
    conversationId,
    "conversationId",
  )}`;
}

export function internalChatRoom(organizationId: string, roomId: string): string {
  return `${organizationRoom(organizationId)}:internal-chat:${roomSegment(roomId, "roomId")}`;
}
