import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(
  new URL("../app/static/addons/meet/index.html", import.meta.url),
  "utf8",
);

assert.match(html, /id="viewContact"/);
assert.match(html, /id="thread"/);
assert.match(html, /id="askThread"/);
assert.match(html, /id="backLive"/);
assert.match(html, /id="contactPage"/);
assert.match(html, /id="backFromContact"/);
assert.match(html, /View contact/);
assert.match(html, /currentView = "ask"/);
assert.match(html, /"askThread"/);
assert.match(html, /Contact Details/);
assert.match(html, /c-summary/);
assert.equal((html.match(/id="thread"/g) || []).length, 1);
assert.equal((html.match(/id="viewContact"/g) || []).length, 1);

const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1])
  .filter((script) => script.trim());

assert.ok(inlineScripts.length > 0);
for (const script of inlineScripts) {
  new vm.Script(script);
}

console.log("meet-chat-panel.test.mjs ok");
