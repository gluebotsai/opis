import { describe, expect, it } from "vitest";

import { findLiveAgentHandoffMessageId } from "./live-agent-handoff";
import type { WorkspaceMessage } from "./types";

function line(
  id: string,
  role: WorkspaceMessage["role"],
  sentAt: string,
  transcriptPhase?: WorkspaceMessage["transcriptPhase"],
): WorkspaceMessage {
  return { id, role, content: id, sentAt, transcriptPhase };
}

describe("findLiveAgentHandoffMessageId", () => {
  it("marks the first customer line after the bot when the flags say live agent", () => {
    const id = findLiveAgentHandoffMessageId([
      line("1", "customer", "2026-10-03T11:10:38Z", "bot"),
      line("2", "bot", "2026-10-03T11:10:38Z", "bot"),
      line("3", "customer", "2026-10-03T11:11:32Z", "live_agent"),
      line("4", "customer", "2026-10-03T11:11:38Z", "live_agent"),
    ]);
    expect(id).toBe("3");
  });

  it("keeps the divider on the first agent line when older rows have no flags", () => {
    const id = findLiveAgentHandoffMessageId([
      line("1", "customer", "2026-10-03T11:10:38Z"),
      line("2", "bot", "2026-10-03T11:10:38Z"),
      line("3", "agent", "2026-10-03T11:12:00Z"),
    ]);
    expect(id).toBe("3");
  });

  it("uses voice assignedAt when the agent never spoke and flags were not stored", () => {
    const id = findLiveAgentHandoffMessageId(
      [
        line("1", "customer", "2026-10-03T11:10:38Z"),
        line("2", "bot", "2026-10-03T11:10:48Z"),
        line("3", "customer", "2026-10-03T11:11:32Z"),
        line("4", "customer", "2026-10-03T11:11:38Z"),
      ],
      "2026-10-03T11:11:16Z",
    );
    expect(id).toBe("3");
  });

  it("still marks the agent line when bot lines are flagged and the agent line is not", () => {
    const id = findLiveAgentHandoffMessageId([
      line("1", "customer", "2026-10-03T11:45:57.113Z", "bot"),
      line("2", "bot", "2026-10-03T11:45:57.114Z", "bot"),
      line("3", "customer", "2026-10-03T11:46:11.438Z", "bot"),
      line("4", "bot", "2026-10-03T11:46:11.439Z", "bot"),
      line("5", "agent", "2026-10-03T11:46:25.931Z"),
      line("6", "customer", "2026-10-03T11:46:43.642Z"),
    ]);
    expect(id).toBe("5");
  });

  it("does not treat a missing flag as a live-agent line", () => {
    const id = findLiveAgentHandoffMessageId([
      line("1", "bot", "2026-10-03T11:10:38Z"),
      line("2", "customer", "2026-10-03T11:10:48Z"),
    ]);
    expect(id).toBeNull();
  });
});
