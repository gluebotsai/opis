/**
 * Adapt proposal blueprint/assets for a deal.
 * Keep uploaded template HTML/CSS stable; only swap tokens and optional hero image.
 */

import { prisma } from "@/dao/db/prisma";
import {
  parseBlueprintAssets,
  parseDocumentBlueprint,
  stabilizeTemplateCss,
  type BlueprintAsset,
  type DocumentBlueprint,
} from "@/lib/document-blueprint";

const MAX_HERO_BYTES = 500_000;

const HERO_BANNER_CSS = `
.proposal-blueprint .bp-hero{display:block;width:100%;max-width:560px;margin:12px auto 0;object-fit:cover}
.proposal-blueprint .bp-hero-banner{display:block;width:100%;max-width:560px;margin:16px auto 0;padding:28px 24px 32px;
text-align:left;border-radius:4px;background:linear-gradient(135deg,#0f766e 0%,#115e59 55%,#134e4a 100%);color:#fff;
box-sizing:border-box}
.proposal-blueprint .bp-hero-eyebrow{margin:0 0 8px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;
color:#5eead4;font-weight:600}
.proposal-blueprint .bp-hero-product{margin:0 0 10px;font-size:22px;line-height:1.25;font-weight:700;color:#fff}
.proposal-blueprint .bp-hero-tagline{margin:0;font-size:13px;line-height:1.45;color:rgba(255,255,255,.9);max-width:36em}
`.trim();

/** Product families used to decide whether the uploaded sample cover photo applies. */
export type ProposalProductFamily =
  | "ticketing"
  | "ccaas"
  | "campaign"
  | "crm"
  | "cvm"
  | "cdp"
  | "web"
  | "other";

/**
 * Uploaded sample proposal PDFs (e.g. Pothys) ship a Contact Centre / CCaaS cover.
 * Only reuse that hero when the ask is purely that family.
 */
export const SAMPLE_HERO_FAMILY: ProposalProductFamily = "ccaas";

const FAMILY_PATTERNS: Array<[ProposalProductFamily, RegExp]> = [
  ["ticketing", /\bticket(ing|s)?\b|itsm|service\s*desk/i],
  [
    "ccaas",
    /ccaas|contact\s*cent|\blola\b|voicebots?|chatbots?|voice\s*bots?|chat\s*bots?|agentic\s*ai\s*platform|omnichannel\s*contact/i,
  ],
  ["campaign", /campaign\s*manage|multi-?channel\s*campaign|\bcampaigns?\b/i],
  ["crm", /\bcrm\b|customer\s*relationship/i],
  ["cvm", /customer\s*value\s*manage|\bcvm\b|mau-based/i],
  ["cdp", /\bcdp\b|customer\s*data\s*platform/i],
  ["web", /web\s*track/i],
];

/**
 * Broad-recall SQL keywords per family, used only to widen the DB candidate
 * pool (name/description/category `contains`) before recency truncation.
 * Precision still comes from FAMILY_PATTERNS / scoreProductAgainstText on the
 * fetched rows — these just need to not miss a relevant row's category/name.
 */
const FAMILY_CATEGORY_HINTS: Record<Exclude<ProposalProductFamily, "other">, string[]> = {
  ticketing: ["ticket", "itsm", "service desk", "helpdesk"],
  ccaas: ["ccaas", "contact", "chat", "voice", "lola", "omnichannel", "engagement"],
  campaign: ["campaign", "marketing"],
  crm: ["crm"],
  cvm: ["cvm", "customer value"],
  cdp: ["cdp", "customer data"],
  web: ["web"],
};

/**
 * Needles that appear in ordinary Shopify/catalog copy ("contact us",
 * "marketing campaign", "customer engagement"). Searching *description*
 * for these pulls apparel and other unrelated SKUs into the candidate
 * pool; keep them on name/category only. Distinctive needles (ccaas,
 * lola, crm, …) may still search description.
 */
const GENERIC_SQL_NEEDLES = new Set([
  "contact",
  "chat",
  "voice",
  "engagement",
  "marketing",
  "web",
  "ticket",
  "campaign",
]);

/** All product families detected in free text (order = pattern priority). */
export function proposalProductFamilies(
  text: string | null | undefined,
): ProposalProductFamily[] {
  const t = text || "";
  if (!t.trim()) return ["other"];
  const found = FAMILY_PATTERNS.filter(([, re]) => re.test(t)).map(([f]) => f);
  return found.length > 0 ? found : ["other"];
}

/** Primary family (first pattern match). */
export function proposalProductFamily(
  text: string | null | undefined,
): ProposalProductFamily {
  return proposalProductFamilies(text)[0] ?? "other";
}

/**
 * Whether the template sample hero image may be used for this ask.
 * - Pure CCaaS → yes
 * - Any other single family → no (use product image or CSS banner)
 * - Combinations that mix CCaaS with another family → no
 */
export function sampleHeroCompatibleWithAsk(
  askText: string | null | undefined,
  sampleFamily: ProposalProductFamily = SAMPLE_HERO_FAMILY,
): boolean {
  const families = proposalProductFamilies(askText).filter((f) => f !== "other");
  if (families.length === 0) return false;
  return families.length === 1 && families[0] === sampleFamily;
}

function cssCoverBannerHtml(
  productName: string,
  tagline: string | null,
): string {
  const title = escapeHtml(productName || "Solution overview");
  const line = escapeHtml(
    tagline?.trim() || "Prepared for {{companyName}}",
  );
  return (
    `<div class="bp-hero-banner" role="img" aria-label="${title}">` +
    `<p class="bp-hero-eyebrow">Solution</p>` +
    `<h2 class="bp-hero-product">${title}</h2>` +
    `<p class="bp-hero-tagline">${line}</p>` +
    `</div>`
  );
}

function ensureHeroBannerCss(css: string): string {
  if (css.includes(".bp-hero-banner{")) return css;
  return `${css}\n${HERO_BANNER_CSS}`.trim();
}

export type DealProductVisual = {
  productId: string;
  name: string;
  tagline: string | null;
  imageUrl: string | null;
  description: string | null;
  specifications: string | null;
  sku: string | null;
  price: string | null;
  currency: string | null;
  category: string | null;
  unitOfMeasure?: string | null;
};

export type DealQuoteLineContext = {
  name: string;
  productId?: string | null;
  quantity: number | null;
  unitPrice: string | null;
  description: string | null;
};

export type DealProposalCatalog = {
  product: DealProductVisual | null;
  quoteLines: DealQuoteLineContext[];
};

const PRODUCT_SELECT = {
  id: true,
  name: true,
  tagline: true,
  description: true,
  specifications: true,
  sku: true,
  price: true,
  currency: true,
  category: true,
  imageUrl: true,
  galleryUrls: true,
  status: true,
  unitOfMeasure: true,
  billingFrequency: true,
} as const;

/** Pure needle computation behind Bug A's fetch — testable without a DB. */
export function categoryNeedlesForText(text: string | null | undefined): string[] {
  const families = proposalProductFamilies(text).filter(
    (f): f is Exclude<ProposalProductFamily, "other"> => f !== "other",
  );
  return Array.from(
    new Set(families.flatMap((f) => FAMILY_CATEGORY_HINTS[f] ?? [])),
  );
}

/**
 * Candidate catalog rows for relevance scoring, without letting a recency
 * window silently drop a relevant-but-stale product before scoring ever
 * sees it (Bug A). Merges three sources:
 *  - the most-recently-updated 80 (previous behaviour, kept as a floor)
 *  - any row whose category/name/description hints at a family detected in
 *    `haystack` (broad recall — precision still comes from the caller's
 *    scoreProductAgainstText / FAMILY_PATTERNS pass over these rows)
 *  - explicit productIds, so a chosen id can never fall outside the window
 */
async function fetchCandidateProducts(input: {
  organizationId: string;
  haystack: string;
  productIds?: string[] | null;
}) {
  const where = {
    organizationId: input.organizationId,
    status: { in: ["active", "draft"] as const },
  };

  const needles = categoryNeedlesForText(input.haystack);
  const explicitIds = (input.productIds ?? [])
    .map((id) => id?.trim())
    .filter((id): id is string => Boolean(id));

  const queries = [
    prisma.product.findMany({
      where,
      select: PRODUCT_SELECT,
      take: 80,
      orderBy: { updatedAt: "desc" },
    }),
  ];
  if (needles.length > 0) {
    queries.push(
      prisma.product.findMany({
        where: {
          ...where,
          OR: needles.flatMap((needle) => {
            const mode = "insensitive" as const;
            const nameCat = [
              { category: { contains: needle, mode } },
              { name: { contains: needle, mode } },
            ];
            if (GENERIC_SQL_NEEDLES.has(needle.toLowerCase())) return nameCat;
            return [
              ...nameCat,
              { description: { contains: needle, mode } },
            ];
          }),
        },
        select: PRODUCT_SELECT,
        take: 200,
      }),
    );
  }
  if (explicitIds.length > 0) {
    queries.push(
      prisma.product.findMany({
        where: { organizationId: input.organizationId, id: { in: explicitIds } },
        select: PRODUCT_SELECT,
      }),
    );
  }

  const results = await Promise.all(queries);
  const byId = new Map<string, (typeof results)[number][number]>();
  for (const list of results) {
    for (const p of list) byId.set(p.id, p);
  }
  return Array.from(byId.values());
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Case-insensitive substring test with word boundaries on both edges, so a
 * short token (e.g. "car") doesn't false-positive inside an unrelated word
 * (e.g. "jacquard"). Boundaries are alnum-aware, not just `\b`, so hyphens
 * inside the needle ("e-commerce") still require a real edge on each side.
 */
function includesWord(haystack: string, needle: string): boolean {
  const n = needle.trim();
  if (!n) return false;
  const pattern = new RegExp(
    `(?<![a-z0-9])${escapeRegExp(n)}(?![a-z0-9])`,
    "i",
  );
  return pattern.test(haystack);
}

function scoreNameMatch(haystack: string, needle: string): number {
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase().trim();
  if (!n || n.length < 2) return 0;
  if (includesWord(h, n)) return n.length;
  const parts = n.split(/\s+/).filter((p) => p.length > 2);
  let hit = 0;
  for (const p of parts) {
    if (includesWord(h, p)) hit += p.length;
  }
  return hit;
}

/** Stronger product↔text score — ignores generic tokens like "AI" / "customer". */
const GENERIC_PRODUCT_TOKENS = new Set([
  "native",
  "ai",
  "the",
  "and",
  "for",
  "system",
  "management",
  "customer",
  "data",
  "platform",
  "solution",
  "overview",
  "test",
  "crm",
]);

function scoreProductAgainstText(text: string, productName: string): number {
  const h = text.toLowerCase();
  const name = productName.toLowerCase().trim();
  if (!name || !h.trim()) return 0;
  if (includesWord(h, name)) return name.length * 4;
  const core = name.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (core.length >= 6 && includesWord(h, core)) return core.length * 3;
  const parts = name
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length > 2 && !GENERIC_PRODUCT_TOKENS.has(p));
  if (parts.length === 0) return 0;
  let hit = 0;
  let strong = false;
  for (const p of parts) {
    if (!includesWord(h, p)) continue;
    hit += p.length;
    if (p.length >= 5) strong = true;
  }
  // Need a distinctive token (ticketing, contact, centre, ccaas, campaign, …)
  return strong ? hit * 2 : 0;
}

/** Name / tagline / category only — marketing copy is not evidence the SKU was discussed. */
function productIdentityBlob(p: {
  name: string;
  tagline?: string | null;
  category?: string | null;
}): string {
  return [p.name, p.tagline, p.category].filter(Boolean).join("\n");
}

function productIdentityFamilies(p: {
  name: string;
  tagline?: string | null;
  category?: string | null;
}): ProposalProductFamily[] {
  const found = proposalProductFamilies(productIdentityBlob(p)).filter(
    (f) => f !== "other",
  );
  return found.length > 0 ? found : ["other"];
}

function productNamedInText(haystack: string, productName: string): boolean {
  const name = productName.trim().toLowerCase();
  if (name.length >= 6 && includesWord(haystack, name)) return true;
  const stem = name.split(/\s+[—–]\s+/)[0]?.trim() ?? "";
  if (stem.length >= 6 && stem !== name && includesWord(haystack, stem)) {
    return true;
  }
  return false;
}

function profileNameAligns(productName: string, profileName: string): boolean {
  const a = productName.trim().toLowerCase();
  const b = profileName.trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 6 && includesWord(b, a)) return true;
  if (b.length >= 6 && includesWord(a, b)) return true;
  return false;
}

/** Drop size/colour SKU tails ("Jacket — Charcoal / Waist 28") for the cover. */
function coverProductLabel(name: string): string {
  const stem = name.split(/\s+[—–]\s+/)[0]?.trim() || name.trim();
  return stem || name.trim();
}

function collapseCoverNames(names: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const label = coverProductLabel(raw);
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

/** Join catalog product names for cover / scope lines (meeting-discussed only). */
export function buildProductScopeLabel(
  products: Array<{ name: string }>,
): string {
  const names = collapseCoverNames(
    products.map((p) => p.name.trim()).filter(Boolean),
  ).slice(0, 4);
  if (!names.length) return "";
  if (names.length === 1) return names[0]!;
  return names.join(" • ");
}

const MAX_DISCUSSED_PRODUCTS = 8;

type CatalogPickRow = {
  id: string;
  name: string;
  tagline?: string | null;
  description?: string | null;
  category?: string | null;
};

/** Pick catalog rows named in a BRD/meeting (or profile), then fill missing families. */
export function pickDiscussedCatalogRows<T extends CatalogPickRow>(
  products: T[],
  haystack: string,
  opts?: {
    productIds?: string[] | null;
    profileProductNames?: string[];
    limit?: number;
  },
): T[] {
  const limit = opts?.limit ?? MAX_DISCUSSED_PRODUCTS;
  const seen = new Set<string>();
  const out: T[] = [];
  const add = (row: T | undefined) => {
    if (!row || seen.has(row.id) || out.length >= limit) return;
    seen.add(row.id);
    out.push(row);
  };

  for (const id of opts?.productIds ?? []) {
    const trimmed = id?.trim();
    if (!trimmed) continue;
    add(products.find((p) => p.id === trimmed));
  }

  const hay = haystack.toLowerCase();
  const profileNames = (opts?.profileProductNames ?? [])
    .map((n) => n.trim())
    .filter((n) => n.length >= 3);

  const discussedFamilies = proposalProductFamilies(haystack).filter(
    (f) => f !== "other",
  );

  const named = products
    .map((p) => {
      const name = p.name.trim();
      const namedInHay = productNamedInText(hay, name);
      let score = namedInHay ? 20 : 0;
      const identityFams = productIdentityFamilies(p);
      const familyFits =
        identityFams.some((f) => f !== "other" && discussedFamilies.includes(f));
      for (const pn of profileNames) {
        if (!profileNameAligns(name, pn)) continue;
        if (namedInHay || familyFits) score += 16;
      }
      score += scoreProductAgainstText(haystack, productIdentityBlob(p));
      return { p, score, namedInHay, identityFams };
    })
    .filter(({ score, namedInHay, identityFams }) => {
      if (score < 6) return false;
      const onlyOther =
        identityFams.length === 1 && identityFams[0] === "other";
      return !(onlyOther && !namedInHay);
    })
    .sort((a, b) => b.score - a.score);

  for (const { p } of named) add(p);

  for (const family of discussedFamilies) {
    if (out.length >= limit) break;
    const already = out.some((p) =>
      productIdentityFamilies(p).includes(family),
    );
    if (already) continue;
    const inFamily = products.filter((p) =>
      productIdentityFamilies(p).includes(family),
    );
    const ranked = inFamily
      .map((p) => ({
        p,
        score: scoreProductAgainstText(haystack, productIdentityBlob(p)),
      }))
      .sort((a, b) => b.score - a.score);
    add(ranked[0]?.p ?? inFamily[0]);
  }

  return out;
}

/**
 * Products explicitly discussed in meeting / requirement text — not every item
 * from an uploaded template's cover catalog dump.
 */
export async function resolveDiscussedCatalogProducts(input: {
  organizationId: string;
  text: string;
  productIds?: string[] | null;
  profileProductNames?: string[];
}): Promise<DealProductVisual[]> {
  const haystack = input.text.trim();
  if (!haystack && !(input.productIds ?? []).some((id) => id?.trim())) {
    return [];
  }

  const products = await fetchCandidateProducts({
    organizationId: input.organizationId,
    haystack: [haystack, ...(input.profileProductNames ?? [])].join("\n"),
    productIds: input.productIds,
  });

  return pickDiscussedCatalogRows(products, haystack, {
    productIds: input.productIds,
    profileProductNames: input.profileProductNames,
  }).map((p) => toProductVisual(p));
}

function toProductVisual(
  p: {
    id: string;
    name: string;
    tagline: string | null;
    description?: string | null;
    specifications?: string | null;
    sku?: string | null;
    price?: unknown;
    currency?: string | null;
    category?: string | null;
    unitOfMeasure?: string | null;
    imageUrl: string | null;
    galleryUrls?: unknown;
  },
): DealProductVisual {
  const fromGallery = firstGalleryUrl(p.galleryUrls);
  const imageUrl = p.imageUrl?.trim() || fromGallery;
  return {
    productId: p.id,
    name: p.name,
    tagline: p.tagline,
    imageUrl: imageUrl || null,
    description: p.description?.trim() || null,
    specifications: p.specifications?.trim() || null,
    sku: p.sku?.trim() || null,
    price: p.price != null ? String(p.price) : null,
    currency: p.currency?.trim() || null,
    category: p.category?.trim() || null,
    unitOfMeasure: p.unitOfMeasure ?? null,
  };
}

/** Pick catalog product + quote lines for this deal.
 * Priority: explicit productIds → productHint match → quote lines → title/notes.
 * When a hint is provided but matches nothing, do NOT fall back to an unrelated
 * quote/deal product (avoids CCaaS cover for a “ticketing” ask).
 */
export async function resolveDealProposalCatalog(input: {
  dealId: string;
  organizationId: string;
  dealTitle: string;
  dealNotes?: string | null;
  /** Free-text product/topic from chat (e.g. "ticketing system"). */
  productHint?: string | null;
  /** Explicit catalog product ids chosen by coworker / UI. */
  productIds?: string[] | null;
}): Promise<DealProposalCatalog> {
  const quote = await prisma.quote.findFirst({
    where: { dealId: input.dealId, organizationId: input.organizationId },
    orderBy: { updatedAt: "desc" },
    include: {
      lines: {
        orderBy: { sortOrder: "asc" },
        include: {
          product: {
            select: PRODUCT_SELECT,
          },
        },
      },
    },
  });

  const quoteLines: DealQuoteLineContext[] = (quote?.lines ?? []).map((line) => ({
    name: line.name?.trim() || line.product?.name?.trim() || "Line item",
    productId: line.productId?.trim() || line.product?.id?.trim() || null,
    quantity: line.quantity != null ? Number(line.quantity) : null,
    unitPrice: line.unitPrice != null ? String(line.unitPrice) : null,
    description: line.product?.description?.trim() || null,
  }));

  const products = await fetchCandidateProducts({
    organizationId: input.organizationId,
    haystack: [input.productHint, input.dealTitle, input.dealNotes]
      .filter(Boolean)
      .join("\n"),
    productIds: input.productIds,
  });

  const explicitIds = (input.productIds ?? [])
    .map((id) => id?.trim())
    .filter((id): id is string => Boolean(id));
  if (explicitIds.length > 0) {
    // fetchCandidateProducts always includes explicit ids directly, so this
    // never falls outside the candidate window regardless of recency/category.
    const byId = new Map(products.map((p) => [p.id, p]));
    for (const id of explicitIds) {
      const p = byId.get(id);
      if (p) return { product: toProductVisual(p), quoteLines };
    }
  }

  const hint = input.productHint?.trim() || "";
  if (hint) {
    let best: { score: number; product: (typeof products)[0] } | null = null;
    for (const p of products) {
      const blob = productIdentityBlob(p);
      const total = Math.max(
        scoreProductAgainstText(blob, hint),
        scoreProductAgainstText(hint, p.name),
        scoreProductAgainstText(blob, hint.split(/\s+/).slice(0, 4).join(" ")),
      );
      // Keep legacy token overlap as a weak signal for short hints ("ticketing").
      const weak =
        scoreNameMatch(p.name, hint) * 2 + scoreNameMatch(hint, p.name);
      const score = Math.max(total, weak >= 6 ? weak : 0);
      if (score <= 0) continue;
      if (!best || score > best.score) best = { score, product: p };
    }
    if (best && best.score >= 4) {
      return { product: toProductVisual(best.product), quoteLines };
    }
    // Hint given but no confident match — leave product unset so cover stays
    // on the template sample hero rather than an unrelated catalog image.
    return { product: null, quoteLines };
  }

  for (const line of quote?.lines ?? []) {
    const p = line.product;
    if (!p) continue;
    return { product: toProductVisual(p), quoteLines };
  }

  const haystack = `${input.dealTitle}\n${input.dealNotes ?? ""}`;
  let best: { score: number; product: (typeof products)[0] } | null = null;
  for (const p of products) {
    const score = scoreProductAgainstText(haystack, p.name);
    if (score <= 0) continue;
    if (!best || score > best.score) best = { score, product: p };
  }
  if (!best) return { product: null, quoteLines };

  return { product: toProductVisual(best.product), quoteLines };
}

/** Pick a catalog product for this deal (quote lines first, then title/notes match). */
export async function resolveDealProductVisual(input: {
  dealId: string;
  organizationId: string;
  dealTitle: string;
  dealNotes?: string | null;
}): Promise<DealProductVisual | null> {
  const { product } = await resolveDealProposalCatalog(input);
  return product;
}

function firstGalleryUrl(raw: unknown): string | null {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string" && item.trim()) return item.trim();
    }
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return firstGalleryUrl(parsed);
    } catch {
      return raw.trim() || null;
    }
  }
  return null;
}

function mimeFromBytes(buf: Buffer, hint?: string | null): string {
  if (hint && /^image\/(png|jpeg|jpg|webp|gif)$/i.test(hint)) {
    return hint.toLowerCase() === "image/jpg" ? "image/jpeg" : hint.toLowerCase();
  }
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x47 && buf[1] === 0x49) return "image/gif";
  if (buf.toString("ascii", 0, 4) === "RIFF") return "image/webp";
  return "image/jpeg";
}

async function fetchImageAsAsset(
  url: string,
): Promise<BlueprintAsset | null> {
  const trimmed = url.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("data:image/")) {
    const m = trimmed.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!m) return null;
    if (m[2].length > MAX_HERO_BYTES * 1.4) return null;
    return {
      id: "hero",
      kind: "image",
      mime: m[1],
      dataBase64: m[2],
    };
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    // Relative app path — skip fetch in API; treat as no image
    return null;
  }

  try {
    const res = await fetch(trimmed, {
      signal: AbortSignal.timeout(12_000),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const ctype = res.headers.get("content-type") || "";
    if (ctype && !ctype.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_HERO_BYTES) return null;
    return {
      id: "hero",
      kind: "image",
      mime: mimeFromBytes(buf, ctype.split(";")[0]),
      dataBase64: buf.toString("base64"),
    };
  } catch {
    return null;
  }
}

function looksLikeUploadedFilename(value: string): boolean {
  const s = value.trim();
  if (!s) return false;
  if (/\.(pdf|docx?|txt|xlsx)$/i.test(s)) return true;
  if (/\bbrd\b/i.test(s) && /\.pdf/i.test(s)) return true;
  return false;
}

function coverHeadline(
  productName: string | null,
  dealTitle: string,
  productHint?: string | null,
): string {
  const product = (productName || "").trim();
  let hint = (productHint || "").trim();
  if (looksLikeUploadedFilename(hint)) hint = "";
  if (product && looksLikeUploadedFilename(product)) {
    return hint || "Solution overview";
  }
  // Reject verb crumbs from “create a proposal for …” mis-parses.
  if (
    hint &&
    /^(create|draft|write|prepare|generate|make|start|build)(\s+(a|an|the|new|sales))?$/i.test(
      hint,
    )
  ) {
    hint = "";
  }
  // Multi-product asks: show the combined hint on the cover "for (…)" line.
  if (hint) {
    const hintFamilies = proposalProductFamilies(hint).filter(
      (f) => f !== "other",
    );
    if (hintFamilies.length > 1) return hint;
  }
  if (product) return product;
  if (hint) return hint;
  const raw = (dealTitle || "").trim();
  if (!raw || looksLikeUploadedFilename(raw)) return hint || product || "Solution overview";
  if (/^opportunity\b/i.test(raw) || /^deal\b/i.test(raw)) {
    return "Solution overview";
  }
  // "Opportunity — person" style deal titles
  if (/^opportunit(y|ies)\s*[—:-]/i.test(raw)) {
    return "Solution overview";
  }
  return raw;
}

/** Cover "for (…)" line — product/solution, never raw Opportunity deal titles. */
export function proposalProductScope(
  productName: string | null | undefined,
  dealTitle: string,
  productHint?: string | null,
): string {
  return coverHeadline(productName?.trim() || null, dealTitle, productHint);
}

/** Strip outer parentheses so the cover template can wrap once: ({{productScope}}). */
export function productScopeForCoverParens(
  scope: string | null | undefined,
): string {
  let s = (scope || "").trim();
  while (s.startsWith("(") && s.endsWith(")") && s.length > 2) {
    s = s.slice(1, -1).trim();
  }
  if (looksLikeUploadedFilename(s)) return "";
  return s;
}

/**
 * Recover a product/topic previously baked into the proposal title or summary
 * (e.g. "Proposal for Hexaware — AI Native Contact Centre (CCaaS)" or
 * "… covering AI Native Contact Centre (CCaaS).").
 */
export function extractStoredProductScope(input: {
  title?: string | null;
  summary?: string | null;
}): string | null {
  const title = (input.title || "").trim();
  if (title.includes("—")) {
    const after = title.split("—").slice(1).join("—").trim();
    if (after && !/^solution overview$/i.test(after)) return after;
  }
  const summary = (input.summary || "").trim();
  const covering = summary.match(/\bcovering\s+(.+?)\.?\s*$/i);
  if (covering?.[1]) {
    const value = covering[1].trim();
    if (value && !/^solution overview$/i.test(value)) return value;
  }
  return null;
}

/** Resolve catalog product + cover "for (…)" label for a proposal. */
export async function resolveProposalProductScope(input: {
  dealId: string;
  organizationId: string;
  dealTitle: string;
  dealNotes?: string | null;
  productHint?: string | null;
  productIds?: string[] | null;
  title?: string | null;
  summary?: string | null;
  /** Extra text to match (e.g. section bodies). */
  matchText?: string | null;
  /** Product names extracted from the BRD/meeting profile. */
  profileProductNames?: string[] | null;
}): Promise<{
  product: DealProductVisual | null;
  productScope: string;
  productHint: string | null;
  quoteLines: DealQuoteLineContext[];
  discussedProducts?: DealProductVisual[];
}> {
  const explicitHint = input.productHint?.trim() || null;
  const stored = extractStoredProductScope({
    title: input.title,
    summary: input.summary,
  });
  const productHint = explicitHint || stored || null;

  const requirementHaystack = explicitHint
    ? [explicitHint, input.dealNotes, input.matchText].filter(Boolean).join("\n")
    : [
        input.dealNotes,
        input.matchText,
        input.title,
        input.summary,
        productHint,
      ]
        .filter(Boolean)
        .join("\n");

  let catalog = await resolveDealProposalCatalog({
    dealId: input.dealId,
    organizationId: input.organizationId,
    dealTitle: input.dealTitle,
    dealNotes: input.dealNotes,
    productHint,
    productIds: input.productIds,
  });

  const quoteProductIds = (catalog.quoteLines ?? [])
    .map((line) => line.productId?.trim())
    .filter((id): id is string => Boolean(id));

  const discussed = await resolveDiscussedCatalogProducts({
    organizationId: input.organizationId,
    text: requirementHaystack,
    productIds: [...(input.productIds ?? []), ...quoteProductIds],
    profileProductNames: [
      ...(productHint ? [productHint] : []),
      ...((input.profileProductNames ?? [])
        .map((n) => n.trim())
        .filter(Boolean)),
    ],
  });

  if (discussed.length > 0) {
    const productScope = buildProductScopeLabel(discussed);
    return {
      product: discussed[0] ?? null,
      productScope,
      productHint,
      quoteLines: catalog.quoteLines,
      discussedProducts: discussed,
    };
  }

  // No explicit productIds — try matching catalog names in title/summary/sections.
  if (!catalog.product && !productHint) {
    const haystack = [
      input.title,
      input.summary,
      input.matchText,
      input.dealTitle,
      input.dealNotes,
    ]
      .filter(Boolean)
      .join("\n");
    if (haystack.trim()) {
      const retry = await resolveDealProposalCatalog({
        dealId: input.dealId,
        organizationId: input.organizationId,
        dealTitle: haystack,
        dealNotes: null,
      });
      if (retry.product) {
        catalog = { product: retry.product, quoteLines: catalog.quoteLines };
      }
    }
  }

  const productScope = proposalProductScope(
    catalog.product?.name ?? stored,
    input.dealTitle,
    productHint,
  );

  return {
    product: catalog.product,
    productScope,
    productHint,
    quoteLines: catalog.quoteLines,
    discussedProducts: catalog.product ? [catalog.product] : [],
  };
}

/**
 * Adapt cover tokens + hero asset while keeping the uploaded template HTML/CSS
 * skeleton intact. Format must stay stable across regenerates — only content
 * (tokens / section slots / optional product hero image) changes.
 *
 * Never inject nested CSS banner divs into `.bp-cover` (that corrupted covers).
 * Never call pinChrome here — render time owns page chrome.
 */
export async function adaptProposalVisuals(input: {
  blueprint: unknown;
  assets: unknown;
  product: DealProductVisual | null;
  dealTitle: string;
  /** Seller letterhead address (accounts.organizations) — optional. */
  sellerAddress?: string | null;
  /** Product/topic from chat — used for cover "for (…)" label only. */
  productHint?: string | null;
  /**
   * Document kind. Invoices stay letterhead clones (no cover/hero mutation).
   * Quotes/proposals only swap hero when the template already has a hero slot.
   */
  kind?: "proposal" | "quote" | "invoice";
}): Promise<{
  blueprint: DocumentBlueprint | null;
  assets: BlueprintAsset[];
  warnings: string[];
  productName: string | null;
  productScope: string;
}> {
  const warnings: string[] = [];
  const kind = input.kind ?? "proposal";
  const parsedBp = parseDocumentBlueprint(input.blueprint);
  const assetsIn = parseBlueprintAssets(input.assets);
  const sampleHero = assetsIn.find((a) => a.id === "hero") ?? null;
  const kept = assetsIn.filter((a) => a.id !== "hero");

  const productScope = proposalProductScope(
    input.product?.name,
    input.dealTitle,
    input.productHint,
  );
  const tagline = input.product?.tagline?.trim() || null;
  const askText = `${input.product?.name ?? ""} ${input.productHint ?? ""} ${productScope}`;
  const askFamilies = proposalProductFamilies(askText);
  const canUseSampleHero = sampleHeroCompatibleWithAsk(askText);
  const htmlHasHeroSlot = Boolean(
    parsedBp &&
      /bp-hero|asset:hero|bp-hero-banner/i.test(parsedBp.html || ""),
  );

  // Invoice: clone letterhead only — never inject proposal covers/heroes.
  if (kind === "invoice") {
    if (!parsedBp) {
      return {
        blueprint: null,
        assets: assetsIn,
        warnings,
        productName: input.product?.name ?? null,
        productScope,
      };
    }
    let html = applyCloneTokenRewrites(parsedBp.html, input.sellerAddress);
    return {
      blueprint: {
        ...parsedBp,
        html,
        css: stabilizeTemplateCss(parsedBp.css || ""),
      },
      assets: assetsIn,
      warnings,
      productName: input.product?.name ?? null,
      productScope,
    };
  }

  // Exact page-clone templates: keep sample pages/assets pixel-identical.
  // Do not swap heroes, invent banners, or redesign layout.
  if (
    parsedBp?.mode === "page-clone" ||
    /bp-page-clone/i.test(parsedBp?.html || "")
  ) {
    return {
      blueprint: parsedBp
        ? {
            ...parsedBp,
            css: stabilizeTemplateCss(parsedBp.css || ""),
            chrome: false,
          }
        : null,
      assets: assetsIn,
      warnings,
      productName: input.product?.name ?? null,
      productScope,
    };
  }

  // Prefer catalog product image; else template hero only for pure CCaaS asks.
  // Only when the uploaded template already has a hero slot (clone-safe).
  let heroAsset: BlueprintAsset | null = null;
  if (htmlHasHeroSlot) {
    if (input.product?.imageUrl) {
      heroAsset = await fetchImageAsAsset(input.product.imageUrl);
      if (!heroAsset) {
        warnings.push(
          "Product image could not be loaded; using a product-scoped cover banner.",
        );
      }
    }
    if (!heroAsset && sampleHero && canUseSampleHero) {
      heroAsset = sampleHero;
    } else if (!heroAsset && sampleHero && !canUseSampleHero) {
      warnings.push(
        `Skipping template cover image — ask families [${askFamilies.join(", ")}] do not match sample (${SAMPLE_HERO_FAMILY}).`,
      );
    } else if (!heroAsset) {
      warnings.push(
        "No matching cover image; using a product-scoped cover banner.",
      );
    }
  } else if (sampleHero) {
    // Keep sample hero asset for PDF chrome/assets even if HTML has no slot.
    heroAsset = sampleHero;
  }

  const assets = heroAsset ? [...kept, heroAsset] : kept;

  if (!parsedBp) {
    return {
      blueprint: null,
      assets,
      warnings,
      productName: input.product?.name ?? null,
      productScope,
    };
  }

  // Token-only rewrites on a clone of template HTML — do not restructure layout.
  let html = applyCloneTokenRewrites(parsedBp.html, input.sellerAddress);

  const scopeToken = "{{productScope}}";
  html = html.replace(
    /(<p\b[^>]*class="[^"]*\bbp-cover-deal\b[^"]*"[^>]*>)([\s\S]*?)(<\/p>)/gi,
    `$1(${scopeToken})$3`,
  );
  html = html.replace(/\(\{\{dealTitle\}\}\)/g, `(${scopeToken})`);
  html = html.replace(/\(\(\{\{productScope\}\}\)\)/g, `(${scopeToken})`);

  // Hero/banner only when template already has a hero slot — never invent one.
  if (htmlHasHeroSlot) {
    const banner = cssCoverBannerHtml(productScope, tagline);
    if (heroAsset?.dataBase64) {
      if (/bp-hero-banner/i.test(html)) {
        html = html.replace(
          /<div\b[^>]*class="[^"]*\bbp-hero-banner\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
          `<img class="bp-hero" src="asset:hero" alt=""/>`,
        );
      } else if (/<img\b[^>]*class="[^"]*\bbp-hero\b[^"]*"[^>]*>/i.test(html)) {
        html = html.replace(
          /<img\b[^>]*class="[^"]*\bbp-hero\b[^"]*"[^>]*>/gi,
          `<img class="bp-hero" src="asset:hero" alt=""/>`,
        );
      } else if (/asset:hero/i.test(html)) {
        html = html.replace(
          /<img\b[^>]*src="asset:hero"[^>]*>/gi,
          `<img class="bp-hero" src="asset:hero" alt=""/>`,
        );
      }
    } else if (/bp-hero-banner/i.test(html)) {
      html = html.replace(
        /<div\b[^>]*class="[^"]*\bbp-hero-banner\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
        banner,
      );
    } else if (/<img\b[^>]*class="[^"]*\bbp-hero\b[^"]*"[^>]*>/i.test(html)) {
      html = html.replace(
        /<img\b[^>]*class="[^"]*\bbp-hero\b[^"]*"[^>]*>/gi,
        banner,
      );
    } else if (/asset:hero/i.test(html)) {
      html = html.replace(/<img\b[^>]*src="asset:hero"[^>]*>/gi, banner);
    }
  }

  const blueprint: DocumentBlueprint = {
    ...parsedBp,
    html,
    css: ensureHeroBannerCss(stabilizeTemplateCss(parsedBp.css || "")),
  };

  return {
    blueprint,
    assets,
    warnings,
    productName: input.product?.name ?? null,
    productScope,
  };
}

/** Shared token rewrites that do not change layout structure. */
function applyCloneTokenRewrites(
  htmlIn: string,
  sellerAddressRaw?: string | null,
): string {
  let html = htmlIn;
  const sellerAddress = (sellerAddressRaw || "").trim();
  if (sellerAddress) {
    html = html.replace(
      /<div class="bp-address">\{\{companyName\}\}<\/div>/gi,
      '<div class="bp-address">{{sellerAddress}}</div>',
    );
  } else {
    html = html.replace(
      /<div class="bp-address">\{\{companyName\}\}<\/div>/gi,
      "",
    );
    html = html.replace(/<div class="bp-address"><\/div>/gi, "");
  }

  html = html.replace(
    /Proposal Submitted to \{\{customerName\}\}/gi,
    "Proposal Submitted to {{companyName}}",
  );
  html = html.replace(
    /Quotation for \{\{customerName\}\}/gi,
    "Quotation for {{companyName}}",
  );
  return html;
}
