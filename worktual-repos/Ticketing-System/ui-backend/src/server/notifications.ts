import { query } from "./db";
import { formatRelative } from "./sla";
import { listAssignableAgents } from "./accountsSync";

export type NotifyKind =
  | "assignment"
  | "update"
  | "sla"
  | "security"
  | "product";

export interface NotificationRow {
  id: string;
  title: string;
  message: string;
  ticketId?: string;
  customerName?: string;
  read: boolean;
  createdAt: string;
  kind?: string;
}

type PrefColumn =
  | "notify_ticket_assignments"
  | "notify_ticket_updates"
  | "notify_sla_alerts"
  | "notify_security_alerts"
  | "notify_product_updates";

export const KIND_PREF: Record<NotifyKind, PrefColumn> = {
  assignment: "notify_ticket_assignments",
  update: "notify_ticket_updates",
  sla: "notify_sla_alerts",
  security: "notify_security_alerts",
  product: "notify_product_updates",
};

export function mapNotification(row: Record<string, unknown>): NotificationRow {
  return {
    id: String(row.id),
    title: String(row.title),
    message: String(row.message),
    ticketId: row.ticket_number ? String(row.ticket_number) : undefined,
    customerName: row.customer_name ? String(row.customer_name) : undefined,
    read: Boolean(row.is_read),
    createdAt: formatRelative(row.created_at as string),
    kind: row.kind ? String(row.kind) : undefined,
  };
}

async function insertNotification(opts: {
  orgId: string;
  userId: string;
  title: string;
  message: string;
  kind: NotifyKind;
  ticketUuid?: string | null;
  customerName?: string | null;
}) {
  await query(
    `INSERT INTO notifications (
       organization_id, user_id, title, message, ticket_id, customer_name, kind, is_read
     ) VALUES ($1,$2,$3,$4,$5,$6,$7, FALSE)`,
    [
      opts.orgId,
      opts.userId,
      opts.title,
      opts.message,
      opts.ticketUuid || null,
      opts.customerName || null,
      opts.kind,
    ]
  );
}

/** Notify specific users who have the matching preference enabled. */
export async function notifyUsers(opts: {
  orgId: string;
  userIds: string[];
  kind: NotifyKind;
  title: string;
  message: string;
  ticketUuid?: string | null;
  customerName?: string | null;
  excludeUserId?: string | null;
}) {
  const ids = [...new Set(opts.userIds.filter(Boolean))].filter(
    (id) => id !== opts.excludeUserId
  );
  if (!ids.length) return;

  const pref = KIND_PREF[opts.kind];
  const active = new Set(
    (await listAssignableAgents(opts.orgId)).map((user) => user.id)
  );
  const eligibleIds = ids.filter((id) => active.has(id));
  if (!eligibleIds.length) return;
  const { rows } = await query(
    `SELECT id FROM agents
     WHERE organization_id = $1
       AND id = ANY($2::bigint[])
       AND COALESCE(${pref}, TRUE) = TRUE`,
    [opts.orgId, eligibleIds]
  );

  for (const row of rows) {
    await insertNotification({
      orgId: opts.orgId,
      userId: String(row.id),
      title: opts.title,
      message: opts.message,
      kind: opts.kind,
      ticketUuid: opts.ticketUuid,
      customerName: opts.customerName,
    });
  }
}

/** Notify org admins who have the matching preference enabled. */
export async function notifyOrgAdmins(opts: {
  orgId: string;
  kind: NotifyKind;
  title: string;
  message: string;
  ticketUuid?: string | null;
  customerName?: string | null;
  excludeUserId?: string | null;
  excludeUserIds?: string[];
}) {
  const pref = KIND_PREF[opts.kind];
  const exclude = new Set(
    [opts.excludeUserId, ...(opts.excludeUserIds || [])]
      .filter(Boolean)
      .map((id) => String(id))
  );
  const { rows } = await query(
    `SELECT id FROM agents
     WHERE organization_id = $1
       AND lower(role) = 'admin'
       AND COALESCE(${pref}, TRUE) = TRUE`,
    [opts.orgId]
  );

  for (const row of rows) {
    const userId = String(row.id);
    if (exclude.has(userId)) continue;
    await insertNotification({
      orgId: opts.orgId,
      userId,
      title: opts.title,
      message: opts.message,
      kind: opts.kind,
      ticketUuid: opts.ticketUuid,
      customerName: opts.customerName,
    });
  }
}

/** Notify all active org agents/admins with the preference (except exclude). */
export async function notifyOrgAgents(opts: {
  orgId: string;
  kind: NotifyKind;
  title: string;
  message: string;
  ticketUuid?: string | null;
  customerName?: string | null;
  excludeUserId?: string | null;
}) {
  const pref = KIND_PREF[opts.kind];
  const roster = await listAssignableAgents(opts.orgId);
  const ids = roster
    .map((user) => user.id)
    .filter((id) => id !== opts.excludeUserId);
  if (!ids.length) return;
  const { rows } = await query(
    `SELECT id FROM agents
     WHERE organization_id = $1
       AND id = ANY($2::bigint[])
       AND COALESCE(${pref}, TRUE) = TRUE
       AND ($3::bigint IS NULL OR id <> $3)`,
    [opts.orgId, ids, opts.excludeUserId || null]
  );

  for (const row of rows) {
    await insertNotification({
      orgId: opts.orgId,
      userId: String(row.id),
      title: opts.title,
      message: opts.message,
      kind: opts.kind,
      ticketUuid: opts.ticketUuid,
      customerName: opts.customerName,
    });
  }
}

export async function resolveUserIdByName(
  orgId: string,
  name: string | null | undefined
): Promise<string | null> {
  if (!name || name === "Unassigned") return null;
  const wanted = String(name).trim().toLowerCase();
  const user = (await listAssignableAgents(orgId)).find(
    (candidate) => candidate.name.trim().toLowerCase() === wanted
  );
  return user?.id || null;
}

export async function resolveUserIdByEmail(
  orgId: string,
  email: string | null | undefined
): Promise<string | null> {
  if (!email || !String(email).trim()) return null;
  const wanted = String(email).trim().toLowerCase();
  const user = (await listAssignableAgents(orgId)).find(
    (candidate) => candidate.email.trim().toLowerCase() === wanted
  );
  return user?.id || null;
}

/**
 * Inbox list filtered by the user's current notify_* preferences.
 * Kinds with preference off are hidden; unknown/null kinds still show.
 */
export async function listUserNotifications(opts: {
  orgId: string;
  userId: string;
  limit?: number;
}): Promise<NotificationRow[]> {
  const limit = opts.limit ?? 100;
  const { rows } = await query(
    `SELECT n.id, n.title, n.message, n.customer_name, n.is_read, n.created_at, n.kind,
            t.ticket_number
     FROM notifications n
     LEFT JOIN tickets t ON t.id = n.ticket_id
     JOIN agents u ON u.id = n.user_id
     WHERE n.organization_id = $1
       AND n.user_id = $2
       AND (
         n.kind IS NULL
         OR (n.kind = 'assignment' AND COALESCE(u.notify_ticket_assignments, TRUE))
         OR (n.kind = 'update' AND COALESCE(u.notify_ticket_updates, TRUE))
         OR (n.kind = 'sla' AND COALESCE(u.notify_sla_alerts, TRUE))
         OR (n.kind = 'security' AND COALESCE(u.notify_security_alerts, TRUE))
         OR (n.kind = 'product' AND COALESCE(u.notify_product_updates, TRUE))
       )
     ORDER BY n.created_at DESC
     LIMIT $3`,
    [opts.orgId, opts.userId, limit]
  );
  return rows.map((r) => mapNotification(r));
}
