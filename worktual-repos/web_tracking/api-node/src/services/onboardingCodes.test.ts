import { describe, expect, it } from "vitest";
import {
  consumeOnboardingCode,
  generateOnboardingCode,
  storeOnboardingCode,
} from "./onboardingCodes.js";

describe("onboardingCodes (in-memory fallback)", () => {
  it("stores and consumes a code once", async () => {
    const code = generateOnboardingCode();
    const payload = { userId: 1, organizationId: 2, websiteId: 3 };

    await storeOnboardingCode(null, code, payload);
    const first = await consumeOnboardingCode(null, code);
    expect(first).toEqual(payload);

    const second = await consumeOnboardingCode(null, code);
    expect(second).toBeNull();
  });
});
