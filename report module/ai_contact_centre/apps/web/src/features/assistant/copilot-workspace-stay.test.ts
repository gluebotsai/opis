import { describe, expect, it } from "vitest";

import {
  isWorkspaceCopilotPath,
  workspaceConversationIdFromPath,
} from "./copilot-workspace-stay";

describe("workspace co-worker stay", () => {
  it("treats agent and admin workspace as in-place surfaces", () => {
    expect(isWorkspaceCopilotPath("/agent/workspace")).toBe(true);
    expect(isWorkspaceCopilotPath("/admin/workspace?tab=open")).toBe(true);
    expect(isWorkspaceCopilotPath("/admin/contacts")).toBe(false);
    expect(isWorkspaceCopilotPath("/admin/workforce/queues?create=1")).toBe(false);
  });

  it("reads a conversation id only from a workspace path", () => {
    expect(
      workspaceConversationIdFromPath("/agent/workspace?conversationId=conversation-1"),
    ).toBe("conversation-1");
    expect(
      workspaceConversationIdFromPath("/admin/workspace?conversationId=42"),
    ).toBe("42");
    expect(workspaceConversationIdFromPath("/agent/tasks?task=1")).toBeNull();
    expect(workspaceConversationIdFromPath("/agent/workspace")).toBeNull();
  });
});
