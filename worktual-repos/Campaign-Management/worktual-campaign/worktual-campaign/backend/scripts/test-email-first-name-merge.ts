/**
 * Merge tags stay in the template. At send, named contacts get their name;
 * unnamed contacts get "Hi," — never leftover {{first_name}} or "Hi there,".
 *
 *   npx tsx scripts/test-email-first-name-merge.ts
 */
import assert from "node:assert/strict";
import {
  ensureOutboundEmailPersonalized,
  mergeHasRealFirstName,
  personalizeEmailContent,
} from "../src/helpers/email-render.js";

const html = "<p>Hi {{first_name}},</p><p>We noticed you were checking out the polo.</p>";

const named = personalizeEmailContent(
  { subject: "Hi {{first_name}}", html, text: "Hi {{first_name}}," },
  { first_name: "aravindh" },
);
assert.equal(named.subject, "Hi Aravindh");
assert.match(named.html, /Hi Aravindh,/);
assert.doesNotMatch(named.html, /\{\{/);
assert.equal(mergeHasRealFirstName({ first_name: "aravindh" }), true);

const unnamed = personalizeEmailContent(
  { subject: "Hello {{first_name}}", html, text: "Hi {{first_name}}," },
  { first_name: "" },
);
assert.equal(unnamed.subject, "Hello");
assert.match(unnamed.html, /Hi,/);
assert.doesNotMatch(unnamed.html, /there/i);
assert.doesNotMatch(unnamed.html, /\{\{first_name\}\}/);
assert.equal(mergeHasRealFirstName({ first_name: "" }), false);

const alreadyMerged = ensureOutboundEmailPersonalized({
  subject: "Ready",
  html: "<p>Hi Aravindh,</p>",
});
assert.equal(alreadyMerged.html, "<p>Hi Aravindh,</p>");

const leftover = ensureOutboundEmailPersonalized(
  { subject: "x", html: "<p>Hi {{first_name}},</p>" },
  {},
);
assert.match(leftover.html, /Hi,/);
assert.doesNotMatch(leftover.html, /\{\{/);

console.log("email-first-name-merge: ok");
