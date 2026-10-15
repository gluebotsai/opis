import assert from "node:assert/strict";
import test from "node:test";

import { isEntityId } from "../lib/id-schema.js";

test("listContactInteractions uses bigint contact_id only for numeric cdp ids", () => {
  assert.equal(isEntityId("42"), true);
  assert.equal(isEntityId("e802c20c-124c-4718-bfec-a2f8a246494d"), false);
});
