/**
 * Personalised CRM automation body schema (no HTTP).
 * Run: npx tsx scripts/test-personalised-crm-automation.ts
 */
import assert from "node:assert/strict";
import { personalisedCrmAutomationBodySchema } from "../src/modules/campaign/schema.js";

const missingOrg = personalisedCrmAutomationBodySchema.safeParse({
  channels: ["email"],
  people: [{ email: "a@example.com" }],
  acting_user_id: "1066",
});
assert.equal(missingOrg.success, false);

const missingAudience = personalisedCrmAutomationBodySchema.safeParse({
  organization_id: "1003",
  acting_user_id: "1066",
  channels: ["email"],
});
assert.equal(missingAudience.success, false);

const ok = personalisedCrmAutomationBodySchema.safeParse({
  organization_id: "1003",
  acting_user_id: "1066",
  channels: ["email"],
  people: [{ email: "a@example.com" }],
});
assert.equal(ok.success, true);
if (ok.success) {
  assert.equal(ok.data.organization_id, "1003");
  assert.equal(ok.data.acting_user_id, "1066");
}

const okOmitActor = personalisedCrmAutomationBodySchema.safeParse({
  organization_id: "1012",
  channels: ["email"],
  people: [{ email: "a@example.com" }],
});
assert.equal(okOmitActor.success, true);

const okNullActor = personalisedCrmAutomationBodySchema.safeParse({
  organization_id: "1012",
  acting_user_id: null,
  channels: ["email"],
  people: [{ email: "a@example.com" }],
});
assert.equal(okNullActor.success, true);

console.log("personalised-crm automation schema ok");
