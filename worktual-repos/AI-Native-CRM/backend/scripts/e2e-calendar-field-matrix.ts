/**
 * B2B sales calendar surface — read + schedule field matrix (API).
 *
 * Run:
 *   npx tsx --env-file=../.env scripts/e2e-calendar-field-matrix.ts
 */
import pg from "pg";
import { randomBytes } from "node:crypto";
import {
  SESSION_COOKIE_NAME,
  signSessionUserId,
} from "../src/service/account/session-crypto.ts";

const API = process.env.E2E_API_BASE || "http://127.0.0.1:4000";

const cookieJar = new Map<string, string>();
const results: Array<{ name: string; ok: boolean; detail: string }> = [];

function record(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function storeCookies(res: Response) {
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const part = line.split(";")[0] || "";
    const i = part.indexOf("=");
    if (i > 0) cookieJar.set(part.slice(0, i), part.slice(i + 1));
  }
}

async function http(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {
    cookie: [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  storeCookies(res);
  const raw = await res.text();
  let data: any = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }
  return { status: res.status, data, raw };
}

async function loginAdmin() {
  cookieJar.clear();
  const db = new pg.Client({
    connectionString:
      process.env.ACCOUNT_DATABASE_URL || process.env.DATABASE_URL,
  });
  await db.connect();
  const u = await db.query(`
      SELECT u.id::text AS id FROM accounts.setup_users u
      JOIN accounts.setup_user_product_access a ON a.user_id = u.id AND a.product_id = 'crm'
      WHERE u.organization_id = 1000 LIMIT 1`);
  await db.end();
  const id = u.rows[0]?.id;
  if (!id) process.exit(1);
  cookieJar.set(SESSION_COOKIE_NAME, signSessionUserId(id));
  record("login.b2b", (await http("GET", "/api/auth/me")).status === 200, `user=${id}`);
}

async function main() {
  const t = randomBytes(3).toString("hex");
  console.log(`Calendar field matrix (B2B) @ ${API}\n`);
  await loginAdmin();

  const integrations = await http("GET", "/api/calendar/integrations");
  record(
    "api.integrations",
    integrations.status === 200,
    integrations.raw.slice(0, 80),
  );

  const now = new Date();
  const timeMin = new Date(now.getTime() - 7 * 86400000).toISOString();
  const timeMax = new Date(now.getTime() + 14 * 86400000).toISOString();
  const events = await http(
    "GET",
    `/api/calendar/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&ownerScope=mine`,
  );
  const items =
    events.data?.events ||
    events.data?.items ||
    events.data?.data?.events ||
    [];
  record(
    "api.events.list",
    events.status === 200 && Array.isArray(items),
    `count=${Array.isArray(items) ? items.length : "?"}`,
  );

  const list = await http("GET", "/api/contacts?page=1&pageSize=5");
  const listItems =
    list.data?.items || list.data?.data?.items || [];
  let contactId = String(listItems[0]?.id || "").trim();
  if (!contactId) {
    const contacts = await http("GET", "/api/calendar/contacts");
    const contactList =
      contacts.data?.contacts || contacts.data?.data?.contacts || [];
    contactId = String(contactList[0]?.id || "").trim();
  }
  record(
    "setup.contact",
    list.status === 200 && Boolean(contactId),
    contactId || "none",
  );

  if (contactId) {
    const when = new Date(now.getTime() + 3 * 86400000);
    when.setHours(10, 0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    const whenLocal = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`;
    const scheduled = await http("POST", "/api/calendar/meetings", {
      contactId,
      when: whenLocal,
      whenIso: when.toISOString(),
      timeZone: "UTC",
      topic: `Matrix meeting ${t}`,
      durationMinutes: 30,
    });
    const activityId =
      scheduled.data?.activityId ||
      scheduled.data?.id ||
      scheduled.data?.data?.activityId;
    const needsConnect =
      scheduled.status === 400 &&
      /connect google|needsConnect/i.test(scheduled.raw);
    record(
      "api.schedule.meeting",
      (scheduled.status === 200 && Boolean(activityId)) || needsConnect,
      needsConnect
        ? "skipped (Google calendar not connected for user)"
        : String(activityId || scheduled.raw.slice(0, 100)),
    );
  }

  summarize();
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
}

function summarize() {
  const failed = results.filter((r) => !r.ok);
  console.log(
    `\nSummary: ${results.length - failed.length}/${results.length} passed`,
  );
  if (failed.length) {
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
