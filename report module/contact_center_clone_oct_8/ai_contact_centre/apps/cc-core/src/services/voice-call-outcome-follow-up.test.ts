import assert from "node:assert/strict";
import test from "node:test";

import { followUpCallData, followUpInstruction } from "./voice-call-outcome-follow-up.js";

test("follow-up call uses the saved customer details", () => {
  assert.deepEqual(
    followUpCallData({
      mobile: "919150911820",
      customer_name: " Subaz Bharathi ",
      email: " subazkumar4@gmail.com ",
    }),
    {
      phone: "919150911820",
      customer_name: "Subaz Bharathi",
      email: "subazkumar4@gmail.com",
    },
  );
  assert.deepEqual(
    followUpCallData({ mobile: "919150911820", customer_name: " ", email: null }),
    { phone: "919150911820" },
  );
});

test("follow-up instruction prefers the saved campaign instruction", () => {
  assert.equal(
    followUpInstruction({
      instruction: " Greet the customer and confirm the recent order. ",
      reason: "Customer asked for a call tomorrow morning.",
    }),
    "Greet the customer and confirm the recent order.",
  );
  assert.equal(
    followUpInstruction({ instruction: " ", reason: "Customer asked for a call tomorrow morning." }),
    "This is the scheduled callback. Customer asked for a call tomorrow morning.",
  );
  assert.equal(
    followUpInstruction({ instruction: null, reason: null }),
    "This is the scheduled callback.",
  );
});
