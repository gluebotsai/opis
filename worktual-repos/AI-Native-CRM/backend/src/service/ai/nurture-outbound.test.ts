/**
 * run: npx tsx src/service/ai/nurture-outbound.test.ts
 */
import assert from "node:assert/strict";
import { resolveNurturePhone, selectNurtureChannels } from "./nurture-outbound";

assert.equal(resolveNurturePhone(null, ["+919876543210"]), "+919876543210");

assert.deepEqual(
  selectNurtureChannels({
    email: "a@b.com",
    phone: "+9198",
    afterCooldown: false,
  }),
  ["email"],
);
assert.deepEqual(
  selectNurtureChannels({
    email: null,
    phone: "+9198",
    afterCooldown: false,
  }),
  ["whatsapp"],
);
assert.deepEqual(
  selectNurtureChannels({
    email: "a@b.com",
    phone: "+9198",
    afterCooldown: true,
  }),
  ["email", "whatsapp"],
);
assert.deepEqual(
  selectNurtureChannels({
    email: "a@b.com",
    phone: null,
    afterCooldown: true,
  }),
  ["email"],
);
assert.deepEqual(
  selectNurtureChannels({
    email: null,
    phone: null,
    afterCooldown: false,
  }),
  [],
);

console.log("nurture-outbound.test.ts ok");
