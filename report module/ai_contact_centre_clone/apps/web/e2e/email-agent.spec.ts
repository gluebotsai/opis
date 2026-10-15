import { expect, test } from "@playwright/test";

import { loginAsAgent, openAgentWorkspace } from "./helpers/auth";
import { seedEmailConversation } from "./helpers/api-seed";

test.describe("Email agent inbox", () => {
  test.skip(!process.env.E2E_STACK_READY, "Requires E2E_STACK_READY=1 and running stack");

  test("agent sees seeded email conversation in inbox", async ({ page }) => {
    test.setTimeout(120_000);
    await seedEmailConversation();

    await loginAsAgent(page);
    await openAgentWorkspace(page);

    await page.getByRole("button", { name: /Ongoing|Queued|All/i }).first().click();
    await expect(page.getByText(/Playwright seeded email|seeded for agent/i).first()).toBeVisible({
      timeout: 60_000,
    });
  });
});
