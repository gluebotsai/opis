import { describe, expect, it } from "vitest";

import type { AgentAttentionContextPacket } from "./agent-attention-context.js";
import { buildRuleBasedAgentAttentionInsight } from "./agent-attention-insight.js";

function sampleContext(
  overrides: Partial<AgentAttentionContextPacket> = {},
): AgentAttentionContextPacket {
  return {
    agentId: "1",
    agentName: "Alex Rivera",
    teamName: "Support",
    queueNames: ["General"],
    presence: "not_ready",
    notReadyMinutes: 12,
    activeConversations: 0,
    reservedConversations: 0,
    attendanceToday: "present",
    todayKpis: {
      handled: 18,
      teamAvgHandled: 10,
      handledVsTeam: "above",
      resolutionRate: 92,
      slaRate: 88,
      avgHandleSeconds: 240,
      transferred: 1,
    },
    presenceTodaySeconds: { not_ready: 1800 },
    escalationsLast7Days: 0,
    queueWaitingTotal: 0,
    offersRingingOrg: null,
    classification: "high_activity_not_ready",
    classificationReasons: ["Handled 18 today vs team avg 10"],
    escalatedAt: "2026-08-25T12:00:00.000Z",
    ...overrides,
  };
}

describe("buildRuleBasedAgentAttentionInsight", () => {
  it("returns a summary and suggestion for high-activity not ready", () => {
    const result = buildRuleBasedAgentAttentionInsight(sampleContext());
    expect(result.summary).toContain("Alex Rivera");
    expect(result.summary).toContain("18 handled today");
    expect(result.suggestion.length).toBeGreaterThan(20);
  });
});
