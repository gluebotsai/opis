import assert from "node:assert/strict";
import test from "node:test";

import { extractEmailAddress, sanitizeHtmlToText } from "./gmail-client.js";

test("extractEmailAddress handles RFC display names", () => {
  assert.equal(extractEmailAddress("Customer <customer@example.com>"), "customer@example.com");
});

test("sanitizeHtmlToText removes executable and embedded content", () => {
  const text = sanitizeHtmlToText(
    "<p>Hello &amp; welcome</p><script>steal()</script><iframe>bad</iframe><p>Next</p>",
  );
  assert.equal(text.includes("steal"), false);
  assert.equal(text.includes("bad"), false);
  assert.match(text, /Hello & welcome/);
  assert.match(text, /Next/);
});
