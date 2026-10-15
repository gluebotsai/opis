import assert from "node:assert/strict";
import test from "node:test";

import { TRANSFERRED_WRAP_UP_SUMMARY, transferredWrapUpSummary } from "./transfer-wrap-up.ts";

test("transferred wrap-up keeps a visible summary so Agent A can save", () => {
  assert.equal(transferredWrapUpSummary(""), TRANSFERRED_WRAP_UP_SUMMARY);
  assert.equal(transferredWrapUpSummary("   "), TRANSFERRED_WRAP_UP_SUMMARY);
  assert.equal(transferredWrapUpSummary(null), TRANSFERRED_WRAP_UP_SUMMARY);
  assert.equal(transferredWrapUpSummary("Customer handed to night shift."), "Customer handed to night shift.");
});
