import { expect, test, type Page } from "@playwright/test";

import { loginAsAgent, openAgentWorkspace } from "./helpers/auth";
import { assertLatency, measure, printLatencyReport, type LatencyMetric } from "./helpers/metrics";

const LATENCY_BUDGET_MS: Record<string, number> = {
  "login → workspace": 8_000,
  "inbox initial load": 6_000,
  "switch inbox tab": 2_000,
  "select conversation": 5_000,
  "messages visible": 8_000,
  "customer panel tab switch": 1_500,
  "presence menu open": 1_000,
  "search filter": 1_500,
};

async function waitForInboxReady(page: Page) {
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  await page
    .getByText("Loading conversations…")
    .waitFor({ state: "hidden", timeout: 15_000 })
    .catch(() => undefined);
}

async function clickInboxTab(page: Page, label: RegExp) {
  await page.getByRole("button", { name: label }).click();
}

async function firstConversationButton(page: Page) {
  const inboxList = page.locator('ul.space-y-1 button[type="button"]');
  await expect(inboxList.first()).toBeVisible({ timeout: 10_000 });
  return inboxList.first();
}

test.describe("Agent Workspace E2E", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAgent(page);
    await openAgentWorkspace(page);
    await waitForInboxReady(page);
  });

  test("login and workspace shell render", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
    await expect(page.getByPlaceholder("Search…")).toBeVisible();
    await expect(page.getByRole("button", { name: /Ongoing/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Transferred/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Closed/i })).toBeVisible();
  });

  test("inbox tabs, search, and conversation selection", async ({ page }) => {
    const metrics: LatencyMetric[] = [];

    metrics.push(
      await measure("switch inbox tab", async () => {
        await clickInboxTab(page, /^Closed/);
        await expect(page.getByRole("button", { name: /^Closed/ })).toBeVisible();
      }),
    );

    metrics.push(
      await measure("switch inbox tab", async () => {
        await clickInboxTab(page, /^Transferred/);
      }),
    );

    metrics.push(
      await measure("switch inbox tab", async () => {
        await clickInboxTab(page, /^Ongoing/);
      }),
    );

    metrics.push(
      await measure("search filter", async () => {
        const search = page.getByPlaceholder("Search…");
        await search.fill("Visitor");
        await expect(search).toHaveValue("Visitor");
        await search.fill("");
      }),
    );

    const conversation = await firstConversationButton(page);
    metrics.push(
      await measure("select conversation", async () => {
        await conversation.click();
      }),
    );

    metrics.push(
      await measure("messages visible", async () => {
        await page
          .getByText("Loading conversation…")
          .waitFor({ state: "hidden", timeout: 15_000 })
          .catch(() => undefined);
        await page
          .getByText("Loading messages…")
          .waitFor({ state: "hidden", timeout: 15_000 })
          .catch(() => undefined);
        const thread = page.locator(".panel-scroll-native").nth(1);
        await expect(thread).toBeVisible();
      }),
    );

    printLatencyReport(metrics);
    assertLatency(metrics, LATENCY_BUDGET_MS);
  });

  test("customer panel tabs and previous interactions", async ({ page }) => {
    const conversation = await firstConversationButton(page);
    await conversation.click();
    await page
      .getByText("Loading conversation…")
      .waitFor({ state: "hidden", timeout: 15_000 })
      .catch(() => undefined);

    const metrics: LatencyMetric[] = [];

    for (const tab of ["Co-worker", "My notes", "Customer info"] as const) {
      metrics.push(
        await measure("customer panel tab switch", async () => {
          await page.getByRole("button", { name: tab }).click();
          await expect(page.getByRole("button", { name: tab })).toBeVisible();
        }),
      );
    }

    await page.getByRole("button", { name: "Customer info" }).click();
    const historySection = page.getByRole("heading", { name: "Previous interactions" });
    await expect(historySection).toBeVisible();

    const historyItems = page.locator(
      'div:has(> h2:text("Previous interactions")) ~ div ul button[type="button"]',
    );
    const count = await historyItems.count();
    if (count > 0) {
      await historyItems.first().click();
      await page
        .getByText("Loading conversation…")
        .waitFor({ state: "hidden", timeout: 15_000 })
        .catch(() => undefined);
    }

    printLatencyReport(metrics);
    assertLatency(metrics, LATENCY_BUDGET_MS);
  });

  test("toolbar presence menu and phone button", async ({ page }) => {
    const metrics: LatencyMetric[] = [];

    const presenceButton = page.getByRole("button", { name: /Ready|Away|Busy|Not Ready/i }).first();
    await expect(presenceButton).toBeVisible();

    metrics.push(
      await measure("presence menu open", async () => {
        await presenceButton.click();
        await expect(page.getByRole("menuitem", { name: "Ready", exact: true })).toBeVisible();
      }),
    );

    await page.getByRole("menuitem", { name: "Away", exact: true }).click();
    await expect(presenceButton).toContainText(/Away|Ready|Busy/i);

    await presenceButton.click();
    await page.getByRole("menuitem", { name: "Ready", exact: true }).click();

    const phoneButton = page.getByRole("button", { name: "Phone" });
    await expect(phoneButton).toBeVisible();
    await phoneButton.click();

    printLatencyReport(metrics);
    assertLatency(metrics, LATENCY_BUDGET_MS);
  });

  test("composer and mandatory End disposition dialog", async ({ page }) => {
    const conversation = await firstConversationButton(page);
    await conversation.click();
    await page
      .getByText("Loading conversation…")
      .waitFor({ state: "hidden", timeout: 15_000 })
      .catch(() => undefined);

    const endButton = page.getByRole("button", { name: "End", exact: true });
    if (await endButton.isVisible()) {
      await endButton.click();
      const dialog = page.getByRole("dialog", { name: "End conversation" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel(/Resolution/)).toBeVisible();
      await expect(dialog.getByLabel(/Disposition/)).toBeVisible();
      await expect(dialog.getByLabel(/Summary/)).toBeVisible();
      await expect(dialog.getByRole("button", { name: "End conversation" })).toBeDisabled();
      await dialog.getByRole("button", { name: "Cancel" }).click();
    }

    const composer = page.getByPlaceholder(/Reply to/i);
    if (await composer.isVisible()) {
      await composer.fill("E2E test message");
      await expect(composer).toHaveValue("E2E test message");
      const sendButton = page.getByRole("button", { name: /send message|send email/i });
      if (await sendButton.isEnabled()) {
        await sendButton.click();
        await composer.waitFor({ state: "visible" });
      } else {
        await composer.fill("");
      }
    } else {
      await expect(
        page.getByText(/conversation is closed|Accept the incoming chat/i).first(),
      ).toBeVisible();
    }
  });

  test("sidebar navigation links", async ({ page }) => {
    await page.getByRole("link", { name: "Contacts" }).click();
    await page.waitForURL(/\/agent\/contacts/);
    await expect(page).toHaveURL(/\/agent\/contacts/);

    await page.getByRole("link", { name: "Agent Workspace" }).click();
    await page.waitForURL(/\/agent\/workspace/);
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  });

  test("full workspace latency benchmark", async ({ page }) => {
    const metrics: LatencyMetric[] = [];

    metrics.push(
      await measure("inbox initial load", async () => {
        await waitForInboxReady(page);
      }),
    );

    await clickInboxTab(page, /^Closed/);
    metrics.push(
      await measure("switch inbox tab", async () => {
        await clickInboxTab(page, /^Ongoing/);
      }),
    );

    const conversation = await firstConversationButton(page);
    await conversation.click();

    metrics.push(
      await measure("messages visible", async () => {
        await page
          .getByText("Loading conversation…")
          .waitFor({ state: "hidden", timeout: 15_000 })
          .catch(() => undefined);
        await page
          .getByText("Loading messages…")
          .waitFor({ state: "hidden", timeout: 15_000 })
          .catch(() => undefined);
      }),
    );

    printLatencyReport(metrics);
    assertLatency(metrics, LATENCY_BUDGET_MS);
  });
});

test.describe("Login flow latency", () => {
  test("login → workspace timing", async ({ page }) => {
    const metrics: LatencyMetric[] = [];

    metrics.push(
      await measure("login → workspace", async () => {
        await loginAsAgent(page);
        await openAgentWorkspace(page);
        await waitForInboxReady(page);
      }),
    );

    printLatencyReport(metrics);
    assertLatency(metrics, LATENCY_BUDGET_MS);
  });
});
