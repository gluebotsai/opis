#!/usr/bin/env node
/**
 * Capture Contact Center reference UI screenshots into docs/brand/reference-ui/
 *
 * Usage:
 *   BASE_URL=http://localhost:5173 \
 *   SCREENSHOT_EMAIL=admin@example.com \
 *   SCREENSHOT_PASSWORD=secret \
 *   node docs/brand/scripts/capture-screenshots.mjs
 */

import { mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../reference-ui");
const BASE_URL = process.env.BASE_URL ?? "http://localhost:5173";
const EMAIL = process.env.SCREENSHOT_EMAIL ?? "cc-admin@worktual.local";
const PASSWORD = process.env.SCREENSHOT_PASSWORD ?? "Worktual@123";
const VIEWPORT = { width: 1440, height: 900 };
const SIDEBAR_COLLAPSED_KEY = "cc2-sidebar-collapsed";

/** @type {{ path: string; name: string; expandRight?: boolean }[]} */
const SCREENS = [
  { path: "/login", name: "login" },
  { path: "/admin/dashboard", name: "dashboard", expandRight: true },
  { path: "/admin/workforce/queues", name: "queues", expandRight: true },
  { path: "/admin/workspace", name: "workspace" },
  { path: "/admin/reports", name: "reports", expandRight: true },
];

function filenamesForScreen(screen) {
  const names = [`${screen.name}.png`, `${screen.name}-sidebar-hidden.png`];
  if (screen.expandRight) {
    names.push(`${screen.name}-right-expanded.png`);
    names.push(`${screen.name}-sidebar-hidden-right-expanded.png`);
  }
  return names;
}

const KEEP_FILES = new Set([
  "README.md",
  ...SCREENS.flatMap((screen) => filenamesForScreen(screen)),
]);

async function waitForApp(page) {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(800);
}

async function setSidebarCollapsed(page, collapsed) {
  await page.evaluate(
    ([key, value]) => {
      localStorage.setItem(key, value);
    },
    [SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0"],
  );
}

async function login(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 20_000 });
  await waitForApp(page);
}

async function expandRightPanel(page) {
  const expandButtons = page.getByRole("button", { name: "Expand panel" });
  const count = await expandButtons.count();
  if (count === 0) return false;
  await expandButtons.nth(count - 1).click();
  await page.waitForTimeout(500);
  return true;
}

async function screenshot(page, filename) {
  const file = path.join(OUT_DIR, filename);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  ✓ ${filename}`);
}

async function captureScreen(page, routePath, name, { sidebarHidden = false, rightExpanded = false } = {}) {
  await setSidebarCollapsed(page, sidebarHidden);
  await page.goto(`${BASE_URL}${routePath}`, { waitUntil: "domcontentloaded" });
  await waitForApp(page);

  if (rightExpanded) {
    const expanded = await expandRightPanel(page);
    if (!expanded) {
      console.warn(`  ⚠ No expand control on ${name}; skipping right-expanded`);
      return;
    }
  }

  const suffix = [
    sidebarHidden ? "sidebar-hidden" : null,
    rightExpanded ? "right-expanded" : null,
  ]
    .filter(Boolean)
    .join("-");

  const filename = suffix ? `${name}-${suffix}.png` : `${name}.png`;
  await screenshot(page, filename);
}

async function captureScreenVariants(page, screen) {
  await captureScreen(page, screen.path, screen.name);

  if (screen.expandRight) {
    await captureScreen(page, screen.path, screen.name, { rightExpanded: true });
  }

  await captureScreen(page, screen.path, screen.name, { sidebarHidden: true });

  if (screen.expandRight) {
    await captureScreen(page, screen.path, screen.name, {
      sidebarHidden: true,
      rightExpanded: true,
    });
  }
}

async function removeStaleImages() {
  const entries = await readdir(OUT_DIR);
  for (const entry of entries) {
    if (entry.endsWith(".png") && !KEEP_FILES.has(entry)) {
      await unlink(path.join(OUT_DIR, entry));
      console.log(`  ✗ removed ${entry}`);
    }
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  console.log(`Capturing to ${OUT_DIR}`);
  console.log(`Base URL: ${BASE_URL}`);

  console.log("Public: login");
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await screenshot(page, "login.png");

  console.log("Logging in…");
  try {
    await login(page);
  } catch (error) {
    console.error(
      "Login failed. Set SCREENSHOT_EMAIL and SCREENSHOT_PASSWORD env vars.",
      error,
    );
    await browser.close();
    process.exit(1);
  }

  for (const screen of SCREENS.filter((item) => item.path !== "/login")) {
    console.log(`Screen: ${screen.name}`);
    await captureScreenVariants(page, screen);
  }

  await browser.close();

  console.log("Removing stale images…");
  await removeStaleImages();
  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
