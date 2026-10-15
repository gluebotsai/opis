import type { Page } from "@playwright/test";

export const AGENT_EMAIL = process.env.PLAYWRIGHT_AGENT_EMAIL ?? "agent.test@worktual.local";
export const AGENT_PASSWORD = process.env.PLAYWRIGHT_AGENT_PASSWORD ?? "Worktual@123";

/** Primary test agent (Agent A) for multi-agent scenarios. */
export const AGENT_A_EMAIL =
  process.env.PLAYWRIGHT_AGENT_A_EMAIL ?? process.env.PLAYWRIGHT_AGENT_EMAIL ?? "agent.test@worktual.local";

/** Secondary test agent (Agent B) for multi-agent scenarios. */
export const AGENT_B_EMAIL = process.env.PLAYWRIGHT_AGENT_B_EMAIL ?? "agent2.test@worktual.local";

export async function loginWithCredentials(page: Page, email: string, password = AGENT_PASSWORD) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();

  const conflict = page.getByText(/already signed in/i);
  if (await conflict.isVisible({ timeout: 3_000 }).catch(() => false)) {
    throw new Error(`Login blocked for ${email}: account already signed in elsewhere`);
  }

  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30_000 });
}

export async function loginAsAgent(page: Page) {
  await loginWithCredentials(page, AGENT_EMAIL, AGENT_PASSWORD);
}

export async function loginAsAgentA(page: Page) {
  await loginWithCredentials(page, AGENT_A_EMAIL, AGENT_PASSWORD);
}

export async function loginAsAgentB(page: Page) {
  await loginWithCredentials(page, AGENT_B_EMAIL, AGENT_PASSWORD);
}

export async function openAgentWorkspace(page: Page) {
  await page.goto("/agent/workspace");
  await page.getByRole("heading", { name: "Inbox" }).waitFor({ state: "visible" });
}
