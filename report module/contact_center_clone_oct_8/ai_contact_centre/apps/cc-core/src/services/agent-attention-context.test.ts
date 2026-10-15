import { describe, expect, it } from "vitest";

import { classifyAgentAttention } from "./agent-attention-context.js";

describe("classifyAgentAttention", () => {
  it("flags repeat escalation when threshold met", () => {
    const result = classifyAgentAttention({
      handled: 5,
      teamAvgHandled: 6,
      notReadyMinutes: 12,
      escalationsLast7Days: 3,
      activeConversations: 0,
      queueWaitingTotal: 0,
      presenceTodaySeconds: {},
      attendanceToday: "present",
    });
    expect(result.classification).toBe("repeat_escalation");
  });

  it("flags queue pressure when customers wait", () => {
    const result = classifyAgentAttention({
      handled: 8,
      teamAvgHandled: 7,
      notReadyMinutes: 15,
      escalationsLast7Days: 0,
      activeConversations: 0,
      queueWaitingTotal: 4,
      presenceTodaySeconds: {},
      attendanceToday: "present",
    });
    expect(result.classification).toBe("queue_pressure");
  });

  it("flags high activity not ready when above team pace", () => {
    const result = classifyAgentAttention({
      handled: 20,
      teamAvgHandled: 10,
      notReadyMinutes: 11,
      escalationsLast7Days: 0,
      activeConversations: 0,
      queueWaitingTotal: 0,
      presenceTodaySeconds: {},
      attendanceToday: "present",
    });
    expect(result.classification).toBe("high_activity_not_ready");
  });
});
