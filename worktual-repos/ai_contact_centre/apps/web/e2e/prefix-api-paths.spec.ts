import { expect, test } from "@playwright/test";

import { loginAsAgent, openAgentWorkspace } from "./helpers/auth";

const PREFIX_PATTERNS = [
  /\/cc-core-api\/v1\//,
  /\/platform-api\/v1\//,
];

const LEGACY_API_V1 = /\/api\/v1\//;

test.describe("Prefix API paths E2E", () => {
  test("frontend calls service-prefixed /v1 paths, not legacy /api/v1", async ({ page }) => {
    const trackedUrls: string[] = [];

    page.on("request", (request) => {
      const url = request.url();
      if (/localhost:(3000|3001|8000)/.test(url)) {
        trackedUrls.push(url);
      }
    });

    await loginAsAgent(page);
    await openAgentWorkspace(page);
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible({ timeout: 20_000 });

    const ccCoreCalls = trackedUrls.filter((url) => url.includes("localhost:3000"));
    const platformCalls = trackedUrls.filter((url) => url.includes("localhost:3001"));

    expect(
      ccCoreCalls.some((url) => url.includes("/cc-core-api/v1/auth/login")),
      `login should use /cc-core-api/v1/auth/login; got: ${ccCoreCalls.join(", ") || "(none)"}`,
    ).toBe(true);

    expect(
      ccCoreCalls.some((url) => url.includes("/cc-core-api/v1/workspace")),
      `workspace should use /cc-core-api/v1/workspace; got: ${ccCoreCalls.join(", ") || "(none)"}`,
    ).toBe(true);

    for (const url of ccCoreCalls) {
      expect(LEGACY_API_V1.test(url), `legacy /api/v1 leak on cc-core: ${url}`).toBe(false);
    }

    for (const url of platformCalls) {
      expect(url).toMatch(/\/platform-api\/v1\//);
      expect(LEGACY_API_V1.test(url), `legacy /api/v1 leak on platform: ${url}`).toBe(false);
    }

    expect(
      PREFIX_PATTERNS.some((pattern) => trackedUrls.some((url) => pattern.test(url))),
      `expected prefixed API calls; tracked: ${trackedUrls.join("\n")}`,
    ).toBe(true);
  });
});
