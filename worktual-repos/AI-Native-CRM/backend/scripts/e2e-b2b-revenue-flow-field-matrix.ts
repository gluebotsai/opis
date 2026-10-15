/**
 * B2B revenue path: deal → quote → send → accept → sales order (+ optional invoice id).
 *
 * Pure B2B (no commerce module). Complements e2e-quote-field-matrix.ts field PATCH tests.
 *
 * Run:
 *   npx tsx --env-file=../.env scripts/e2e-b2b-revenue-flow-field-matrix.ts
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import {
  SESSION_COOKIE_NAME,
  signSessionUserId,
} from "../src/service/account/session-crypto.ts";

const API = process.env.E2E_API_BASE || "http://127.0.0.1:4000";
const EMAIL = process.env.E2E_EMAIL || "admin.b2b@worktual.com";
const PASSWORD = process.env.E2E_PASSWORD || "demo";

const cookieJar = new Map<string, string>();
const results: Array<{ name: string; ok: boolean; detail: string }> = [];

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
    signal: AbortSignal.timeout(120_000),
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
  const loginRes = await http("POST", "/api/auth/login", {
    email: EMAIL,
    password: PASSWORD,
  });
  if (loginRes.status === 200) {
    record("login.b2b", true, EMAIL);
    return;
  }
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
  const t = tag();
  console.log(`B2B revenue flow field matrix @ ${API}\n`);
  await login();

  const companies = await http("GET", "/api/companies?page=1");
  const companyId = String(companies.data?.items?.[0]?.id || "");
  const locs = await http("GET", `/api/companies/${companyId}/locations`);
  const locationId = String(locs.data?.locations?.[0]?.id || "");
  record("setup.company", Boolean(companyId && locationId), companyId);

  const productsRes = await http("GET", "/api/products?page=1&pageSize=5");
  const products =
    productsRes.data?.items || productsRes.data?.data?.items || [];
  const product = products[0];
  const productId = String(product?.id || "");
  const productName = String(product?.name || "Product");
  const unitPrice = Number(product?.price ?? product?.listPrice ?? 100) || 100;
  record("setup.product", Boolean(productId), productId);

  const dealRes = await http("POST", "/api/sales/deals", {
    title: `RevFlow Deal ${t}`,
    stage: "qualification",
    amount: 25000,
    companyId,
    locationId,
  });
  const dealId = dealRes.data?.id || dealRes.data?.data?.id;
  record("setup.deal", dealRes.status === 200 && Boolean(dealId), String(dealId || ""));

  let quoteRes = await http("POST", "/api/sales/quotes", {
    dealId,
    discountPct: 0,
    fromTemplate: false,
    lines: [{ productId, name: productName, quantity: 1, unitPrice }],
  });
  for (let i = 0; i < 4 && quoteRes.status !== 200; i += 1) {
    if (!String(quoteRes.raw).includes("Unique constraint")) break;
    await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    quoteRes = await http("POST", "/api/sales/quotes", {
      dealId,
      discountPct: 0,
      fromTemplate: false,
      lines: [{ productId, name: productName, quantity: 1, unitPrice }],
    });
  }
  const quoteId = quoteRes.data?.id || quoteRes.data?.data?.id;
  record(
    "flow.create.quote",
    quoteRes.status === 200 && Boolean(quoteId),
    quoteId ? String(quoteId) : quoteRes.raw.slice(0, 200),
  );
  if (!quoteId) {
    await http("DELETE", `/api/sales/deals/${dealId}`);
    summarize();
    process.exit(1);
  }

  const sent = await http("POST", `/api/sales/quotes/${quoteId}/send`, {});
  record("flow.quote.send", sent.status === 200, sent.raw.slice(0, 80));

  const accepted = await http("POST", `/api/sales/quotes/${quoteId}/accept`, {});
  record(
    "flow.quote.accept",
    accepted.status === 200,
    accepted.data?.invoiceId ? `invoiceId=${accepted.data.invoiceId}` : "ok",
  );

  const panel = await http("GET", `/api/sales/deals/${dealId}/quotes`);
  const items = panel.data?.items || panel.data?.data?.items || [];
  const row = items.find((q: any) => q.id === quoteId);
  record(
    "flow.read.quoteStatus",
    row?.status === "accepted",
    `status=${row?.status}`,
  );
  record(
    "flow.read.orderNumber",
    Boolean(row?.orderNumber),
    `order=${row?.orderNumber} status=${row?.orderStatus}`,
  );
  record(
    "flow.read.invoiceLinked",
    Boolean(row?.invoiceId || accepted.data?.invoiceId),
    `invoiceId=${row?.invoiceId ?? accepted.data?.invoiceId ?? "(none)"}`,
  );

  await http("DELETE", `/api/sales/deals/${dealId}`);
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
