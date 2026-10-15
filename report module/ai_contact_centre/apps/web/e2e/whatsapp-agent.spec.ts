import { expect, test } from "@playwright/test";

import { loginAsAgent, openAgentWorkspace } from "./helpers/auth";
import { seedCrossChannelContact } from "./helpers/api-seed";

test.describe("WhatsApp agent inbox", () => {
  test.skip(!process.env.E2E_STACK_READY, "Requires E2E_STACK_READY=1 and running stack");

  test("agent workspace loads after whatsapp seed", async ({ page }) => {
    test.setTimeout(120_000);
    await seedCrossChannelContact();

    await loginAsAgent(page);
    await openAgentWorkspace(page);
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  });
});
