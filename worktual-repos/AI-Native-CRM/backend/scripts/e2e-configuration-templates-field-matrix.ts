/**
 * B2B Configuration: quote / proposal / invoice template field matrix (API).
 *
 * Run:
 *   npx tsx --env-file=../.env scripts/e2e-configuration-templates-field-matrix.ts
 */
import pg from "pg";
import { randomBytes } from "node:crypto";
import {
  SESSION_COOKIE_NAME,
  signSessionUserId,
} from "../src/service/account/session-crypto.ts";

const API = process.env.E2E_API_BASE || "http://127.0.0.1:4000";
const EMAIL = process.env.E2E_EMAIL || "admin.b2b@worktual.com";
const PASSWORD = process.env.E2E_PASSWORD || "demo";

const cookieJar = new Map<string, string>();
const results: Array<{ name: string; ok: boolean; detail: string }> = [];

const MIN_SECTIONS = [
  {
    id: "sec-intro",
    key: "introduction",
    title: "Introduction",
    body: "Template intro body for matrix test.",
    sortOrder: 1,
  },
];

function tag() {
  return randomBytes(3).toString("hex");
}

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

async function login() {
  cookieJar.clear();
  const db = new pg.Client({
    connectionString:
      process.env.ACCOUNT_DATABASE_URL || process.env.DATABASE_URL,
  });
  await db.connect();
  const u = await db.query(`
      SELECT u.id::text AS id FROM accounts.setup_users u
      JOIN accounts.setup_user_product_access a ON a.user_id = u.id AND a.product_id = 'crm'
      JOIN accounts.setup_roles r ON r.id = a.role_id
      WHERE u.organization_id = 1000 AND lower(r.name) IN ('admin', 'sales_manager')
      LIMIT 1`);
  await db.end();
  const id = u.rows[0]?.id;
  if (!id) {
    record("login.b2b", loginRes.status === 200, loginRes.raw.slice(0, 80));
    process.exit(1);
  }
  cookieJar.set(SESSION_COOKIE_NAME, signSessionUserId(id));
  record("login.b2b", (await http("GET", "/api/auth/me")).status === 200, `user=${id}`);
}

function templateFromCreate(data: any) {
  return (
    data?.template ||
    data?.data?.template ||
    (data?.id ? data : null) ||
    data?.data
  );
}

function templateFromGet(data: any) {
  return data?.template || data?.data?.template || data?.data || data;
}

async function exerciseTemplateKind(
  kind: "quote" | "proposal" | "invoice",
  basePath: string,
  t: string,
) {
  const createName = `Matrix ${kind} tpl ${t}`;
  const rename = `Matrix ${kind} tpl Renamed ${t}`;
  const created = await http("POST", basePath, {
    name: createName,
    sections: MIN_SECTIONS,
    makeActive: false,
  });
  const tpl = templateFromCreate(created.data);
  const id = String(tpl?.id || created.data?.id || "").trim();
  record(
    `${kind}.create`,
    created.status === 200 && Boolean(id),
    id || created.raw.slice(0, 100),
  );
  if (!id) return;

  record(
    `${kind}.create.read.name`,
    tpl?.name === createName,
    `got=${tpl?.name}`,
  );

  const patched = await http("PATCH", `${basePath}/${id}`, { name: rename });
  record(`${kind}.patch.name`, patched.status === 200, patched.raw.slice(0, 80));

  const got = await http("GET", `${basePath}/${id}`);
  const row = templateFromGet(got.data);
  record(
    `${kind}.read.name`,
    got.status === 200 && row?.name === rename,
    `got=${row?.name}`,
  );
  const sections = row?.sections || row?.documentSections;
  const intro = Array.isArray(sections)
    ? sections.find((s: any) => s.key === "introduction")
    : null;
  record(
    `${kind}.read.section.intro`,
    Boolean(intro?.body?.includes("matrix")),
    `body=${String(intro?.body || "").slice(0, 40)}`,
  );

  const del = await http("DELETE", `${basePath}/${id}`);
  record(`${kind}.delete`, del.status === 200, del.raw.slice(0, 60));
}

async function main() {
  const t = tag();
  console.log(`Configuration templates field matrix (B2B) @ ${API}\n`);
  await login();

  await exerciseTemplateKind("quote", "/api/sales/quote-templates", t);
  await exerciseTemplateKind("proposal", "/api/sales/proposal-templates", t);
  await exerciseTemplateKind("invoice", "/api/finance/invoice-templates", t);

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
