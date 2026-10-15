/**
 * Product field matrix E2E — every inventory product form field via API + optional LLM.
 *
 * Run:
 *   npx tsx --env-file=../.env scripts/e2e-product-field-matrix.ts
 *
 * Live chat (patch_product_draft + propose_update_product):
 *   RUN_PRODUCT_LLM_E2E=1 npx tsx --env-file=../.env scripts/e2e-product-field-matrix.ts
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
const RUN_LLM = process.env.RUN_PRODUCT_LLM_E2E === "1";

type Msg = { role: "assistant" | "user"; text: string };

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

function cookieHeader() {
  return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function http(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: any; raw: string }> {
  const headers: Record<string, string> = { cookie: cookieHeader() };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
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
    record("login", true, EMAIL);
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
      WHERE u.status = 'active' AND u.organization_id = 1000
        AND lower(r.name) IN ('admin', 'sales_manager')
      LIMIT 1`);
  await db.end();
  const row = u.rows[0] as { id?: string } | undefined;
  if (!row?.id) {
    record("login", false, loginRes.raw.slice(0, 120));
    process.exit(1);
  }
  cookieJar.set(SESSION_COOKIE_NAME, signSessionUserId(row.id));
  const me = await http("GET", "/api/auth/me");
  record("login", me.status === 200, `session user=${row.id}`);
  if (me.status !== 200) process.exit(1);
}

function product(data: any) {
  return data?.product || data?.data?.product || {};
}

type ProductRow = Record<string, unknown>;

function numEq(a: unknown, b: unknown): boolean {
  return Number(a) === Number(b);
}

function galleryEq(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) =>
    Array.isArray(v)
      ? v.map(String).sort().join("|")
      : String(v || "")
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter(Boolean)
          .sort()
          .join("|");
  return norm(a) === norm(b);
}

function buildPayload(current: ProductRow, t: string, patch: Record<string, unknown>) {
  return {
    name: current.name ?? `ProdMatrix ${t}`,
    sku: current.sku ?? `SKU-M-${t}`,
    tagline: current.tagline ?? null,
    description: current.description ?? null,
    specifications: current.specifications ?? null,
    imageUrl: current.imageUrl ?? null,
    galleryUrls: current.galleryUrls ?? [],
    productUrl: current.productUrl ?? null,
    price: current.price != null ? Number(current.price) : null,
    maxDiscountPercent:
      current.maxDiscountPercent != null
        ? Number(current.maxDiscountPercent)
        : null,
    currency: current.currency ?? "USD",
    status: current.status ?? "draft",
    productType: current.productType ?? "fixed",
    category: current.category ?? null,
    brand: current.brand ?? null,
    subcategory: current.subcategory ?? null,
    stockOnHand: current.stockOnHand ?? null,
    tags: current.tags ?? null,
    billingType: current.billingType ?? "one_time",
    billingFrequency: current.billingFrequency ?? null,
    offers: current.offers ?? [],
    addons: current.addons ?? [],
    ...patch,
  };
}

const CREATE_BODY = (t: string) => ({
  name: `ProdMatrix ${t}`,
  sku: `SKU-M-${t}`,
  tagline: "Matrix tagline",
  description: "Matrix description",
  specifications: "Matrix specs",
  imageUrl: "https://example.com/matrix.png",
  galleryUrls: ["https://example.com/g1.png", "https://example.com/g2.png"],
  productUrl: "https://example.com/matrix-pdp",
  price: 199,
  maxDiscountPercent: 15,
  currency: "USD",
  status: "draft",
  productType: "fixed",
  category: "MatrixCat",
  brand: "MatrixBrand",
  subcategory: "MatrixSub",
  stockOnHand: 10,
  tags: "matrix,e2e",
  billingType: "one_time",
});

type ReadCheck = {
  key: string;
  ok: (p: ProductRow) => boolean;
  detail: (p: ProductRow) => string;
};

const READ_CHECKS: ReadCheck[] = [
  {
    key: "name",
    ok: (p) => String(p.name || "").includes("ProdMatrix"),
    detail: (p) => String(p.name),
  },
  { key: "sku", ok: (p) => Boolean(p.sku), detail: (p) => String(p.sku) },
  { key: "tagline", ok: (p) => p.tagline === "Matrix tagline", detail: (p) => String(p.tagline) },
  {
    key: "description",
    ok: (p) => p.description === "Matrix description",
    detail: (p) => String(p.description),
  },
  {
    key: "specifications",
    ok: (p) => p.specifications === "Matrix specs",
    detail: (p) => String(p.specifications),
  },
  {
    key: "imageUrl",
    ok: (p) => String(p.imageUrl || "").includes("matrix.png"),
    detail: (p) => String(p.imageUrl),
  },
  {
    key: "galleryUrls",
    ok: (p) => galleryEq(p.galleryUrls, ["https://example.com/g1.png", "https://example.com/g2.png"]),
    detail: (p) => JSON.stringify(p.galleryUrls)?.slice(0, 80) ?? "",
  },
  {
    key: "productUrl",
    ok: (p) => String(p.productUrl || "").includes("matrix-pdp"),
    detail: (p) => String(p.productUrl),
  },
  { key: "price", ok: (p) => numEq(p.price, 199), detail: (p) => String(p.price) },
  {
    key: "maxDiscountPercent",
    ok: (p) => numEq(p.maxDiscountPercent, 15),
    detail: (p) => String(p.maxDiscountPercent),
  },
  { key: "currency", ok: (p) => p.currency === "USD", detail: (p) => String(p.currency) },
  { key: "status", ok: (p) => p.status === "draft", detail: (p) => String(p.status) },
  { key: "productType", ok: (p) => p.productType === "fixed", detail: (p) => String(p.productType) },
  { key: "category", ok: (p) => p.category === "MatrixCat", detail: (p) => String(p.category) },
  { key: "brand", ok: (p) => p.brand === "MatrixBrand", detail: (p) => String(p.brand) },
  { key: "subcategory", ok: (p) => p.subcategory === "MatrixSub", detail: (p) => String(p.subcategory) },
  { key: "stockOnHand", ok: (p) => numEq(p.stockOnHand, 10), detail: (p) => String(p.stockOnHand) },
  { key: "tags", ok: (p) => String(p.tags || "").includes("matrix"), detail: (p) => String(p.tags) },
  { key: "billingType", ok: (p) => p.billingType === "one_time", detail: (p) => String(p.billingType) },
];

type UpdateStep =
  | { key: string; value: unknown; match?: (got: unknown, exp: unknown) => boolean }
  | { key: string; via: "status"; value: string };

const UPDATE_MATRIX: UpdateStep[] = [
  { key: "tagline", value: "Updated tagline" },
  { key: "description", value: "Updated description" },
  { key: "specifications", value: "Updated specs" },
  { key: "imageUrl", value: "https://example.com/new.png" },
  {
    key: "galleryUrls",
    value: ["https://example.com/x.png"],
    match: (got, exp) => galleryEq(got, exp),
  },
  { key: "productUrl", value: "https://example.com/new-pdp" },
  { key: "price", value: 249, match: (got, exp) => numEq(got, exp) },
  { key: "maxDiscountPercent", value: 25, match: (got, exp) => numEq(got, exp) },
  { key: "currency", value: "EUR" },
  { key: "category", value: "UpdatedCat" },
  { key: "brand", value: "UpdatedBrand" },
  { key: "subcategory", value: "UpdatedSub" },
  { key: "stockOnHand", value: 42, match: (got, exp) => numEq(got, exp) },
  { key: "tags", value: "updated,hot" },
  {
    key: "billingFrequency",
    value: "monthly",
    match: (got, exp) => got === exp,
  },
  { key: "name", value: "Prod Matrix Renamed" },
  { key: "status", via: "status", value: "active" },
];

async function agentTurn(input: {
  messages: Msg[];
  context: Record<string, unknown>;
  draft?: Record<string, unknown>;
}) {
  const r = await http("POST", "/api/coworker/agent-turn", {
    messages: input.messages,
    context: { ...input.context, draft: input.draft ?? null },
  });
  const payload = r.data?.data && typeof r.data.data === "object" ? r.data.data : r.data;
  return {
    ok: r.status === 200 && payload?.ok !== false,
    patch: payload?.patch as Record<string, unknown> | undefined,
    tools: (payload?.toolProposals || []) as Array<{
      name: string;
      args?: Record<string, unknown>;
    }>,
    speech: String(payload?.assistantText || ""),
  };
}

async function main() {
  const t = tag();
  console.log(`Product field matrix E2E @ ${API} (LLM chat=${RUN_LLM})\n`);
  await login();

  const created = await http("POST", "/api/products", CREATE_BODY(t));
  const productId = created.data?.id || created.data?.data?.id;
  record(
    "api.create.full",
    created.status === 200 && Boolean(productId),
    productId ? String(productId) : created.raw.slice(0, 120),
  );
  if (!productId) {
    summarize();
    process.exit(1);
  }

  const detail0 = await http("GET", `/api/products/${productId}`);
  const p0 = product(detail0.data);
  for (const check of READ_CHECKS) {
    const ok = check.ok(p0);
    record(`api.create.read.${check.key}`, ok, `got=${check.detail(p0)?.slice(0, 80)}`);
  }

  let current: ProductRow = { ...p0 };

  for (const step of UPDATE_MATRIX) {
    if ("via" in step && step.via === "status") {
      const staged = await http("POST", `/api/products/${productId}/status`, {
        status: step.value,
      });
      record(`api.update.${step.key}`, staged.status === 200, step.value);
      if (staged.status === 200) {
        const detail = await http("GET", `/api/products/${productId}`);
        current = product(detail.data);
        record(
          `api.update.read.${step.key}`,
          current.status === step.value,
          `got=${current.status}`,
        );
      }
      continue;
    }

    const patch: Record<string, unknown> = { [step.key]: step.value };
    if (step.key === "billingFrequency") {
      patch.billingType = "recurring";
    }
    const payload = buildPayload(current, t, patch);
    const updated = await http("PATCH", `/api/products/${productId}`, payload);
    record(
      `api.update.${step.key}`,
      updated.status === 200,
      String(step.value).slice(0, 80),
    );
    if (updated.status === 200) {
      const detail = await http("GET", `/api/products/${productId}`);
      current = product(detail.data);
      const readVal = current[step.key];
      const exp = step.value;
      const matchFn = step.match ?? ((got, expected) => got === expected);
      record(
        `api.update.read.${step.key}`,
        matchFn(readVal, exp),
        `got=${JSON.stringify(readVal)?.slice(0, 80)}`,
      );
    }
  }

  const customSku = `SKU-CUST-${t}`;
  const customCreate = await http("POST", "/api/products", {
    name: `CustomMatrix ${t}`,
    sku: customSku,
    price: 999,
    currency: "USD",
    status: "draft",
    productType: "customizable",
    billingType: "one_time",
    offers: [
      {
        name: "Base plan",
        code: "BASE",
        includedQty: 1,
        status: "active",
        sortOrder: 0,
      },
    ],
    addons: [
      {
        name: "Extra seat",
        pricingModel: "per_unit",
        unitPrice: 10,
        sortOrder: 0,
      },
    ],
  });
  const customId = customCreate.data?.id || customCreate.data?.data?.id;
  record(
    "api.create.customizable",
    customCreate.status === 200 && Boolean(customId),
    customId ? String(customId) : customCreate.raw.slice(0, 100),
  );
  if (customId) {
    const cd = product((await http("GET", `/api/products/${customId}`)).data);
    record(
      "api.create.read.offers",
      Array.isArray(cd.offers) && cd.offers.length >= 1,
      `count=${Array.isArray(cd.offers) ? cd.offers.length : 0}`,
    );
    record(
      "api.create.read.addons",
      Array.isArray(cd.addons) && cd.addons.length >= 1,
      `count=${Array.isArray(cd.addons) ? cd.addons.length : 0}`,
    );
    await http("DELETE", `/api/products/${customId}`);
  }

  if (RUN_LLM) {
    const draft: Record<string, unknown> = {};
    const createCtx = {
      module: "product",
      surface: "create",
      pathname: "/product/new",
    };
    const chatSteps: Array<{ field: string; value: string; user: string }> = [
      { field: "name", value: "ChatProd", user: `ChatProd ${t}` },
      { field: "sku", value: "CHAT", user: `sku CHAT-${t}` },
      { field: "price", value: "77", user: "price 77" },
      { field: "currency", value: "USD", user: "USD" },
      { field: "category", value: "ChatCat", user: "category ChatCat" },
      { field: "description", value: "From chat", user: "description From chat" },
    ];
    let messages: Msg[] = [{ role: "user", text: "help me create a new product" }];
    await agentTurn({ messages, context: createCtx, draft });
    messages.push({ role: "assistant", text: "What's the product name?" });
    for (const step of chatSteps) {
      messages.push({ role: "user", text: step.user });
      const turn = await agentTurn({ messages, context: createCtx, draft });
      if (turn.patch) Object.assign(draft, turn.patch);
      const inDraft = String(draft[step.field] || "")
        .toLowerCase()
        .includes(String(step.value).toLowerCase().slice(0, 4));
      record(
        `llm.create.patch.${step.field}`,
        Boolean(turn.ok && inDraft),
        `${step.field}=${draft[step.field] ?? "(missing)"}`,
      );
      if (turn.speech) messages.push({ role: "assistant", text: turn.speech });
    }

    const updTurn = await agentTurn({
      messages: [{ role: "user", text: "price as 129" }],
      context: {
        module: "product",
        surface: "detail",
        entityId: productId,
        pathname: `/product/${productId}`,
      },
    });
    let updTool = updTurn.tools.find((x) => x.name === "propose_update_product");
    if (!updTool?.args?.price && updTurn.ok) {
      const retry = await agentTurn({
        messages: [
          { role: "user", text: "price as 129" },
          ...(updTurn.speech
            ? [{ role: "assistant" as const, text: updTurn.speech }]
            : []),
          { role: "user", text: "Propose updating this product price to 129." },
        ],
        context: {
          module: "product",
          surface: "detail",
          entityId: productId,
          pathname: `/product/${productId}`,
        },
      });
      updTool = retry.tools.find((x) => x.name === "propose_update_product");
    }
    record(
      "llm.update.price_tool",
      Boolean(updTool?.args?.price),
      updTool ? `price=${updTool.args?.price}` : updTurn.speech.slice(0, 100),
    );
  } else {
    console.log("\n(skip LLM chat checks — set RUN_PRODUCT_LLM_E2E=1 to enable)");
  }

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
    console.log("Failures:");
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
