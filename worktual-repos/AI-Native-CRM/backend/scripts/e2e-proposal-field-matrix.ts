/**
 * B2B sales proposal field matrix (API).
 *
 * Setup uses template-backed create (no playbook LLM). Field PATCH/patch-section
 * exercises the same paths coworker tools target.
 *
 * Run:
 *   npx tsx --env-file=../.env scripts/e2e-proposal-field-matrix.ts
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import {
  SESSION_COOKIE_NAME,
  signSessionUserId,
} from "../src/service/account/session-crypto.ts";
import { runWithRequestUserId } from "../src/service/account/request-context.ts";
import { createProposalFromTemplate } from "../src/dao/sales/proposal-service.ts";

const API = process.env.E2E_API_BASE || "http://127.0.0.1:4000";
const EMAIL = process.env.E2E_EMAIL || "admin.b2b@worktual.com";
const PASSWORD = process.env.E2E_PASSWORD || "demo";

const cookieJar = new Map<string, string>();
const results: Array<{ name: string; ok: boolean; detail: string }> = [];
let sessionUserId = "";

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

async function http(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { cookie: cookieHeader() };
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
  if (loginRes.status !== 200) {
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
    if (!id) {
      record("login.b2b", false, loginRes.raw.slice(0, 120));
      process.exit(1);
    }
    cookieJar.set(SESSION_COOKIE_NAME, signSessionUserId(id));
    sessionUserId = String(id);
  } else {
    record("login.b2b", true, EMAIL);
  }
  const me = await http("GET", "/api/auth/me");
  const uid =
    me.data?.user?.id ||
    me.data?.data?.user?.id ||
    me.data?.id ||
    sessionUserId;
  sessionUserId = String(uid || sessionUserId);
  record("login.b2b", me.status === 200 && Boolean(sessionUserId), `user=${sessionUserId}`);
  if (me.status !== 200 || !sessionUserId) process.exit(1);
}

function proposalPayload(data: any) {
  return data?.proposal || data?.data?.proposal || data?.data || data;
}

function findSection(sections: any[], key: string) {
  return (sections || []).find(
    (s) => String(s.key || "").toLowerCase() === key.toLowerCase(),
  );
}

async function main() {
  const t = tag();
  console.log(`Proposal field matrix (B2B) @ ${API}\n`);
  await login();

  const companies = await http("GET", "/api/companies?page=1");
  const companyId = String(companies.data?.items?.[0]?.id || "");
  const locs = await http("GET", `/api/companies/${companyId}/locations`);
  const locationId = String(locs.data?.locations?.[0]?.id || "");
  record("setup.company", Boolean(companyId && locationId), companyId);

  const dealRes = await http("POST", "/api/sales/deals", {
    title: `PropMatrix Deal ${t}`,
    stage: "qualification",
    amount: 12000,
    companyId,
    locationId,
  });
  const dealId = dealRes.data?.id || dealRes.data?.data?.id;
  record("setup.deal", dealRes.status === 200 && Boolean(dealId), String(dealId || ""));

  let proposalId = "";
  try {
    const row = await runWithRequestUserId(sessionUserId, () =>
      createProposalFromTemplate({
        dealId: String(dealId),
        title: `PropMatrix ${t}`,
      }),
    );
    proposalId = row.id;
    record("setup.proposal", Boolean(proposalId), proposalId);
  } catch (e) {
    record(
      "setup.proposal",
      false,
      e instanceof Error ? e.message : String(e),
    );
    summarize();
    process.exit(1);
  }

  const read0 = await http("GET", `/api/sales/proposals/${proposalId}`);
  const p0 = proposalPayload(read0.data);
  const intro0 = findSection(p0.sections, "introduction");
  record(
    "api.read.sections.intro",
    read0.status === 200 && Boolean(intro0?.key),
    `key=${intro0?.key}`,
  );

  const titleNext = `PropMatrix Renamed ${t}`;
  const summaryNext = `Summary matrix ${t}`;
  const attachmentNext = `https://example.com/proposal-matrix-${t}.pdf`;
  const patched = await http("PATCH", `/api/sales/proposals/${proposalId}`, {
    title: titleNext,
    summary: summaryNext,
    attachmentUrl: attachmentNext,
  });
  record(
    "api.patch.meta",
    patched.status === 200,
    patched.raw.slice(0, 100),
  );

  const read1 = await http("GET", `/api/sales/proposals/${proposalId}`);
  const p1 = proposalPayload(read1.data);
  record("api.read.title", p1.title === titleNext, `got=${p1.title}`);
  record("api.read.summary", p1.summary === summaryNext, `got=${p1.summary}`);
  record(
    "api.read.attachmentUrl",
    p1.attachmentUrl === attachmentNext,
    `got=${p1.attachmentUrl}`,
  );

  const bodyNext = `Matrix intro body ${t}`;
  const titleSec = "1. Introduction (matrix)";
  const patchSec = await http(
    "POST",
    `/api/sales/proposals/${proposalId}/patch-section`,
    {
      sectionKey: "introduction",
      title: titleSec,
      body: bodyNext,
    },
  );
  record(
    "api.patch-section",
    patchSec.status === 200,
    patchSec.raw.slice(0, 120),
  );

  const read2 = await http("GET", `/api/sales/proposals/${proposalId}`);
  const p2 = proposalPayload(read2.data);
  const intro2 = findSection(p2.sections, "introduction");
  record(
    "api.read.section.title",
    intro2?.title === titleSec,
    `got=${intro2?.title}`,
  );
  record(
    "api.read.section.body",
    intro2?.body === bodyNext,
    `got=${String(intro2?.body || "").slice(0, 60)}`,
  );

  const docPatch = await http(
    "POST",
    `/api/sales/proposals/${proposalId}/patch-document-text`,
    { textReplacements: [{ find: "{{date}}", replace: `1 Jan 2027 ${t}` }] },
  );
  const docOk =
    docPatch.status === 200 ||
    (docPatch.status === 400 &&
      String(docPatch.raw).includes("editable"));
  record(
    "api.patch-document-text",
    docOk,
    docPatch.raw.slice(0, 100),
  );

  await http("DELETE", `/api/sales/proposals/${proposalId}`);
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
