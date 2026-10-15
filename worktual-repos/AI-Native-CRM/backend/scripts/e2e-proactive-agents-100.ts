/**
 * Live E2E: create N new leads (default 100) and audit every proactive agent.
 *
 * Run: npx tsx --env-file=../.env scripts/e2e-proactive-agents-100.ts
 *
 * Creates tagged contacts (leadSource=e2e_proactive_100) via the real API so
 * onLeadCreated fires enrich → score → summary → assign|nurture → lifecycle.
 * Extra proactive agents (meetings, forecast, inbound, hygiene, …) run on a
 * subset of those new leads plus existing finance fixtures.
 *
 * Env: E2E_LEAD_COUNT, E2E_CREATE_GAP_MS, E2E_PIPELINE_WAIT_MS, E2E_CONCURRENCY
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import pg from "pg";
import {
  SESSION_COOKIE_NAME,
  signSessionUserId,
} from "../src/service/account/session-crypto.ts";

const API = (process.env.E2E_API_BASE || "http://127.0.0.1:4000").replace(/\/$/, "");
const AI = (process.env.AI_SERVICE_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const SECRET =
  process.env.ENRICH_INTERNAL_SECRET?.trim() ||
  process.env.CRON_SECRET?.trim() ||
  "";
const EMAIL = process.env.E2E_EMAIL || "admin.b2b@worktual.com";
const PASSWORD = process.env.E2E_PASSWORD || "demo";
const COUNT = Math.min(200, Math.max(1, Number(process.env.E2E_LEAD_COUNT || 100)));
const CREATE_GAP_MS = Number(process.env.E2E_CREATE_GAP_MS || 2500);
const PIPELINE_WAIT_MS = Number(process.env.E2E_PIPELINE_WAIT_MS || 45 * 60_000);
const CONCURRENCY = Math.min(8, Math.max(1, Number(process.env.E2E_CONCURRENCY || 4)));
const AGENT_TIMEOUT_MS = Number(process.env.E2E_AGENT_TIMEOUT_MS || 120_000);
const BATCH = `e2e100-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}-${randomBytes(2).toString("hex")}`;
const OUT = process.env.E2E_OUT || `${process.cwd()}/../.tmp-e2e-proactive-100.json`;

type Verdict = "PASS" | "FAIL" | "WARN" | "INFRA" | "SKIP";

type AgentRow = {
  lead?: number;
  contactId?: string;
  set: string;
  agent: string;
  subject: string;
  verdict: Verdict;
  ms: number;
  detail: string;
};

type LeadRec = {
  i: number;
  id: string;
  persona: "hot" | "warm" | "cold";
  email: string;
  companyName: string;
  title: string;
  companyId?: string | null;
  locationId?: string | null;
};

const SAMPLE_TRANSCRIPT = `
Rep: Thanks for joining. We wanted to walk through Worktual CRM for your team.
Customer: We are comparing two vendors. Budget is roughly 80k USD this quarter if we can go live in September.
Rep: Who else signs off?
Customer: My VP and finance. Main objection is migration from HubSpot.
Rep: We can phase the import. Next step is a technical workshop Thursday 4pm IST.
Customer: Send a recap and the security questionnaire. Do not share this with marketing lists.
`.trim();

const HOT_COS = [
  { name: "Infosys", domain: "infosys.com", industry: "IT Services" },
  { name: "Tata Consultancy Services", domain: "tcs.com", industry: "IT Services" },
  { name: "Wipro", domain: "wipro.com", industry: "IT Services" },
  { name: "Accenture", domain: "accenture.com", industry: "Consulting" },
  { name: "Zoho Corporation", domain: "zoho.com", industry: "Software" },
  { name: "Freshworks", domain: "freshworks.com", industry: "Software" },
  { name: "HDFC Bank", domain: "hdfcbank.com", industry: "Banking" },
  { name: "KPMG", domain: "kpmg.com", industry: "Professional Services" },
  { name: "Capgemini", domain: "capgemini.com", industry: "Consulting" },
  { name: "HCLTech", domain: "hcltech.com", industry: "IT Services" },
];

const results: AgentRow[] = [];
const cookieJar = new Map<string, string>();

function clip(v: unknown, n = 220): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (!s) return "";
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

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

function record(row: AgentRow) {
  results.push(row);
  console.log(
    `${row.verdict.padEnd(5)} ${row.set.padEnd(22)} ${row.agent.padEnd(26)} ${(row.ms / 1000).toFixed(1)}s  ${row.detail}`,
  );
}

function sourceOf(body: Record<string, unknown> | null): string {
  if (!body) return "";
  const flags = body.flags as Record<string, unknown> | undefined;
  const nested = (body.decision as Record<string, unknown> | undefined)?.source;
  return String(body.source ?? flags?.source ?? nested ?? body.fallbackReason ?? "");
}

function classifyBlob(
  agent: string,
  status: number,
  body: Record<string, unknown> | null,
  err: string | null,
): { verdict: Verdict; detail: string } {
  if (err?.includes("abort") || err?.includes("Timeout") || err?.includes("timeout")) {
    return { verdict: "FAIL", detail: `timeout: ${err}` };
  }
  if (status === 401 || status === 403) return { verdict: "INFRA", detail: `auth ${status}` };
  if (status >= 400) return { verdict: "FAIL", detail: `http ${status} ${clip(err || body)}` };
  if (!body) return { verdict: "FAIL", detail: "empty body" };
  const blob = JSON.stringify(body);
  if (/unauthorized_client|crm_bot_gmail_reauth|Google token refresh failed|mailbox needs re-authentication/i.test(blob)) {
    return { verdict: "INFRA", detail: "CRM bot Gmail needs reconnect in Accounts" };
  }
  if (/timed?\s*out|LLM unavailable|llm_unavailable|llm_empty/i.test(blob) && /heuristic/i.test(blob)) {
    return { verdict: "WARN", detail: `LLM fallback ${clip(body)}` };
  }
  const src = sourceOf(body);
  if (src === "heuristic" || src === "offline") {
    return { verdict: "WARN", detail: `heuristic fallback ${clip(body)}` };
  }
  if (body.error && body.ok === false) return { verdict: "FAIL", detail: clip(body.error) };
  const keys: Record<string, string[]> = {
    "enrich-lead": ["status", "payload", "companyName", "ok"],
    "score-lead": ["score", "fitScore", "intentScore"],
    "summarize-lead": ["summary", "headline", "text"],
    "nurture-lead": ["decision", "status", "subject"],
    "lifecycle-lead": ["decision", "status", "action"],
    "assign-sales": ["ownerUserId", "userId", "assignment", "reason", "owner"],
    "audit-forecast": ["decision", "flagged", "forecast"],
    "invoice-escalation": ["decision", "severity", "escalation"],
    "expansion-matcher": ["decision", "signal", "expansion"],
    "auto-reply-email": ["decision", "status", "reply"],
    "meeting-brief-email": ["subject", "body", "ok", "status"],
    "meeting-mom": ["internalMom", "customerMom", "summary", "mom"],
    "meeting-miss-escalation": ["decision", "shouldNotify", "status"],
    "post-meeting-process": ["actions", "decision", "ok"],
    "sales-coach": ["coachingNote", "overallImpression", "insight"],
    "compliance-privacy": ["decision", "requestType", "action"],
    hygiene: ["action", "rationale", "ok"],
    "analyze-transcript": ["summary", "actions", "ok"],
    "assist-meeting": ["ok", "insight", "suggestion"],
    "compose-email": ["subject", "body", "ok"],
  };
  const want = keys[agent];
  if (want && !want.some((k) => body[k] != null || blob.includes(`"${k}"`))) {
    return { verdict: "WARN", detail: `unexpected shape ${clip(body)}` };
  }
  return { verdict: "PASS", detail: clip(body) };
}

async function http(
  method: string,
  path: string,
  body?: unknown,
  extra: Record<string, string> = {},
): Promise<{ status: number; data: any; raw: string }> {
  const headers: Record<string, string> = { cookie: cookieHeader(), ...extra };
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

async function callAgent(
  agent: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> | null; err: string | null; ms: number }> {
  const started = Date.now();
  try {
    const res = await fetch(`${AI}/ai/v1/agents/${agent}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(SECRET ? { "x-internal-secret": SECRET } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(AGENT_TIMEOUT_MS),
    });
    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      json = { raw: text.slice(0, 400) };
    }
    return { status: res.status, json, err: res.ok ? null : text.slice(0, 400), ms: Date.now() - started };
  } catch (e) {
    return {
      status: 0,
      json: null,
      err: e instanceof Error ? e.message : String(e),
      ms: Date.now() - started,
    };
  }
}

async function runCase(
  set: string,
  agent: string,
  subject: string,
  body: Record<string, unknown>,
  lead?: number,
  contactId?: string,
) {
  const { status, json, err, ms } = await callAgent(agent, body);
  const { verdict, detail } = classifyBlob(agent, status, json, err);
  record({ lead, contactId, set, agent, subject, verdict, ms, detail });
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (true) {
        const i = next;
        next += 1;
        if (i >= items.length) return;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}

function personaFor(i: number): "hot" | "warm" | "cold" {
  if (i < 40) return "hot";
  if (i < 70) return "warm";
  return "cold";
}

function leadPayload(i: number): { persona: "hot" | "warm" | "cold"; body: Record<string, unknown> } {
  const persona = personaFor(i);
  const first = ["Asha", "Rahul", "Priya", "Vikram", "Meera", "Arjun", "Nisha", "Karan"][i % 8];
  const last = `E2E${String(i).padStart(3, "0")}`;
  const email = `${BATCH}.${i}@example.test`;
  if (persona === "hot") {
    const co = HOT_COS[i % HOT_COS.length]!;
    const title = ["CEO", "VP Sales", "Chief Procurement Officer", "Managing Director"][i % 4];
    return {
      persona,
      body: {
        firstName: first,
        lastName: last,
        email,
        title,
        city: ["Bengaluru", "Mumbai", "London", "Chennai"][i % 4],
        country: i % 4 === 2 ? "United Kingdom" : "India",
        companyName: co.name,
        companyDomain: co.domain,
        companyIndustry: co.industry,
        contactType: "lead",
        leadSource: "e2e_proactive_100",
        leadStatus: "new",
        bantNeed: true,
        bantAuthority: true,
        bantBudget: true,
        notes: `${BATCH} hot persona — requested a demo and pricing.`,
      },
    };
  }
  if (persona === "warm") {
    const co = HOT_COS[(i + 3) % HOT_COS.length]!;
    return {
      persona,
      body: {
        firstName: first,
        lastName: last,
        email,
        title: ["IT Manager", "Operations Lead", "Head of CX"][i % 3],
        city: "Hyderabad",
        country: "India",
        companyName: co.name,
        companyDomain: co.domain,
        companyIndustry: co.industry,
        contactType: "lead",
        leadSource: "e2e_proactive_100",
        leadStatus: "new",
        bantNeed: true,
        notes: `${BATCH} warm persona — downloaded a whitepaper.`,
      },
    };
  }
  return {
    persona,
    body: {
      firstName: first,
      lastName: last,
      email,
      title: ["Intern", "Coordinator", "Student"][i % 3],
      city: "Pune",
      country: "India",
      companyName: `E2E Cold Shop ${BATCH} ${i}`,
      companyDomain: `cold-${i}.${BATCH}.example.test`,
      companyIndustry: "Other",
      contactType: "lead",
      leadSource: "e2e_proactive_100",
      leadStatus: "new",
      notes: `${BATCH} cold persona — CSV import, thin profile.`,
    },
  };
}

async function drain(paths: string[]) {
  for (const path of paths) {
    await http("POST", `/api/cron/${path}`, {}, { Authorization: `Bearer ${SECRET}` });
  }
}

function jobVerdict(
  agent: string,
  status: string | null,
  extra: Record<string, unknown>,
): { verdict: Verdict; detail: string } {
  const st = String(status || "missing");
  const err = String(extra.lastError || extra.last_error || "");
  const src = String(extra.source || extra.resultSource || "");
  const blob = JSON.stringify(extra);
  if (/unauthorized_client|crm_bot_gmail_reauth|Google token refresh failed|mailbox needs re-authentication/i.test(blob + err)) {
    return { verdict: "INFRA", detail: "CRM bot Gmail needs reconnect in Accounts" };
  }
  if (st === "missing") return { verdict: "FAIL", detail: "no job row" };
  if (["pending", "running", "scoring", "analyzing"].includes(st)) {
    return { verdict: "FAIL", detail: `still ${st}` };
  }
  if (st === "failed") return { verdict: "FAIL", detail: err || "failed" };
  if (src === "heuristic" || src === "offline") {
    return { verdict: "WARN", detail: `heuristic ${st} ${clip(extra)}` };
  }
  if (agent === "enrich-lead" && st === "skipped") {
    return { verdict: "WARN", detail: `skipped ${clip(extra.resultSummary || err)}` };
  }
  return { verdict: "PASS", detail: clip({ status: st, ...extra }) };
}

function writeOut(extra: Record<string, unknown>) {
  const counts = { PASS: 0, FAIL: 0, WARN: 0, INFRA: 0, SKIP: 0 };
  for (const r of results) counts[r.verdict] += 1;
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        batch: BATCH,
        count: COUNT,
        at: new Date().toISOString(),
        counts,
        ...extra,
        results,
      },
      null,
      2,
    ),
  );
}

async function main() {
  console.log(`E2E 100-lead proactive run  batch=${BATCH}  n=${COUNT}`);
  console.log(`API ${API}  AI ${AI}  out ${OUT}\n`);

  if (!SECRET) {
    console.error("ENRICH_INTERNAL_SECRET / CRON_SECRET missing");
    process.exit(1);
  }

  const apiHealth = await fetch(`${API}/health`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
  const aiHealth = await fetch(`${AI}/health`, { signal: AbortSignal.timeout(5000) })
    .then((r) => r.json() as Promise<{ status?: string }>)
    .catch(() => null);
  if (!apiHealth?.ok) {
    console.error("API is down at", API);
    process.exit(1);
  }
  if (aiHealth?.status !== "ok") {
    console.error("ai-service is down at", AI);
    process.exit(1);
  }

  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  const login = await http("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
  let orgId = String(login.data?.user?.organizationId || login.data?.organizationId || "");
  if (login.status !== 200) {
    const u = await db.query(
      `
      SELECT u.id::text AS id, u.organization_id::text AS org
      FROM accounts.setup_users u
      JOIN accounts.setup_user_product_access a
        ON a.user_id = u.id AND a.product_id = 'crm'
      JOIN accounts.setup_roles r ON r.id = a.role_id
      WHERE u.status = 'active'
        AND u.organization_id = 1000
        AND lower(r.name) IN ('admin', 'sales_manager')
      ORDER BY u.id
      LIMIT 1
      `,
    );
    const row = u.rows[0] as { id?: string; org?: string } | undefined;
    if (!row?.id) {
      console.error("login failed and no org-1000 CRM admin in setup_users", login.raw.slice(0, 200));
      process.exit(1);
    }
    cookieJar.set(SESSION_COOKIE_NAME, signSessionUserId(row.id));
    orgId = row.org || "1000";
    const me = await http("GET", "/api/auth/me");
    if (me.status !== 200) {
      console.error("minted session rejected", me.status, me.raw.slice(0, 200));
      process.exit(1);
    }
    console.log("session minted for CRM admin user", row.id, "org", orgId);
  } else {
    orgId = orgId || "1000";
    console.log("logged in", EMAIL, "org", orgId);
  }

  const leads: LeadRec[] = [];
  console.log("\n── create leads ──");
  for (let i = 0; i < COUNT; i++) {
    const { persona, body } = leadPayload(i);
    const started = Date.now();
    const r = await http("POST", "/api/contacts", body);
    const id = r.data?.id ? String(r.data.id) : "";
    if (r.status !== 200 || !id) {
      record({
        lead: i,
        set: `lead-${String(i).padStart(3, "0")}`,
        agent: "create-contact",
        subject: String(body.email),
        verdict: "FAIL",
        ms: Date.now() - started,
        detail: clip(r.raw),
      });
      continue;
    }
    leads.push({
      i,
      id,
      persona,
      email: String(body.email),
      companyName: String(body.companyName),
      title: String(body.title || ""),
    });
    record({
      lead: i,
      contactId: id,
      set: `lead-${String(i).padStart(3, "0")}`,
      agent: "create-contact",
      subject: id,
      verdict: "PASS",
      ms: Date.now() - started,
      detail: `${persona} ${body.title} @ ${body.companyName}`,
    });
    if (i + 1 < COUNT) await new Promise((res) => setTimeout(res, CREATE_GAP_MS));
    if ((i + 1) % 10 === 0) {
      console.log(`  created ${i + 1}/${COUNT}`);
      writeOut({ leads: leads.length, phase: "create" });
    }
  }

  const ids = leads.map((l) => l.id);
  console.log(`\n── wait pipeline (${ids.length} leads, up to ${Math.round(PIPELINE_WAIT_MS / 60000)} min) ──`);

  const startedWait = Date.now();
  let settled = false;
  while (Date.now() - startedWait < PIPELINE_WAIT_MS) {
    await drain(["lead-enrichment", "lead-scoring", "lead-nurture", "lead-lifecycle"]);
    const stats = await db.query(
      `
      SELECT
        (SELECT count(*) FROM crm.lead_enrichment_jobs WHERE contact_id = ANY($1::text[])) AS enrich_rows,
        (SELECT count(*) FROM crm.lead_enrichment_jobs WHERE contact_id = ANY($1::text[]) AND status IN ('enriched','skipped','failed')) AS enrich_done,
        (SELECT count(*) FROM crm.lead_scoring_jobs WHERE contact_id = ANY($1::text[])) AS score_rows,
        (SELECT count(*) FROM crm.lead_scoring_jobs WHERE contact_id = ANY($1::text[]) AND status IN ('scored','failed')) AS score_done,
        (SELECT count(*) FROM crm.lead_summaries WHERE contact_id = ANY($1::text[])) AS summaries,
        (SELECT count(*) FROM crm.lead_nurture_jobs WHERE contact_id = ANY($1::text[]) AND status IN ('sent','waited','skipped','failed')) AS nurture_done,
        (SELECT count(*) FROM crm.lead_lifecycle_jobs WHERE contact_id = ANY($1::text[]) AND status IN ('applied','waited','skipped','failed')) AS life_done,
        (SELECT count(*) FROM crm.contact_profiles WHERE account_contact_id = ANY($1::text[]) AND owner_user_id IS NOT NULL) AS owned
      `,
      [ids],
    );
    const s = stats.rows[0] || {};
    console.log(
      `  t=${Math.round((Date.now() - startedWait) / 1000)}s enrich ${s.enrich_done}/${ids.length}  score ${s.score_done}/${ids.length}  summaries ${s.summaries}  owned ${s.owned}  nurture ${s.nurture_done}  life ${s.life_done}`,
    );
    writeOut({ leads: leads.length, phase: "pipeline", stats: s });
    if (Number(s.score_done) >= ids.length && Number(s.life_done) >= Math.floor(ids.length * 0.8)) {
      settled = true;
      break;
    }
    await new Promise((res) => setTimeout(res, 8000));
  }
  if (!settled) console.warn("pipeline wait timed out — auditing whatever finished");

  console.log("\n── audit pipeline jobs ──");
  const enrichRows = await db.query(
    `SELECT contact_id, status, last_error, result_summary FROM crm.lead_enrichment_jobs WHERE contact_id = ANY($1::text[])`,
    [ids],
  );
  const scoreRows = await db.query(
    `SELECT contact_id, status, score, fit_score, intent_score, band, grade, last_error, result_summary, rationale
     FROM crm.lead_scoring_jobs WHERE contact_id = ANY($1::text[])`,
    [ids],
  );
  const sumRows = await db.query(
    `SELECT contact_id, source, headline, left(summary, 180) AS summary FROM crm.lead_summaries WHERE contact_id = ANY($1::text[])`,
    [ids],
  );
  const nurRows = await db.query(
    `SELECT contact_id, status, decision, last_error, result_summary FROM crm.lead_nurture_jobs WHERE contact_id = ANY($1::text[])`,
    [ids],
  );
  const lifeRows = await db.query(
    `SELECT contact_id, status, decision, reason, last_error, result_summary FROM crm.lead_lifecycle_jobs WHERE contact_id = ANY($1::text[])`,
    [ids],
  );
  const profRows = await db.query(
    `SELECT account_contact_id, owner_user_id::text AS owner, assignment_reason, company_id, location_id
     FROM crm.contact_profiles WHERE account_contact_id = ANY($1::text[])`,
    [ids],
  );

  const by = <T extends { contact_id?: string; account_contact_id?: string }>(rows: T[]) => {
    const m = new Map<string, T>();
    for (const r of rows) m.set(String(r.contact_id || r.account_contact_id), r);
    return m;
  };
  const enrichBy = by(enrichRows.rows);
  const scoreBy = by(scoreRows.rows);
  const sumBy = by(sumRows.rows);
  const nurBy = by(nurRows.rows);
  const lifeBy = by(lifeRows.rows);
  const profBy = by(profRows.rows);

  for (const lead of leads) {
    const set = `lead-${String(lead.i).padStart(3, "0")}`;
    const en = enrichBy.get(lead.id) as Record<string, unknown> | undefined;
    const sc = scoreBy.get(lead.id) as Record<string, unknown> | undefined;
    const sm = sumBy.get(lead.id) as Record<string, unknown> | undefined;
    const nu = nurBy.get(lead.id) as Record<string, unknown> | undefined;
    const lf = lifeBy.get(lead.id) as Record<string, unknown> | undefined;
    const pr = profBy.get(lead.id) as Record<string, unknown> | undefined;
    lead.companyId = pr?.company_id ? String(pr.company_id) : null;
    lead.locationId = pr?.location_id ? String(pr.location_id) : null;

    const ev = jobVerdict("enrich-lead", en?.status ? String(en.status) : null, en || {});
    record({ lead: lead.i, contactId: lead.id, set, agent: "enrich-lead", subject: lead.id, verdict: ev.verdict, ms: 0, detail: ev.detail });

    const sv = jobVerdict("score-lead", sc?.status ? String(sc.status) : null, {
      ...(sc || {}),
      score: sc?.score,
      band: sc?.band,
    });
    record({
      lead: lead.i,
      contactId: lead.id,
      set,
      agent: "score-lead",
      subject: lead.id,
      verdict: sv.verdict,
      ms: 0,
      detail: sc ? `score=${sc.score} band=${sc.band} ${sv.detail}` : sv.detail,
    });

    if (sm?.summary) {
      const src = String(sm.source || "");
      record({
        lead: lead.i,
        contactId: lead.id,
        set,
        agent: "summarize-lead",
        subject: lead.id,
        verdict: src === "heuristic" || src === "offline" ? "WARN" : "PASS",
        ms: 0,
        detail: clip({ source: src, headline: sm.headline, summary: sm.summary }),
      });
    } else {
      record({
        lead: lead.i,
        contactId: lead.id,
        set,
        agent: "summarize-lead",
        subject: lead.id,
        verdict: "FAIL",
        ms: 0,
        detail: "no summary row",
      });
    }

    const scoreNum = sc?.score != null ? Number(sc.score) : null;
    const owner = pr?.owner ? String(pr.owner) : "";
    if (scoreNum != null && scoreNum >= 40) {
      record({
        lead: lead.i,
        contactId: lead.id,
        set,
        agent: "assign-sales",
        subject: lead.id,
        verdict: owner ? "PASS" : "FAIL",
        ms: 0,
        detail: owner
          ? `owner=${owner} reason=${clip(pr?.assignment_reason)}`
          : "score≥40 but still unowned",
      });
      if (nu) {
        record({
          lead: lead.i,
          contactId: lead.id,
          set,
          agent: "nurture-lead",
          subject: lead.id,
          verdict: "SKIP",
          ms: 0,
          detail: "assigned path — nurture not required",
        });
      }
    } else if (scoreNum != null) {
      const nv = jobVerdict("nurture-lead", nu?.status ? String(nu.status) : null, nu || {});
      record({
        lead: lead.i,
        contactId: lead.id,
        set,
        agent: "nurture-lead",
        subject: lead.id,
        verdict: nv.verdict,
        ms: 0,
        detail: nu ? `decision=${nu.decision} ${nv.detail}` : nv.detail,
      });
      record({
        lead: lead.i,
        contactId: lead.id,
        set,
        agent: "assign-sales",
        subject: lead.id,
        verdict: owner ? "WARN" : "SKIP",
        ms: 0,
        detail: owner ? `owned despite score ${scoreNum}` : "nurture path — assign not required",
      });
    } else {
      record({
        lead: lead.i,
        contactId: lead.id,
        set,
        agent: "assign-sales",
        subject: lead.id,
        verdict: "FAIL",
        ms: 0,
        detail: "no score, cannot route",
      });
      record({
        lead: lead.i,
        contactId: lead.id,
        set,
        agent: "nurture-lead",
        subject: lead.id,
        verdict: "FAIL",
        ms: 0,
        detail: "no score, cannot route",
      });
    }

    const lv = jobVerdict("lifecycle-lead", lf?.status ? String(lf.status) : null, lf || {});
    record({
      lead: lead.i,
      contactId: lead.id,
      set,
      agent: "lifecycle-lead",
      subject: lead.id,
      verdict: lv.verdict,
      ms: 0,
      detail: lf ? `decision=${lf.decision} ${lv.detail}` : lv.detail,
    });
  }

  const missingSummary = leads.filter((l) => !sumBy.has(l.id));
  const missingLife = leads.filter((l) => !lifeBy.has(l.id));
  if (missingSummary.length) {
    console.log(`\n── retry summarize (${missingSummary.length}) ──`);
    await mapWithConcurrency(missingSummary, CONCURRENCY, async (lead) => {
      await runCase(
        `lead-${String(lead.i).padStart(3, "0")}`,
        "summarize-lead",
        `${lead.id}:retry`,
        { contactId: lead.id, organizationId: orgId },
        lead.i,
        lead.id,
      );
    });
  }
  if (missingLife.length) {
    console.log(`\n── retry lifecycle (${missingLife.length}) ──`);
    await mapWithConcurrency(missingLife, CONCURRENCY, async (lead) => {
      await runCase(
        `lead-${String(lead.i).padStart(3, "0")}`,
        "lifecycle-lead",
        `${lead.id}:retry`,
        { contactId: lead.id, organizationId: orgId },
        lead.i,
        lead.id,
      );
    });
  }

  console.log("\n── extra proactive agents on new-lead fixtures ──");
  const fixtureLeads = leads.filter((l) => l.companyId && l.locationId).slice(0, 8);
  const meetingLeads = fixtureLeads.slice(0, 3);
  const dealLeads = fixtureLeads.slice(0, 5);
  const inboundLeads = fixtureLeads.slice(0, 5);

  for (const lead of meetingLeads) {
    const due = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
    const past = new Date(Date.now() - 6 * 60 * 60_000).toISOString();
    const mk = await http("POST", `/api/contacts/${lead.id}/activities`, {
      type: "meeting",
      subject: `E2E discovery ${BATCH}`,
      body: "Discovery call for Worktual CRM",
      dueAt: lead === meetingLeads[2] ? past : due,
    });
    const activityId = mk.data?.id ? String(mk.data.id) : "";
    if (!activityId) {
      record({
        lead: lead.i,
        contactId: lead.id,
        set: "meetings",
        agent: "create-meeting",
        subject: lead.id,
        verdict: "FAIL",
        ms: 0,
        detail: clip(mk.raw),
      });
      continue;
    }
    await runCase("meetings", "meeting-brief-email", activityId, {
      activityId,
      contactId: lead.id,
      organizationId: orgId,
      audience: "owner",
    }, lead.i, lead.id);
    await runCase("meetings", "meeting-brief-email", `${activityId}:t24h`, {
      activityId,
      contactId: lead.id,
      organizationId: orgId,
      reminderWindow: "t24h",
      audience: "owner",
    }, lead.i, lead.id);
    await runCase("meetings", "meeting-miss-escalation", activityId, {
      activityId,
      organizationId: orgId,
      context: {
        activityId,
        contactId: lead.id,
        subject: `E2E discovery ${BATCH}`,
        hoursPastDue: 6,
      },
    }, lead.i, lead.id);
    await runCase("meetings", "meeting-mom", activityId, {
      activityId,
      contactId: lead.id,
      organizationId: orgId,
      transcript: SAMPLE_TRANSCRIPT,
      topic: `E2E discovery ${BATCH}`,
    }, lead.i, lead.id);
    await runCase("meetings", "post-meeting-process", activityId, {
      activityId,
      contactId: lead.id,
      organizationId: orgId,
      transcript: SAMPLE_TRANSCRIPT,
    }, lead.i, lead.id);
    await runCase("meetings", "sales-coach", activityId, {
      activityId,
      contactId: lead.id,
      organizationId: orgId,
      transcript: SAMPLE_TRANSCRIPT,
      contactName: lead.email,
    }, lead.i, lead.id);
    await runCase("meetings", "analyze-transcript", activityId, {
      transcript: SAMPLE_TRANSCRIPT,
      contactId: lead.id,
      organizationId: orgId,
    }, lead.i, lead.id);
    await runCase("meetings", "assist-meeting", activityId, {
      transcript: SAMPLE_TRANSCRIPT,
      contactId: lead.id,
      organizationId: orgId,
    }, lead.i, lead.id);
  }

  const dealIds: string[] = [];
  for (const lead of dealLeads) {
    const created = await http("POST", "/api/sales/deals", {
      title: `E2E ${BATCH} ${lead.i}`,
      companyId: lead.companyId,
      locationId: lead.locationId,
      contactId: lead.id,
      amount: lead.persona === "hot" ? 80000 : 12000,
      stage: "qualification",
    });
    const dealId = created.data?.id ? String(created.data.id) : "";
    if (!dealId) {
      record({
        lead: lead.i,
        contactId: lead.id,
        set: "deals",
        agent: "create-deal",
        subject: lead.id,
        verdict: "FAIL",
        ms: 0,
        detail: clip(created.raw),
      });
      continue;
    }
    dealIds.push(dealId);
    await runCase("deals", "audit-forecast", dealId, {
      dealId,
      organizationId: orgId,
    }, lead.i, lead.id);
  }

  for (const lead of inboundLeads) {
    const created = await http("POST", `/api/contacts/${lead.id}/activities`, {
      type: "email",
      subject: lead.i % 2 === 0 ? "Please delete my data (GDPR)" : "Quick question on pricing",
      body:
        lead.i % 2 === 0
          ? "Please delete all my personal data and unsubscribe me from every list. GDPR request."
          : "Can you send pricing for 50 seats? We want to book a demo next week.",
      folder: "inbox",
      emailDirection: "inbound",
    });
    const activityId = created.data?.id ? String(created.data.id) : "";
    if (!activityId) {
      record({
        lead: lead.i,
        contactId: lead.id,
        set: "inbound",
        agent: "create-inbound",
        subject: lead.id,
        verdict: "FAIL",
        ms: 0,
        detail: clip(created.raw),
      });
      continue;
    }
    await runCase("inbound", "auto-reply-email", activityId, {
      activityId,
      contactId: lead.id,
      organizationId: orgId,
    }, lead.i, lead.id);
    await runCase("inbound", "compliance-privacy", activityId, {
      activityId,
      contactId: lead.id,
      organizationId: orgId,
      subject: lead.i % 2 === 0 ? "Please delete my data" : "Pricing question",
      body:
        lead.i % 2 === 0
          ? "Please delete all my personal data and unsubscribe me from every list. GDPR request."
          : "Can you send pricing for 50 seats?",
      contactName: lead.email,
    }, lead.i, lead.id);
    await runCase("inbound", "compose-email", activityId, {
      contactId: lead.id,
      organizationId: orgId,
      intent: "follow_up",
      instruction: "Write a short follow-up email about next steps.",
    }, lead.i, lead.id);
  }

  if (leads.length >= 2) {
    const a = leads[0]!;
    const b = leads[1]!;
    await runCase("hygiene", "hygiene", `${a.id}+${b.id}`, {
      contact: { id: a.id, email: a.email, companyName: a.companyName, title: a.title },
      candidates: [{ id: b.id, email: b.email, companyName: b.companyName, title: b.title }],
      organizationId: orgId,
    });
  }

  const wonCo = await db.query(
    `SELECT c.id, c.organization_id::text org, c.name
     FROM crm.companies c
     WHERE c.organization_id = $1::bigint
       AND EXISTS (SELECT 1 FROM crm.deals d WHERE d.company_id = c.id AND d.stage = 'closed_won')
     ORDER BY c.updated_at DESC LIMIT 1`,
    [orgId],
  );
  const invoice = await db.query(
    `SELECT id, organization_id::text org FROM crm.invoices
     WHERE organization_id = $1::bigint ORDER BY updated_at DESC LIMIT 1`,
    [orgId],
  );
  if (wonCo.rows[0]) {
    await runCase("finance", "expansion-matcher", wonCo.rows[0].id, {
      companyId: wonCo.rows[0].id,
      organizationId: wonCo.rows[0].org || orgId,
    });
  } else if (dealIds[0] && dealLeads[0]?.companyId) {
    await runCase("finance", "expansion-matcher", dealLeads[0].companyId, {
      companyId: dealLeads[0].companyId,
      organizationId: orgId,
    });
  }
  if (invoice.rows[0]) {
    await runCase("finance", "invoice-escalation", invoice.rows[0].id, {
      invoiceId: invoice.rows[0].id,
      organizationId: invoice.rows[0].org || orgId,
    });
  }

  await db.end();

  const counts = { PASS: 0, FAIL: 0, WARN: 0, INFRA: 0, SKIP: 0 };
  for (const r of results) counts[r.verdict] += 1;
  const byAgent: Record<string, { PASS: number; FAIL: number; WARN: number; INFRA: number; SKIP: number; n: number }> = {};
  for (const r of results) {
    const slot = (byAgent[r.agent] ||= { PASS: 0, FAIL: 0, WARN: 0, INFRA: 0, SKIP: 0, n: 0 });
    slot[r.verdict] += 1;
    slot.n += 1;
  }

  console.log("\n── summary ──");
  console.log(counts);
  console.log("\nper agent:");
  for (const [agent, c] of Object.entries(byAgent).sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(
      `  ${agent.padEnd(26)} n=${String(c.n).padStart(3)}  PASS ${c.PASS}  FAIL ${c.FAIL}  WARN ${c.WARN}  INFRA ${c.INFRA}  SKIP ${c.SKIP}`,
    );
  }
  const bad = results.filter((x) => x.verdict === "FAIL" || x.verdict === "INFRA");
  if (bad.length) {
    console.log("\nfailures / infra:");
    for (const r of bad.slice(0, 80)) {
      console.log(`  ${r.verdict}  ${r.set} / ${r.agent}: ${r.detail}`);
    }
    if (bad.length > 80) console.log(`  … ${bad.length - 80} more`);
  }

  writeOut({
    leads: leads.map((l) => ({ i: l.i, id: l.id, persona: l.persona, companyName: l.companyName })),
    phase: "done",
    byAgent,
    settled,
  });
  console.log(`\nwrote ${OUT}`);
  if (counts.FAIL > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  writeOut({ phase: "crash", error: String(err) });
  process.exit(1);
});
