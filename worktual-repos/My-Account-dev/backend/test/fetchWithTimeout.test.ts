import { describe, expect, it } from "vitest";

import { withTimeout } from "../src/modules/payments/fetchWithTimeout.js";

describe("withTimeout", () => {
  it("resolves when the promise finishes before the deadline", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 200, "Fast")).resolves.toBe("ok");
  });

  it("rejects with a timeout message when the deadline elapses", async () => {
    await expect(
      withTimeout(new Promise(() => {}), 30, "Payment link creation"),
    ).rejects.toThrow(/Payment link creation timed out after 0s|Payment link creation timed out after 1s/);
  });
});
