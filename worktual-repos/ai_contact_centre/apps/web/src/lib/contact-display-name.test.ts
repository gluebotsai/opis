import assert from "node:assert/strict";
import test from "node:test";

import { resolveContactDisplayName } from "./contact-display-name";

test("resolveContactDisplayName prefers first and last name over fullName email fallback", () => {
  assert.equal(
    resolveContactDisplayName({
      firstName: "Zara",
      lastName: null,
      fullName: "zara123@gmail.com",
      primaryEmail: "zara123@gmail.com",
    }),
    "Zara",
  );
});

test("resolveContactDisplayName uses customFields customerName before fullName", () => {
  assert.equal(
    resolveContactDisplayName({
      firstName: null,
      lastName: null,
      fullName: "zara123@gmail.com",
      customFields: { customerName: "Zara Khan" },
      primaryEmail: "zara123@gmail.com",
    }),
    "Zara Khan",
  );
});

test("resolveContactDisplayName falls back to email when no profile name", () => {
  assert.equal(
    resolveContactDisplayName({
      firstName: null,
      lastName: null,
      fullName: "zara123@gmail.com",
      primaryEmail: "zara123@gmail.com",
    }),
    "zara123@gmail.com",
  );
});
