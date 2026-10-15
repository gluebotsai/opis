import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Browser, Page } from "@playwright/test";

import { loginAsAgentA, loginAsAgentB, openAgentWorkspace } from "./auth.js";
import { configureE2eOfferTimeoutOnce } from "./cleanup.js";
import { AGENT_REPLY } from "./single-agent-webchat.js";
import {
  acknowledgeAllMissedContacts,
  prepareAgentForWebchatTest,
  rejectIncomingOfferIfVisible,
  setAgentBusy,
  setAgentReady,
} from "./workspace.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

export { AGENT_REPLY };

export function ensureTwoAgentsOnWebchatQueue(): void {
  try {
    execSync("npx tsx apps/cc-core/scripts/ensure-webchat-two-agents.ts --live", {
      cwd: repoRoot,
      stdio: "pipe",
    });
  } catch {
    execSync("npx tsx apps/cc-core/scripts/seed-e2e-support-setup.ts", {
      cwd: repoRoot,
      stdio: "pipe",
    });
    execSync("npx tsx apps/cc-core/scripts/ensure-webchat-two-agents.ts --live", {
      cwd: repoRoot,
      stdio: "pipe",
    });
  }
}

export type TwoAgentPages = {
  agentAPage: Page;
  agentBPage: Page;
};

export async function createTwoAgentTestContext(browser: Browser) {
  const agentAContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const agentBContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const customerContext = await browser.newContext({
    viewport: { width: 480, height: 820 },
  });

  const agentAPage = await agentAContext.newPage();
  const agentBPage = await agentBContext.newPage();

  return {
    agentAPage,
    agentBPage,
    createCustomerPage: async () => customerContext.newPage(),
    close: async () => {
      await customerContext.close();
      await agentBContext.close();
      await agentAContext.close();
    },
  };
}

export async function createTwoAgentDualCustomerContext(browser: Browser) {
  const agentAContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const agentBContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const customer1Context = await browser.newContext({
    viewport: { width: 480, height: 820 },
  });
  const customer2Context = await browser.newContext({
    viewport: { width: 480, height: 820 },
  });

  const agentAPage = await agentAContext.newPage();
  const agentBPage = await agentBContext.newPage();
  const customer1Page = await customer1Context.newPage();
  const customer2Page = await customer2Context.newPage();

  return {
    agentAPage,
    agentBPage,
    customer1Page,
    customer2Page,
    close: async () => {
      await customer2Context.close();
      await customer1Context.close();
      await agentBContext.close();
      await agentAContext.close();
    },
  };
}

export async function loginBothAgentsAndOpenWorkspace(agentAPage: Page, agentBPage: Page) {
  await Promise.all([loginAsAgentA(agentAPage), loginAsAgentB(agentBPage)]);
  await Promise.all([openAgentWorkspace(agentAPage), openAgentWorkspace(agentBPage)]);
}

export async function prepareBothAgentsForWebchatTest(agentAPage: Page, agentBPage: Page) {
  await prepareAgentForWebchatTest(agentAPage);
  await prepareAgentForWebchatTest(agentBPage);
}

export function prepareTwoAgentWebchatSuite(): void {
  configureE2eOfferTimeoutOnce();
  ensureTwoAgentsOnWebchatQueue();
}

export async function setBothAgentsBusy(agentAPage: Page, agentBPage: Page) {
  await acknowledgeAllMissedContacts(agentAPage).catch(() => undefined);
  await acknowledgeAllMissedContacts(agentBPage).catch(() => undefined);
  await rejectIncomingOfferIfVisible(agentAPage);
  await rejectIncomingOfferIfVisible(agentBPage);
  await setAgentBusy(agentAPage);
  await setAgentBusy(agentBPage);
}

export async function resetBothAgentsReady(agentAPage: Page, agentBPage: Page) {
  await setAgentReady(agentAPage);
  await setAgentReady(agentBPage);
}

export async function agentHasIncomingOffer(page: Page): Promise<boolean> {
  return page
    .getByRole("button", { name: "Accept", exact: true })
    .first()
    .isVisible()
    .catch(() => false);
}

export type AgentSlot = "a" | "b";

export async function findAgentWithOffer(
  agentAPage: Page,
  agentBPage: Page,
): Promise<AgentSlot | null> {
  const [aHasOffer, bHasOffer] = await Promise.all([
    agentHasIncomingOffer(agentAPage),
    agentHasIncomingOffer(agentBPage),
  ]);
  if (aHasOffer && !bHasOffer) return "a";
  if (bHasOffer && !aHasOffer) return "b";
  if (aHasOffer && bHasOffer) return "a";
  return null;
}

export function agentPageForSlot(pages: TwoAgentPages, slot: AgentSlot): Page {
  return slot === "a" ? pages.agentAPage : pages.agentBPage;
}

export function otherAgentSlot(slot: AgentSlot): AgentSlot {
  return slot === "a" ? "b" : "a";
}
