/**
 * Node parity check with backend sanitizer (DOM persist runs in browser only).
 * Run: npx tsx frontend/src/lib/compose-html-outbound.selftest.ts
 */
import { sanitizeCompiledHtmlForStorageAndSend } from "../../../backend/src/helpers/email-outbound-html.js";

const dirty = `<!DOCTYPE html><html><head><base href="https://rebuild-campaign.worktual.com/">
<style>.logo { color: #7c3aed; / purple / }</style></head>
<body contenteditable="true"><div class="logo">BOOXOO</div></body></html>`;

const saved = sanitizeCompiledHtmlForStorageAndSend(dirty);

const checks: Array<[string, boolean]> = [
  ["no base tag", !/<base\b/i.test(saved)],
  ["no contenteditable", !/contenteditable/i.test(saved)],
  ["css comment fixed", /\/\*\s*purple\s*\*\//.test(saved)],
  ["body preserved", /BOOXOO/.test(saved)],
];

let failed = 0;
for (const [label, ok] of checks) {
  if (!ok) {
    console.error("FAIL:", label);
    failed += 1;
  } else {
    console.log("ok:", label);
  }
}
if (failed) process.exit(1);
console.log("compose-html-outbound selftest passed");
