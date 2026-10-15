/**
 * Verify proposal / quote / invoice clone fidelity invariants.
 * Usage: npx tsx --env-file=../.env scripts/verify-document-template-clone.ts
 *
 * Asserts: uploaded template layout stays intact; only product/content tokens change.
 */
import { prisma } from "../src/dao/db/prisma";
import { ensureDefaultInvoiceTemplate } from "../src/dao/finance/invoice-template-service";
import { ensureDefaultProposalTemplate } from "../src/dao/sales/proposal-template-service";
import { ensureDefaultQuoteTemplate } from "../src/dao/sales/quote-template-service";
import {
  invoiceLinesPipeTable,
  invoiceTotalsMarkdown,
} from "../src/lib/commercial-line-table";
import { defaultDocumentBlueprint } from "../src/lib/document-blueprint";
import { adaptProposalVisuals } from "../src/service/sales/proposal-visuals";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function assertInvoiceDoesNotInventHero() {
  const letterhead = {
    version: 1 as const,
    theme: {
      primary: "#1e3a5f",
      secondary: "#64748b",
      fonts: "Arial",
      background: "#ffffff",
    },
    slots: [{ key: "line_items", label: "Line items" }],
    css: ".proposal-blueprint{font-family:Arial}",
    html: `<header class="bp-letterhead"><img class="bp-logo" src="asset:logo" alt=""/></header>
<div class="bp-invoice-meta">Invoice # {{invoiceNumber}}</div>
<section class="bp-section" data-slot="line_items"><h2>Line items</h2><div class="bp-body" data-slot-body></div></section>`,
  };
  const assets = [
    {
      id: "logo",
      kind: "image" as const,
      mime: "image/png",
      dataBase64: "aaaa",
    },
  ];
  const visuals = await adaptProposalVisuals({
    blueprint: letterhead,
    assets,
    product: {
      id: "p1",
      name: "Ticketing",
      imageUrl: null,
      tagline: null,
    },
    dealTitle: "Opportunity — Manoj",
    productHint: "Ticketing + Campaign",
    kind: "invoice",
  });
  const html = visuals.blueprint?.html || "";
  assert(!/bp-hero-banner/i.test(html), "invoice must not invent hero banner");
  assert(!/bp-hero\b/i.test(html), "invoice must not invent bp-hero");
  assert(
    /bp-letterhead/i.test(html),
    "invoice must keep letterhead from template",
  );
  assert(
    /bp-logo/i.test(html),
    "invoice must keep logo slot from template",
  );
  console.log("OK invoice: letterhead clone, no invented hero");
}

async function assertProposalOnlySwapsExistingHero() {
  const withHero = {
    version: 1 as const,
    theme: {
      primary: "#365F91",
      secondary: "#5F62F1",
      fonts: "Calibri",
      background: "#ffffff",
    },
    slots: [{ key: "introduction", label: "Introduction" }],
    css: ".proposal-blueprint{}",
    html: `<div class="bp-cover-page">
<p class="bp-cover-deal">({{dealTitle}})</p>
<p class="bp-cover-date">{{date}}</p>
<img class="bp-hero" src="asset:hero" alt=""/>
</div>
<section class="bp-section" data-slot="introduction"><h2>Intro</h2><div class="bp-body" data-slot-body></div></section>`,
  };
  const noHero = {
    ...withHero,
    html: `<div class="bp-cover-page">
<p class="bp-cover-deal">({{dealTitle}})</p>
<p class="bp-cover-date">{{date}}</p>
</div>
<section class="bp-section" data-slot="introduction"><h2>Intro</h2><div class="bp-body" data-slot-body></div></section>`,
  };

  const swapped = await adaptProposalVisuals({
    blueprint: withHero,
    assets: [],
    product: { id: "p1", name: "CCaaS Suite", imageUrl: null, tagline: null },
    dealTitle: "Acme renewal",
    productHint: "CCaaS",
    kind: "proposal",
  });
  assert(
    /\{\{productScope\}\}/.test(swapped.blueprint?.html || ""),
    "proposal with hero should rewrite deal title to productScope",
  );
  assert(
    /bp-hero-banner|bp-hero/i.test(swapped.blueprint?.html || ""),
    "proposal with hero slot may use banner/hero for product",
  );

  const untouched = await adaptProposalVisuals({
    blueprint: noHero,
    assets: [],
    product: { id: "p1", name: "Ticketing", imageUrl: null, tagline: null },
    dealTitle: "Acme",
    productHint: "Ticketing",
    kind: "proposal",
  });
  assert(
    !/bp-hero-banner/i.test(untouched.blueprint?.html || ""),
    "proposal without hero slot must not invent a banner (clone-safe)",
  );
  console.log("OK proposal: hero only when template has a hero slot");
}

async function assertQuoteSameCloneRules() {
  const letterhead = defaultDocumentBlueprint("quote");
  const before = letterhead.html;
  const visuals = await adaptProposalVisuals({
    blueprint: letterhead,
    assets: [],
    product: { id: "p1", name: "CRM", imageUrl: null, tagline: null },
    dealTitle: "Deal",
    productHint: "CRM + Campaign",
    kind: "quote",
  });
  const after = visuals.blueprint?.html || "";
  // Structure markers from default quote blueprint should survive
  const hadCover = /bp-cover|bp-letterhead|quotation/i.test(before);
  if (hadCover) {
    assert(
      /bp-cover|bp-letterhead|quotation/i.test(after),
      "quote adapt must keep cover/letterhead structure",
    );
  }
  if (!/bp-hero|asset:hero|bp-hero-banner/i.test(before)) {
    assert(
      !/bp-hero-banner/i.test(after),
      "quote without hero must not invent banner",
    );
  }
  console.log("OK quote: clone-safe adapt");
}

function assertInvoiceLineTableShape() {
  const table = invoiceLinesPipeTable(
    [
      {
        name: "AI Native Campaign Management",
        quantity: 1,
        unitPrice: 35000,
        amount: 35000,
        taxPercent: 18,
      },
    ],
    "USD",
  );
  assert(
    table.includes("Tax %") && table.includes("Amount (incl. tax)"),
    "invoice table must match template columns",
  );
  assert(table.includes("41,300.00") || table.includes("41300"), "incl-tax amount");
  const totals = invoiceTotalsMarkdown({
    currency: "USD",
    subtotal: 35000,
    taxAmount: 6300,
    taxDetails: {
      components: [
        { label: "CGST", percent: 9, amount: 3150 },
        { label: "SGST", percent: 9, amount: 3150 },
      ],
      summaryLines: ["Intra-state supply · GST 18%"],
    },
    total: 41300,
  });
  assert(/CGST/i.test(totals) && /SGST/i.test(totals), "CGST/SGST in totals");
  assert(/Amount due/i.test(totals), "Amount due label");
  console.log("OK invoice: line table + CGST/SGST totals");
}

async function assertDbTemplatesHaveBlueprints(orgId: string) {
  const [proposal, quote, invoice] = await Promise.all([
    ensureDefaultProposalTemplate(orgId),
    ensureDefaultQuoteTemplate(orgId),
    ensureDefaultInvoiceTemplate(orgId),
  ]);
  for (const [label, tpl] of [
    ["proposal", proposal],
    ["quote", quote],
    ["invoice", invoice],
  ] as const) {
    assert(tpl.blueprint, `${label} default template missing blueprint`);
    console.log(`OK ${label} template:`, tpl.name, "blueprint=yes");
  }
}

async function main() {
  const orgId =
    process.env.SEED_ORGANIZATION_ID ||
    "1000";

  await assertInvoiceDoesNotInventHero();
  await assertProposalOnlySwapsExistingHero();
  await assertQuoteSameCloneRules();
  assertInvoiceLineTableShape();
  await assertDbTemplatesHaveBlueprints(orgId);

  console.log("verify-document-template-clone: OK (all three)");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
