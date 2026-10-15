import assert from "node:assert/strict";
import test from "node:test";

import {
  isEntityId,
  jsonStringifyEntityPayload,
  parseEntityId,
  serializeEntityId,
  serializeEntityIdOptional,
} from "./id-schema.js";

test("serializeEntityId stringifies bigint values", () => {
  assert.equal(serializeEntityId(1000n), "1000");
  assert.equal(serializeEntityIdOptional(null), null);
  assert.equal(serializeEntityIdOptional(42n), "42");
});

test("jsonStringifyEntityPayload handles bigint fields", () => {
  const payload = {
    organizationId: 1000n,
    nested: { queueId: 1000n, tags: ["a"] },
  };
  assert.equal(
    jsonStringifyEntityPayload(payload),
    '{"organizationId":"1000","nested":{"queueId":"1000","tags":["a"]}}',
  );
});

test("parseEntityId round trips numeric strings", () => {
  assert.equal(parseEntityId("1000"), 1000n);
});

test("isEntityId accepts numeric strings only", () => {
  assert.equal(isEntityId("1000"), true);
  assert.equal(isEntityId("abc"), false);
  assert.equal(isEntityId("550e8400-e29b-41d4-a716-446655440000"), false);
  assert.equal(isEntityId(null), false);
});
