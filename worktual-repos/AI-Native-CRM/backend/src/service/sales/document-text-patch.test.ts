/**
 * run: npx tsx src/service/sales/document-text-patch.test.ts
 */
import {
  applyDocumentTextReplacements,
  assertDocumentTextEditable,
} from "./document-text-patch";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const FROZEN_COVER_HTML = `
<article class="proposal-doc">
  <div class="cover-block bp-playbook-cover">
    <p class="cover-brand">WORKTUAL</p>
    <h1 class="cover-title">Commercial Proposal</h1>
    <p class="cover-prepared">Prepared for Fincity</p>
    <p class="cover-date">11 September 2026</p>
  </div>
  <section data-slot="overview"><h1 class="sec-h">Overview</h1></section>
</article>
`;

const playbook = {
  version: 1,
  html: FROZEN_COVER_HTML,
  css: "",
  mode: "playbook-template",
};

const allowed = assertDocumentTextEditable(playbook);
assert(allowed.ok === true, "playbook HTML is editable");

const patched = applyDocumentTextReplacements({
  blueprint: playbook,
  assets: [],
  textReplacements: [
    { find: "11 September 2026", replace: "12 September 2026" },
  ],
});
assert((patched.applied ?? 0) > 0, "cover date replacement applied");
assert(
  Boolean(patched.blueprint?.html.includes("12 September 2026")),
  "new date is in HTML",
);
assert(
  !patched.blueprint?.html.includes("11 September 2026"),
  "old date is gone",
);

const viaPageId = applyDocumentTextReplacements({
  blueprint: playbook,
  assets: [],
  pageId: "page-1",
  textReplacements: [
    { find: "11 September 2026", replace: "12 September 2026" },
  ],
});
assert(
  (viaPageId.applied ?? 0) > 0,
  "falls back to blueprint HTML when pageId has no clone asset",
);
assert(
  Boolean(viaPageId.blueprint?.html.includes("12 September 2026")),
  "pageId fallback still patches cover date",
);

const bolded = applyDocumentTextReplacements({
  blueprint: {
    ...playbook,
    html: FROZEN_COVER_HTML.replace(
      "Prepared for Fincity",
      "Prepared for **Fincity**",
    ),
  },
  assets: [],
  textReplacements: [{ find: "Fincity", replace: "**Fincity**" }],
});
assert(
  Boolean(bolded.blueprint?.html.includes("<strong>Fincity</strong>")),
  "markdown bold becomes HTML strong",
);
assert(
  !bolded.blueprint?.html.includes("**Fincity**"),
  "markdown asterisks are not left visible",
);

const bordered = applyDocumentTextReplacements({
  blueprint: {
    ...playbook,
    html: `${FROZEN_COVER_HTML}<style>.proposal-doc table{border:none}</style>`,
    css: ".proposal-doc table{border:none}",
  },
  assets: [],
  textReplacements: [],
  tableBorders: true,
});
assert((bordered.applied ?? 0) > 0, "tableBorders counts as an applied edit");
assert(
  Boolean(bordered.blueprint?.css.includes("worktual-table-borders")),
  "table border CSS is stored on the blueprint",
);
assert(
  Boolean(bordered.blueprint?.html.includes("worktual-table-borders")),
  "table border CSS is injected into frozen HTML styles",
);
assert(
  Boolean(bordered.blueprint?.html.includes("table-borders-on")),
  "on class is set on the proposal article",
);

const cleared = applyDocumentTextReplacements({
  blueprint: bordered.blueprint,
  assets: [],
  textReplacements: [],
  tableBorders: false,
});
assert((cleared.applied ?? 0) > 0, "tableBorders false counts as an applied edit");
assert(
  Boolean(cleared.blueprint?.html.includes("table-borders-off")),
  "off class is set when removing borders",
);
assert(
  !cleared.blueprint?.html.includes("table-borders-on"),
  "on class is removed when turning borders off",
);

console.log("document-text-patch.test.ts ok");
