import { z } from "zod";

import type { DbClient } from "../lib/rls.js";

export const internalChatGroupCategorySchema = z.enum([
  "supervision",
  "shift_handover",
  "escalations",
  "training",
  "general",
]);

export const createGroupRoomSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().min(10).max(4000),
  category: internalChatGroupCategorySchema,
  memberIds: z.array(z.string().min(1)).min(1),
  avatarStorageKey: z.string().max(512).optional(),
});

export const renameGroupRoomSchema = z.object({
  name: z.string().trim().min(1).max(255),
});

export const updateGroupRoomSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().min(10).max(4000),
  category: internalChatGroupCategorySchema,
  avatarStorageKey: z.string().max(512).nullable().optional(),
});

export const updateGroupMembersSchema = z.object({
  memberIds: z.array(z.string().min(1)).min(1),
});

export const sendInternalChatMessageSchema = z.object({
  body: z.string().max(20_000).optional(),
  voiceDurationMs: z.number().int().positive().optional(),
  voiceStorageKey: z.string().max(512).optional(),
  attachments: z
    .array(
      z.object({
        storageKey: z.string().min(1).max(512),
        fileName: z.string().min(1).max(512),
        contentType: z.string().min(1).max(255),
        byteSize: z.number().int().nonnegative(),
        checksumSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
      }),
    )
    .optional(),
});

export const createDmRoomSchema = z.object({
  targetUserId: z.string().min(1),
});

export type InternalChatPresence = "ready" | "not_ready" | "offline";

export type InternalChatMemberRecord = {
  userId: string;
  name: string;
  role: "admin" | "member";
  title?: string;
  presence: InternalChatPresence;
};

export type InternalChatRoomRecord = {
  id: string;
  type: "group" | "dm";
  name: string;
  description?: string;
  category?: z.infer<typeof internalChatGroupCategorySchema>;
  avatarUrl?: string;
  memberIds: string[];
  createdByUserId: string;
  createdAt: string;
  lastMessageAt?: string;
  lastMessagePreview?: string;
  lastReadAt?: string;
  favourite?: boolean;
};

export type InternalChatAttachmentRecord = {
  id: string;
  name: string;
  sizeBytes: number;
  mimeType?: string;
  previewUrl?: string;
};

export type InternalChatMessageRecord = {
  id: string;
  roomId: string;
  senderUserId: string;
  body: string;
  createdAt: string;
  attachments?: InternalChatAttachmentRecord[];
  voiceDurationMs?: number;
  voiceAudioUrl?: string;
};

export type InternalChatBootstrapRecord = {
  members: InternalChatMemberRecord[];
  rooms: InternalChatRoomRecord[];
  messages: InternalChatMessageRecord[];
  currentUserId: string;
};

function httpError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

export function mapPresenceForChat(state: string | null | undefined): InternalChatPresence {
  if (!state || state === "offline") return "offline";
  if (state === "ready") return "ready";
  return "not_ready";
}

export function canonicalDmUserPair(userA: string, userB: string): { low: string; high: string } {
  const a = BigInt(userA);
  const b = BigInt(userB);
  return a < b ? { low: userA, high: userB } : { low: userB, high: userA };
}

export function buildInternalChatFileUrl(apiV1Base: string, attachmentId: string): string {
  return `${apiV1Base}/internal-chat/files/${attachmentId}`;
}

export function buildInternalChatVoiceUrl(apiV1Base: string, messageId: string): string {
  return `${apiV1Base}/internal-chat/messages/${messageId}/voice`;
}

type MemberRow = {
  user_id: string;
  display_name: string;
  role_name: string | null;
  title: string | null;
  presence_state: string | null;
};

async function loadOrgMembers(
  db: DbClient,
  organizationId: string,
  _currentUserId: string,
): Promise<InternalChatMemberRecord[]> {
  const rows = await db.$queryRaw<MemberRow[]>`
    SELECT
      su.id::text AS user_id,
      COALESCE(NULLIF(TRIM(CONCAT(su.first_name, ' ', su.last_name)), ''), su.work_email, 'Agent') AS display_name,
      sr.name AS role_name,
      st.name AS title,
      ap.presence_state
    FROM accounts.setup_users su
    LEFT JOIN accounts.setup_user_product_access supa
      ON supa.user_id = su.id
     AND supa.organization_id = su.organization_id
     AND supa.product_id = 'contact-center'
    LEFT JOIN accounts.setup_roles sr ON sr.id = supa.role_id
    LEFT JOIN accounts.setup_teams st ON st.id = su.team_id
    LEFT JOIN ccass.agents a
      ON a.setup_user_id = su.id
     AND a.organization_id = ${organizationId}::bigint
    LEFT JOIN ccass.agent_presence ap
      ON ap.agent_id = a.id
     AND ap.organization_id = ${organizationId}::bigint
    WHERE su.organization_id = ${organizationId}::bigint
      AND su.status = 'active'
      AND supa.id IS NOT NULL
    ORDER BY display_name ASC
  `;

  return rows.map((row) => ({
    userId: row.user_id,
    name: row.display_name,
    role: row.role_name?.toLowerCase().includes("admin") ? "admin" : "member",
    title: row.title?.trim() || undefined,
    presence: mapPresenceForChat(row.presence_state),
  }));
}

type RoomListRow = {
  id: string;
  room_type: string;
  name: string;
  description: string | null;
  category: string | null;
  avatar_storage_key: string | null;
  created_by_user_id: string;
  created_at: Date;
  updated_at: Date;
  last_read_at: Date | null;
  favourite: boolean;
  last_message_at: Date | null;
  last_message_preview: string | null;
};

async function loadRoomMemberIds(
  db: DbClient,
  organizationId: string,
  roomId: string,
): Promise<string[]> {
  const rows = await db.$queryRaw<{ user_id: string }[]>`
    SELECT user_id::text
    FROM ccass.internal_chat_room_members
    WHERE organization_id = ${organizationId}::bigint
      AND room_id = ${roomId}::bigint
      AND left_at IS NULL
    ORDER BY joined_at ASC
  `;
  return rows.map((row) => row.user_id);
}

function mapRoomRow(
  row: RoomListRow,
  memberIds: string[],
  apiV1Base: string,
): InternalChatRoomRecord {
  return {
    id: row.id,
    type: row.room_type as "group" | "dm",
    name: row.name,
    description: row.description ?? undefined,
    category: (row.category as InternalChatRoomRecord["category"]) ?? undefined,
    avatarUrl: row.avatar_storage_key
      ? `${apiV1Base}/internal-chat/room-avatars/${row.id}`
      : undefined,
    memberIds,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at.toISOString(),
    lastMessageAt: row.last_message_at?.toISOString(),
    lastMessagePreview: row.last_message_preview ?? undefined,
    lastReadAt: row.last_read_at?.toISOString(),
    favourite: row.favourite,
  };
}

export async function assertRoomAccess(
  db: DbClient,
  organizationId: string,
  userId: string,
  roomId: string,
): Promise<void> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id::text
    FROM ccass.internal_chat_room_members
    WHERE organization_id = ${organizationId}::bigint
      AND room_id = ${roomId}::bigint
      AND user_id = ${userId}::bigint
      AND left_at IS NULL
    LIMIT 1
  `;
  if (!rows[0]) {
    throw httpError("Room not found", 404);
  }
}

export async function assertRoomAdmin(
  db: DbClient,
  organizationId: string,
  userId: string,
  roomId: string,
): Promise<void> {
  const rows = await db.$queryRaw<{ role: string }[]>`
    SELECT role
    FROM ccass.internal_chat_room_members
    WHERE organization_id = ${organizationId}::bigint
      AND room_id = ${roomId}::bigint
      AND user_id = ${userId}::bigint
      AND left_at IS NULL
    LIMIT 1
  `;
  if (!rows[0]) {
    throw httpError("Room not found", 404);
  }
  if (rows[0].role !== "admin") {
    throw httpError("Forbidden", 403);
  }
}

export async function bootstrapInternalChat(
  db: DbClient,
  organizationId: string,
  userId: string,
  apiV1Base: string,
): Promise<InternalChatBootstrapRecord> {
  const members = await loadOrgMembers(db, organizationId, userId);
  const rooms = await listRoomsForUser(db, organizationId, userId, apiV1Base);
  const messages: InternalChatMessageRecord[] = [];
  for (const room of rooms.slice(0, 20)) {
    const batch = await listMessages(db, organizationId, userId, room.id, apiV1Base, {
      limit: 50,
    });
    messages.push(...batch.messages);
  }
  return { members, rooms, messages, currentUserId: userId };
}

export async function listRoomsForUser(
  db: DbClient,
  organizationId: string,
  userId: string,
  apiV1Base: string,
): Promise<InternalChatRoomRecord[]> {
  const rows = await db.$queryRaw<RoomListRow[]>`
    SELECT
      r.id::text,
      r.room_type,
      r.name,
      r.description,
      r.category,
      r.avatar_storage_key,
      r.created_by_user_id::text,
      r.created_at,
      r.updated_at,
      m.last_read_at,
      m.favourite,
      lm.created_at AS last_message_at,
      CASE
        WHEN lm.message_type = 'voice' THEN '🎤 Voice message'
        WHEN lm.body <> '' THEN lm.body
        ELSE NULL
      END AS last_message_preview
    FROM ccass.internal_chat_room_members m
    INNER JOIN ccass.internal_chat_rooms r
      ON r.id = m.room_id
     AND r.organization_id = m.organization_id
    LEFT JOIN LATERAL (
      SELECT message_type, body, created_at
      FROM ccass.internal_chat_messages msg
      WHERE msg.room_id = r.id
        AND msg.organization_id = r.organization_id
        AND msg.deleted_at IS NULL
      ORDER BY msg.created_at DESC
      LIMIT 1
    ) lm ON TRUE
    WHERE m.organization_id = ${organizationId}::bigint
      AND m.user_id = ${userId}::bigint
      AND m.left_at IS NULL
    ORDER BY COALESCE(lm.created_at, r.updated_at) DESC
  `;

  const rooms: InternalChatRoomRecord[] = [];
  for (const row of rows) {
    const memberIds = await loadRoomMemberIds(db, organizationId, row.id);
    rooms.push(mapRoomRow(row, memberIds, apiV1Base));
  }
  return rooms;
}

export async function createGroupRoom(
  db: DbClient,
  organizationId: string,
  userId: string,
  userRole: "admin" | "agent",
  payload: z.infer<typeof createGroupRoomSchema>,
  apiV1Base: string,
): Promise<InternalChatRoomRecord> {
  if (userRole !== "admin") {
    throw httpError("Forbidden", 403);
  }

  const memberIds = Array.from(new Set([userId, ...payload.memberIds]));
  const rows = await db.$queryRaw<RoomListRow[]>`
    INSERT INTO ccass.internal_chat_rooms (
      organization_id, room_type, name, description, category, avatar_storage_key, created_by_user_id
    ) VALUES (
      ${organizationId}::bigint,
      'group',
      ${payload.name},
      ${payload.description},
      ${payload.category},
      ${payload.avatarStorageKey ?? null},
      ${userId}::bigint
    )
    RETURNING
      id::text,
      room_type,
      name,
      description,
      category,
      avatar_storage_key,
      created_by_user_id::text,
      created_at,
      updated_at,
      NULL::timestamptz AS last_read_at,
      FALSE AS favourite,
      NULL::timestamptz AS last_message_at,
      NULL::text AS last_message_preview
  `;
  const room = rows[0];
  if (!room) {
    throw new Error("Failed to create group room");
  }

  for (const memberId of memberIds) {
    await db.$executeRaw`
      INSERT INTO ccass.internal_chat_room_members (
        organization_id, room_id, user_id, role, last_read_at
      ) VALUES (
        ${organizationId}::bigint,
        ${room.id}::bigint,
        ${memberId}::bigint,
        ${memberId === userId ? "admin" : "member"},
        NOW()
      )
    `;
  }

  return mapRoomRow(room, memberIds, apiV1Base);
}

export async function getOrCreateDmRoom(
  db: DbClient,
  organizationId: string,
  userId: string,
  targetUserId: string,
  apiV1Base: string,
): Promise<InternalChatRoomRecord> {
  if (userId === targetUserId) {
    throw httpError("Cannot create DM with yourself", 400);
  }

  const { low, high } = canonicalDmUserPair(userId, targetUserId);
  const existing = await db.$queryRaw<RoomListRow[]>`
    SELECT
      r.id::text,
      r.room_type,
      r.name,
      r.description,
      r.category,
      r.avatar_storage_key,
      r.created_by_user_id::text,
      r.created_at,
      r.updated_at,
      m.last_read_at,
      m.favourite,
      NULL::timestamptz AS last_message_at,
      NULL::text AS last_message_preview
    FROM ccass.internal_chat_dm_pairs p
    INNER JOIN ccass.internal_chat_rooms r
      ON r.id = p.room_id
     AND r.organization_id = p.organization_id
    INNER JOIN ccass.internal_chat_room_members m
      ON m.room_id = r.id
     AND m.organization_id = r.organization_id
     AND m.user_id = ${userId}::bigint
     AND m.left_at IS NULL
    WHERE p.organization_id = ${organizationId}::bigint
      AND p.user_low_id = ${low}::bigint
      AND p.user_high_id = ${high}::bigint
    LIMIT 1
  `;
  if (existing[0]) {
    const memberIds = await loadRoomMemberIds(db, organizationId, existing[0].id);
    return mapRoomRow(existing[0], memberIds, apiV1Base);
  }

  const targetRows = await db.$queryRaw<{ display_name: string }[]>`
    SELECT COALESCE(NULLIF(TRIM(CONCAT(first_name, ' ', last_name)), ''), work_email, 'Agent') AS display_name
    FROM accounts.setup_users
    WHERE id = ${targetUserId}::bigint
      AND organization_id = ${organizationId}::bigint
      AND status = 'active'
    LIMIT 1
  `;
  const targetName = targetRows[0]?.display_name ?? "Direct message";

  const created = await db.$queryRaw<RoomListRow[]>`
    INSERT INTO ccass.internal_chat_rooms (
      organization_id, room_type, name, created_by_user_id
    ) VALUES (
      ${organizationId}::bigint,
      'dm',
      ${targetName},
      ${userId}::bigint
    )
    RETURNING
      id::text,
      room_type,
      name,
      description,
      category,
      avatar_storage_key,
      created_by_user_id::text,
      created_at,
      updated_at,
      NULL::timestamptz AS last_read_at,
      FALSE AS favourite,
      NULL::timestamptz AS last_message_at,
      NULL::text AS last_message_preview
  `;
  const room = created[0];
  if (!room) {
    throw new Error("Failed to create DM room");
  }

  await db.$executeRaw`
    INSERT INTO ccass.internal_chat_dm_pairs (organization_id, user_low_id, user_high_id, room_id)
    VALUES (
      ${organizationId}::bigint,
      ${low}::bigint,
      ${high}::bigint,
      ${room.id}::bigint
    )
  `;

  for (const memberId of [userId, targetUserId]) {
    await db.$executeRaw`
      INSERT INTO ccass.internal_chat_room_members (
        organization_id, room_id, user_id, role, last_read_at
      ) VALUES (
        ${organizationId}::bigint,
        ${room.id}::bigint,
        ${memberId}::bigint,
        'member',
        NOW()
      )
    `;
  }

  return mapRoomRow(room, [userId, targetUserId], apiV1Base);
}

export async function updateGroupRoom(
  db: DbClient,
  organizationId: string,
  userId: string,
  roomId: string,
  payload: z.infer<typeof updateGroupRoomSchema>,
  apiV1Base: string,
): Promise<InternalChatRoomRecord> {
  await assertRoomAdmin(db, organizationId, userId, roomId);
  const rows =
    payload.avatarStorageKey === undefined
      ? await db.$queryRaw<RoomListRow[]>`
          UPDATE ccass.internal_chat_rooms
          SET
            name = ${payload.name},
            description = ${payload.description},
            category = ${payload.category},
            updated_at = NOW()
          WHERE organization_id = ${organizationId}::bigint
            AND id = ${roomId}::bigint
            AND room_type = 'group'
          RETURNING
            id::text,
            room_type,
            name,
            description,
            category,
            avatar_storage_key,
            created_by_user_id::text,
            created_at,
            updated_at,
            NULL::timestamptz AS last_read_at,
            FALSE AS favourite,
            NULL::timestamptz AS last_message_at,
            NULL::text AS last_message_preview
        `
      : await db.$queryRaw<RoomListRow[]>`
          UPDATE ccass.internal_chat_rooms
          SET
            name = ${payload.name},
            description = ${payload.description},
            category = ${payload.category},
            avatar_storage_key = ${payload.avatarStorageKey},
            updated_at = NOW()
          WHERE organization_id = ${organizationId}::bigint
            AND id = ${roomId}::bigint
            AND room_type = 'group'
          RETURNING
            id::text,
            room_type,
            name,
            description,
            category,
            avatar_storage_key,
            created_by_user_id::text,
            created_at,
            updated_at,
            NULL::timestamptz AS last_read_at,
            FALSE AS favourite,
            NULL::timestamptz AS last_message_at,
            NULL::text AS last_message_preview
        `;
  const row = rows[0];
  if (!row) {
    throw httpError("Room not found", 404);
  }
  const memberIds = await loadRoomMemberIds(db, organizationId, roomId);
  return mapRoomRow(row, memberIds, apiV1Base);
}

export async function renameGroupRoom(
  db: DbClient,
  organizationId: string,
  userId: string,
  roomId: string,
  name: string,
  apiV1Base: string,
): Promise<InternalChatRoomRecord> {
  const existing = await db.$queryRaw<
    { description: string | null; category: string | null; avatar_storage_key: string | null }[]
  >`
    SELECT description, category, avatar_storage_key
    FROM ccass.internal_chat_rooms
    WHERE organization_id = ${organizationId}::bigint
      AND id = ${roomId}::bigint
      AND room_type = 'group'
    LIMIT 1
  `;
  const room = existing[0];
  if (!room) {
    throw httpError("Room not found", 404);
  }
  return updateGroupRoom(
    db,
    organizationId,
    userId,
    roomId,
    {
      name,
      description: room.description?.trim() || "Group conversation",
      category: (room.category as z.infer<typeof internalChatGroupCategorySchema>) ?? "general",
    },
    apiV1Base,
  );
}

export async function updateGroupMembers(
  db: DbClient,
  organizationId: string,
  userId: string,
  roomId: string,
  memberIds: string[],
): Promise<string[]> {
  await assertRoomAdmin(db, organizationId, userId, roomId);
  const uniqueMemberIds = Array.from(new Set([userId, ...memberIds]));

  for (const memberId of uniqueMemberIds) {
    await db.$executeRaw`
      INSERT INTO ccass.internal_chat_room_members (
        organization_id, room_id, user_id, role, joined_at, left_at
      ) VALUES (
        ${organizationId}::bigint,
        ${roomId}::bigint,
        ${memberId}::bigint,
        ${memberId === userId ? "admin" : "member"},
        NOW(),
        NULL
      )
      ON CONFLICT (organization_id, room_id, user_id)
      DO UPDATE SET left_at = NULL, role = EXCLUDED.role
    `;
  }

  const allRows = await db.$queryRaw<{ user_id: string }[]>`
    SELECT user_id::text
    FROM ccass.internal_chat_room_members
    WHERE organization_id = ${organizationId}::bigint
      AND room_id = ${roomId}::bigint
      AND left_at IS NULL
  `;
  for (const row of allRows) {
    if (!uniqueMemberIds.includes(row.user_id)) {
      await db.$executeRaw`
        UPDATE ccass.internal_chat_room_members
        SET left_at = NOW()
        WHERE organization_id = ${organizationId}::bigint
          AND room_id = ${roomId}::bigint
          AND user_id = ${row.user_id}::bigint
          AND left_at IS NULL
      `;
    }
  }

  return uniqueMemberIds;
}

type MessageRow = {
  id: string;
  room_id: string;
  sender_user_id: string;
  body: string;
  message_type: string;
  voice_duration_ms: number | null;
  voice_storage_key: string | null;
  created_at: Date;
};

type AttachmentRow = {
  id: string;
  message_id: string;
  file_name: string;
  content_type: string;
  byte_size: string;
};

async function loadAttachmentsForMessages(
  db: DbClient,
  organizationId: string,
  messageIds: string[],
  apiV1Base: string,
): Promise<Map<string, InternalChatAttachmentRecord[]>> {
  if (messageIds.length === 0) return new Map();
  const rows = await db.$queryRaw<AttachmentRow[]>`
    SELECT id::text, message_id::text, file_name, content_type, byte_size::text
    FROM ccass.internal_chat_message_attachments
    WHERE organization_id = ${organizationId}::bigint
      AND message_id = ANY(${messageIds}::bigint[])
    ORDER BY id ASC
  `;
  const map = new Map<string, InternalChatAttachmentRecord[]>();
  for (const row of rows) {
    const list = map.get(row.message_id) ?? [];
    list.push({
      id: row.id,
      name: row.file_name,
      sizeBytes: Number(row.byte_size),
      mimeType: row.content_type,
      previewUrl: buildInternalChatFileUrl(apiV1Base, row.id),
    });
    map.set(row.message_id, list);
  }
  return map;
}

function mapMessageRow(
  row: MessageRow,
  attachments: InternalChatAttachmentRecord[] | undefined,
  apiV1Base: string,
): InternalChatMessageRecord {
  return {
    id: row.id,
    roomId: row.room_id,
    senderUserId: row.sender_user_id,
    body: row.body,
    createdAt: row.created_at.toISOString(),
    attachments,
    voiceDurationMs: row.voice_duration_ms ?? undefined,
    voiceAudioUrl: row.voice_storage_key
      ? buildInternalChatVoiceUrl(apiV1Base, row.id)
      : undefined,
  };
}

export async function listMessages(
  db: DbClient,
  organizationId: string,
  userId: string,
  roomId: string,
  apiV1Base: string,
  options: { before?: string; limit?: number } = {},
): Promise<{ messages: InternalChatMessageRecord[] }> {
  await assertRoomAccess(db, organizationId, userId, roomId);
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const rows = options.before
    ? await db.$queryRaw<MessageRow[]>`
        SELECT
          id::text,
          room_id::text,
          sender_user_id::text,
          body,
          message_type,
          voice_duration_ms,
          voice_storage_key,
          created_at
        FROM ccass.internal_chat_messages
        WHERE organization_id = ${organizationId}::bigint
          AND room_id = ${roomId}::bigint
          AND deleted_at IS NULL
          AND created_at < (
            SELECT created_at FROM ccass.internal_chat_messages
            WHERE id = ${options.before}::bigint AND organization_id = ${organizationId}::bigint
            LIMIT 1
          )
        ORDER BY created_at DESC
        LIMIT ${limit}
      `
    : await db.$queryRaw<MessageRow[]>`
        SELECT
          id::text,
          room_id::text,
          sender_user_id::text,
          body,
          message_type,
          voice_duration_ms,
          voice_storage_key,
          created_at
        FROM ccass.internal_chat_messages
        WHERE organization_id = ${organizationId}::bigint
          AND room_id = ${roomId}::bigint
          AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;

  const ordered = [...rows].reverse();
  const attachmentMap = await loadAttachmentsForMessages(
    db,
    organizationId,
    ordered.map((row) => row.id),
    apiV1Base,
  );
  return {
    messages: ordered.map((row) =>
      mapMessageRow(row, attachmentMap.get(row.id), apiV1Base),
    ),
  };
}

export async function sendMessage(
  db: DbClient,
  organizationId: string,
  userId: string,
  roomId: string,
  payload: z.infer<typeof sendInternalChatMessageSchema>,
  apiV1Base: string,
): Promise<InternalChatMessageRecord> {
  await assertRoomAccess(db, organizationId, userId, roomId);

  const body = payload.body?.trim() ?? "";
  const attachments = payload.attachments ?? [];
  const hasVoice = typeof payload.voiceDurationMs === "number" && payload.voiceStorageKey;
  const hasAttachments = attachments.length > 0;
  if (!body && !hasAttachments && !hasVoice) {
    throw httpError("Message cannot be empty", 400);
  }

  const messageType = hasVoice ? "voice" : hasAttachments ? "attachment_bundle" : "text";
  const rows = await db.$queryRaw<MessageRow[]>`
    INSERT INTO ccass.internal_chat_messages (
      organization_id,
      room_id,
      sender_user_id,
      body,
      message_type,
      voice_duration_ms,
      voice_storage_key
    ) VALUES (
      ${organizationId}::bigint,
      ${roomId}::bigint,
      ${userId}::bigint,
      ${body},
      ${messageType},
      ${payload.voiceDurationMs ?? null},
      ${payload.voiceStorageKey ?? null}
    )
    RETURNING
      id::text,
      room_id::text,
      sender_user_id::text,
      body,
      message_type,
      voice_duration_ms,
      voice_storage_key,
      created_at
  `;
  const message = rows[0];
  if (!message) {
    throw new Error("Failed to send message");
  }

  const savedAttachments: InternalChatAttachmentRecord[] = [];
  for (const attachment of attachments) {
    const inserted = await db.$queryRaw<AttachmentRow[]>`
      INSERT INTO ccass.internal_chat_message_attachments (
        organization_id, message_id, storage_key, file_name, content_type, byte_size, checksum_sha256
      ) VALUES (
        ${organizationId}::bigint,
        ${message.id}::bigint,
        ${attachment.storageKey},
        ${attachment.fileName},
        ${attachment.contentType},
        ${attachment.byteSize}::bigint,
        ${attachment.checksumSha256 ?? null}
      )
      RETURNING id::text, message_id::text, file_name, content_type, byte_size::text
    `;
    const row = inserted[0];
    if (row) {
      savedAttachments.push({
        id: row.id,
        name: row.file_name,
        sizeBytes: Number(row.byte_size),
        mimeType: row.content_type,
        previewUrl: buildInternalChatFileUrl(apiV1Base, row.id),
      });
    }
  }

  await db.$executeRaw`
    UPDATE ccass.internal_chat_rooms
    SET updated_at = NOW()
    WHERE organization_id = ${organizationId}::bigint AND id = ${roomId}::bigint
  `;

  await db.$executeRaw`
    UPDATE ccass.internal_chat_room_members
    SET last_read_at = NOW()
    WHERE organization_id = ${organizationId}::bigint
      AND room_id = ${roomId}::bigint
      AND user_id = ${userId}::bigint
      AND left_at IS NULL
  `;

  return mapMessageRow(message, savedAttachments.length ? savedAttachments : undefined, apiV1Base);
}

export async function markRoomRead(
  db: DbClient,
  organizationId: string,
  userId: string,
  roomId: string,
): Promise<string> {
  await assertRoomAccess(db, organizationId, userId, roomId);
  const now = new Date();
  await db.$executeRaw`
    UPDATE ccass.internal_chat_room_members
    SET last_read_at = ${now}
    WHERE organization_id = ${organizationId}::bigint
      AND room_id = ${roomId}::bigint
      AND user_id = ${userId}::bigint
      AND left_at IS NULL
  `;
  return now.toISOString();
}

export async function toggleFavourite(
  db: DbClient,
  organizationId: string,
  userId: string,
  roomId: string,
): Promise<boolean> {
  await assertRoomAccess(db, organizationId, userId, roomId);
  const rows = await db.$queryRaw<{ favourite: boolean }[]>`
    UPDATE ccass.internal_chat_room_members
    SET favourite = NOT favourite
    WHERE organization_id = ${organizationId}::bigint
      AND room_id = ${roomId}::bigint
      AND user_id = ${userId}::bigint
      AND left_at IS NULL
    RETURNING favourite
  `;
  return rows[0]?.favourite ?? false;
}

export async function listAssignableMembers(
  db: DbClient,
  organizationId: string,
  userId: string,
): Promise<InternalChatMemberRecord[]> {
  const members = await loadOrgMembers(db, organizationId, userId);
  return members.filter((member) => member.userId !== userId && member.role === "member");
}

export async function getAttachmentForDownload(
  db: DbClient,
  organizationId: string,
  userId: string,
  attachmentId: string,
): Promise<{ storageKey: string; fileName: string; contentType: string }> {
  const rows = await db.$queryRaw<{
    storage_key: string;
    file_name: string;
    content_type: string;
    room_id: string;
  }[]>`
    SELECT a.storage_key, a.file_name, a.content_type, m.room_id::text
    FROM ccass.internal_chat_message_attachments a
    INNER JOIN ccass.internal_chat_messages m ON m.id = a.message_id
    WHERE a.organization_id = ${organizationId}::bigint
      AND a.id = ${attachmentId}::bigint
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    throw httpError("Attachment not found", 404);
  }
  await assertRoomAccess(db, organizationId, userId, row.room_id);
  return {
    storageKey: row.storage_key,
    fileName: row.file_name,
    contentType: row.content_type,
  };
}

export async function getVoiceForDownload(
  db: DbClient,
  organizationId: string,
  userId: string,
  messageId: string,
): Promise<{ storageKey: string; contentType: string }> {
  const rows = await db.$queryRaw<{ voice_storage_key: string; room_id: string }[]>`
    SELECT voice_storage_key, room_id::text
    FROM ccass.internal_chat_messages
    WHERE organization_id = ${organizationId}::bigint
      AND id = ${messageId}::bigint
      AND message_type = 'voice'
      AND voice_storage_key IS NOT NULL
    LIMIT 1
  `;
  const row = rows[0];
  if (!row?.voice_storage_key) {
    throw httpError("Voice message not found", 404);
  }
  await assertRoomAccess(db, organizationId, userId, row.room_id);
  return { storageKey: row.voice_storage_key, contentType: "audio/webm" };
}

export async function getRoomAvatarForDownload(
  db: DbClient,
  organizationId: string,
  userId: string,
  roomId: string,
): Promise<{ storageKey: string }> {
  await assertRoomAccess(db, organizationId, userId, roomId);
  const rows = await db.$queryRaw<{ avatar_storage_key: string | null }[]>`
    SELECT avatar_storage_key
    FROM ccass.internal_chat_rooms
    WHERE organization_id = ${organizationId}::bigint
      AND id = ${roomId}::bigint
    LIMIT 1
  `;
  const key = rows[0]?.avatar_storage_key;
  if (!key) {
    throw httpError("Avatar not found", 404);
  }
  return { storageKey: key };
}
