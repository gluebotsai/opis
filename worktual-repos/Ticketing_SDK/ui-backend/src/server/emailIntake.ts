/**
 * Email → ticket adapter.
 * Provider-agnostic JSON (or light SendGrid/Mailgun shapes) → intake create
 * or append a public note when In-Reply-To / References match a prior Message-ID.
 */
import { query } from "./db";
import { writeAuditEvent } from "./audit";
import { notifyCustomerInboundReply } from "./notifications";
import {
  createTicketFromIntake,
  normalizeIntakeReferences,
  sanitizeIntakeAttachments,
} from "./intake";
import {
  CONVERSATION_SUPPORT_AUTHOR,
  emailCustomerDssaDeflection,
  emailNotRegisteredCustomer,
  isAckOutboundMessageId,
  looksLikeAckMailSubject,
  rememberTicketEmailMessageId,
} from "./customerMail";
import { runInboundDssaCheck, emitCustomerReplied } from "./proactiveOutbox";
import { CustomerDirectoryError } from "./customersDirectory";

export async function ensureEmailMessageRefsTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS ticketing.email_message_refs (
      id               BIGSERIAL PRIMARY KEY,
      organization_id  BIGINT NOT NULL REFERENCES accounts.organizations(id) ON DELETE CASCADE,
      message_id       TEXT NOT NULL,
      ticket_id        BIGINT NOT NULL REFERENCES ticketing.tickets(id) ON DELETE CASCADE,
      ticket_number    TEXT NOT NULL,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (organization_id, message_id)
    )
  `);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_email_message_refs_org_msg
     ON ticketing.email_message_refs(organization_id, message_id)`
  );
  await query(`
    CREATE TABLE IF NOT EXISTS ticketing.imap_poll_cursor (
      mailbox_key TEXT PRIMARY KEY,
      last_uid    BIGINT NOT NULL DEFAULT 0,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function imapCursorKey(settings: ImapSettings): string {
  return `${settings.host}|${settings.user}|${settings.mailbox}`.toLowerCase();
}

async function loadImapCursor(mailboxKey: string): Promise<number> {
  const { rows } = await query<{ last_uid: string }>(
    `SELECT last_uid::text AS last_uid
       FROM ticketing.imap_poll_cursor
      WHERE mailbox_key = $1`,
    [mailboxKey]
  );
  const n = Number(rows[0]?.last_uid || 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

async function saveImapCursor(mailboxKey: string, lastUid: number): Promise<void> {
  if (!Number.isFinite(lastUid) || lastUid <= 0) return;
  await query(
    `INSERT INTO ticketing.imap_poll_cursor (mailbox_key, last_uid, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (mailbox_key)
     DO UPDATE SET last_uid = GREATEST(ticketing.imap_poll_cursor.last_uid, EXCLUDED.last_uid),
                   updated_at = NOW()`,
    [mailboxKey, Math.floor(lastUid)]
  );
}

async function inboundMessageAlreadyKnown(messageId: string | null): Promise<boolean> {
  const mid = normalizeMessageId(messageId);
  if (!mid) return false;
  const { rows } = await query(
    `SELECT 1 FROM ticketing.email_message_refs
      WHERE message_id = $1
      LIMIT 1`,
    [mid]
  );
  return Boolean(rows[0]);
}

function normalizeMessageId(raw: string | undefined | null): string | null {
  const s = String(raw || "")
    .trim()
    .replace(/^<|>$/g, "")
    .trim();
  return s || null;
}

function parseAddress(raw: unknown): { name: string; email: string } {
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const email = String(o.email || o.address || "").trim();
    const name = String(o.name || "").trim() || email.split("@")[0] || "Unknown";
    return { name, email };
  }
  const s = String(raw || "").trim();
  const m = s.match(/^(?:"?([^"<]*)"?\s*)?<?([^<>@\s]+@[^<>@\s]+)>?$/);
  if (m) {
    const email = (m[2] || "").trim();
    const name = (m[1] || "").trim() || email.split("@")[0] || "Unknown";
    return { name, email };
  }
  if (s.includes("@")) {
    return { name: s.split("@")[0] || "Unknown", email: s };
  }
  return { name: s || "Unknown", email: "" };
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export type ParsedInboundEmail = {
  fromName: string;
  fromEmail: string;
  subject: string;
  text: string;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
};

/** Normalize generic + common provider webhook bodies. */
export function parseInboundEmailBody(body: Record<string, unknown>): ParsedInboundEmail {
  // SendGrid Inbound Parse style
  if (body.from && (body.text || body.html || body.subject) && !body.requester) {
    const from = parseAddress(body.from);
    const text =
      String(body.text || "").trim() ||
      stripHtml(String(body.html || ""));
    const refs = String(body.headers || body.References || body.references || "");
    return {
      fromName: from.name,
      fromEmail: from.email,
      subject: String(body.subject || "").trim() || "(no subject)",
      text: text || "(empty message)",
      messageId: normalizeMessageId(
        String(body.messageId || body["Message-Id"] || body["message-id"] || "")
      ),
      inReplyTo: normalizeMessageId(
        String(body.inReplyTo || body["In-Reply-To"] || body.in_reply_to || "")
      ),
      references: refs
        .split(/\s+/)
        .map((r) => normalizeMessageId(r))
        .filter(Boolean) as string[],
    };
  }

  // Mailgun-ish
  if (body.sender || body["body-plain"] || body["stripped-text"]) {
    const from = parseAddress(body.from || body.sender);
    const text =
      String(body["stripped-text"] || body["body-plain"] || body.text || "").trim() ||
      stripHtml(String(body["body-html"] || body.html || ""));
    return {
      fromName: from.name,
      fromEmail: from.email,
      subject: String(body.subject || "").trim() || "(no subject)",
      text: text || "(empty message)",
      messageId: normalizeMessageId(String(body["Message-Id"] || body.messageId || "")),
      inReplyTo: normalizeMessageId(
        String(body["In-Reply-To"] || body.inReplyTo || "")
      ),
      references: String(body.References || body.references || "")
        .split(/\s+/)
        .map((r) => normalizeMessageId(r))
        .filter(Boolean) as string[],
    };
  }

  // Canonical Worktual shape
  const from = parseAddress(
    body.from ||
      body.requester || {
        name: (body as { fromName?: string }).fromName,
        email: (body as { fromEmail?: string }).fromEmail,
      }
  );
  const text =
    String(body.text || body.body || body.description || "").trim() ||
    stripHtml(String(body.html || ""));
  const refList = body.references;
  const references = Array.isArray(refList)
    ? (refList.map((r) => normalizeMessageId(String(r))).filter(Boolean) as string[])
    : String(refList || "")
        .split(/\s+/)
        .map((r) => normalizeMessageId(r))
        .filter(Boolean) as string[];

  return {
    fromName: from.name,
    fromEmail: from.email,
    subject: String(body.subject || "").trim() || "(no subject)",
    text: text || "(empty message)",
    messageId: normalizeMessageId(
      String(body.messageId || body.message_id || "")
    ),
    inReplyTo: normalizeMessageId(
      String(body.inReplyTo || body.in_reply_to || "")
    ),
    references,
  };
}

async function findTicketByMessageIds(
  organizationId: string,
  ids: string[]
): Promise<{ ticketId: string; ticketNumber: string; messageId: string } | null> {
  const clean = [...new Set(ids.map((id) => normalizeMessageId(id)).filter(Boolean))] as string[];
  if (!clean.length) return null;
  const { rows } = await query(
    `SELECT ticket_id::text AS ticket_id, ticket_number, message_id
     FROM ticketing.email_message_refs
     WHERE organization_id = $1 AND message_id = ANY($2::text[])
     ORDER BY created_at DESC
     LIMIT 1`,
    [organizationId, clean]
  );
  if (!rows[0]) return null;
  return {
    ticketId: String(rows[0].ticket_id),
    ticketNumber: String(rows[0].ticket_number),
    messageId: String(rows[0].message_id || ""),
  };
}

async function rememberMessageId(
  organizationId: string,
  messageId: string | null,
  ticketId: string,
  ticketNumber: string
): Promise<void> {
  await rememberTicketEmailMessageId({
    organizationId,
    messageId,
    ticketId,
    ticketNumber,
  });
}

/** True when the stored body is a forwarded/replied mail dump, not a staff note. */
export function looksLikeInboundEmailDump(raw: string): boolean {
  const text = String(raw || "");
  return (
    /^Email reply from /i.test(text) ||
    /^On .{3,240}wrote:/im.test(text.replace(/\n/g, " ")) ||
    /^-----Original Message-----/m.test(text) ||
    /^>/m.test(text)
  );
}

/** New customer text only — drop Gmail/Outlook quoted history. Not used for chat intent. */
export function customerReplyPlainText(raw: string): string {
  let text = String(raw || "")
    .replace(/\r\n/g, "\n")
    .trim();
  text = text.replace(/^Email reply from [^\n]+:\s*/i, "").trim();
  const lines = text.split("\n");
  let cut = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const window = lines
      .slice(i, i + 4)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (/^On .{3,300}wrote:/i.test(line) || /^On .{3,300}wrote:/i.test(window)) {
      cut = i;
      break;
    }
    if (/^-----Original Message-----$/i.test(line)) {
      cut = i;
      break;
    }
    if (i > 0 && /^>/.test(line)) {
      cut = i;
      break;
    }
  }
  const kept = lines
    .slice(0, cut)
    .filter((line) => !/^>/.test(line.trim()))
    .join("\n")
    .trim();
  return kept;
}

export type ConversationLane = "out" | "in" | "internal" | "draft";

export function conversationNoteLane(input: {
  visibility: string;
  authorId?: string | null;
  authorName: string;
  body?: string;
}): ConversationLane {
  const visibility = String(input.visibility || "internal");
  if (visibility === "draft") return "draft";
  if (visibility !== "public") return "internal";
  if (looksLikeInboundEmailDump(input.body || "")) return "in";
  if (input.authorId) return "out";
  if (
    String(input.authorName || "").trim().toLowerCase() ===
    CONVERSATION_SUPPORT_AUTHOR.toLowerCase()
  ) {
    return "out";
  }
  return "in";
}

export function splitMailSubjectFromNote(raw: string): {
  subject?: string;
  text: string;
} {
  const text = String(raw || "").replace(/\r\n/g, "\n");
  const m = text.match(/^([^\n]{1,160})\n\n([\s\S]+)$/);
  if (!m) return { text: text.trim() };
  const first = m[1].trim();
  if (/^(\[[^\]]+\]|Re:)/i.test(first)) {
    return { subject: first, text: m[2].trim() };
  }
  return { text: text.trim() };
}

async function appendEmailNote(input: {
  organizationId: string;
  ticketId: string;
  ticketNumber: string;
  fromName: string;
  fromEmail: string;
  text: string;
  messageId: string | null;
  attachments?: unknown;
}): Promise<{ status: string; subject: string }> {
  const body = customerReplyPlainText(input.text) || "(empty message)";
  await query(
    `INSERT INTO ticket_notes (organization_id, ticket_id, author_id, author_name, body, visibility)
     VALUES ($1,$2,NULL,$3,$4,'public')`,
    [input.organizationId, input.ticketId, input.fromName, body]
  );
  const extra = sanitizeIntakeAttachments(input.attachments);
  if (extra.length) {
    await query(
      `UPDATE tickets
          SET attachments = (
                SELECT COALESCE(ARRAY(
                  SELECT DISTINCT u
                    FROM unnest(COALESCE(attachments, '{}') || $3::text[]) AS u
                ), '{}')
              ),
              updated_at = NOW(),
              last_customer_inbound_channel = 'email',
              last_customer_inbound_at = NOW()
        WHERE id = $1::bigint AND organization_id = $2::bigint`,
      [input.ticketId, input.organizationId, extra]
    );
  } else {
    await query(
      `UPDATE tickets
          SET updated_at = NOW(),
              last_customer_inbound_channel = 'email',
              last_customer_inbound_at = NOW()
        WHERE id = $1`,
      [input.ticketId]
    );
  }
  await writeAuditEvent({
    organizationId: input.organizationId,
    actorName: input.fromName,
    action: "ticket.note_added",
    ticketId: input.ticketId,
    ticketNumber: input.ticketNumber,
    meta: { source: "email_intake", messageId: input.messageId, visibility: "public" },
  });
  const t = await query(
    `SELECT assignee_id, resolver_id, status, subject, customer_name
       FROM tickets WHERE id = $1`,
    [input.ticketId]
  );
  const row = t.rows[0] || {};
  const assigneeId = row.assignee_id ? String(row.assignee_id) : null;
  await notifyCustomerInboundReply({
    orgId: input.organizationId,
    source: "email",
    ticketNumber: input.ticketNumber,
    ticketUuid: input.ticketId,
    fromName: input.fromName,
    preview: input.text,
    assigneeId,
    resolverId: row.resolver_id ? String(row.resolver_id) : null,
  });

  void emitCustomerReplied({
    organizationId: input.organizationId,
    ticketId: input.ticketId,
    ticketNumber: input.ticketNumber,
    text: input.text,
    customerName: input.fromName,
    assigneeId,
    resolverId: row.resolver_id ? String(row.resolver_id) : null,
    subject: row.subject ? String(row.subject) : null,
    status: row.status ? String(row.status) : null,
    channel: "email",
  });

  return {
    status: row.status ? String(row.status) : "Open",
    subject: row.subject ? String(row.subject) : "",
  };
}

export type EmailIntakeResult =
  | {
      action: "deflected";
      replyPreview: string;
      recommendationId?: string;
    }
  | {
      action: "created";
      ticketId: string;
      ticketNumber: string;
      status: string;
      channel: string;
      subject: string;
      createdAt: string;
      updatedAt: string;
    }
  | {
      action: "appended";
      ticketId: string;
      ticketNumber: string;
      status: string;
      subject?: string;
    }
  | {
      action: "ignored";
      reason: string;
    };

function inboundThreadIds(parsed: {
  inReplyTo: string | null;
  references: string[];
}): string[] {
  return [parsed.inReplyTo, ...parsed.references].filter(Boolean) as string[];
}

/** Replies to Ticketing ack/status mail are send-only — never attach or create. */
function isAckNoReplyInbound(parsed: {
  inReplyTo: string | null;
  references: string[];
  subject: string;
}): boolean {
  if (looksLikeAckMailSubject(parsed.subject)) return true;
  return inboundThreadIds(parsed).some((id) => isAckOutboundMessageId(id));
}

export async function processInboundEmail(input: {
  organizationId: string;
  body: Record<string, unknown>;
  actorName?: string;
  apiKeyId?: string;
  /** Mailbox poller: attach to an existing ticket only. Never create. */
  repliesOnly?: boolean;
  /** Provider email API: verify + create only (same as webchat). IMAP/bot omit this. */
  skipDssa?: boolean;
}): Promise<EmailIntakeResult> {
  const parsed = parseInboundEmailBody(input.body);
  if (!parsed.fromEmail) {
    const err = new Error("from email is required");
    (err as { status?: number }).status = 400;
    throw err;
  }

  const already = parsed.messageId
    ? await findTicketByMessageIds(input.organizationId, [parsed.messageId])
    : null;
  if (already) {
    return {
      action: "ignored",
      reason: "already_threaded",
    };
  }

  if (isAckNoReplyInbound(parsed)) {
    return { action: "ignored", reason: "ack_mail_noreply" };
  }

  const threadIds = inboundThreadIds(parsed);

  const existing = await findTicketByMessageIds(
    input.organizationId,
    threadIds
  );
  if (existing) {
    if (isAckOutboundMessageId(existing.messageId)) {
      return { action: "ignored", reason: "ack_mail_noreply" };
    }
    const appended = await appendEmailNote({
      organizationId: input.organizationId,
      ticketId: existing.ticketId,
      ticketNumber: existing.ticketNumber,
      fromName: parsed.fromName,
      fromEmail: parsed.fromEmail,
      text: parsed.text,
      messageId: parsed.messageId,
      attachments: input.body.attachments,
    });
    await rememberMessageId(
      input.organizationId,
      parsed.messageId,
      existing.ticketId,
      existing.ticketNumber
    );
    return {
      action: "appended",
      ticketId: existing.ticketId,
      ticketNumber: existing.ticketNumber,
      status: appended.status,
      subject: appended.subject || undefined,
    };
  }

  // Reply to outbound we do not thread (ack Message-ID not stored): do not
  // attach via subject #. New mail without a ticket number can still create.
  if (parsed.inReplyTo && !existing && /#\d{3,}/.test(parsed.subject)) {
    return { action: "ignored", reason: "ack_mail_noreply" };
  }

  // Subject contains ticket number? e.g. Re: [#12862] …
  const tnMatch = parsed.subject.match(/#(\d{3,})/);
  if (tnMatch) {
    const ticketNumber = `#${tnMatch[1]}`;
    const t = await query(
      `SELECT id::text AS id, ticket_number, status
       FROM tickets
       WHERE organization_id = $1 AND ticket_number = $2
       LIMIT 1`,
      [input.organizationId, ticketNumber]
    );
    if (t.rows[0]) {
      const ticketId = String(t.rows[0].id);
      const appended = await appendEmailNote({
        organizationId: input.organizationId,
        ticketId,
        ticketNumber: String(t.rows[0].ticket_number),
        fromName: parsed.fromName,
        fromEmail: parsed.fromEmail,
        text: parsed.text,
        messageId: parsed.messageId,
        attachments: input.body.attachments,
      });
      await rememberMessageId(
        input.organizationId,
        parsed.messageId,
        ticketId,
        String(t.rows[0].ticket_number)
      );
      return {
        action: "appended",
        ticketId,
        ticketNumber: String(t.rows[0].ticket_number),
        status: appended.status || String(t.rows[0].status || "Open"),
        subject: appended.subject || undefined,
      };
    }
  }

  if (input.repliesOnly) {
    return { action: "ignored", reason: "no_ticket_thread" };
  }

  if (!input.skipDssa) {
    const dssaEventId = parsed.messageId
      ? `email-${parsed.messageId}`
      : `email-${Date.now()}-${parsed.fromEmail}`;
    const dssa = await runInboundDssaCheck({
      organizationId: input.organizationId,
      eventId: dssaEventId,
      text: `${parsed.subject}\n\n${parsed.text}`,
      customerName: parsed.fromName,
      customerEmail: parsed.fromEmail,
      subject: parsed.subject,
    });
    if (dssa.deflected && dssa.reply) {
      await emailCustomerDssaDeflection({
        organizationId: input.organizationId,
        toEmail: parsed.fromEmail,
        toName: parsed.fromName,
        subject: parsed.subject,
        replyBody: dssa.reply,
      }).catch(() => undefined);
      await writeAuditEvent({
        organizationId: input.organizationId,
        actorName: input.actorName || "Email intake",
        action: "email.dssa_deflected",
        meta: {
          source: "email_intake",
          messageId: parsed.messageId,
          recommendationId: dssa.recommendationId,
          confidence: dssa.confidence,
          fromEmail: parsed.fromEmail,
        },
      });
      return {
        action: "deflected",
        replyPreview: dssa.reply.slice(0, 500),
        recommendationId: dssa.recommendationId,
      };
    }
  }

  let created;
  try {
    const extraMeta =
      input.body.metadata &&
      typeof input.body.metadata === "object" &&
      !Array.isArray(input.body.metadata)
        ? (input.body.metadata as Record<string, unknown>)
        : {};
    created = await createTicketFromIntake({
      organizationId: input.organizationId,
      channel: "email",
      requester: {
        name: parsed.fromName,
        email: parsed.fromEmail,
        phone: String(input.body.phone || input.body.customerPhone || "").trim() || undefined,
      },
      subject: parsed.subject,
      description: parsed.text,
      priority: input.body.priority != null ? String(input.body.priority) : undefined,
      category: input.body.category != null ? String(input.body.category) : undefined,
      accountId: String(input.body.accountId || input.body.account_id || "").trim() || undefined,
      externalRef:
        String(input.body.externalRef || input.body.external_ref || "").trim() ||
        parsed.messageId ||
        undefined,
      idempotencyKey: String(
        input.body.idempotencyKey || input.body.idempotency_key || ""
      ).trim() || undefined,
      attachments: input.body.attachments,
      metadata: {
        messageId: parsed.messageId,
        inReplyTo: parsed.inReplyTo,
        source: "email_intake",
        ...extraMeta,
      },
      actorName: input.actorName || "Email intake",
      apiKeyId: input.apiKeyId,
      skipDssa: true,
      references: normalizeIntakeReferences(input.body),
    });
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      (err as { deflected?: boolean }).deflected
    ) {
      const reply = String((err as { reply?: string }).reply || (err as Error).message || "");
      if (reply) {
        await emailCustomerDssaDeflection({
          organizationId: input.organizationId,
          toEmail: parsed.fromEmail,
          toName: parsed.fromName,
          subject: parsed.subject,
          replyBody: reply,
        }).catch(() => undefined);
        return {
          action: "deflected",
          replyPreview: reply.slice(0, 500),
        };
      }
    }
    if (err instanceof CustomerDirectoryError || (err as { status?: number }).status === 422) {
      await emailNotRegisteredCustomer({
        organizationId: input.organizationId,
        toEmail: parsed.fromEmail,
        toName: parsed.fromName,
      }).catch(() => undefined);
    }
    throw err;
  }

  await rememberMessageId(
    input.organizationId,
    parsed.messageId,
    created.ticketId,
    created.ticketNumber
  );

  return {
    action: "created",
    ...created,
  };
}

type ResolvedInboundTicket = {
  organizationId: string;
  ticketId: string;
  ticketNumber: string;
};

async function resolveInboundReplyTicket(
  parsed: ParsedInboundEmail
): Promise<ResolvedInboundTicket | null> {
  if (isAckNoReplyInbound(parsed)) return null;
  const threadIds = inboundThreadIds(parsed);
  if (parsed.inReplyTo && threadIds.every((id) => isAckOutboundMessageId(id))) {
    return null;
  }
  if (threadIds.length) {
    const { rows } = await query<{
      organization_id: string;
      ticket_id: string;
      ticket_number: string;
    }>(
      `SELECT organization_id::text AS organization_id,
              ticket_id::text AS ticket_id,
              ticket_number
         FROM ticketing.email_message_refs
        WHERE message_id = ANY($1::text[])
        ORDER BY created_at DESC
        LIMIT 1`,
      [threadIds]
    );
    if (rows[0]) {
      return {
        organizationId: String(rows[0].organization_id),
        ticketId: String(rows[0].ticket_id),
        ticketNumber: String(rows[0].ticket_number),
      };
    }
    if (parsed.inReplyTo) return null;
  }

  const tnMatch = parsed.subject.match(/#(\d{3,})/);
  if (!tnMatch) return null;
  const numbers = [`#${tnMatch[1]}`, tnMatch[1]];
  const { rows } = await query<{
    organization_id: string;
    id: string;
    ticket_number: string;
    customer_email: string;
  }>(
    `SELECT organization_id::text AS organization_id,
            id::text AS id,
            ticket_number,
            customer_email
       FROM tickets
      WHERE ticket_number = ANY($1::text[])`,
    [numbers]
  );
  if (!rows.length) return null;
  const from = parsed.fromEmail.toLowerCase();
  const hit =
    rows.length === 1
      ? rows[0]
      : rows.find((r) => String(r.customer_email || "").toLowerCase() === from);
  if (!hit) return null;
  return {
    organizationId: String(hit.organization_id),
    ticketId: String(hit.id),
    ticketNumber: String(hit.ticket_number),
  };
}

type ImapSettings = {
  host: string;
  port: number;
  user: string;
  pass: string;
  mailbox: string;
};

function imapSettings(): ImapSettings | null {
  const enable = String(process.env.IMAP_ENABLE || "").trim().toLowerCase();
  if (enable === "0" || enable === "false" || enable === "off") return null;
  const smtpHost = String(process.env.SMTP_HOST || "").trim().toLowerCase();
  const gmailSmtp = smtpHost.includes("gmail.com");
  const host =
    String(process.env.IMAP_HOST || "").trim() ||
    (gmailSmtp || enable === "1" || enable === "true" ? "imap.gmail.com" : "");
  const user = String(process.env.IMAP_USER || process.env.SMTP_USER || "").trim();
  const pass = String(process.env.IMAP_PASS || process.env.SMTP_PASS || "").replace(
    /\s+/g,
    ""
  );
  if (!host || !user || !pass) return null;
  if (
    !String(process.env.IMAP_HOST || "").trim() &&
    !gmailSmtp &&
    enable !== "1" &&
    enable !== "true"
  ) {
    return null;
  }
  return {
    host,
    port: Number(process.env.IMAP_PORT || 993) || 993,
    user,
    pass,
    mailbox: String(process.env.IMAP_MAILBOX || "INBOX").trim() || "INBOX",
  };
}

function mailboxOwnAddress(settings: ImapSettings): string {
  const from = parseAddress(process.env.MAIL_FROM || settings.user);
  return (from.email || settings.user).toLowerCase();
}

let _imapTimer: ReturnType<typeof setInterval> | null = null;
let _imapBusy = false;
let _imapBlockedUntil = 0;

export async function pollInboundMailboxOnce(): Promise<number> {
  const settings = imapSettings();
  if (!settings) return 0;
  if (Date.now() < _imapBlockedUntil) return 0;
  if (_imapBusy) return 0;
  _imapBusy = true;
  let appended = 0;
  try {
    const { ImapFlow } = await import("imapflow");
    const { simpleParser } = await import("mailparser");
    const client = new ImapFlow({
      host: settings.host,
      port: settings.port,
      secure: true,
      auth: { user: settings.user, pass: settings.pass },
      logger: false,
    });
    await client.connect();
    try {
      const lock = await client.getMailboxLock(settings.mailbox);
      try {
        const own = mailboxOwnAddress(settings);
        const last = (ids: number[], n: number) => ids.slice(-n);
        const uidNext = Number(client.mailbox?.uidNext || 0);
        const cursorKey = imapCursorKey(settings);
        let lastUid = await loadImapCursor(cursorKey);
        let uids: number[] = [];
        if (lastUid <= 0) {
          const unseen = (await client.search({ seen: false })) || [];
          uids = last(unseen, 30);
        } else {
          const fresh =
            (await client.search({ uid: `${lastUid + 1}:*` })) || [];
          uids = last(fresh, 30);
        }
        uids = [...new Set(uids)]
          .filter((id) => Number.isFinite(id) && id > lastUid)
          .sort((a, b) => a - b);
        console.info(
          `[mail] IMAP poll lastUid=${lastUid} unseenOrNew=${uids.length} fetch=${uids.length}`
        );
        for (const uid of uids) {
          const msg = await client.fetchOne(uid, { source: true, uid: true }, { uid: true });
          const source = msg && "source" in msg ? msg.source : null;
          if (!source) {
            if (uid) await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
            lastUid = Math.max(lastUid, uid);
            continue;
          }
          const parsedMail = await simpleParser(source);
          const body = {
            from: parsedMail.from?.text || parsedMail.from?.value?.[0]?.address || "",
            subject: String(parsedMail.subject || ""),
            text: String(parsedMail.text || "").trim(),
            html: String(parsedMail.html || ""),
            messageId: parsedMail.messageId || "",
            inReplyTo: parsedMail.inReplyTo || "",
            references: parsedMail.references || "",
          };
          const parsed = parseInboundEmailBody(body as Record<string, unknown>);
          if (parsed.fromEmail && parsed.fromEmail.toLowerCase() === own) {
            if (uid) await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
            lastUid = Math.max(lastUid, uid);
            continue;
          }
          if (await inboundMessageAlreadyKnown(parsed.messageId)) {
            if (uid) await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
            lastUid = Math.max(lastUid, uid);
            continue;
          }
          const resolved = await resolveInboundReplyTicket(parsed);
          if (!resolved) {
            if (uid) await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
            lastUid = Math.max(lastUid, uid);
            continue;
          }
          try {
            const result = await processInboundEmail({
              organizationId: resolved.organizationId,
              body: body as Record<string, unknown>,
              actorName: "Email:imap",
              repliesOnly: true,
            });
            if (result.action === "appended") appended += 1;
          } catch (err) {
            console.warn(
              "[mail] IMAP inbound attach failed:",
              (err as Error).message
            );
            lastUid = Math.max(lastUid, uid);
            continue;
          }
          if (uid) await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
          lastUid = Math.max(lastUid, uid);
        }
        const highWater =
          uidNext > 1 ? Math.max(lastUid, uidNext - 1) : lastUid;
        await saveImapCursor(cursorKey, highWater);
        if (appended) {
          console.info(`[mail] IMAP attached ${appended} customer reply(ies)`);
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }
  } catch (err) {
    const message = (err as Error).message || String(err);
    console.warn("[mail] IMAP poll failed:", message);
    const authish =
      message.toLowerCase().includes("invalid") ||
      message.toLowerCase().includes("authentication") ||
      message.toLowerCase().includes("login");
    if (authish) {
      _imapBlockedUntil = Date.now() + 45 * 60 * 1000;
    }
  } finally {
    _imapBusy = false;
  }
  return appended;
}

export function startInboundMailboxTimer(): void {
  if (_imapTimer) return;
  if (!imapSettings()) {
    console.info("Inbound mailbox poller idle (IMAP not configured)");
    return;
  }
  const raw = String(process.env.IMAP_POLL_MS || "").trim();
  const ms = raw === "" ? 30_000 : Number(raw);
  if (!Number.isFinite(ms) || ms <= 0) {
    console.info("Inbound mailbox poller disabled (IMAP_POLL_MS<=0)");
    return;
  }
  const kick = () => {
    void pollInboundMailboxOnce();
  };
  kick();
  _imapTimer = setInterval(kick, ms);
  if (typeof _imapTimer.unref === "function") _imapTimer.unref();
  console.info(`Inbound mailbox poller started (every ${ms}ms)`);
}
