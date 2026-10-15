/**
 * Run: npx tsx --tsconfig tsconfig.json src/lib/campaign-image-ui-events.selftest.ts
 */
import { applyTemplateFieldsFromImageUiEvent } from "./campaign-image-ui-events";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const card1 = {
  template_id: "e1",
  channel: "email",
  fields: { subject: "Hello", compiled_html: "<p>old</p>" },
};
const card2 = {
  template_id: "e2",
  channel: "email",
  fields: { subject: "New", compiled_html: "<p>new</p>" },
};

const patched: Record<string, Record<string, unknown>> = {};
const apply = (tid: string, fields: Record<string, unknown>) => {
  patched[tid] = fields;
};

const painted = applyTemplateFieldsFromImageUiEvent(
  "image_generated",
  {
    type: "image_generated",
    payload: {
      image_url: "https://cdn.example.com/hero.png",
      channels: ["email"],
    },
  },
  {
    timelineCards: [card1, card2],
    applyTemplateFields: apply,
  },
);
assert(painted === false, "create-chat image event without template_id must not patch");
assert(Object.keys(patched).length === 0, "must not rewrite every email card");

const editPatched: Record<string, Record<string, unknown>> = {};
applyTemplateFieldsFromImageUiEvent(
  "image_generated",
  {
    type: "image_generated",
    payload: {
      image_url: "https://cdn.example.com/hero.png",
      channels: ["email"],
    },
  },
  {
    timelineCards: [card1, card2],
    restrictTemplateId: "e2",
    defaultTemplateId: "e2",
    applyTemplateFields: (tid, fields) => {
      editPatched[tid] = fields;
    },
  },
);
assert(editPatched.e2, "edit space patches the open template");
assert(!editPatched.e1, "edit space must not patch a different card");
assert(
  String(editPatched.e2.header_image || "").includes("hero.png"),
  "edit space stores the hero on that template only",
);

console.log("campaign-image-ui-events.selftest ok");
