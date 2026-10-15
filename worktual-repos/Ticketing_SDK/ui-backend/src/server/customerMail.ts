/**
 * Outbound email (customer create/reply/resolve + staff create/SLA reminder/breach).
 * SMTP via env, or MAIL_MODE=log (default in dev) — records to outbound_email_log.
 */
import crypto from "crypto";
import nodemailer from "nodemailer";
import type { SendMailOptions, Transporter } from "nodemailer";
import { query } from "./db";

export type CustomerMailKind =
  | "ticket_created"
  | "ticket_reply"
  | "ticket_resolved"
  | "ticket_status"
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

/** Ticket / intake channel keys that keep replies in the portal unless inbound was email. */
const PORTAL_REPLY_CHANNELS = new Set([
  "web",
  "portal",
  "support_portal",
  "portal_chat",
  "chat",
]);

function normalizeMailChannel(raw: string | null | undefined): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replaceAll("-", "_");
}

function bodyFlagTrue(value: unknown): boolean {
  return value === true || value === 1 || value === "true" || value === "1";
}

/**
 * Public-note outbound reply. Uses stamped ticket/inbound channel from intake,
 * not the customer message text.
 */
export function shouldSendCustomerReplyEmail(input: {
  ticketChannel?: string | null;
  lastCustomerInboundChannel?: string | null;
  sendCustomerEmail?: unknown;
  skipCustomerEmail?: unknown;
}): boolean {
  if (bodyFlagTrue(input.skipCustomerEmail)) return false;
  if (bodyFlagTrue(input.sendCustomerEmail)) return true;
  const inbound = normalizeMailChannel(input.lastCustomerInboundChannel);
  if (inbound === "email") return true;
  const ticket = normalizeMailChannel(input.ticketChannel);
  if (ticket === "email") return true;
  return !PORTAL_REPLY_CHANNELS.has(ticket);
}

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

export function mailMode(): "smtp" | "log" | "off" {
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
let lastSmtpBlock: {
  at: string;
  kind: string;
  organizationId: string;
  error: string;
} | null = null;

function maskMailAddress(raw: string): string {
  const value = String(raw || "").trim();
  const at = value.indexOf("@");
  if (at < 1) return value ? "***" : "(none)";
  return `${value.slice(0, 1)}***${value.slice(at)}`;
}

function smtpSetupSummary(): {
  mode: string;
  host: string;
  port: number;
  user: string;
} {
  return {
    mode: mailMode(),
    host: String(process.env.SMTP_HOST || "").trim() || "(none)",
    port: Number(process.env.SMTP_PORT || 587),
    user: maskMailAddress(String(process.env.SMTP_USER || "")),
  };
}

function smtpCooldownRemainingSec(): number {
  return Math.max(0, Math.ceil((smtpBlockedUntil - Date.now()) / 1000));
}

/** False when MAIL_MODE=off or Gmail cooldown is active — skip SMTP loops. */
export function outboundMailActive(): boolean {
  const mode = mailMode();
  if (mode === "off") return false;
  if (mode === "smtp" && Date.now() < smtpBlockedUntil) return false;
  return true;
}

function isSlaMailKind(kind: string): boolean {
  return kind === SLA_REMINDER_KIND || kind === SLA_BREACH_ADMIN_KIND;
}

/**
 * SLA reminder/breach SMTP is off unless SLA_MAIL=on|smtp|1|true.
 * Create / reply / resolve / staff assign still follow MAIL_MODE only.
 */
export function slaMailEnabled(): boolean {
  const v = String(process.env.SLA_MAIL || "").trim().toLowerCase();
  return v === "on" || v === "smtp" || v === "1" || v === "true";
}

/** Past-due / already Overdue tickets: log SLA kinds as skipped so SMTP never backfills them. */
export async function stampPastDueSlaMailSkipped(
  organizationId: string
): Promise<void> {
  await query(
    `INSERT INTO ticketing.outbound_email_log (
       organization_id, ticket_id, ticket_number, kind, to_email, subject,
       body_preview, status, error
     )
     SELECT t.organization_id,
            t.id,
            t.ticket_number,
            k.kind,
            '(sla-mail-off)',
            CASE
              WHEN k.kind = $2 THEN '[SLA skipped] ' || COALESCE(t.ticket_number, '')
              ELSE '[SLA reminder skipped] ' || COALESCE(t.ticket_number, '')
            END,
            'SLA SMTP off — past-due or Overdue ticket',
            'skipped',
            'sla_mail_off'
       FROM tickets t
       CROSS JOIN (VALUES ($2), ($3)) AS k(kind)
      WHERE t.organization_id = $1::bigint
        AND t.due_at IS NOT NULL
        AND (t.due_at < NOW() OR t.status = 'Overdue')
        AND NOT EXISTS (
          SELECT 1 FROM ticketing.outbound_email_log l
           WHERE l.ticket_id = t.id
             AND l.kind = k.kind
        )`,
    [organizationId, SLA_BREACH_ADMIN_KIND, SLA_REMINDER_KIND]
  ).catch((e) =>
    console.warn("SLA backlog skip-stamp failed:", (e as Error).message)
  );
}

async function recentFailedOutboundMail(
  organizationId: string
): Promise<Array<{ kind: string; error: string; createdAt: string }>> {
  try {
    const { rows } = await query(
      `SELECT kind, COALESCE(error, '') AS error, created_at
       FROM ticketing.outbound_email_log
       WHERE organization_id = $1::bigint
         AND status = 'failed'
       ORDER BY created_at DESC
       LIMIT 5`,
      [organizationId]
    );
    return rows.map((row) => ({
      kind: String(row.kind || ""),
      error: String(row.error || "").slice(0, 180),
      createdAt: row.created_at ? new Date(String(row.created_at)).toISOString() : "",
    }));
  } catch {
    return [];
  }
}

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

function mailboxEncryptionKey(): Buffer | null {
  const raw = String(process.env.MS_TOKEN_ENCRYPTION_KEY || "").trim();
  if (!raw) return null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  if (Buffer.byteLength(raw) === 32) return Buffer.from(raw, "utf8");
  try {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 32) return decoded;
  } catch {
    /* not base64 */
  }
  return null;
}

function decryptMailboxSecret(packed: string, key: Buffer): string | null {
  const parts = String(packed || "").split(":");
  if (parts.length !== 3 || parts.some((part) => !part)) return null;
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(parts[0], "base64")
    );
    decipher.setAuthTag(Buffer.from(parts[1], "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(parts[2], "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

function encryptMailboxSecret(plain: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

function mailboxFrom(email: string, name: string | null | undefined): string {
  const addr = String(email || "").trim();
  const label = String(name || "").trim().replace(/"/g, "");
  return label ? `"${label}" <${addr}>` : addr;
}

type TicketingMailbox = {
  from: string;
  send: (mail: SendMailOptions) => Promise<{ messageId?: string }>;
};

async function refreshGoogleAccessToken(input: {
  oauthId: string;
  refreshToken: string;
  key: Buffer;
}): Promise<string | null> {
  const clientId = String(process.env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.GOOGLE_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret || !input.refreshToken) return null;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: input.refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(8_000),
  });
  const data = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!response.ok || !data.access_token) {
    if (data.error === "invalid_grant") {
      await query(
        `UPDATE accounts.mail_oauth_connections
            SET needs_reauth = true, updated_at = NOW()
          WHERE id = $1`,
        [input.oauthId]
      ).catch(() => undefined);
    }
    return null;
  }
  const expiresAt = new Date(Date.now() + Number(data.expires_in || 3600) * 1000);
  const nextRefresh = String(data.refresh_token || "").trim();
  await query(
    `UPDATE accounts.mail_oauth_connections
        SET access_token_encrypted = $2,
            refresh_token_encrypted = COALESCE($3, refresh_token_encrypted),
            expires_at = $4,
            needs_reauth = false,
            updated_at = NOW()
      WHERE id = $1`,
    [
      input.oauthId,
      encryptMailboxSecret(data.access_token, input.key),
      nextRefresh ? encryptMailboxSecret(nextRefresh, input.key) : null,
      expiresAt,
    ]
  );
  return data.access_token;
}

async function sendViaGmail(
  accessToken: string,
  mail: SendMailOptions
): Promise<{ messageId?: string }> {
  const preview = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: "unix",
  });
  const built = await preview.sendMail(mail);
  const message = (built as { message?: Buffer }).message;
  if (!Buffer.isBuffer(message)) throw new Error("mailbox_message_build_failed");
  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: message.toString("base64url") }),
      signal: AbortSignal.timeout(15_000),
    }
  );
  if (!response.ok) {
    throw new Error(`gmail_send_${response.status}`);
  }
  return { messageId: mail.messageId ? String(mail.messageId) : built.messageId };
}

/** Active Ticketing mailbox for this org. Missing config keeps the shared SMTP sender. */
async function loadTicketingMailbox(
  organizationId: string
): Promise<TicketingMailbox | null> {
  const orgId = String(organizationId || "").trim();
  if (!/^\d+$/.test(orgId)) return null;
  const key = mailboxEncryptionKey();
  if (!key) return null;
  try {
    const { rows } = await query<{
      provider_type: string | null;
      third_party_mode: string | null;
      oauth_provider: string | null;
      sender_email: string | null;
      sender_name: string | null;
      smtp_host: string | null;
      smtp_port: number | null;
      smtp_secure: boolean | null;
      smtp_user_encrypted: string | null;
      smtp_pass_encrypted: string | null;
      oauth_id: string | null;
      account_email: string | null;
      access_token_encrypted: string | null;
      refresh_token_encrypted: string | null;
      expires_at: Date | string | null;
      needs_reauth: boolean | null;
      scope: string | null;
    }>(
      `SELECT e.provider_type,
              e.third_party_mode,
              e.oauth_provider,
              e.sender_email,
              e.sender_name,
              e.smtp_host,
              e.smtp_port,
              e.smtp_secure,
              e.smtp_user_encrypted,
              e.smtp_pass_encrypted,
              o.id::text AS oauth_id,
              o.account_email,
              o.access_token_encrypted,
              o.refresh_token_encrypted,
              o.expires_at,
              o.needs_reauth,
              o.scope
         FROM accounts.setup_channel_configs c
         JOIN accounts.setup_email_configs e ON e.channel_config_id = c.id
         LEFT JOIN accounts.mail_oauth_connections o ON o.id = e.oauth_connection_id
        WHERE c.organization_id = $1::bigint
          AND c.channel_type = 'email'
          AND c.status = 'active'
          AND c.product_ids @> '["ticketing"]'::jsonb
        ORDER BY c.updated_at DESC
        LIMIT 1`,
      [orgId]
    );
    const row = rows[0];
    if (!row) return null;
    const fromEmail = String(row.sender_email || row.account_email || "").trim();
    if (!fromEmail) return null;
    const from = mailboxFrom(fromEmail, row.sender_name);
    const mode = String(row.third_party_mode || "").trim().toLowerCase();
    const provider = String(row.provider_type || "").trim().toLowerCase();

    if (
      provider === "third_party" &&
      mode === "oauth" &&
      String(row.oauth_provider || "").toLowerCase() === "google" &&
      row.oauth_id &&
      !row.needs_reauth &&
      String(row.scope || "").includes("https://www.googleapis.com/auth/gmail.send")
    ) {
      let access = decryptMailboxSecret(String(row.access_token_encrypted || ""), key);
      const refresh = decryptMailboxSecret(String(row.refresh_token_encrypted || ""), key);
      const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
      if (!access || !Number.isFinite(expiresAt) || expiresAt < Date.now() + 60_000) {
        access = refresh
          ? await refreshGoogleAccessToken({
              oauthId: row.oauth_id,
              refreshToken: refresh,
              key,
            })
          : null;
      }
      if (!access) return null;
      const token = access;
      return {
        from,
        send: (mail) => sendViaGmail(token, { ...mail, from }),
      };
    }

    if (provider === "third_party" && mode === "smtp" && row.smtp_host) {
      const user = decryptMailboxSecret(String(row.smtp_user_encrypted || ""), key);
      const pass = decryptMailboxSecret(String(row.smtp_pass_encrypted || ""), key);
      if (!user || !pass) return null;
      const tx = nodemailer.createTransport({
        host: String(row.smtp_host).trim(),
        port: Number(row.smtp_port || 587),
        secure: Boolean(row.smtp_secure),
        connectionTimeout: 8_000,
        greetingTimeout: 8_000,
        socketTimeout: 12_000,
        auth: { user, pass },
      });
      return {
        from,
        send: (mail) => tx.sendMail({ ...mail, from }),
      };
    }
  } catch (err) {
    console.warn("[mail] ticketing mailbox lookup skipped", {
      organizationId: orgId,
      error: String((err as Error).message || err).slice(0, 180),
    });
  }
  return null;
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

/** Staff reply mail can thread. Ack/status mail is send-only and must not. */
const TICKET_THREAD_MAIL_KINDS = new Set<OutboundMailKind>(["ticket_reply"]);

const ACK_OUTBOUND_KINDS = new Set<OutboundMailKind>([
  "ticket_created",
  "ticket_resolved",
  "ticket_status",
]);

const ACK_NO_REPLY_LINE =
  "This is an automated message from Ticketing. Please do not reply to this email. Replies are not read.";

/** Outbound Message-ID we stamp on ack mail: `<ticket_created.1553.stamp@ticketing.worktual>`. */
export function isAckOutboundMessageId(raw: string | null | undefined): boolean {
  const id = String(raw || "")
    .trim()
    .replace(/^<|>$/g, "")
    .trim()
    .toLowerCase();
  if (!id) return false;
  return (
    id.startsWith("ticket_created.") ||
    id.startsWith("ticket_status.") ||
    id.startsWith("ticket_resolved.")
  );
}

/** Subject of our ack/status templates (Re:/Fwd: + [ticket] prefix allowed). */
export function looksLikeAckMailSubject(raw: string | null | undefined): boolean {
  let s = String(raw || "").replace(/\s+/g, " ").trim();
  if (!s) return false;
  for (let i = 0; i < 6; i++) {
    const next = s.replace(/^(re|fwd|fw)\s*:\s*/i, "").trim();
    if (next === s) break;
    s = next;
  }
  s = s.replace(/^\[[^\]]+\]\s*/, "").trim();
  return (
    /^we received your request\b/i.test(s) ||
    /^your ticket is open\b/i.test(s) ||
    /^we are working on your ticket\b/i.test(s) ||
    /^your ticket was reopened\b/i.test(s) ||
    /^your request was resolved\b/i.test(s) ||
    /^your ticket is closed\b/i.test(s) ||
    /^your ticket is now\b/i.test(s)
  );
}

function ackNoReplyAddress(): string {
  const explicit = String(process.env.MAIL_NOREPLY || "").trim();
  if (explicit) return explicit;
  const from = fromAddress();
  const m = from.match(/<([^>]+)>/);
  const addr = (m ? m[1] : from).trim();
  if (/noreply|no-reply/i.test(addr)) return addr;
  return "noreply@worktual.local";
}

/** Shown as the outbound author in ticket Conversations. Staff replies keep the agent name. */
export const CONVERSATION_SUPPORT_AUTHOR = "Support";

/** Status/ack mail still sends; do not copy those templates into Conversations. */
const CONVERSATION_OUTBOUND_NOTE_KINDS = new Set<OutboundMailKind>();

async function recordOutboundConversationNote(input: {
  organizationId: string;
  ticketId: string;
  subject: string;
  text: string;
}): Promise<void> {
  const ticketId = String(input.ticketId || "").trim();
  const text = String(input.text || "").trim();
  if (!ticketId || !text) return;
  const subject = String(input.subject || "").trim();
  const body = subject ? `${subject}\n\n${text}` : text;
  await query(
    `INSERT INTO ticket_notes (
       organization_id, ticket_id, author_id, author_name, body, visibility
     ) VALUES ($1,$2::bigint,NULL,$3,$4,'public')`,
    [input.organizationId, ticketId, CONVERSATION_SUPPORT_AUTHOR, body]
  ).catch((e) =>
    console.warn("ticket conversation note (outbound) failed:", (e as Error).message)
  );
}

function normalizeStoredMessageId(raw: string | undefined | null): string | null {
  const s = String(raw || "")
    .trim()
    .replace(/^<|>$/g, "")
    .trim();
  return s || null;
}

function outboundTicketMessageId(
  kind: OutboundMailKind,
  ticketNumber: string
): string {
  const token = String(ticketNumber || "ticket")
    .trim()
    .replaceAll("#", "")
    .replaceAll(" ", "") || "ticket";
  const stamp = `${Date.now()}.${Math.random().toString(36).slice(2, 10)}`;
  return `<${kind}.${token}.${stamp}@ticketing.worktual>`;
}

export async function rememberTicketEmailMessageId(input: {
  organizationId: string;
  messageId: string | null | undefined;
  ticketId: string;
  ticketNumber: string;
}): Promise<void> {
  const mid = normalizeStoredMessageId(input.messageId);
  const ticketId = String(input.ticketId || "").trim();
  const ticketNumber = String(input.ticketNumber || "").trim();
  if (!mid || !ticketId || !ticketNumber) return;
  await query(
    `INSERT INTO ticketing.email_message_refs (
       organization_id, message_id, ticket_id, ticket_number
     ) VALUES ($1,$2,$3,$4)
     ON CONFLICT (organization_id, message_id) DO NOTHING`,
    [input.organizationId, mid, ticketId, ticketNumber]
  ).catch((e) =>
    console.warn("email_message_refs write failed:", (e as Error).message)
  );
}

async function latestTicketThreadMessageId(
  organizationId: string,
  ticketId: string
): Promise<string | null> {
  const id = String(ticketId || "").trim();
  if (!id) return null;
  const { rows } = await query<{ message_id: string }>(
    `SELECT message_id
       FROM ticketing.email_message_refs
      WHERE organization_id = $1 AND ticket_id = $2::bigint
      ORDER BY created_at DESC
      LIMIT 1`,
    [organizationId, id]
  );
  return rows[0]?.message_id ? String(rows[0].message_id) : null;
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
  if (isSlaMailKind(input.kind) && !slaMailEnabled()) {
    const ticketId = String(input.ticketId || "").trim();
    if (ticketId && !(await hasOutboundEmailKind(ticketId, input.kind))) {
      await query(
        `INSERT INTO ticketing.outbound_email_log (
           organization_id, ticket_id, ticket_number, kind, to_email, subject,
           body_preview, status, error
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'skipped',$8)`,
        [
          input.organizationId,
          ticketId,
          String(input.ticketNumber || "").trim() || null,
          input.kind,
          "(sla-mail-off)",
          input.subject,
          "SLA SMTP off",
          "sla_mail_off",
        ]
      ).catch(() => undefined);
    }
    return { sent: false, mode: "sla_off" };
  }
  if (mode === "off") {
    return { sent: false, mode };
  }
  if (mode === "smtp" && Date.now() < smtpBlockedUntil) {
    console.warn("[mail] skip send: SMTP cooldown still active", {
      kind: input.kind,
      organizationId: input.organizationId,
      to: maskMailAddress(to),
      remainingSec: smtpCooldownRemainingSec(),
      lastBlock: lastSmtpBlock,
    });
    return { sent: false, mode, error: "smtp_temporarily_blocked" };
  }

  const preview = input.text.slice(0, 500);
  let status = "queued";
  let error: string | null = null;
  const threadKind = TICKET_THREAD_MAIL_KINDS.has(input.kind);
  const ticketId = String(input.ticketId || "").trim();
  const ticketNumber = String(input.ticketNumber || "").trim();
  const assignedMessageId =
    threadKind && ticketNumber
      ? outboundTicketMessageId(input.kind, ticketNumber)
      : undefined;
  let priorThreadId: string | null = null;
  if (threadKind && ticketId) {
    priorThreadId = await latestTicketThreadMessageId(
      input.organizationId,
      ticketId
    );
  }
  let storedMessageId = assignedMessageId
    ? normalizeStoredMessageId(assignedMessageId)
    : null;

  try {
    if (mode === "log") {
      status = "logged";
      console.info(
        `[mail:log] kind=${input.kind} to=${to} subject=${input.subject} ticket=${input.ticketNumber || ""}`
      );
    } else {
      const ackOnly = ACK_OUTBOUND_KINDS.has(input.kind);
      const mail: SendMailOptions = {
        to: input.toName ? `"${input.toName}" <${to}>` : to,
        subject: input.subject,
        text: input.text,
        messageId: assignedMessageId,
        replyTo: ackOnly ? ackNoReplyAddress() : undefined,
        inReplyTo: priorThreadId ? `<${priorThreadId}>` : undefined,
        references: priorThreadId ? `<${priorThreadId}>` : undefined,
      };
      const mailbox = await loadTicketingMailbox(input.organizationId);
      let info: { messageId?: string } | undefined;
      if (mailbox) {
        try {
          info = (await Promise.race([
            mailbox.send(mail),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("smtp_send_timeout")), 15_000)
            ),
          ])) as { messageId?: string };
        } catch (err) {
          console.warn("[mail] ticketing mailbox send failed; using shared SMTP", {
            kind: input.kind,
            organizationId: input.organizationId,
            to: maskMailAddress(to),
            error: String((err as Error).message || err).slice(0, 180),
          });
        }
      }
      if (!info) {
        const tx = getTransporter();
        if (!tx) {
          status = "failed";
          error = "smtp_not_configured";
        } else {
          info = (await Promise.race([
            tx.sendMail({ ...mail, from: fromAddress() }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("smtp_send_timeout")), 15_000)
            ),
          ])) as { messageId?: string };
        }
      }
      if (info) {
        storedMessageId =
          normalizeStoredMessageId(info.messageId) || storedMessageId;
        status = "sent";
      }
    }
  } catch (err) {
    status = "failed";
    error = (err as Error).message;
    transporter = null;
    if (isSmtpAuthError(error)) {
      smtpBlockedUntil = Date.now() + smtpCooldownMs();
      lastSmtpBlock = {
        at: new Date().toISOString(),
        kind: input.kind,
        organizationId: input.organizationId,
        error: String(error).slice(0, 240),
      };
      console.warn("[mail] SMTP auth failed; starting cooldown", {
        kind: input.kind,
        organizationId: input.organizationId,
        to: maskMailAddress(to),
        cooldownMin: Math.round(smtpCooldownMs() / 60000),
        remainingSec: smtpCooldownRemainingSec(),
        smtp: smtpSetupSummary(),
        error: lastSmtpBlock.error,
      });
    } else {
      console.warn("[mail] send failed", {
        kind: input.kind,
        organizationId: input.organizationId,
        to: maskMailAddress(to),
        smtp: smtpSetupSummary(),
        error: String(error).slice(0, 240),
      });
    }
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

  if (
    threadKind &&
    (status === "sent" || status === "logged") &&
    ticketId &&
    ticketNumber &&
    storedMessageId
  ) {
    await rememberTicketEmailMessageId({
      organizationId: input.organizationId,
      messageId: storedMessageId,
      ticketId,
      ticketNumber,
    });
  }

  if (
    CONVERSATION_OUTBOUND_NOTE_KINDS.has(input.kind) &&
    (status === "sent" || status === "logged") &&
    ticketId
  ) {
    await recordOutboundConversationNote({
      organizationId: input.organizationId,
      ticketId,
      subject: input.subject,
      text: input.text,
    });
  }

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
      ACK_NO_REPLY_LINE,
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

function customerStatusMailCopy(input: {
  status: string;
  displayName: string;
  name: string;
  ticketNumber: string;
  subject: string;
}): { kind: "ticket_resolved" | "ticket_status"; subject: string; text: string } {
  const name = input.name;
  const ticket = input.ticketNumber;
  const title = input.subject;
  const key = String(input.status || "").trim().toLowerCase();
  if (key === "open") {
    return {
      kind: "ticket_status",
      subject: `[${ticket}] Your ticket is open`,
      text: [
        `Hi ${name},`,
        "",
        `Your ticket ${ticket} ("${title}") is now Open.`,
        "We have it in the queue and will pick it up.",
        "",
        ACK_NO_REPLY_LINE,
        "",
        "— Support",
      ].join("\n"),
    };
  }
  if (key === "pending") {
    return {
      kind: "ticket_status",
      subject: `[${ticket}] We are working on your ticket`,
      text: [
        `Hi ${name},`,
        "",
        `Your ticket ${ticket} ("${title}") is now In Progress.`,
        "Someone on the team is working on it. We will write again when we have an update.",
        "",
        ACK_NO_REPLY_LINE,
        "",
        "— Support",
      ].join("\n"),
    };
  }
  if (key === "reopened") {
    return {
      kind: "ticket_status",
      subject: `[${ticket}] Your ticket was reopened`,
      text: [
        `Hi ${name},`,
        "",
        `Your ticket ${ticket} ("${title}") was reopened.`,
        "We will continue from where we left off.",
        "",
        ACK_NO_REPLY_LINE,
        "",
        "— Support",
      ].join("\n"),
    };
  }
  if (key === "resolved") {
    return {
      kind: "ticket_resolved",
      subject: `[${ticket}] Your request was resolved`,
      text: [
        `Hi ${name},`,
        "",
        `Your ticket ${ticket} ("${title}") was marked resolved.`,
        "If you still need help, open a new request.",
        ACK_NO_REPLY_LINE,
        "",
        "— Support",
      ].join("\n"),
    };
  }
  if (key === "closed") {
    return {
      kind: "ticket_status",
      subject: `[${ticket}] Your ticket is closed`,
      text: [
        `Hi ${name},`,
        "",
        `Your ticket ${ticket} ("${title}") is now Closed.`,
        "We treat this request as finished. If you need help again, open a new request.",
        ACK_NO_REPLY_LINE,
        "",
        "— Support",
      ].join("\n"),
    };
  }
  const label = input.displayName || input.status || "updated";
  return {
    kind: "ticket_status",
    subject: `[${ticket}] Your ticket is now ${label}`,
    text: [
      `Hi ${name},`,
      "",
      `Your ticket ${ticket} ("${title}") is now ${label}.`,
      "",
      ACK_NO_REPLY_LINE,
      "",
      "— Support",
    ].join("\n"),
  };
}

export async function emailCustomerTicketStatusChanged(input: {
  organizationId: string;
  ticketId: string;
  ticketNumber: string;
  subject: string;
  customerName: string;
  customerEmail: string;
  status: string;
  displayName?: string;
}): Promise<void> {
  const key = String(input.status || "").trim().toLowerCase();
  if (!key || key === "overdue") return;
  const name = input.customerName || "there";
  const copy = customerStatusMailCopy({
    status: input.status,
    displayName: input.displayName || input.status,
    name,
    ticketNumber: input.ticketNumber,
    subject: input.subject,
  });
  await sendCustomerEmail({
    organizationId: input.organizationId,
    ticketId: input.ticketId,
    ticketNumber: input.ticketNumber,
    toEmail: input.customerEmail,
    toName: input.customerName,
    kind: copy.kind,
    subject: copy.subject,
    text: copy.text,
  });
}

export function queueCustomerStatusChangeEmail(input: {
  organizationId: string;
  ticketId: string;
  ticketNumber: string;
  subject: string;
  customerName: string;
  customerEmail?: string | null;
  status: string;
  displayName?: string;
}): void {
  const email = String(input.customerEmail || "").trim();
  const status = String(input.status || "").trim();
  if (!email || !status || status.toLowerCase() === "overdue") return;
  if (isPlaceholderEmail(email)) return;
  void emailCustomerTicketStatusChanged({
    organizationId: input.organizationId,
    ticketId: input.ticketId,
    ticketNumber: input.ticketNumber,
    subject: input.subject,
    customerName: input.customerName,
    customerEmail: email,
    status,
    displayName: input.displayName,
  }).catch((e) =>
    console.warn("customer mail (status) failed:", (e as Error).message)
  );
}

export async function emailCustomerTicketResolved(input: {
  organizationId: string;
  ticketId: string;
  ticketNumber: string;
  subject: string;
  customerName: string;
  customerEmail: string;
}): Promise<void> {
  await emailCustomerTicketStatusChanged({
    ...input,
    status: "Resolved",
    displayName: "Resolved",
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

/** Breach — email org admins, assignee, and resolver once per ticket. */
export async function emailAdminSlaBreach(input: {
  organizationId: string;
  ticketId: string;
  ticketNumber: string;
  subject: string;
  assigneeId?: string | null;
  resolverId?: string | null;
  assigneeName?: string | null;
  resolverName?: string | null;
  dueAt?: string | Date | null;
}): Promise<{ sent: number }> {
  if (await hasOutboundEmailKind(input.ticketId, SLA_BREACH_ADMIN_KIND)) {
    return { sent: 0 };
  }
  const [admins, staff] = await Promise.all([
    emailsForOrgAdmins(input.organizationId),
    emailsForUserIds(input.organizationId, [input.assigneeId, input.resolverId]),
  ]);
  const seen = new Set<string>();
  const recipients = [...admins, ...staff].filter((r) => {
    const key = r.email.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!recipients.length) {
    await query(
      `INSERT INTO ticketing.outbound_email_log (
         organization_id, ticket_id, ticket_number, kind, to_email, subject, body_preview, status, error
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'logged',$8)`,
      [
        input.organizationId,
        input.ticketId,
        input.ticketNumber,
        SLA_BREACH_ADMIN_KIND,
        "(no-breach-email)",
        `[SLA breached] ${input.ticketNumber}`,
        "No admin, assignee, or resolver email on file",
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
  for (const r of recipients) {
    const result = await sendCustomerEmail({
      organizationId: input.organizationId,
      ticketId: input.ticketId,
      ticketNumber: input.ticketNumber,
      toEmail: r.email,
      toName: r.name || null,
      kind: SLA_BREACH_ADMIN_KIND,
      subject: `[SLA breached] ${input.ticketNumber} needs attention`,
      text: [
        `Hi ${r.name || "there"},`,
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
