import { expect, test, type Page } from "@playwright/test";

import { cleanupWebchatTestState } from "./helpers/cleanup";
import {
  agentPageForSlot,
  createTwoAgentTestContext,
  loginBothAgentsAndOpenWorkspace,
  otherAgentSlot,
  prepareBothAgentsForWebchatTest,
  prepareTwoAgentWebchatSuite,
  type AgentSlot,
} from "./helpers/two-agent-webchat";
import {
  acceptIncomingOffer,
  expectIncomingOfferHidden,
  rejectIncomingOffer,
  waitForIncomingOffer,
} from "./helpers/workspace";
import { customerBotReplyThenHandoff, openWebchatCustomer } from "./helpers/webchat";

async function submitWarmTransfer(senderPage: Page) {
  await senderPage.getByRole("button", { name: "Transfer", exact: true }).click();
  const transferDialog = senderPage.getByRole("dialog", { name: "Transfer conversation" });
  await expect(transferDialog).toBeVisible();
  await expect(transferDialog.getByText(/^Disposition/i)).toHaveCount(0);

  await transferDialog.getByRole("button", { name: "Select a queue" }).click();
  const queueOptions = senderPage.getByRole("option");
  await expect(queueOptions.first()).toBeVisible({ timeout: 15_000 });
  await queueOptions.first().click();

  const agentChoices = transferDialog.getByRole("radio");
  await expect(agentChoices.first()).toBeVisible({ timeout: 30_000 });
  await agentChoices.first().click();
  await transferDialog.getByLabel(/Transfer notes/i).fill("Warm handoff from the current agent.");
  await transferDialog.getByRole("button", { name: "Transfer", exact: true }).click();
  await expect(transferDialog).toBeHidden({ timeout: 30_000 });
}

test.describe("Webchat agent-to-agent transfer", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(() => {
    try {
      prepareTwoAgentWebchatSuite();
    } catch (error) {
      test.skip(
        true,
        `Transfer e2e requires live DB/agent seed (suite prep failed: ${
          error instanceof Error ? error.message : String(error)
        })`,
      );
    }
  });

  test.beforeEach(() => {
    cleanupWebchatTestState();
  });

  test("preferred transfer rings receiver; reject restores sender", async ({ browser }) => {
    test.setTimeout(360_000);

    const visitorId = `v_transfer_${Date.now()}`;
    const ctx = await createTwoAgentTestContext(browser);
    const customerPage = await ctx.createCustomerPage();

    try {
      await loginBothAgentsAndOpenWorkspace(ctx.agentAPage, ctx.agentBPage);
      await prepareBothAgentsForWebchatTest(ctx.agentAPage, ctx.agentBPage);

      await openWebchatCustomer(customerPage, visitorId);

      const firstOfferPromise = Promise.race([
        waitForIncomingOffer(ctx.agentAPage, { timeout: 60_000 }).then(() => "a" as AgentSlot),
        waitForIncomingOffer(ctx.agentBPage, { timeout: 60_000 }).then(() => "b" as AgentSlot),
      ]);
      await customerBotReplyThenHandoff(customerPage);
      const firstSlot = await firstOfferPromise;

      const senderPage = agentPageForSlot(ctx, firstSlot);
      const receiverPage = agentPageForSlot(ctx, otherAgentSlot(firstSlot));

      await acceptIncomingOffer(senderPage);
      await expect(senderPage.getByPlaceholder(/Reply to|Type a message|Write a reply/i)).toBeVisible({
        timeout: 30_000,
      });

      await submitWarmTransfer(senderPage);
      await expect(senderPage.getByText(/Ringing .* ·|Ringing/i)).toBeVisible({
        timeout: 30_000,
      });
      await expect(senderPage.getByText(/Messaging is paused/i)).toBeVisible();

      await waitForIncomingOffer(receiverPage, { timeout: 60_000 });
      await expect(receiverPage.getByText(/Transfer from/i)).toBeVisible();
      await expect(receiverPage.getByText(/Warm handoff from/i)).toBeVisible();
      await expect(senderPage.getByRole("button", { name: "Accept", exact: true })).toHaveCount(0);

      await rejectIncomingOffer(receiverPage);
      await expectIncomingOfferHidden(receiverPage, 30_000);
      await expect(senderPage.getByText(/conversation is active again/i)).toBeVisible({
        timeout: 30_000,
      });
      await expect(senderPage.getByPlaceholder(/Reply to|Type a message|Write a reply/i)).toBeVisible();
    } finally {
      await customerPage.context().close();
      await ctx.close();
    }
  });

  test("accept keeps receiver active and requires sender completion", async ({ browser }) => {
    test.setTimeout(360_000);

    const visitorId = `v_transfer_accept_${Date.now()}`;
    const ctx = await createTwoAgentTestContext(browser);
    const customerPage = await ctx.createCustomerPage();

    try {
      await loginBothAgentsAndOpenWorkspace(ctx.agentAPage, ctx.agentBPage);
      await prepareBothAgentsForWebchatTest(ctx.agentAPage, ctx.agentBPage);
      await openWebchatCustomer(customerPage, visitorId);

      const firstOfferPromise = Promise.race([
        waitForIncomingOffer(ctx.agentAPage, { timeout: 60_000 }).then(() => "a" as AgentSlot),
        waitForIncomingOffer(ctx.agentBPage, { timeout: 60_000 }).then(() => "b" as AgentSlot),
      ]);
      await customerBotReplyThenHandoff(customerPage);
      const firstSlot = await firstOfferPromise;
      const senderPage = agentPageForSlot(ctx, firstSlot);
      const receiverPage = agentPageForSlot(ctx, otherAgentSlot(firstSlot));

      await acceptIncomingOffer(senderPage);
      await expect(senderPage.getByPlaceholder(/Reply to|Type a message|Write a reply/i)).toBeVisible({
        timeout: 30_000,
      });
      await submitWarmTransfer(senderPage);
      await waitForIncomingOffer(receiverPage, { timeout: 60_000 });
      await acceptIncomingOffer(receiverPage);

      await expect(
        receiverPage.getByPlaceholder(/Reply to|Type a message|Write a reply/i),
      ).toBeVisible({ timeout: 30_000 });

      const completionDialog = senderPage.getByRole("dialog", { name: "Complete transfer" });
      await expect(completionDialog).toBeVisible({ timeout: 30_000 });
      await expect(completionDialog.getByRole("button", { name: "Close dialog" })).toHaveCount(0);
      await expect(completionDialog.getByText(/Accepted by/i)).toBeVisible();

      const dispositionButton = completionDialog.getByRole("button", {
        name: /Select a disposition/i,
      });
      if (await dispositionButton.isVisible().catch(() => false)) {
        await dispositionButton.click();
        await senderPage.getByRole("option").first().click();
      }
      await completionDialog
        .getByLabel(/Conversation Summary/i)
        .fill("Warm transfer accepted and completed by the receiving agent.");
      await completionDialog.getByRole("button", { name: "Complete transfer" }).click();
      await expect(completionDialog).toBeHidden({ timeout: 30_000 });
      await expect(senderPage.getByRole("button", { name: /Transferred/i })).toBeVisible();
    } finally {
      await customerPage.context().close();
      await ctx.close();
    }
  });
});
