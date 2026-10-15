/**
 * Seed postal footer must not appear on live tenant sends.
 * Run: npx tsx scripts/test-email-org-postal.ts
 */
import assert from "node:assert/strict";
import {
  isSeedPlaceholderPostal,
  orgPostalFooterText,
} from "../src/helpers/email-org-postal.js";

assert.equal(
  isSeedPlaceholderPostal({
    legalName: "Worktual",
    street: "Campaign HQ",
    city: "London",
    country: "UK",
  }),
  true,
);
assert.equal(
  orgPostalFooterText({
    legalName: "Worktual",
    street: "Campaign HQ",
    city: "London",
    country: "UK",
  }),
  "",
);
assert.equal(
  orgPostalFooterText({
    legalName: "ZIFO",
    street: "Anna Salai",
    city: "Chennai",
    country: "India",
  }),
  "ZIFO, Anna Salai, Chennai, India",
);
assert.equal(orgPostalFooterText(null), "");
console.log("email-org-postal: ok");
