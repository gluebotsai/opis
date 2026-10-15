/**
 * run: npx tsx src/lib/proposal-playbook-layout.test.ts
 */
import {
  applyCoverAlignClass,
  applyPlaybookCoverHtml,
  buildPlaybookDocumentBlueprint,
  buildPlaybookTemplateBlueprint,
  fillPlaybookTemplate,
  inferCoverAlign,
  isUsableRunningChrome,
  tableRowsFromBody,
  cssLooksComplete,
  htmlLooksLikeSkeleton,
  playbookVisualTemplateReady,
  assertPlaybookSkeleton,
  validateGeneratedProposalHtml,
} from "./proposal-playbook-layout";
import { formatSectionBodyHtml, renderBlueprintHtml } from "./document-blueprint";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const learned = buildPlaybookDocumentBlueprint({
  layoutStyle: {
    coverStyle: "centered",
    headingRule: "none",
    headingColor: "#1f4e79",
    accentColor: "#1f4e79",
    cover: {
      slots: [
        "vendorName",
        "documentTitle",
        "preparedFor",
        "date",
        "productScope",
      ],
      title: "Commercial Proposal",
      preparedForLabel: "Prepared for",
      footer: "Prepared by {{vendorName}}",
    },
    emphasis: {
      requestedColor: "#e6a23c",
      recommendedColor: "#375623",
      requestedLabel: "Requested Solution",
      recommendedLabel: "Recommended Solution",
    },
  },
  sections: [{ key: "executive_summary", title: "Executive Summary" }],
});

assert(learned.html.includes("Prepared for"), "uses learned prepared-for label");
assert(learned.html.includes("Commercial Proposal"), "uses learned cover title");
assert(learned.html.includes("{{customerName}}"), "customer is a token");
assert(learned.html.includes("Prepared by {{vendorName}}"), "uses learned footer");
assert(!/Submitted to/.test(learned.html), "does not inject a static banner phrase");
assert(learned.css.includes("#e6a23c"), "uses learned requested color");
assert(learned.css.includes("#375623"), "uses learned recommended color");
assert(
  learned.html.includes('data-slot="executive_summary"'),
  "body sections come from the playbook",
);

const untitled = buildPlaybookDocumentBlueprint({
  layoutStyle: {
    coverStyle: "centered",
    cover: { slots: ["vendorName", "date"] },
  },
  sections: [{ key: "scope", title: "Scope" }],
});
assert(!/Commercial Proposal/.test(untitled.html), "does not invent a cover title");
assert(!/Prepared for/.test(untitled.html), "does not invent prepared-for copy");

const wrapped = formatSectionBodyHtml(
  "The **Requested Solution** is smaller than the **Recommended Solution**.",
  {
    requestedLabel: "Requested Solution",
    recommendedLabel: "Recommended Solution",
  },
);
assert(/bp-requested/.test(wrapped), "wraps learned requested label");
assert(/bp-recommended/.test(wrapped), "wraps learned recommended label");

const arrows = formatSectionBodyHtml("Lead $ightarrow$ Opportunity");
assert(arrows.includes("→"), "repairs leaked latex arrows");

const structured = formatSectionBodyHtml(
  [
    "Worktual is pleased to submit this proposal.",
    "",
    "AI NATIVE CONTACT CENTRE (CCAAS) OVERVIEW",
    "Deployment of an AI Voicebot and AI Chatbot.",
    "Multilingual capability supporting English, Hindi, and Kannada.",
    "",
    "AI VOICEBOT CAPABILITIES",
    "Automated inbound and outbound engagement workflows.",
  ].join("\n"),
);
assert(/sec-subh/.test(structured), "all-caps lines become subheadings");
assert(/<ul>/.test(structured), "capability sentences become a list");
assert(
  structured.includes("<li>") && structured.includes("Deployment of an AI Voicebot"),
  "capability sentences are list items",
);
assert(
  !/AI NATIVE CONTACT CENTRE[\s\S]*<br\/>/.test(structured),
  "does not dump headings and sentences into one paragraph",
);

const withTables = buildPlaybookDocumentBlueprint({
  layoutStyle: {
    coverStyle: "left",
    headingColor: "#1f4e79",
    tableStyle: { cellPadding: "8px 10px", headerBackground: "#1f4e79" },
  },
  sections: [{ key: "comparison", title: "Comparison" }],
  featureSchema: {
    tables: [
      {
        key: "comparison",
        columns: ["Capability", "Requested", "Recommended"],
      },
    ],
  },
  css: `.proposal-blueprint{font-family:Arial;font-size:12px;padding:16mm;color:#111}
.proposal-blueprint .bp-table td{padding:8px 10px;}`,
});
assert(withTables.css.includes("font-size"), "keeps learned font-size");
assert(withTables.css.includes("padding"), "keeps learned padding");
assert(
  withTables.html.includes('data-slot-table="comparison"'),
  "empty table uses learned slot",
);
assert(withTables.html.includes("<th>Capability</th>"), "thead matches PDF columns");
assert(!/Acme Corp/i.test(withTables.html), "skeleton has no customer name");
assert(cssLooksComplete(withTables.css), "extracted css is complete");

const filled = fillPlaybookTemplate({
  template: {
    html: withTables.html,
    css: withTables.css,
    mode: "playbook-template",
  },
  tokens: { vendorName: "VendorCo", customerName: "NewCo", date: "9 Sep 2026" },
  sections: [
    {
      key: "comparison",
      title: "Comparison",
      body: "Routing for NewCo.",
      tableRows: [{ cells: ["Omnichannel", "Email", "Voice + email"] }],
    },
  ],
});
assert(filled.css === withTables.css, "merge does not rewrite CSS");
assert(filled.html.includes("Omnichannel"), "injects table rows");
assert(filled.html.includes("NewCo"), "fills customer token");
assert(filled.html.includes("VendorCo"), "fills vendor token");

const inferred = buildPlaybookDocumentBlueprint({
  layoutStyle: { coverStyle: "left", headingColor: "#0f2942" },
  sections: [
    {
      key: "monthly_recurring_charges",
      title: "Monthly Recurring Charges",
      tableSpec: {
        shape: "subscription",
        columns: ["Charges", "Requested Solution", "Recommended Solution"],
      },
    },
  ],
});
assert(
  inferred.html.includes('data-slot-table="monthly_recurring_charges"'),
  "charges section gets a table shell from tableSpec",
);
assert(inferred.html.includes("<th>Charges</th>"), "charges thead uses learned headers");

const filledCharges = fillPlaybookTemplate({
  template: inferred,
  tokens: { vendorName: "ZIFO", customerName: "MICE Global", date: "9 Sep 2026" },
  sections: [
    {
      key: "monthly_recurring_charges",
      title: "Monthly Recurring Charges",
      body: "Pricing follows the requested CRM seats versus the recommended unified platform.",
      tableRows: [
        { cells: ["CRM seats", "15 users", "15 users + Tally sync"] },
      ],
      tableSpec: {
        shape: "subscription",
        columns: ["Charges", "Requested Solution", "Recommended Solution"],
      },
    },
  ],
});
assert(filledCharges.html.includes("15 users + Tally sync"), "fills charges table rows");

const brdFilled = fillPlaybookTemplate({
  template: inferred,
  tokens: { vendorName: "ZIFO", customerName: "MICE Global", date: "9 Sep 2026" },
  sections: [
    {
      key: "monthly_recurring_charges",
      title: "Monthly Recurring Charges",
      body: "Pricing follows the requested CRM seats versus the recommended unified platform.",
      tableSpec: {
        shape: "subscription",
        columns: ["Charges", "Requested Solution", "Recommended Solution"],
      },
    },
    {
      key: "cover_overview",
      title: "Overview",
      body:
        "MICE Global needs Intelligent CRM for 15 sales representatives and two-way Tally integration.",
    },
  ],
});
assert(/Intelligent CRM/i.test(brdFilled.html), "keeps BRD prose in the overview");
assert(
  !/<td>15 users<\/td>/i.test(brdFilled.html),
  "does not invent charge cells when the model sent no rows",
);

const leaked = fillPlaybookTemplate({
  template: inferred,
  tokens: { vendorName: "ZIFO", customerName: "MICE Global", date: "9 Sep 2026" },
  sections: [
    {
      key: "monthly_recurring_charges",
      title: "Monthly Recurring Charges",
      body: "Pricing follows the requested CRM seats versus the recommended unified platform.",
      tableRows: [
        { cells: ["AI Voice Bot", "Not included", "Included"] },
        { cells: ["CRM Seats", "15 seats", "15 seats"] },
      ],
      tableSpec: {
        shape: "subscription",
        columns: ["Charges", "Requested Solution", "Recommended Solution"],
      },
    },
    {
      key: "cover_overview",
      title: "Overview",
      body: "MICE Global needs Intelligent CRM for 15 sales representatives and two-way Tally.",
    },
  ],
});
assert(!/AI Voice Bot/i.test(leaked.html), "drops playbook-only products not in the BRD");
assert(/CRM Seats|Intelligent CRM/i.test(leaked.html), "keeps BRD CRM line items");

const thisDealVoice = fillPlaybookTemplate({
  template: inferred,
  tokens: { vendorName: "Worktual", customerName: "Positron", date: "14 Sep 2026" },
  requirementText:
    "Positron needs Lola Voicebot and an AI Chatbot for patient enquiries on WhatsApp.",
  allowedProducts: ["Proactive Contact Centre"],
  sections: [
    {
      key: "monthly_recurring_charges",
      title: "Monthly Recurring Charges",
      body: "CCaaS seats for voice and chat.",
      tableRows: [
        { cells: ["AI Voice Bot", "Included", "Included"] },
        { cells: ["Chatbot", "Included", "Included"] },
        { cells: ["CVM", "Not requested", "Not requested"] },
      ],
      tableSpec: {
        shape: "subscription",
        columns: ["Charges", "Requested Solution", "Recommended Solution"],
      },
    },
  ],
});
assert(/AI Voice Bot/i.test(thisDealVoice.html), "keeps voicebot when this BRD names it");
assert(/Chatbot/i.test(thisDealVoice.html), "keeps chatbot when this BRD names it");
assert(!/\bCVM\b/.test(thisDealVoice.html), "still strips other-deal CVM identity");

const otherCustomer = fillPlaybookTemplate({
  template: inferred,
  tokens: { vendorName: "Worktual", customerName: "Positron", date: "14 Sep 2026" },
  requirementText: "Positron needs a contact centre for patient enquiries.",
  otherCustomerNames: ["Purity Harvest"],
  sections: [
    {
      key: "monthly_recurring_charges",
      title: "Charges",
      body: "CCaaS for Positron.",
      tableRows: [
        { cells: ["Purity Harvest CCaaS seats", "12", "12"] },
        { cells: ["CCaaS seats", "40", "40"] },
      ],
      tableSpec: {
        shape: "subscription",
        columns: ["Charges", "Requested Solution", "Recommended Solution"],
      },
    },
  ],
});
assert(!/Purity Harvest/i.test(otherCustomer.html), "drops rows that name another customer");
assert(/CCaaS seats/i.test(otherCustomer.html), "keeps this-deal CCaaS rows");

const inclusions = buildPlaybookDocumentBlueprint({
  layoutStyle: { coverStyle: "left", headingColor: "#0f2942" },
  sections: [
    {
      key: "inclusions",
      title: "Inclusions",
      tableSpec: {
        shape: "grid",
        columns: ["Item", "Requested", "Recommended"],
      },
    },
  ],
});
const filledInclusions = fillPlaybookTemplate({
  template: inclusions,
  tokens: { vendorName: "Worktual", customerName: "Positron", date: "14 Sep 2026" },
  requirementText:
    "Positron needs Lola Voicebot and WhatsApp for patient enquiries.",
  allowedProducts: ["Proactive Contact Centre"],
  sections: [
    {
      key: "inclusions",
      title: "Inclusions",
      body: "Scope follows the attached BRD.",
      tableSpec: {
        shape: "grid",
        columns: ["Item", "Requested", "Recommended"],
      },
    },
  ],
});
assert(
  filledInclusions.html.includes('data-slot-table="inclusions"'),
  "unknown tableSpec key still gets a table shell",
);
assert(
  !/Proactive Contact Centre/i.test(filledInclusions.html),
  "does not invent table cells from the catalog when the model sent no rows",
);

const compactCss =
  ".proposal-blueprint{font-family:Arial;font-size:12px;padding:16mm;color:#111}" +
  ".proposal-blueprint .bp-table td{padding:8px 10px;}";
assert(!cssLooksComplete(compactCss), "compact 5-rule CSS is not complete");

const completeCss = `
.proposal-blueprint{font-family:Arial,Helvetica,sans-serif;font-size:11px;padding:16mm;color:#000}
.proposal-blueprint .bp-cover-title{font-size:24px;font-weight:700;color:#073763}
.proposal-blueprint .bp-h2{font-size:14px;font-weight:700;margin:12px 0 8px}
.proposal-blueprint .bp-table th{background:#073763;color:#fff;padding:8px 10px;font-weight:700}
.proposal-blueprint .bp-table td{padding:8px 10px;border:1px solid #808080}
`.trim();
assert(cssLooksComplete(completeCss), "complete CSS includes cover title, h2, table th");

const zifoHtml = `
<div class="bp-playbook-root">
  <header class="bp-playbook-cover">
    <div class="bp-cover-brand">{{vendorName}}</div>
    <h1 class="bp-cover-title">Commercial Proposal</h1>
    <div class="bp-cover-prepared">Prepared for {{customerName}}</div>
    <div class="bp-cover-date">{{date}}</div>
  </header>
  <section class="bp-section" data-slot="cover_overview">
    <h2 class="bp-h2" data-slot-title>Overview</h2>
    <div class="bp-body" data-slot-body></div>
  </section>
  <section class="bp-section" data-slot="monthly_recurring_charges">
    <h2 class="bp-h2" data-slot-title>Monthly Recurring Charges</h2>
    <div class="bp-body" data-slot-body></div>
    <table class="bp-table" data-slot-table="monthly_recurring_charges">
      <thead><tr><th>Charges</th><th>Requested Solution</th><th>Recommended Solution</th></tr></thead>
      <tbody></tbody>
    </table>
  </section>
</div>
`.trim();
assert(htmlLooksLikeSkeleton(zifoHtml), "ZIFO-like shell is a skeleton");

const persisted = buildPlaybookTemplateBlueprint({
  layoutStyle: { coverStyle: "left", headingColor: "#073763", fontFamily: "Arial" },
  css: completeCss,
  html: zifoHtml,
  sections: [
    { key: "cover_overview", title: "Overview" },
    {
      key: "monthly_recurring_charges",
      title: "Monthly Recurring Charges",
      tableSpec: {
        shape: "subscription",
        columns: ["Charges", "Requested Solution", "Recommended Solution"],
      },
    },
  ],
  featureSchema: {
    tables: [
      {
        key: "monthly_recurring_charges",
        columns: ["Charges", "Requested Solution", "Recommended Solution"],
      },
    ],
  },
});
assert(persisted.html.includes("Commercial Proposal"), "keeps Gemini cover title");
assert(persisted.html.includes('data-slot="cover_overview"'), "keeps Gemini slots");
assert(
  persisted.html.includes('data-slot-table="monthly_recurring_charges"'),
  "keeps Gemini table shell",
);
assert(cssLooksComplete(persisted.css), "merges generated CSS with complete learned CSS");

const emptyLearn = buildPlaybookTemplateBlueprint({
  layoutStyle: { coverStyle: "left", headingColor: "#073763" },
  css: compactCss,
  html: "",
  sections: [{ key: "scope", title: "Scope" }],
});
assert(!emptyLearn.html, "does not persist CRM fallback HTML when Gemini html is empty");
assert(!cssLooksComplete(emptyLearn.css), "compact CSS cannot win persist");
assert(
  !playbookVisualTemplateReady({
    mode: "playbook-template",
    html: "",
    css: compactCss,
  }),
  "generate must refuse empty playbook-template html",
);

const learnCheck = assertPlaybookSkeleton({
  html: persisted.html,
  css: persisted.css,
  sectionOrder: ["cover_overview", "monthly_recurring_charges"],
  tableSpecKeys: ["monthly_recurring_charges"],
});
assert(learnCheck.ok, learnCheck.reasons.join("; ") || "learn skeleton validates");

const miceFilled = fillPlaybookTemplate({
  template: persisted,
  tokens: { vendorName: "ZIFO", customerName: "MICE Global", date: "9 Sep 2026" },
  sections: [
    {
      key: "cover_overview",
      title: "Overview",
      body: "MICE Global needs Intelligent CRM for 15 sales representatives and two-way Tally integration.",
    },
    {
      key: "monthly_recurring_charges",
      title: "Monthly Recurring Charges",
      body: "Pricing follows requested CRM seats versus the recommended platform.",
      tableRows: [{ cells: ["CRM seats", "15 users", "15 users + Tally sync"] }],
      tableSpec: {
        shape: "subscription",
        columns: ["Charges", "Requested Solution", "Recommended Solution"],
      },
    },
  ],
});
const generateCheck = validateGeneratedProposalHtml({
  html: miceFilled.html,
  sectionOrder: ["cover_overview", "monthly_recurring_charges"],
  tableSpecKeys: ["monthly_recurring_charges"],
  playbookId: "pb-zifo",
});
assert(generateCheck.ok, generateCheck.reasons.join("; ") || "filled ZIFO shell validates");
assert(/MICE Global/.test(miceFilled.html), "fills MICE customer token");
assert(/15 users \+ Tally sync/.test(miceFilled.html), "fills MICE table rows");

const frozenRendered = renderBlueprintHtml({
  blueprint: {
    version: 1,
    html:
      '<article class="proposal-doc">' +
      '<div class="cover-block bp-playbook-cover">' +
      '<p class="cover-brand">WORKTUAL</p>' +
      '<h1 class="cover-title">Old Deal</h1>' +
      '<p class="cover-prepared">Prepared for Historical</p>' +
      '<p class="cover-date">October 24, 2023</p>' +
      "</div>" +
      '<section data-slot="overview"><h1 class="sec-h">Overview</h1></section>' +
      "</article>",
    css: ".proposal-doc .cover-title{font-size:18px;font-weight:700}",
    mode: "playbook-template",
  },
  sections: [{ key: "extra", title: "Extra", body: "should not append leftover" }],
  tokens: {
    vendorName: "ZIFO",
    customerName: "MICE Global",
    date: "9 Sept 2026",
  },
});
assert(!/<header\b[^>]*bp-playbook-cover/i.test(frozenRendered), "does not inject a second header cover");
assert(!/should not append leftover/.test(frozenRendered), "does not append leftover sections");
assert(/WORKTUAL/.test(frozenRendered), "frozen cover keeps generated brand");
assert(/October 24, 2023/.test(frozenRendered), "frozen cover keeps generated date");

const chromeStripped = fillPlaybookTemplate({
  template: {
    html:
      '<article class="proposal-doc">' +
      '<div class="chrome-header">1. Product Portfolio Overview</div>' +
      '<div class="cover-block bp-playbook-cover">' +
      '<p class="cover-brand">{{vendorName}}</p>' +
      '<h1 class="cover-title">{{dealTitle}}</h1>' +
      "</div>" +
      '<section data-slot="product_portfolio_overview"><div class="bp-slot-body"></div></section>' +
      "</article>",
    css: ".proposal-doc .cover-title{font-size:18px}",
    mode: "playbook-template",
  },
  tokens: { vendorName: "ZIFO", dealTitle: "MICE Global — Divya (Bengaluru)" },
  sections: [
    {
      key: "product_portfolio_overview",
      title: "1. Product Portfolio Overview",
      body: "ZIFO Assist for MICE Global.",
    },
  ],
});
assert(
  !/chrome-header/.test(chromeStripped.html),
  "drops numbered section title that was learned as a running header",
);

const goldBodyHeader = fillPlaybookTemplate({
  template: {
    html:
      '<article class="proposal-doc">' +
      '<div class="chrome-header">This integrated approach enables Rockwell Industries to connect customer</div>' +
      '<div class="cover-block bp-playbook-cover">' +
      '<p class="cover-brand">{{vendorName}}</p>' +
      "</div>" +
      "</article>",
    css: "",
    mode: "playbook-template",
  },
  tokens: { vendorName: "WORKTUAL", customerName: "orange" },
  sections: [],
  otherCustomerNames: ["Rockwell Industries"],
});
assert(
  !/Rockwell/i.test(goldBodyHeader.html),
  "drops gold body copy that was frozen as a cover running header",
);
assert(
  !/chrome-header/.test(goldBodyHeader.html),
  "does not keep a sentence-like chrome-header on a new deal",
);
assert(
  isUsableRunningChrome("ZIFO Confidential") &&
    !isUsableRunningChrome(
      "This integrated approach enables Rockwell Industries to connect customer",
    ),
  "running chrome allows boilerplate and rejects gold sentences",
);

const goldHeaderPdf = renderBlueprintHtml({
  blueprint: {
    version: 1,
    html:
      '<article class="proposal-doc">' +
      '<div class="chrome-header">This integrated approach enables Rockwell Industries to connect customer</div>' +
      '<div class="cover-block bp-playbook-cover"><p class="cover-brand">WORKTUAL</p></div>' +
      "</article>",
    css: "",
    mode: "playbook-template",
  },
  sections: [],
  tokens: { vendorName: "WORKTUAL", customerName: "orange" },
});
assert(!/Rockwell/i.test(goldHeaderPdf), "PDF render also strips leaked gold chrome-header");
assert(/MICE Global/.test(chromeStripped.html), "fills deal title on the learned cover");
assert(
  /ZIFO Assist for MICE Global/.test(chromeStripped.html),
  "fills section prose into bp-slot-body (frozen HTML has no data-slot-body)",
);
assert(!/TOPSPEC/.test(chromeStripped.html), "does not dump catalog SKUs onto the cover");

const coverUsesProductScope = fillPlaybookTemplate({
  template: {
    html:
      '<article class="proposal-doc">' +
      '<div class="cover-block bp-playbook-cover">' +
      '<p class="cover-brand">{{vendorName}}</p>' +
      '<h1 class="cover-title">{{dealTitle}}</h1>' +
      "</div>" +
      '<section data-slot="overview"><div class="bp-slot-body"></div></section>' +
      "</article>",
    css: "",
    mode: "playbook-template",
  },
  tokens: {
    vendorName: "ZIFO",
    dealTitle: "Opportunity — Gugan S",
    productScope: "Proactive Contact Centre",
  },
  sections: [{ key: "overview", title: "Overview", body: "CCaaS rollout." }],
});
assert(
  /Proactive Contact Centre/.test(coverUsesProductScope.html),
  "cover H1 uses productScope even when the frozen skeleton still has {{dealTitle}}",
);
assert(
  !/Opportunity — Gugan S/.test(coverUsesProductScope.html),
  "cover H1 does not leak the raw Opportunity-style deal title",
);

const coverProductScopeToken = fillPlaybookTemplate({
  template: {
    html:
      '<article class="proposal-doc">' +
      '<div class="cover-block bp-playbook-cover">' +
      '<h1 class="cover-title">{{productScope}}</h1>' +
      "</div>" +
      '<section data-slot="overview"><div class="bp-slot-body"></div></section>' +
      "</article>",
    css: "",
    mode: "playbook-template",
  },
  tokens: {
    dealTitle: "Opportunity — Gugan S",
    productScope: "Proactive Contact Centre",
  },
  sections: [{ key: "overview", title: "Overview", body: "CCaaS rollout." }],
});
assert(
  /<h1 class="cover-title">Proactive Contact Centre<\/h1>/.test(
    coverProductScopeToken.html,
  ),
  "legacy skeletons with {{productScope}} in the H1 still fill the derived product name",
);

const goldCoverFilled = fillPlaybookTemplate({
  template: {
    html:
      '<article class="proposal-doc">' +
      '<div class="cover-block bp-playbook-cover">' +
      '<p class="cover-brand">{{vendorName}}</p>' +
      '<h1 class="cover-title bp-cover-title">{{dealTitle}}</h1>' +
      '<p class="cover-prepared">Prepared for {{customerName}}</p>' +
      "</div>" +
      '<section data-slot="overview"><div class="bp-slot-body"></div></section>' +
      "</article>",
    css: "",
    mode: "playbook-template",
    coverLayout: {
      brand: "WORKTUAL",
      title: "Commercial Proposal",
      tag_layout: "centered_wrap",
      product_tags: [
        "Cognitive CDP",
        "Proactive Contact Centre as a Solution",
      ],
      meta_rows: [],
    },
  },
  tokens: {
    vendorName: "Worktual",
    customerName: "positron",
    date: "Sep 14, 2026",
    dealTitle: "Opportunity — Gugan S",
    productScope: "AI Native Contact Centre (CCaaS)",
    documentTitle: "Customer Engagement & Proactive Contact Centre Solution",
  },
  productTags: ["AI Chatbot", "AI Voicebot", "Proactive Contact Centre"],
  allowedProducts: [
    "AI Native Contact Centre (CCaaS)",
    "Lola Voicebot",
  ],
  sections: [{ key: "overview", title: "Overview", body: "CCaaS rollout." }],
});
assert(
  /Customer Engagement &amp; Proactive Contact Centre Solution/.test(
    goldCoverFilled.html,
  ) || /Customer Engagement & Proactive Contact Centre Solution/.test(goldCoverFilled.html),
  "cover H1 is the generated document title",
);
assert(
  !/Commercial Proposal/.test(goldCoverFilled.html),
  "gold document-type H1 is not copied onto this deal",
);
assert(
  !/<h1[^>]*>AI Native Contact Centre/.test(goldCoverFilled.html),
  "product scope is not the cover title",
);
assert(
  /product-tags/.test(goldCoverFilled.html),
  "generated product-tag band is kept",
);
assert(
  /Proactive Contact Centre/.test(goldCoverFilled.html),
  "this draft's solutions fill the tag band",
);
assert(
  !/Cognitive CDP/.test(goldCoverFilled.html),
  "gold customer's unrelated products are not copied onto this deal",
);
assert(
  !/Intelligent CRM/.test(goldCoverFilled.html),
  "gold cover chips are not copied onto this deal",
);
assert(
  !/Opportunity — Gugan S/.test(goldCoverFilled.html),
  "raw opportunity title stays off the cover",
);

const tableOnlyFilled = fillPlaybookTemplate({
  template: {
    html:
      '<article class="proposal-doc">' +
      '<div class="cover-block bp-playbook-cover"><p class="cover-brand">Vendor</p></div>' +
      '<section data-slot="pricing"><table class="bp-table" data-slot-table="pricing"><thead><tr><th>Charges</th></tr></thead><tbody><tr></tr></tbody></table></section>' +
      "</article>",
    css: "",
    mode: "playbook-template",
  },
  tokens: {},
  sections: [
    {
      key: "pricing",
      title: "Pricing",
      body: "Monthly licensing for Lola Voicebot at catalog rates.",
    },
  ],
});
assert(
  /Monthly licensing for Lola Voicebot/.test(tableOnlyFilled.html),
  "prepends prose when a frozen slot is table-only",
);

const comparisonTemplate = {
  html:
    '<article class="proposal-doc">' +
    '<div class="cover-block bp-playbook-cover"><p class="cover-brand">Vendor</p></div>' +
    '<section data-slot="what_we_compare"><h2 data-slot-title>What We Compare</h2><div data-slot-body></div></section>' +
    "</article>",
  css: "",
  mode: "playbook-template",
};
const comparisonDefaulted = fillPlaybookTemplate({
  template: comparisonTemplate,
  tokens: {},
  sections: [
    {
      key: "what_we_compare",
      title: "What We Compare",
      body: "We compare features across vendors.",
    },
  ],
});
assert(
  /data-slot-table="what_we_compare"/.test(comparisonDefaulted.html),
  "without a comparisonKind signal, comparison-family keys still default to a generic grid (baseline)",
);
const comparisonNarrative = fillPlaybookTemplate({
  template: comparisonTemplate,
  tokens: {},
  sections: [
    {
      key: "what_we_compare",
      title: "What We Compare",
      body: "We compare features across vendors in prose — no grid in the gold instance.",
      tableSpec: { comparisonKind: "narrative" },
    },
  ],
});
assert(
  !/data-slot-table="what_we_compare"/.test(comparisonNarrative.html),
  "tableSpec.comparisonKind narrative suppresses the generic comparison grid even though the key matches",
);

const frozenTokenRendered = renderBlueprintHtml({
  blueprint: {
    version: 1,
    html:
      '<article class="proposal-doc">' +
      '<p class="cover-brand">{{vendorName}}</p>' +
      '<section data-slot="overview"><h1 class="sec-h">Overview</h1></section>' +
      "</article>",
    css: ".proposal-doc .cover-title{font-size:18px;font-weight:700}",
    mode: "playbook-template",
  },
  sections: [],
  tokens: { vendorName: "ZIFO" },
});
assert(/ZIFO/.test(frozenTokenRendered), "fills leftover cover tokens");
assert(!/\{\{vendorName\}\}/.test(frozenTokenRendered), "drops leftover vendor token");

const frozenCoverScopeRendered = renderBlueprintHtml({
  blueprint: {
    version: 1,
    html:
      '<article class="proposal-doc">' +
      '<div class="cover-block bp-playbook-cover">' +
      '<h1 class="cover-title">{{dealTitle}}</h1>' +
      "</div>" +
      '<section data-slot="overview"><h1 class="sec-h">Overview</h1></section>' +
      "</article>",
    css: ".proposal-doc .cover-title{font-size:18px;font-weight:700}",
    mode: "playbook-template",
  },
  sections: [],
  tokens: {
    dealTitle: "Opportunity — Gugan S",
    productScope: "Proactive Contact Centre",
  },
});
assert(
  /Proactive Contact Centre/.test(frozenCoverScopeRendered),
  "renderBlueprintHtml leftover {{dealTitle}} cover token fills productScope",
);
assert(
  !/Opportunity — Gugan S/.test(frozenCoverScopeRendered),
  "renderBlueprintHtml leftover cover token does not keep the raw deal title",
);

const headerTokenRendered = renderBlueprintHtml({
  blueprint: {
    version: 1,
    html:
      '<article class="proposal-doc"><table class="grid"><thead><tr><th>Item</th></tr></thead><tbody></tbody></table></article>',
    css:
      ".proposal-doc{--c-th:#1f4e79}\n.proposal-doc table.grid th{background:#ffffff;font-weight:700}",
    mode: "playbook-template",
  },
  sections: [],
  tokens: {},
});
assert(
  /background:var\(--c-th\)/.test(headerTokenRendered),
  "applies stored --c-th when freeze CSS left headers white",
);

const extraSlotFilled = fillPlaybookTemplate({
  template: {
    html: `<div class="proposal-doc"><section data-slot="overview"><h2 data-slot-title>Overview</h2><div data-slot-body></div></section></div>`,
    css: "",
  },
  tokens: {},
  sections: [
    { key: "overview", title: "Overview", body: "Cover the ask." },
    {
      key: "architecture",
      title: "Architecture",
      body: "Describe the technical design.",
    },
  ],
});
assert(
  /data-slot="architecture"/.test(String(extraSlotFilled.html || "")),
  "fill appends BRD-only chapters missing from the frozen skeleton",
);

const centeredCover = applyPlaybookCoverHtml(
  '<article class="proposal-doc"><div class="cover-block bp-playbook-cover"><p class="cover-brand">Old</p></div></article>',
  {
    coverLayout: { cover_align: "center", brand: "WORKTUAL" },
    tokens: {
      vendorName: "WORKTUAL",
      documentTitle: "MICE Global — Divya (Bengaluru)",
      customerName: "Acme",
      date: "9 Sept 2026",
    },
  },
);
assert(
  /cover-block bp-playbook-cover cover-align-center/.test(centeredCover),
  "rebuilt cover stores cover-align-center from the gold group",
);
assert(/WORKTUAL/.test(centeredCover), "rebuilt centered cover keeps vendor brand");
assert(
  /MICE Global/.test(centeredCover),
  "rebuilt centered cover keeps document title",
);

const leftCover = applyPlaybookCoverHtml(
  '<article class="proposal-doc"><div class="cover-block bp-playbook-cover cover-align-center"><p class="cover-brand">Old</p></div></article>',
  {
    coverLayout: { cover_align: "left" },
    tokens: { vendorName: "Vendor", documentTitle: "Quote", customerName: "Acme" },
  },
);
assert(
  /cover-align-left/.test(leftCover) && !/cover-align-center/.test(leftCover),
  "left gold cover replaces a leftover center class",
);

const painHtml = fillPlaybookTemplate({
  template: {
    html:
      '<article class="proposal-doc">' +
      '<div class="cover-block bp-playbook-cover"><p class="cover-brand">WORKTUAL</p></div>' +
      '<section data-slot="challenges"><h1 class="sec-h">Challenges</h1><div class="bp-slot-body"></div></section>' +
      "</article>",
    css: ".proposal-doc .cover-block{text-align:center}.proposal-doc .cover-title{text-align:left}",
  },
  tokens: {},
  sections: [
    {
      key: "challenges",
      title: "Challenges",
      body:
        "- High volume of manual collection and reminder calls\n" +
        "- Difficulty in following up with NPA/non-payment accounts",
    },
  ],
});
assert(!/<table\b/i.test(painHtml.html), "does not invent a table from prose bullets");
assert(!/Col 1/.test(painHtml.html), "does not invent Col 1/2/3 headers");
assert(
  /High volume of manual collection/.test(painHtml.html),
  "keeps challenge bullets as section copy",
);
assert(
  /\bcover-align-center\b/.test(painHtml.html),
  "stamps cover-align from frozen cover-block CSS so PDF matches preview",
);

assert(
  tableRowsFromBody(
    "- High volume of manual collection and reminder calls\n- Manual capture of responses",
    3,
  ).length === 0,
  "unsplit bullets are not turned into a 3-column table",
);
assert(
  inferCoverAlign(
    '<div class="cover-block bp-playbook-cover"></div>',
    ".proposal-doc .cover-brand{text-align:center}.proposal-doc .cover-title{text-align:left}.proposal-doc .cover-prepared{text-align:left}.proposal-doc .cover-date{text-align:center}",
  ) === "center",
  "group vote prefers center when gold brand/date are centered",
);
assert(
  inferCoverAlign(
    '<div class="cover-block bp-playbook-cover"></div>',
    ".proposal-doc .cover-block{text-align:left}",
  ) === "left",
  "left gold cover_align stays left",
);
assert(
  /cover-align-left/.test(
    applyCoverAlignClass(
      '<div class="cover-block bp-playbook-cover"></div>',
      ".proposal-doc .cover-block{text-align:left}",
    ),
  ),
  "applies cover-align-left from frozen CSS",
);

console.log("proposal-playbook-layout.test.ts ok");
