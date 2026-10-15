/**
 * Create proposal + quote for Yaswanth (yaswanthmg1@gmail.com) via coworker chat,
 * then send both to the deal contact email.
 *
 * Run: npx tsx --env-file=.env scripts/yaswanth-quote-proposal-via-chat.ts
 */
import pg from "pg";
import {
  SESSION_COOKIE_NAME,
  signSessionUserId,
} from "../src/service/account/session-crypto.ts";
import { buildQuoteLines } from "../../frontend/src/lib/quote-line-builder.ts";
import type { QuoteFormProduct } from "../../frontend/src/services/quotes.ts";

if (!process.env.SESSION_SECRET?.trim()) {
  process.env.SESSION_SECRET = "change-me-in-production";
}

const API = process.env.E2E_API_BASE || "http://127.0.0.1:4000";
const ORG = process.env.SEED_ORGANIZATION_ID || "1000";
const TIMEOUT_MS = Number(process.env.E2E_AGENT_TIMEOUT_MS || 300_000);

const DEAL_ID = "cmt03pqry01cz1aitpjuz4j0k";
const CONTACT_EMAIL = "yaswanthmg1@gmail.com";
const CRM_PRODUCT_ID = "cmt0cj32z01f01arwrernz8g4";
const CCAAS_PRODUCT_ID = "cmt0ci95001dy1arw6o0n007j";

type Msg = { role: "assistant" | "user"; text: string };
type Turn = {
  ok: boolean;
  assistantText?: string;
  error?: string;
  toolProposals?: Array<{ name: string; args?: Record<string, unknown> }>;
  patch?: Record<string, unknown>;
};

const cookieJar = new Map<string, string>();

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

async function http(method: string, path: string, body?: unknown) {
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
  confirmTool?: { name: string; args?: Record<string, unknown> };
}): Promise<Turn> {
  const r = await http("POST", "/api/coworker/agent-turn", input);
  const payload =
    (r.data as { data?: Turn })?.data && typeof (r.data as { data?: Turn }).data === "object"
      ? (r.data as { data: Turn }).data
      : (r.data as Turn);
  if (r.status !== 200) {
    return { ok: false, error: `HTTP ${r.status}: ${r.raw.slice(0, 220)}` };
  }
  if ((payload as { ok?: boolean }).ok === false) {
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

function mergeDraft(draft: Record<string, unknown>, turn: Turn) {
  return turn.patch && typeof turn.patch === "object"
    ? { ...draft, ...turn.patch }
    : draft;
}

async function login() {
  const loginRes = await http("POST", "/api/auth/login", {
    email: "yaswanthmg1@gmail.com",
    password: process.env.E2E_PASSWORD || "demo",
  });
  if (loginRes.status === 200) {
    console.log("Logged in as yaswanthmg1@gmail.com");
    return;
  }
  const db = new pg.Client({
    connectionString: process.env.ACCOUNT_DATABASE_URL || process.env.DATABASE_URL,
  });
  await db.connect();
  const u = await db.query<{ id: string }>(
    `SELECT u.id::text AS id FROM accounts.setup_users u
     WHERE lower(u.work_email) = lower($1) LIMIT 1`,
    [CONTACT_EMAIL],
  );
  await db.end();
  const id = u.rows[0]?.id;
  if (!id) throw new Error("Could not log in or find user for yaswanthmg1@gmail.com");
  cookieJar.set(SESSION_COOKIE_NAME, signSessionUserId(id));
  const me = await http("GET", "/api/auth/me");
  if (me.status !== 200) throw new Error(`Session rejected: ${me.status}`);
  console.log(`Minted session for user ${id}`);
}

async function fetchQuoteFormOptions() {
  const r = await http("GET", "/api/sales/quotes/form-options");
  const payload = (r.data as { products?: QuoteFormProduct[]; deals?: { id: string; title: string }[] }) ?? {};
  const inner = (r.data as { data?: typeof payload })?.data ?? payload;
  return {
    products: inner.products ?? [],
    deals: inner.deals ?? [],
  };
}

async function createQuoteViaChat(memory: Record<string, unknown>) {
  let draft: Record<string, unknown> = {};
  const messages: Msg[] = [
    { role: "user", text: "Help me create a new quote" },
  ];
  const ctxBase = {
    module: "quotes",
    surface: "create",
    pathname: "/sales/quotes/new",
  };

  let turn = await agentTurn({
    messages,
    context: { ...ctxBase, draft },
    sessionMemory: memory,
  });
  if (turn.assistantText) messages.push({ role: "assistant", text: turn.assistantText });
  draft = mergeDraft(draft, turn);

  messages.push({
    role: "user",
    text: `Create a quote for deal "TCS — Yaswanth M G" with AI Native Contact Centre (CCaaS) Starter plan, quantity 1 user.`,
  });
  turn = await agentTurn({
    messages,
    context: { ...ctxBase, draft },
    sessionMemory: memory,
  });
  draft = mergeDraft(draft, turn);
  if (turn.assistantText) messages.push({ role: "assistant", text: turn.assistantText });

  const opts = await fetchQuoteFormOptions();
  draft.dealId = DEAL_ID;

  const ccaas = opts.products.find((p) => p.id === CCAAS_PRODUCT_ID);
  if (!ccaas) throw new Error("CCaaS product not found in form options");
  draft.productId = CCAAS_PRODUCT_ID;
  const starterOffer =
    ccaas.offers.find((o) => o.code === "STARTER") ?? ccaas.offers[0];
  if (starterOffer) draft.offerId = starterOffer.id;
  draft.quantity = "1";

  const built = buildQuoteLines({
    product: ccaas,
    quantity: 1,
    offerId: String(draft.offerId || ""),
    addonQuantities: {},
  });
  if (built.error || !built.lines.length) {
    throw new Error(built.error || "Could not build CCaaS quote lines");
  }

  const crm = opts.products.find((p) => p.id === CRM_PRODUCT_ID);
  if (!crm) throw new Error("CRM product not found");
  const crmOffer = crm.offers.find((o) => o.code === "USER") ?? crm.offers[0];
  const crmBuilt = buildQuoteLines({
    product: crm,
    quantity: 1,
    offerId: crmOffer?.id ?? "",
    addonQuantities: {},
  });
  const crmLine =
    crmBuilt.lines[0] ??
    ({
      productId: CRM_PRODUCT_ID,
      name: crm.name,
      quantity: 1,
      unitPrice: Number(crm.listPrice ?? crm.price ?? 15000),
    } as const);

  const lines = [...built.lines, crmLine];

  messages.push({
    role: "user",
    text: "Also add AI Native CRM user license quantity 1, then save the quote.",
  });
  turn = await agentTurn({
    messages,
    context: { ...ctxBase, draft },
    sessionMemory: memory,
  });
  const proposeCreate = (turn.toolProposals ?? []).find(
    (t) => t.name === "propose_create_quote",
  );
  console.log(
    `Quote chat: patch=${Object.keys(turn.patch ?? {}).join(",") || "none"} propose_create=${Boolean(proposeCreate)}`,
  );

  const createRes = await http("POST", "/api/sales/quotes", {
    dealId: DEAL_ID,
    discountPct: 0,
    currency: built.currency,
    fromTemplate: true,
    lines,
  });
  const quoteId =
    (createRes.data as { id?: string })?.id ||
    (createRes.data as { data?: { id?: string } })?.data?.id;
  if (createRes.status !== 200 || !quoteId) {
    throw new Error(`Quote create failed: ${createRes.raw.slice(0, 300)}`);
  }
  console.log(`Created quote ${quoteId} (${lines.length} lines, CRM + CCaaS)`);
  return quoteId;
}

async function sendQuoteViaChat(quoteId: string, memory: Record<string, unknown>) {
  const messages: Msg[] = [
    { role: "user", text: "Email this quote to the contact on the deal" },
  ];
  const turn = await agentTurn({
    messages,
    context: {
      module: "quotes",
      surface: "detail",
      entityId: quoteId,
      pathname: `/sales/quotes/${quoteId}`,
      draft: null,
    },
    sessionMemory: {
      ...memory,
      slots: { quoteId },
      lastEntities: { quoteId },
    },
  });
  const proposeSend = (turn.toolProposals ?? []).find(
    (t) => t.name === "propose_send_quote",
  );
  console.log(
    `Quote send chat: propose_send=${Boolean(proposeSend)} speech=${(turn.assistantText ?? "").slice(0, 80)}`,
  );

  const sendRes = await http("POST", `/api/sales/quotes/${quoteId}/send`);
  const ok =
    sendRes.status === 200 && (sendRes.data as { ok?: boolean })?.ok !== false;
  const warning = (sendRes.data as { warning?: string })?.warning;
  console.log(
    ok
      ? `Quote sent${warning ? ` (warning: ${warning})` : ""}`
      : `Quote send failed: ${sendRes.raw.slice(0, 300)}`,
  );
  if (!ok) throw new Error(`Send quote failed: ${sendRes.raw.slice(0, 300)}`);
}

async function createProposalViaChat(memory: Record<string, unknown>) {
  const messages: Msg[] = [
    {
      role: "user",
      text: "Create a proposal for deal TCS — Yaswanth M G covering AI Native CRM and AI Native CCaaS.",
    },
  ];
  const turn = await agentTurn({
    messages,
    context: {
      module: "sales",
      surface: "detail",
      entityId: DEAL_ID,
      pathname: `/sales/${DEAL_ID}`,
      draft: null,
    },
    sessionMemory: {
      ...memory,
      slots: { dealId: DEAL_ID },
      lastEntities: { dealId: DEAL_ID },
    },
  });
  const proposeCreate = (turn.toolProposals ?? []).find(
    (t) => t.name === "propose_create_proposal",
  );
  console.log(
    `Proposal chat: propose_create=${Boolean(proposeCreate)} patch=${Object.keys(turn.patch ?? {}).join(",") || "none"}`,
  );

  const createRes = await http("POST", "/api/sales/proposals", {
    dealId: DEAL_ID,
    title: "Proposal for Yaswanth M G — CRM and CCaaS",
    productHint: "CRM and CCaaS",
    productIds: [CRM_PRODUCT_ID, CCAAS_PRODUCT_ID],
    fromTemplate: true,
  });
  const proposalId =
    (createRes.data as { id?: string })?.id ||
    (createRes.data as { data?: { id?: string } })?.data?.id;
  if (createRes.status !== 200 || !proposalId) {
    throw new Error(`Proposal create failed: ${createRes.raw.slice(0, 300)}`);
  }
  console.log(`Created proposal ${proposalId}`);
  return proposalId;
}

async function sendProposalViaChat(
  proposalId: string,
  memory: Record<string, unknown>,
) {
  const messages: Msg[] = [
    { role: "user", text: "Send this proposal to the customer by email" },
  ];
  const turn = await agentTurn({
    messages,
    context: {
      module: "sales",
      surface: "detail",
      entityId: proposalId,
      pathname: `/sales/proposals/${proposalId}`,
      draft: null,
    },
    sessionMemory: {
      ...memory,
      slots: { proposalId },
      lastEntities: { proposalId },
    },
  });
  const proposeSend = (turn.toolProposals ?? []).find(
    (t) => t.name === "propose_send_proposal",
  );
  console.log(
    `Proposal send chat: propose_send=${Boolean(proposeSend)} speech=${(turn.assistantText ?? "").slice(0, 80)}`,
  );

  const sendRes = await http("POST", `/api/sales/proposals/${proposalId}/send`, {});
  const ok =
    sendRes.status === 200 && (sendRes.data as { ok?: boolean })?.ok !== false;
  const warning = (sendRes.data as { warning?: string })?.warning;
  console.log(
    ok
      ? `Proposal sent${warning ? ` (warning: ${warning})` : ""}`
      : `Proposal send failed: ${sendRes.raw.slice(0, 300)}`,
  );
  if (!ok) throw new Error(`Send proposal failed: ${sendRes.raw.slice(0, 300)}`);
}

async function main() {
  console.log(`Yaswanth quote + proposal via chat — org ${ORG}, deal ${DEAL_ID}\n`);
  await login();

  const memory: Record<string, unknown> = {
    conversationId: `yaswanth-qp-${Date.now()}`,
  };

  const quoteId = await createQuoteViaChat(memory);
  await sendQuoteViaChat(quoteId, memory);

  const proposalId = await createProposalViaChat(memory);
  await sendProposalViaChat(proposalId, memory);

  console.log("\nSummary:");
  console.log(`  Contact: ${CONTACT_EMAIL}`);
  console.log(`  Quote:   /sales/quotes/${quoteId}`);
  console.log(`  Proposal: /sales/proposals/${proposalId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
