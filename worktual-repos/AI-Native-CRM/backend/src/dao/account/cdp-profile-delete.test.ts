/**
 * run: npx tsx src/dao/account/cdp-profile-delete.test.ts
 */
import assert from "node:assert/strict";
import { isCdpFkViolation } from "./cdp-profile-delete.ts";

assert.equal(isCdpFkViolation({ code: "23503" }), true);
assert.equal(
  isCdpFkViolation(
    new Error(
      'update or delete on table "customer_profile" violates foreign key constraint "gold_customer_metrics_cdp_id_fkey" on table "gold_customer_metrics"',
    ),
  ),
  true,
);
assert.equal(isCdpFkViolation(new Error("Contact not found.")), false);
assert.equal(isCdpFkViolation(null), false);
console.log("cdp-profile-delete ok");
