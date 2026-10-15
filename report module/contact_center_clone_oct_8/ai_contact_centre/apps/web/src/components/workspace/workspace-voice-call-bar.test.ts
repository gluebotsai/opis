import { describe, expect, it } from "vitest";

import { formatLiveCallDuration } from "./workspace-voice-call-bar.js";

describe("formatLiveCallDuration", () => {
  it("formats accepted-to-BYE duration for the call panel", () => {
    expect(formatLiveCallDuration(0)).toBe("00:00");
    expect(formatLiveCallDuration(24.9)).toBe("00:24");
    expect(formatLiveCallDuration(125)).toBe("02:05");
    expect(formatLiveCallDuration(3_661)).toBe("01:01:01");
  });
});
