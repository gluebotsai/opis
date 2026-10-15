import { expect, test } from "@playwright/test";

import { loginAsAgent, openAgentWorkspace } from "./helpers/auth";

test.describe("Suggest reply", () => {
  test.skip(!process.env.E2E_STACK_READY, "Requires E2E_STACK_READY=1 and running stack");

  test("suggest reply button is available on active conversation", async ({ page }) => {
    test.setTimeout(120_000);

    await loginAsAgent(page);
    await openAgentWorkspace(page);

    const firstConversation = page.locator('ul.space-y-1 button[type="button"]').first();
    await expect(firstConversation).toBeVisible({ timeout: 30_000 });
    await firstConversation.click();

    const suggestReply = page.getByRole("button", { name: /Suggest reply/i });
    await expect(suggestReply).toBeVisible({ timeout: 20_000 });
  });
});
