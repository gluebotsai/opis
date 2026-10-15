import assert from "node:assert/strict";
import test from "node:test";

import { jsonStringifyEntityPayload } from "../lib/id-schema.js";

test("monitoring snapshot responses serialize bigint fields from raw SQL rows", () => {
  const snapshot = {
    generatedAt: new Date().toISOString(),
    summary: {
      waiting: 2,
      active: 1,
      botActive: 0,
      readyAgents: 1,
      loggedInAgents: 2,
      slaAtRisk: 0n,
      slaBreached: 1n,
      offersRinging: 3n,
    },
    queues: [
      {
        id: 1000n,
        name: "Support",
        waiting: 2n,
        active: 1n,
        botActive: 0n,
        oldestWaitSeconds: 45,
        readyAgents: 1,
      },
    ],
    agents: [],
    conversations: [],
    waiting: [],
    missed: [],
    callbacks: [],
    alerts: [],
  };

  const serialized = JSON.parse(jsonStringifyEntityPayload(snapshot));
  assert.equal(serialized.summary.slaAtRisk, "0");
  assert.equal(serialized.summary.slaBreached, "1");
  assert.equal(serialized.summary.offersRinging, "3");
  assert.equal(serialized.queues[0].id, "1000");
  assert.doesNotThrow(() => JSON.stringify(serialized));
});
