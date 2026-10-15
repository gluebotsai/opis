/**
 * MIME encoding for Gmail/SMTP campaign HTML (no test runner required).
 * Run: npx tsx scripts/test-email-mime.ts
 */
import assert from "node:assert/strict";
import {
  buildCampaignEmailMime,
  encodeRfc2047Header,
  encodeUtf8Base64Body,
  toCrLf,
} from "../src/helpers/email-mime.js";

const html = `<html><body><p>Café — ${"x".repeat(80)}</p></body></html>`;
const mime = buildCampaignEmailMime({
  from: { email: "sample151102@gmail.com", name: "ZIFO" },
  to: "reader@example.com",
  subject: "Launch — Café",
  html,
});

assert.match(mime, /Content-Transfer-Encoding: base64/i);
assert.doesNotMatch(mime, /Content-Transfer-Encoding:\s*7bit/i);
assert.match(mime, /charset="UTF-8"/i);
assert.equal(mime.includes(html), false);

const parts = mime.split("\r\n\r\n");
assert.equal(parts.length >= 2, true);
const bodyB64 = (parts.slice(1).join("\r\n\r\n") || "").replace(/\s+/g, "");
const decoded = Buffer.from(bodyB64, "base64").toString("utf8");
assert.equal(decoded, html);

assert.match(encodeRfc2047Header("Launch — Café"), /^=\?UTF-8\?B\?/);
assert.equal(encodeRfc2047Header("Hello"), "Hello");

const wrapped = encodeUtf8Base64Body(html);
for (const line of wrapped.split("\r\n")) {
  assert.ok(line.length <= 76, `base64 line ${line.length}`);
}

assert.equal(toCrLf("a\nb\r\nc"), "a\r\nb\r\nc");
console.log("email-mime: ok");
