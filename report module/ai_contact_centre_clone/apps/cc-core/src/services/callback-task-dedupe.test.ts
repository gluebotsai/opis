import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMissedContactOpenCallbackExistsSql,
  buildOpenCallbackMatchSql,
  CALLBACK_IDENTITY_KEY_TYPES,
} from "./callback-task-dedupe.js";
import { IDENTITY_KEY_TYPES } from "./cdp-customer-profile.js";

test("CALLBACK_IDENTITY_KEY_TYPES includes channel identity keys", () => {
  assert.ok(CALLBACK_IDENTITY_KEY_TYPES.includes(IDENTITY_KEY_TYPES.WHATSAPP_PHONE));
  assert.ok(CALLBACK_IDENTITY_KEY_TYPES.includes(IDENTITY_KEY_TYPES.EMAIL));
  assert.ok(CALLBACK_IDENTITY_KEY_TYPES.includes(IDENTITY_KEY_TYPES.WEBCHAT_VISITOR));
});

test("buildMissedContactOpenCallbackExistsSql matches conversation, contact, and identity", () => {
  const sql = buildMissedContactOpenCallbackExistsSql("mc", "t");
  assert.match(sql, /mc\.conversation_id/);
  assert.match(sql, /mc\.contact_id/);
  assert.match(sql, /cdp\.identity_keys/);
  assert.match(sql, /whatsapp_phone/);
});

test("buildOpenCallbackMatchSql treats contact id as TEXT, not bigint", () => {
  const sql = buildOpenCallbackMatchSql("t");
  assert.match(sql, /\$2::text IS NOT NULL AND t\.contact_id = \$2::text/);
  assert.match(sql, /candidate_ik\.cdp_id = \$2::text/);
  assert.doesNotMatch(sql, /\$2::bigint/);
});
