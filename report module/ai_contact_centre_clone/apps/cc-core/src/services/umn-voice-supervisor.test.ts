import assert from "node:assert/strict";
import test from "node:test";

import {
  SUPERVISOR_MONITOR_CANCEL,
  SUPERVISOR_MONITOR_LISTEN,
  supervisorMonitorPublishBody,
} from "./umn-voice-supervisor.js";

const sessionId = "+918056113197a1e38958-2eeb-1240-548c-bc2411a168a2";

test("listen publish matches the UMN supervisor example", () => {
  assert.deepEqual(
    supervisorMonitorPublishBody({
      sessionId,
      switchType: SUPERVISOR_MONITOR_LISTEN,
      email: "test@supervisor.com",
      name: "Test Supervisor",
      userId: "2567",
      ext: 208,
      roleId: 5,
    }),
    {
      session_id: sessionId,
      req_type: "SUPERVISOR",
      switch_type: 1,
      email: "test@supervisor.com",
      name: "Test Supervisor",
      userId: 2567,
      ext: 208,
      roleId: 5,
    },
  );
});

test("whisper and barge omit roleId", () => {
  for (const switchType of [2, 3] as const) {
    const body = supervisorMonitorPublishBody({
      sessionId,
      switchType,
      email: "test@supervisor.com",
      name: "Test Supervisor",
      userId: "2567",
      ext: 208,
      roleId: 5,
    });
    assert.equal(body.switch_type, switchType);
    assert.equal("roleId" in body, false);
  }
});
test("listen cancel omits roleId", () => {
  const body = supervisorMonitorPublishBody({
    sessionId,
    switchType: SUPERVISOR_MONITOR_CANCEL,
    email: "test@supervisor.com",
    name: "Test Supervisor",
    userId: "2567",
    ext: 208,
    roleId: 5,
  });
  assert.equal(body.switch_type, 5);
  assert.equal("roleId" in body, false);
});
