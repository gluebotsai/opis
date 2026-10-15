/**
 * Notification persistence via raw SQL so Turbopack-stale Prisma clients
 * cannot break the header bell after schema adds.
 */

import { randomBytes } from "node:crypto";
import { getPrismaClient } from "@/dao/db/prisma";

export type NotificationRow = {
  id: string;
  organizationId: string;
  recipientUserId: string;
  actorUserId: string | null;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  entityType: string | null;
  entityId: string | null;
  contactId: string | null;
  metadata: unknown;
  readAt: Date | null;
  createdAt: Date;
};

function cuidLike(): string {
  return `nt_${randomBytes(12).toString("hex")}`;
}

function mapRow(r: Record<string, unknown>): NotificationRow {
  return {
    id: String(r.id),
    organizationId: String(r.organization_id),
    recipientUserId: String(r.recipient_user_id),
    actorUserId: r.actor_user_id == null ? null : String(r.actor_user_id),
    kind: String(r.kind),
    title: String(r.title),
    body: r.body == null ? null : String(r.body),
    href: r.href == null ? null : String(r.href),
    entityType: r.entity_type == null ? null : String(r.entity_type),
    entityId: r.entity_id == null ? null : String(r.entity_id),
    contactId: r.contact_id == null ? null : String(r.contact_id),
    metadata: r.metadata ?? null,
    readAt: r.read_at == null ? null : new Date(String(r.read_at)),
    createdAt: new Date(String(r.created_at)),
  };
}

export async function insertNotifications(
  rows: Array<{
    organizationId: string;
    recipientUserId: string;
    actorUserId?: string | null;
    kind: string;
    title: string;
    body?: string | null;
    href?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    contactId?: string | null;
    metadata?: unknown;
  }>,
): Promise<NotificationRow[]> {
  if (rows.length === 0) return [];
  const prisma = getPrismaClient();
  const created: NotificationRow[] = [];

  for (const row of rows) {
    const id = cuidLike();
    const meta =
      row.metadata === undefined ? null : JSON.stringify(row.metadata ?? null);
    const result = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `
      INSERT INTO notifications (
        id, organization_id, recipient_user_id, actor_user_id,
        kind, title, body, href, entity_type, entity_id, contact_id,
        metadata, read_at, created_at
      ) VALUES (
        $1, $2::bigint, $3::bigint, $4::bigint,
        $5, $6, $7, $8, $9, $10, $11::text,
        $12::jsonb, NULL, NOW()
      )
      RETURNING *
      `,
      id,
      row.organizationId,
      row.recipientUserId,
      row.actorUserId ?? null,
      row.kind,
      row.title,
      row.body ?? null,
      row.href ?? null,
      row.entityType ?? null,
      row.entityId ?? null,
      row.contactId ?? null,
      meta,
    );
    if (result[0]) created.push(mapRow(result[0]));
  }
  return created;
}

export async function listNotificationsForUser(
  recipientUserId: string,
  options?: { limit?: number; unreadOnly?: boolean },
): Promise<NotificationRow[]> {
  const prisma = getPrismaClient();
  const limit = Math.min(Math.max(options?.limit ?? 30, 1), 100);
  const unreadOnly = Boolean(options?.unreadOnly);
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    SELECT * FROM notifications
    WHERE recipient_user_id = $1::bigint
      ${unreadOnly ? "AND read_at IS NULL" : ""}
    ORDER BY created_at DESC
    LIMIT $2
    `,
    recipientUserId,
    limit,
  );
  return rows.map(mapRow);
}

export async function countUnreadNotifications(
  recipientUserId: string,
): Promise<number> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>(
    `
    SELECT COUNT(*)::int AS count
    FROM notifications
    WHERE recipient_user_id = $1::bigint AND read_at IS NULL
    `,
    recipientUserId,
  );
  return Number(rows[0]?.count ?? 0);
}

export async function markNotificationRead(
  recipientUserId: string,
  notificationId: string,
): Promise<NotificationRow | null> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `
    UPDATE notifications
    SET read_at = NOW()
    WHERE id = $1 AND recipient_user_id = $2::bigint AND read_at IS NULL
    RETURNING *
    `,
    notificationId,
    recipientUserId,
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function markAllNotificationsRead(
  recipientUserId: string,
): Promise<number> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>(
    `
    WITH updated AS (
      UPDATE notifications
      SET read_at = NOW()
      WHERE recipient_user_id = $1::bigint AND read_at IS NULL
      RETURNING id
    )
    SELECT COUNT(*)::int AS count FROM updated
    `,
    recipientUserId,
  );
  return Number(rows[0]?.count ?? 0);
}

/** Permanently remove all notifications for this recipient (bell Clear). */
export async function clearNotificationsForUser(
  recipientUserId: string,
): Promise<number> {
  const prisma = getPrismaClient();
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>(
    `
    WITH deleted AS (
      DELETE FROM notifications
      WHERE recipient_user_id = $1::bigint
      RETURNING id
    )
    SELECT COUNT(*)::int AS count FROM deleted
    `,
    recipientUserId,
  );
  return Number(rows[0]?.count ?? 0);
}
