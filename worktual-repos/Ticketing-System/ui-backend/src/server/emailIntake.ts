/**
 * Email → ticket adapter.
 * Provider-agnostic JSON (or light SendGrid/Mailgun shapes) → intake create
 * or append a public note when In-Reply-To / References match a prior Message-ID.
 */
import { query } from "./db";
import { writeAuditEvent } from "./audit";
import { notifyOrgAgents, notifyUsers } from "./notifications";
import { createTicketFromIntake } from "./intake";
import {
  emailCustomerDssaDeflection,
  emailNotRegisteredCustomer,
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
): Promise<{ ticketId: string; ticketNumber: string } | null> {
  const clean = [...new Set(ids.map((id) => normalizeMessageId(id)).filter(Boolean))] as string[];
  if (!clean.length) return null;
  const { rows } = await query(
    `SELECT ticket_id::text AS ticket_id, ticket_number
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
  };
}

async function rememberMessageId(
  organizationId: string,
  messageId: string | null,
  ticketId: string,
  ticketNumber: string
): Promise<void> {
  const mid = normalizeMessageId(messageId);
  if (!mid) return;
  await query(
    `INSERT INTO ticketing.email_message_refs (
       organization_id, message_id, ticket_id, ticket_number
     ) VALUES ($1,$2,$3,$4)
     ON CONFLICT (organization_id, message_id) DO NOTHING`,
    [organizationId, mid, ticketId, ticketNumber]
  ).catch(() => undefined);
}

async function appendEmailNote(input: {
  organizationId: string;
  ticketId: string;
  ticketNumber: string;
  fromName: string;
  fromEmail: string;
  text: string;
  messageId: string | null;
}): Promise<{ status: string; subject: string }> {
  const body = `Email reply from ${input.fromName} <${input.fromEmail}>:\n\n${input.text}`;
  await query(
    `INSERT INTO ticket_notes (organization_id, ticket_id, author_id, author_name, body, visibility)
     VALUES ($1,$2,NULL,$3,$4,'public')`,
    [input.organizationId, input.ticketId, input.fromName, body]
  );
  await query(
    `UPDATE tickets SET updated_at = NOW() WHERE id = $1`,
    [input.ticketId]
  );
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
  if (assigneeId) {
    await notifyUsers({
      orgId: input.organizationId,
      userIds: [assigneeId],
      kind: "update",
      title: "New email on ticket",
      message: `${input.fromName} replied on ${input.ticketNumber}.`,
      ticketUuid: input.ticketId,
      customerName: input.fromName,
    });
  } else {
    await notifyOrgAgents({
      orgId: input.organizationId,
      kind: "update",
      title: "New email on ticket",
      message: `${input.fromName} replied on ${input.ticketNumber}.`,
      ticketUuid: input.ticketId,
      customerName: input.fromName,
    });
  }

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
    };

export async function processInboundEmail(input: {
  organizationId: string;
  body: Record<string, unknown>;
  actorName?: string;
  apiKeyId?: string;
}): Promise<EmailIntakeResult> {
  const parsed = parseInboundEmailBody(input.body);
  if (!parsed.fromEmail) {
    const err = new Error("from email is required");
    (err as { status?: number }).status = 400;
    throw err;
  }

  const threadIds = [
    parsed.inReplyTo,
    ...parsed.references,
  ].filter(Boolean) as string[];

  const existing = await findTicketByMessageIds(
    input.organizationId,
    threadIds
  );
  if (existing) {
    const appended = await appendEmailNote({
      organizationId: input.organizationId,
      ticketId: existing.ticketId,
      ticketNumber: existing.ticketNumber,
      fromName: parsed.fromName,
      fromEmail: parsed.fromEmail,
      text: parsed.text,
      messageId: parsed.messageId,
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

  let created;
  try {
    created = await createTicketFromIntake({
      organizationId: input.organizationId,
      channel: "email",
      requester: { name: parsed.fromName, email: parsed.fromEmail },
      subject: parsed.subject,
      description: parsed.text,
      externalRef: parsed.messageId || undefined,
      metadata: {
        messageId: parsed.messageId,
        inReplyTo: parsed.inReplyTo,
        source: "email_intake",
      },
      actorName: input.actorName || "Email intake",
      apiKeyId: input.apiKeyId,
      skipDssa: true,
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
