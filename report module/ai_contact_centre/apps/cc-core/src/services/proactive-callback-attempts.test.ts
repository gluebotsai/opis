import { describe, expect, it } from "vitest";

import { dedupeProactiveAttemptsForSupervisorAlerts } from "./proactive-callback-attempts.js";

function attempt(
  overrides: Partial<{
    id: string;
    taskId: string | null;
    contactId: string | null;
    createdAt: string;
  }> = {},
) {
  return {
    id: "101",
    organizationId: "1",
    missedContactId: "201",
    queueId: null,
    conversationId: null,
    contactId: "301",
    status: "assigned" as const,
    taskId: "401",
    planJson: {},
    errorMessage: null,
    acknowledgedAt: null,
    createdAt: "2026-08-25T12:00:00.000Z",
    updatedAt: "2026-08-25T12:00:00.000Z",
    customerName: "Santhosh",
    channel: "whatsapp",
    assignedAgentName: "Test Agent",
    ...overrides,
  };
}

describe("dedupeProactiveAttemptsForSupervisorAlerts", () => {
  it("keeps one alert when two misses share the same callback task", () => {
    const deduped = dedupeProactiveAttemptsForSupervisorAlerts([
      attempt({ id: "102", missedContactId: "202", createdAt: "2026-08-25T12:10:00.000Z" }),
      attempt({ id: "101", missedContactId: "201", createdAt: "2026-08-25T12:00:00.000Z" }),
    ]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.id).toBe("102");
  });

  it("keeps separate alerts for different callback tasks", () => {
    const deduped = dedupeProactiveAttemptsForSupervisorAlerts([
      attempt({ id: "101", taskId: "401" }),
      attempt({ id: "102", taskId: "402", missedContactId: "202" }),
    ]);
    expect(deduped).toHaveLength(2);
  });
});
