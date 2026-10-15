/**
 * run: npx tsx src/service/account/session-crypto.test.ts
 */
import assert from "node:assert/strict";
import {
  isLegacySignedSessionCookie,
  isOpaqueAuthSessionToken,
  signSessionUserId,
  verifySessionCookieValue,
} from "./session-crypto";

const signed = signSessionUserId("1017");
assert.equal(isLegacySignedSessionCookie(signed), true);
assert.equal(isOpaqueAuthSessionToken(signed), false);
assert.equal(verifySessionCookieValue(signed), "1017");

const token =
  "6b64cb0d7a0495649973504e6831854f293d340acfcb3ba61fda7189091d9eff";
assert.equal(isLegacySignedSessionCookie(token), false);
assert.equal(isOpaqueAuthSessionToken(token), true);
assert.equal(verifySessionCookieValue(token), null);

console.log("session-crypto.test.ts ok");
