/**
 * Live CCaaS email thread. Postgres remains ticket SoT.
 * CCAAS_EMAIL_SP=on (default) → MySQL CALL. off → cdp + ccass tables.
 * Read-only: never invent messages.
 */
import mysql from "mysql2/promise";
import { query } from "./db";
import { customerReplyPlainText } from "./emailIntake";
import { formatConversationDateTime } from "./sla";

export type CcaasEmailRole = "user" | "bot" | "agent";

export type CcaasEmailMessage = {
  id: string;
  role: CcaasEmailRole;
  author: string;
  text: string;
  subject?: string;
  fromEmail?: string;
  toEmail?: string;
  time: string;
  at: string;
  lane: "in" | "out";
};

type MysqlRow = Record<string, unknown>;

let pool: mysql.Pool | null = null;

function env(name: string, fallback = ""): string {
  return String(process.env[name] || fallback).trim();
}

export function ccaasEmailConfigured(): boolean {
  return Boolean(
    env("CCAAS_MYSQL_HOST") &&
      env("CCAAS_MYSQL_USER") &&
      env("CCAAS_MYSQL_DATABASE")
  );
}

/** Same pattern as SLA_MAIL: on = legacy MySQL SP; off = ccass tables. Default on. */
export function ccaasEmailSpEnabled(): boolean {
  const v = env("CCAAS_EMAIL_SP", "on").toLowerCase();
  return v === "on" || v === "1" || v === "true" || v === "sp";
}

function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: env("CCAAS_MYSQL_HOST"),
      user: env("CCAAS_MYSQL_USER"),
      password: env("CCAAS_MYSQL_PASSWORD"),
      database: env("CCAAS_MYSQL_DATABASE"),
      port: Number(env("CCAAS_MYSQL_PORT", "3306")) || 3306,
      waitForConnections: true,
      connectionLimit: 4,
      connectTimeout: 8000,
    });
  }
  return pool;
}

function asRecord(value: unknown): MysqlRow | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as MysqlRow)
    : null;
}

function pick(row: MysqlRow | null, names: string[]): unknown {
  if (!row) return undefined;
  const keys = Object.keys(row);
  for (const name of names) {
    const hit = keys.find((k) => k.toLowerCase() === name.toLowerCase());
    if (hit != null && row[hit] != null && row[hit] !== "") return row[hit];
  }
  return undefined;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text.startsWith("[") && !text.startsWith("{")) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

export function stripHtmlToText(raw: string): string {
  return String(raw || "")
    .replace(/\r\n/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function inboundCustomerText(raw: string): string {
  const plain = stripHtmlToText(raw);
  if (!plain) return "";
  return customerReplyPlainText(plain) || plain;
}

function cleanUserBody(raw: string): string {
  let text = inboundCustomerText(raw);
  const quote = text.search(/\n_{8,}\n|\nFrom:\s.+\nSent:/i);
  if (quote > 20) text = text.slice(0, quote).trim();
  text = text
    .replace(/<https?:\/\/[^>\s]+>/g, "")
    .replace(/<mailto:[^>]+>/gi, "")
    .replace(/\[https?:\/\/[^\]]+\]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text;
}

function displayNameFromFrom(raw: unknown): string {
  const text = String(raw || "").trim();
  const quoted = text.match(/^"([^"]+)"/);
  if (quoted?.[1]) return quoted[1].trim();
  const angle = text.match(/^([^<]+)</);
  if (angle?.[1]?.trim()) return angle[1].trim();
  return "";
}

function emailFromAddress(raw: unknown): string | undefined {
  const text = String(raw || "").trim();
  if (!text) return undefined;
  const angle = text.match(/<([^>]+)>/);
  const value = (angle?.[1] || text).trim().toLowerCase();
  if (!value.includes("@") || value.includes(" ")) return undefined;
  return value;
}

function toIso(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  const n = Number(value);
  if (Number.isFinite(n) && n > 1e11) {
    return new Date(n).toISOString();
  }
  const s = String(value || "").trim();
  if (!s) return new Date().toISOString();
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function messagePayload(wrapper: unknown): MysqlRow | null {
  const outer = asRecord(wrapper);
  const inner = asRecord(pick(outer, ["message"]) ?? outer);
  return inner || outer;
}

function flattenSession(row: MysqlRow, index: number): CcaasEmailMessage[] {
  const historyId = String(
    pick(row, ["EmailHistoryId", "emailHistoryId", "id"]) || index
  );
  const sessionAgentId = pick(row, ["AgentId", "agentId"]);
  const chunks = parseMaybeJson(pick(row, ["Message", "message"]));
  const list = Array.isArray(chunks) ? chunks : [];
  const out: CcaasEmailMessage[] = [];

  list.forEach((chunk, i) => {
    const block = asRecord(chunk);
    const userWrap = pick(block, ["userText", "usertext"]);
    const agentWrap = pick(block, ["agentText", "agenttext"]);

    const userMsg = messagePayload(userWrap);
    const userBody = cleanUserBody(String(pick(userMsg, ["message", "body", "text"]) || ""));
    if (userBody) {
      const at = toIso(pick(userMsg, ["sendAt", "sendat", "createdAt"]));
      out.push({
        id: `ccaas-${historyId}-u-${i}`,
        role: "user",
        author: displayNameFromFrom(pick(userMsg, ["fromData", "from"])) || "Customer",
        text: userBody,
        subject: String(pick(userMsg, ["subject", "EmailSubject"]) || "").trim() || undefined,
        fromEmail: emailFromAddress(pick(userMsg, ["fromData", "from", "fromEmail"])),
        toEmail: emailFromAddress(pick(userMsg, ["toData", "to", "toEmail"])),
        time: formatConversationDateTime(at),
        at,
        lane: "in",
      });
    }

    const agentMsg = messagePayload(agentWrap);
    const agentBody = stripHtmlToText(
      String(pick(agentMsg, ["message", "body", "text"]) || "")
    );
    if (agentBody) {
      const botFlag = pick(agentMsg, ["isBot", "isbot"]);
      const role: CcaasEmailRole =
        botFlag === false || botFlag === 0 || botFlag === "0"
          ? "agent"
          : botFlag === true || botFlag === 1 || botFlag === "1"
            ? "bot"
            : sessionAgentId
              ? "agent"
              : "bot";
      const at = toIso(pick(agentMsg, ["sendAt", "sendat", "createdAt"]));
      out.push({
        id: `ccaas-${historyId}-a-${i}`,
        role,
        author:
          role === "agent"
            ? displayNameFromFrom(pick(agentMsg, ["from"])) || "Agent"
            : "Email bot",
        text: agentBody,
        subject:
          String(pick(agentMsg, ["EmailSubject", "subject"]) || "").trim() ||
          undefined,
        fromEmail: emailFromAddress(pick(agentMsg, ["from", "fromData", "fromEmail"])),
        toEmail: emailFromAddress(pick(agentMsg, ["to", "toData", "toEmail"])),
        time: formatConversationDateTime(at),
        at,
        lane: "out",
      });
    }
  });

  return out;
}

export function mapCcaasEmailRows(rows: unknown[]): CcaasEmailMessage[] {
  const messages = (rows || []).flatMap((row, i) => {
    const rec = asRecord(row);
    return rec ? flattenSession(rec, i) : [];
  });
  messages.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return messages;
}

export async function listCcaasEmailConversation(
  customerEmail: string
): Promise<CcaasEmailMessage[]> {
  const email = String(customerEmail || "").trim().toLowerCase();
  if (!email || !ccaasEmailConfigured()) return [];
  const domainId = Number(env("CCAAS_EMAIL_DOMAIN_ID", "20708")) || 20708;
  const [raw] = await getPool().query(
    "CALL ccaas_ai_get_email_conversation(?, ?)",
    [domainId, email]
  );
  const sets = Array.isArray(raw) ? raw : [];
  const first = Array.isArray(sets[0]) ? sets[0] : sets;
  return mapCcaasEmailRows(Array.isArray(first) ? first : []);
}

function senderRole(senderType: string): CcaasEmailRole | null {
  const key = senderType.trim().toLowerCase();
  if (key === "customer" || key === "user" || key === "visitor") return "user";
  if (key === "bot") return "bot";
  if (key === "agent" || key === "staff") return "agent";
  return null;
}

function senderLane(
  role: CcaasEmailRole,
  direction: string
): "in" | "out" {
  const dir = direction.trim().toLowerCase();
  if (dir === "inbound" || dir === "in") return "in";
  if (dir === "outbound" || dir === "out") return "out";
  return role === "user" ? "in" : "out";
}

export function mapCcassTableMessages(
  conversations: Array<{
    id: string;
    subject?: string | null;
    visitor_id?: string | null;
  }>,
  messages: Array<{
    id: string;
    conversation_id: string;
    sender_type?: string | null;
    direction?: string | null;
    body?: string | null;
    created_at?: unknown;
  }>
): CcaasEmailMessage[] {
  const subjects = new Map<string, { subject?: string; visitor?: string }>();
  for (const conv of conversations) {
    const id = String(conv.id || "").trim();
    if (!id) continue;
    subjects.set(id, {
      subject: String(conv.subject || "").trim() || undefined,
      visitor: String(conv.visitor_id || "").trim() || undefined,
    });
  }

  const out: CcaasEmailMessage[] = [];
  for (const row of messages) {
    const role = senderRole(String(row.sender_type || ""));
    if (!role) continue;
    const conversationId = String(row.conversation_id || "").trim();
    const meta = subjects.get(conversationId) || {};
    const at = toIso(row.created_at);
    const lane = senderLane(role, String(row.direction || ""));
    const rawBody = String(row.body || "");
    const text =
      lane === "in"
        ? inboundCustomerText(rawBody)
        : stripHtmlToText(rawBody);
    if (!text) continue;
    out.push({
      id: `ccass-${String(row.id || "").trim() || `${conversationId}-${at}`}`,
      role,
      author:
        role === "user"
          ? "Customer"
          : role === "agent"
            ? "Agent"
            : "Email bot",
      text,
      subject: meta.subject,
      fromEmail:
        role === "user" ? emailFromAddress(meta.visitor) : undefined,
      time: formatConversationDateTime(at),
      at,
      lane,
    });
  }
  out.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return out;
}

export async function listCcassTableEmailConversation(
  organizationId: string,
  customerEmail: string
): Promise<CcaasEmailMessage[]> {
  const orgId = String(organizationId || "").trim();
  const email = String(customerEmail || "").trim().toLowerCase();
  if (!orgId || !email) return [];

  try {
    const identity = await query<{ cdp_id: string }>(
      `SELECT cdp_id
         FROM cdp.identity_keys
        WHERE organization_id::text = $1
          AND key_type IN ('email', 'email_secondary')
          AND lower(key_value) = $2
        LIMIT 1`,
      [orgId, email]
    );
    const cdpId = String(identity.rows[0]?.cdp_id || "").trim();
    if (!cdpId) return [];

    const convs = await query<{
      id: string;
      subject: string | null;
      visitor_id: string | null;
    }>(
      `SELECT id, subject, visitor_id
         FROM ccass.conversations
        WHERE organization_id::text = $1
          AND channel = 'email'
          AND contact_id = $2
        ORDER BY created_at ASC`,
      [orgId, cdpId]
    );
    if (!convs.rows.length) return [];

    const conversationIds = convs.rows
      .map((row) => String(row.id || "").trim())
      .filter(Boolean);
    const msgs = await query<{
      id: string;
      conversation_id: string;
      sender_type: string | null;
      direction: string | null;
      body: string | null;
      created_at: unknown;
    }>(
      `SELECT id, conversation_id, sender_type, direction, body, created_at
         FROM ccass.conversation_messages
        WHERE organization_id::text = $1
          AND conversation_id::text = ANY($2::text[])
          AND visibility = 'customer'
        ORDER BY created_at ASC`,
      [orgId, conversationIds]
    );

    return mapCcassTableMessages(
      convs.rows.map((row) => ({
        id: String(row.id),
        subject: row.subject,
        visitor_id: row.visitor_id,
      })),
      msgs.rows.map((row) => ({
        id: String(row.id),
        conversation_id: String(row.conversation_id),
        sender_type: row.sender_type,
        direction: row.direction,
        body: row.body,
        created_at: row.created_at,
      }))
    );
  } catch (err) {
    const message = String((err as Error).message || "");
    if (/does not exist/i.test(message)) {
      console.warn("[email-conversation] ccass tables unavailable:", message);
      return [];
    }
    throw err;
  }
}

export async function listTicketEmailConversation(input: {
  organizationId: string;
  customerEmail: string;
}): Promise<{
  messages: CcaasEmailMessage[];
  configured: boolean;
  source: "sp" | "tables";
}> {
  const email = String(input.customerEmail || "").trim();
  if (ccaasEmailSpEnabled()) {
    if (!email || !ccaasEmailConfigured()) {
      return { messages: [], configured: false, source: "sp" };
    }
    return {
      messages: await listCcaasEmailConversation(email),
      configured: true,
      source: "sp",
    };
  }
  return {
    messages: await listCcassTableEmailConversation(
      input.organizationId,
      email
    ),
    configured: true,
    source: "tables",
  };
}
