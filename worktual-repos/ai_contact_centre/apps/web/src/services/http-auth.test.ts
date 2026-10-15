import assert from "node:assert/strict";
import test from "node:test";

import {
  bearerTokenFromAuthorization,
  isSessionAuthenticationFailure,
  shouldClearCurrentSession,
} from "./http-auth.js";

test("recognizes only cc-core session authentication failures", () => {
  assert.equal(isSessionAuthenticationFailure("Invalid or expired token"), true);
  assert.equal(
    isSessionAuthenticationFailure("Session expired or signed out. Please sign in again."),
    true,
  );
  assert.equal(isSessionAuthenticationFailure("Missing tenant context"), false);
  assert.equal(isSessionAuthenticationFailure("Unauthorized"), false);
});

test("reads bearer tokens without making the scheme case-sensitive", () => {
  assert.equal(bearerTokenFromAuthorization("Bearer current-token"), "current-token");
  assert.equal(bearerTokenFromAuthorization("bearer current-token"), "current-token");
  assert.equal(bearerTokenFromAuthorization("Basic credentials"), undefined);
});

test("clears only the current token after a confirmed cc-core authentication failure", () => {
  const base = {
    isCcCore: true,
    responseMessage: "Invalid or expired token",
    requestAuthorization: "Bearer current-token",
    currentToken: "current-token",
  };

  assert.equal(shouldClearCurrentSession(base), true);
  assert.equal(
    shouldClearCurrentSession({
      ...base,
      requestAuthorization: "Bearer stale-token",
    }),
    false,
  );
  assert.equal(shouldClearCurrentSession({ ...base, isCcCore: false }), false);
  assert.equal(
    shouldClearCurrentSession({
      ...base,
      responseMessage: "Missing tenant context",
    }),
    false,
  );
});
