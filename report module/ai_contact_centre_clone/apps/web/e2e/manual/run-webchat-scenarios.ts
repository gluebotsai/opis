/**
 * Manual webchat scenario runner — ngrok customer widget + local agent workspace.
 * Run: npx tsx apps/web/e2e/manual/run-webchat-scenarios.ts
 */
import { execSync } from "node:child_process";
import { chromium, type Browser, type Page } from "@playwright/test";

const WEBCHAT_URL =
  process.env.WEBCHAT_TEST_URL ??
  "https://nineteen-chute-percolate.ngrok-free.dev/webchat/test/wc_5d80cd9b1ace4080bc70717552472611";
const AGENT_BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";
const AGENT_EMAIL = process.env.PLAYWRIGHT_AGENT_EMAIL ?? "agent.test@worktual.local";
const AGENT_PASSWORD = process.env.PLAYWRIGHT_AGENT_PASSWORD ?? "Worktual@123";

type ScenarioResult = { name: string; pass: boolean; detail: string };

const results: ScenarioResult[] = [];

function log(msg: string) {
  console.log(msg);
}

async function loginAgent(page: Page) {
  await page.goto(`${AGENT_BASE}/login`);
  await page.locator("#email").fill(AGENT_EMAIL);
  await page.locator("#password").fill(AGENT_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30_000 });
}

async function openAgentWorkspace(page: Page) {
  await page.goto(`${AGENT_BASE}/agent/workspace`);
  await page.getByRole("heading", { name: "Inbox" }).waitFor({ state: "visible", timeout: 30_000 });
}

async function setPresence(page: Page, label: "Ready" | "Away" | "Busy" | "Not Ready") {
  const btn = page.getByRole("button", { name: /Ready|Away|Busy|Not Ready/i }).first();
  await btn.click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
  await page.waitForTimeout(1500);
}

async function createCustomerContext(browser: Browser) {
  return browser.newContext({
    extraHTTPHeaders: { "ngrok-skip-browser-warning": "1" },
    viewport: { width: 480, height: 820 },
  });
}

async function openCustomerChat(page: Page) {
  await page.goto(WEBCHAT_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(3000);

  const visit = page.getByRole("button", { name: /Visit Site/i });
  if (await visit.isVisible().catch(() => false)) await visit.click();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const openChat = page.getByRole("button", { name: /Open chat/i });
    if (await openChat.isVisible().catch(() => false)) {
      await openChat.click();
      await page.waitForTimeout(800);
    }

    const agree = page.getByRole("button", { name: /Yes, I agree/i });
    if (await agree.isVisible().catch(() => false)) {
      await agree.click();
      await page.waitForTimeout(1200);
    }

    const input = page.getByRole("textbox", { name: /Type your message/i });
    if (await input.isVisible().catch(() => false)) return input;
    await page.waitForTimeout(1000);
  }

  throw new Error("Webchat input never became visible after consent flow");
}

async function customerSend(page: Page, text: string) {
  const input = page.getByRole("textbox", { name: /Type your message/i });
  await input.fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForTimeout(500);
}

async function waitForCustomerText(page: Page, pattern: RegExp, timeoutMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const body = await page.locator("body").innerText();
    if (pattern.test(body)) return body.match(pattern)?.[0] ?? "matched";
    await page.waitForTimeout(1000);
  }
  throw new Error(`Timed out waiting for customer text: ${pattern}`);
}

async function waitForOffer(page: Page, timeoutMs = 90_000) {
  const accept = page.getByRole("button", { name: "Accept", exact: true });
  await accept.first().waitFor({ state: "visible", timeout: timeoutMs });
}

async function runScenario(
  browser: Browser,
  name: string,
  fn: (ctx: { agentPage: Page; customerPage: Page }) => Promise<void>,
) {
  const agentCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const customerCtx = await createCustomerContext(browser);
  const agentPage = await agentCtx.newPage();
  const customerPage = await customerCtx.newPage();
  try {
    await fn({ agentPage, customerPage });
    results.push({ name, pass: true, detail: "OK" });
    log(`PASS  ${name}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    results.push({ name, pass: false, detail });
    log(`FAIL  ${name}: ${detail}`);
  } finally {
    await customerCtx.close();
    await agentCtx.close();
  }
}

async function main() {
  log("Resetting stale webchat conversations and agent capacity...");
  execSync("npx tsx apps/cc-core/scripts/cleanup-worktual1-webchat.ts --live", {
    cwd: process.cwd(),
    stdio: "inherit",
  });

  const browser = await chromium.launch({ headless: true });

  // Verify agent login first
  const probe = await browser.newContext();
  const probePage = await probe.newPage();
  try {
    await loginAgent(probePage);
    log(`Agent login OK (${AGENT_EMAIL})`);
  } catch (error) {
    log(`Agent login FAILED: ${error instanceof Error ? error.message : error}`);
    await probe.close();
    await browser.close();
    process.exitCode = 1;
    return;
  }
  await probe.close();

  await runScenario(browser, "2. Handoff + agent Accept + agent reply", async ({ agentPage, customerPage }) => {
    await loginAgent(agentPage);
    await openAgentWorkspace(agentPage);
    await setPresence(agentPage, "Ready");

    await openCustomerChat(customerPage);
    await customerSend(customerPage, "Hello, I need help with my order.");
    await waitForCustomerText(customerPage, /assist|help|hello|order|hour|business/i, 90_000);
    await customerSend(customerPage, "Please connect me to a live agent");
    await waitForCustomerText(customerPage, /agent|connect|hold|queue|support|wait/i, 90_000);

    await waitForOffer(agentPage, 90_000);
    await agentPage.getByRole("button", { name: "Accept", exact: true }).first().click();
    await agentPage.getByPlaceholder(/Reply to/i).waitFor({ state: "visible", timeout: 30_000 });

    const reply = "Thanks — an agent is here to help you now.";
    await agentPage.getByPlaceholder(/Reply to/i).fill(reply);
    await agentPage.getByRole("button", { name: "Send message" }).click();
    await waitForCustomerText(customerPage, new RegExp(reply.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), 120_000);
  });

  await runScenario(browser, "1. Bot replies to customer message", async ({ customerPage }) => {
    await openCustomerChat(customerPage);
    await customerSend(customerPage, "Hello, what are your business hours?");
    const reply = await waitForCustomerText(customerPage, /hour|open|monday|assist|help|support/i);
    if (!reply) throw new Error("No bot reply detected");
  });

  await runScenario(browser, "3. Agent Decline offer", async ({ agentPage, customerPage }) => {
    await loginAgent(agentPage);
    await openAgentWorkspace(agentPage);
    await setPresence(agentPage, "Ready");
    await agentPage.waitForTimeout(2000);

    await openCustomerChat(customerPage);
    await customerSend(customerPage, "I need a live agent please");
    await waitForCustomerText(customerPage, /agent|connect|hold|queue/i, 90_000);

    await waitForOffer(agentPage, 90_000);
    const decline = agentPage.getByRole("button", { name: "Reject", exact: true });
    if (await decline.isVisible().catch(() => false)) {
      await decline.click();
    } else {
      await agentPage.getByRole("button", { name: "Reject", exact: true }).click();
    }
    await pageWaitUntilHidden(agentPage, "Accept", 15_000);

    const stillQueued = await waitForCustomerText(customerPage, /queue|wait|agent|connect|hold/i, 30_000);
    if (!stillQueued) throw new Error("Customer should remain in queue/waiting after decline");
  });

  await runScenario(browser, "4. No available agents (agent Away)", async ({ agentPage, customerPage }) => {
    await loginAgent(agentPage);
    await openAgentWorkspace(agentPage);
    await setPresence(agentPage, "Away");

    await openCustomerChat(customerPage);
    await customerSend(customerPage, "Connect me to a live agent now");
    const body = await waitForCustomerText(
      customerPage,
      /queue|wait|agent|connect|hold|unavailable|offline|busy/i,
      90_000,
    );
    if (!body) throw new Error("Expected queue/waiting message when no agents available");
  });

  await browser.close();

  log("\n=== Summary ===");
  for (const r of results) {
    log(`${r.pass ? "✓" : "✗"} ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
  }
  const failed = results.filter((r) => !r.pass).length;
  if (failed) process.exitCode = 1;
}

async function pageWaitUntilHidden(page: Page, buttonName: string, timeoutMs: number) {
  const btn = page.getByRole("button", { name: buttonName, exact: true }).first();
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!(await btn.isVisible().catch(() => false))) return;
    await page.waitForTimeout(500);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
