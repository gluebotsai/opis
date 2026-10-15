import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";
const isCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  timeout: isCi ? 120_000 : 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: isCi ? "on" : "retain-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: "smoke",
      testMatch: ["workspace.spec.ts"],
    },
    {
      name: "full",
      testMatch: ["**/*.spec.ts"],
      testIgnore: [],
    },
  ],
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : {
        command: "npm run dev",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
