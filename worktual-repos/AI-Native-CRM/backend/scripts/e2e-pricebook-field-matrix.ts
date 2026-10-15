/**
 * B2B configuration: price book + entry field matrix (API).
 *
 * Run:
 *   npx tsx --env-file=../.env scripts/e2e-pricebook-field-matrix.ts
 *
 * Uses admin.b2b — price books are enabled for B2B via Configuration / Products.
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
      JOIN accounts.setup_roles r ON r.id = a.role_id
      WHERE u.organization_id = 1000 AND lower(r.name) IN ('admin', 'sales_manager')
      LIMIT 1`);
  await db.end();
  const id = u.rows[0]?.id;
  if (!id) {
    record("login.b2b", false, loginRes.raw.slice(0, 120));
    process.exit(1);
  }
  cookieJar.set(SESSION_COOKIE_NAME, signSessionUserId(id));
  record("login.b2b", (await http("GET", "/api/auth/me")).status === 200, `user=${id}`);
}

async function main() {
  const t = tag();
  console.log(`Price book field matrix (B2B) @ ${API}\n`);
  await login();

  const prodCreate = await http("POST", "/api/products", {
    name: `Matrix PB Product ${t}`,
    sku: `PB-SKU-${t}`,
    currency: "USD",
  });
  const productId = String(
    prodCreate.data?.product?.id ||
      prodCreate.data?.data?.product?.id ||
      prodCreate.data?.id ||
      prodCreate.data?.data?.id ||
      "",
  ).trim();
  record(
    "setup.product",
    prodCreate.status === 200 && Boolean(productId),
    productId || prodCreate.raw.slice(0, 120),
  );
  if (!productId) {
    summarize();
    process.exit(1);
  }

  const created = await http("POST", "/api/products/price-books", {
    name: `Matrix PB ${t}`,
    code: `PB-${t}`,
    currency: "USD",
    isDefault: false,
  });
  const book =
    created.data?.book || created.data?.data?.book || created.data?.data;
  const bookId = book?.id;
  record(
    "api.create.book",
    created.status === 200 && Boolean(bookId),
    bookId ? String(bookId) : created.raw.slice(0, 160),
  );
  if (!bookId) {
    summarize();
    process.exit(1);
  }

  const readCreate = [
    { key: "name", ok: book.name?.includes("Matrix PB"), got: book.name },
    { key: "code", ok: book.code === `PB-${t}`, got: book.code },
    { key: "currency", ok: book.currency === "USD", got: book.currency },
  ];
  for (const c of readCreate) {
    record(`api.create.read.${c.key}`, c.ok, `got=${c.got}`);
  }

  const patched = await http("PATCH", `/api/products/price-books/${bookId}`, {
    name: `Matrix PB Renamed ${t}`,
    code: `PB-R-${t}`,
    currency: "EUR",
    isDefault: false,
  });
  const book2 = patched.data?.book || patched.data?.data?.book;
  record("api.update.name", patched.status === 200, book2?.name);
  record(
    "api.update.read.currency",
    book2?.currency === "EUR",
    `got=${book2?.currency}`,
  );

  const entryRes = await http("POST", "/api/products/price-book-entries", {
    priceBookId: bookId,
    productId,
    amount: 199.5,
    billingFrequency: "monthly",
  });
  const entry = entryRes.data?.entry || entryRes.data?.data?.entry;
  const entryId = entry?.id;
  record(
    "api.create.entry",
    entryRes.status === 200 && Boolean(entryId),
    entryId ? String(entryId) : entryRes.raw.slice(0, 120),
  );

  const listEntries = await http(
    "GET",
    `/api/products/price-book-entries?priceBookId=${bookId}&productId=${productId}`,
  );
  const items =
    listEntries.data?.items || listEntries.data?.data?.items || [];
  const listed = items[0];
  record(
    "api.read.entry.amount",
    Number(listed?.amount) === 199.5,
    `got=${listed?.amount}`,
  );
  record(
    "api.read.entry.billingFrequency",
    listed?.billingFrequency === "monthly",
    `got=${listed?.billingFrequency}`,
  );

  const resolved = await http(
    "GET",
    `/api/products/resolve-price?productId=${productId}&priceBookId=${bookId}`,
  );
  const resolvePayload = resolved.data?.data ?? resolved.data;
  const amount = resolvePayload?.amount ?? resolved.data?.price;
  const source = resolvePayload?.source;
  record(
    "api.resolve.price",
    resolved.status === 200 &&
      source === "price_book" &&
      Number(amount) === 199.5,
    `amount=${amount} source=${source}`,
  );

  if (entryId) {
    await http("DELETE", `/api/products/price-book-entries/${entryId}`);
  }
  await http("DELETE", `/api/products/price-books/${bookId}`);
  await http("DELETE", `/api/products/${productId}`);

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
