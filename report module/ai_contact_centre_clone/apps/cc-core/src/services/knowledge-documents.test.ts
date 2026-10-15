import assert from "node:assert/strict";
import test from "node:test";

import { extractPlainTextFromBuffer } from "./knowledge-documents.js";

test("extractPlainTextFromBuffer reads markdown", () => {
  const text = extractPlainTextFromBuffer(
    "policy.md",
    Buffer.from("# Refund policy\n\nReturns within 30 days.", "utf8"),
  );
  assert.match(text, /Refund policy/);
});

test("extractPlainTextFromBuffer pretty-prints json", () => {
  const text = extractPlainTextFromBuffer(
    "faq.json",
    Buffer.from('{"answer":"Yes"}', "utf8"),
  );
  assert.match(text, /Yes/);
});
