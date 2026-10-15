import assert from "node:assert/strict";
import {
  buildSubmitComponentsFromAgentFields,
  buildSendTemplateComponents,
  enrichSubmitComponentsWithExamples,
  exampleValueForPlaceholder,
  mapBodyForMeta,
} from "../src/helpers/whatsapp-template-map.js";

assert.equal(exampleValueForPlaceholder("first_name"), "Customer");

const mapped = mapBodyForMeta(
  "Your report for {{report_date}} is ready. Open: {{campaign_url}}",
);
assert.deepEqual(mapped.placeholders, ["report_date", "campaign_url"]);
assert.equal(mapped.exampleValues[0], "19 Sep 2026");

const built = buildSubmitComponentsFromAgentFields({
  body: mapped.text.replace(/\{\{\d+\}\}/g, (m) => {
    const n = Number(m.replace(/\D/g, ""));
    return `{{${["report_date", "campaign_url"][n - 1]}}}`;
  }),
  category: "UTILITY",
  buttons: [
    { type: "QUICK_REPLY", text: "Help" },
    { type: "URL", text: "Open", url: "{{campaign_url}}" },
  ],
});
const body = built.components.find((c) => c.type === "BODY") as {
  example?: { body_text: string[][] };
};
assert.ok(body.example?.body_text?.[0]?.length === 2);

const stored = enrichSubmitComponentsWithExamples(
  [{ type: "BODY", text: mapped.text }],
  "Your report for {{report_date}} is ready. Open: {{campaign_url}}",
);
assert.ok((stored[0] as { example?: unknown }).example);

const send = buildSendTemplateComponents({
  bodyPlaceholders: ["report_date", "campaign_url"],
  urlButtonSendSpecs: built.urlButtonSendSpecs,
  merge: {
    map: {
      report_date: "28 Sep 2026",
      campaign_url: "https://app.worktual.com/r/1",
    },
  },
});
assert.ok(send?.some((c) => c.type === "body"));

console.log("test-whatsapp-template-map: ok");
