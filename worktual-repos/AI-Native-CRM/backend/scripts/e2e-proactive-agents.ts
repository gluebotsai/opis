/**
 * Live E2E: proactive native-pipeline agents against 6 real CRM sample sets.
 * Run: npx tsx --env-file=../.env scripts/e2e-proactive-agents.ts
 *
 * Calls ai-service `/ai/v1/agents/:name/run` with live contact/deal/meeting
 * ids (same path cron/jobs use). Does not create new CRM records.
 */
import pg from "pg";

const AI = (process.env.AI_SERVICE_BASE_URL || "http://127.0.0.1:8000").replace(
  /\/$/,
  "",
);
const SECRET =
  process.env.ENRICH_INTERNAL_SECRET?.trim() ||
  process.env.CRON_SECRET?.trim() ||
  "";
const TIMEOUT_MS = Number(process.env.E2E_AGENT_TIMEOUT_MS || 120_000);
const ORG = "1000";

const SAMPLE_TRANSCRIPT = `
Rep: Thanks for joining, Priya. We wanted to walk through Worktual CRM for Infosys procurement.
Customer: We are comparing two vendors. Budget is roughly 80k USD this quarter if we can go live in September.
Rep: Discovery — who else signs off?
Customer: My VP and finance. Main objection is migration from HubSpot.
Rep: We can phase the import. Next step is a technical workshop Thursday 4pm IST.
Customer: Send a recap and the security questionnaire. Do not share this with marketing lists.
`.trim();

type Verdict = "PASS" | "FAIL" | "WARN" | "INFRA";

type Result = {
  set: string;
  agent: string;
  subject: string;
  verdict: Verdict;
  ms: number;
  detail: string;
};

const results: Result[] = [];

function clip(v: unknown, n = 220): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (!s) return "";
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function sourceOf(body: Record<string, unknown>): string {
  const flags = body.flags as Record<string, unknown> | undefined;
  const nested = (body.decision as Record<string, unknown> | undefined)?.source;
  return String(
    body.source ?? flags?.source ?? nested ?? body.fallbackReason ?? "",
  );
}

function classify(
  agent: string,
  status: number,
  body: Record<string, unknown> | null,
  err: string | null,
): { verdict: Verdict; detail: string } {
  if (err?.includes("abort") || err?.includes("Timeout")) {
    return { verdict: "FAIL", detail: `timeout: ${err}` };
  }
  if (status === 401 || status === 403) {
    return { verdict: "INFRA", detail: `auth ${status}` };
  }
  if (status >= 500) {
    return { verdict: "FAIL", detail: `http ${status} ${clip(err || body)}` };
  }
  if (status >= 400) {
    return { verdict: "FAIL", detail: `http ${status} ${clip(err || body)}` };
  }
  if (!body || typeof body !== "object") {
    return { verdict: "FAIL", detail: "empty body" };
  }
  const blob = JSON.stringify(body);
  if (/unauthorized_client|crm_bot_gmail_reauth|Google token refresh failed/i.test(blob)) {
    return {
      verdict: "INFRA",
      detail: "CRM bot Gmail needs reconnect in Accounts",
    };
  }
  if (/timed?\s*out|LLM unavailable|llm_unavailable|llm_empty/i.test(blob) && /heuristic/i.test(blob)) {
    return { verdict: "WARN", detail: `LLM fallback ${clip(body)}` };
  }
  const src = sourceOf(body);
  if (src === "heuristic" || src === "offline") {
    return { verdict: "WARN", detail: `heuristic fallback ${clip(body)}` };
  }
  if (body.error && !body.ok && body.ok === false) {
    return { verdict: "FAIL", detail: clip(body.error) };
  }

  if (agent === "meeting-mom") {
    const customer = body.customerEmail as { body?: string } | undefined;
    const internal = body.internalEmail as { body?: string } | undefined;
    if (!customer?.body?.includes("MEETING OVERVIEW")) {
      return { verdict: "FAIL", detail: "customer MOM missing HTML template" };
    }
    if (!internal?.body?.includes("INTERNAL")) {
      return { verdict: "FAIL", detail: "internal MOM missing HTML template" };
    }
  }

  const keys: Record<string, string[]> = {
    "enrich-lead": ["status", "payload", "companyName", "ok"],
    "score-lead": ["score", "fitScore", "intentScore"],
    "summarize-lead": ["summary", "headline", "text"],
    "nurture-lead": ["decision", "status", "subject"],
    "lifecycle-lead": ["decision", "status", "action"],
    "assign-sales": ["ownerUserId", "userId", "assignment", "reason"],
    "audit-forecast": ["decision", "flagged", "forecast"],
    "invoice-escalation": ["decision", "severity", "escalation"],
    "expansion-matcher": ["decision", "signal", "expansion"],
    "auto-reply-email": ["decision", "status", "reply"],
    "meeting-brief-email": ["subject", "body", "ok", "status"],
    "meeting-mom": ["internalEmail", "customerEmail", "internalMom", "customerMom", "summary", "mom"],
    "meeting-miss-escalation": ["decision", "shouldNotify", "status", "subject", "body"],
    "post-meeting-process": ["actions", "decision", "ok"],
    "sales-coach": ["coachingNote", "overallImpression", "insight"],
    "compliance-privacy": ["decision", "requestType", "action"],
    hello: ["ok", "message", "agent"],
    chat: ["text", "content", "ok"],
    "analyze-transcript": ["analysis", "summary", "ok"],
    "assist-meeting": ["reply", "text", "ok", "assistantText"],
    "compose-email": ["subject", "body", "ok"],
    hygiene: ["action", "rationale", "ok"],
    "document-template": ["sections", "ok"],
    "proposal-content": ["sections", "ok"],
  };
  const want = keys[agent];
  if (want && !want.some((k) => body[k] != null || blob.includes(`"${k}"`))) {
    return { verdict: "WARN", detail: `unexpected shape ${clip(body)}` };
  }
  return { verdict: "PASS", detail: clip(body) };
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
      signal: AbortSignal.timeout(TIMEOUT_MS),
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
) {
  const { status, json, err, ms } = await callAgent(agent, body);
  const { verdict, detail } = classify(agent, status, json, err);
  const row: Result = { set, agent, subject, verdict, ms, detail };
  results.push(row);
  console.log(`${verdict.padEnd(5)} ${set.padEnd(22)} ${agent.padEnd(26)} ${(ms / 1000).toFixed(1)}s  ${detail}`);
}

async function pickSamples(c: pg.Client) {
  const leadCompany = await c.query(`
    SELECT cp.account_contact_id id, cp.organization_id::text org, cp.company_id,
           co.name AS company, cp.owner_user_id::text owner
    FROM crm.contact_profiles cp
    JOIN cdp.customer_profile p ON p.cdp_id::text = cp.account_contact_id
    JOIN crm.companies co ON co.id = cp.company_id
    WHERE cp.crm_status = 'active'
      AND lower(coalesce(p.contact_type, 'lead')) = 'lead'
    ORDER BY cp.updated_at DESC LIMIT 12`);
  const owned = leadCompany.rows.find((r) => r.owner);
  const unowned = leadCompany.rows.filter((r) => !r.owner);
  const prospect = await c.query(`
    SELECT cp.account_contact_id id, cp.organization_id::text org, cp.company_id,
           lower(coalesce(p.contact_type, 'lead')) AS contact_type
    FROM crm.contact_profiles cp
    JOIN cdp.customer_profile p ON p.cdp_id::text = cp.account_contact_id
    WHERE lower(coalesce(p.contact_type, 'lead')) IN ('prospect','customer')
      AND cp.crm_status = 'active'
    ORDER BY cp.updated_at DESC LIMIT 1`);
  const deal = await c.query(`
    SELECT id, organization_id::text org, title, stage::text, company_id, contact_id
    FROM crm.deals WHERE stage NOT IN ('closed_won','closed_lost')
    ORDER BY updated_at DESC LIMIT 1`);
  const meeting = await c.query(`
    SELECT id, organization_id::text org, subject, contact_id, due_at
    FROM crm.contact_activities WHERE type = 'meeting'
    ORDER BY COALESCE(due_at, created_at) DESC LIMIT 1`);
  const invoice = await c.query(`
    SELECT id, organization_id::text org, status::text, deal_id
    FROM crm.invoices ORDER BY updated_at DESC LIMIT 1`);
  const wonCo = await c.query(`
    SELECT c.id, c.organization_id::text org, c.name
    FROM crm.companies c
    WHERE EXISTS (SELECT 1 FROM crm.deals d WHERE d.company_id = c.id AND d.stage = 'closed_won')
    ORDER BY c.updated_at DESC LIMIT 1`);
  const inbox = await c.query(`
    SELECT id, organization_id::text org, contact_id, subject, body
    FROM crm.contact_activities
    WHERE type = 'email' AND folder = 'inbox'
    ORDER BY created_at DESC LIMIT 1`);

  return {
    infosys: unowned[0] || leadCompany.rows[0],
    google: unowned[1] || unowned[0] || leadCompany.rows[1],
    owned: owned || leadCompany.rows[0],
    prospect: prospect.rows[0],
    deal: deal.rows[0],
    meeting: meeting.rows[0],
    invoice: invoice.rows[0],
    wonCo: wonCo.rows[0],
    inbox: inbox.rows[0],
  };
}

async function main() {
  const health = await fetch(`${AI}/health`, { signal: AbortSignal.timeout(5000) })
    .then((r) => r.json() as Promise<{ status?: string }>)
    .catch(() => null);
  if (health?.status !== "ok") {
    console.error("ai-service is down at", AI);
    process.exit(1);
  }

  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const s = await pickSamples(c);
  await c.end();

  console.log("Sample sets:");
  console.log("  1 Infosys-like lead", s.infosys?.id, s.infosys?.company);
  console.log("  2 Unowned lead     ", s.google?.id, s.google?.company);
  console.log("  3 Owned lead       ", s.owned?.id, s.owned?.company, "owner", s.owned?.owner);
  console.log("  4 Prospect/deal    ", s.prospect?.id, s.deal?.id, s.deal?.title);
  console.log("  5 Meeting          ", s.meeting?.id, s.meeting?.subject);
  console.log("  6 Invoice/expansion", s.invoice?.id, s.wonCo?.id, s.inbox?.id);
  console.log("");

  const org = (row: { org?: string } | undefined) => row?.org || ORG;

  // Set 1 — new B2B lead with company (enrich → score → summary → assign → lifecycle)
  if (s.infosys) {
    const id = s.infosys.id;
    const organizationId = org(s.infosys);
    await runCase("1-new-b2b-lead", "enrich-lead", id, { contactId: id, organizationId, force: true });
    await runCase("1-new-b2b-lead", "score-lead", id, { contactId: id, organizationId, force: true });
    await runCase("1-new-b2b-lead", "summarize-lead", id, { contactId: id, organizationId });
    await runCase("1-new-b2b-lead", "assign-sales", id, {
      contactId: id,
      companyId: s.infosys.company_id,
      organizationId,
    });
    await runCase("1-new-b2b-lead", "lifecycle-lead", id, { contactId: id, organizationId });
  }

  // Set 2 — unowned / cold lead (nurture path)
  if (s.google) {
    const id = s.google.id;
    const organizationId = org(s.google);
    await runCase("2-unowned-cold-lead", "score-lead", id, { contactId: id, organizationId, force: true });
    await runCase("2-unowned-cold-lead", "nurture-lead", id, { contactId: id, organizationId });
    await runCase("2-unowned-cold-lead", "lifecycle-lead", id, { contactId: id, organizationId });
  }

  // Set 3 — assigned lead
  if (s.owned) {
    const id = s.owned.id;
    const organizationId = org(s.owned);
    await runCase("3-owned-lead", "score-lead", id, { contactId: id, organizationId, force: true });
    await runCase("3-owned-lead", "summarize-lead", id, { contactId: id, organizationId });
    await runCase("3-owned-lead", "lifecycle-lead", id, { contactId: id, organizationId });
  }

  // Set 4 — prospect + open deal (forecast + post-meeting family)
  if (s.deal) {
    await runCase("4-open-deal", "audit-forecast", s.deal.id, {
      dealId: s.deal.id,
      organizationId: org(s.deal),
    });
  }
  if (s.prospect) {
    await runCase("4-open-deal", "lifecycle-lead", s.prospect.id, {
      contactId: s.prospect.id,
      organizationId: org(s.prospect),
    });
  }

  // Set 5 — meeting agents
  if (s.meeting) {
    const organizationId = org(s.meeting);
    await runCase("5-meeting", "meeting-brief-email", s.meeting.id, {
      activityId: s.meeting.id,
      contactId: s.meeting.contact_id,
      organizationId,
      audience: "owner",
    });
    await runCase("5-meeting", "meeting-brief-email", `${s.meeting.id}:t24h`, {
      activityId: s.meeting.id,
      contactId: s.meeting.contact_id,
      organizationId,
      reminderWindow: "t24h",
      audience: "owner",
    });
    await runCase("5-meeting", "meeting-miss-escalation", s.meeting.id, {
      activityId: s.meeting.id,
      organizationId,
      context: {
        activityId: s.meeting.id,
        contactId: s.meeting.contact_id,
        subject: s.meeting.subject,
        hoursPastDue: 6,
      },
    });
    await runCase("5-meeting", "meeting-mom", s.meeting.id, {
      activityId: s.meeting.id,
      contactId: s.meeting.contact_id,
      organizationId,
      transcript: SAMPLE_TRANSCRIPT,
      topic: s.meeting.subject,
    });
    await runCase("5-meeting", "post-meeting-process", s.meeting.id, {
      activityId: s.meeting.id,
      contactId: s.meeting.contact_id,
      organizationId,
      transcript: SAMPLE_TRANSCRIPT,
    });
    await runCase("5-meeting", "sales-coach", s.meeting.id, {
      activityId: s.meeting.id,
      contactId: s.meeting.contact_id,
      organizationId,
      transcript: SAMPLE_TRANSCRIPT,
      contactName: "Priya",
    });
  }

  // Set 6 — finance / expansion / inbound mail
  if (s.wonCo) {
    await runCase("6-finance-inbound", "expansion-matcher", s.wonCo.id, {
      companyId: s.wonCo.id,
      organizationId: org(s.wonCo),
    });
  }
  if (s.invoice) {
    await runCase("6-finance-inbound", "invoice-escalation", s.invoice.id, {
      invoiceId: s.invoice.id,
      organizationId: org(s.invoice),
    });
  }
  if (s.inbox) {
    await runCase("6-finance-inbound", "auto-reply-email", s.inbox.id, {
      activityId: s.inbox.id,
      contactId: s.inbox.contact_id,
      organizationId: org(s.inbox),
    });
    await runCase("6-finance-inbound", "compliance-privacy", s.inbox.id, {
      activityId: s.inbox.id,
      contactId: s.inbox.contact_id,
      organizationId: org(s.inbox),
      subject: s.inbox.subject || "Please delete my data",
      body:
        String(s.inbox.body || "").trim() ||
        "Please delete all my personal data and unsubscribe me from every list. GDPR request.",
      contactName: "Sample",
    });
  }

  await runCase("7-content-gateway", "hello", "probe", {
    message: "native e2e hello",
  });
  await runCase("7-content-gateway", "chat", "probe", {
    system: "You are a CRM assistant. Reply in one short sentence.",
    user: "Say the word ready if the native chat adapter is working.",
    maxTokens: 80,
    timeoutMs: 20_000,
    organizationId: ORG,
  });
  await runCase("7-content-gateway", "analyze-transcript", "sample", {
    transcript: SAMPLE_TRANSCRIPT,
    organizationId: ORG,
  });
  await runCase("7-content-gateway", "assist-meeting", "sample", {
    query: "What is the next step?",
    transcriptWindow: SAMPLE_TRANSCRIPT,
    mode: "auto",
    organizationId: ORG,
  });
  await runCase("7-content-gateway", "compose-email", "sample", {
    instruction: "Write a short follow-up thanking Priya for the workshop.",
    contactName: "Priya",
    companyName: "Infosys",
    organizationId: ORG,
  });
  await runCase("7-content-gateway", "hygiene", "sample", {
    organizationId: ORG,
    contact: { id: s.owned?.id || s.infosys?.id, displayName: "E2E" },
    candidates: [],
  });
  await runCase("7-content-gateway", "document-template", "proposal", {
    kind: "proposal",
    brief: "One-page B2B CRM proposal outline",
    organizationName: "Worktual",
    organizationId: ORG,
  });
  await runCase("7-content-gateway", "proposal-content", "sample", {
    vendorName: "Worktual",
    organizationId: ORG,
    context: { companyName: s.wonCo?.name || "Acme" },
    sections: [{ key: "overview", title: "Overview", body: "" }],
  });

  const counts = { PASS: 0, FAIL: 0, WARN: 0, INFRA: 0 };
  for (const r of results) counts[r.verdict] += 1;
  console.log("\n── summary ──");
  console.log(counts);
  for (const r of results.filter((x) => x.verdict !== "PASS")) {
    console.log(`  ${r.verdict}  ${r.set} / ${r.agent}: ${r.detail}`);
  }
  if (counts.FAIL > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
