/**
 * Outbound email (customer create/reply/resolve + staff create/SLA reminder/breach).
 * SMTP via env, or MAIL_MODE=log (default in dev) — records to outbound_email_log.
 */
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { query } from "./db";

export type CustomerMailKind =
  | "ticket_created"
  | "ticket_reply"
  | "ticket_resolved"
  | "dssa_deflection"
  | "portal_otp"
  | "portal_set_password"
  | "not_registered_customer";

export type SlaMailKind = "sla_reminder_1h" | "sla_breach_admin";

export type StaffMailKind = "staff_ticket_created" | "staff_ticket_reassigned";

export type OutboundMailKind = CustomerMailKind | SlaMailKind | StaffMailKind;

export const SLA_REMINDER_KIND: SlaMailKind = "sla_reminder_1h";
export const SLA_BREACH_ADMIN_KIND: SlaMailKind = "sla_breach_admin";
export const STAFF_TICKET_CREATED_KIND: StaffMailKind = "staff_ticket_created";
export const STAFF_TICKET_REASSIGNED_KIND: StaffMailKind =
  "staff_ticket_reassigned";
/** First-time breach mail for tickets already Overdue — never a full-catalog burst. */
export const SLA_LEGACY_OVERDUE_MAIL_LIMIT = 10;

export async function ensureOutboundEmailLogTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS ticketing.outbound_email_log (
      id               BIGSERIAL PRIMARY KEY,
      organization_id  BIGINT NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
      ticket_id        BIGINT,
      ticket_number    TEXT,
      kind             TEXT NOT NULL,
      to_email         TEXT NOT NULL,
      subject          TEXT NOT NULL,
      body_preview     TEXT,
      status           TEXT NOT NULL DEFAULT 'queued',
      error            TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_outbound_email_log_org
     ON ticketing.outbound_email_log(organization_id, created_at DESC)`
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_outbound_email_log_ticket_kind
     ON ticketing.outbound_email_log(ticket_id, kind)
     WHERE ticket_id IS NOT NULL`
  );
}

function mailMode(): "smtp" | "log" | "off" {
  const m = String(process.env.MAIL_MODE || "").trim().toLowerCase();
  if (m === "off" || m === "smtp" || m === "log") return m;
  if (process.env.SMTP_HOST) return "smtp";
  return "log";
}

function fromAddress(): string {
  return (
    String(process.env.MAIL_FROM || "").trim() ||
    "Worktual Support <noreply@worktual.local>"
  );
}

let transporter: Transporter | null = null;
let smtpBlockedUntil = 0;

function isSmtpAuthError(message: string): boolean {
  const err = message.toLowerCase();
  return (
    err.includes("too many login") ||
    err.includes("invalid login") ||
    err.includes("username and password not accepted") ||
    err.includes("454") ||
    err.includes("535")
  );
}

function smtpCooldownMs(): number {
  const raw = Number(process.env.SMTP_COOLDOWN_MS || "");
  return Number.isFinite(raw) && raw > 0 ? raw : 45 * 60 * 1000;
}

function getTransporter(): Transporter | null {
  if (mailMode() !== "smtp") return null;
  if (transporter) return transporter;
  const host = String(process.env.SMTP_HOST || "").trim();
  if (!host) return null;
  transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "").toLowerCase() === "true",
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 12_000,
    auth:
      process.env.SMTP_USER
        ? {
            user: String(process.env.SMTP_USER).trim(),
            pass: String(process.env.SMTP_PASS || "").replace(/\s+/g, ""),
          }
        : undefined,
  });
  return transporter;
}

function isPlaceholderEmail(email: string): boolean {
  return /@placeholder\.local$/i.test(email);
}

export async function sendCustomerEmail(input: {
  organizationId: string;
  ticketId?: string | null;
  ticketNumber?: string | null;
  toEmail: string;
  toName?: string | null;
  kind: OutboundMailKind;
  subject: string;
  text: string;
}): Promise<{ sent: boolean; mode: string; error?: string }> {
  const to = String(input.toEmail || "").trim();
  if (!to || isPlaceholderEmail(to)) {
    return { sent: false, mode: mailMode(), error: "no_valid_recipient" };
  }

  const mode = mailMode();
  if (mode === "off") {
    return { sent: false, mode };
  }
  if (mode === "smtp" && Date.now() < smtpBlockedUntil) {
    return { sent: false, mode, error: "smtp_temporarily_blocked" };
  }

  const preview = input.text.slice(0, 500);
  let status = "queued";
  let error: string | null = null;

  try {
    if (mode === "log") {
      status = "logged";
      console.info(
        `[mail:log] kind=${input.kind} to=${to} subject=${input.subject} ticket=${input.ticketNumber || ""}`
      );
    } else {
      const tx = getTransporter();
      if (!tx) {
        status = "failed";
        error = "smtp_not_configured";
      } else {
        await Promise.race([
          tx.sendMail({
            from: fromAddress(),
            to: input.toName ? `"${input.toName}" <${to}>` : to,
            subject: input.subject,
            text: input.text,
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("smtp_send_timeout")), 15_000)
          ),
        ]);
        status = "sent";
      }
    }
  } catch (err) {
    status = "failed";
    error = (err as Error).message;
    transporter = null;
    if (isSmtpAuthError(error)) {
      smtpBlockedUntil = Date.now() + smtpCooldownMs();
      console.warn(
        `[mail] SMTP auth blocked; pausing outbound mail for ${Math.round(smtpCooldownMs() / 60000)}m`
      );
    }
    console.warn("[mail] send failed:", error);
  }

  await query(
    `INSERT INTO ticketing.outbound_email_log (
       organization_id, ticket_id, ticket_number, kind, to_email, subject, body_preview, status, error
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      input.organizationId,
      input.ticketId || null,
      input.ticketNumber || null,
      input.kind,
      to,
      input.subject,
      preview,
      status,
      error,
    ]
  ).catch((e) => console.warn("outbound_email_log write failed:", (e as Error).message));

  return {
    sent: status === "sent" || status === "logged",
    mode,
    error: error || undefined,
  };
}

export async function emailNotRegisteredCustomer(input: {
  organizationId: string;
  toEmail: string;
  toName?: string;
}): Promise<void> {
  const name = input.toName || "there";
  await sendCustomerEmail({
    organizationId: input.organizationId,
    toEmail: input.toEmail,
    toName: input.toName,
    kind: "not_registered_customer",
    subject: "We could not open a support ticket",
    text: [
      `Hi ${name},`,
      "",
      "We received your message, but this email is not on the customer list for this organization.",
      "Ask the company that supports you to add you as a customer, then write again.",
      "",
      "— Support",
    ].join("\n"),
  });
}

export async function emailCustomerTicketCreated(input: {
  organizationId: string;
  ticketId: string;
  ticketNumber: string;
  subject: string;
  customerName: string;
  customerEmail: string;
}): Promise<void> {
  const name = input.customerName || "there";
  await sendCustomerEmail({
    organizationId: input.organizationId,
    ticketId: input.ticketId,
    ticketNumber: input.ticketNumber,
    toEmail: input.customerEmail,
    toName: input.customerName,
    kind: "ticket_created",
    subject: `[${input.ticketNumber}] We received your request`,
    text: [
      `Hi ${name},`,
      "",
      `We received your support request "${input.subject}".`,
      `Your ticket number is ${input.ticketNumber}.`,
      "",
      "Reply to this email to add more details (include the ticket number in the subject if possible).",
      "",
      "— Support",
    ].join("\n"),
  });
}

export async function emailCustomerDssaDeflection(input: {
  organizationId: string;
  toEmail: string;
  toName: string;
  subject: string;
  replyBody: string;
}): Promise<void> {
  const name = input.toName || "there";
  await sendCustomerEmail({
    organizationId: input.organizationId,
    toEmail: input.toEmail,
    toName: input.toName,
    kind: "dssa_deflection",
    subject: input.subject.startsWith("Re:")
      ? input.subject
      : `Re: ${input.subject}`,
    text: [
      `Hi ${name},`,
      "",
      input.replyBody.slice(0, 4000),
      "",
      "If this doesn't resolve your issue, reply to this email and we'll open a support ticket for you.",
      "",
      "— Support",
    ].join("\n"),
  });
}

export async function emailCustomerTicketReply(input: {
  organizationId: string;
  ticketId: string;
  ticketNumber: string;
  subject: string;
  customerName: string;
  customerEmail: string;
  replyPreview: string;
  agentName: string;
}): Promise<void> {
  const name = input.customerName || "there";
  await sendCustomerEmail({
    organizationId: input.organizationId,
    ticketId: input.ticketId,
    ticketNumber: input.ticketNumber,
    toEmail: input.customerEmail,
    toName: input.customerName,
    kind: "ticket_reply",
    subject: `Re: [${input.ticketNumber}] ${input.subject}`,
    text: [
      `Hi ${name},`,
      "",
      `${input.agentName} replied on your ticket ${input.ticketNumber}:`,
      "",
      input.replyPreview.slice(0, 2000),
      "",
      "— Support",
    ].join("\n"),
  });
}

export async function emailCustomerTicketResolved(input: {
  organizationId: string;
  ticketId: string;
  ticketNumber: string;
  subject: string;
  customerName: string;
  customerEmail: string;
}): Promise<void> {
  const name = input.customerName || "there";
  await sendCustomerEmail({
    organizationId: input.organizationId,
    ticketId: input.ticketId,
    ticketNumber: input.ticketNumber,
    toEmail: input.customerEmail,
    toName: input.customerName,
    kind: "ticket_resolved",
    subject: `[${input.ticketNumber}] Your request was resolved`,
    text: [
      `Hi ${name},`,
      "",
      `Your ticket ${input.ticketNumber} ("${input.subject}") was marked resolved.`,
      "If you still need help, reply to this email or open a new request.",
      "",
      "— Support",
    ].join("\n"),
  });
}

/**
 * True if this ticket already has any outbound of this kind.
 * One attempt (sent, logged, or failed) is done — do not retry on a timer.
 */
export async function hasOutboundEmailKind(
  ticketId: string,
  kind: OutboundMailKind
): Promise<boolean> {
  const { rows } = await query(
    `SELECT 1 FROM ticketing.outbound_email_log
     WHERE ticket_id = $1::bigint
       AND kind = $2
     LIMIT 1`,
    [ticketId, kind]
  );
  return Boolean(rows[0]);
}

export async function emailsForUserIds(
  organizationId: string,
  userIds: Array<string | null | undefined>
): Promise<Array<{ id: string; email: string; name: string }>> {
  const ids = [
    ...new Set(
      userIds
        .map((id) => String(id || "").trim())
        .filter(Boolean)
    ),
  ];
  if (!ids.length) return [];
  const { rows } = await query(
    `SELECT ag.id::text AS id,
            COALESCE(NULLIF(trim(ag.support_email), ''), lower(su.work_email)) AS email,
            NULLIF(TRIM(COALESCE(su.first_name, '') || ' ' || COALESCE(su.last_name, '')), '') AS name
     FROM agents ag
     JOIN accounts.setup_users su ON su.id = ag.setup_user_id
     WHERE ag.organization_id = $1::bigint
       AND ag.id = ANY($2::bigint[])
       AND COALESCE(NULLIF(trim(ag.support_email), ''), lower(su.work_email)) IS NOT NULL
       AND trim(COALESCE(NULLIF(trim(ag.support_email), ''), lower(su.work_email))) <> ''`,
    [organizationId, ids]
  );
  return rows
    .map((r) => ({
      id: String(r.id),
      email: String(r.email || "").trim(),
      name: String(r.name || "").trim(),
    }))
    .filter((r) => r.email && !isPlaceholderEmail(r.email));
}

export async function emailsForOrgAdmins(
  organizationId: string
): Promise<Array<{ id: string; email: string; name: string }>> {
  const { rows } = await query(
    `SELECT ag.id::text AS id,
            COALESCE(NULLIF(trim(ag.support_email), ''), lower(su.work_email)) AS email,
            NULLIF(TRIM(COALESCE(su.first_name, '') || ' ' || COALESCE(su.last_name, '')), '') AS name
     FROM agents ag
     JOIN accounts.setup_users su ON su.id = ag.setup_user_id
     WHERE ag.organization_id = $1::bigint
       AND lower(ag.role) = 'admin'
       AND COALESCE(NULLIF(trim(ag.support_email), ''), lower(su.work_email)) IS NOT NULL
       AND trim(COALESCE(NULLIF(trim(ag.support_email), ''), lower(su.work_email))) <> ''`,
    [organizationId]
  );
  return rows
    .map((r) => ({
      id: String(r.id),
      email: String(r.email || "").trim(),
      name: String(r.name || "").trim(),
    }))
    .filter((r) => r.email && !isPlaceholderEmail(r.email));
}

/** New ticket filed — email L1 assignee and/or L2 resolver (when ids are set). */
export async function emailStaffTicketCreated(input: {
  organizationId: string;
  ticketId: string;
  ticketNumber: string;
  subject: string;
  customerName: string;
  assigneeId?: string | null;
  assigneeName?: string | null;
  resolverId?: string | null;
  resolverName?: string | null;
}): Promise<{ sent: number }> {
  const assigneeId =
    input.assigneeId && input.assigneeName !== "Unassigned"
      ? String(input.assigneeId)
      : null;
  const resolverId = input.resolverId ? String(input.resolverId) : null;
  const recipients = await emailsForUserIds(input.organizationId, [
    assigneeId,
    resolverId,
  ]);
  if (!recipients.length) {
    return { sent: 0 };
  }

  const seen = new Set<string>();
  let sent = 0;
  for (const r of recipients) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const asResolver = resolverId && r.id === resolverId;
    const asAssignee = assigneeId && r.id === assigneeId;
    let roleLine = "You have a role on this ticket.";
    if (asAssignee && asResolver) {
      roleLine = "You are assigned as both L1 assignee and L2 resolver.";
    } else if (asResolver) {
      roleLine = "You are the L2 resolver on this ticket.";
    } else if (asAssignee) {
      roleLine = "You are the L1 assignee on this ticket.";
    }
    const result = await sendCustomerEmail({
      organizationId: input.organizationId,
      ticketId: input.ticketId,
      ticketNumber: input.ticketNumber,
      toEmail: r.email,
      toName: r.name || null,
      kind: STAFF_TICKET_CREATED_KIND,
      subject: `[New ticket] ${input.ticketNumber} — ${input.subject}`,
      text: [
        `Hi ${r.name || "there"},`,
        "",
        `A new support ticket was filed.`,
        "",
        `Ticket: ${input.ticketNumber}`,
        `Subject: ${input.subject}`,
        `Customer: ${input.customerName || "—"}`,
        assigneeId ? `Assignee: ${input.assigneeName || "—"}` : "",
        resolverId ? `Resolver: ${input.resolverName || "—"}` : "",
        "",
        roleLine,
        "Please review it in Worktual when you can.",
        "",
        "— Worktual",
      ]
        .filter(Boolean)
        .join("\n"),
    });
    if (result.sent) sent += 1;
  }
  return { sent };
}

/** L1/L2 changed to a different person — mail only the new owner(s). */
export async function emailStaffTicketReassigned(input: {
  organizationId: string;
  ticketId: string;
  ticketNumber: string;
  subject: string;
  customerName: string;
  assigneeId?: string | null;
  assigneeName?: string | null;
  resolverId?: string | null;
  resolverName?: string | null;
}): Promise<{ sent: number }> {
  const assigneeId =
    input.assigneeId && input.assigneeName !== "Unassigned"
      ? String(input.assigneeId)
      : null;
  const resolverId = input.resolverId ? String(input.resolverId) : null;
  const recipients = await emailsForUserIds(input.organizationId, [
    assigneeId,
    resolverId,
  ]);
  if (!recipients.length) {
    return { sent: 0 };
  }

  const seen = new Set<string>();
  let sent = 0;
  for (const r of recipients) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const asResolver = resolverId && r.id === resolverId;
    const asAssignee = assigneeId && r.id === assigneeId;
    let roleLine = "This ticket was reassigned to you.";
    if (asAssignee && asResolver) {
      roleLine = "This ticket was reassigned to you as both L1 assignee and L2 resolver.";
    } else if (asResolver) {
      roleLine = "This ticket was reassigned to you as L2 resolver.";
    } else if (asAssignee) {
      roleLine = "This ticket was reassigned to you as L1 assignee.";
    }
    const result = await sendCustomerEmail({
      organizationId: input.organizationId,
      ticketId: input.ticketId,
      ticketNumber: input.ticketNumber,
      toEmail: r.email,
      toName: r.name || null,
      kind: STAFF_TICKET_REASSIGNED_KIND,
      subject: `[Reassigned] ${input.ticketNumber} — ${input.subject}`,
      text: [
        `Hi ${r.name || "there"},`,
        "",
        `A ticket was reassigned to you.`,
        "",
        `Ticket: ${input.ticketNumber}`,
        `Subject: ${input.subject}`,
        `Customer: ${input.customerName || "—"}`,
        assigneeId ? `Assignee: ${input.assigneeName || "—"}` : "",
        resolverId ? `Resolver: ${input.resolverName || "—"}` : "",
        "",
        roleLine,
        "Please review it in Worktual when you can.",
        "",
        "— Worktual",
      ]
        .filter(Boolean)
        .join("\n"),
    });
    if (result.sent) sent += 1;
  }
  return { sent };
}

/** Reminder ~1h before due_at — assignee and/or resolver. */
export async function emailStaffSlaReminder(input: {
  organizationId: string;
  ticketId: string;
  ticketNumber: string;
  subject: string;
  dueAt: string | Date;
  assigneeId?: string | null;
  resolverId?: string | null;
}): Promise<{ sent: number }> {
  if (await hasOutboundEmailKind(input.ticketId, SLA_REMINDER_KIND)) {
    return { sent: 0 };
  }
  const recipients = await emailsForUserIds(input.organizationId, [
    input.assigneeId,
    input.resolverId,
  ]);
  if (!recipients.length) {
    await query(
      `INSERT INTO ticketing.outbound_email_log (
         organization_id, ticket_id, ticket_number, kind, to_email, subject, body_preview, status, error
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'logged',$8)`,
      [
        input.organizationId,
        input.ticketId,
        input.ticketNumber,
        SLA_REMINDER_KIND,
        "(no-staff-email)",
        `[SLA reminder] ${input.ticketNumber}`,
        "No assignee/resolver email on file",
        "no_recipients",
      ]
    ).catch(() => undefined);
    return { sent: 0 };
  }

  const due =
    input.dueAt instanceof Date
      ? input.dueAt.toISOString()
      : String(input.dueAt || "");
  let sent = 0;
  for (const r of recipients) {
    const result = await sendCustomerEmail({
      organizationId: input.organizationId,
      ticketId: input.ticketId,
      ticketNumber: input.ticketNumber,
      toEmail: r.email,
      toName: r.name || null,
      kind: SLA_REMINDER_KIND,
      subject: `[SLA reminder] ${input.ticketNumber} due within 1 hour`,
      text: [
        `Hi ${r.name || "there"},`,
        "",
        `Ticket ${input.ticketNumber} ("${input.subject}") is approaching its SLA due time.`,
        due ? `Due at: ${due}` : "",
        "",
        "Please update or resolve the ticket before the deadline.",
        "",
        "— Worktual",
      ]
        .filter(Boolean)
        .join("\n"),
    });
    if (result.sent) sent += 1;
  }
  return { sent };
}

/** Breach — email org admins once per ticket. */
export async function emailAdminSlaBreach(input: {
  organizationId: string;
  ticketId: string;
  ticketNumber: string;
  subject: string;
  assigneeName?: string | null;
  resolverName?: string | null;
  dueAt?: string | Date | null;
}): Promise<{ sent: number }> {
  if (await hasOutboundEmailKind(input.ticketId, SLA_BREACH_ADMIN_KIND)) {
    return { sent: 0 };
  }
  const admins = await emailsForOrgAdmins(input.organizationId);
  if (!admins.length) {
    await query(
      `INSERT INTO ticketing.outbound_email_log (
         organization_id, ticket_id, ticket_number, kind, to_email, subject, body_preview, status, error
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'logged',$8)`,
      [
        input.organizationId,
        input.ticketId,
        input.ticketNumber,
        SLA_BREACH_ADMIN_KIND,
        "(no-admin-email)",
        `[SLA breached] ${input.ticketNumber}`,
        "No org admin email on file",
        "no_recipients",
      ]
    ).catch(() => undefined);
    return { sent: 0 };
  }

  const due =
    input.dueAt instanceof Date
      ? input.dueAt.toISOString()
      : input.dueAt
        ? String(input.dueAt)
        : "";
  let sent = 0;
  for (const r of admins) {
    const result = await sendCustomerEmail({
      organizationId: input.organizationId,
      ticketId: input.ticketId,
      ticketNumber: input.ticketNumber,
      toEmail: r.email,
      toName: r.name || null,
      kind: SLA_BREACH_ADMIN_KIND,
      subject: `[SLA breached] ${input.ticketNumber} needs attention`,
      text: [
        `Hi ${r.name || "Admin"},`,
        "",
        `Ticket ${input.ticketNumber} ("${input.subject}") has exceeded its SLA due time and remains unresolved.`,
        due ? `Due at: ${due}` : "",
        input.assigneeName ? `Assignee: ${input.assigneeName}` : "",
        input.resolverName ? `Resolver: ${input.resolverName}` : "",
        "",
        "Please review and escalate if needed.",
        "",
        "— Worktual",
      ]
        .filter(Boolean)
        .join("\n"),
    });
    if (result.sent) sent += 1;
  }
  return { sent };
}

/** Pure helper for tests: due_at in (now, now+1h]. */
export function isInSlaReminderWindow(
  dueAt: Date,
  now: Date = new Date(),
  windowMs = 60 * 60 * 1000
): boolean {
  const due = dueAt.getTime();
  const t = now.getTime();
  return due > t && due <= t + windowMs;
}
