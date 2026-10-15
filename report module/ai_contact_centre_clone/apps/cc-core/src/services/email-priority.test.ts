import assert from "node:assert/strict";
import test from "node:test";

import { isHighPriority, urgencyToPriority } from "./email-priority.js";

test("urgencyToPriority maps normal, high, and critical", () => {
  assert.equal(urgencyToPriority("normal"), 0);
  assert.equal(urgencyToPriority("high"), 1);
  assert.equal(urgencyToPriority("critical"), 2);
  assert.equal(urgencyToPriority(null), 0);
  assert.equal(urgencyToPriority("HIGH"), 1);
});

test("isHighPriority treats high and critical as priority routing candidates", () => {
  assert.equal(isHighPriority(0), false);
  assert.equal(isHighPriority(1), true);
  assert.equal(isHighPriority(2), true);
});
