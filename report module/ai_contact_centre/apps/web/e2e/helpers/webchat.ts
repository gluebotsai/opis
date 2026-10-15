import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, type Page } from "@playwright/test";

export const DEFAULT_WEBCHAT_ID =
  process.env.PLAYWRIGHT_WEBCHAT_ID ?? "wc_5d80cd9b1ace4080bc70717552472611";

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));

export function webchatCustomerUrl(visitorId: string): string {
  const fixturePath = path.join(fixtureDir, "../fixtures/webchat-customer.html");
  const params = new URLSearchParams({
    webchatId: DEFAULT_WEBCHAT_ID,
    visitorId,
  });
  return `file://${fixturePath}?${params.toString()}`;
}

export async function openWebchatCustomer(page: Page, visitorId: string) {
  await page.goto(webchatCustomerUrl(visitorId));
  await expect(page.getByTestId("webchat-status")).toBeVisible();
  await expect
    .poll(async () => page.evaluate(() => Boolean((window as unknown as { __webchatReady?: boolean }).__webchatReady)), {
      timeout: 45_000,
    })
    .toBe(true);
}

export async function customerSends(page: Page, text: string) {
  const input = page.getByTestId("webchat-input");
  await input.fill(text);
  await page.getByTestId("webchat-send").click();
  await expect(page.getByTestId("webchat-messages")).toContainText(text);
}

export async function waitForCustomerMessage(
  page: Page,
  pattern: RegExp | string,
  options: { timeout?: number } = {},
) {
  const locator = page.getByTestId("webchat-messages");
  await expect(locator).toContainText(pattern, { timeout: options.timeout ?? 60_000 });
}

export const BOT_REPLY_PATTERN = /help|hello|welcome|assist/i;
export const HANDOFF_ACK_PATTERN = /agent|connect|hold|support|transfer|queue|wait/i;
export const AGENTS_BUSY_PATTERN =
  /all our live agents are currently busy|agents are busy|continue chatting with our ai/i;

export const CUSTOMER_GREETING = "hi";
export const CUSTOMER_HANDOFF = "Please connect me to a live agent";

/** Starts handoff quickly — skips waiting for the bot reply on the greeting. */
export async function customerQuickHandoff(customerPage: Page) {
  await customerSends(customerPage, CUSTOMER_GREETING);
  await customerSends(customerPage, CUSTOMER_HANDOFF);
}

export async function customerBotReplyThenHandoff(
  customerPage: Page,
  options: { expectHandoffAck?: boolean } = {},
) {
  await customerSends(customerPage, CUSTOMER_GREETING);
  await waitForCustomerMessage(customerPage, BOT_REPLY_PATTERN, { timeout: 90_000 });
  await customerSends(customerPage, CUSTOMER_HANDOFF);
  if (options.expectHandoffAck !== false) {
    await waitForCustomerMessage(customerPage, HANDOFF_ACK_PATTERN, { timeout: 90_000 });
  }
}

export async function expectAgentsBusyMessage(
  customerPage: Page,
  options: { timeout?: number } = {},
) {
  await waitForCustomerMessage(customerPage, AGENTS_BUSY_PATTERN, {
    timeout: options.timeout ?? 90_000,
  });
}
