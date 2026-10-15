import { expect, test, type Browser, type Page } from "@playwright/test";

import { AGENT_A_EMAIL, AGENT_B_EMAIL, AGENT_PASSWORD, openAgentWorkspace } from "./helpers/auth";

type SipPatch = {
  callState?: "idle" | "dialing" | "ringing" | "active";
  consultState?: "idle" | "dialing" | "ringing" | "active";
  consultExt?: string | null;
  consultName?: string | null;
  destination?: string | null;
  merged?: boolean;
  transferConsultRole?: "primary" | "secondary" | null;
  secondaryConsultOnly?: boolean;
  held?: boolean;
  consultHeld?: boolean;
  muted?: boolean;
};

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(AGENT_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const replace = page.getByRole("button", { name: "Replace session & sign in" });
  const signedIn = page
    .waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30_000 })
    .then(() => "in" as const)
    .catch(() => "timeout" as const);
  const needsReplace = replace
    .waitFor({ state: "visible", timeout: 30_000 })
    .then(() => "replace" as const)
    .catch(() => "timeout" as const);
  const result = await Promise.race([signedIn, needsReplace]);
  if (result === "replace") {
    await replace.click();
    await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30_000 });
  } else if (result === "timeout") {
    throw new Error(`Sign in did not leave the login page for ${email}`);
  }
  await openAgentWorkspace(page);
}

async function setSip(page: Page, patch: SipPatch) {
  const applied = await page.evaluate((next) => {
    const setter = (window as Window & { __worktualSetSipStatus?: (value: SipPatch) => void })
      .__worktualSetSipStatus;
    if (!setter) return false;
    setter(next);
    return true;
  }, patch);
  expect(applied).toBe(true);
}

async function logout(page: Page) {
  await page.getByRole("button", { name: "Logout" }).click();
  await page.waitForURL((url) => url.pathname.includes("/login"), { timeout: 20_000 });
}

const idleConsult: SipPatch = {
  callState: "idle",
  consultState: "idle",
  consultExt: null,
  consultName: null,
  destination: null,
  merged: false,
  transferConsultRole: null,
  secondaryConsultOnly: false,
  held: false,
  consultHeld: false,
  muted: false,
};

async function openAgent(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email);
  return { context, page };
}

test("both agents see the speaking banner, then log out", async ({ browser }) => {
  test.setTimeout(150_000);
  const agentA = await openAgent(browser, AGENT_A_EMAIL);
  const agentB = await openAgent(browser, AGENT_B_EMAIL);

  try {
    await setSip(agentA.page, {
      callState: "active",
      consultState: "active",
      consultName: "Test Agent Two",
      consultExt: "104",
      transferConsultRole: "primary",
      merged: false,
    });
    await setSip(agentB.page, {
      callState: "active",
      consultState: "idle",
      destination: "103",
      consultExt: "103",
      consultName: "103",
      transferConsultRole: "secondary",
      secondaryConsultOnly: true,
      merged: false,
    });

    await expect(agentA.page.getByText("Speaking with Test Agent Two")).toBeVisible();
    await expect(agentA.page.getByRole("button", { name: "Mute consult" })).toBeVisible();
    await expect(agentA.page.getByRole("button", { name: "Hold consult" })).toBeVisible();
    await expect(agentB.page.getByText("Speaking with 103")).toBeVisible();
    await expect(agentB.page.getByRole("button", { name: "Mute consult" })).toBeVisible();
    await expect(agentB.page.getByRole("button", { name: "Hold consult" })).toBeVisible();
  } finally {
    await setSip(agentA.page, idleConsult).catch(() => undefined);
    await setSip(agentB.page, idleConsult).catch(() => undefined);
    await logout(agentA.page).catch(() => undefined);
    await logout(agentB.page).catch(() => undefined);
    await agentA.context.close();
    await agentB.context.close();
  }
});
