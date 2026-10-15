import assert from "node:assert/strict";
import test from "node:test";

import { mintOnboardingLinkSchema } from "./onboarding-dashboard.js";

test("mint schema requires email or userId", () => {
  assert.equal(mintOnboardingLinkSchema.safeParse({}).success, false);
  assert.equal(mintOnboardingLinkSchema.safeParse({ email: "user@company.com" }).success, true);
  assert.equal(mintOnboardingLinkSchema.safeParse({ userId: "123" }).success, true);
  assert.equal(mintOnboardingLinkSchema.safeParse({ email: "not-an-email" }).success, false);
});
