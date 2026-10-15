/**
 * Personalize uploaded page-clone templates (proposal / quote / invoice) for a
 * specific deal: swap sample customer names, dates, and scope using meeting
 * context — without redesigning the uploaded layout.
 */

import {
  parseBlueprintAssets,
  parseDocumentBlueprint,
  stabilizeTemplateCss,
  buildPageCloneBlock,
  listPageCloneAssets,
  PAGE_CLONE_TEXT_CSS,
  type BlueprintAsset,
  type DocumentBlueprint,
} from "@/lib/document-blueprint";
import { buildPlaybookDocumentBlueprint } from "@/lib/proposal-playbook-layout";
import {
  applyTemplateEditPatches,
  extractBlueprintVisibleText,
  type TemplateSectionRow,
  type TemplateTextReplacement,
} from "@/lib/template-edit-patch";
import {
  callAiServiceAgent,
  AI_SERVICE_JOB_TIMEOUT_MS,
} from "@/service/ai/ai-service-client";
import { loadMeetingNotesForDeal } from "@/service/ai/proposal-brief";
import { proposalProductScope } from "@/service/sales/proposal-visuals";

export type ClonePersonalizeKind = "proposal" | "quote" | "invoice";

export type ClonePersonalizeContext = {
  kind: ClonePersonalizeKind;
  organizationId: string;
  companyName: string;
  customerName: string;
  dealTitle: string;
  dealNotes?: string | null;
  vendorName: string;
  productScope: string;
  productHint?: string | null;
  date: string;
  quoteNumber?: string | null;
  invoiceNumber?: string | null;
  total?: string | null;
  currency?: string | null;
  contactName?: string | null;
  /** Approved quote/invoice rows and totals. The LLM may copy, never recalculate. */
  documentFacts?: Record<string, unknown> | null;
};

export function isPageCloneBlueprint(
  blueprint: DocumentBlueprint | null | undefined,
): boolean {
  if (!blueprint) return false;
  if (blueprint.mode === "page-clone") return true;
  return /bp-page-clone/i.test(blueprint.html || "");
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const DEFAULT_FULL_DOC_TEXT_LIMIT = 50_000;
const DEFAULT_PAGE_TEXT_LIMIT = 8_000;
const MIN_PAGE_LLM_CHARS = 40;

function truncateVisibleText(text: string, limit: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit - 3)}...`;
}

/** Visible text from blueprint HTML, fillHtml, and vector pageHtml assets. */
export function extractFullCloneVisibleText(
  blueprint: DocumentBlueprint | null | undefined,
  assets: BlueprintAsset[],
  limit = DEFAULT_FULL_DOC_TEXT_LIMIT,
): string {
  const parts: string[] = [];
  if (blueprint?.html?.trim()) {
    parts.push(stripHtml(blueprint.html));
  }
  if (blueprint?.fillHtml?.trim()) {
    parts.push(stripHtml(blueprint.fillHtml));
  }
  for (const asset of assets) {
    const pageHtml = asset.pageHtml?.trim();
    if (pageHtml) parts.push(stripHtml(pageHtml));
  }
  const merged = parts.filter(Boolean).join("\n");
  return truncateVisibleText(merged, limit);
}

export type ClonePageUnit = {
  id: string;
  pageIndex: number;
  pageCount: number;
  role: string;
  visibleText: string;
  textFragments: Array<{ index: number; text: string }>;
};

function decodeHtmlText(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .trim();
}

function pageTextFragments(pageHtml: string): Array<{ index: number; text: string }> {
  const out: Array<{ index: number; text: string }> = [];
  let index = 0;
  for (const match of pageHtml.matchAll(
    /<span\b[^>]*\bclass="[^"]*\bpdf-text\b[^"]*"[^>]*>([\s\S]*?)<\/span>/gi,
  )) {
    const text = decodeHtmlText(match[1] || "");
    out.push({ index, text });
    index += 1;
  }
  return out;
}

function pageAssetSortKey(id: string): number {
  const match = id.match(/(\d+)/);
  return match ? Number.parseInt(match[1]!, 10) : 0;
}

export function inferClonePageRole(input: {
  pageIndex: number;
  pageCount: number;
  visibleText: string;
  kind: ClonePersonalizeKind;
}): string {
  const text = input.visibleText.toLowerCase();
  if (input.pageIndex === 1) return "cover";
  if (
    input.pageIndex === input.pageCount &&
    input.pageCount > 1 &&
    /terms|signature|acceptance|legal|confidential/.test(text)
  ) {
    return "legal";
  }
  if (
    /pricing|investment|commercial|subtotal|grand total|amount due|line item/.test(
      text,
    ) ||
    (input.kind !== "proposal" &&
      /quote number|invoice number|bill to|due date/.test(text))
  ) {
    return "commercials";
  }
  if (/scope|objective|overview|approach|solution|deliverable|requirement/.test(text)) {
    return "scope";
  }
  if (/introduction|executive summary|about us|who we are/.test(text)) {
    return "intro";
  }
  return "body";
}

/** One personalization unit per vector page (plus optional blueprint shell). */
export function extractClonePageUnits(
  blueprint: DocumentBlueprint | null | undefined,
  assets: BlueprintAsset[],
  kind: ClonePersonalizeKind = "proposal",
  perPageLimit = DEFAULT_PAGE_TEXT_LIMIT,
): ClonePageUnit[] {
  const shellParts: string[] = [];
  const shellHtmlParts: string[] = [];
  if (blueprint?.html?.trim()) shellParts.push(stripHtml(blueprint.html));
  if (blueprint?.html?.trim()) shellHtmlParts.push(blueprint.html);
  if (blueprint?.fillHtml?.trim()) shellParts.push(stripHtml(blueprint.fillHtml));
  if (blueprint?.fillHtml?.trim()) shellHtmlParts.push(blueprint.fillHtml);
  const shellText = truncateVisibleText(shellParts.join("\n"), perPageLimit);
  const shellHtml = shellHtmlParts.join("\n");

  const pageAssets = assets
    .filter((asset) => Boolean(asset.pageHtml?.trim()))
    .sort(
      (a, b) =>
        pageAssetSortKey(a.id) - pageAssetSortKey(b.id) ||
        a.id.localeCompare(b.id),
    );

  const pageCount = pageAssets.length + (shellText ? 1 : 0);
  const units: ClonePageUnit[] = [];

  if (shellText) {
    units.push({
      id: "blueprint-shell",
      pageIndex: 1,
      pageCount,
      role: inferClonePageRole({
        pageIndex: 1,
        pageCount,
        visibleText: shellText,
        kind,
      }),
      visibleText: shellText,
      textFragments: pageTextFragments(shellHtml),
    });
  }

  pageAssets.forEach((asset, index) => {
    const visibleText = truncateVisibleText(
      stripHtml(asset.pageHtml!.trim()),
      perPageLimit,
    );
    if (!visibleText) return;
    const pageIndex = (shellText ? 1 : 0) + index + 1;
    units.push({
      id: asset.id,
      pageIndex,
      pageCount,
      role: inferClonePageRole({
        pageIndex,
        pageCount,
        visibleText,
        kind,
      }),
      visibleText,
      textFragments: pageTextFragments(asset.pageHtml!.trim()),
    });
  });

  return units;
}

const SAMPLE_COMPANY_PATTERNS: RegExp[] = [
  /Proposal Submitted to\s+([A-Z][A-Za-z0-9&.'-]{2,40})(?=\s*(?:for\b|\(|$|\n))/gi,
  /Submitted to\s+([A-Z][A-Za-z0-9&.'-]{2,40})(?=\s*(?:for\b|\(|$|\n))/gi,
  /Quotation for\s+([A-Z][A-Za-z0-9&.'-]{2,40})(?=\s*(?:for\b|\(|$|\n))/gi,
  /Quote for\s+([A-Z][A-Za-z0-9&.'-]{2,40})(?=\s*(?:for\b|\(|$|\n))/gi,
  /Bill to\s+([A-Z][A-Za-z0-9&.'-]{2,40})(?=\s*(?:for\b|\(|$|\n))/gi,
  /Invoice for\s+([A-Z][A-Za-z0-9&.'-]{2,40})(?=\s*(?:for\b|\(|$|\n))/gi,
];

function titleCaseCompany(name: string): string {
  const raw = name.trim();
  if (!raw) return raw;
  if (raw === raw.toUpperCase() && /[A-Z]/.test(raw)) return raw;
  return raw.replace(/\w\S*/g, (w) => {
    if (w.length <= 2 && w === w.toUpperCase()) return w;
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  });
}

export function inferSampleCompanyNames(visibleText: string): string[] {
  const found = new Set<string>();
  for (const re of SAMPLE_COMPANY_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(visibleText))) {
      const name = m[1]?.trim();
      if (!name || name.length < 3) continue;
      if (/^(the|our|your|customer|company)$/i.test(name)) continue;
      found.add(name);
    }
  }
  return [...found];
}

function uniqueReplacements(
  rows: TemplateTextReplacement[],
): TemplateTextReplacement[] {
  const seen = new Set<string>();
  const out: TemplateTextReplacement[] = [];
  for (const row of rows) {
    const find = (row.find ?? "").trim();
    const replace = row.replace ?? "";
    if (!find || find === replace || seen.has(find)) continue;
    seen.add(find);
    out.push({ find, replace });
  }
  return out;
}

export function inferTemplateProductBulletBlock(
  visibleText: string,
): string | null {
  const text = visibleText.trim();
  if (!text) return null;

  // Cover/catalog dumps: "Product A • Product B • Product C …"
  const bulletChain = text.match(
    /(?:[A-Z][A-Za-z0-9 ()&,'/-]{4,80}\s*[•·]\s*){2,}[A-Z][A-Za-z0-9 ()&,'/-]{4,160}/,
  );
  if (bulletChain?.[0]) return bulletChain[0].trim();

  // Parenthetical multi-product scope on cover lines
  const paren = text.match(/\([^)]{30,220}[•·][^)]{10,220}\)/);
  if (paren?.[0]) return paren[0].trim();

  return null;
}

function splitProductScope(scope: string): string[] {
  return scope
    .replace(/^\(|\)$/g, "")
    .split(/\s*[•·]\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);
}

function productSegmentMatchesAllowed(
  segment: string,
  allowed: string[],
): boolean {
  const norm = segment.replace(/^[•·\s]+/, "").trim().toLowerCase();
  if (!norm) return true;
  return allowed.some((a) => {
    const an = a.toLowerCase();
    const head = norm.slice(0, Math.min(14, norm.length));
    const aHead = an.slice(0, Math.min(14, an.length));
    return an.includes(head) || norm.includes(aHead);
  });
}

/** Template catalog lines on the cover that are not in the meeting product scope. */
export function templateProductsOutsideScope(
  visibleText: string,
  allowedScope: string,
): string[] {
  const block = inferTemplateProductBulletBlock(visibleText);
  if (!block || !allowedScope.trim()) return [];
  const templateProducts = splitProductScope(block);
  const allowed = splitProductScope(allowedScope);
  if (!templateProducts.length || !allowed.length) return [];
  return templateProducts.filter(
    (tp) => !productSegmentMatchesAllowed(tp, allowed),
  );
}

/**
 * Strip out-of-scope catalog names from pageHtml spans.
 * Page-clone stores each PDF fragment in its own span — whole bullet chains
 * rarely exist as one contiguous find string.
 */
export function buildOutOfScopeProductReplacements(
  pageHtml: string,
  visibleText: string,
  allowedScope: string,
): TemplateTextReplacement[] {
  if (!allowedScope.trim() || !pageHtml.trim()) return [];
  const removals = templateProductsOutsideScope(visibleText, allowedScope);
  const replacements: TemplateTextReplacement[] = [];
  for (const product of removals) {
    const trimmed = product.trim();
    if (!trimmed) continue;
    if (pageHtml.includes(trimmed)) {
      replacements.push({ find: trimmed, replace: "" });
    }
    for (const prefix of [" • ", "• ", " · ", "· "]) {
      const prefixed = `${prefix}${trimmed}`;
      if (pageHtml.includes(prefixed)) {
        replacements.push({ find: prefixed, replace: "" });
      }
    }
  }
  return uniqueReplacements(replacements);
}

export function buildDeterministicCloneReplacements(
  visibleText: string,
  ctx: ClonePersonalizeContext,
): TemplateTextReplacement[] {
  const company = titleCaseCompany(ctx.companyName || ctx.customerName || "Customer");
  const replacements: TemplateTextReplacement[] = [];

  for (const sample of inferSampleCompanyNames(visibleText)) {
    if (sample.toLowerCase() === company.toLowerCase()) continue;
    const core = sample.split(/\s+for\b/i)[0]?.trim() || sample;
    replacements.push({ find: core, replace: company });
    replacements.push({
      find: `Proposal Submitted to ${core}`,
      replace: `Proposal Submitted to ${company}`,
    });
    replacements.push({
      find: `Submitted to ${core}`,
      replace: `Submitted to ${company}`,
    });
    if (core !== sample) {
      replacements.push({ find: sample, replace: company });
    }
  }

  // Token placeholders that may remain in vector pageHtml
  replacements.push(
    { find: "{{companyName}}", replace: company },
    { find: "{{customerName}}", replace: company },
    { find: "{{vendorName}}", replace: ctx.vendorName.trim() || "Our company" },
    { find: "{{dealTitle}}", replace: ctx.dealTitle.trim() || "Opportunity" },
    { find: "{{date}}", replace: ctx.date },
    { find: "{{productScope}}", replace: ctx.productScope },
  );

  if (ctx.quoteNumber?.trim()) {
    replacements.push({
      find: "{{quoteNumber}}",
      replace: ctx.quoteNumber.trim(),
    });
  }
  if (ctx.invoiceNumber?.trim()) {
    replacements.push({
      find: "{{invoiceNumber}}",
      replace: ctx.invoiceNumber.trim(),
    });
  }
  if (ctx.total?.trim()) {
    replacements.push({ find: "{{total}}", replace: ctx.total.trim() });
  }
  if (ctx.currency?.trim()) {
    replacements.push({ find: "{{currency}}", replace: ctx.currency.trim() });
  }

  // Common sample date patterns from uploaded PDFs (e.g. 10-Oct-2025)
  const dateLike = visibleText.match(
    /\b\d{1,2}[-/]\w{3}[-/]\d{4}\b|\b\d{1,2}\s+\w{3,9}\s+\d{4}\b/g,
  );
  if (dateLike?.length) {
    const uniqDates = [...new Set(dateLike)].slice(0, 6);
    for (const oldDate of uniqDates) {
      if (oldDate === ctx.date) continue;
      replacements.push({ find: oldDate, replace: ctx.date });
    }
  }

  // Product scope in cover parens — replace first long parenthetical on cover line
  const scopeInParens = visibleText.match(/\([A-Za-z0-9 +/&.-]{8,120}\)/);
  if (
    scopeInParens?.[0] &&
    ctx.productScope &&
    !scopeInParens[0].toLowerCase().includes(ctx.productScope.toLowerCase().slice(0, 12))
  ) {
    replacements.push({
      find: scopeInParens[0],
      replace: `(${ctx.productScope})`,
    });
  }

  // Template cover often lists every Worktual SKU — swap for meeting-discussed scope only.
  if (ctx.productScope?.trim()) {
    const templateBlock = inferTemplateProductBulletBlock(visibleText);
    if (
      templateBlock &&
      templateBlock !== ctx.productScope &&
      !templateBlock.toLowerCase().includes(ctx.productScope.toLowerCase().slice(0, 10))
    ) {
      replacements.push({
        find: templateBlock,
        replace: ctx.productScope.trim(),
      });
    }
  }

  return uniqueReplacements(replacements);
}

const RASTER_HYBRID_CSS = `
.bp-raster-hybrid .bp-playbook-root{padding:1.25rem 1.5rem 2rem;max-width:920px;margin:0 auto;}
.bp-raster-hybrid .bp-page-clone{margin-bottom:0;}
`.trim();

/**
 * Image-only PDF playbooks cannot be text-patched. Keep page-1 as the visual
 * cover and render meeting-generated section copy below via data-slot sections.
 */
export function buildRasterHybridProposalBlueprint(input: {
  pageAssets: BlueprintAsset[];
  sections: Array<{ key: string; title: string }>;
  layoutStyle?: unknown;
}): { blueprint: DocumentBlueprint; assets: BlueprintAsset[] } | null {
  const pages = listPageCloneAssets(input.pageAssets);
  const cover = pages.find((p) => p.dataBase64?.trim()) ?? pages[0];
  if (!cover?.dataBase64?.trim()) return null;

  const layout = buildPlaybookDocumentBlueprint({
    layoutStyle: input.layoutStyle,
    sections: input.sections,
  });

  const bodyHtml = layout.html.replace(
    /<header class="bp-playbook-cover[\s\S]*?<\/header>\s*/i,
    "",
  );

  const coverBlock = buildPageCloneBlock(cover);
  const html = `<div class="bp-page-clone-root bp-raster-hybrid">${coverBlock}${bodyHtml}</div>`;
  const css = `${layout.css}\n${PAGE_CLONE_TEXT_CSS}\n${RASTER_HYBRID_CSS}`;

  const embedIds = new Set<string>();
  for (const ref of html.match(/asset:[a-zA-Z0-9_-]+/g) ?? []) {
    embedIds.add(ref.slice("asset:".length));
  }
  const assets: BlueprintAsset[] = [cover];
  for (const asset of input.pageAssets) {
    if (asset.id === cover.id) continue;
    if (embedIds.has(asset.id) && asset.dataBase64?.trim()) {
      assets.push(asset);
    }
  }

  return {
    blueprint: {
      ...layout,
      mode: "page-clone",
      html,
      css,
      chrome: false,
    },
    assets,
  };
}

export async function buildClonePersonalizeContext(input: {
  kind: ClonePersonalizeKind;
  organizationId: string;
  dealId: string;
  companyName: string;
  customerName: string;
  dealTitle: string;
  vendorName: string;
  date: string;
  productScope?: string | null;
  productHint?: string | null;
  quoteNumber?: string | null;
  invoiceNumber?: string | null;
  total?: string | null;
  currency?: string | null;
  contactName?: string | null;
  dealNotes?: string | null;
  documentFacts?: Record<string, unknown> | null;
}): Promise<ClonePersonalizeContext> {
  const meetingNotes =
    input.dealNotes ?? (await loadMeetingNotesForDeal(input.dealId));
  const productScope =
    input.productScope?.trim() ||
    proposalProductScope(null, input.dealTitle, input.productHint);

  return {
    kind: input.kind,
    organizationId: input.organizationId,
    companyName: input.companyName,
    customerName: input.customerName,
    dealTitle: input.dealTitle,
    dealNotes: meetingNotes,
    vendorName: input.vendorName,
    productScope,
    productHint: input.productHint ?? null,
    date: input.date,
    quoteNumber: input.quoteNumber ?? null,
    invoiceNumber: input.invoiceNumber ?? null,
    total: input.total ?? null,
    currency: input.currency ?? null,
    contactName: input.contactName ?? null,
    documentFacts: input.documentFacts ?? null,
  };
}

async function runClonePagePersonalizeAgent(input: {
  unit: ClonePageUnit;
  context: ClonePersonalizeContext;
  alreadyApplied: string[];
  sectionOutline?: Array<{ key: string; title: string }>;
  sectionBodies?: Array<{ key: string; title: string; body: string }>;
  contentFill?: boolean;
}): Promise<{
  textReplacements: TemplateTextReplacement[];
  fragmentEdits: Array<{ index: number; find: string; replace: string }>;
  warnings: string[];
  ok: boolean;
}> {
  const agent = await callAiServiceAgent<{
    textReplacements?: TemplateTextReplacement[];
    fragmentEdits?: Array<{ index?: number; find?: string; replace?: string }>;
    warnings?: string[];
  }>(
    "document-clone-personalize",
    {
      organizationId: input.context.organizationId,
      kind: input.context.kind,
      visibleTextPreview: input.unit.visibleText,
      pageIndex: input.unit.pageIndex,
      pageCount: input.unit.pageCount,
      pageRole: input.unit.role,
      pageId: input.unit.id,
      textFragments: input.unit.textFragments,
      context: input.context,
      alreadyApplied: input.alreadyApplied,
      sectionOutline: input.sectionOutline,
      sectionBodies: input.sectionBodies,
      contentFill: input.contentFill === true,
    },
    { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS },
  );

  const textReplacements = (input.unit.textFragments.length
    ? []
    : agent?.textReplacements ?? [])
    .filter(
      (r): r is TemplateTextReplacement =>
        Boolean(r && typeof r.find === "string" && r.find.trim()),
    )
    .filter((r) => !touchesScenarioSolutionLabel(r));
  const warnings = Array.isArray(agent?.warnings)
    ? agent.warnings.filter((w): w is string => typeof w === "string")
    : [];
  const byIndex = new Map(
    input.unit.textFragments.map((fragment) => [fragment.index, fragment.text]),
  );
  const fragmentEdits = (agent?.fragmentEdits ?? [])
    .filter(
      (row): row is { index: number; find?: string; replace?: string } =>
        Boolean(
          row &&
            typeof row.index === "number" &&
            Number.isInteger(row.index) &&
            byIndex.has(row.index),
        ),
    )
    .map((row) => ({
      index: row.index,
      find: String(row.find ?? "").trim(),
      replace: String(row.replace ?? ""),
    }))
    .filter((row) => {
      const current = byIndex.get(row.index) ?? "";
      return current.length > 0 && row.find === current && row.replace !== current;
    });

  return {
    textReplacements,
    fragmentEdits,
    warnings,
    ok: Boolean(agent),
  };
}

type PageFragmentEdit = {
  pageId: string;
  index: number;
  find: string;
  replace: string;
};

function escapePageText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fitEditedSpanOpen(open: string, find: string, replace: string): string {
  if (replace.length <= find.length) return open;
  return open.replace(/style="([^"]*)"/i, (_full, style: string) => {
    let next = style;
    if (replace.toLowerCase().startsWith(find.toLowerCase())) {
      next = next.replace(/overflow\s*:\s*hidden;?/gi, "");
      next += ";overflow:visible;z-index:2";
      return `style="${next.replace(/;;+/g, ";")}"`;
    }
    const ratio = Math.max(0.28, find.length / Math.max(1, replace.length));
    next = next.replace(
      /font-size\s*:\s*([\d.]+)(cqw|%|px|pt|em|rem)/i,
      (_m: string, size: string, unit: string) =>
        `font-size:${Math.max(0.25, Number(size) * ratio).toFixed(4)}${unit}`,
    );
    return `style="${next}"`;
  });
}

function applyPageFragmentEdits(
  assets: BlueprintAsset[],
  edits: PageFragmentEdit[],
): BlueprintAsset[] {
  if (!edits.length) return assets;
  const byPage = new Map<string, Map<number, PageFragmentEdit>>();
  for (const edit of edits) {
    const page = byPage.get(edit.pageId) ?? new Map<number, PageFragmentEdit>();
    page.set(edit.index, edit);
    byPage.set(edit.pageId, page);
  }
  return assets.map((asset) => {
    const pageEdits = byPage.get(asset.id);
    if (!pageEdits?.size || !asset.pageHtml?.trim()) return asset;
    const pageHtml = applyFragmentEditsToHtml(asset.pageHtml, pageEdits);
    return pageHtml === asset.pageHtml ? asset : { ...asset, pageHtml };
  });
}

function applyFragmentEditsToHtml(
  html: string,
  edits: Map<number, PageFragmentEdit>,
): string {
  let index = 0;
  return html.replace(
    /(<span\b[^>]*\bclass="[^"]*\bpdf-text\b[^"]*"[^>]*>)([\s\S]*?)(<\/span>)/gi,
    (_full, open: string, inner: string, close: string) => {
      const edit = edits.get(index);
      index += 1;
      if (!edit || decodeHtmlText(inner) !== edit.find) {
        return `${open}${inner}${close}`;
      }
      const fittedOpen = fitEditedSpanOpen(open, edit.find, edit.replace);
      return `${fittedOpen}${escapePageText(edit.replace)}${close}`;
    },
  );
}

/** Scenario column headers must stay literal — not customer/vendor-prefixed. */
function touchesScenarioSolutionLabel(r: TemplateTextReplacement): boolean {
  const find = String(r.find || "");
  const replace = String(r.replace ?? "");
  const labelRe = /\b(?:Requested|Recommended)\s+Solution\b/i;
  if (!labelRe.test(find) && !labelRe.test(replace)) return false;
  // Block any rewrite that alters or prefixes these labels.
  if (labelRe.test(find) && find.replace(/\s+/g, " ").trim() !== replace.replace(/\s+/g, " ").trim()) {
    return true;
  }
  if (
    /\b(?:Requested|Recommended)\s+Solution\b/i.test(find) === false &&
    /\b(?:Requested|Recommended)\s+Solution\b/i.test(replace)
  ) {
    return true;
  }
  return false;
}

export async function personalizePageCloneDocument(input: {
  blueprint: unknown;
  assets: unknown;
  sections?: TemplateSectionRow[];
  context: ClonePersonalizeContext;
  /** When true, rewrite sample narrative using generated section bodies. */
  contentFill?: boolean;
}): Promise<{
  blueprint: DocumentBlueprint | null;
  assets: BlueprintAsset[];
  sections: TemplateSectionRow[];
  applied: boolean;
  warnings: string[];
}> {
  const parsedBp = parseDocumentBlueprint(input.blueprint);
  const assetsIn = parseBlueprintAssets(input.assets);
  const sections = input.sections ?? [];
  const contentFill = input.contentFill === true && sections.some((s) => String(s.body || "").trim());

  if (!parsedBp || !isPageCloneBlueprint(parsedBp)) {
    return {
      blueprint: parsedBp,
      assets: assetsIn,
      sections,
      applied: false,
      warnings: [],
    };
  }

  const fullVisibleText = extractFullCloneVisibleText(parsedBp, assetsIn);
  const hasVectorText = assetsIn.some((a) => Boolean(a.pageHtml?.trim()));
  const warnings: string[] = [];
  if (!hasVectorText && !extractBlueprintVisibleText(parsedBp, 200)) {
    warnings.push(
      "This template uses page images only — customer-specific text may not update on scanned pages. Re-upload as a vector PDF or use a token-based template for full personalization.",
    );
  }

  const deterministic = buildDeterministicCloneReplacements(
    fullVisibleText,
    input.context,
  );

  const scopeStripRows: TemplateTextReplacement[] = [];
  if (input.context.productScope?.trim()) {
    for (const asset of assetsIn) {
      const pageHtml = asset.pageHtml?.trim();
      if (!pageHtml) continue;
      scopeStripRows.push(
        ...buildOutOfScopeProductReplacements(
          pageHtml,
          fullVisibleText,
          input.context.productScope,
        ),
      );
    }
  }

  let patched = applyTemplateEditPatches({
    sections,
    blueprint: parsedBp,
    assets: assetsIn,
    edits: {
      textReplacements: uniqueReplacements([...deterministic, ...scopeStripRows]),
    },
  });

  const alreadyApplied = uniqueReplacements([
    ...deterministic,
    ...scopeStripRows,
  ]).map((r) => r.find);
  const sectionOutline = sections
    .map((s) => ({
      key: (s.key ?? s.id).trim(),
      title: s.title.trim(),
    }))
    .filter((s) => s.key && s.title);
  const sectionBodies = sections
    .map((s) => ({
      key: (s.key ?? s.id).trim(),
      title: s.title.trim(),
      body: String(s.body || "").trim(),
    }))
    .filter((s) => s.key && s.body);

  const pageUnits = extractClonePageUnits(
    patched.blueprint,
    patched.assets,
    input.context.kind,
  );

  const llmTargets =
    pageUnits.length > 0
      ? pageUnits.filter((unit) => unit.visibleText.length >= MIN_PAGE_LLM_CHARS)
      : fullVisibleText.length >= MIN_PAGE_LLM_CHARS
        ? [
            {
              id: "document",
              pageIndex: 1,
              pageCount: 1,
              role: inferClonePageRole({
                pageIndex: 1,
                pageCount: 1,
                visibleText: fullVisibleText,
                kind: input.context.kind,
              }),
              visibleText: truncateVisibleText(
                fullVisibleText,
                DEFAULT_PAGE_TEXT_LIMIT,
              ),
              textFragments: [],
            },
          ]
        : [];

  let llmRows: TemplateTextReplacement[] = [];
  const fragmentRows: PageFragmentEdit[] = [];
  let agentFailures = 0;

  if (llmTargets.length) {
    const pageResults = await Promise.all(
      llmTargets.map((unit) =>
        runClonePagePersonalizeAgent({
          unit,
          context: input.context,
          alreadyApplied,
          sectionOutline,
          sectionBodies: contentFill ? sectionBodies : undefined,
          contentFill,
        }),
      ),
    );

    for (let i = 0; i < pageResults.length; i += 1) {
      const result = pageResults[i]!;
      warnings.push(...result.warnings);
      if (!result.ok) agentFailures += 1;
      llmRows.push(...result.textReplacements);
      for (const edit of result.fragmentEdits) {
        fragmentRows.push({ pageId: llmTargets[i]!.id, ...edit });
      }
    }
    llmRows = uniqueReplacements(llmRows);
  }

  if (llmRows.length) {
    patched = applyTemplateEditPatches({
      sections: patched.sections,
      blueprint: patched.blueprint,
      assets: patched.assets,
      edits: { textReplacements: llmRows },
    });
  } else if (agentFailures > 0) {
    warnings.push(
      "AI service unavailable; applied company/date replacements from the deal. Regenerate after meetings for richer copy.",
    );
  }

  if (fragmentRows.length) {
    const shellEdits = new Map<number, PageFragmentEdit>();
    for (const edit of fragmentRows) {
      if (edit.pageId === "blueprint-shell") shellEdits.set(edit.index, edit);
    }
    if (shellEdits.size && patched.blueprint) {
      patched = {
        ...patched,
        blueprint: {
          ...patched.blueprint,
          html: applyFragmentEditsToHtml(patched.blueprint.html, shellEdits),
        },
      };
    }
    const editedAssets = applyPageFragmentEdits(patched.assets, fragmentRows);
    if (editedAssets.some((asset, i) => asset.pageHtml !== patched.assets[i]?.pageHtml)) {
      patched = applyTemplateEditPatches({
        sections: patched.sections,
        blueprint: patched.blueprint,
        assets: editedAssets,
        edits: {},
      });
    }
  }

  return {
    blueprint: patched.blueprint ?? parsedBp,
    assets: patched.assets,
    sections: patched.sections,
    applied: true,
    warnings: [...new Set(warnings)],
  };
}
