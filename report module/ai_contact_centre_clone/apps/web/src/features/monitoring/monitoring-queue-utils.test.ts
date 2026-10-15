import assert from "node:assert/strict";
import test from "node:test";

import {
  missedFollowUpDisplayLabel,
  matchesMissedStatusFilter,
  resolveMissedFollowUpStatus,
  resolveMissedGroupCallback,
} from "./monitoring-queue-utils.js";

test("resolveMissedFollowUpStatus maps completed admin callbacks to supervisor assigned", () => {
  const status = resolveMissedFollowUpStatus({
    connectedAfterMiss: false,
    callbackAssigned: true,
    callbackStatus: "completed",
    callbackAssignmentSource: "admin",
    channel: "whatsapp",
  });
  assert.equal(status, "callback_assigned");
});

test("resolveMissedFollowUpStatus maps completed coworker callbacks to coworker assigned", () => {
  const status = resolveMissedFollowUpStatus({
    connectedAfterMiss: false,
    callbackAssigned: true,
    callbackStatus: "completed",
    callbackAssignmentSource: "coworker",
    channel: "whatsapp",
  });
  assert.equal(status, "coworker_assigned");
});

test("resolveMissedFollowUpStatus shows agent reached for inbound reconnect after miss", () => {
  const status = resolveMissedFollowUpStatus({
    connectedAfterMiss: true,
    callbackAssigned: false,
    callbackStatus: null,
    channel: "whatsapp",
  });
  assert.equal(status, "connected");
});

test("resolveMissedFollowUpStatus shows supervisor assigned while callback task is open", () => {
  const status = resolveMissedFollowUpStatus({
    connectedAfterMiss: false,
    callbackAssigned: true,
    callbackStatus: "open",
    callbackAssignmentSource: "admin",
    channel: "whatsapp",
  });
  assert.equal(status, "callback_assigned");
});

test("missedFollowUpDisplayLabel shows assignment source labels", () => {
  assert.equal(
    missedFollowUpDisplayLabel({
      connectedAfterMiss: false,
      callbackAssigned: true,
      callbackStatus: "completed",
      callbackAssignmentSource: "coworker",
      channel: "whatsapp",
    }),
    "Coworker assigned",
  );
  assert.equal(
    missedFollowUpDisplayLabel({
      connectedAfterMiss: false,
      callbackAssigned: true,
      callbackStatus: "completed",
      callbackAssignmentSource: "admin",
      channel: "whatsapp",
    }),
    "Supervisor assigned",
  );
});

test("matchesMissedStatusFilter separates coworker and supervisor assignments", () => {
  const coworker = {
    connectedAfterMiss: false,
    callbackAssigned: true,
    callbackStatus: "completed" as const,
    callbackAssignmentSource: "coworker" as const,
    channel: "whatsapp" as const,
  };
  const supervisor = {
    connectedAfterMiss: false,
    callbackAssigned: true,
    callbackStatus: "open" as const,
    callbackAssignmentSource: "admin" as const,
    channel: "whatsapp" as const,
  };

  assert.equal(matchesMissedStatusFilter(coworker, "coworker_assigned"), true);
  assert.equal(matchesMissedStatusFilter(coworker, "callback_assigned"), false);
  assert.equal(matchesMissedStatusFilter(supervisor, "callback_assigned"), true);
  assert.equal(matchesMissedStatusFilter(supervisor, "coworker_assigned"), false);
});

test("resolveMissedGroupCallback prefers supervisor assignment across attempts", () => {
  const resolved = resolveMissedGroupCallback([
    {
      id: "1",
      customer: "Bharathi",
      channel: "whatsapp",
      queue: "support",
      occurredAt: "2026-08-20T12:00:00.000Z",
      waitSeconds: 10,
      reason: "abandoned_chat",
      priority: "normal",
      callbackAssigned: true,
      callbackAssignedAgentName: "Agent A",
      callbackTaskId: "10",
      callbackStatus: "completed",
      callbackAssignmentSource: "coworker",
      connectedAfterMiss: false,
      connectedAt: null,
      connectedAgentName: null,
    },
    {
      id: "2",
      customer: "Bharathi",
      channel: "whatsapp",
      queue: "support",
      occurredAt: "2026-08-20T13:00:00.000Z",
      waitSeconds: 12,
      reason: "abandoned_chat",
      priority: "normal",
      callbackAssigned: true,
      callbackAssignedAgentName: "Agent B",
      callbackTaskId: "11",
      callbackStatus: "open",
      callbackAssignmentSource: "admin",
      connectedAfterMiss: false,
      connectedAt: null,
      connectedAgentName: null,
    },
  ]);

  assert.equal(resolved.callbackAssignmentSource, "admin");
  assert.equal(resolved.callbackStatus, "open");
});
