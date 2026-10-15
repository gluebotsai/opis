import { expect, test, type Page } from "@playwright/test";

import { loginAsAgent, openAgentWorkspace } from "./helpers/auth";
import { prepareAgentForWebchatTest } from "./helpers/workspace";
import { customerSends, openWebchatCustomer, waitForCustomerMessage } from "./helpers/webchat";


const AGENT_REPLY = "Thanks for reaching out — I can help you with that.";
const CUSTOMER_HANDOFF = "Please connect me to a live agent";

function customerDisplayName(visitorId: string) {
  return visitorId.replace(/^v_/, "Visitor ");
}

async function acceptIncomingOffer(page: Page) {
  const acceptButton = page.getByRole("button", { name: "Accept", exact: true });
  await expect(acceptButton.first()).toBeVisible({ timeout: 90_000 });
  const accepted = page.waitForResponse(
    (response) => /\/accept(?:\?|$)/.test(response.url()) && response.ok(),
    { timeout: 30_000 },
  );
  await acceptButton.first().click();
  await accepted.catch(() => undefined);
}

async function fillAndSubmitDisposition(page: Page) {
  const dialog = page.getByRole("dialog", { name: "End conversation" });
  await expect(dialog).toBeVisible({ timeout: 15_000 });

  await dialog.getByLabel(/Resolution/i).selectOption("resolved");

  const dispositionSelect = dialog.getByLabel(/^Disposition/i);
  await expect
    .poll(async () => {
      const options = await dispositionSelect.locator("option").allTextContents();
      return options.filter((option) => option && !option.includes("Select")).length;
    })
    .toBeGreaterThan(0);

  const dispositionValue = await dispositionSelect.locator("option").nth(1).getAttribute("value");
  if (dispositionValue) {
    await dispositionSelect.selectOption(dispositionValue);
  }

  await dialog.getByLabel(/Summary/i).fill("Visual E2E: webchat handoff, agent reply, and wrap-up completed.");

  await dialog.getByRole("button", { name: "End conversation" }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
}

test.describe("Webchat to agent visual journey", () => {
  test.describe.configure({ mode: "serial" });

  test("customer webchat → live agent → message → end conversation", async ({ browser }) => {
    test.setTimeout(300_000);

    const visitorId = `v_visual_${Date.now()}`;
    const customerName = customerDisplayName(visitorId);

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
      await customerSends(customerPage, "Hello, I need help with my order.");

      await waitForCustomerMessage(customerPage, /assist|help|hello/i, { timeout: 90_000 });

      await customerSends(customerPage, CUSTOMER_HANDOFF);

      await waitForCustomerMessage(customerPage, /agent|connect|hold|support/i, {
        timeout: 90_000,
      });

      await acceptIncomingOffer(agentPage);
      await agentPage.waitForURL(/conversationId=/, { timeout: 30_000 }).catch(() => undefined);

      await expect(agentPage.getByPlaceholder(/Reply to/i)).toBeVisible({ timeout: 30_000 });
      await expect(agentPage.getByText(/Incoming webchat/i)).toBeHidden({ timeout: 30_000 });
      await expect(agentPage.getByText(/Accept the incoming chat to start replying/i)).toBeHidden({
        timeout: 30_000,
      });

      const composer = agentPage.getByPlaceholder(/Reply to/i);
      await composer.fill(AGENT_REPLY);
      await agentPage.getByRole("button", { name: "Send message" }).click();
      await expect(composer).toHaveValue("", { timeout: 5_000 });
      await expect(agentPage.getByText(AGENT_REPLY).last()).toBeVisible({ timeout: 10_000 });

      await waitForCustomerMessage(customerPage, AGENT_REPLY, { timeout: 60_000 });

      await agentPage.getByRole("button", { name: "End", exact: true }).click();
      await fillAndSubmitDisposition(agentPage);

      await agentPage.getByRole("button", { name: /^Closed/ }).click();
      await agentPage
        .getByText("Loading conversations…")
        .waitFor({ state: "hidden", timeout: 15_000 })
        .catch(() => undefined);

      await expect(
        agentPage.getByRole("button", { name: new RegExp(customerName) }).first(),
      ).toBeVisible({ timeout: 30_000 });

      await expect(customerPage.getByTestId("webchat-messages")).toContainText(AGENT_REPLY);
      await customerPage.waitForTimeout(4_000);
    } finally {
      await customerContext.close();
      await agentContext.close();
    }
  });
});
