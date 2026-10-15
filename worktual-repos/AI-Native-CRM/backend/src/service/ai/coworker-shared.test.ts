import { describe, expect, it } from "vitest";
import {
  COWORKER_GENERIC_TURN_FAIL,
  COWORKER_TOOL_LOOP_FAIL,
  coworkerFailureSpeech,
} from "@/service/ai/coworker-shared";

describe("coworkerFailureSpeech", () => {
  it("prefers the human assistant text over an internal error", () => {
    expect(
      coworkerFailureSpeech({
        assistantText: "I couldn't load that from CRM analytics right now.",
        error: "No module named 'psycopg2'",
      }),
    ).toContain("CRM analytics");
  });

  it("does not show driver import errors", () => {
    expect(
      coworkerFailureSpeech({
        error: "No module named 'psycopg2'",
      }),
    ).toBe(COWORKER_GENERIC_TURN_FAIL);
  });

  it("maps tool-loop internals to a retry prompt", () => {
    expect(
      coworkerFailureSpeech({ error: "budget exhausted" }),
    ).toBe(COWORKER_TOOL_LOOP_FAIL);
  });
});
