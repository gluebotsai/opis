import { expect, type Page } from "@playwright/test";

export async function expectCrossChannelCard(page: Page) {
  await expect(page.getByText("Contact across channels")).toBeVisible({ timeout: 20_000 });
}

export async function expectBotSummaryCard(page: Page) {
  await expect(page.getByText(/Bot summary|Session memory/i).first()).toBeVisible({
    timeout: 20_000,
  });
}
