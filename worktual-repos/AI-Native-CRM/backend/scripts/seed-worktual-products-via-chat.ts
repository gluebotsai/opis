/**
 * Load Worktual price-sheet products through the coworker chat pipeline:
 * agent-turn (patch_product_draft) → productInputFromDraft → POST /api/products
 *
 * Run: npx tsx --env-file=.env scripts/seed-worktual-products-via-chat.ts
 */
import pg from "pg";
import { PrismaClient } from "@prisma/client";
import {
  SESSION_COOKIE_NAME,
  signSessionUserId,
} from "../src/service/account/session-crypto.ts";
import {
  productInputFromDraft,
  type ProductAddonDraft,
  type ProductOfferDraft,
} from "../../frontend/src/lib/coworker/field-contracts/product.ts";

// Running server may use root `.env` SESSION_SECRET — match it for minted cookies.
if (!process.env.SESSION_SECRET?.trim()) {
  process.env.SESSION_SECRET = "change-me-in-production";
}

const API = process.env.E2E_API_BASE || "http://127.0.0.1:4000";
const EMAIL = process.env.E2E_EMAIL || "admin.b2b@worktual.com";
const PASSWORD = process.env.E2E_PASSWORD || "demo";
const ORG = BigInt(process.env.SEED_ORGANIZATION_ID || "1000");
const TIMEOUT_MS = Number(process.env.E2E_AGENT_TIMEOUT_MS || 240_000);

type Msg = { role: "assistant" | "user"; text: string };
type Turn = {
  ok: boolean;
  assistantText?: string;
  error?: string;
  toolProposals?: Array<{ name: string; args?: Record<string, unknown> }>;
  patch?: Record<string, unknown>;
};

type ProductSpec = {
  key: string;
  chatPrompt: string;
  followUp?: string;
  fallback: Record<string, unknown> & {
    name: string;
    sku: string;
    offers?: ProductOfferDraft[];
    addons?: ProductAddonDraft[];
  };
};

const cookieJar = new Map<string, string>();

function storeCookies(res: Response) {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const line of raw) {
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
): Promise<{ status: number; data: unknown; raw: string }> {
  const headers: Record<string, string> = { cookie: cookieHeader() };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  storeCookies(res);
  const raw = await res.text();
  let data: unknown = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }
  return { status: res.status, data, raw };
}

async function agentTurn(input: {
  messages: Msg[];
  context: Record<string, unknown>;
  sessionMemory?: Record<string, unknown>;
}): Promise<Turn> {
  const r = await http("POST", "/api/coworker/agent-turn", input);
  const payload =
    (r.data as { data?: Turn })?.data && typeof (r.data as { data?: Turn }).data === "object"
      ? (r.data as { data: Turn }).data
      : (r.data as Turn);
  if (r.status !== 200) {
    return { ok: false, error: `HTTP ${r.status}: ${r.raw.slice(0, 220)}` };
  }
  if ((payload as { ok?: boolean })?.ok === false) {
    return {
      ok: false,
      error: String(
        (payload as { error?: string; assistantText?: string }).error ||
          (payload as { assistantText?: string }).assistantText ||
          "agent failed",
      ),
    };
  }
  return payload as Turn;
}

function mergeDraft(
  draft: Record<string, unknown>,
  turn: Turn,
): Record<string, unknown> {
  const patch = turn.patch;
  if (patch && typeof patch === "object") return { ...draft, ...patch };
  return draft;
}

function normalizeAddonPricing(addons: ProductAddonDraft[] | undefined): ProductAddonDraft[] {
  return (addons ?? []).map((a) => {
    let pricingModel = a.pricingModel || "per_unit";
    if (pricingModel === "unit") pricingModel = "per_unit";
    if (pricingModel === "step") pricingModel = "stepped";
    return { ...a, pricingModel };
  });
}

function draftReady(d: Record<string, unknown>): boolean {
  return Boolean(String(d.name || "").trim() && String(d.sku || "").trim());
}

const PRODUCT_SPECS: ProductSpec[] = [
  {
    key: "ccaas",
    chatPrompt:
      "Create a customizable recurring monthly product: AI Native Contact Centre (CCaaS), SKU WT-CCAAS, price 6000 INR, category CCaaS, status active. Offers: Starter, Growth, Pro (AI-Assisted), Enterprise (AI-Native) seat plans; voice packs 1000/2000/3000 mins; chatbot session packs 300/1000/2500. Addons: Live agent 9000 per agent, additional live agents 15000 overage per agent, additional voice minutes stepped 1000 mins for 8000, email bot volume tiered, additional language setup flat 20000.",
    fallback: {
      name: "AI Native Contact Centre (CCaaS)",
      sku: "WT-CCAAS",
      price: "6000",
      currency: "INR",
      status: "active",
      productType: "customizable",
      billingType: "recurring",
      billingFrequency: "monthly",
      category: "CCaaS",
      description:
        "AI Native Contact Centre (Web, WhatsApp, Facebook, Instagram, Email, SMS + Voicebot) with live agents.",
      offers: [
        { name: "Starter", code: "STARTER", meterKey: "seat", includedQty: "1" },
        { name: "Growth", code: "GROWTH", meterKey: "seat", includedQty: "1" },
        { name: "Pro (AI-Assisted)", code: "PRO", meterKey: "seat", includedQty: "1" },
        { name: "Enterprise (AI-Native)", code: "ENTERPRISE", meterKey: "seat", includedQty: "1" },
        { name: "Voice pack · 1,000 mins", code: "VOICE-1000", meterKey: "minute", includedQty: "1000" },
        { name: "Voice pack · 2,000 mins", code: "VOICE-2000", meterKey: "minute", includedQty: "2000" },
        { name: "Voice pack · 3,000 mins", code: "VOICE-3000", meterKey: "minute", includedQty: "3000" },
        { name: "Chatbot sessions · 300", code: "SESS-300", meterKey: "session", includedQty: "300" },
        { name: "Chatbot sessions · 1,000", code: "SESS-1000", meterKey: "session", includedQty: "1000" },
        { name: "Chatbot sessions · 2,500", code: "SESS-2500", meterKey: "session", includedQty: "2500" },
      ],
      addons: normalizeAddonPricing([
        { name: "Live agent", unitLabel: "agents", meterKey: "agent", pricingModel: "per_unit", unitPrice: "9000" },
        {
          name: "Additional live agents (beyond plan)",
          unitLabel: "agents",
          meterKey: "agent",
          isOverage: true,
          pricingModel: "per_unit",
          unitPrice: "15000",
        },
        {
          name: "Additional voice minutes",
          unitLabel: "minutes",
          meterKey: "minute",
          isOverage: true,
          pricingModel: "stepped",
          stepSize: "1000",
          stepPrice: "8000",
        },
        {
          name: "Email bot volume",
          unitLabel: "emails",
          meterKey: "email",
          pricingModel: "tiered",
          tiers: [
            { minQty: "1", maxQty: "3000", unitPrice: "13.33" },
            { minQty: "3001", maxQty: "20000", unitPrice: "7" },
            { minQty: "20001", maxQty: "30000", unitPrice: "6" },
            { minQty: "30001", maxQty: "", unitPrice: "4.4" },
          ],
        },
        {
          name: "Additional language setup (excl. English)",
          unitLabel: "languages",
          meterKey: "custom",
          pricingModel: "flat",
          flatPrice: "20000",
        },
      ]),
    },
  },
  {
    key: "crm",
    chatPrompt:
      "Create customizable recurring monthly product AI Native CRM, SKU WT-CRM, price 15000 INR, category CRM, status active. Offer: User license for 10000 contacts. Addons: Implementation flat 300000, additional contacts tiered.",
    fallback: {
      name: "AI Native CRM",
      sku: "WT-CRM",
      price: "15000",
      currency: "INR",
      status: "active",
      productType: "customizable",
      billingType: "recurring",
      billingFrequency: "monthly",
      category: "CRM",
      description: "User license includes up to 10,000 contacts.",
      offers: [{ name: "User license", code: "USER", meterKey: "seat", includedQty: "10000" }],
      addons: normalizeAddonPricing([
        { name: "Implementation", meterKey: "flat", pricingModel: "flat", flatPrice: "300000" },
        {
          name: "Additional contacts",
          unitLabel: "contacts",
          meterKey: "custom",
          isOverage: true,
          pricingModel: "tiered",
          tiers: [
            { minQty: "1", maxQty: "10000", unitPrice: "1" },
            { minQty: "10001", maxQty: "25000", unitPrice: "0.9" },
            { minQty: "25001", maxQty: "", unitPrice: "0.8" },
          ],
        },
      ]),
    },
  },
  {
    key: "cdp",
    chatPrompt:
      "Create fixed one-time product Cognitive Customer Data Platform, SKU WT-CDP, price 76500000 INR, category CDP, status active.",
    fallback: {
      name: "Cognitive Customer Data Platform",
      sku: "WT-CDP",
      price: "76500000",
      currency: "INR",
      status: "active",
      productType: "fixed",
      billingType: "one_time",
      category: "CDP",
      description: "Pricing depends on customer profiles and data sources.",
    },
  },
  {
    key: "campaign",
    chatPrompt:
      "Create customizable recurring monthly AI Native Campaign Management, SKU WT-CAMPAIGN, price 35000 INR, category Marketing, status active. Offer Base 50k contacts. Addons per-unit email 5, SMS 1.06, WhatsApp 5, web push 0.44, app push 1.23.",
    fallback: {
      name: "AI Native Campaign Management",
      sku: "WT-CAMPAIGN",
      price: "35000",
      currency: "INR",
      status: "active",
      productType: "customizable",
      billingType: "recurring",
      billingFrequency: "monthly",
      category: "Marketing",
      offers: [{ name: "Base · 50k contacts", code: "BASE-50K", meterKey: "custom", includedQty: "50000" }],
      addons: normalizeAddonPricing([
        { name: "Email campaign", unitLabel: "emails", meterKey: "email", pricingModel: "per_unit", unitPrice: "5" },
        { name: "SMS campaign", unitLabel: "SMS", meterKey: "custom", pricingModel: "per_unit", unitPrice: "1.06" },
        { name: "WhatsApp campaign", unitLabel: "credits", meterKey: "custom", pricingModel: "per_unit", unitPrice: "5" },
        { name: "Web push", unitLabel: "subscribers", meterKey: "custom", pricingModel: "per_unit", unitPrice: "0.44" },
        { name: "App push", unitLabel: "subscribers", meterKey: "custom", pricingModel: "per_unit", unitPrice: "1.23" },
      ]),
    },
  },
  {
    key: "cvm",
    chatPrompt:
      "Create customizable recurring monthly AI Native Customer Value Management, SKU WT-CVM, price 100000 INR, category CVM, status active. Offer 100k MAU. Addon implementation fee flat 560000.",
    fallback: {
      name: "AI Native Customer Value Management",
      sku: "WT-CVM",
      price: "100000",
      currency: "INR",
      status: "active",
      productType: "customizable",
      billingType: "recurring",
      billingFrequency: "monthly",
      category: "CVM",
      offers: [{ name: "100k MAU", code: "MAU-100K", meterKey: "custom", includedQty: "100000" }],
      addons: normalizeAddonPricing([
        { name: "Implementation fee", meterKey: "flat", pricingModel: "flat", flatPrice: "560000" },
      ]),
    },
  },
  {
    key: "ticketing",
    chatPrompt:
      "Create customizable recurring monthly AI Native Ticketing System, SKU WT-TICKETING, price 15000 INR, category Service, status active. Offer user license with 2000 tickets. Addon additional tickets tiered 12/10/9 per ticket.",
    fallback: {
      name: "AI Native Ticketing System",
      sku: "WT-TICKETING",
      price: "15000",
      currency: "INR",
      status: "active",
      productType: "customizable",
      billingType: "recurring",
      billingFrequency: "monthly",
      category: "Service",
      offers: [{ name: "User license · 2,000 tickets", code: "USER-2K", meterKey: "seat", includedQty: "2000" }],
      addons: normalizeAddonPricing([
        {
          name: "Additional tickets",
          unitLabel: "tickets",
          meterKey: "custom",
          isOverage: true,
          pricingModel: "tiered",
          tiers: [
            { minQty: "1", maxQty: "1000", unitPrice: "12" },
            { minQty: "1001", maxQty: "5000", unitPrice: "10" },
            { minQty: "5001", maxQty: "", unitPrice: "9" },
          ],
        },
      ]),
    },
  },
  {
    key: "webtrack",
    chatPrompt:
      "Create fixed one-time product Web Tracking, SKU WT-WEBTRACK, category Analytics, status active. Price TBD — quote after scope clarity.",
    fallback: {
      name: "Web Tracking",
      sku: "WT-WEBTRACK",
      currency: "INR",
      status: "active",
      productType: "fixed",
      billingType: "one_time",
      category: "Analytics",
      description: "Quotation pending full solution scope.",
    },
  },
];

async function login() {
  const loginRes = await http("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
  if (loginRes.status === 200) {
    console.log(`Logged in as ${EMAIL}`);
    return;
  }
  const db = new pg.Client({
    connectionString: process.env.ACCOUNT_DATABASE_URL || process.env.DATABASE_URL,
  });
  await db.connect();
  const u = await db.query<{ id: string }>(
    `SELECT u.id::text AS id
     FROM accounts.setup_users u
     JOIN accounts.setup_user_product_access a ON a.user_id = u.id AND a.product_id = 'crm'
     JOIN accounts.setup_roles r ON r.id = a.role_id
     WHERE u.status = 'active' AND u.organization_id = $1
       AND lower(r.name) IN ('admin', 'sales_manager')
     ORDER BY u.id LIMIT 1`,
    [ORG.toString()],
  );
  await db.end();
  const id = u.rows[0]?.id;
  if (!id) throw new Error(`Login failed (${loginRes.status}) and no admin user for org ${ORG}`);
  cookieJar.set(SESSION_COOKIE_NAME, signSessionUserId(id));
  const me = await http("GET", "/api/auth/me");
  if (me.status !== 200) throw new Error(`Minted session rejected: ${me.status}`);
  console.log(`Minted session for user ${id}`);
}

async function purgeSeedCatalog(prisma: PrismaClient) {
  const deletedEntries = await prisma.priceBookEntry.deleteMany({
    where: { organizationId: ORG, id: { startsWith: "wt-" } },
  });
  const deletedBooks = await prisma.priceBook.deleteMany({
    where: { organizationId: ORG, id: { startsWith: "wt-" } },
  });
  const deletedProducts = await prisma.product.deleteMany({
    where: { organizationId: ORG, id: { startsWith: "wt-" } },
  });
  console.log(
    `Purged seed catalog: ${deletedProducts.count} products, ${deletedBooks.count} price books, ${deletedEntries.count} entries`,
  );
}

async function createViaChat(spec: ProductSpec, memory: Record<string, unknown>) {
  let draft: Record<string, unknown> = {};
  const messages: Msg[] = [
    { role: "user", text: "Help me create a new product" },
  ];
  const ctx = {
    module: "product",
    surface: "create",
    pathname: "/product/new",
    draft,
  };

  let turn = await agentTurn({ messages, context: { ...ctx, draft }, sessionMemory: memory });
  if (turn.assistantText) messages.push({ role: "assistant", text: turn.assistantText });
  draft = mergeDraft(draft, turn);

  messages.push({ role: "user", text: spec.chatPrompt });
  turn = await agentTurn({ messages, context: { ...ctx, draft }, sessionMemory: memory });
  draft = mergeDraft(draft, turn);
  if (turn.assistantText) messages.push({ role: "assistant", text: turn.assistantText });

  if (!draftReady(draft) || !(draft.offers as unknown[])?.length && spec.fallback.offers?.length) {
    messages.push({
      role: "user",
      text:
        spec.followUp ||
        "Apply all of that to the product draft now — name, SKU, type, billing, offers, and addons.",
    });
    turn = await agentTurn({ messages, context: { ...ctx, draft }, sessionMemory: memory });
    draft = mergeDraft(draft, turn);
  }

  const scalarKeys = [
    "name",
    "sku",
    "price",
    "currency",
    "status",
    "productType",
    "billingType",
    "billingFrequency",
    "category",
    "description",
    "tags",
  ] as const;
  const scalars: Record<string, unknown> = { ...spec.fallback };
  for (const key of scalarKeys) {
    const v = draft[key];
    if (v != null && String(v).trim() !== "") scalars[key] = v;
  }

  const merged = {
    ...scalars,
    // Chat patches scalars; offers/addons stay on price-sheet spec (tiered bands are unreliable from LLM).
    offers: spec.fallback.offers,
    addons: spec.fallback.addons,
  };

  const body = productInputFromDraft(
    merged as Parameters<typeof productInputFromDraft>[0],
  );
  // Backend rejects "unit"/"step" — normalize after productInputFromDraft
  if (Array.isArray(body.addons)) {
    body.addons = (body.addons as Record<string, unknown>[]).map((a) => {
      let pm = String(a.pricingModel || "");
      if (pm === "unit") pm = "per_unit";
      if (pm === "step") pm = "stepped";
      return { ...a, pricingModel: pm };
    });
  }

  const saved = await http("POST", "/api/products", body);
  const ok =
    saved.status === 200 &&
    (saved.data as { ok?: boolean })?.ok !== false;
  const id =
    (saved.data as { product?: { id?: string }; id?: string })?.product?.id ||
    (saved.data as { id?: string })?.id ||
    null;

  const patchedKeys = Object.keys(turn.patch || {}).join(",") || "(none)";
  console.log(
    `${ok ? "OK" : "FAIL"}  ${spec.fallback.sku} chatPatch=${patchedKeys} id=${id || "?"}${
      ok ? "" : ` err=${saved.raw.slice(0, 180)}`
    }`,
  );
  if (!ok || !id) throw new Error(`Failed to create ${spec.fallback.sku}: ${saved.raw.slice(0, 300)}`);
  return id;
}

async function main() {
  console.log(`Worktual products via chat flow — org ${ORG}, API ${API}\n`);
  const prisma = new PrismaClient();
  await purgeSeedCatalog(prisma);
  await login();

  let memory: Record<string, unknown> = {
    conversationId: `seed-products-chat-${Date.now()}`,
  };
  const created: string[] = [];

  for (const spec of PRODUCT_SPECS) {
    const id = await createViaChat(spec, memory);
    created.push(id);
    memory = {
      ...memory,
      lastEntities: { ...(memory.lastEntities as object), productId: id },
    };
  }

  const count = await prisma.product.count({ where: { organizationId: ORG } });
  console.log(`\nDone: ${created.length} products created via chat flow. Org total: ${count}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
