import assert from "node:assert/strict";
import test from "node:test";

import type { MonitoringSnapshot } from "./api.js";
import {
  applyLivePresenceUpdate,
  holdLiveAgentPresence,
  livePresenceHoldKey,
  preferNewerAgentPresence,
} from "./apply-live-presence.js";

function snapshot(): MonitoringSnapshot {
  return {
    generatedAt: "2026-10-09T00:00:00.000Z",
    summary: {
      waiting: 2,
      active: 1,
      botActive: 0,
      readyAgents: 1,
      loggedInAgents: 2,
      slaAtRisk: 0,
      slaBreached: 0,
      offersRinging: 0,
    },
    queues: [],
    agents: [
      {
        id: "user-a",
        agentId: "agent-a",
        name: "Test Agent",
        email: "a@example.com",
        workEmail: null,
        employeeId: "EMP-2000",
        firstName: "Test",
        lastName: "Agent",
        teamName: null,
        skills: [],
        shiftTypes: [],
        primaryLanguage: null,
        secondaryLanguage: null,
        location: null,
        accountStatus: null,
        agentStatus: "active",
        presenceUpdatedAt: "2026-10-09T00:00:00.000Z",
        presence: "ready",
        loggedIn: true,
        attendanceToday: "present",
        queueNames: ["support"],
        capacity: [],
        previousConversations: [],
      },
      {
        id: "user-b",
        agentId: "agent-b",
        name: "Test Agent Two",
        email: "b@example.com",
        workEmail: null,
        employeeId: "EMP-2001",
        firstName: "Test",
        lastName: "Two",
        teamName: null,
        skills: [],
        shiftTypes: [],
        primaryLanguage: null,
        secondaryLanguage: null,
        location: null,
        accountStatus: null,
        agentStatus: "active",
        presenceUpdatedAt: "2026-10-09T00:00:00.000Z",
        presence: "away",
        loggedIn: true,
        attendanceToday: "present",
        queueNames: [],
        capacity: [],
        previousConversations: [],
      },
    ],
    conversations: [
      {
        id: "conv-1",
        channel: "voice",
        status: "active",
        subject: null,
        visitorId: null,
        contactId: null,
        customerName: "Customer",
        queueId: null,
        queueName: "support",
        assignedAgentId: "agent-a",
        assignedAgentName: "Test Agent",
        waitSeconds: null,
        activeSeconds: 10,
        createdAt: "2026-10-09T00:00:00.000Z",
        priority: 0,
        slaStatus: "ok",
      },
    ],
    waiting: [],
    missed: [],
    callbacks: [],
    alerts: [],
  } as MonitoringSnapshot;
}

test("presence event updates only the matching agent badge", () => {
  const next = applyLivePresenceUpdate(snapshot(), {
    userId: "user-a",
    presence: {
      agentId: "agent-a",
      state: "busy",
      updatedAt: "2026-10-09T00:00:05.000Z",
    },
  });
  assert.ok(next);
  assert.equal(next.agents[0]?.presence, "busy");
  assert.equal(next.agents[1]?.presence, "away");
  assert.equal(next.summary.readyAgents, 0);
  assert.equal(next.summary.waiting, 2);
  assert.equal(next.conversations[0]?.id, "conv-1");
});

test("a presence event replaces the badge even when the row timestamp is newer", () => {
  const current = snapshot();
  current.agents[0]!.presence = "busy";
  current.agents[0]!.presenceUpdatedAt = "2026-10-09T00:00:20.000Z";
  const next = applyLivePresenceUpdate(current, {
    userId: "user-a",
    presence: { agentId: "agent-a", state: "not_ready", updatedAt: "2026-10-09T00:00:10.000Z" },
  });
  assert.equal(next?.agents[0]?.presence, "not_ready");
});

test("a reload that still says busy does not hide Not Ready", () => {
  const current = snapshot();
  current.agents[0]!.presence = "busy";
  const live = new Map([
    [livePresenceHoldKey("agent", "agent-a"), { state: "not_ready", at: Date.now() }],
  ]);
  const merged = holdLiveAgentPresence(current, live);
  assert.equal(merged.agents[0]?.presence, "not_ready");
  assert.equal(merged.agents[1]?.presence, "away");
  assert.equal(merged.summary.readyAgents, 0);
});

test("a setup user id does not change a different agent with the same number", () => {
  const current = snapshot();
  current.agents[0]!.id = "1003";
  current.agents[0]!.agentId = "1000";
  current.agents[0]!.presence = "ready";
  current.agents[1]!.id = "1001";
  current.agents[1]!.agentId = "1003";
  current.agents[1]!.presence = "not_ready";
  const next = applyLivePresenceUpdate(current, {
    userId: "1003",
    presence: { agentId: "1000", state: "away", updatedAt: "2026-10-09T00:00:10.000Z" },
  });
  assert.equal(next?.agents[0]?.presence, "away");
  assert.equal(next?.agents[1]?.presence, "not_ready");

  const live = new Map([
    [livePresenceHoldKey("agent", "1000"), { state: "away", at: Date.parse("2026-10-09T00:00:10.000Z") }],
    [livePresenceHoldKey("user", "1003"), { state: "away", at: Date.parse("2026-10-09T00:00:10.000Z") }],
  ]);
  const reloaded = snapshot();
  reloaded.agents[0]!.id = "1003";
  reloaded.agents[0]!.agentId = "1000";
  reloaded.agents[0]!.presence = "ready";
  reloaded.agents[1]!.id = "1001";
  reloaded.agents[1]!.agentId = "1003";
  reloaded.agents[1]!.presence = "not_ready";
  const merged = holdLiveAgentPresence(reloaded, live);
  assert.equal(merged.agents[0]?.presence, "away");
  assert.equal(merged.agents[1]?.presence, "not_ready");
});

test("a later snapshot does not hide a newer presence event", () => {
  const live = applyLivePresenceUpdate(snapshot(), {
    userId: "user-a",
    presence: { agentId: "agent-a", state: "not_ready", updatedAt: "2026-10-09T00:00:10.000Z" },
  });
  assert.ok(live);
  const stale = snapshot();
  const merged = preferNewerAgentPresence(live, stale);
  assert.equal(merged.agents[0]?.presence, "not_ready");
  assert.equal(merged.agents[1]?.presence, "away");
  assert.equal(merged.summary.readyAgents, 0);
});
