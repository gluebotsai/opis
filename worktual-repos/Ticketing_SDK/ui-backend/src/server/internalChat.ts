/**
 * Staff Internal Chat — org-scoped DMs + groups. Isolated from coworker / portal.
 */
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { Response } from "express";
import { query } from "./db";
import { listAssignableAgents } from "./accountsSync";
import { listTicketingTeams } from "./ticketingTeams";

export const GROUP_CATEGORIES = [
  "Supervision",
  "Shift handover",
  "Escalations",
  "Training",
  "General",
] as const;

export const PRESENCE_ONLINE_MS = 45_000;
const TEXT_MAX = 20_000;
const PREVIEW_MAX = 180;

const STAFF_ROLES = new Set(["admin", "agent", "resolver"]);

export class InternalChatError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function internalChatUploadRoot(): string {
  return (
    String(process.env.INTERNAL_CHAT_NFS_PATH || "").trim() ||
    String(process.env.INTERNAL_CHAT_UPLOAD_ROOT || "").trim() ||
    path.join(process.cwd(), "uploads", "internal-chat")
  );
}

export function assertSafeStorageKey(key: string): string {
  const trimmed = String(key || "").trim();
  if (!trimmed || trimmed.includes("..") || trimmed.startsWith("/") || trimmed.includes("\\")) {
    throw new InternalChatError(400, "Invalid storage key.");
  }
  return trimmed;
}

const IMAGE_EXT_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  heic: "image/heic",
  heif: "image/heif",
};

/** Linux screenshots often upload as octet-stream; infer from the file name. */
export function inferAttachmentContentType(
  fileName: string,
  rawType?: string | null
): string {
  const given = String(rawType || "").trim().toLowerCase();
  if (given.startsWith("image/")) return given;
  const ext = path.extname(String(fileName || "")).replace(".", "").toLowerCase();
  if (IMAGE_EXT_TYPE[ext]) return IMAGE_EXT_TYPE[ext];
  return given || "application/octet-stream";
}

export function safeFileName(name: string): string {
  return String(name || "file")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 180) || "file";
}

export function buildStorageKey(orgId: string, roomId: string, fileName: string): string {
  return `${orgId}/${roomId}/${randomUUID()}/${safeFileName(fileName)}`;
}

type SseClient = { res: Response };
const sseByOrg = new Map<string, Set<SseClient>>();

export function addInternalChatSseClient(orgId: string, res: Response): () => void {
  const key = String(orgId);
  let set = sseByOrg.get(key);
  if (!set) {
    set = new Set();
    sseByOrg.set(key, set);
  }
  const client: SseClient = { res };
  set.add(client);
  return () => {
    set!.delete(client);
    if (!set!.size) sseByOrg.delete(key);
  };
}

export function emitInternalChat(
  orgId: string,
  event: string,
  payload: unknown
): void {
  const set = sseByOrg.get(String(orgId));
  if (!set) return;
  const chunk = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const { res } of set) {
    try {
      res.write(chunk);
    } catch {
      /* closed */
    }
  }
}

function isStaffRole(role: string | undefined | null): boolean {
  return STAFF_ROLES.has(String(role || "").trim().toLowerCase());
}

function isOrgChatAdmin(role: string | undefined | null): boolean {
  return String(role || "").trim().toLowerCase() === "admin";
}

async function canAdminAllGroups(
  orgId: string,
  userId: string,
  actorRole?: string
): Promise<boolean> {
  if (isOrgChatAdmin(actorRole)) return true;
  const staff = await staffById(orgId);
  return isOrgChatAdmin(staff.get(userId)?.role);
}

function orgAdminIdsFromStaff(
  staff: Map<string, { id: string; name: string; email: string; role: string }>
): string[] {
  return [...staff.values()].filter((user) => isOrgChatAdmin(user.role)).map((user) => user.id);
}

function isOnline(lastSeen: Date | string | null | undefined): boolean {
  if (!lastSeen) return false;
  const t = lastSeen instanceof Date ? lastSeen.getTime() : Date.parse(String(lastSeen));
  if (!Number.isFinite(t)) return false;
  return Date.now() - t <= PRESENCE_ONLINE_MS;
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

export async function heartbeatPresence(orgId: string, userId: string): Promise<void> {
  await query(
    `INSERT INTO internal_chat_presence (organization_id, user_id, last_seen_at)
     VALUES ($1::bigint, $2::bigint, NOW())
     ON CONFLICT (organization_id, user_id)
     DO UPDATE SET last_seen_at = NOW()`,
    [orgId, userId]
  );
}

async function staffById(
  orgId: string
): Promise<Map<string, { id: string; name: string; email: string; role: string }>> {
  const agents = await listAssignableAgents(orgId);
  const map = new Map<string, { id: string; name: string; email: string; role: string }>();
  for (const a of agents) {
    if (!isStaffRole(a.role)) continue;
    map.set(a.id, {
      id: a.id,
      name: a.name || a.email,
      email: a.email,
      role: String(a.role || "").toLowerCase(),
    });
  }
  return map;
}

async function firstTeamNames(orgId: string): Promise<Map<string, string>> {
  const { rows } = await query<{ user_id: string; queue_name: string }>(
    `SELECT DISTINCT ON (m.user_id)
            m.user_id::text AS user_id,
            q.queue_name
     FROM agent_queue_members m
     JOIN agent_queues q ON q.id = m.queue_id
     WHERE m.organization_id = $1::bigint
     ORDER BY m.user_id, m.created_at ASC`,
    [orgId]
  );
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.queue_name) map.set(String(row.user_id), String(row.queue_name));
  }
  return map;
}

async function presenceMap(orgId: string): Promise<Map<string, Date>> {
  const { rows } = await query<{ user_id: string; last_seen_at: Date }>(
    `SELECT user_id::text AS user_id, last_seen_at
     FROM internal_chat_presence
     WHERE organization_id = $1::bigint`,
    [orgId]
  );
  const map = new Map<string, Date>();
  for (const row of rows) map.set(String(row.user_id), row.last_seen_at);
  return map;
}

export type DirectoryUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  teamName: string;
  online: boolean;
};

export async function listDirectory(
  orgId: string,
  actorId: string,
  forGroup = false
): Promise<DirectoryUser[]> {
  const [staff, teams, presence] = await Promise.all([
    staffById(orgId),
    firstTeamNames(orgId),
    presenceMap(orgId),
  ]);
  const out: DirectoryUser[] = [];
  for (const user of staff.values()) {
    if (user.id === actorId) continue;
    if (forGroup && !isStaffRole(user.role)) continue;
    out.push({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      teamName: teams.get(user.id) || "",
      online: isOnline(presence.get(user.id)),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export async function getMe(orgId: string, userId: string, role: string, name: string) {
  const teams = await firstTeamNames(orgId);
  return {
    id: userId,
    name,
    role,
    teamName: teams.get(userId) || "",
    online: true,
  };
}

function previewFromMessage(row: {
  body?: string | null;
  type?: string | null;
  file_names?: string | null;
}): string {
  const type = String(row.type || "text");
  if (type === "voice") return "🎤 Voice message";
  const body = String(row.body || "").trim();
  if (body) return body.slice(0, PREVIEW_MAX);
  const names = String(row.file_names || "").trim();
  return names || "";
}

type RoomRow = {
  id: string;
  type: string;
  name: string;
  description: string;
  category: string | null;
  avatar_key: string | null;
  created_by_id: string | null;
  team_id: string | null;
  updated_at: Date;
  room_role: string | null;
  favourite: boolean | null;
  last_read_at: Date | null;
  last_preview: string | null;
  last_message_at: Date | null;
  last_sender_id: string | null;
  last_type: string | null;
  unread: string | number;
};

async function loadRoomRows(
  orgId: string,
  userId: string,
  includeAllGroups: boolean
): Promise<RoomRow[]> {
  const { rows } = await query<RoomRow>(
    `SELECT r.id::text,
            r.type,
            r.name,
            r.description,
            r.category,
            r.avatar_key,
            r.created_by_id::text,
            r.team_id::text,
            r.updated_at,
            m.room_role,
            m.favourite,
            m.last_read_at,
            lm.body AS last_preview,
            lm.created_at AS last_message_at,
            lm.sender_id::text AS last_sender_id,
            lm.type AS last_type,
            (
              SELECT COALESCE(string_agg(a.file_name, ', '), '')
              FROM internal_chat_message_attachments a
              WHERE a.message_id = lm.id
            ) AS file_names,
            CASE
              WHEN m.user_id IS NULL THEN 0
              ELSE (
                SELECT COUNT(*)::int
                FROM internal_chat_messages msg
                WHERE msg.room_id = r.id
                  AND msg.deleted_at IS NULL
                  AND msg.sender_id <> $2::bigint
                  AND (m.last_read_at IS NULL OR msg.created_at > m.last_read_at)
              )
            END AS unread
     FROM internal_chat_rooms r
     LEFT JOIN internal_chat_room_members m
       ON m.room_id = r.id
      AND m.user_id = $2::bigint
      AND m.left_at IS NULL
     LEFT JOIN LATERAL (
       SELECT id, body, created_at, sender_id, type
       FROM internal_chat_messages
       WHERE room_id = r.id AND deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1
     ) lm ON TRUE
     WHERE r.organization_id = $1::bigint
       AND (
         m.user_id IS NOT NULL
         OR ($3::boolean AND r.type = 'group')
       )
     ORDER BY r.updated_at DESC`,
    [orgId, userId, includeAllGroups]
  );
  return rows;
}

async function loadMembersForRooms(
  orgId: string,
  roomIds: string[]
): Promise<Map<string, RoomMember[]>> {
  const map = new Map<string, RoomMember[]>();
  if (!roomIds.length) return map;
  const { rows } = await query<{
    room_id: string;
    user_id: string;
    room_role: string;
    last_read_at: Date | null;
    favourite: boolean;
    email: string | null;
    typing_at: Date | null;
  }>(
    `SELECT m.room_id::text,
            m.user_id::text,
            m.room_role,
            m.last_read_at,
            m.favourite,
            m.typing_at
     FROM internal_chat_room_members m
     WHERE m.organization_id = $1::bigint
       AND m.left_at IS NULL
       AND m.room_id = ANY($2::bigint[])`,
    [orgId, roomIds]
  );
  const staff = await staffById(orgId);
  for (const row of rows) {
    const user = staff.get(String(row.user_id));
    const member: RoomMember = {
      id: String(row.user_id),
      name: user?.name || "Staff",
      email: user?.email || "",
      role: user?.role || "agent",
      roomRole: row.room_role === "admin" ? "admin" : "member",
      lastReadAt: iso(row.last_read_at),
      favourite: Boolean(row.favourite),
      online: false,
      typingAt: iso(row.typing_at),
    };
    const list = map.get(String(row.room_id)) || [];
    list.push(member);
    map.set(String(row.room_id), list);
  }
  return map;
}

export type RoomMember = {
  id: string;
  name: string;
  email: string;
  role: string;
  roomRole: "admin" | "member";
  lastReadAt: string | null;
  favourite: boolean;
  online: boolean;
  typingAt: string | null;
};

export type RoomJson = {
  id: string;
  type: "dm" | "group";
  name: string;
  description: string;
  category: string | null;
  avatarKey: string | null;
  avatarUrl: string | null;
  createdById: string | null;
  updatedAt: string;
  roomRole: "admin" | "member";
  favourite: boolean;
  lastPreview: string;
  lastMessageAt: string | null;
  unread: number;
  members: RoomMember[];
  peerId?: string;
  peerOnline?: boolean;
};

function mapRoom(
  row: RoomRow & { file_names?: string | null },
  members: RoomMember[],
  actorId: string,
  presence: Map<string, Date>,
  orgAdminOverlay: boolean
): RoomJson {
  const type = row.type === "dm" ? "dm" : "group";
  let name = String(row.name || "");
  let peerId: string | undefined;
  let peerOnline: boolean | undefined;
  if (type === "dm") {
    const peer = members.find((m) => m.id !== actorId) || members[0];
    name = peer?.name || "Direct message";
    peerId = peer?.id;
    peerOnline = peer ? isOnline(presence.get(peer.id)) : false;
  }
  const unreadCount = Number(row.unread || 0);
  const lastAt = iso(row.last_message_at);
  let unread = unreadCount;
  if (
    !unread &&
    row.last_sender_id &&
    row.last_sender_id !== actorId &&
    (!row.last_read_at ||
      (row.last_message_at &&
        new Date(row.last_message_at).getTime() > new Date(row.last_read_at).getTime()))
  ) {
    unread = 1;
  }
  return {
    id: String(row.id),
    type,
    name,
    description: String(row.description || ""),
    category: row.category || null,
    avatarKey: row.avatar_key || null,
    avatarUrl:
      type === "group" && row.avatar_key
        ? `/api/internal-chat/room-avatars/${row.id}`
        : null,
    createdById: row.created_by_id,
    updatedAt: iso(row.updated_at) || new Date().toISOString(),
    roomRole:
      row.room_role === "admin" || (orgAdminOverlay && !row.room_role) ? "admin" : "member",
    favourite: Boolean(row.favourite),
    lastPreview: previewFromMessage({
      body: row.last_preview,
      type: row.last_type,
      file_names: row.file_names,
    }),
    lastMessageAt: lastAt,
    unread,
    members: members.map((member) => ({
      ...member,
      online: isOnline(presence.get(member.id)),
    })),
    ...(type === "dm" ? { peerId, peerOnline } : {}),
  };
}

export async function listRooms(
  orgId: string,
  userId: string,
  actorRole?: string
): Promise<RoomJson[]> {
  await ensureTypingColumn();
  const includeAllGroups = await canAdminAllGroups(orgId, userId, actorRole);
  const rows = await loadRoomRows(orgId, userId, includeAllGroups);
  const memberMap = await loadMembersForRooms(
    orgId,
    rows.map((r) => String(r.id))
  );
  const presence = await presenceMap(orgId);
  return rows.map((row) =>
    mapRoom(row, memberMap.get(String(row.id)) || [], userId, presence, includeAllGroups)
  );
}

export async function getRoom(
  orgId: string,
  userId: string,
  roomId: string,
  actorRole?: string
): Promise<RoomJson | null> {
  const rooms = await listRooms(orgId, userId, actorRole);
  return rooms.find((r) => r.id === roomId) || null;
}

export async function unreadTotal(
  orgId: string,
  userId: string,
  actorRole?: string
): Promise<number> {
  const rooms = await listRooms(orgId, userId, actorRole);
  return rooms.reduce((sum, room) => sum + (room.unread || 0), 0);
}

export async function requireActiveMember(
  orgId: string,
  roomId: string,
  userId: string,
  actorRole?: string
): Promise<{ roomRole: string; type: string; createdById: string | null }> {
  const { rows } = await query<{
    room_role: string;
    type: string;
    created_by_id: string | null;
  }>(
    `SELECT m.room_role, r.type, r.created_by_id::text
     FROM internal_chat_room_members m
     JOIN internal_chat_rooms r ON r.id = m.room_id
     WHERE m.organization_id = $1::bigint
       AND m.room_id = $2::bigint
       AND m.user_id = $3::bigint
       AND m.left_at IS NULL`,
    [orgId, roomId, userId]
  );
  if (rows[0]) {
    return {
      roomRole: rows[0].room_role,
      type: rows[0].type,
      createdById: rows[0].created_by_id,
    };
  }
  const room = await query<{ type: string; created_by_id: string | null }>(
    `SELECT type, created_by_id::text
     FROM internal_chat_rooms
     WHERE organization_id = $1::bigint AND id = $2::bigint`,
    [orgId, roomId]
  );
  if (room.rows[0]?.type === "group" && (await canAdminAllGroups(orgId, userId, actorRole))) {
    await query(
      `INSERT INTO internal_chat_room_members (organization_id, room_id, user_id, room_role, left_at)
       VALUES ($1::bigint, $2::bigint, $3::bigint, 'admin', NULL)
       ON CONFLICT (room_id, user_id)
       DO UPDATE SET left_at = NULL, room_role = 'admin'`,
      [orgId, roomId, userId]
    );
    return {
      roomRole: "admin",
      type: "group",
      createdById: room.rows[0].created_by_id,
    };
  }
  throw new InternalChatError(403, "Not a member of this conversation.");
}

export async function openDm(
  orgId: string,
  actorId: string,
  targetUserId: string
): Promise<{ roomId: string; room: RoomJson }> {
  const target = String(targetUserId || "").trim();
  if (!target || target === actorId) {
    throw new InternalChatError(400, "Cannot start a chat with yourself.");
  }
  const staff = await staffById(orgId);
  if (!staff.has(target)) {
    throw new InternalChatError(400, "That teammate is not on the staff directory.");
  }
  const [low, high] =
    Number(actorId) < Number(target) ? [actorId, target] : [target, actorId];
  const existing = await query<{ room_id: string }>(
    `SELECT room_id::text
     FROM internal_chat_dm_pairs
     WHERE organization_id = $1::bigint
       AND user_low_id = $2::bigint
       AND user_high_id = $3::bigint`,
    [orgId, low, high]
  );
  if (existing.rows[0]) {
    const room = await getRoom(orgId, actorId, existing.rows[0].room_id);
    if (room) return { roomId: room.id, room };
  }

  const created = await query<{ id: string }>(
    `INSERT INTO internal_chat_rooms (organization_id, type, name, created_by_id)
     VALUES ($1::bigint, 'dm', '', $2::bigint)
     RETURNING id::text`,
    [orgId, actorId]
  );
  const roomId = created.rows[0].id;
  await query(
    `INSERT INTO internal_chat_room_members (organization_id, room_id, user_id, room_role)
     VALUES ($1::bigint, $2::bigint, $3::bigint, 'member'),
            ($1::bigint, $2::bigint, $4::bigint, 'member')
     ON CONFLICT (room_id, user_id) DO UPDATE SET left_at = NULL`,
    [orgId, roomId, actorId, target]
  );
  try {
    await query(
      `INSERT INTO internal_chat_dm_pairs (organization_id, user_low_id, user_high_id, room_id)
       VALUES ($1::bigint, $2::bigint, $3::bigint, $4::bigint)`,
      [orgId, low, high, roomId]
    );
  } catch {
    const winner = await query<{ room_id: string }>(
      `SELECT room_id::text
       FROM internal_chat_dm_pairs
       WHERE organization_id = $1::bigint
         AND user_low_id = $2::bigint
         AND user_high_id = $3::bigint`,
      [orgId, low, high]
    );
    await query(`DELETE FROM internal_chat_rooms WHERE id = $1::bigint`, [roomId]);
    const winId = winner.rows[0]?.room_id;
    if (!winId) throw new InternalChatError(500, "Could not open chat.");
    const room = await getRoom(orgId, actorId, winId);
    if (!room) throw new InternalChatError(500, "Could not open chat.");
    return { roomId: room.id, room };
  }
  emitInternalChat(orgId, "internal_chat.room.updated", { roomId });
  const room = await getRoom(orgId, actorId, roomId);
  if (!room) throw new InternalChatError(500, "Could not open chat.");
  return { roomId: room.id, room };
}

export async function createGroup(
  orgId: string,
  actorId: string,
  actorRole: string,
  input: {
    name?: string;
    description?: string;
    category?: string;
    memberIds?: string[];
    avatarStorageKey?: string;
  }
): Promise<RoomJson> {
  if (String(actorRole || "").toLowerCase() !== "admin") {
    throw new InternalChatError(403, "Only admins can create groups.");
  }
  const name = String(input.name || "").trim();
  const description = String(input.description || "").trim();
  const category = String(input.category || "").trim();
  if (!name) throw new InternalChatError(400, "Group name is required.");
  if (description.length < 10) {
    throw new InternalChatError(400, "Description must be at least 10 characters.");
  }
  if (!GROUP_CATEGORIES.includes(category as (typeof GROUP_CATEGORIES)[number])) {
    throw new InternalChatError(400, "Pick a valid category.");
  }
  const staff = await staffById(orgId);
  const others = [...new Set((input.memberIds || []).map((id) => String(id).trim()))].filter(
    (id) => id && id !== actorId
  );
  if (!others.length) {
    throw new InternalChatError(400, "Add at least one teammate besides yourself.");
  }
  for (const id of others) {
    if (!staff.has(id)) throw new InternalChatError(400, "Members must be staff.");
  }
  const avatarKey = input.avatarStorageKey
    ? assertSafeStorageKey(input.avatarStorageKey)
    : null;
  const created = await query<{ id: string }>(
    `INSERT INTO internal_chat_rooms
       (organization_id, type, name, description, category, avatar_key, created_by_id)
     VALUES ($1::bigint, 'group', $2, $3, $4, $5, $6::bigint)
     RETURNING id::text`,
    [orgId, name, description, category, avatarKey, actorId]
  );
  const roomId = created.rows[0].id;
  await query(
    `INSERT INTO internal_chat_room_members (organization_id, room_id, user_id, room_role)
     VALUES ($1::bigint, $2::bigint, $3::bigint, 'admin')`,
    [orgId, roomId, actorId]
  );
  for (const id of others) {
    await query(
      `INSERT INTO internal_chat_room_members (organization_id, room_id, user_id, room_role)
       VALUES ($1::bigint, $2::bigint, $3::bigint, 'member')
       ON CONFLICT (room_id, user_id) DO UPDATE SET left_at = NULL, room_role = EXCLUDED.room_role`,
      [orgId, roomId, id]
    );
  }
  emitInternalChat(orgId, "internal_chat.room.updated", { roomId });
  const room = await getRoom(orgId, actorId, roomId);
  if (!room) throw new InternalChatError(500, "Could not create group.");
  return room;
}

export async function patchGroup(
  orgId: string,
  actorId: string,
  roomId: string,
  input: {
    name?: string;
    description?: string;
    category?: string;
    avatarStorageKey?: string | null;
  },
  actorRole?: string
): Promise<RoomJson> {
  const membership = await requireActiveMember(orgId, roomId, actorId, actorRole);
  if (membership.type !== "group" || membership.roomRole !== "admin") {
    throw new InternalChatError(403, "Only the group admin can edit this group.");
  }
  const sets: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [orgId, roomId];
  if (input.name !== undefined) {
    const name = String(input.name || "").trim();
    if (!name) throw new InternalChatError(400, "Group name is required.");
    params.push(name);
    sets.push(`name = $${params.length}`);
  }
  if (input.description !== undefined) {
    const description = String(input.description || "").trim();
    if (description.length < 10) {
      throw new InternalChatError(400, "Description must be at least 10 characters.");
    }
    params.push(description);
    sets.push(`description = $${params.length}`);
  }
  if (input.category !== undefined) {
    const category = String(input.category || "").trim();
    if (!GROUP_CATEGORIES.includes(category as (typeof GROUP_CATEGORIES)[number])) {
      throw new InternalChatError(400, "Pick a valid category.");
    }
    params.push(category);
    sets.push(`category = $${params.length}`);
  }
  if (input.avatarStorageKey !== undefined) {
    const key = input.avatarStorageKey
      ? assertSafeStorageKey(input.avatarStorageKey)
      : null;
    params.push(key);
    sets.push(`avatar_key = $${params.length}`);
  }
  await query(
    `UPDATE internal_chat_rooms SET ${sets.join(", ")}
     WHERE organization_id = $1::bigint AND id = $2::bigint`,
    params
  );
  emitInternalChat(orgId, "internal_chat.room.updated", { roomId });
  const room = await getRoom(orgId, actorId, roomId, actorRole);
  if (!room) throw new InternalChatError(404, "Room not found.");
  return room;
}

export async function replaceMembers(
  orgId: string,
  actorId: string,
  roomId: string,
  memberIds: string[],
  actorRole?: string
): Promise<RoomJson> {
  const membership = await requireActiveMember(orgId, roomId, actorId, actorRole);
  if (membership.type !== "group" || membership.roomRole !== "admin") {
    throw new InternalChatError(403, "Only the group admin can change members.");
  }
  const staff = await staffById(orgId);
  const keep = new Set<string>([
    actorId,
    membership.createdById || actorId,
    ...orgAdminIdsFromStaff(staff),
  ]);
  for (const raw of memberIds || []) {
    const id = String(raw || "").trim();
    if (!id) continue;
    if (!staff.has(id)) throw new InternalChatError(400, "Members must be staff.");
    keep.add(id);
  }
  const { rows: current } = await query<{ user_id: string }>(
    `SELECT user_id::text
     FROM internal_chat_room_members
     WHERE room_id = $1::bigint AND left_at IS NULL`,
    [roomId]
  );
  for (const row of current) {
    const id = String(row.user_id);
    if (!keep.has(id)) {
      await query(
        `UPDATE internal_chat_room_members
         SET left_at = NOW()
         WHERE room_id = $1::bigint AND user_id = $2::bigint AND left_at IS NULL`,
        [roomId, id]
      );
    }
  }
  for (const id of keep) {
    const role = id === actorId || id === membership.createdById ? "admin" : "member";
    await query(
      `INSERT INTO internal_chat_room_members (organization_id, room_id, user_id, room_role, left_at)
       VALUES ($1::bigint, $2::bigint, $3::bigint, $4, NULL)
       ON CONFLICT (room_id, user_id)
       DO UPDATE SET left_at = NULL, room_role = CASE
         WHEN internal_chat_room_members.room_role = 'admin' THEN 'admin'
         ELSE EXCLUDED.room_role
       END`,
      [orgId, roomId, id, role]
    );
  }
  await query(
    `UPDATE internal_chat_rooms SET updated_at = NOW() WHERE id = $1::bigint`,
    [roomId]
  );
  emitInternalChat(orgId, "internal_chat.room.updated", { roomId });
  const room = await getRoom(orgId, actorId, roomId, actorRole);
  if (!room) throw new InternalChatError(404, "Room not found.");
  return room;
}

export type TicketCard = { id: string; number: string; subject: string };

export type AttachmentJson = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  url: string;
};

export type ReplyToJson = {
  id: string;
  senderName: string;
  body: string;
};

export type MessageJson = {
  id: string;
  roomId: string;
  senderId: string;
  senderName: string;
  body: string;
  type: "text" | "attachment_bundle" | "voice";
  createdAt: string;
  editedAt: string | null;
  voiceDurationMs: number | null;
  voiceUrl: string | null;
  ticket: TicketCard | null;
  attachments: AttachmentJson[];
  replyToId: string | null;
  replyTo: ReplyToJson | null;
  pinnedAt: string | null;
};

const TICKET_TOKEN_RE = /#(\d+)\b|\bWT-?(\d+)\b|\b(\d{3,})\b/gi;

export function parseTicketMentions(body: string): string[] {
  const hits: string[] = [];
  const seen = new Set<string>();
  const re = new RegExp(TICKET_TOKEN_RE.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(body || ""))) {
    const digits = match[1] || match[2] || match[3];
    if (digits && !seen.has(digits)) {
      seen.add(digits);
      hits.push(digits);
    }
  }
  return hits;
}

export async function resolveTicket(
  orgId: string,
  body: string
): Promise<{ id: string; card: TicketCard } | null> {
  const mentions = parseTicketMentions(body);
  if (!mentions.length) return null;
  for (const digits of mentions) {
    const { rows } = await query<{
      id: string;
      ticket_number: string;
      subject: string;
    }>(
      `SELECT id::text, ticket_number, subject
       FROM tickets
       WHERE organization_id = $1::bigint
         AND (
           id::text = $2
           OR regexp_replace(ticket_number, '\\D', '', 'g') = $2
           OR ticket_number = ('#' || $2)
         )
       ORDER BY created_at DESC
       LIMIT 1`,
      [orgId, digits]
    );
    if (rows[0]) {
      const number = String(rows[0].ticket_number || `#${digits}`);
      return {
        id: rows[0].id,
        card: {
          id: rows[0].id,
          number: number.startsWith("#") ? number : `#${digits}`,
          subject: String(rows[0].subject || ""),
        },
      };
    }
  }
  return null;
}

type MessageRow = {
  id: string;
  room_id: string;
  sender_id: string;
  body: string;
  type: string;
  created_at: Date;
  edited_at: Date | null;
  voice_duration_ms: number | null;
  ticket_id: string | null;
  ticket_number: string | null;
  ticket_subject: string | null;
  reply_to_id?: string | null;
  reply_sender_id?: string | null;
  reply_body?: string | null;
  reply_type?: string | null;
  reply_deleted_at?: Date | null;
  pinned_at?: Date | null;
};

function parsePersistedId(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  if (!/^\d+$/.test(value)) return null;
  return value;
}

let replyColumnReady = false;

async function ensureReplyToColumn(): Promise<void> {
  if (replyColumnReady) return;
  await query(
    `ALTER TABLE internal_chat_messages
     ADD COLUMN IF NOT EXISTS reply_to_id BIGINT`
  );
  await query(
    `ALTER TABLE internal_chat_messages
     ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ`
  );
  replyColumnReady = true;
}

function replyPreview(type: string | null | undefined, body: string | null | undefined): string {
  const kind = String(type || "");
  const text = String(body || "").trim();
  if (kind === "voice") return text || "Voice note";
  if (kind === "attachment_bundle" && !text) return "Attachment";
  return text.slice(0, PREVIEW_MAX);
}

function replyToJson(
  staff: Map<string, { name: string }>,
  row: MessageRow
): ReplyToJson | null {
  const id = parsePersistedId(row.reply_to_id);
  if (!id) return null;
  if (row.reply_deleted_at || !row.reply_sender_id) {
    return { id, senderName: "Staff", body: "Original message was deleted" };
  }
  return {
    id,
    senderName: staff.get(row.reply_sender_id)?.name || "Staff",
    body: replyPreview(row.reply_type, row.reply_body),
  };
}

async function loadReplyParent(
  orgId: string,
  roomId: string,
  replyToId: string
): Promise<Pick<MessageRow, "reply_to_id" | "reply_sender_id" | "reply_body" | "reply_type" | "reply_deleted_at">> {
  const { rows } = await query<{
    id: string;
    sender_id: string;
    body: string;
    type: string;
    deleted_at: Date | null;
  }>(
    `SELECT id::text, sender_id::text, body, type, deleted_at
     FROM internal_chat_messages
     WHERE organization_id = $1::bigint
       AND room_id = $2::bigint
       AND id = $3::bigint`,
    [orgId, roomId, replyToId]
  );
  const parent = rows[0];
  if (!parent) throw new InternalChatError(400, "That message is not in this chat.");
  if (parent.deleted_at) throw new InternalChatError(400, "That message was deleted.");
  return {
    reply_to_id: parent.id,
    reply_sender_id: parent.sender_id,
    reply_body: parent.body,
    reply_type: parent.type,
    reply_deleted_at: parent.deleted_at,
  };
}

async function hydrateMessages(
  orgId: string,
  rows: MessageRow[]
): Promise<MessageJson[]> {
  const staff = await staffById(orgId);
  const ids = rows.map((r) => r.id);
  const attachments = new Map<string, AttachmentJson[]>();
  if (ids.length) {
    const { rows: att } = await query<{
      id: string;
      message_id: string;
      file_name: string;
      content_type: string;
      byte_size: string;
    }>(
      `SELECT id::text, message_id::text, file_name, content_type, byte_size::text
       FROM internal_chat_message_attachments
       WHERE message_id = ANY($1::bigint[])
       ORDER BY id`,
      [ids]
    );
    for (const row of att) {
      const list = attachments.get(row.message_id) || [];
      list.push({
        id: row.id,
        name: row.file_name,
        contentType: row.content_type,
        size: Number(row.byte_size || 0),
        url: `/api/internal-chat/files/${row.id}`,
      });
      attachments.set(row.message_id, list);
    }
  }
  return rows.map((row) => {
    const type = (["text", "attachment_bundle", "voice"].includes(row.type)
      ? row.type
      : "text") as MessageJson["type"];
    return {
      id: row.id,
      roomId: row.room_id,
      senderId: row.sender_id,
      senderName: staff.get(row.sender_id)?.name || "Staff",
      body: row.body || "",
      type,
      createdAt: iso(row.created_at) || new Date().toISOString(),
      editedAt: iso(row.edited_at),
      voiceDurationMs: row.voice_duration_ms,
      voiceUrl: type === "voice" ? `/api/internal-chat/messages/${row.id}/voice` : null,
      ticket:
        row.ticket_id && row.ticket_number
          ? {
              id: row.ticket_id,
              number: String(row.ticket_number),
              subject: String(row.ticket_subject || ""),
            }
          : null,
      attachments: attachments.get(row.id) || [],
      replyToId: parsePersistedId(row.reply_to_id),
      replyTo: replyToJson(staff, row),
      pinnedAt: iso(row.pinned_at),
    };
  });
}

export async function listMessages(
  orgId: string,
  userId: string,
  roomId: string,
  opts?: { before?: string; limit?: number; actorRole?: string }
): Promise<MessageJson[]> {
  await ensureReplyToColumn();
  await requireActiveMember(orgId, roomId, userId, opts?.actorRole);
  const limit = Math.min(100, Math.max(1, Number(opts?.limit || 50)));
  const before = opts?.before ? new Date(opts.before) : null;
  const params: unknown[] = [orgId, roomId];
  let extra = "";
  if (before && Number.isFinite(before.getTime())) {
    params.push(before.toISOString());
    extra = `AND m.created_at < $${params.length}::timestamptz`;
  }
  params.push(limit);
  const { rows } = await query<MessageRow>(
    `SELECT m.id::text, m.room_id::text, m.sender_id::text, m.body, m.type,
            m.created_at, m.edited_at, m.voice_duration_ms,
            m.ticket_id::text, t.ticket_number, t.subject AS ticket_subject,
            m.reply_to_id::text,
            p.sender_id::text AS reply_sender_id,
            p.body AS reply_body,
            p.type AS reply_type,
            p.deleted_at AS reply_deleted_at,
            m.pinned_at
     FROM internal_chat_messages m
     LEFT JOIN tickets t ON t.id = m.ticket_id
     LEFT JOIN internal_chat_messages p
       ON p.id = m.reply_to_id AND p.organization_id = m.organization_id
     WHERE m.organization_id = $1::bigint
       AND m.room_id = $2::bigint
       AND m.deleted_at IS NULL
       ${extra}
     ORDER BY m.created_at DESC
     LIMIT $${params.length}`,
    params
  );
  const chronological = rows.reverse();
  return hydrateMessages(orgId, chronological);
}

export async function postMessage(
  orgId: string,
  userId: string,
  roomId: string,
  input: {
    body?: string;
    type?: string;
    voiceKey?: string;
    voiceDurationMs?: number;
    attachments?: Array<{
      storageKey: string;
      fileName: string;
      contentType?: string;
      byteSize?: number;
    }>;
    replyToId?: string | null;
  },
  actorRole?: string
): Promise<MessageJson> {
  await ensureReplyToColumn();
  await requireActiveMember(orgId, roomId, userId, actorRole);
  const body = String(input.body || "").trim().slice(0, TEXT_MAX);
  const attachments = Array.isArray(input.attachments) ? input.attachments : [];
  const voiceKey = input.voiceKey ? assertSafeStorageKey(input.voiceKey) : "";
  const type =
    input.type === "voice" || voiceKey
      ? "voice"
      : attachments.length && !body
        ? "attachment_bundle"
        : "text";
  if (!body && !attachments.length && !voiceKey) {
    throw new InternalChatError(400, "Write a message or attach a file.");
  }
  const ticket = body ? await resolveTicket(orgId, body) : null;
  const replyToId = parsePersistedId(input.replyToId);
  if (input.replyToId != null && String(input.replyToId).trim() && !replyToId) {
    throw new InternalChatError(400, "Reply target is invalid.");
  }
  const parent = replyToId ? await loadReplyParent(orgId, roomId, replyToId) : null;
  const inserted = await query<MessageRow>(
    `INSERT INTO internal_chat_messages
       (organization_id, room_id, sender_id, body, type, ticket_id, voice_key, voice_duration_ms, reply_to_id)
     VALUES ($1::bigint, $2::bigint, $3::bigint, $4, $5, $6::bigint, $7, $8, $9::bigint)
     RETURNING id::text, room_id::text, sender_id::text, body, type, created_at, edited_at,
               voice_duration_ms, ticket_id::text,
               NULL::text AS ticket_number, NULL::text AS ticket_subject,
               reply_to_id::text`,
    [
      orgId,
      roomId,
      userId,
      body,
      type,
      ticket?.id || null,
      voiceKey || null,
      type === "voice" ? Number(input.voiceDurationMs || 0) || null : null,
      parent?.reply_to_id || null,
    ]
  );
  const row = inserted.rows[0];
  if (parent) {
    row.reply_sender_id = parent.reply_sender_id;
    row.reply_body = parent.reply_body;
    row.reply_type = parent.reply_type;
    row.reply_deleted_at = parent.reply_deleted_at;
  }
  for (const att of attachments) {
    await query(
      `INSERT INTO internal_chat_message_attachments
         (organization_id, message_id, storage_key, file_name, content_type, byte_size)
       VALUES ($1::bigint, $2::bigint, $3, $4, $5, $6)`,
      [
        orgId,
        row.id,
        assertSafeStorageKey(att.storageKey),
        String(att.fileName || "file").slice(0, 240),
        inferAttachmentContentType(
          String(att.fileName || "file"),
          att.contentType
        ),
        Number(att.byteSize || 0),
      ]
    );
  }
  await query(
    `UPDATE internal_chat_rooms SET updated_at = NOW() WHERE id = $1::bigint`,
    [roomId]
  );
  await query(
    `UPDATE internal_chat_room_members
     SET last_read_at = NOW()
     WHERE room_id = $1::bigint AND user_id = $2::bigint`,
    [roomId, userId]
  );
  if (ticket) {
    row.ticket_id = ticket.id;
    row.ticket_number = ticket.card.number;
    row.ticket_subject = ticket.card.subject;
  }
  const [message] = await hydrateMessages(orgId, [row]);
  emitInternalChat(orgId, "internal_chat.message.created", { roomId, message });
  return message;
}

export async function editMessage(
  orgId: string,
  userId: string,
  messageId: string,
  bodyRaw: string,
  actorRole?: string
): Promise<MessageJson> {
  const body = String(bodyRaw || "").trim().slice(0, TEXT_MAX);
  if (!body) throw new InternalChatError(400, "Message cannot be empty.");
  const { rows } = await query<{
    id: string;
    room_id: string;
    sender_id: string;
    type: string;
    deleted_at: Date | null;
  }>(
    `SELECT id::text, room_id::text, sender_id::text, type, deleted_at
     FROM internal_chat_messages
     WHERE organization_id = $1::bigint AND id = $2::bigint`,
    [orgId, messageId]
  );
  const row = rows[0];
  if (!row || row.deleted_at) throw new InternalChatError(404, "Message not found.");
  if (row.sender_id !== userId) throw new InternalChatError(403, "You can only edit your messages.");
  if (row.type !== "text") throw new InternalChatError(400, "Only text messages can be edited.");
  await requireActiveMember(orgId, row.room_id, userId, actorRole);
  const ticket = await resolveTicket(orgId, body);
  await query(
    `UPDATE internal_chat_messages
     SET body = $3, edited_at = NOW(), ticket_id = $4::bigint
     WHERE id = $1::bigint AND organization_id = $2::bigint`,
    [messageId, orgId, body, ticket?.id || null]
  );
  await query(
    `UPDATE internal_chat_rooms SET updated_at = NOW() WHERE id = $1::bigint`,
    [row.room_id]
  );
  const messages = await listMessages(orgId, userId, row.room_id, { limit: 50 });
  const message = messages.find((m) => m.id === messageId);
  if (!message) throw new InternalChatError(404, "Message not found.");
  emitInternalChat(orgId, "internal_chat.message.updated", {
    roomId: row.room_id,
    message,
  });
  return message;
}

export async function togglePinnedMessage(
  orgId: string,
  userId: string,
  messageId: string,
  actorRole?: string
): Promise<MessageJson> {
  await ensureReplyToColumn();
  const { rows } = await query<{
    id: string;
    room_id: string;
    deleted_at: Date | null;
    pinned_at: Date | null;
  }>(
    `SELECT id::text, room_id::text, deleted_at, pinned_at
     FROM internal_chat_messages
     WHERE organization_id = $1::bigint AND id = $2::bigint`,
    [orgId, messageId]
  );
  const row = rows[0];
  if (!row || row.deleted_at) throw new InternalChatError(404, "Message not found.");
  await requireActiveMember(orgId, row.room_id, userId, actorRole);
  if (!row.pinned_at) {
    const { rows: pinned } = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM internal_chat_messages
       WHERE organization_id = $1::bigint
         AND room_id = $2::bigint
         AND deleted_at IS NULL
         AND pinned_at IS NOT NULL`,
      [orgId, row.room_id]
    );
    if (Number(pinned[0]?.count || 0) >= 3) {
      throw new InternalChatError(400, "Unpin another message first. You can pin up to 3.");
    }
  }
  await query(
    `UPDATE internal_chat_messages
     SET pinned_at = CASE WHEN pinned_at IS NULL THEN NOW() ELSE NULL END
     WHERE id = $1::bigint AND organization_id = $2::bigint`,
    [messageId, orgId]
  );
  const messages = await listMessages(orgId, userId, row.room_id, { limit: 50 });
  const message = messages.find((m) => m.id === messageId);
  if (!message) throw new InternalChatError(404, "Message not found.");
  emitInternalChat(orgId, "internal_chat.message.updated", {
    roomId: row.room_id,
    message,
  });
  return message;
}

export async function deleteMessage(
  orgId: string,
  userId: string,
  messageId: string,
  actorRole?: string
): Promise<{ roomId: string; messageId: string }> {
  const { rows } = await query<{
    id: string;
    room_id: string;
    sender_id: string;
    deleted_at: Date | null;
  }>(
    `SELECT id::text, room_id::text, sender_id::text, deleted_at
     FROM internal_chat_messages
     WHERE organization_id = $1::bigint AND id = $2::bigint`,
    [orgId, messageId]
  );
  const row = rows[0];
  if (!row || row.deleted_at) throw new InternalChatError(404, "Message not found.");
  if (row.sender_id !== userId) {
    throw new InternalChatError(403, "You can only delete your messages.");
  }
  await requireActiveMember(orgId, row.room_id, userId, actorRole);
  await query(
    `UPDATE internal_chat_messages SET deleted_at = NOW()
     WHERE id = $1::bigint AND organization_id = $2::bigint`,
    [messageId, orgId]
  );
  await query(
    `UPDATE internal_chat_rooms SET updated_at = NOW() WHERE id = $1::bigint`,
    [row.room_id]
  );
  emitInternalChat(orgId, "internal_chat.message.deleted", {
    roomId: row.room_id,
    messageId,
  });
  return { roomId: row.room_id, messageId };
}

export async function markRead(
  orgId: string,
  userId: string,
  roomId: string,
  actorRole?: string
): Promise<void> {
  await ensureTypingColumn();
  await requireActiveMember(orgId, roomId, userId, actorRole);
  const { rows } = await query<{ last_read_at: Date }>(
    `UPDATE internal_chat_room_members
     SET last_read_at = NOW(), typing_at = NULL
     WHERE room_id = $1::bigint AND user_id = $2::bigint AND left_at IS NULL
     RETURNING last_read_at`,
    [roomId, userId]
  );
  emitInternalChat(orgId, "internal_chat.read", {
    roomId: String(roomId),
    userId: String(userId),
    lastReadAt: iso(rows[0]?.last_read_at) || new Date().toISOString(),
  });
}

let typingColumnReady = false;

async function ensureTypingColumn(): Promise<void> {
  if (typingColumnReady) return;
  await query(
    `ALTER TABLE internal_chat_room_members
     ADD COLUMN IF NOT EXISTS typing_at TIMESTAMPTZ`
  );
  typingColumnReady = true;
}

export async function setTyping(
  orgId: string,
  userId: string,
  roomId: string,
  typing: boolean,
  actorRole?: string
): Promise<void> {
  await ensureTypingColumn();
  await requireActiveMember(orgId, roomId, userId, actorRole);
  await query(
    typing
      ? `UPDATE internal_chat_room_members
         SET typing_at = NOW()
         WHERE room_id = $1::bigint AND user_id = $2::bigint AND left_at IS NULL`
      : `UPDATE internal_chat_room_members
         SET typing_at = NULL
         WHERE room_id = $1::bigint AND user_id = $2::bigint AND left_at IS NULL`,
    [roomId, userId]
  );
  const staff = await staffById(orgId);
  emitInternalChat(orgId, "internal_chat.typing", {
    roomId: String(roomId),
    userId: String(userId),
    userName: staff.get(String(userId))?.name || "Staff",
    typing: Boolean(typing),
  });
}

export async function toggleFavourite(
  orgId: string,
  userId: string,
  roomId: string,
  actorRole?: string
): Promise<{ favourite: boolean }> {
  await requireActiveMember(orgId, roomId, userId, actorRole);
  const { rows } = await query<{ favourite: boolean }>(
    `UPDATE internal_chat_room_members
     SET favourite = NOT favourite
     WHERE room_id = $1::bigint AND user_id = $2::bigint AND left_at IS NULL
     RETURNING favourite`,
    [roomId, userId]
  );
  return { favourite: Boolean(rows[0]?.favourite) };
}

export async function getAttachmentForMember(
  orgId: string,
  userId: string,
  attachmentId: string,
  actorRole?: string
): Promise<{ storageKey: string; fileName: string; contentType: string }> {
  const { rows } = await query<{
    storage_key: string;
    file_name: string;
    content_type: string;
    room_id: string;
  }>(
    `SELECT a.storage_key, a.file_name, a.content_type, m.room_id::text
     FROM internal_chat_message_attachments a
     JOIN internal_chat_messages m ON m.id = a.message_id
     WHERE a.organization_id = $1::bigint AND a.id = $2::bigint`,
    [orgId, attachmentId]
  );
  if (!rows[0]) throw new InternalChatError(404, "File not found.");
  await requireActiveMember(orgId, rows[0].room_id, userId, actorRole);
  return {
    storageKey: rows[0].storage_key,
    fileName: rows[0].file_name,
    contentType: rows[0].content_type,
  };
}

export async function getVoiceForMember(
  orgId: string,
  userId: string,
  messageId: string,
  actorRole?: string
): Promise<{ storageKey: string }> {
  const { rows } = await query<{ voice_key: string | null; room_id: string }>(
    `SELECT voice_key, room_id::text
     FROM internal_chat_messages
     WHERE organization_id = $1::bigint AND id = $2::bigint AND deleted_at IS NULL`,
    [orgId, messageId]
  );
  if (!rows[0]?.voice_key) throw new InternalChatError(404, "Voice note not found.");
  await requireActiveMember(orgId, rows[0].room_id, userId, actorRole);
  return { storageKey: rows[0].voice_key };
}

export async function getRoomAvatarForMember(
  orgId: string,
  userId: string,
  roomId: string,
  actorRole?: string
): Promise<{ storageKey: string }> {
  await requireActiveMember(orgId, roomId, userId, actorRole);
  const { rows } = await query<{ avatar_key: string | null }>(
    `SELECT avatar_key FROM internal_chat_rooms
     WHERE organization_id = $1::bigint AND id = $2::bigint`,
    [orgId, roomId]
  );
  if (!rows[0]?.avatar_key) throw new InternalChatError(404, "Photo not found.");
  return { storageKey: rows[0].avatar_key };
}

export function resolveUploadPath(storageKey: string): string {
  const key = assertSafeStorageKey(storageKey);
  return path.join(internalChatUploadRoot(), key);
}

export async function bootstrapInternalChat(
  orgId: string,
  userId: string,
  role: string,
  name: string
) {
  await heartbeatPresence(orgId, userId);
  const [me, directory, rooms] = await Promise.all([
    getMe(orgId, userId, role, name),
    listDirectory(orgId, userId, false),
    listRooms(orgId, userId, role),
  ]);
  const recentRooms = rooms.slice(0, 20);
  const recent: Record<string, MessageJson[]> = {};
  await Promise.all(
    recentRooms.map(async (room) => {
      recent[room.id] = await listMessages(orgId, userId, room.id, {
        limit: 50,
        actorRole: role,
      });
    })
  );
  return {
    me,
    directory,
    rooms,
    recent,
    unreadTotal: rooms.reduce((sum, room) => sum + (room.unread || 0), 0),
  };
}

export async function syncTeamChatGroup(input: {
  orgId: string;
  teamId: string;
  name: string;
  description: string;
  memberIds: string[];
  actorId?: string;
}): Promise<void> {
  const { orgId, teamId } = input;
  const name = String(input.name || "").trim() || "Team";
  const rawDesc = String(input.description || "").trim();
  const description = rawDesc.length >= 10 ? rawDesc : `Team channel for ${name}.`;
  const staff = await staffById(orgId);
  const members = [...new Set(input.memberIds.map((id) => String(id).trim()))].filter((id) =>
    staff.has(id)
  );
  const adminIds = orgAdminIdsFromStaff(staff);
  if (!members.length && !adminIds.length) return;
  const actorId =
    (input.actorId && staff.has(input.actorId) && input.actorId) ||
    adminIds[0] ||
    members[0];
  const existing = await query<{ id: string }>(
    `SELECT id::text FROM internal_chat_rooms
     WHERE organization_id = $1::bigint AND team_id = $2::bigint`,
    [orgId, teamId]
  );
  let roomId = existing.rows[0]?.id;
  if (!roomId) {
    const created = await query<{ id: string }>(
      `INSERT INTO internal_chat_rooms
         (organization_id, type, name, description, category, created_by_id, team_id)
       VALUES ($1::bigint, 'group', $2, $3, 'General', $4::bigint, $5::bigint)
       RETURNING id::text`,
      [orgId, name, description, actorId, teamId]
    );
    roomId = created.rows[0].id;
  } else {
    await query(
      `UPDATE internal_chat_rooms
       SET name = $3, description = $4, category = COALESCE(category, 'General'), updated_at = NOW()
       WHERE organization_id = $1::bigint AND id = $2::bigint`,
      [orgId, roomId, name, description]
    );
  }
  const keep = new Set([...members, ...adminIds]);
  const { rows: current } = await query<{ user_id: string }>(
    `SELECT user_id::text FROM internal_chat_room_members
     WHERE room_id = $1::bigint AND left_at IS NULL`,
    [roomId]
  );
  for (const row of current) {
    if (!keep.has(row.user_id)) {
      await query(
        `UPDATE internal_chat_room_members SET left_at = NOW()
         WHERE room_id = $1::bigint AND user_id = $2::bigint AND left_at IS NULL`,
        [roomId, row.user_id]
      );
    }
  }
  for (const id of keep) {
    const role = id === actorId || adminIds.includes(id) ? "admin" : "member";
    await query(
      `INSERT INTO internal_chat_room_members (organization_id, room_id, user_id, room_role, left_at)
       VALUES ($1::bigint, $2::bigint, $3::bigint, $4, NULL)
       ON CONFLICT (room_id, user_id)
       DO UPDATE SET left_at = NULL, room_role = CASE
         WHEN $4 = 'admin' THEN 'admin'
         ELSE internal_chat_room_members.room_role
       END`,
      [orgId, roomId, id, role]
    );
  }
  emitInternalChat(orgId, "internal_chat.room.updated", { roomId });
}

export async function backfillTeamChatGroups(): Promise<void> {
  const { rows } = await query<{ organization_id: string }>(
    `SELECT DISTINCT organization_id::text FROM agent_queues`
  );
  for (const org of rows) {
    const teams = await listTicketingTeams(org.organization_id);
    for (const team of teams) {
      try {
        await syncTeamChatGroup({
          orgId: org.organization_id,
          teamId: team.id,
          name: team.name,
          description: team.description,
          memberIds: team.memberIds,
        });
      } catch (err) {
        console.warn("Team chat backfill skipped:", (err as Error).message);
      }
    }
  }
}
