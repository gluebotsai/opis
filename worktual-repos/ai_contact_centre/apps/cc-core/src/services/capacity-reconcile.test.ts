import assert from "node:assert/strict";
import test from "node:test";

import { capacityDeltaForAgentDisconnect, expectedCapacityDelta } from "./lifecycle-contract.js";

test("capacity math never double-counts accept", () => {
  const offer = expectedCapacityDelta("offer");
  const accept = expectedCapacityDelta("accept");
  assert.equal(offer.reserved + accept.reserved, 0);
  assert.equal(offer.active + accept.active, 1);
});

test("agent disconnect capacity depends on offer vs active", () => {
  assert.deepEqual(capacityDeltaForAgentDisconnect("assigned"), {
    reserved: -1,
    active: 0,
  });
  assert.deepEqual(capacityDeltaForAgentDisconnect("active"), {
    reserved: 0,
    active: -1,
  });
});
