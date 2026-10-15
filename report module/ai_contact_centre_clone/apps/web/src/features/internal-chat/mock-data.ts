import type { AuthUser } from "@/types/auth";

import type { InternalChatMember, InternalChatMessage, InternalChatRoom, InternalChatState } from "./types";

const MOCK_ADMIN_ID = "user-admin-sarah";
const MOCK_AGENT_IDS = {
  james: "user-agent-james",
  priya: "user-agent-priya",
  marcus: "user-agent-marcus",
  elena: "user-agent-elena",
} as const;

export const MOCK_INTERNAL_CHAT_MEMBERS: InternalChatMember[] = [
  {
    userId: MOCK_ADMIN_ID,
    name: "Sarah Chen",
    role: "admin",
    title: "Contact Center Manager",
    presence: "ready",
  },
  {
    userId: MOCK_AGENT_IDS.james,
    name: "James Park",
    role: "member",
    title: "Senior Agent",
    presence: "ready",
  },
  {
    userId: MOCK_AGENT_IDS.priya,
    name: "Priya Patel",
    role: "member",
    title: "Agent",
    presence: "not_ready",
  },
  {
    userId: MOCK_AGENT_IDS.marcus,
    name: "Marcus Webb",
    role: "member",
    title: "Agent",
    presence: "offline",
  },
  {
    userId: MOCK_AGENT_IDS.elena,
    name: "Elena Ross",
    role: "member",
    title: "Team Lead",
    presence: "ready",
  },
];

const ROOM_FLOOR = "room-floor-supervisors";
const ROOM_HANDOVER = "room-shift-handover";
const ROOM_DM_ADMIN_JAMES = "room-dm-admin-james";

const MOCK_ROOMS: InternalChatRoom[] = [
  {
    id: ROOM_FLOOR,
    type: "group",
    name: "Floor Supervisors",
    memberIds: [
      MOCK_ADMIN_ID,
      MOCK_AGENT_IDS.james,
      MOCK_AGENT_IDS.priya,
      MOCK_AGENT_IDS.marcus,
      MOCK_AGENT_IDS.elena,
    ],
    createdByUserId: MOCK_ADMIN_ID,
    createdAt: "2026-08-20T09:00:00.000Z",
    lastMessageAt: "2026-08-25T16:42:00.000Z",
    lastMessagePreview: "Can someone cover queue 2 at 6 PM?",
    lastReadAt: "2026-08-25T16:30:00.000Z",
    favourite: true,
  },
  {
    id: ROOM_HANDOVER,
    type: "group",
    name: "Shift Handover",
    memberIds: [MOCK_ADMIN_ID, MOCK_AGENT_IDS.james, MOCK_AGENT_IDS.elena],
    createdByUserId: MOCK_ADMIN_ID,
    createdAt: "2026-08-22T14:00:00.000Z",
    lastMessageAt: "2026-08-25T15:10:00.000Z",
    lastMessagePreview: "Escalations from webchat are trending up.",
    lastReadAt: "2026-08-25T15:10:00.000Z",
  },
  {
    id: ROOM_DM_ADMIN_JAMES,
    type: "dm",
    name: "James Park",
    memberIds: [MOCK_ADMIN_ID, MOCK_AGENT_IDS.james],
    createdByUserId: MOCK_ADMIN_ID,
    createdAt: "2026-08-21T11:00:00.000Z",
    lastMessageAt: "2026-08-25T14:05:00.000Z",
    lastMessagePreview: "Thanks — I'll take the callback.",
    lastReadAt: "2026-08-25T14:05:00.000Z",
    favourite: true,
  },
];

const MOCK_MESSAGES: InternalChatMessage[] = [
  {
    id: "msg-1",
    roomId: ROOM_FLOOR,
    senderUserId: MOCK_ADMIN_ID,
    body: "Good morning team. Please review today's staffing sheet before 10 AM.",
    createdAt: "2026-08-25T08:15:00.000Z",
  },
  {
    id: "msg-2",
    roomId: ROOM_FLOOR,
    senderUserId: MOCK_AGENT_IDS.elena,
    body: "On it. Queue 1 is fully staffed; queue 2 may need backup after lunch.",
    createdAt: "2026-08-25T08:22:00.000Z",
  },
  {
    id: "msg-3",
    roomId: ROOM_FLOOR,
    senderUserId: MOCK_AGENT_IDS.james,
    body: "I can cover queue 2 from 1–4 PM if needed.",
    createdAt: "2026-08-25T08:28:00.000Z",
  },
  {
    id: "msg-4",
    roomId: ROOM_FLOOR,
    senderUserId: MOCK_ADMIN_ID,
    body: "Can someone cover queue 2 at 6 PM?",
    createdAt: "2026-08-25T16:42:00.000Z",
  },
  {
    id: "msg-5",
    roomId: ROOM_HANDOVER,
    senderUserId: MOCK_AGENT_IDS.elena,
    body: "Morning handover: 3 open escalations, 2 callbacks due before noon.",
    createdAt: "2026-08-25T07:55:00.000Z",
  },
  {
    id: "msg-6",
    roomId: ROOM_HANDOVER,
    senderUserId: MOCK_ADMIN_ID,
    body: "Escalations from webchat are trending up.",
    createdAt: "2026-08-25T15:10:00.000Z",
  },
  {
    id: "msg-7",
    roomId: ROOM_DM_ADMIN_JAMES,
    senderUserId: MOCK_ADMIN_ID,
    body: "James — can you pick up the VIP callback on queue Sales?",
    createdAt: "2026-08-25T13:58:00.000Z",
  },
  {
    id: "msg-8",
    roomId: ROOM_DM_ADMIN_JAMES,
    senderUserId: MOCK_AGENT_IDS.james,
    body: "Thanks — I'll take the callback.",
    createdAt: "2026-08-25T14:05:00.000Z",
  },
];

function resolveMockCurrentUserId(user: AuthUser): string {
  if (user.role === "admin") return MOCK_ADMIN_ID;
  return MOCK_AGENT_IDS.james;
}

function withCurrentUserOverlay(members: InternalChatMember[], user: AuthUser): InternalChatMember[] {
  const currentUserId = resolveMockCurrentUserId(user);
  return members.map((member) =>
    member.userId === currentUserId
      ? {
          ...member,
          name: user.name || member.name,
          role: user.role === "admin" ? "admin" : "member",
        }
      : member,
  );
}

function roomsForUser(userId: string, rooms: InternalChatRoom[]): InternalChatRoom[] {
  return rooms.filter((room) => room.memberIds.includes(userId));
}

export function createMockInternalChatState(user: AuthUser): InternalChatState {
  const currentUserId = resolveMockCurrentUserId(user);
  const members = withCurrentUserOverlay(MOCK_INTERNAL_CHAT_MEMBERS, user);
  const rooms = roomsForUser(currentUserId, MOCK_ROOMS);
  const roomIds = new Set(rooms.map((room) => room.id));
  const messages = MOCK_MESSAGES.filter((message) => roomIds.has(message.roomId));

  return {
    members,
    rooms,
    messages,
    currentUserId,
  };
}

export function listAssignableAgents(members: InternalChatMember[], currentUserId: string) {
  return members.filter((member) => member.role === "member" && member.userId !== currentUserId);
}
