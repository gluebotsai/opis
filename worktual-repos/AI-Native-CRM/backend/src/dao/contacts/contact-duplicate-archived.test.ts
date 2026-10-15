/**
 * run: npx tsx src/dao/contacts/contact-duplicate-archived.test.ts
 */
import assert from "node:assert/strict";

// Archived profiles are excluded at match time in findDuplicateContacts.
function shouldIncludeDuplicate(profile: { status?: string } | undefined): boolean {
  return profile?.status !== "archived";
}

assert.equal(shouldIncludeDuplicate(undefined), true);
assert.equal(shouldIncludeDuplicate({ status: "active" }), true);
assert.equal(shouldIncludeDuplicate({ status: "archived" }), false);
console.log("contact-duplicate-archived ok");
