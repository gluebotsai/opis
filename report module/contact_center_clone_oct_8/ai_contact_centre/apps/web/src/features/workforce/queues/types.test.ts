import assert from "node:assert/strict";
import test from "node:test";

import { emptyQueueAgent, queueAgentProfile, queueDisplayShiftTypes } from "./types.ts";

test("queueAgentProfile prefers eligible list, then names saved on the queue row", () => {
  const agent = {
    ...emptyQueueAgent("1000", "Evening"),
    firstName: "Yaswanth",
    lastName: "M",
    workEmail: "yaswanthmg1@gmail.com",
  };

  const fromRow = queueAgentProfile(agent, {});
  assert.equal(fromRow?.firstName, "Yaswanth");
  assert.equal(fromRow?.workEmail, "yaswanthmg1@gmail.com");

  const listed = queueAgentProfile(agent, {
    "1000": {
      id: "1000",
      firstName: "Agent",
      lastName: "Test",
      workEmail: "agent.test@worktual.local",
      teamId: null,
      skill: null,
      skills: [],
      status: "active",
      businessHoursId: null,
      shiftTypes: [],
    },
  });
  assert.equal(listed?.workEmail, "agent.test@worktual.local");
  assert.equal(queueAgentProfile(emptyQueueAgent("1000", "Evening"), {}), undefined);
});

test("queueDisplayShiftTypes lists hours-template shifts even when unstaffed", () => {
  assert.deepEqual(
    queueDisplayShiftTypes([
      { shiftType: "Morning" },
      { shiftType: "Night" },
      { shiftType: "Morning" },
    ]),
    ["Morning", "Night"],
  );
  assert.deepEqual(queueDisplayShiftTypes([]), []);
});
