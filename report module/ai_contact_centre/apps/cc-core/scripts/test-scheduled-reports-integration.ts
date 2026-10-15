/**
 * Smoke test for scheduled reports API (requires running cc-core + auth headers).
 *
 * Usage:
 *   CC_CORE_URL=http://localhost:3000 \
 *   TENANT_ID=... USER_ID=... \
 *   npx tsx apps/cc-core/scripts/test-scheduled-reports-integration.ts
 */

const CC_CORE_URL = process.env.CC_CORE_URL ?? "http://localhost:3000";
const TENANT_ID = process.env.TENANT_ID;
const USER_ID = process.env.USER_ID;
const API_BASE = process.env.API_V1_PUBLIC_BASE ?? "/cc-core-api/v1";

if (!TENANT_ID || !USER_ID) {
  console.error("Set TENANT_ID and USER_ID for admin context.");
  process.exit(1);
}

const headers = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "x-tenant-id": TENANT_ID,
  "x-user-id": USER_ID,
  "x-user-role": "admin",
};

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${CC_CORE_URL}${API_BASE}${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} failed: ${JSON.stringify(body)}`);
  }
  return body;
}

async function main() {
  const mailbox = await request("/reports/mailbox-status");
  console.log("mailbox-status", mailbox);

  const created = await request("/reports/schedules", {
    method: "POST",
    body: JSON.stringify({
      name: "Integration test schedule",
      schedule: "daily",
      period: "yesterday",
      sendAt: "09:00",
      timeZone: "Asia/Kolkata",
      enabled: true,
      formats: { pdf: true, csv: false },
      includedSections: { dashboardKpis: true, agentTable: true, aiSummary: true },
    }),
  });
  const scheduleId = created.schedule.id as string;
  console.log("created schedule", scheduleId);

  const run = await request(`/reports/schedules/${scheduleId}/run-now`, { method: "POST" });
  console.log("run-now", run.status, run.errorCode ?? "ok");

  await request(`/reports/schedules/${scheduleId}`, { method: "DELETE" });
  console.log("cleanup complete");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
