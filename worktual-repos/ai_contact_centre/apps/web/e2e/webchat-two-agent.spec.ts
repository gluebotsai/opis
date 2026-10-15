import { expect, test } from "@playwright/test";

import { AGENT_A_EMAIL, AGENT_B_EMAIL } from "./helpers/auth";
import { cleanupWebchatTestState } from "./helpers/cleanup";
import { AGENT_REPLY } from "./helpers/single-agent-webchat";
import {
  agentHasIncomingOffer,
  agentPageForSlot,
  createTwoAgentDualCustomerContext,
  createTwoAgentTestContext,
  findAgentWithOffer,
  loginBothAgentsAndOpenWorkspace,
  otherAgentSlot,
  prepareBothAgentsForWebchatTest,
  prepareTwoAgentWebchatSuite,
  setBothAgentsBusy,
} from "./helpers/two-agent-webchat";
import { forceOfferExpiry, readCustomerConversationId } from "./helpers/webchat-api";
import {
  acceptIncomingOffer,
  expectIncomingOfferHidden,
  expectMissedContactCountAtLeast,
  fillAndSubmitDisposition,
  rejectIncomingOffer,
  setAgentBusy,
  waitForIncomingOffer,
} from "./helpers/workspace";
import {
  customerBotReplyThenHandoff,
  customerQuickHandoff,
  expectAgentsBusyMessage,
  openWebchatCustomer,
  waitForCustomerMessage,
} from "./helpers/webchat";

test.describe("Webchat two-agent scenarios", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(() => {
    prepareTwoAgentWebchatSuite();
  });

  test.beforeEach(() => {
    cleanupWebchatTestState();
  });

  test("1. both agents ready — concurrent offers for two customers", async ({ browser }) => {
    test.setTimeout(360_000);

    const visitor1 = `v_2a_ring1_${Date.now()}`;
    const visitor2 = `v_2a_ring2_${Date.now()}`;
    const ctx = await createTwoAgentDualCustomerContext(browser);

    try {
      await loginBothAgentsAndOpenWorkspace(ctx.agentAPage, ctx.agentBPage);
      await prepareBothAgentsForWebchatTest(ctx.agentAPage, ctx.agentBPage);

      await openWebchatCustomer(ctx.customer1Page, visitor1);
      await openWebchatCustomer(ctx.customer2Page, visitor2);

      const firstOfferPromise = Promise.race([
        waitForIncomingOffer(ctx.agentAPage, { timeout: 60_000 }).then(() => "a" as const),
        waitForIncomingOffer(ctx.agentBPage, { timeout: 60_000 }).then(() => "b" as const),
      ]);

      await customerBotReplyThenHandoff(ctx.customer1Page);
      const firstSlot = await firstOfferPromise;

      const firstAgentPage = agentPageForSlot(ctx, firstSlot);
      const secondAgentPage = agentPageForSlot(ctx, otherAgentSlot(firstSlot));

      await expect(firstAgentPage.getByRole("button", { name: "Accept", exact: true })).toBeVisible();
      await expect(secondAgentPage.getByRole("button", { name: "Accept", exact: true })).toHaveCount(0);

      await customerQuickHandoff(ctx.customer2Page);

      await expect
        .poll(
          async () => {
            const firstStillRinging = await agentHasIncomingOffer(firstAgentPage);
            const secondRinging = await agentHasIncomingOffer(secondAgentPage);
            return firstStillRinging && secondRinging;
          },
          { timeout: 60_000, message: "expected both agents to have concurrent incoming offers" },
        )
        .toBe(true);
    } finally {
      await ctx.close();
    }
  });

  test("2. both agents busy — handoff returns agents-busy message", async ({ browser }) => {
    test.setTimeout(120_000);

    const visitorId = `v_2a_busy_${Date.now()}`;
    const ctx = await createTwoAgentTestContext(browser);
    const customerPage = await ctx.createCustomerPage();

    try {
      await loginBothAgentsAndOpenWorkspace(ctx.agentAPage, ctx.agentBPage);
      await setBothAgentsBusy(ctx.agentAPage, ctx.agentBPage);

      await openWebchatCustomer(customerPage, visitorId);
      await customerQuickHandoff(customerPage);
      await expectAgentsBusyMessage(customerPage);

      await expect(ctx.agentAPage.getByRole("button", { name: "Accept", exact: true })).toHaveCount(0);
      await expect(ctx.agentBPage.getByRole("button", { name: "Accept", exact: true })).toHaveCount(0);
    } finally {
      await customerPage.context().close();
      await ctx.close();
    }
  });

  test("3. first agent rejects — offer reroutes to second agent", async ({ browser }) => {
    test.setTimeout(360_000);

    const visitorId = `v_2a_reject_${Date.now()}`;
    const ctx = await createTwoAgentTestContext(browser);
    const customerPage = await ctx.createCustomerPage();

    try {
      await loginBothAgentsAndOpenWorkspace(ctx.agentAPage, ctx.agentBPage);
      await prepareBothAgentsForWebchatTest(ctx.agentAPage, ctx.agentBPage);

      await openWebchatCustomer(customerPage, visitorId);

      const firstOfferPromise = Promise.race([
        waitForIncomingOffer(ctx.agentAPage, { timeout: 60_000 }).then(() => "a" as const),
        waitForIncomingOffer(ctx.agentBPage, { timeout: 60_000 }).then(() => "b" as const),
      ]);
      await customerBotReplyThenHandoff(customerPage);
      const firstSlot = await firstOfferPromise;

      const rejectingPage = agentPageForSlot(ctx, firstSlot);
      const fallbackPage = agentPageForSlot(ctx, otherAgentSlot(firstSlot));

      await rejectIncomingOffer(rejectingPage);
      await expectIncomingOfferHidden(rejectingPage);

      await waitForIncomingOffer(fallbackPage, { timeout: 60_000 });
      await expect(rejectingPage.getByRole("button", { name: "Accept", exact: true })).toHaveCount(0);
    } finally {
      await customerPage.context().close();
      await ctx.close();
    }
  });

  test("4. offer timeout on first agent — away + reroute + second agent accepts", async ({ browser }) => {
    test.setTimeout(360_000);

    const visitorId = `v_2a_timeout_${Date.now()}`;
    const ctx = await createTwoAgentTestContext(browser);
    const customerPage = await ctx.createCustomerPage();

    try {
      await loginBothAgentsAndOpenWorkspace(ctx.agentAPage, ctx.agentBPage);
      await prepareBothAgentsForWebchatTest(ctx.agentAPage, ctx.agentBPage);

      await openWebchatCustomer(customerPage, visitorId);

      const firstOfferPromise = Promise.race([
        waitForIncomingOffer(ctx.agentAPage, { timeout: 60_000 }).then(() => "a" as const),
        waitForIncomingOffer(ctx.agentBPage, { timeout: 60_000 }).then(() => "b" as const),
      ]);
      await customerBotReplyThenHandoff(customerPage);
      const firstSlot = await firstOfferPromise;

      const timedOutPage = agentPageForSlot(ctx, firstSlot);
      const acceptingPage = agentPageForSlot(ctx, otherAgentSlot(firstSlot));

      const conversationId = await readCustomerConversationId(customerPage);
      forceOfferExpiry(conversationId);

      const timedOutPresence = timedOutPage
        .getByRole("button", { name: /Ready|Away|Busy|Not Ready|After contact work/i })
        .first();
      await expect(timedOutPresence).toContainText(/Away/i, { timeout: 20_000 });
      await expectIncomingOfferHidden(timedOutPage);
      await expectMissedContactCountAtLeast(timedOutPage, 1);

      await acceptingPage.reload();
      await expect
        .poll(async () => agentHasIncomingOffer(acceptingPage), {
          timeout: 60_000,
          message: "expected rerouted offer on second agent after timeout",
        })
        .toBe(true);

      await acceptIncomingOffer(acceptingPage);
      await acceptingPage.waitForURL(/conversationId=/, { timeout: 30_000 });
      await expect(acceptingPage.getByPlaceholder(/Reply to/i)).toBeVisible({ timeout: 30_000 });

      const composer = acceptingPage.getByPlaceholder(/Reply to/i);
      await composer.fill(AGENT_REPLY);
      await acceptingPage.getByRole("button", { name: "Send message" }).click();
      await waitForCustomerMessage(customerPage, AGENT_REPLY, { timeout: 45_000 });

      await acceptingPage.getByRole("button", { name: "End", exact: true }).click();
      await fillAndSubmitDisposition(acceptingPage);
    } finally {
      await customerPage.context().close();
      await ctx.close();
    }
  });

  test("5. both agents reject — busy message and bot resume", async ({ browser }) => {
    test.setTimeout(360_000);

    const visitorId = `v_2a_both_reject_${Date.now()}`;
    const ctx = await createTwoAgentTestContext(browser);
    const customerPage = await ctx.createCustomerPage();

    try {
      await loginBothAgentsAndOpenWorkspace(ctx.agentAPage, ctx.agentBPage);
      await prepareBothAgentsForWebchatTest(ctx.agentAPage, ctx.agentBPage);

      await openWebchatCustomer(customerPage, visitorId);
      await customerBotReplyThenHandoff(customerPage);

      const firstSlot = await Promise.race([
        waitForIncomingOffer(ctx.agentAPage, { timeout: 60_000 }).then(() => "a" as const),
        waitForIncomingOffer(ctx.agentBPage, { timeout: 60_000 }).then(() => "b" as const),
      ]);

      const firstPage = agentPageForSlot(ctx, firstSlot);
      const secondPage = agentPageForSlot(ctx, otherAgentSlot(firstSlot));

      await rejectIncomingOffer(firstPage);
      await waitForIncomingOffer(secondPage, { timeout: 60_000 });
      await rejectIncomingOffer(secondPage);

      await expectAgentsBusyMessage(customerPage, { timeout: 45_000 });
    } finally {
      await customerPage.context().close();
      await ctx.close();
    }
  });

  test("6. one ready one busy — only ready agent receives offer", async ({ browser }) => {
    test.setTimeout(120_000);

    const visitorId = `v_2a_one_ready_${Date.now()}`;
    const ctx = await createTwoAgentTestContext(browser);
    const customerPage = await ctx.createCustomerPage();

    try {
      await loginBothAgentsAndOpenWorkspace(ctx.agentAPage, ctx.agentBPage);
      await prepareBothAgentsForWebchatTest(ctx.agentAPage, ctx.agentBPage);
      await setAgentBusy(ctx.agentBPage);

      await openWebchatCustomer(customerPage, visitorId);
      await customerBotReplyThenHandoff(customerPage);

      await waitForIncomingOffer(ctx.agentAPage, { timeout: 60_000 });
      await expect(ctx.agentBPage.getByRole("button", { name: "Accept", exact: true })).toHaveCount(0);
    } finally {
      await customerPage.context().close();
      await ctx.close();
    }
  });

  test("7. second agent accepts while first agent still ringing", async ({ browser }) => {
    test.setTimeout(180_000);

    const visitor1 = `v_2a_acc1_${Date.now()}`;
    const visitor2 = `v_2a_acc2_${Date.now()}`;
    const ctx = await createTwoAgentDualCustomerContext(browser);

    try {
      await loginBothAgentsAndOpenWorkspace(ctx.agentAPage, ctx.agentBPage);
      await prepareBothAgentsForWebchatTest(ctx.agentAPage, ctx.agentBPage);

      await openWebchatCustomer(ctx.customer1Page, visitor1);
      await openWebchatCustomer(ctx.customer2Page, visitor2);

      await customerBotReplyThenHandoff(ctx.customer1Page);
      await expect
        .poll(async () => findAgentWithOffer(ctx.agentAPage, ctx.agentBPage), { timeout: 60_000 })
        .not.toBeNull();

      const firstSlot = (await findAgentWithOffer(ctx.agentAPage, ctx.agentBPage))!;
      const ringingPage = agentPageForSlot(ctx, firstSlot);
      const acceptingPage = agentPageForSlot(ctx, otherAgentSlot(firstSlot));

      const acceptSecondPromise = waitForIncomingOffer(acceptingPage, { timeout: 60_000 }).then(async (btn) => {
        await btn.click();
      });
      await customerQuickHandoff(ctx.customer2Page);
      await acceptSecondPromise;

      await acceptingPage.waitForURL(/conversationId=/, { timeout: 30_000 });
      await expect(acceptingPage.getByPlaceholder(/Reply to/i)).toBeVisible({ timeout: 30_000 });
      await expect(ringingPage.getByRole("button", { name: "Accept", exact: true })).toBeVisible();

      const composer = acceptingPage.getByPlaceholder(/Reply to/i);
      await composer.fill(AGENT_REPLY);
      await acceptingPage.getByRole("button", { name: "Send message" }).click();
      await waitForCustomerMessage(ctx.customer2Page, AGENT_REPLY, { timeout: 45_000 });

      await acceptingPage.getByRole("button", { name: "End", exact: true }).click();
      await fillAndSubmitDisposition(acceptingPage);
    } finally {
      await ctx.close();
    }
  });
});

test.describe("Webchat two-agent credentials", () => {
  test("documents agent A and agent B test accounts", () => {
    expect(AGENT_A_EMAIL).toBe("agent.test@worktual.local");
    expect(AGENT_B_EMAIL).toBe("agent2.test@worktual.local");
  });
});
