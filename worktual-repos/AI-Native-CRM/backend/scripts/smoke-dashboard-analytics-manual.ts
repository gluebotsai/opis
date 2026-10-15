#!/usr/bin/env npx tsx
/**
 * Manual smoke checklist for dashboard-centric analytics merge.
 * Usage: npx tsx --tsconfig tsconfig.json --env-file=../.env scripts/smoke-dashboard-analytics-manual.ts
 */
import pg from "pg";
import { moduleIdsForNav } from "@/config/modules";
import {
  SESSION_COOKIE_NAME,
  signSessionUserId,
} from "@/service/account/session-crypto";

const BASE = process.env.SMOKE_API_BASE ?? "http://127.0.0.1:4000";
const WEB = process.env.SMOKE_WEB_BASE ?? "http://127.0.0.1:5173";

type Check = { name: string; ok: boolean; detail?: string };
const checks: Check[] = [];

function record(name: string, ok: boolean, detail?: string) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function mintCookieForRole(role: string): Promise<string> {
  const db = new pg.Client({
    connectionString:
      process.env.ACCOUNT_DATABASE_URL || process.env.DATABASE_URL,
  });
  await db.connect();
  const result = await db.query<{ id: string }>(
    `
    SELECT u.id::text AS id
    FROM accounts.setup_users u
    JOIN accounts.setup_user_product_access a
      ON a.user_id = u.id AND a.product_id = 'crm'
    JOIN accounts.setup_roles r ON r.id = a.role_id
    WHERE u.status = 'active'
      AND lower(r.name) = lower($1)
    ORDER BY u.id
    LIMIT 1
    `,
    [role],
  );
  await db.end();
  const id = result.rows[0]?.id;
  if (!id) throw new Error(`No active CRM user for role ${role}`);
  return `${SESSION_COOKIE_NAME}=${signSessionUserId(id)}`;
}

async function apiGet(path: string, cookie: string) {
  const res = await fetch(`${BASE}${path}`, { headers: { Cookie: cookie } });
  const body = await res.json().catch(() => null);
  return { res, body };
}

async function apiPost(path: string, cookie: string, payload: unknown = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  return { res, body };
}

async function webGet(path: string, cookie: string) {
  const res = await fetch(`${WEB}${path}`, {
    headers: { Cookie: cookie },
    redirect: "manual",
  });
  const location = res.headers.get("location");
  const text = res.status >= 300 && res.status < 400 ? "" : await res.text();
  return { res, location, text };
}

async function main() {
  console.log("\n=== Dashboard analytics smoke ===\n");

  record("RBAC: admin has no reports nav", !moduleIdsForNav("b2b", "admin").includes("reports"));
  record("RBAC: marketing has reports nav", moduleIdsForNav("b2b", "marketing").includes("reports"));
  record("RBAC: rep has no reports nav", !moduleIdsForNav("b2b", "sales_rep").includes("reports"));

  const adminCookie = await mintCookieForRole("admin");
  const repCookie = await mintCookieForRole("sales rep");
  const marketingCookie = await mintCookieForRole("marketing");

  const me = await apiGet("/api/auth/me", adminCookie);
  record("Admin session valid", me.res.ok, me.body?.data?.role ?? String(me.res.status));

  const { res: homeRes, body: homeBody } = await apiGet("/api/home", adminCookie);
  const analytics = homeBody?.data?.analytics;
  record(
    "GET /api/home includes analytics block",
    homeRes.ok && analytics && typeof analytics === "object",
    analytics ? `coaching=${analytics.myCoaching?.length ?? 0}` : String(homeRes.status),
  );
  record("Admin canSeeOrgSnapshot", Boolean(analytics?.canSeeOrgSnapshot));

  const { res: refreshRes, body: refreshBody } = await apiPost(
    "/api/home/analytics/refresh",
    adminCookie,
  );
  record(
    "POST /api/home/analytics/refresh (admin)",
    refreshRes.ok && Boolean(refreshBody?.generatedAt),
    refreshBody?.generatedAt ?? JSON.stringify(refreshBody),
  );

  const { body: repHome } = await apiGet("/api/home", repCookie);
  record(
    "Rep analytics scoped (no org snapshot)",
    repHome?.data?.analytics?.canSeeOrgSnapshot === false,
  );
  const { res: repRefreshRes, body: repRefresh } = await apiPost(
    "/api/home/analytics/refresh",
    repCookie,
  );
  record(
    "Rep cannot refresh org snapshot",
    repRefreshRes.status === 400 &&
      String(repRefresh?.message || "").includes("Only admins and managers"),
    repRefresh?.message ?? String(repRefreshRes.status),
  );

  const { body: mktHome } = await apiGet("/api/home", marketingCookie);
  record("Marketing home has analytics", Boolean(mktHome?.data?.analytics));

  console.log("\n=== Copilot analytics ===\n");
  const { res: turnRes, body: turnBody } = await apiPost(
    "/api/coworker/agent-turn",
    adminCookie,
    {
      messages: [{ role: "user", text: "What's my win rate for this month?" }],
      context: {
        module: "dashboard",
        surface: "list",
        pathname: "/dashboard",
        pageSnapshot: { metricsPeriod: "month" },
      },
      sessionMemory: { conversationId: `smoke-${Date.now()}` },
    },
  );
  const hasSpeech = Boolean(turnBody?.assistantText?.trim());
  const hasAnalytics = Boolean(turnBody?.analytics?.findings);
  record(
    "Copilot: What's my win rate?",
    turnRes.ok && turnBody?.ok !== false && (hasSpeech || hasAnalytics),
    hasAnalytics
      ? `chart=${turnBody.analytics?.chart?.type ?? "table"}`
      : clip(turnBody?.assistantText || turnBody?.error || JSON.stringify(turnBody)),
  );

  console.log("\n=== Marketing /reports redirect (SPA shell) ===\n");
  const adminReports = await webGet("/reports", adminCookie);
  record(
    "Admin /reports serves app (redirect or dashboard shell)",
    adminReports.res.status === 200 || adminReports.location === "/dashboard" || adminReports.location === "/",
    `status=${adminReports.res.status} location=${adminReports.location ?? "none"}`,
  );

  const marketingReports = await webGet("/reports", marketingCookie);
  record(
    "Marketing /reports reachable",
    marketingReports.res.status === 200,
    `status=${marketingReports.res.status}`,
  );

  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n=== Summary: ${checks.length - failed}/${checks.length} passed ===\n`);
  if (failed > 0) process.exit(1);
}

function clip(s: string, n = 100) {
  const t = String(s).replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
