import { expect, test } from "@playwright/test";

import { loginAsAgent, openAgentWorkspace } from "./helpers/auth";
import { seedCrossChannelContact } from "./helpers/api-seed";
import { expectCrossChannelCard } from "./helpers/customer-panel";

test.describe("Cross-channel customer panel", () => {
  test.skip(!process.env.E2E_STACK_READY, "Requires E2E_STACK_READY=1 and running stack");

  test("shows contact across channels card", async ({ page }) => {
    test.setTimeout(180_000);
    await seedCrossChannelContact();

    await loginAsAgent(page);
    await openAgentWorkspace(page);

    const conversation = page
      .locator('ul.space-y-1 button[type="button"]')
      .filter({ hasText: /Cross Channel|Playwright|example/i })
      .first();
    await expect(conversation).toBeVisible({ timeout: 60_000 });
    await conversation.click();

    await expectCrossChannelCard(page);
  });
});
