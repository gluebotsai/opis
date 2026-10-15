import { query } from "./db";
import { formatRelative } from "./sla";
import { listAssignableAgents } from "./accountsSync";

export type NotifyKind =
  | "assignment"
  | "update"
  | "sla"
  | "security"
  | "product"
  | "reassignment";

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
  reassignment: "notify_ticket_updates",
};

export type TicketOpsField =
  | "status"
  | "priority"
  | "queue"
  | "assignee"
  | "resolver";

export type TicketOpsChange = {
  field: TicketOpsField;
  from: string;
  to: string;
};

const OPS_FIELD_LABEL: Record<TicketOpsField, string> = {
  status: "Status",
  priority: "Priority",
  queue: "Team",
  assignee: "Assignee (L1)",
  resolver: "Resolver (L2)",
};

/** In-app copy for operational ticket changes (not subject or notes). */
export function buildTicketOpsNotice(opts: {
  ticketNumber: string;
  subject?: string | null;
  actorName?: string | null;
  changes: TicketOpsChange[];
}): { title: string; message: string } | null {
  const changes = opts.changes.filter(
    (row) => String(row.from || "") !== String(row.to || "")
  );
  if (!changes.length) return null;
  const num = String(opts.ticketNumber || "").trim() || "ticket";
  const subject = String(opts.subject || "").trim();
  const subjectBit = subject ? ` ("${subject}")` : "";
  const parts = changes.map((row) => {
    const from = String(row.from || "").trim() || "—";
    const to = String(row.to || "").trim() || "—";
    return `${OPS_FIELD_LABEL[row.field]}: ${from} → ${to}`;
  });
  const title =
    changes.length === 1
      ? `Ticket ${num} ${OPS_FIELD_LABEL[changes[0].field].toLowerCase()} changed`
      : `Ticket ${num} updated`;
  const who = String(opts.actorName || "").trim();
  const message =
    `Ticket ${num}${subjectBit}. ${parts.join(". ")}.` +
    (who ? ` Changed by ${who}.` : "");
  return { title, message };
}

function formatTicketNumberLabel(ticketNumber: string): string {
  const raw = String(ticketNumber || "").trim();
  if (!raw) return "this ticket";
  return raw.startsWith("#") ? raw : `#${raw}`;
}

/** Second-person copy for staff who were just set as L1/L2 on a ticket. */
export function buildDirectRoleAssignmentNotice(opts: {
  ticketNumber: string;
  subject?: string | null;
  role: "agent" | "resolver";
  actorName?: string | null;
  mode?: "new" | "reassign" | "escalate";
}): { title: string; message: string } {
  const num = formatTicketNumberLabel(opts.ticketNumber);
  const subj = String(opts.subject || "").trim();
  const subjectBit = subj ? ` ("${subj}")` : "";

  if (opts.role === "resolver") {
    const mode = opts.mode || "reassign";
    if (mode === "escalate") {
      return {
        title: "Ticket escalated to you",
        message: `Ticket ${num}${subjectBit} was escalated to you as resolver.`,
      };
    }
    if (mode === "new") {
      return {
        title: "Ticket assigned to you as resolver",
        message: `Ticket ${num}${subjectBit} was auto-assigned to you as resolver.`,
      };
    }
    return {
      title: "Ticket reassigned to you",
      message: `Ticket ${num}${subjectBit} was reassigned to you as resolver.`,
    };
  }

  if (opts.mode === "new") {
    return {
      title: "Ticket assigned to you",
      message: `Ticket ${num}${subjectBit} was assigned to you as L1 agent.`,
    };
  }
  if (opts.mode === "reassign") {
    return {
      title: "Ticket reassigned to you",
      message: `Ticket ${num}${subjectBit} was reassigned to you as L1 agent.`,
    };
  }
  return {
    title: "Ticket assigned to you",
    message: `Ticket ${num}${subjectBit} was assigned to you as L1 agent.`,
  };
}

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

/**
 * Bell inbox for people on the ticket: L1 assignee and L2 resolver.
 * Resolves names when ids are missing. Actor is excluded.
 */
export async function notifyTicketWatchers(opts: {
  orgId: string;
  assigneeId?: string | null;
  assigneeName?: string | null;
  resolverId?: string | null;
  resolverName?: string | null;
  kind?: NotifyKind;
  title: string;
  message: string;
  ticketUuid?: string | null;
  customerName?: string | null;
  excludeUserId?: string | null;
  excludeUserIds?: string[];
}): Promise<void> {
  const ids: string[] = [];
  let assignee = String(opts.assigneeId || "").trim();
  if (!assignee) {
    assignee = (await resolveUserIdByName(opts.orgId, opts.assigneeName)) || "";
  }
  let resolver = String(opts.resolverId || "").trim();
  if (!resolver) {
    resolver = (await resolveUserIdByName(opts.orgId, opts.resolverName)) || "";
  }
  if (assignee) ids.push(assignee);
  if (resolver) ids.push(resolver);
  const exclude = new Set(
    [opts.excludeUserId, ...(opts.excludeUserIds || [])]
      .filter(Boolean)
      .map((id) => String(id))
  );
  await notifyUsers({
    orgId: opts.orgId,
    userIds: ids.filter((id) => !exclude.has(id)),
    kind: opts.kind || "update",
    title: opts.title,
    message: opts.message,
    ticketUuid: opts.ticketUuid,
    customerName: opts.customerName,
    excludeUserId: opts.excludeUserId,
  });
}

/** Bell for L1 agent + L2 resolver when the customer writes from portal or email. */
export async function notifyCustomerInboundReply(opts: {
  orgId: string;
  source: "support_portal" | "email";
  ticketNumber: string;
  ticketUuid: string;
  fromName: string;
  preview?: string | null;
  assigneeId?: string | null;
  assigneeName?: string | null;
  resolverId?: string | null;
  resolverName?: string | null;
}): Promise<void> {
  const preview = String(opts.preview || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
  const sourceLabel = opts.source === "email" ? "email" : "the support portal";
  const num = String(opts.ticketNumber || "").trim() || "ticket";
  const who = String(opts.fromName || "Customer").trim() || "Customer";
  const title =
    opts.source === "email" ? `New email on ${num}` : `New portal message on ${num}`;
  const message = preview
    ? `${who} replied via ${sourceLabel}: ${preview}`
    : `${who} replied via ${sourceLabel} on ${num}.`;

  const roster = await listAssignableAgents(opts.orgId);
  const ids = roster
    .filter((user) => {
      const role = String(user.role || "").toLowerCase();
      return role === "admin" || role === "agent" || role === "resolver";
    })
    .map((user) => user.id);
  let assignee = String(opts.assigneeId || "").trim();
  if (!assignee) {
    assignee = (await resolveUserIdByName(opts.orgId, opts.assigneeName)) || "";
  }
  let resolver = String(opts.resolverId || "").trim();
  if (!resolver) {
    resolver = (await resolveUserIdByName(opts.orgId, opts.resolverName)) || "";
  }
  if (assignee) ids.push(assignee);
  if (resolver) ids.push(resolver);

  await notifyUsers({
    orgId: opts.orgId,
    userIds: ids,
    kind: "update",
    title,
    message,
    ticketUuid: opts.ticketUuid,
    customerName: who,
  });
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
  /** Workflow events (e.g. reassignment) still land in the bell when prefs are off. */
  ignorePreferences?: boolean;
}) {
  const ids = [...new Set(opts.userIds.filter(Boolean))].filter(
    (id) => id !== opts.excludeUserId
  );
  if (!ids.length) return;

  const pref = KIND_PREF[opts.kind];
  const numericIds = ids.filter((id) => /^\d+$/.test(id));
  if (!numericIds.length) return;
  const prefClause = opts.ignorePreferences
    ? "TRUE"
    : `COALESCE(${pref}, TRUE) = TRUE`;
  const { rows } = await query(
    `SELECT id FROM agents
     WHERE organization_id = $1
       AND id = ANY($2::bigint[])
       AND lower(COALESCE(status, 'Active')) = 'active'
       AND ${prefClause}`,
    [opts.orgId, numericIds]
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

/** Bell inbox for resolver reassignment workflow (always visible in inbox). */
export async function notifyReassignmentRequestCreated(opts: {
  orgId: string;
  approverId: string;
  ticketNumber: string;
  ticketUuid: string;
  customerName?: string | null;
  requestedByName: string;
  proposedResolverName: string;
  reason: string;
}): Promise<void> {
  const num = String(opts.ticketNumber || "").trim() || "ticket";
  const why = String(opts.reason || "").trim();
  await notifyUsers({
    orgId: opts.orgId,
    userIds: [opts.approverId],
    kind: "reassignment",
    title: `Reassignment request for ${num}`,
    message: `${opts.requestedByName} asked to move ${num} to ${opts.proposedResolverName}. Reason: ${why}`,
    ticketUuid: opts.ticketUuid,
    customerName: opts.customerName,
    ignorePreferences: true,
  });
}

export async function notifyReassignmentRequestDecided(opts: {
  orgId: string;
  accept: boolean;
  ticketNumber: string;
  ticketUuid: string;
  ticketSubject?: string | null;
  customerName?: string | null;
  requestedById: string;
  requestedByName: string;
  proposedResolverId: string;
  proposedResolverName: string;
  actorName: string;
}): Promise<void> {
  const num = String(opts.ticketNumber || "").trim() || "ticket";
  const subject = String(opts.ticketSubject || "").trim();
  const subjectBit = subject ? ` ("${subject}")` : "";

  if (opts.accept) {
    await notifyUsers({
      orgId: opts.orgId,
      userIds: [opts.requestedById],
      kind: "reassignment",
      title: `Reassignment approved for ${num}`,
      message: `${opts.actorName} approved your request to move ${num}${subjectBit} to ${opts.proposedResolverName}.`,
      ticketUuid: opts.ticketUuid,
      customerName: opts.customerName,
      ignorePreferences: true,
    });
    await notifyTicketRoleTarget({
      orgId: opts.orgId,
      userIds: [opts.proposedResolverId],
      ticketNumber: num,
      subject: opts.ticketSubject,
      role: "resolver",
      actorName: opts.actorName,
      mode: "reassign",
      ticketUuid: opts.ticketUuid,
      customerName: opts.customerName,
      excludeUserId: opts.requestedById,
    });
  } else {
    await notifyUsers({
      orgId: opts.orgId,
      userIds: [opts.requestedById],
      kind: "reassignment",
      title: `Reassignment denied for ${num}`,
      message: `${opts.actorName} denied your request to move ${num}${subjectBit} to ${opts.proposedResolverName}.`,
      ticketUuid: opts.ticketUuid,
      customerName: opts.customerName,
      ignorePreferences: true,
    });
  }
}

/** Bell for staff directly assigned as L1/L2 (always visible; prefs bypassed). */
export async function notifyTicketRoleTarget(opts: {
  orgId: string;
  userIds: string[];
  ticketNumber: string;
  subject?: string | null;
  role: "agent" | "resolver";
  actorName?: string | null;
  mode?: "new" | "reassign" | "escalate";
  ticketUuid?: string | null;
  customerName?: string | null;
  excludeUserId?: string | null;
}): Promise<void> {
  const copy = buildDirectRoleAssignmentNotice({
    ticketNumber: opts.ticketNumber,
    subject: opts.subject,
    role: opts.role,
    actorName: opts.actorName,
    mode: opts.mode,
  });
  await notifyUsers({
    orgId: opts.orgId,
    userIds: opts.userIds,
    kind: "reassignment",
    title: copy.title,
    message: copy.message,
    ticketUuid: opts.ticketUuid,
    customerName: opts.customerName,
    excludeUserId: opts.excludeUserId,
    ignorePreferences: true,
  });
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
         OR n.kind = 'reassignment'
       )
     ORDER BY n.created_at DESC
     LIMIT $3`,
    [opts.orgId, opts.userId, limit]
  );
  return rows.map((r) => mapNotification(r));
}
