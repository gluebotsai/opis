import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const panel = require("../app/static/addons/meet/internal-panel.js");

const employee = panel.view({
  internal: true,
  audience: "employee",
  answer: "The Acme deal is in proposal.",
  talkTrack: "should not show",
  nextBestAction: "should not show",
  heardLine: "Asha Rao: Ravi, where is Acme?",
});
assert.equal(employee.hideRecommendation, true);
assert.equal(employee.hideNextBest, true);
assert.equal(employee.title, "Here’s a way to answer");
assert.equal(employee.body, "The Acme deal is in proposal.");
assert.equal(employee.body.includes("should not show"), false);

const manager = panel.view({
  internal: true,
  audience: "manager",
  factVerdict: "differs",
  factDetail: "The CRM stage is negotiation.",
  nextBestAction: "Book a follow-up",
});
assert.equal(manager.hideRecommendation, true);
assert.equal(manager.hideNextBest, true);
assert.equal(manager.title, "Quick check");
assert.equal(manager.body.includes("doesn’t line up with the CRM"), true);
assert.equal(manager.body.includes("Book a follow-up"), false);

assert.equal(panel.view({ talkTrack: "Say the price", nextBestAction: "Send a quote" }), null);

console.log("internal-panel.test.mjs ok");
