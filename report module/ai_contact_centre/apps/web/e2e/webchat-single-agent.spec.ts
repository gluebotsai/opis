import { expect, test } from "@playwright/test";

import { loginAsAgent, openAgentWorkspace } from "./helpers/auth";
import { cleanupWebchatTestState, configureE2eOfferTimeoutOnce } from "./helpers/cleanup";
import {
  AGENT_REPLY,
  createSingleAgentTestContext,
  resetAgentForScenario,
} from "./helpers/single-agent-webchat";
import {
  expectIncomingOfferHidden,
  expectMissedContactCountAtLeast,
  fillAndSubmitDisposition,
  prepareAgentForWebchatTest,
  rejectIncomingOffer,
  waitForIncomingOffer,
} from "./helpers/workspace";
import {
  BOT_REPLY_PATTERN,
  CUSTOMER_GREETING,
  CUSTOMER_HANDOFF,
  customerBotReplyThenHandoff,
  customerSends,
  expectAgentsBusyMessage,
  openWebchatCustomer,
  waitForCustomerMessage,
} from "./helpers/webchat";
import { forceOfferExpiry, readCustomerConversationId } from "./helpers/webchat-api";

test.describe("Webchat single-agent scenarios", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(() => {
    configureE2eOfferTimeoutOnce();
  });

  test.beforeEach(() => {
    cleanupWebchatTestState();
  });

  test("1. agent busy — handoff returns agents-busy message", async ({ browser }) => {
    test.setTimeout(120_000);

    const visitorId = `v_busy_${Date.now()}`;
    const { agentPage, customerPage, close } = await createSingleAgentTestContext(browser);

    try {
      await loginAsAgent(agentPage);
      await openAgentWorkspace(agentPage);
      await resetAgentForScenario(agentPage, "busy");

      await openWebchatCustomer(customerPage, visitorId);
      await customerBotReplyThenHandoff(customerPage);
      await expectAgentsBusyMessage(customerPage);

      await expect(agentPage.getByRole("button", { name: "Accept", exact: true })).toHaveCount(0);
    } finally {
      await close();
    }
  });

  test("2. agent ready — offer timeout returns agents-busy message", async ({ browser }) => {
    test.setTimeout(180_000);

    const visitorId = `v_timeout_${Date.now()}`;
    const { agentPage, customerPage, close } = await createSingleAgentTestContext(browser);

    try {
      await loginAsAgent(agentPage);
      await openAgentWorkspace(agentPage);
      await prepareAgentForWebchatTest(agentPage);

      await openWebchatCustomer(customerPage, visitorId);

      const offerVisible = waitForIncomingOffer(agentPage, { timeout: 60_000 });
      await customerBotReplyThenHandoff(customerPage);
      await offerVisible;

      const conversationId = await readCustomerConversationId(customerPage);
      forceOfferExpiry(conversationId);

      const presenceButton = agentPage
        .getByRole("button", { name: /Ready|Away|Busy|Not Ready|After contact work/i })
        .first();
      await expect(presenceButton).toContainText(/Away/i, { timeout: 25_000 });
      await expectIncomingOfferHidden(agentPage);
      await expectMissedContactCountAtLeast(agentPage, 1);

      await expectAgentsBusyMessage(customerPage, { timeout: 45_000 });

      // Bot should resume after timeout fallback — customer can chat again.
      await customerSends(customerPage, "hi");
      await waitForCustomerMessage(customerPage, BOT_REPLY_PATTERN, { timeout: 90_000 });
    } finally {
      await close();
    }
  });

  test("3. agent ready — accept offer, live agent replies, end conversation", async ({ browser }) => {
    test.setTimeout(180_000);

    const visitorId = `v_accept_${Date.now()}`;
    const { agentPage, customerPage, close } = await createSingleAgentTestContext(browser);

    try {
      await loginAsAgent(agentPage);
      await openAgentWorkspace(agentPage);
      await prepareAgentForWebchatTest(agentPage);

      await openWebchatCustomer(customerPage, visitorId);

      const acceptOfferPromise = waitForIncomingOffer(agentPage, { timeout: 60_000 }).then(async (btn) => {
        await btn.click();
      });
      await customerBotReplyThenHandoff(customerPage);
      await acceptOfferPromise;

      await agentPage.waitForURL(/conversationId=/, { timeout: 30_000 });
      await expect(agentPage.getByPlaceholder(/Reply to/i)).toBeVisible({ timeout: 45_000 });
      await expectIncomingOfferHidden(agentPage);

      const composer = agentPage.getByPlaceholder(/Reply to/i);
      await composer.fill(AGENT_REPLY);
      await agentPage.getByRole("button", { name: "Send message" }).click();
      await expect(composer).toHaveValue("", { timeout: 5_000 });
      await expect(agentPage.getByText(AGENT_REPLY).last()).toBeVisible({ timeout: 10_000 });
      await waitForCustomerMessage(customerPage, AGENT_REPLY, { timeout: 60_000 });

      await agentPage.getByRole("button", { name: "End", exact: true }).click();
      await fillAndSubmitDisposition(agentPage);

      await expect(customerPage.getByTestId("webchat-messages")).toContainText(AGENT_REPLY);
    } finally {
      await close();
    }
  });

  test("4. agent ready — reject offer returns agents-busy message", async ({ browser }) => {
    test.setTimeout(120_000);

    const visitorId = `v_reject_${Date.now()}`;
    const { agentPage, customerPage, close } = await createSingleAgentTestContext(browser);

    try {
      await loginAsAgent(agentPage);
      await openAgentWorkspace(agentPage);
      await prepareAgentForWebchatTest(agentPage);

      await openWebchatCustomer(customerPage, visitorId);

      await customerSends(customerPage, CUSTOMER_GREETING);
      await waitForCustomerMessage(customerPage, BOT_REPLY_PATTERN, { timeout: 90_000 });

      const offerVisible = waitForIncomingOffer(agentPage, { timeout: 60_000 });
      await customerSends(customerPage, CUSTOMER_HANDOFF);
      await offerVisible;

      await rejectIncomingOffer(agentPage);
      await expectAgentsBusyMessage(customerPage, { timeout: 45_000 });
    } finally {
      await close();
    }
  });
});
