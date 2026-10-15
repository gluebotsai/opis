/**
 * B2B finance contracts read surface (API).
 *
 * Run:
 *   npx tsx --env-file=../.env scripts/e2e-finance-contracts-field-matrix.ts
 */
import pg from "pg";
import {
  SESSION_COOKIE_NAME,
  signSessionUserId,
} from "../src/service/account/session-crypto.ts";

const API = process.env.E2E_API_BASE || "http://127.0.0.1:4000";

const cookieJar = new Map<string, string>();
const results: Array<{ name: string; ok: boolean; detail: string }> = [];

function record(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function http(method: string, path: string) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      cookie: [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
    },
    signal: AbortSignal.timeout(90_000),
  });
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
  const db = new pg.Client({
    connectionString:
      process.env.ACCOUNT_DATABASE_URL || process.env.DATABASE_URL,
  });
  await db.connect();
  const u = await db.query(`
      SELECT u.id::text AS id FROM accounts.setup_users u
      JOIN accounts.setup_user_product_access a ON a.user_id = u.id AND a.product_id = 'crm'
      JOIN accounts.setup_roles r ON r.id = a.role_id
      WHERE u.organization_id = 1000 AND lower(r.name) IN ('admin', 'sales_manager', 'finance')
      LIMIT 1`);
  await db.end();
  cookieJar.set(SESSION_COOKIE_NAME, signSessionUserId(u.rows[0]?.id));
  record("login.b2b", (await http("GET", "/api/auth/me")).status === 200, `user=${u.rows[0]?.id}`);
}

async function main() {
  console.log(`Finance contracts field matrix (B2B) @ ${API}\n`);
  await loginAdmin();

  const atRisk = await http("GET", "/api/finance/contracts/at-risk");
  const items =
    atRisk.data?.items ||
    atRisk.data?.contracts ||
    atRisk.data?.data?.items ||
    [];
  record(
    "api.contracts.at-risk",
    atRisk.status === 200 && Array.isArray(items),
    `count=${Array.isArray(items) ? items.length : atRisk.raw.slice(0, 80)}`,
  );

  if (Array.isArray(items) && items[0]?.id) {
    const prev = await http(
      "GET",
      `/api/finance/contracts/${items[0].id}/proration-preview`,
    );
    record(
      "api.contract.proration-preview",
      prev.status === 200,
      prev.raw.slice(0, 100),
    );
  } else {
    record(
      "api.contract.proration-preview",
      true,
      "skipped (no contracts in org)",
    );
  }

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
