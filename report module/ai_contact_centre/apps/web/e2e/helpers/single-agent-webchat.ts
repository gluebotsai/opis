import type { Browser, Page } from "@playwright/test";

import { cleanupWebchatTestState, configureE2eOfferTimeoutOnce } from "./cleanup.js";
import {
  acknowledgeAllMissedContacts,
  rejectIncomingOfferIfVisible,
  setAgentBusy,
  setAgentReady,
} from "./workspace.js";

export const AGENT_REPLY = "Thanks for waiting — I am here to help you now.";

export async function createSingleAgentTestContext(browser: Browser) {
  const agentContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const customerContext = await browser.newContext({
    viewport: { width: 480, height: 820 },
  });

  const agentPage = await agentContext.newPage();
  const customerPage = await customerContext.newPage();

  return {
    agentPage,
    customerPage,
    close: async () => {
      await customerContext.close();
      await agentContext.close();
    },
  };
}

export async function resetAgentForScenario(
  page: Page,
  presence: "ready" | "busy",
) {
  configureE2eOfferTimeoutOnce();
  cleanupWebchatTestState();
  await acknowledgeAllMissedContacts(page).catch(() => undefined);
  await rejectIncomingOfferIfVisible(page);
  await rejectIncomingOfferIfVisible(page);

  if (presence === "busy") {
    await setAgentBusy(page);
  } else {
    await setAgentReady(page);
  }
}
