/**
 * SLA sweep: 1h reminder emails to assignee/resolver; breach → Overdue +
 * in-app and email to org admins, assignee, and resolver.
 * Express owns timed mail (not SEMA / Approvals).
 *
 * Also: Resolved → Closed after a wait when the customer never replied
 * (portal note / email / portal chat). CSAT does not count as a reply.
 * Not ARA / chat MAS — no utterance matching.
 *
 * Product rule: one reminder when a ticket enters the 1h window; one breach mail
 * when it goes overdue. The 5-minute timer only finds new tickets — any log row
 * (sent, logged, or failed) means do not send again.
 */
import { query } from "./db";
import {
  emailAdminSlaBreach,
  emailStaffSlaReminder,
  hasOutboundEmailKind,
  outboundMailActive,
  queueCustomerStatusChangeEmail,
  slaMailEnabled,
  stampPastDueSlaMailSkipped,
  SLA_BREACH_ADMIN_KIND,
  SLA_LEGACY_OVERDUE_MAIL_LIMIT,
  SLA_REMINDER_KIND,
} from "./customerMail";
import { emitCriticalAlert } from "./criticalAlerts";
import { listAssignableAgents } from "./accountsSync";
import {
  buildTicketOpsNotice,
  notifyOrgAgents,
  notifyTicketWatchers,
  notifyUsers,
} from "./notifications";
import { writeAuditEvent } from "./audit";
import {
  isResolvedStatusKey,
  statusMailDisplayName,
} from "./statuses";

export const DEFAULT_RESOLVED_AUTO_CLOSE_HOURS = 48;

/** 48h default. Set RESOLVED_AUTO_CLOSE_HOURS=0 to disable. */
export function resolvedAutoCloseHours(): number {
  const raw = String(process.env.RESOLVED_AUTO_CLOSE_HOURS ?? "").trim();
  if (raw === "") return DEFAULT_RESOLVED_AUTO_CLOSE_HOURS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

/** Clock + inbound stamp only. Meaning of a reply stays on ARA. */
export function isResolvedSilentAutoCloseDue(input: {
  status: string;
  resolvedAt: Date | string | null;
  lastCustomerInboundAt: Date | string | null;
  now?: Date;
  hours?: number;
}): boolean {
  if (!isResolvedStatusKey(input.status)) return false;
  const hours = input.hours ?? resolvedAutoCloseHours();
  if (hours <= 0) return false;
  const resolved = input.resolvedAt ? new Date(input.resolvedAt) : null;
  if (!resolved || Number.isNaN(resolved.getTime())) return false;
  const now = input.now ?? new Date();
  if (now.getTime() - resolved.getTime() < hours * 60 * 60 * 1000) {
    return false;
  }
  const inbound = input.lastCustomerInboundAt
    ? new Date(input.lastCustomerInboundAt)
    : null;
  if (
    inbound &&
    !Number.isNaN(inbound.getTime()) &&
    inbound.getTime() > resolved.getTime()
  ) {
    return false;
  }
  return true;
}

/** Statuses treated as closed for SLA mail (Resolved + catalog terminals + Overdue for reminder). */
async function nonOpenStatusKeys(organizationId: string): Promise<string[]> {
  const { rows } = await query(
    `SELECT status FROM ticketing.ticket_statuses
     WHERE organization_id = $1::bigint AND is_terminal = true`,
    [organizationId]
  );
  const keys = new Set<string>(["Resolved", "Overdue"]);
  for (const r of rows) {
    const s = String(r.status || "").trim();
    if (s) keys.add(s);
  }
  return [...keys];
}

async function orgAdminIds(organizationId: string): Promise<string[]> {
  const { rows } = await query<{ id: string }>(
    `SELECT id::text AS id
     FROM agents
     WHERE organization_id = $1::bigint
       AND lower(role) = 'admin'`,
    [organizationId]
  );
  return rows.map((r) => String(r.id));
}

async function notifySlaBreached(input: {
  orgId: string;
  ticketId: string;
  ticketNumber: string;
  subject: string;
  customerName: string | null;
  assigneeId: string | null;
  resolverId: string | null;
}): Promise<void> {
  const title = "SLA breached";
  const message = `Ticket ${input.ticketNumber} ("${input.subject}") is past its SLA due time.`;
  let userIds = [
    ...(await orgAdminIds(input.orgId)),
    input.assigneeId || "",
    input.resolverId || "",
  ].filter(Boolean);
  if (userIds.length) {
    await notifyUsers({
      orgId: input.orgId,
      userIds: [...new Set(userIds)],
      kind: "sla",
      title,
      message,
      ticketUuid: input.ticketId,
      customerName: input.customerName,
    });
  } else {
    await notifyOrgAgents({
      orgId: input.orgId,
      kind: "sla",
      title,
      message,
      ticketUuid: input.ticketId,
      customerName: input.customerName,
    });
    const roster = await listAssignableAgents(input.orgId);
    userIds = roster.map((agent) => agent.id);
  }
  await emitCriticalAlert({
    scenario: "sla_breach",
    orgId: input.orgId,
    userIds: [...new Set(userIds)],
    title,
    message,
    ticketUuid: input.ticketId,
    ticketNumber: input.ticketNumber,
    customerName: input.customerName,
  });
}

export async function runSlaSweep(orgId: string): Promise<{
  reminders: number;
  breaches: number;
  autoClosed: number;
}> {
  const closed = await nonOpenStatusKeys(orgId);
  let reminders = 0;
  let breaches = 0;

  // While SLA SMTP is off, mark already-late tickets so they never backfill.
  if (!slaMailEnabled()) {
    await stampPastDueSlaMailSkipped(orgId);
  }

  // ---- A. Reminder: due within the next hour, still open ----
  const upcoming = await query(
    `SELECT id, ticket_number, subject, due_at,
            assignee_id, assignee_name, resolver_id, resolver_name, customer_name, status
     FROM tickets
     WHERE organization_id = $1::bigint
       AND due_at IS NOT NULL
       AND due_at > NOW()
       AND due_at <= NOW() + INTERVAL '1 hour'
       AND NOT (status = ANY($2::text[]))`,
    [orgId, closed]
  );

  for (const t of upcoming.rows) {
    const ticketId = String(t.id);
    if (await hasOutboundEmailKind(ticketId, SLA_REMINDER_KIND)) continue;

    if (slaMailEnabled() && outboundMailActive()) {
      const mailed = await emailStaffSlaReminder({
        organizationId: orgId,
        ticketId,
        ticketNumber: String(t.ticket_number || ""),
        subject: String(t.subject || ""),
        dueAt: t.due_at as Date | string,
        assigneeId: t.assignee_id ? String(t.assignee_id) : null,
        resolverId: t.resolver_id ? String(t.resolver_id) : null,
      });
      if (mailed.sent > 0) reminders += 1;
    }

    const title = "SLA due within 1 hour";
    const message = `Ticket ${t.ticket_number} ("${t.subject}") is due within one hour.`;
    const notifyIds = [
      t.assignee_id ? String(t.assignee_id) : "",
      t.resolver_id ? String(t.resolver_id) : "",
    ].filter(Boolean);
    if (notifyIds.length) {
      await notifyUsers({
        orgId,
        userIds: [...new Set(notifyIds)],
        kind: "sla",
        title,
        message,
        ticketUuid: ticketId,
        customerName: t.customer_name ? String(t.customer_name) : null,
      });
    }
  }

  // ---- B. Breach: past due Pending only ----
  // Do not overwrite Open or Reopened. PUT /tickets runs this sweep in-process;
  // flipping those staff statuses → Overdue made change-status / reopen look
  // like a no-op (chat said Open, the chip stayed Overdue). SLA remaining is
  // still due_at / the banner.
  const terminalOnly = closed.filter((s) => s !== "Overdue");
  const due = await query(
    `SELECT id, ticket_number, subject, due_at,
            assignee_id, assignee_name, resolver_id, resolver_name, customer_name, status
     FROM tickets
     WHERE organization_id = $1::bigint
       AND due_at IS NOT NULL
       AND due_at < NOW()
       AND status IN ('Pending', 'In Progress')
       AND NOT (status = ANY($2::text[]))
       AND status <> 'Overdue'`,
    [orgId, terminalOnly]
  );

  await query(
    `UPDATE tickets
     SET status = 'Overdue', updated_at = NOW()
     WHERE organization_id = $1::bigint
       AND due_at IS NOT NULL
       AND due_at < NOW()
       AND status IN ('Pending', 'In Progress')
       AND NOT (status = ANY($2::text[]))
       AND status <> 'Overdue'`,
    [orgId, terminalOnly]
  );

  for (const t of due.rows) {
    const ticketId = String(t.id);
    await notifySlaBreached({
      orgId,
      ticketId,
      ticketNumber: String(t.ticket_number || ""),
      subject: String(t.subject || ""),
      customerName: t.customer_name ? String(t.customer_name) : null,
      assigneeId: t.assignee_id ? String(t.assignee_id) : null,
      resolverId: t.resolver_id ? String(t.resolver_id) : null,
    });

    try {
      const { emitProactiveEvent } = await import("./proactiveOutbox");
      void emitProactiveEvent({
        organizationId: orgId,
        eventType: "ticket.sla_at_risk",
        ticketId,
        ticketNumber: String(t.ticket_number || ""),
        payload: {
          ticket_number: String(t.ticket_number || ""),
          prev_status: String(t.status || ""),
          new_status: "Overdue",
          sla_breached: true,
        },
      });
      void emitProactiveEvent({
        organizationId: orgId,
        eventType: "ticket.updated",
        ticketId,
        ticketNumber: String(t.ticket_number || ""),
        payload: {
          ticket_number: String(t.ticket_number || ""),
          prev_status: String(t.status || ""),
          new_status: "Overdue",
          statusChanged: true,
          sla_breached: true,
        },
      });
    } catch (e) {
      console.warn("sla breach proactive emit skipped:", (e as Error).message);
    }

    if (
      slaMailEnabled() &&
      outboundMailActive() &&
      !(await hasOutboundEmailKind(ticketId, SLA_BREACH_ADMIN_KIND))
    ) {
      const mailed = await emailAdminSlaBreach({
        organizationId: orgId,
        ticketId,
        ticketNumber: String(t.ticket_number || ""),
        subject: String(t.subject || ""),
        assigneeId: t.assignee_id ? String(t.assignee_id) : null,
        resolverId: t.resolver_id ? String(t.resolver_id) : null,
        assigneeName: t.assignee_name ? String(t.assignee_name) : null,
        resolverName: t.resolver_name ? String(t.resolver_name) : null,
        dueAt: t.due_at as Date | string | null,
      });
      if (mailed.sent > 0) breaches += 1;
    }
  }

  // Tickets already Overdue with no breach attempt at all (legacy). Failed
  // rows count as attempted — never select those. Cap the batch so a restart
  // cannot SMTP-login hundreds of first-time overdue tickets in one loop.
  const overduePendingMail = await query(
    `SELECT t.id, t.ticket_number, t.subject, t.due_at,
            t.assignee_id, t.resolver_id, t.assignee_name, t.resolver_name,
            t.customer_name
     FROM tickets t
     WHERE t.organization_id = $1::bigint
       AND t.status = 'Overdue'
       AND t.due_at IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM ticketing.outbound_email_log l
         WHERE l.ticket_id = t.id
           AND l.kind = $2
       )
     ORDER BY t.due_at ASC
     LIMIT ${SLA_LEGACY_OVERDUE_MAIL_LIMIT}`,
    [orgId, SLA_BREACH_ADMIN_KIND]
  );
  for (const t of overduePendingMail.rows) {
    await notifySlaBreached({
      orgId,
      ticketId: String(t.id),
      ticketNumber: String(t.ticket_number || ""),
      subject: String(t.subject || ""),
      customerName: t.customer_name ? String(t.customer_name) : null,
      assigneeId: t.assignee_id ? String(t.assignee_id) : null,
      resolverId: t.resolver_id ? String(t.resolver_id) : null,
    });
    if (slaMailEnabled() && outboundMailActive()) {
      const mailed = await emailAdminSlaBreach({
        organizationId: orgId,
        ticketId: String(t.id),
        ticketNumber: String(t.ticket_number || ""),
        subject: String(t.subject || ""),
        assigneeId: t.assignee_id ? String(t.assignee_id) : null,
        resolverId: t.resolver_id ? String(t.resolver_id) : null,
        assigneeName: t.assignee_name ? String(t.assignee_name) : null,
        resolverName: t.resolver_name ? String(t.resolver_name) : null,
        dueAt: t.due_at as Date | string | null,
      });
      if (mailed.sent > 0) breaches += 1;
    }
  }

  await query(
    `UPDATE agent_queues q
     SET sla_status = CASE
       WHEN EXISTS (
         SELECT 1 FROM tickets t
         WHERE t.organization_id = q.organization_id
           AND t.queue_id = q.id
           AND t.status = 'Overdue'
       ) THEN 'At Risk'
       ELSE 'On Track'
     END,
     open_tickets = (
       SELECT COUNT(*)::int FROM tickets t
       WHERE t.organization_id = q.organization_id
         AND t.queue_id = q.id
         AND t.status NOT IN ('Resolved', 'Closed')
     ),
     assigned = (
       SELECT COUNT(*)::int FROM tickets t
       WHERE t.organization_id = q.organization_id
         AND t.queue_id = q.id
         AND t.assignee_name <> 'Unassigned'
         AND t.status NOT IN ('Resolved', 'Closed')
     ),
     updated_at = NOW()
     WHERE q.organization_id = $1::bigint`,
    [orgId]
  );

  const autoClosed = await runResolvedSilentAutoClose(orgId);

  return { reminders, breaches, autoClosed };
}

async function runResolvedSilentAutoClose(orgId: string): Promise<number> {
  const hours = resolvedAutoCloseHours();
  if (hours <= 0) return 0;

  const due = await query(
    `UPDATE tickets
        SET status = 'Closed', updated_at = NOW()
      WHERE organization_id = $1::bigint
        AND status = 'Resolved'
        AND COALESCE(resolved_at, updated_at) <= NOW() - ($2::numeric * INTERVAL '1 hour')
        AND (
          last_customer_inbound_at IS NULL
          OR last_customer_inbound_at <= COALESCE(resolved_at, updated_at)
        )
      RETURNING id, ticket_number, subject, customer_name, customer_email,
                assignee_id, assignee_name, resolver_id, resolver_name`,
    [orgId, hours]
  );

  for (const t of due.rows) {
    const ticketId = String(t.id);
    const ticketNumber = String(t.ticket_number || "");
    await query(
      `INSERT INTO activity_logs (organization_id, ticket_id, text)
       VALUES ($1, $2, $3)`,
      [orgId, ticketId, `Ticket ${ticketNumber} status changed to Closed`]
    );
    await writeAuditEvent({
      organizationId: orgId,
      actorName: "System",
      action: "ticket.status_changed",
      ticketId,
      ticketNumber,
      meta: {
        from: "Resolved",
        to: "Closed",
        via: "auto_close",
        hours,
      },
    });
    const statusCopy = buildTicketOpsNotice({
      ticketNumber,
      subject: t.subject ? String(t.subject) : null,
      actorName: "System",
      changes: [{ field: "status", from: "Resolved", to: "Closed" }],
    });
    if (statusCopy) {
      await notifyTicketWatchers({
        orgId,
        assigneeId: t.assignee_id ? String(t.assignee_id) : null,
        assigneeName: t.assignee_name ? String(t.assignee_name) : null,
        resolverId: t.resolver_id ? String(t.resolver_id) : null,
        resolverName: t.resolver_name ? String(t.resolver_name) : null,
        title: statusCopy.title,
        message: statusCopy.message,
        ticketUuid: ticketId,
        customerName: t.customer_name ? String(t.customer_name) : null,
      });
    }
    queueCustomerStatusChangeEmail({
      organizationId: orgId,
      ticketId,
      ticketNumber,
      subject: String(t.subject || ""),
      customerName: String(t.customer_name || ""),
      customerEmail: t.customer_email ? String(t.customer_email) : "",
      status: "Closed",
      displayName: statusMailDisplayName("Closed"),
    });
    try {
      const { emitProactiveEvent } = await import("./proactiveOutbox");
      void emitProactiveEvent({
        organizationId: orgId,
        eventType: "ticket.updated",
        ticketId,
        ticketNumber,
        payload: {
          ticket_number: ticketNumber,
          prev_status: "Resolved",
          new_status: "Closed",
          statusChanged: true,
          via: "auto_close",
        },
      });
    } catch (e) {
      console.warn(
        "resolved auto-close proactive emit skipped:",
        (e as Error).message
      );
    }
  }

  return due.rows.length;
}

export async function runSlaSweepAllOrgs(): Promise<void> {
  const { rows: orgs } = await query<{ id: string }>(
    `SELECT organization_id::text AS id FROM org_settings`
  );
  for (const org of orgs) {
    try {
      await runSlaSweep(org.id);
    } catch (err) {
      console.warn(
        `SLA sweep failed for org ${org.id}:`,
        (err as Error).message
      );
    }
  }
}

let _slaTimer: ReturnType<typeof setInterval> | null = null;

/** Periodic sweep; default 5 minutes. Set SLA_SWEEP_MS=0 to disable. */
export function startSlaSweepTimer(): void {
  if (_slaTimer) return;
  const raw = String(process.env.SLA_SWEEP_MS || "").trim();
  const ms = raw === "" ? 5 * 60 * 1000 : Number(raw);
  if (!Number.isFinite(ms) || ms <= 0) {
    console.info("SLA sweep timer disabled (SLA_SWEEP_MS<=0)");
    return;
  }
  _slaTimer = setInterval(() => {
    void runSlaSweepAllOrgs();
  }, ms);
  if (typeof _slaTimer.unref === "function") _slaTimer.unref();
  console.info(`SLA sweep timer started (every ${ms}ms)`);
}
