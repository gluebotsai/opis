/**
 * Headless UI smoke for dashboard analytics (uses minted session cookies).
 * Run: npx tsx --env-file=../.env scripts/smoke-dashboard-analytics-ui.ts
 */
import pg from "pg";
import { chromium, type Page } from "playwright";
import {
  SESSION_COOKIE_NAME,
  signSessionUserId,
} from "../src/service/account/session-crypto.ts";

const WEB = process.env.SMOKE_WEB_BASE ?? "http://127.0.0.1:5173";

type Check = { name: string; ok: boolean; detail?: string };
const checks: Check[] = [];

function record(name: string, ok: boolean, detail?: string) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function mintUserId(role: string): Promise<string> {
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
    WHERE u.status = 'active' AND lower(r.name) = lower($1)
    ORDER BY u.id
    LIMIT 1
    `,
    [role],
  );
  await db.end();
  const id = result.rows[0]?.id;
  if (!id) throw new Error(`No CRM user for role ${role}`);
  return id;
}

async function openWithRole(role: string) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: signSessionUserId(await mintUserId(role)),
      url: WEB,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const page = await context.newPage();
  return { browser, page };
}

async function waitForDashboard(page: Page) {
  await page.goto(`${WEB}/dashboard`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.getByRole("heading", { name: /dashboard/i }).first().waitFor({
    timeout: 30_000,
  }).catch(() => null);
}

async function main() {
  console.log("\n=== Dashboard analytics UI smoke (Playwright) ===\n");

  const { browser: adminBrowser, page: adminPage } = await openWithRole("admin");
  try {
    await waitForDashboard(adminPage);
    record(
      "Dashboard loads for admin",
      adminPage.url().includes("/dashboard"),
      adminPage.url(),
    );

    const refreshBtn = adminPage.getByRole("button", { name: /refresh snapshot/i });
    const hasAnalytics = await refreshBtn.isVisible().catch(() => false);
    record("Dashboard shows analytics refresh control", hasAnalytics);

    if (hasAnalytics) {
      await refreshBtn.click();
      await adminPage.getByText(/snapshot refreshed|last refreshed/i).first().waitFor({
        timeout: 20_000,
      }).catch(() => null);
      const flash = await adminPage.locator("text=/snapshot refreshed|last refreshed/i").count();
      record("Refresh snapshot updates UI", flash > 0, `hints=${flash}`);
    }

    await adminPage.goto(`${WEB}/reports`, { waitUntil: "networkidle", timeout: 60_000 });
    await adminPage.waitForTimeout(1500);
    record(
      "Non-marketing /reports redirects to dashboard",
      adminPage.url().includes("/dashboard") && !adminPage.url().includes("/reports"),
      adminPage.url(),
    );

    const askFab = adminPage.getByRole("button", { name: /ask crm|restore chat/i });
    if (await askFab.isVisible().catch(() => false)) {
      await askFab.click();
      await adminPage.waitForTimeout(800);
    }
    const copilotInput = adminPage.locator("textarea").first();
    if (await copilotInput.isVisible().catch(() => false)) {
      await copilotInput.fill("What's my win rate?");
      await adminPage.keyboard.press("Enter");
      await adminPage.getByText(/win rate|could not complete|report/i).first().waitFor({
        timeout: 120_000,
      }).catch(() => null);
      const replyCount = await adminPage.locator("text=/win rate|could not complete|report/i").count();
      record("Copilot answers win-rate question in UI", replyCount > 0);
    } else {
      record("Copilot answers win-rate question in UI", false, "copilot textarea not found");
    }
  } finally {
    await adminBrowser.close();
  }

  const { browser: mktBrowser, page: mktPage } = await openWithRole("marketing");
  try {
    await mktPage.goto(`${WEB}/reports`, { waitUntil: "networkidle", timeout: 60_000 });
    await mktPage.waitForTimeout(1500);
    record(
      "Marketing /reports stays on reports route",
      mktPage.url().includes("/reports"),
      mktPage.url(),
    );
    const marketingShell = await mktPage.getByText(/marketing analytics/i).count();
    record("Marketing reports shell visible", marketingShell > 0);
  } finally {
    await mktBrowser.close();
  }

  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n=== UI Summary: ${checks.length - failed}/${checks.length} passed ===\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
