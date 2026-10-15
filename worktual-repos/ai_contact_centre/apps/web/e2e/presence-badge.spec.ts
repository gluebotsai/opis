import { expect, test, type Page } from "@playwright/test";

import { AGENT_EMAIL, AGENT_PASSWORD, openAgentWorkspace } from "./helpers/auth";

test.use({ channel: "chrome", video: "off", trace: "off" });

const PRESENCE_BUTTON = /Ready|Away|Busy|Not Ready|After contact work/i;

function labelForState(state: string): RegExp {
  switch (state) {
    case "ready":
      return /^Ready$/i;
    case "not_ready":
      return /Not Ready/i;
    case "busy":
      return /Busy/i;
    case "away":
      return /Away/i;
    case "after_contact_work":
      return /After contact work/i;
    default:
      return new RegExp(state, "i");
  }
}

async function signIn(page: Page) {
  await page.goto("/login");
  await page.locator("#email").fill(AGENT_EMAIL);
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
    throw new Error("Sign in did not leave the login page");
  }
  await openAgentWorkspace(page);
}

async function storedPresenceState(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const raw = localStorage.getItem("cc2_auth_user");
    if (!raw) throw new Error("No signed-in session");
    const auth = JSON.parse(raw) as { token?: string };
    if (!auth.token) throw new Error("No signed-in session");
    const response = await fetch("http://localhost:3000/cc-core-api/v1/workspace/presence", {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    if (!response.ok) throw new Error(`Presence read failed (${response.status})`);
    const body = (await response.json()) as { presence?: { state?: string } };
    if (!body.presence?.state) throw new Error("Presence response did not include a stored state");
    return body.presence.state;
  });
}

test("presence badge matches the stored presence row", async ({ page }) => {
  await signIn(page);
  const presenceButton = page.getByRole("button", { name: PRESENCE_BUTTON }).first();
  await expect(presenceButton).toBeVisible();
  await expect
    .poll(async () => {
      const stored = await storedPresenceState(page);
      const text = (await presenceButton.innerText()).trim();
      const matches = stored === "ready" ? /^\s*Ready\s*$/i.test(text) : labelForState(stored).test(text);
      return matches ? "match" : `${text} vs ${stored}`;
    }, { timeout: 15_000 })
    .toBe("match");
  const stored = await storedPresenceState(page);

  const stay = page.getByRole("button", { name: "Stay Not Ready" });
  if (await stay.isVisible().catch(() => false)) {
    await stay.click();
  }

  const nextLabel = stored === "not_ready" ? "Ready" : "Not Ready";
  const patch = page.waitForResponse(
    (response) =>
      response.url().includes("/workspace/presence") &&
      response.request().method() === "PATCH" &&
      response.ok(),
  );
  await presenceButton.click();
  await page.getByRole("menuitem", { name: nextLabel, exact: true }).click();
  const patchResponse = await patch;
  const patched = await patchResponse.json().then((body: { presence?: { state?: string } }) => {
    if (!body.presence?.state) throw new Error("Presence update did not include a stored state");
    return body.presence.state;
  });
  await expect(presenceButton).toContainText(labelForState(patched));
  await expect.poll(() => storedPresenceState(page)).toBe(patched);

  if (patched !== "ready") {
    const restore = page.waitForResponse(
      (response) =>
        response.url().includes("/workspace/presence") &&
        response.request().method() === "PATCH" &&
        response.ok(),
    );
    await presenceButton.click();
    await page.getByRole("menuitem", { name: "Ready", exact: true }).click();
    const restored = await (await restore).json().then((body: { presence?: { state?: string } }) => {
      if (!body.presence?.state) throw new Error("Presence update did not include a stored state");
      return body.presence.state;
    });
    await expect(presenceButton).toContainText(labelForState(restored));
    await expect.poll(() => storedPresenceState(page)).toBe(restored);
  }
});
