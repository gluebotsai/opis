/**
 * SLA sweep: 1h reminder emails to assignee/resolver; breach → Overdue + admin email.
 * Express owns timed mail (not SEMA / Approvals).
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
  SLA_BREACH_ADMIN_KIND,
  SLA_LEGACY_OVERDUE_MAIL_LIMIT,
  SLA_REMINDER_KIND,
} from "./customerMail";
import { notifyOrgAgents, notifyUsers } from "./notifications";

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

export async function runSlaSweep(orgId: string): Promise<{
  reminders: number;
  breaches: number;
}> {
  const closed = await nonOpenStatusKeys(orgId);
  let reminders = 0;
  let breaches = 0;

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

  // ---- B. Breach: past due, not terminal ----
  const terminalOnly = closed.filter((s) => s !== "Overdue");
  const due = await query(
    `SELECT id, ticket_number, subject, due_at,
            assignee_id, assignee_name, resolver_id, resolver_name, customer_name, status
     FROM tickets
     WHERE organization_id = $1::bigint
       AND due_at IS NOT NULL
       AND due_at < NOW()
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
       AND NOT (status = ANY($2::text[]))
       AND status <> 'Overdue'`,
    [orgId, terminalOnly]
  );

  for (const t of due.rows) {
    const ticketId = String(t.id);
    const title = "SLA breached";
    const message = `Ticket ${t.ticket_number} ("${t.subject}") is past its SLA due time.`;
    if (t.assignee_id) {
      await notifyUsers({
        orgId,
        userIds: [String(t.assignee_id)],
        kind: "sla",
        title,
        message,
        ticketUuid: ticketId,
        customerName: t.customer_name ? String(t.customer_name) : null,
      });
    } else {
      await notifyOrgAgents({
        orgId,
        kind: "sla",
        title,
        message,
        ticketUuid: ticketId,
        customerName: t.customer_name ? String(t.customer_name) : null,
      });
    }

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

    if (!(await hasOutboundEmailKind(ticketId, SLA_BREACH_ADMIN_KIND))) {
      const mailed = await emailAdminSlaBreach({
        organizationId: orgId,
        ticketId,
        ticketNumber: String(t.ticket_number || ""),
        subject: String(t.subject || ""),
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
            t.assignee_name, t.resolver_name
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
    const mailed = await emailAdminSlaBreach({
      organizationId: orgId,
      ticketId: String(t.id),
      ticketNumber: String(t.ticket_number || ""),
      subject: String(t.subject || ""),
      assigneeName: t.assignee_name ? String(t.assignee_name) : null,
      resolverName: t.resolver_name ? String(t.resolver_name) : null,
      dueAt: t.due_at as Date | string | null,
    });
    if (mailed.sent > 0) breaches += 1;
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
         AND t.status <> 'Resolved'
     ),
     assigned = (
       SELECT COUNT(*)::int FROM tickets t
       WHERE t.organization_id = q.organization_id
         AND t.queue_id = q.id
         AND t.assignee_name <> 'Unassigned'
         AND t.status <> 'Resolved'
     ),
     updated_at = NOW()
     WHERE q.organization_id = $1::bigint`,
    [orgId]
  );

  return { reminders, breaches };
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
