/**
 * Matrix test: cover hero selection for each catalog product + combinations.
 * Run: npx tsx --env-file=../.env scripts/test-proposal-product-covers.ts
 */
import { prisma } from "../src/dao/db/prisma";
import {
  parseBlueprintAssets,
  parseDocumentBlueprint,
} from "../src/lib/document-blueprint";
import {
  adaptProposalVisuals,
  proposalProductFamilies,
  proposalProductFamily,
  sampleHeroCompatibleWithAsk,
  type DealProductVisual,
} from "../src/service/sales/proposal-visuals";

type Expect = {
  label: string;
  product: DealProductVisual | null;
  productHint: string | null;
  expectSampleHero: boolean;
  expectBanner: boolean;
  expectProductImage?: boolean;
  expectFamilies: string[];
  /** Substring that must appear in productScope (multi-product covers). */
  expectScopeIncludes?: string;
};

function toVisual(row: {
  id: string;
  name: string;
  tagline: string | null;
  imageUrl: string | null;
  description?: string | null;
  specifications?: string | null;
  sku: string | null;
  price?: string | null;
  currency?: string | null;
  category?: string | null;
}): DealProductVisual {
  return {
    productId: row.id,
    name: row.name,
    tagline: row.tagline,
    imageUrl: row.imageUrl,
    description: row.description ?? null,
    specifications: row.specifications ?? null,
    sku: row.sku,
    price: row.price ?? null,
    currency: row.currency ?? null,
    category: row.category ?? null,
  };
}

async function runCase(
  blueprint: unknown,
  assets: unknown,
  c: Expect,
): Promise<{ ok: boolean; detail: string }> {
  const ask = `${c.product?.name ?? ""} ${c.productHint ?? ""}`;
  const families = proposalProductFamilies(ask);
  const visuals = await adaptProposalVisuals({
    blueprint,
    assets,
    product: c.product,
    dealTitle: "Opportunity — test",
    sellerAddress: null,
    productHint: c.productHint,
  });

  const hasHeroAsset = visuals.assets.some((a) => a.id === "hero");
  const html = visuals.blueprint?.html || "";
  const hasBanner = /bp-hero-banner/i.test(html);
  const hasImgHero = /<img\b[^>]*class="[^"]*\bbp-hero\b/i.test(html);
  const sampleOk = sampleHeroCompatibleWithAsk(ask);

  const familyOk =
    c.expectFamilies.length === families.length &&
    c.expectFamilies.every((f, i) => families[i] === f);

  let ok = familyOk;
  let why = "";

  if (c.expectSampleHero) {
    if (!hasHeroAsset || !hasImgHero || hasBanner) {
      ok = false;
      why = `expected sample/img hero; heroAsset=${hasHeroAsset} img=${hasImgHero} banner=${hasBanner}`;
    }
  } else if (c.expectProductImage) {
    if (!hasHeroAsset || !hasImgHero) {
      ok = false;
      why = `expected product image hero; heroAsset=${hasHeroAsset} img=${hasImgHero}`;
    }
  } else if (c.expectBanner) {
    if (hasHeroAsset || !hasBanner || hasImgHero) {
      ok = false;
      why = `expected banner only; heroAsset=${hasHeroAsset} img=${hasImgHero} banner=${hasBanner}`;
    }
  }

  if (c.expectScopeIncludes) {
    if (!visuals.productScope.toLowerCase().includes(c.expectScopeIncludes.toLowerCase())) {
      ok = false;
      why = `scope "${visuals.productScope}" missing "${c.expectScopeIncludes}"${why ? `; ${why}` : ""}`;
    }
  }

  if (!familyOk) {
    why = `families got [${families.join(",")}] expected [${c.expectFamilies.join(",")}]${why ? `; ${why}` : ""}`;
  }

  const detail = [
    c.label,
    `families=[${families.join(",")}] sampleOk=${sampleOk}`,
    `heroAsset=${hasHeroAsset} banner=${hasBanner} img=${hasImgHero}`,
    `scope=${visuals.productScope}`,
    why || "ok",
  ].join(" | ");

  return { ok, detail };
}

async function main() {
  const template = await prisma.proposalTemplate.findFirst({
    where: { name: "worktual" },
  });
  if (!template?.blueprint) throw new Error("worktual template missing");

  const assets = parseBlueprintAssets(template.assets);
  if (!assets.some((a) => a.id === "hero")) {
    throw new Error("template missing sample hero — cannot verify skip logic");
  }

  const rows = await prisma.product.findMany({
    where: {
      OR: [
        { sku: { startsWith: "WT-" } },
        { id: { startsWith: "wt-product-" } },
      ],
    },
    select: {
      id: true,
      name: true,
      tagline: true,
      imageUrl: true,
      description: true,
      specifications: true,
      sku: true,
      price: true,
      currency: true,
      category: true,
    },
    orderBy: { name: "asc" },
  });

  const bySku = new Map(rows.map((r) => [r.sku || r.id, r]));
  const ticketing = toVisual(bySku.get("WT-TICKETING")!);
  const ccaas = toVisual(bySku.get("WT-CCAAS")!);
  const campaign = toVisual(bySku.get("WT-CAMPAIGN")!);
  const crm = toVisual(bySku.get("WT-CRM")!);
  const cvm = toVisual(bySku.get("WT-CVM")!);
  const cdp = toVisual(bySku.get("WT-CDP")!);
  const web = toVisual(bySku.get("WT-WEBTRACK")!);

  // Catalog product with a real image (optional path).
  const ccaasWithImage = await prisma.product.findFirst({
    where: { name: "CCaaS", imageUrl: { not: null } },
    select: {
      id: true,
      name: true,
      tagline: true,
      imageUrl: true,
      description: true,
      specifications: true,
      sku: true,
      price: true,
      currency: true,
      category: true,
    },
  });

  const cases: Expect[] = [
    // —— Single products ——
    {
      label: "CCaaS (WT)",
      product: ccaas,
      productHint: null,
      expectSampleHero: true,
      expectBanner: false,
      expectFamilies: ["ccaas"],
    },
    {
      label: "Ticketing",
      product: ticketing,
      productHint: null,
      expectSampleHero: false,
      expectBanner: true,
      expectFamilies: ["ticketing"],
    },
    {
      label: "Campaign",
      product: campaign,
      productHint: null,
      expectSampleHero: false,
      expectBanner: true,
      expectFamilies: ["campaign"],
    },
    {
      label: "CRM",
      product: crm,
      productHint: null,
      expectSampleHero: false,
      expectBanner: true,
      expectFamilies: ["crm"],
    },
    {
      label: "CVM",
      product: cvm,
      productHint: null,
      expectSampleHero: false,
      expectBanner: true,
      expectFamilies: ["cvm"],
    },
    {
      label: "CDP",
      product: cdp,
      productHint: null,
      expectSampleHero: false,
      expectBanner: true,
      expectFamilies: ["cdp"],
    },
    {
      label: "Web Tracking",
      product: web,
      productHint: null,
      expectSampleHero: false,
      expectBanner: true,
      expectFamilies: ["web"],
    },
    // —— Hint-only (no resolved product row) ——
    {
      label: "hint: ticketing system",
      product: null,
      productHint: "ticketing system",
      expectSampleHero: false,
      expectBanner: true,
      expectFamilies: ["ticketing"],
    },
    {
      label: "hint: contact centre",
      product: null,
      productHint: "AI Contact Centre",
      expectSampleHero: true,
      expectBanner: false,
      expectFamilies: ["ccaas"],
    },
    {
      label: "hint: campaign management",
      product: null,
      productHint: "campaign management",
      expectSampleHero: false,
      expectBanner: true,
      expectFamilies: ["campaign"],
    },
    // —— Combinations ——
    {
      label: "combo: ticketing + CCaaS",
      product: ticketing,
      productHint: "AI Native Ticketing System + AI Native Contact Centre (CCaaS)",
      expectSampleHero: false,
      expectBanner: true,
      expectFamilies: ["ticketing", "ccaas"],
      expectScopeIncludes: "Ticketing",
    },
    {
      label: "combo: CCaaS + ticketing (hint order)",
      product: ccaas,
      productHint: "Contact Centre and ticketing",
      expectSampleHero: false,
      expectBanner: true,
      expectFamilies: ["ticketing", "ccaas"],
      expectScopeIncludes: "ticketing",
    },
    {
      label: "combo: CRM + Campaign",
      product: crm,
      productHint: "CRM and Campaign Management",
      expectSampleHero: false,
      expectBanner: true,
      expectFamilies: ["campaign", "crm"],
    },
    {
      label: "combo: CDP + CVM",
      product: cdp,
      productHint: "CDP and Customer Value Management",
      expectSampleHero: false,
      expectBanner: true,
      expectFamilies: ["cvm", "cdp"],
    },
    {
      label: "combo: CCaaS + Campaign",
      product: ccaas,
      productHint: "CCaaS and campaign management",
      expectSampleHero: false,
      expectBanner: true,
      expectFamilies: ["ccaas", "campaign"],
    },
    {
      label: "combo: ticketing + CRM + CDP",
      product: ticketing,
      productHint: "Ticketing, CRM, and CDP",
      expectSampleHero: false,
      expectBanner: true,
      expectFamilies: ["ticketing", "crm", "cdp"],
    },
  ];

  if (ccaasWithImage?.imageUrl) {
    cases.push({
      label: "CCaaS with catalog imageUrl",
      product: toVisual(ccaasWithImage),
      productHint: null,
      expectSampleHero: false,
      expectBanner: false,
      expectProductImage: true,
      expectFamilies: ["ccaas"],
    });
  }

  console.log("Family smoke:");
  for (const name of rows.map((r) => r.name)) {
    console.log(`  ${name} → ${proposalProductFamily(name)} [${proposalProductFamilies(name).join(",")}]`);
  }

  let failed = 0;
  console.log("\nCover matrix:");
  for (const c of cases) {
    const result = await runCase(template.blueprint, template.assets, c);
    console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.detail}`);
    if (!result.ok) failed += 1;
  }

  console.log(`\n${cases.length - failed}/${cases.length} passed`);
  await prisma.$disconnect();
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
