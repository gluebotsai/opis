import assert from "node:assert/strict";
import test from "node:test";

import { applyPresenceAfterLogin, loginToolbarPresence } from "./login-presence.js";

test("a new sign-in shows Not Ready even when the saved status is still offline or busy", () => {
  assert.deepEqual(loginToolbarPresence({ initialized: true, stored: "offline" }), {
    display: "not_ready",
    ignoreUntilChanged: "offline",
  });
  assert.deepEqual(loginToolbarPresence({ initialized: true, stored: "busy" }), {
    display: "not_ready",
    ignoreUntilChanged: "busy",
  });
  assert.deepEqual(loginToolbarPresence({ initialized: true, stored: "not_ready" }), {
    display: "not_ready",
    ignoreUntilChanged: null,
  });
});

test("a refresh keeps the saved status", () => {
  assert.deepEqual(loginToolbarPresence({ initialized: false, stored: "busy" }), {
    display: "busy",
    ignoreUntilChanged: null,
  });
  assert.deepEqual(loginToolbarPresence({ initialized: false, stored: "ready" }), {
    display: "ready",
    ignoreUntilChanged: null,
  });
});

test("the old saved status does not replace login Not Ready", () => {
  const held = applyPresenceAfterLogin({
    incoming: "offline",
    ignoreUntilChanged: "offline",
    liveCall: false,
  });
  assert.equal(held.state, null);
  assert.equal(held.ignoreUntilChanged, "offline");
});

test("Not Ready from the server ends the login hold", () => {
  const next = applyPresenceAfterLogin({
    incoming: "not_ready",
    ignoreUntilChanged: "offline",
    liveCall: false,
  });
  assert.equal(next.state, "not_ready");
  assert.equal(next.ignoreUntilChanged, null);
});

test("a live call can still show Busy after login", () => {
  const next = applyPresenceAfterLogin({
    incoming: "busy",
    ignoreUntilChanged: "busy",
    liveCall: true,
  });
  assert.equal(next.state, "busy");
  assert.equal(next.ignoreUntilChanged, null);
});

test("a status chosen after login replaces Not Ready", () => {
  const next = applyPresenceAfterLogin({
    incoming: "ready",
    ignoreUntilChanged: "offline",
    liveCall: false,
  });
  assert.equal(next.state, "ready");
  assert.equal(next.ignoreUntilChanged, null);
});
