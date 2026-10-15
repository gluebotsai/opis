import { expect, test, type Page } from "@playwright/test";

import { loginAsAgent, openAgentWorkspace } from "./helpers/auth";
import {
  expectIncomingOfferHidden,
  fillAndSubmitDisposition,
  prepareAgentForWebchatTest,
  rejectIncomingOfferIfVisible,
  setAgentReady,
  waitForIncomingOffer,
} from "./helpers/workspace";
import { cleanupWebchatTestState, configureE2eOfferTimeoutOnce } from "./helpers/cleanup";
import { forceOfferExpiry, readCustomerConversationId } from "./helpers/webchat-api";
import {
  customerSends,
  openWebchatCustomer,
  waitForCustomerMessage,
  webchatCustomerUrl,
} from "./helpers/webchat";

const CUSTOMER_GREETING = "hi";
const CUSTOMER_HANDOFF = "Please connect me to a live agent";
const AGENT_REPLY = "Thanks for waiting — I am here to help you now.";

function customerDisplayName(visitorId: string) {
  return visitorId.replace(/^v_/, "Visitor ");
}

async function assertBotReplyHasNoContactMetadata(page: Page) {
  const text = await page.getByTestId("webchat-messages").innerText();
  expect(text).not.toMatch(/contact\.(email|phone|display_name|city|country)=/i);
}

test.describe("Webchat bot lifecycle E2E", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(() => {
    configureE2eOfferTimeoutOnce();
  });

  test("bot reply → handoff → offer timeout → accept → end", async ({ browser }) => {
    test.setTimeout(240_000);

    const visitorId = `v_botlife_${Date.now()}`;
    const acceptVisitorId = `v_botaccept_${Date.now()}`;
    const customerName = customerDisplayName(acceptVisitorId);

    const agentContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const customerContext = await browser.newContext({
      viewport: { width: 480, height: 820 },
    });

    const agentPage = await agentContext.newPage();
    const customerPage = await customerContext.newPage();

    try {
      await loginAsAgent(agentPage);
      await openAgentWorkspace(agentPage);
      await prepareAgentForWebchatTest(agentPage);

      await openWebchatCustomer(customerPage, visitorId);

      // 1) Bot reply
      await customerSends(customerPage, CUSTOMER_GREETING);
      await waitForCustomerMessage(customerPage, /help|hello|welcome|assist/i, {
        timeout: 90_000,
      });
      await assertBotReplyHasNoContactMetadata(customerPage);

      // 2) Handoff — watch for the offer immediately so the offer timeout does not expire first
      const offerVisible = waitForIncomingOffer(agentPage, { timeout: 60_000 });
      await customerSends(customerPage, CUSTOMER_HANDOFF);
      await Promise.all([
        waitForCustomerMessage(customerPage, /agent|connect|hold|support|transfer/i, {
          timeout: 90_000,
        }),
        offerVisible,
      ]);

      // 3) Offer timeout — do not accept; agent should go Away and stop ringing
      const conversationId = await readCustomerConversationId(customerPage);
      forceOfferExpiry(conversationId);

      const presenceButton = agentPage
        .getByRole("button", { name: /Ready|Away|Busy|Not Ready|After contact work/i })
        .first();
      await expect(presenceButton).toContainText(/Away/i, { timeout: 20_000 });
      await expectIncomingOfferHidden(agentPage);
      await expect(agentPage.getByRole("button", { name: "Missed contacts" })).toBeVisible();

      // End the first customer session so it cannot interfere with accept/end.
      await customerPage.getByTestId("webchat-end").click();
      await customerPage.waitForTimeout(1_000);

      // 4) Accepted — fresh customer session while agent is Ready again
      cleanupWebchatTestState();
      await setAgentReady(agentPage);
      await rejectIncomingOfferIfVisible(agentPage);
      await expectIncomingOfferHidden(agentPage);
      await setAgentReady(agentPage);
      await expect(
        agentPage.getByRole("button", { name: /Ready|Away|Busy|Not Ready|After contact work/i }).first(),
      ).toContainText(/Ready/i);

      await customerPage.goto(webchatCustomerUrl(acceptVisitorId));
      await expect
        .poll(async () => customerPage.evaluate(() => Boolean((window as unknown as { __webchatReady?: boolean }).__webchatReady)), {
          timeout: 45_000,
        })
        .toBe(true);

      const acceptOfferPromise = waitForIncomingOffer(agentPage, { timeout: 60_000 }).then(async (btn) => {
        await btn.click();
      });
      await customerSends(customerPage, CUSTOMER_HANDOFF);
      await Promise.all([
        acceptOfferPromise,
        waitForCustomerMessage(customerPage, /agent|connect|hold|support|transfer/i, {
          timeout: 90_000,
        }),
      ]);
      await agentPage.waitForURL(/conversationId=/, { timeout: 30_000 });

      await expect(agentPage.getByPlaceholder(/Reply to/i)).toBeVisible({ timeout: 45_000 });
      await expect(agentPage.getByText(/Incoming live chat/i)).toHaveCount(0, { timeout: 15_000 });

      const composer = agentPage.getByPlaceholder(/Reply to/i);
      await composer.fill(AGENT_REPLY);
      await agentPage.getByRole("button", { name: "Send message" }).click();
      await expect(composer).toHaveValue("", { timeout: 5_000 });
      await expect(agentPage.getByText(AGENT_REPLY).last()).toBeVisible({ timeout: 10_000 });
      await waitForCustomerMessage(customerPage, AGENT_REPLY, { timeout: 60_000 });

      // 5) Ended
      await agentPage.getByRole("button", { name: "End", exact: true }).click();
      await fillAndSubmitDisposition(agentPage);

      await agentPage.getByRole("button", { name: /^Closed/ }).click();
      await agentPage
        .getByText("Loading conversations…")
        .waitFor({ state: "hidden", timeout: 15_000 })
        .catch(() => undefined);

      await expect(
        agentPage.locator('ul.space-y-1 button[type="button"]').filter({ hasText: customerName }).first(),
      ).toBeVisible({ timeout: 30_000 });

      await expect(customerPage.getByTestId("webchat-messages")).toContainText(AGENT_REPLY);
    } finally {
      await customerContext.close();
      await agentContext.close();
    }
  });
});
