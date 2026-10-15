/**
 * run: npx tsx src/components/contacts/LeadNurtureStatusBadge.test.ts
 */
import assert from "node:assert/strict";
import { skippedReason } from "@/lib/nurture-skip-reason";

assert.equal(
  skippedReason({
    rationale: "Lead has no company, industry, or contact details; cannot be engaged.",
  }),
  "Lead has no company, industry, or contact details; cannot be engaged",
);

assert.equal(
  skippedReason({
    rationale: "contact_assigned_to_sales",
    skipReason: "contact_assigned_to_sales",
  }),
  "this lead is assigned to a sales rep, so they own the follow-up",
);

assert.equal(
  skippedReason({ decision: "skip_not_interested" }),
  "they asked not to be contacted",
);

console.log("LeadNurtureStatusBadge.test.ts ok");
