import { expect, type Page } from "@playwright/test";

export async function rejectIncomingOfferIfVisible(page: Page) {
  const decline = page.getByRole("button", { name: "Reject", exact: true });
  if (await decline.isVisible().catch(() => false)) {
    await decline.click();
    await page.waitForTimeout(500);
  }
}

export async function prepareAgentForWebchatTest(page: Page) {
  await setAgentReady(page);
  await acknowledgeAllMissedContacts(page).catch(() => undefined);
  await rejectIncomingOfferIfVisible(page);
  await rejectIncomingOfferIfVisible(page);
  const presenceButton = page
    .getByRole("button", { name: /Ready|Away|Busy|Not Ready|After contact work/i })
    .first();
  await expect(presenceButton).toContainText(/Ready/i, { timeout: 10_000 });
}

export async function setAgentPresence(page: Page, label: "Ready" | "Away" | "Busy" | "Not Ready") {
  const presenceButton = page.getByRole("button", { name: /Ready|Away|Busy|Not Ready|After contact work/i }).first();
  await presenceButton.click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
  await expect(presenceButton).toContainText(new RegExp(label === "Ready" ? "Ready" : label, "i"), {
    timeout: 10_000,
  });
}

export async function setAgentReady(page: Page) {
  await setAgentPresence(page, "Ready");
}

export async function setAgentBusy(page: Page) {
  await setAgentPresence(page, "Busy");
}

export async function rejectIncomingOffer(page: Page, options: { timeout?: number } = {}) {
  const timeout = options.timeout ?? 90_000;
  const decline = page.getByRole("button", { name: "Reject", exact: true });
  await expect(decline).toBeVisible({ timeout });
  const rejectResponse = page.waitForResponse(
    (response) => response.url().includes("/reject") && response.ok(),
    { timeout },
  );
  await decline.click();
  await rejectResponse;
  await expectIncomingOfferHidden(page, 30_000);
}

export async function waitForIncomingOffer(page: Page, options: { timeout?: number } = {}) {
  const acceptButton = page.getByRole("button", { name: "Accept", exact: true }).first();
  await expect(acceptButton).toBeVisible({ timeout: options.timeout ?? 90_000 });
  return acceptButton;
}

export async function acceptIncomingOffer(page: Page) {
  const acceptButton = await waitForIncomingOffer(page);
  await acceptButton.click();
}

export async function expectIncomingOfferHidden(page: Page, timeout = 15_000) {
  await expect(page.getByRole("button", { name: "Accept", exact: true })).toHaveCount(0, {
    timeout,
  });
}

export async function getMissedContactCount(page: Page): Promise<number> {
  const bell = page.getByRole("button", { name: "Missed contacts" });
  await expect(bell).toBeVisible();
  const badge = bell.locator("span.bg-red-500");
  if ((await badge.count()) === 0) return 0;
  const text = (await badge.textContent())?.trim() ?? "0";
  if (text === "9+") return 9;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function acknowledgeAllMissedContacts(page: Page) {
  const bell = page.getByRole("button", { name: "Missed contacts" });
  await bell.click();
  const markAll = page.getByRole("button", { name: "Mark all read" });
  if (await markAll.isVisible().catch(() => false)) {
    await markAll.click();
  } else {
    await page.keyboard.press("Escape");
  }
  await expect(bell.locator("span.bg-red-500")).toHaveCount(0, { timeout: 10_000 });
}

export async function expectMissedContactCount(page: Page, count: number) {
  const bell = page.getByRole("button", { name: "Missed contacts" });
  await expect(bell).toBeVisible();
  if (count <= 0) {
    await expect(bell.locator("span.bg-red-500")).toHaveCount(0);
    return;
  }
  const badge = bell.locator("span.bg-red-500");
  await expect(badge).toBeVisible({ timeout: 15_000 });
  const expected = count > 9 ? "9+" : String(count);
  await expect(badge).toHaveText(expected);
}

export async function expectMissedContactCountAtLeast(page: Page, count: number) {
  await expect
    .poll(async () => getMissedContactCount(page), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(count);
}

export async function fillAndSubmitDisposition(page: Page) {
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

  await dialog.getByLabel(/Summary/i).fill("E2E: bot reply, handoff, timeout, accept, and end.");

  await dialog.getByRole("button", { name: "End conversation" }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
}
