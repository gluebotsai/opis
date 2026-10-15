#!/usr/bin/env node
/**
 * Capture admin portal pages as UI-skill reference screenshots.
 *
 * Usage (from apps/web, with Vite running):
 *   npm run capture:ui-references
 *
 * Env:
 *   BASE_URL / PLAYWRIGHT_BASE_URL   default http://localhost:5173
 *   SCREENSHOT_EMAIL                 default cc-admin@worktual.local
 *   SCREENSHOT_PASSWORD              default Worktual@123
 *   CAPTURE_HEADED=1                 show the browser
 *   CAPTURE_FULL_PAGE=1              full-page shots instead of viewport
 */

import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const WEB_ROOT = path.resolve(REPO_ROOT, "apps/web");
const OUT_DIR = path.resolve(__dirname, "../references");

const require = createRequire(path.join(WEB_ROOT, "package.json"));
const { chromium } = require("playwright");

const BASE_URL = (process.env.BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173").replace(
  /\/$/,
  "",
);
const EMAIL =
  process.env.SCREENSHOT_EMAIL ?? process.env.E2E_ADMIN_EMAIL ?? "cc-admin@worktual.local";
const PASSWORD = process.env.SCREENSHOT_PASSWORD ?? "Worktual@123";
const EMAIL_FALLBACKS = process.env.SCREENSHOT_EMAIL
  ? [EMAIL]
  : [EMAIL, "admin.test@worktual.local"].filter((value, index, all) => all.indexOf(value) === index);
const HEADED = process.env.CAPTURE_HEADED === "1";
const FULL_PAGE = process.env.CAPTURE_FULL_PAGE === "1";
const VIEWPORT = { width: 1440, height: 900 };

const ADMIN_PAGES = [
  { name: "dashboard-reports", path: "/admin/dashboard", ready: "Reports" },
  { name: "dashboard-analytics", path: "/admin/dashboard/analytics", ready: "Analytics" },
  { name: "contacts", path: "/admin/contacts", ready: /contacts/i },
  { name: "queues", path: "/admin/workforce/queues", ready: /queue/i },
  { name: "agents", path: "/admin/workforce/agents", ready: /agent/i },
  { name: "presence", path: "/admin/workforce/presence", ready: /presence/i },
  { name: "shifts", path: "/admin/workforce/shifts", ready: /shift/i },
  { name: "workspace", path: "/admin/workspace", ready: /inbox|workspace/i },
  { name: "monitoring", path: "/admin/monitoring", ready: /monitor/i },
  { name: "team-chat", path: "/admin/team-chat", ready: /chat|message/i },
];

async function settle(page, ms = 700) {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

async function hideCaptureNoise(page) {
  await page.addStyleTag({
    content: `
      [class*="locatorjs"],
      [id*="locatorjs"],
      [data-locatorjs],
      .ant-tooltip,
      .ant-message {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
    `,
  });
}

async function screenshot(page, filename) {
  await hideCaptureNoise(page);
  const file = path.join(OUT_DIR, filename);
  await page.screenshot({
    path: file,
    fullPage: FULL_PAGE,
    animations: "disabled",
  });
  console.log(`  ✓ ${filename}`);
}

async function waitForReady(page, ready) {
  if (!ready) return;
  const locator =
    typeof ready === "string"
      ? page.getByText(ready, { exact: false }).first()
      : page.getByText(ready).first();
  await locator.waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
}

async function ensureLoginForm(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  await settle(page, 400);

  const continueBtn = page.getByRole("button", { name: /continue to app/i });
  if (await continueBtn.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: /sign out/i }).click();
    await settle(page, 400);
  }

  await page.locator("#email").waitFor({ state: "visible", timeout: 15_000 });
}

async function waitUntilLeftLogin(page) {
  await page.waitForURL((url) => !url.pathname.includes("/login"), {
    timeout: 25_000,
    waitUntil: "commit",
  });
}

async function loginWithAccount(page, email) {
  await ensureLoginForm(page);

  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);

  const submit = page.getByRole("button", { name: /sign in|replace session/i });
  await submit.click();

  const replaceBtn = page.getByRole("button", { name: /replace session/i });
  const alert = page.getByRole("alert");

  const outcome = await Promise.race([
    waitUntilLeftLogin(page).then(() => "ok"),
    replaceBtn.waitFor({ state: "visible", timeout: 25_000 }).then(() => "conflict"),
    alert.waitFor({ state: "visible", timeout: 25_000 }).then(() => "alert"),
  ]).catch(() => "timeout");

  if (outcome === "conflict" || (outcome === "alert" && (await replaceBtn.isVisible().catch(() => false)))) {
    await replaceBtn.click();
    await waitUntilLeftLogin(page);
  } else if (outcome === "alert") {
    const text = (await alert.innerText().catch(() => "")).trim();
    throw new Error(text ? `Login rejected: ${text}` : "Login rejected");
  } else if (outcome === "timeout") {
    throw new Error("Login timed out on /login");
  }

  await settle(page);
}

async function login(page) {
  let lastError = new Error("Login failed");
  for (const email of EMAIL_FALLBACKS) {
    try {
      console.log(`  trying ${email}`);
      await loginWithAccount(page, email);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(`  ${email}: ${lastError.message}`);
    }
  }
  throw lastError;
}

async function capturePage(page, { name, path: routePath, ready }) {
  await page.goto(`${BASE_URL}${routePath}`, { waitUntil: "domcontentloaded" });
  await waitForReady(page, ready);
  await settle(page);

  if (name === "dashboard-reports") {
    const thirty = page.getByRole("button", { name: "30D" });
    if (await thirty.isVisible().catch(() => false)) {
      await thirty.click();
      await settle(page, 900);
    }
  }

  await screenshot(page, `${name}.png`);

  if (name === "dashboard-reports") {
    const kpis = page.locator("[data-export-kpis]").first();
    if (await kpis.isVisible().catch(() => false)) {
      await kpis.screenshot({
        path: path.join(OUT_DIR, "reports-kpis.png"),
        animations: "disabled",
      });
      console.log("  ✓ reports-kpis.png");
    }
    const breakdowns = page.locator("[data-export-breakdowns]").first();
    if (await breakdowns.isVisible().catch(() => false)) {
      await breakdowns.screenshot({
        path: path.join(OUT_DIR, "reports-breakdowns.png"),
        animations: "disabled",
      });
      console.log("  ✓ reports-breakdowns.png");
    }
  }
}

async function assertServerUp() {
  try {
    const response = await fetch(`${BASE_URL}/login`, { redirect: "manual" });
    if (!response.ok && response.status >= 500) {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Vite is not reachable at ${BASE_URL} (${detail}). Start \`npm run dev -w web\` first.`);
  }
}

async function main() {
  await assertServerUp();
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: !HEADED });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  console.log(`Capturing admin portal → ${OUT_DIR}`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Account:  ${EMAIL}`);

  console.log("Screen: login");
  await ensureLoginForm(page);
  await screenshot(page, "login.png");

  console.log("Logging in…");
  try {
    await login(page);
  } catch (error) {
    await screenshot(page, "login-failed.png").catch(() => {});
    console.error("Login failed. Set SCREENSHOT_EMAIL / SCREENSHOT_PASSWORD, or replace the other session.");
    console.error(error instanceof Error ? error.message : error);
    await browser.close();
    process.exit(1);
  }

  for (const screen of ADMIN_PAGES) {
    console.log(`Screen: ${screen.name}`);
    try {
      await capturePage(page, screen);
    } catch (error) {
      console.warn(`  ⚠ skipped ${screen.name}:`, error instanceof Error ? error.message : error);
    }
  }

  await browser.close();
  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
