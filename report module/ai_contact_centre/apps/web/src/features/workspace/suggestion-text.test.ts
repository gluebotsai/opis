import { describe, expect, it } from "vitest";

import { extractCustomerFacingSuggestion } from "./suggestion-text";

describe("extractCustomerFacingSuggestion", () => {
  it("returns plain replies unchanged", () => {
    const reply = "Thanks, Henry! How can I help you today?";
    expect(extractCustomerFacingSuggestion(reply)).toBe(reply);
  });

  it("strips coach-the-agent blocks and keeps the labeled suggestion", () => {
    const raw = [
      "Coach the agent:",
      "The system requires customer confirmation to update the email from henry123@gmail.com to henry122@gmail.com.",
      "",
      "Suggested reply for the agent to review and send:",
      "Thanks, Henry! I just want to confirm — our records currently show henry123@gmail.com. Did you mean to update it to henry122@gmail.com?",
    ].join("\n");

    expect(extractCustomerFacingSuggestion(raw)).toBe(
      "Thanks, Henry! I just want to confirm — our records currently show henry123@gmail.com. Did you mean to update it to henry122@gmail.com?",
    );
  });

  it("removes a leading coach block when no suggestion label is present", () => {
    const raw = [
      "Coach the agent: Confirm the email mismatch before updating.",
      "",
      "Thanks, Henry! Which email should we use on your account?",
    ].join("\n");

    expect(extractCustomerFacingSuggestion(raw)).toBe(
      "Thanks, Henry! Which email should we use on your account?",
    );
  });
});
