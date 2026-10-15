/**
 * B2B Configuration → Proposal patterns (corpus upload + jobs).
 *
 * Run (API upload, no LLM job):
 *   npx tsx --env-file=../.env scripts/e2e-proposal-patterns-field-matrix.ts
 *
 * Optional:
 *   RUN_PROPOSAL_CORPUS_PAIR_SCORE_E2E=1  — pair-score via ai-service
 *   RUN_PROPOSAL_CORPUS_JOB_E2E=1         — enqueue job and poll batch to terminal status
 */
import pg from "pg";
import { randomBytes } from "node:crypto";
import {
  SESSION_COOKIE_NAME,
  signSessionUserId,
} from "../src/service/account/session-crypto.ts";

const API = process.env.E2E_API_BASE || "http://127.0.0.1:4000";
const RUN_PAIR_SCORE = process.env.RUN_PROPOSAL_CORPUS_PAIR_SCORE_E2E === "1";
const RUN_JOB = process.env.RUN_PROPOSAL_CORPUS_JOB_E2E === "1";
const JOB_POLL_MS = 15_000;
const JOB_MAX_WAIT_MS = Number(process.env.CORPUS_JOB_MAX_MS || 600_000);

const REQ_TEXT = `Business Requirement Document — Matrix Corp ${randomBytes(2).toString("hex")}
Need a B2B CRM with API integration for 50 sales seats and quote-to-order workflow.`;
const PROP_TEXT = `Commercial Proposal — Matrix Corp
We propose Worktual CRM with API integrations, quotes, orders, and scoped commercial terms for 50 seats.`;

const reqB64 = Buffer.from(REQ_TEXT, "utf8").toString("base64");
const propB64 = Buffer.from(PROP_TEXT, "utf8").toString("base64");

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
    signal: AbortSignal.timeout(RUN_PAIR_SCORE ? 240_000 : 120_000),
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
      JOIN accounts.setup_roles r ON r.id = a.role_id
      WHERE u.organization_id = 1000 AND lower(r.name) IN ('admin', 'sales_manager')
      LIMIT 1`);
  await db.end();
  const id = u.rows[0]?.id;
  if (!id) process.exit(1);
  cookieJar.set(SESSION_COOKIE_NAME, signSessionUserId(id));
  record("login.admin", (await http("GET", "/api/auth/me")).status === 200, `user=${id}`);
}

function payload(data: any) {
  return data?.data ?? data;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const t = randomBytes(3).toString("hex");
  console.log(
    `Proposal patterns field matrix @ ${API} (pairScore=${RUN_PAIR_SCORE} job=${RUN_JOB})\n`,
  );
  await loginAdmin();

  const list0 = await http("GET", "/api/configuration/proposal-patterns/batches");
  record(
    "api.batches.list",
    list0.status === 200 && Array.isArray(payload(list0.data)?.items),
    `items=${payload(list0.data)?.items?.length ?? "?"}`,
  );

  const playbooks = await http(
    "GET",
    "/api/configuration/proposal-patterns/playbooks",
  );
  record(
    "api.playbooks.list",
    playbooks.status === 200 && Array.isArray(payload(playbooks.data)?.items),
    `count=${payload(playbooks.data)?.items?.length ?? "?"}`,
  );

  if (RUN_PAIR_SCORE) {
    const scored = await http("POST", "/api/configuration/proposal-patterns/pair-score", {
      requirement: {
        filename: `matrix-req-${t}.txt`,
        contentBase64: reqB64,
        mime: "text/plain",
      },
      proposal: {
        filename: `matrix-prop-${t}.txt`,
        contentBase64: propB64,
        mime: "text/plain",
      },
    });
    const sc = payload(scored.data);
    record(
      "api.pair-score",
      scored.status === 200 && typeof sc?.confidence === "number",
      `confidence=${sc?.confidence} source=${sc?.source}`,
    );
  } else {
    record("api.pair-score", true, "skipped (set RUN_PROPOSAL_CORPUS_PAIR_SCORE_E2E=1)");
  }

  const created = await http("POST", "/api/configuration/proposal-patterns/batches", {
    name: `Matrix corpus ${t}`,
    startProcessing: false,
    pairs: [
      {
        pairSlot: 0,
        confidence: 0.95,
        useAnyway: true,
        requirement: {
          filename: `matrix-req-${t}.txt`,
          contentBase64: reqB64,
          mime: "text/plain",
        },
        proposal: {
          filename: `matrix-prop-${t}.txt`,
          contentBase64: propB64,
          mime: "text/plain",
        },
      },
    ],
  });
  const createPayload = payload(created.data);
  const batchId = String(createPayload?.batchId || "").trim();
  const items = createPayload?.items || [];
  record(
    "api.batch.create",
    created.status === 200 && Boolean(batchId) && items.length === 2,
    `batchId=${batchId} items=${items.length}`,
  );
  if (!batchId) {
    summarize();
    process.exit(1);
  }

  const got = await http(
    "GET",
    `/api/configuration/proposal-patterns/batches/${batchId}`,
  );
  const batch = payload(got.data)?.batch ?? payload(got.data);
  record(
    "api.batch.read",
    got.status === 200 && batch?.id === batchId,
    `status=${batch?.status} files=${batch?.items?.length ?? 0}`,
  );
  record(
    "api.batch.read.pair-files",
    batch?.items?.some((i: any) => i.kind === "requirement") &&
      batch?.items?.some((i: any) => i.kind === "proposal"),
    "requirement+proposal",
  );

  const startJob = await http(
    "POST",
    `/api/configuration/proposal-patterns/batches/${batchId}/process`,
  );
  const jobId = payload(startJob.data)?.jobId;
  record(
    "api.batch.process",
    startJob.status === 200 && Boolean(jobId),
    `jobId=${jobId ?? startJob.raw.slice(0, 80)}`,
  );

  if (RUN_JOB && jobId) {
    const terminal = new Set(["completed", "failed", "cancelled"]);
    const started = Date.now();
    let lastStatus = batch?.status;
    while (Date.now() - started < JOB_MAX_WAIT_MS) {
      await sleep(JOB_POLL_MS);
      const poll = await http(
        "GET",
        `/api/configuration/proposal-patterns/batches/${batchId}`,
      );
      const row = payload(poll.data)?.batch ?? payload(poll.data);
      lastStatus = row?.status;
      const jobStatus = row?.job?.status;
      if (lastStatus && terminal.has(String(lastStatus))) break;
      if (jobStatus && terminal.has(String(jobStatus))) break;
    }
    record(
      "api.batch.job.terminal",
      terminal.has(String(lastStatus)),
      `batchStatus=${lastStatus} waitedMs=${Date.now() - started}`,
    );
  } else {
    record(
      "api.batch.job.terminal",
      true,
      RUN_JOB ? "no jobId" : "skipped (RUN_PROPOSAL_CORPUS_JOB_E2E=1)",
    );
  }

  const del = await http(
    "DELETE",
    `/api/configuration/proposal-patterns/batches/${batchId}`,
  );
  record("api.batch.delete", del.status === 200, del.raw.slice(0, 80));

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
