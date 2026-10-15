import assert from "node:assert/strict";
import test from "node:test";

import { normalizeCallOutcomeInput, VoiceCallOutcomeError } from "./voice-call-outcome.js";

test("callback outcome keeps the requested time", () => {
  const outcome = normalizeCallOutcomeInput({
    organizationId: "1012",
    sessionId: " ea54ca84-dbee-4f49-8f7b-3985c7c90b7b ",
    outcome: "Callback",
    mobile: "919150911820",
    name: " Subaz Bharathi ",
    email: "subazkumar4@gmail.com",
    instruction: " Greet the customer and confirm the recent order. ",
    reason: " Customer asked for a call tomorrow morning. ",
    callbackAt: "2026-10-07T09:00:00+05:30",
    timezone: " Asia/Kolkata ",
  });

  assert.equal(outcome.organizationId, "1012");
  assert.equal(outcome.sessionId, "ea54ca84-dbee-4f49-8f7b-3985c7c90b7b");
  assert.equal(outcome.outcome, "Callback");
  assert.equal(outcome.mobile, "919150911820");
  assert.equal(outcome.customerName, "Subaz Bharathi");
  assert.equal(outcome.email, "subazkumar4@gmail.com");
  assert.equal(outcome.instruction, "Greet the customer and confirm the recent order.");
  assert.equal(outcome.status, "pending");
  assert.equal(outcome.reason, "Customer asked for a call tomorrow morning.");
  assert.equal(outcome.callbackAt?.toISOString(), "2026-10-07T03:30:00.000Z");
  assert.equal(outcome.timezone, "Asia/Kolkata");
});

test("callback outcome requires a time and timezone", () => {
  assert.throws(
    () =>
      normalizeCallOutcomeInput({
        organizationId: "1012",
        sessionId: "ea54ca84-dbee-4f49-8f7b-3985c7c90b7b",
        outcome: "Callback",
        mobile: "919150911820",
      }),
    (error: unknown) =>
      error instanceof VoiceCallOutcomeError &&
      error.status === 400 &&
      error.message === "callbackAt is required for Callback",
  );
  assert.throws(
    () =>
      normalizeCallOutcomeInput({
        organizationId: "1012",
        sessionId: "ea54ca84-dbee-4f49-8f7b-3985c7c90b7b",
        outcome: "Callback",
        mobile: "919150911820",
        callbackAt: "2026-10-07T09:00:00+05:30",
      }),
    (error: unknown) =>
      error instanceof VoiceCallOutcomeError &&
      error.message === "timezone is required for Callback",
  );
  assert.throws(
    () =>
      normalizeCallOutcomeInput({
        organizationId: "1012",
        sessionId: "ea54ca84-dbee-4f49-8f7b-3985c7c90b7b",
        outcome: "Callback",
        mobile: "919150911820",
        callbackAt: "2026-10-07T09:00:00+05:30",
        timezone: "Not/AZone",
      }),
    (error: unknown) =>
      error instanceof VoiceCallOutcomeError && error.message === "timezone is not valid",
  );
});

test("other outcomes do not accept a callback time", () => {
  const outcome = normalizeCallOutcomeInput({
    organizationId: "1012",
    sessionId: "ea54ca84-dbee-4f49-8f7b-3985c7c90b7b",
    outcome: "Qualified",
    mobile: "919150911820",
    reason: "",
  });
  assert.equal(outcome.outcome, "Qualified");
  assert.equal(outcome.status, "closed");
  assert.equal(outcome.customerName, null);
  assert.equal(outcome.email, null);
  assert.equal(outcome.instruction, null);
  assert.equal(outcome.reason, null);
  assert.equal(outcome.callbackAt, null);
  assert.equal(outcome.timezone, null);

  assert.throws(
    () =>
      normalizeCallOutcomeInput({
        organizationId: "1012",
        sessionId: "ea54ca84-dbee-4f49-8f7b-3985c7c90b7b",
        outcome: "Interested",
        mobile: "919150911820",
        callbackAt: "2026-10-07T09:00:00+05:30",
      }),
    (error: unknown) => error instanceof VoiceCallOutcomeError && error.status === 400,
  );
});
