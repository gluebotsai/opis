import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatActivityDuration,
  formatActivityOutcome,
} from "./activity-outcome.ts";

describe("formatActivityOutcome", () => {
  it("prefers disposition over end reason", () => {
    assert.equal(
      formatActivityOutcome({
        dispositionCode: "resolved",
        endReason: "offer_timeout",
      }),
      "Resolved",
    );
  });

  it("maps routing codes from extracted facts", () => {
    assert.equal(
      formatActivityOutcome({
        status: "active",
        botMemory: {
          extractedFacts: ["live_agent_unavailable", "offer_timeout", "no_ready_agents", "bot_continue"],
        },
      }),
      "Missed offer",
    );
  });

  it("maps no agents available", () => {
    assert.equal(
      formatActivityOutcome({
        endReason: "no_ready_agents",
      }),
      "No agents available",
    );
  });
});

describe("formatActivityDuration", () => {
  it("returns Open for live chats", () => {
    assert.equal(
      formatActivityDuration({
        status: "active",
        createdAt: "2026-08-21T10:00:00.000Z",
      }),
      "Open",
    );
  });

  it("formats closed duration in minutes", () => {
    assert.equal(
      formatActivityDuration({
        status: "resolved",
        createdAt: "2026-08-21T10:00:00.000Z",
        endedAt: "2026-08-21T10:04:00.000Z",
      }),
      "4m",
    );
  });
});
