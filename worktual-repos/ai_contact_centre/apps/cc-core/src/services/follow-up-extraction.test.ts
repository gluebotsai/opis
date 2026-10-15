import { describe, expect, it } from "vitest";

import { normalizeFollowUpExtraction } from "./follow-up-extraction.js";

describe("normalizeFollowUpExtraction", () => {
  it("returns no follow-up when has_follow_up is false", () => {
    const result = normalizeFollowUpExtraction({
      has_follow_up: false,
      title: "Ignored",
      summary: "Ignored",
    });
    expect(result).toEqual({
      hasFollowUp: false,
      title: "",
      summary: "",
      notes: null,
      dueAt: null,
    });
  });

  it("normalizes a valid follow-up payload", () => {
    const result = normalizeFollowUpExtraction({
      has_follow_up: true,
      title: "Confirm pricing tomorrow",
      summary: "Customer asked the agent to confirm pricing tomorrow morning.",
      notes: 'Customer: "Can you confirm this tomorrow?"',
      due_at: "2026-08-27T09:00:00.000Z",
    });
    expect(result).toEqual({
      hasFollowUp: true,
      title: "Confirm pricing tomorrow",
      summary: "Customer asked the agent to confirm pricing tomorrow morning.",
      notes: 'Customer: "Can you confirm this tomorrow?"',
      dueAt: "2026-08-27T09:00:00.000Z",
    });
  });

  it("rejects follow-up payloads missing title or summary", () => {
    expect(
      normalizeFollowUpExtraction({
        has_follow_up: true,
        title: "",
        summary: "Missing title",
      }),
    ).toBeNull();
  });

  it("ignores invalid due_at values", () => {
    const result = normalizeFollowUpExtraction({
      has_follow_up: true,
      title: "Call back",
      summary: "Agent promised to call back.",
      due_at: "not-a-date",
    });
    expect(result?.dueAt).toBeNull();
  });
});
