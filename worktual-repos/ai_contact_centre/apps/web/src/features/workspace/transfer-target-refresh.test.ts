import assert from "node:assert/strict";
import test from "node:test";

import { shouldApplyTransferTargetRefresh } from "./transfer-target-refresh.js";

const same = {
  dialogOpen: true,
  requestedQueueId: "support",
  requestedSearch: "",
  currentQueueId: "support",
  currentSearch: "",
  generationAtStart: 1,
  generationNow: 1,
  explicitLoadInFlight: false,
  listExtended: false,
};

test("a quiet refresh updates the open queue list", () => {
  assert.equal(shouldApplyTransferTargetRefresh(same), true);
});

test("a quiet refresh waits while the dialog is loading or closed", () => {
  assert.equal(shouldApplyTransferTargetRefresh({ ...same, dialogOpen: false }), false);
  assert.equal(shouldApplyTransferTargetRefresh({ ...same, explicitLoadInFlight: true }), false);
  assert.equal(shouldApplyTransferTargetRefresh({ ...same, generationNow: 2 }), false);
  assert.equal(shouldApplyTransferTargetRefresh({ ...same, currentQueueId: "sales" }), false);
  assert.equal(shouldApplyTransferTargetRefresh({ ...same, listExtended: true }), false);
});
