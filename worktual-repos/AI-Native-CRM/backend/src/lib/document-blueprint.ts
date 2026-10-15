import { spawnSync } from "node:child_process";
import {
  applyCoverAlignClass,
  columnsFromTableHtml,
  defaultColumnsForSectionKey,
  realTableColumns,
  stripSectionChromeHeader,
  tableRowsForSection,
} from "./proposal-playbook-layout";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * HTML brand blueprint for proposal/quote templates (layout + theme + slots).
 */

export type BlueprintSlot = {
  key: string;
  label: string;
};

export type DocumentBlueprint = {
  version: number;
  html: string;
  css: string;
  mode?: "page-clone" | string;
  chrome?: boolean;
  fillHtml?: string;
  fillCss?: string;
  theme?: {
    primary?: string;
    secondary?: string;
    fonts?: string;
    background?: string;
  };
  slots?: BlueprintSlot[];
  /** Learned emphasis labels to color in section bodies. */
  emphasis?: {
    requestedLabel?: string;
    recommendedLabel?: string;
  };
};

export type BlueprintAsset = {
  id: string;
  kind: "logo" | "image" | "page-meta";
  mime: string;
  dataBase64: string;
  /** Vector page-clone layout HTML (preserved round-trip). */
  pageHtml?: string;
  pageWidth?: number;
  pageHeight?: number;
};

/** Per-page JPEG clones can be ~200–800KB base64; allow headroom for dense pages. */
const MAX_ASSET_CHARS = 3_500_000;
/** Vector page-clone layout rows (pageHtml only — no raster payload). */
const MAX_PAGE_META_ASSETS = 20;
/** Embedded images (logo, pimg-*, raster page-*). */
const MAX_EMBED_ASSETS = 96;
/** @deprecated use MAX_PAGE_META_ASSETS + MAX_EMBED_ASSETS */
const MAX_ASSETS = MAX_PAGE_META_ASSETS + MAX_EMBED_ASSETS;

export function isSpreadsheetLayoutBlueprint(raw: unknown): boolean {
  return (
    !!raw &&
    typeof raw === "object" &&
    (raw as { mode?: unknown }).mode === "spreadsheet-layout"
  );
}

export type BlueprintAssetParseResult = {
  assets: BlueprintAsset[];
  /** Asset ids skipped because they exceeded size or count limits. */
  dropped: string[];
  truncatedByCount: boolean;
};

export function parseDocumentBlueprint(raw: unknown): DocumentBlueprint | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const html = typeof o.html === "string" ? o.html.trim() : "";
  const css = typeof o.css === "string" ? o.css.trim() : "";
  if (!html) return null;
  const theme =
    o.theme && typeof o.theme === "object"
      ? (o.theme as DocumentBlueprint["theme"])
      : undefined;
  const slots = Array.isArray(o.slots)
    ? o.slots
        .filter(
          (s): s is BlueprintSlot =>
            !!s &&
            typeof s === "object" &&
            typeof (s as BlueprintSlot).key === "string",
        )
        .map((s) => ({
          key: String(s.key),
          label: typeof s.label === "string" ? s.label : String(s.key),
        }))
    : undefined;
  const emphasisRaw =
    o.emphasis && typeof o.emphasis === "object" && !Array.isArray(o.emphasis)
      ? (o.emphasis as Record<string, unknown>)
      : null;
  const emphasis = emphasisRaw
    ? {
        ...(typeof emphasisRaw.requestedLabel === "string" &&
        emphasisRaw.requestedLabel.trim()
          ? { requestedLabel: emphasisRaw.requestedLabel.trim() }
          : {}),
        ...(typeof emphasisRaw.recommendedLabel === "string" &&
        emphasisRaw.recommendedLabel.trim()
          ? { recommendedLabel: emphasisRaw.recommendedLabel.trim() }
          : {}),
      }
    : undefined;
  return {
    version: typeof o.version === "number" ? o.version : 1,
    html,
    css,
    theme,
    slots,
    ...(emphasis && (emphasis.requestedLabel || emphasis.recommendedLabel)
      ? { emphasis }
      : {}),
    ...(typeof o.mode === "string" && o.mode ? { mode: o.mode } : {}),
    ...(typeof o.chrome === "boolean" ? { chrome: o.chrome } : {}),
    ...(typeof o.fillHtml === "string" && o.fillHtml.trim()
      ? { fillHtml: o.fillHtml.trim() }
      : {}),
    ...(typeof o.fillCss === "string" && o.fillCss.trim()
      ? { fillCss: o.fillCss.trim() }
      : {}),
  };
}

export function parseBlueprintAssetsDetailed(
  raw: unknown,
): BlueprintAssetParseResult {
  if (!Array.isArray(raw)) {
    return { assets: [], dropped: [], truncatedByCount: false };
  }
  const embedPriority = (o: Record<string, unknown>): number => {
    const id = String(o.id ?? "").toLowerCase();
    if (typeof o.pageHtml === "string" && o.pageHtml.trim()) return 0;
    if (id === "logo") return 1;
    if (id.startsWith("page-")) return 2;
    return 3;
  };
  const sorted = raw
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .slice()
    .sort((a, b) => embedPriority(a) - embedPriority(b));
  const out: BlueprintAsset[] = [];
  const dropped: string[] = [];
  let truncatedByCount = false;
  for (const item of sorted) {
    const o = item;
    const id = typeof o.id === "string" ? o.id : "";
    const mime = typeof o.mime === "string" ? o.mime : "";
    const dataBase64 = typeof o.dataBase64 === "string" ? o.dataBase64 : "";
    const pageHtml =
      typeof o.pageHtml === "string" && o.pageHtml.trim()
        ? o.pageHtml
        : undefined;
    const pageWidth =
      typeof o.pageWidth === "number" && Number.isFinite(o.pageWidth)
        ? o.pageWidth
        : undefined;
    const pageHeight =
      typeof o.pageHeight === "number" && Number.isFinite(o.pageHeight)
        ? o.pageHeight
        : undefined;
    if (pageHtml) {
      if (!id) continue;
      const pageMetaCount = out.filter((a) => a.kind === "page-meta").length;
      if (pageMetaCount >= MAX_PAGE_META_ASSETS) {
        truncatedByCount = true;
        dropped.push(id);
        continue;
      }
      out.push({
        id,
        kind: "page-meta",
        mime: mime || "text/html",
        dataBase64: dataBase64 || "",
        pageHtml,
        ...(pageWidth !== undefined ? { pageWidth } : {}),
        ...(pageHeight !== undefined ? { pageHeight } : {}),
      });
      continue;
    }
    const kind = o.kind === "logo" || o.kind === "image" ? o.kind : "image";
    if (!id || !mime || !dataBase64) continue;
    if (dataBase64.length > MAX_ASSET_CHARS) {
      dropped.push(id);
      continue;
    }
    const embedCount = out.filter((a) => a.kind !== "page-meta").length;
    if (embedCount >= MAX_EMBED_ASSETS) {
      truncatedByCount = true;
      dropped.push(id);
      continue;
    }
    out.push({ id, kind, mime, dataBase64 });
  }
  return { assets: out, dropped, truncatedByCount };
}

export function parseBlueprintAssets(raw: unknown): BlueprintAsset[] {
  return parseBlueprintAssetsDetailed(raw).assets;
}

/**
 * Same parsing as parseBlueprintAssets, but throws instead of silently
 * dropping oversized/excess assets. Use on template save/update paths so a
 * page image lost to a size limit fails loudly rather than quietly leaving
 * a gap (mirrors the check already done on the /generate path).
 */
export function parseBlueprintAssetsStrict(raw: unknown): BlueprintAsset[] {
  const { assets, dropped } = parseBlueprintAssetsDetailed(raw);
  if (dropped.length > 0) {
    throw new Error(
      `Some sample pages/images were too large or too many to save (${dropped
        .slice(0, 6)
        .join(", ")}${dropped.length > 6 ? "…" : ""}). Try a smaller file or fewer pages.`,
    );
  }
  return assets;
}

function pageAssetNumber(id: string): number {
  const match = /^page-(\d+)$/i.exec(id.trim());
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

/** Sorted page-* assets for page-clone assembly (vector pageHtml or raster fallback). */
export function listPageCloneAssets(assets: BlueprintAsset[]): BlueprintAsset[] {
  return assets
    .filter((asset) => /^page-\d+$/i.test(asset.id))
    .sort(
      (a, b) =>
        pageAssetNumber(a.id) - pageAssetNumber(b.id) || a.id.localeCompare(b.id),
    );
}

/**
 * Lock absolute pdf-text boxes so longer personalization cannot spill into
 * neighboring spans (min-width grows with content; width + overflow clips).
 *
 * Do NOT adjust `top` or invent `height` here — those corrupt multi-page
 * blueprint HTML (tops from different pages interleave and spacing explodes).
 */
export function repairPageCloneTextOverlap(pageHtml: string): string {
  if (!pageHtml || !/pdf-text/i.test(pageHtml)) return pageHtml;
  return pageHtml.replace(
    /(<span\b[^>]*\bclass="[^"]*\bpdf-text\b[^"]*"[^>]*\bstyle=")([^"]*)(")/gi,
    (_full, open: string, style: string, close: string) => {
      let next = style;
      // Strip bad height locks from the earlier overlap fix.
      next = next.replace(/(?:^|;)\s*height:\s*1\.\d+em;?/gi, ";");
      const minWidth = /(?:^|;)\s*min-width:\s*([\d.]+)%/i.exec(next);
      if (minWidth) {
        const w = minWidth[1];
        next = next.replace(/(?:^|;)\s*min-width:\s*[\d.]+%;?/i, ";");
        if (!/(?:^|;)\s*width:\s*[\d.]+%/i.test(next)) {
          next += `width:${w}%;max-width:${w}%;`;
        } else if (!/(?:^|;)\s*max-width:\s*/i.test(next)) {
          next += `max-width:${w}%;`;
        }
      }
      next = next.replace(/;;+/g, ";").replace(/^;|;$/g, "");
      return `${open}${next}${close}`;
    },
  );
}

/** Page-clone CSS hardening shared by sync + render paths. */
export const PAGE_CLONE_TEXT_CSS = [
  ".proposal-blueprint .pdf-text{position:absolute;white-space:pre;line-height:1;",
  "overflow:hidden;box-sizing:border-box;",
  "font-family:Arial,Helvetica,sans-serif;}",
  ".proposal-blueprint .pdf-shape{position:absolute;box-sizing:border-box;}",
].join("");

/** One bp-page-clone block — mirrors ai-service document_template_agent._page_clone_blueprint. */
export function buildPageCloneBlock(asset: BlueprintAsset): string {
  const pageHtml = repairPageCloneTextOverlap(asset.pageHtml?.trim() || "");
  if (pageHtml) {
    const pageWidth = asset.pageWidth && asset.pageWidth > 0 ? asset.pageWidth : 1;
    const pageHeight = asset.pageHeight && asset.pageHeight > 0 ? asset.pageHeight : 1;
    const ratio = Math.round((pageHeight / pageWidth) * 100 * 10_000) / 10_000;
    return (
      `<div class="bp-page-clone bp-page-clone-vector" style="padding-top:${ratio}%;">` +
      `<div class="pdf-page-abs">${pageHtml}</div></div>`
    );
  }
  if (asset.dataBase64?.trim()) {
    return (
      `<div class="bp-page-clone">` +
      `<img class="bp-page-img" src="asset:${asset.id}" alt="Sample page"/></div>`
    );
  }
  return "";
}

/**
 * Rebuild blueprint.html from page-* assets so preview/PDF match patched pageHtml.
 * Vector pageHtml is the source of truth after personalize or per-page text patches.
 */
export function syncPageCloneBlueprintFromAssets(
  blueprint: DocumentBlueprint,
  assets: BlueprintAsset[],
): { blueprint: DocumentBlueprint; changed: boolean; assets: BlueprintAsset[] } {
  const isPageClone =
    blueprint.mode === "page-clone" || /bp-page-clone/i.test(blueprint.html || "");
  if (!isPageClone) return { blueprint, changed: false, assets };

  const repairedAssets = assets.map((asset) => {
    if (!asset.pageHtml?.trim()) return asset;
    const pageHtml = repairPageCloneTextOverlap(asset.pageHtml);
    return pageHtml === asset.pageHtml ? asset : { ...asset, pageHtml };
  });

  const pageAssets = listPageCloneAssets(repairedAssets).filter(
    (asset) => asset.pageHtml?.trim() || asset.dataBase64?.trim(),
  );
  if (!pageAssets.length) return { blueprint, changed: false, assets: repairedAssets };

  const blocks = pageAssets.map(buildPageCloneBlock).filter(Boolean).join("");
  const nextHtml = `<div class="bp-page-clone-root">${blocks}</div>`;
  let nextCss = blueprint.css || "";
  if (/bp-page-clone/i.test(nextHtml) && !/\.pdf-text\{[^}]*overflow\s*:\s*hidden/i.test(nextCss)) {
    nextCss = `${nextCss}\n${PAGE_CLONE_TEXT_CSS}`.trim();
  }
  const assetsChanged = repairedAssets.some(
    (asset, i) => asset.pageHtml !== assets[i]?.pageHtml,
  );
  if (
    nextHtml === blueprint.html &&
    nextCss === (blueprint.css || "") &&
    !assetsChanged
  ) {
    return { blueprint, changed: false, assets: repairedAssets };
  }

  return {
    blueprint: {
      ...blueprint,
      mode: blueprint.mode ?? "page-clone",
      html: nextHtml,
      css: nextCss,
    },
    changed: true,
    assets: repairedAssets,
  };
}

/** Default branded layout when no sample was analyzed. */
export function defaultDocumentBlueprint(
  kind: "proposal" | "quote" | "invoice",
): DocumentBlueprint {
  const title =
    kind === "quote" ? "Quotation" : kind === "invoice" ? "Invoice" : "Proposal";
  const css = `
.proposal-blueprint { font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; background: #fff; }
.proposal-blueprint .bp-header { border-bottom: 3px solid #1e3a5f; padding-bottom: 1rem; margin-bottom: 1.5rem; }
.proposal-blueprint .bp-header h1 { margin: 0; font-size: 1.75rem; color: #1e3a5f; }
.proposal-blueprint .bp-meta { color: #64748b; font-size: 0.875rem; margin-top: 0.35rem; }
.proposal-blueprint .bp-section { margin-bottom: 1.25rem; }
.proposal-blueprint .bp-section h2 { font-size: 1.1rem; color: #1e3a5f; margin: 0 0 0.5rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.25rem; }
.proposal-blueprint .bp-section .bp-body { white-space: pre-wrap; line-height: 1.55; font-size: 0.95rem; }
.proposal-blueprint .bp-footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #e2e8f0; font-size: 0.8rem; color: #64748b; }
`.trim();
  const header = `
<header class="bp-header">
  <h1>${title}</h1>
  <div class="bp-meta">{{companyName}} · {{customerName}} · {{date}}</div>
</header>`.trim();
  const footer = `<footer class="bp-footer">Prepared by {{vendorName}}</footer>`;

  if (kind === "quote") {
    return {
      version: 1,
      theme: {
        primary: "#1e3a5f",
        secondary: "#64748b",
        fonts: "Georgia, 'Times New Roman', serif",
        background: "#ffffff",
      },
      slots: [
        { key: "introduction", label: "Introduction" },
        { key: "line_items", label: "Line items" },
        { key: "tax_note", label: "Taxes" },
        { key: "bank", label: "Bank details" },
        { key: "terms", label: "Terms & conditions" },
        { key: "payment_terms", label: "Payment terms" },
        { key: "delivery", label: "Delivery timeline" },
      ],
      css,
      html: `
${header}
<section class="bp-section" data-slot="introduction">
  <h2 data-slot-title>Introduction</h2>
  <div class="bp-body" data-slot-body></div>
</section>
<section class="bp-section" data-slot="line_items">
  <h2 data-slot-title>Line items</h2>
  <div class="bp-body" data-slot-body></div>
</section>
<section class="bp-section" data-slot="tax_note">
  <h2 data-slot-title>Taxes</h2>
  <div class="bp-body" data-slot-body></div>
</section>
<section class="bp-section" data-slot="bank">
  <h2 data-slot-title>Bank details</h2>
  <div class="bp-body" data-slot-body></div>
</section>
<section class="bp-section" data-slot="terms">
  <h2 data-slot-title>Terms &amp; conditions</h2>
  <div class="bp-body" data-slot-body></div>
</section>
<section class="bp-section" data-slot="payment_terms">
  <h2 data-slot-title>Payment terms</h2>
  <div class="bp-body" data-slot-body></div>
</section>
<section class="bp-section" data-slot="delivery">
  <h2 data-slot-title>Delivery timeline</h2>
  <div class="bp-body" data-slot-body></div>
</section>
${footer}
`.trim(),
    };
  }

  if (kind === "invoice") {
    return {
      version: 1,
      theme: {
        primary: "#1e3a5f",
        secondary: "#64748b",
        fonts: "Georgia, 'Times New Roman', serif",
        background: "#ffffff",
      },
      slots: [
        { key: "introduction", label: "Introduction" },
        { key: "line_items", label: "Line items" },
        { key: "payment", label: "Payment" },
      ],
      css,
      html: `
${header}
<section class="bp-section" data-slot="introduction">
  <h2 data-slot-title>Introduction</h2>
  <div class="bp-body" data-slot-body></div>
</section>
<section class="bp-section" data-slot="line_items">
  <h2 data-slot-title>Line items</h2>
  <div class="bp-body" data-slot-body></div>
</section>
<section class="bp-section" data-slot="payment">
  <h2 data-slot-title>Payment</h2>
  <div class="bp-body" data-slot-body></div>
</section>
${footer}
`.trim(),
    };
  }

  return {
    version: 1,
    theme: {
      primary: "#1e3a5f",
      secondary: "#64748b",
      fonts: "Georgia, 'Times New Roman', serif",
      background: "#ffffff",
    },
    slots: [
      { key: "introduction", label: "Introduction" },
      { key: "features", label: "Overview" },
      { key: "scope", label: "Scope" },
      { key: "commercials", label: "Commercials" },
      { key: "conclusion", label: "Next steps" },
    ],
    css,
    html: `
${header}
<section class="bp-section" data-slot="introduction">
  <h2 data-slot-title>Introduction</h2>
  <div class="bp-body" data-slot-body></div>
</section>
<section class="bp-section" data-slot="features">
  <h2 data-slot-title>Overview</h2>
  <div class="bp-body" data-slot-body></div>
</section>
<section class="bp-section" data-slot="scope">
  <h2 data-slot-title>Scope</h2>
  <div class="bp-body" data-slot-body></div>
</section>
<section class="bp-section" data-slot="commercials">
  <h2 data-slot-title>Commercials</h2>
  <div class="bp-body" data-slot-body></div>
</section>
<section class="bp-section" data-slot="conclusion">
  <h2 data-slot-title>Next steps</h2>
  <div class="bp-body" data-slot-body></div>
</section>
${footer}
`.trim(),
  };
}

export type MergeSection = {
  key?: string;
  title: string;
  body: string;
  tableRows?: Array<{ cells: string[] }>;
  tableSpec?: unknown;
};

export type BlueprintMergeTokens = Record<string, string>;

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Turn JSON-escaped \\n / \\t into real whitespace (AI often double-escapes). */
export function normalizeDocumentText(raw: string): string {
  let s = raw ?? "";
  for (let i = 0; i < 4; i++) {
    if (!/\\[nrt]/.test(s)) break;
    s = s
      .replace(/\\r\\n/g, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\r/g, "\n");
  }
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function repairProposalMarkup(text: string): string {
  return text
    .replace(/\$\\rightarrow\$/gi, "→")
    .replace(/\$\s*\\?rightarrow\s*\$/gi, "→")
    .replace(/\$\s*ightarrow\s*\$/gi, "→")
    .replace(/\\rightarrow/gi, "→")
    .replace(/\\downarrow/gi, "↓")
    .replace(/\$\s*downarrow\s*\$/gi, "↓");
}

function wrapLearnedLabel(html: string, label: string, className: string): string {
  const trimmed = label.trim();
  if (!trimmed) return html;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `(?:<strong>)?(\\s*${escaped}\\s*)(?:<\\/strong>)?`,
    "gi",
  );
  return html.replace(re, `<span class="${className}">$1</span>`);
}

function formatInlineHtml(
  text: string,
  emphasis?: DocumentBlueprint["emphasis"],
): string {
  const withMdImgs = repairProposalMarkup(text).replace(
    /<img\b[^>]*\bsrc=["'](asset:[a-z0-9_-]+|data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+|https?:\/\/[^"'\s>]+)["'][^>]*\/?>/gi,
    (m, src: string) => {
      const altMatch = m.match(/\balt=["']([^"']*)["']/i);
      const alt = altMatch?.[1] || "";
      return `![${alt}](${String(src).replace(/\s+/g, "")})`;
    },
  );
  let s = escapeHtml(withMdImgs);
  s = s.replace(
    /!\[([^\]]*)\]\((asset:[a-z0-9_-]+|data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+|https?:\/\/[^)\s]+)\)/gi,
    (_m, alt: string, src: string) => {
      const cleanSrc = String(src).replace(/\s+/g, "");
      const safeAlt = String(alt || "").replace(/"/g, "");
      const cls = /asset:logo|logo/i.test(cleanSrc + safeAlt)
        ? "bp-inline-logo"
        : /asset:hero|hero/i.test(cleanSrc + safeAlt)
          ? "bp-inline-hero"
          : "bp-inline-img";
      return `<img class="${cls}" src="${cleanSrc}" alt="${safeAlt}" />`;
    },
  );
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  if (emphasis?.requestedLabel) {
    s = wrapLearnedLabel(s, emphasis.requestedLabel, "bp-requested");
  }
  if (emphasis?.recommendedLabel) {
    s = wrapLearnedLabel(s, emphasis.recommendedLabel, "bp-recommended");
  }
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^_])_([^_\n]+?)_(?!_)/g, "$1<em>$2</em>");
  s = s.replace(/`([^`]+)`/g, "$1");
  s = s.replace(/\*\*/g, "").replace(/__/g, "");
  return s;
}

/** Convert section body into safe, human-readable HTML (no raw \\n or **). */
function isPipeTableRow(line: string): boolean {
  const t = line.trim();
  if (!t.includes("|")) return false;
  // Need at least two cells worth of pipes (header or body row).
  const cells = t.split("|").filter((c) => c.trim().length > 0);
  return cells.length >= 2;
}

function isPipeSeparatorRow(line: string): boolean {
  const t = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  if (!t) return false;
  return /^[\s|:-]+$/.test(t) && /[-:]/.test(t);
}

function parsePipeCells(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").map((c) => c.trim());
}

function formatPipeTableHtml(
  rows: string[],
  formatInline: (text: string) => string,
): string {
  if (rows.length === 0) return "";
  let header: string[] | null = null;
  let bodyStart = 0;
  if (rows.length >= 2 && isPipeSeparatorRow(rows[1]!)) {
    header = parsePipeCells(rows[0]!);
    bodyStart = 2;
  }
  const bodyRows = rows
    .slice(bodyStart)
    .filter((r) => !isPipeSeparatorRow(r))
    .map(parsePipeCells);
  const parts: string[] = ['<table class="bp-table">'];
  if (header) {
    parts.push("<thead><tr>");
    for (const cell of header) {
      parts.push(`<th>${formatInline(cell)}</th>`);
    }
    parts.push("</tr></thead>");
  }
  parts.push("<tbody>");
  for (const cells of bodyRows) {
    if (!cells.length) continue;
    parts.push("<tr>");
    for (const cell of cells) {
      parts.push(`<td>${formatInline(cell)}</td>`);
    }
    parts.push("</tr>");
  }
  parts.push("</tbody></table>");
  return parts.join("");
}

/** ALL-CAPS label lines used as fake headings in rewritten proposal copy. */
export function looksLikeAllCapsHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 8 || trimmed.length > 90) return false;
  if (isPipeTableRow(trimmed)) return false;
  if (/^[-*•]\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed)) return false;
  if (/^#{1,6}\s+/.test(trimmed)) return false;
  const letters = trimmed.replace(/[^A-Za-z]/g, "");
  if (letters.length < 6) return false;
  const upper = letters.replace(/[^A-Z]/g, "").length;
  if (upper / letters.length < 0.82) return false;
  if (/[.!?]$/.test(trimmed) && trimmed.split(/\s+/).length > 8) return false;
  return true;
}

function looksLikeStandaloneParagraph(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length > 180) return true;
  const sentences = trimmed.split(/(?<=[.!?])\s+/).filter((part) => part.length > 20);
  return sentences.length >= 2;
}

export function formatSectionBodyHtml(
  raw: string,
  emphasis?: DocumentBlueprint["emphasis"],
): string {
  const text = normalizeDocumentText(raw).trim();
  if (!text) return "";

  const lines = text.split("\n");
  const parts: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let paraLines: string[] = [];
  let tableLines: string[] = [];
  let afterHeading = false;
  const inline = (value: string) => formatInlineHtml(value, emphasis);

  const closeList = () => {
    if (!listType) return;
    parts.push(`</${listType}>`);
    listType = null;
  };
  const flushPara = () => {
    if (!paraLines.length) return;
    parts.push(
      `<p>${paraLines.map((l) => inline(l)).join("<br/>")}</p>`,
    );
    paraLines = [];
  };
  const flushTable = () => {
    if (!tableLines.length) return;
    parts.push(formatPipeTableHtml(tableLines, inline));
    tableLines = [];
  };
  const openList = (type: "ul" | "ol") => {
    if (listType === type) return;
    closeList();
    listType = type;
    parts.push(`<${type}>`);
  };
  const emitSubheading = (label: string) => {
    flushPara();
    closeList();
    parts.push(`<p class="sec-subh"><strong>${inline(label)}</strong></p>`);
    afterHeading = true;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushPara();
      flushTable();
      closeList();
      continue;
    }
    if (isPipeTableRow(trimmed)) {
      flushPara();
      closeList();
      afterHeading = false;
      tableLines.push(trimmed);
      continue;
    }
    flushTable();
    const bullet = trimmed.match(/^[-*•]\s+(.+)$/);
    const numbered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (bullet) {
      flushPara();
      afterHeading = false;
      openList("ul");
      parts.push(`<li>${inline(bullet[1]!)}</li>`);
      continue;
    }
    if (numbered) {
      flushPara();
      afterHeading = false;
      openList("ol");
      parts.push(`<li>${inline(numbered[1]!)}</li>`);
      continue;
    }
    const heading = trimmed.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      emitSubheading(heading[1]!);
      continue;
    }
    if (looksLikeAllCapsHeading(trimmed)) {
      emitSubheading(trimmed);
      continue;
    }
    if (afterHeading && !looksLikeStandaloneParagraph(trimmed)) {
      flushPara();
      openList("ul");
      parts.push(`<li>${inline(trimmed)}</li>`);
      continue;
    }
    afterHeading = false;
    closeList();
    paraLines.push(trimmed);
  }
  flushPara();
  flushTable();
  closeList();
  return dedupeRepeatedHtmlBlocks(parts.join(""));
}

/** Frozen playbook HTML often uses class bp-slot-body instead of data-slot-body. */
const SLOT_BODY_OPEN =
  /(<div[^>]*(?:data-slot-body|bp-slot-body)[^>]*>)([\s\S]*?)(<\/div>)/i;

function dedupeRepeatedHtmlBlocks(html: string): string {
  const listsCollapsed = html.replace(
    /<(ul|ol)>([\s\S]*?)<\/\1>/gi,
    (_m, tag: string, inner: string) => {
      const seen = new Set<string>();
      const items = [...inner.matchAll(/<li>[\s\S]*?<\/li>/gi)]
        .map((m) => m[0])
        .filter((item) => {
          const key = item.replace(/\s+/g, " ").trim().toLowerCase();
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      return `<${tag}>${items.join("")}</${tag}>`;
    },
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of listsCollapsed.split(/(?=<p\b|<ul\b|<ol\b)/i)) {
    const key = part.replace(/\s+/g, " ").trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(part);
  }
  return out.join("");
}

/** Drop leftover template paragraphs so the filled body is not shown twice. */
function keepStructuralRemainder(rest: string): string {
  return rest
    .replace(/<p\b[^>]*>[\s\S]*?<\/p>/gi, "")
    .replace(/<ul\b[^>]*>[\s\S]*?<\/ul>/gi, "")
    .replace(/<ol\b[^>]*>[\s\S]*?<\/ol>/gi, "")
    .replace(
      /<div\b[^>]*(?:bp-body|bp-slot-body|data-slot-body)[^>]*>[\s\S]*?<\/div>/gi,
      "",
    );
}

export function injectLearnedSectionBody(inner: string, bodyHtml: string): string {
  const html = String(bodyHtml || "").trim();
  if (!html) return inner;
  const wrapped = `<div class="bp-body bp-slot-body" data-slot-body>${html}</div>`;
  if (SLOT_BODY_OPEN.test(inner)) {
    const filled = inner.replace(
      SLOT_BODY_OPEN,
      (_m, open: string, _old: string, close: string) => `${open}${html}${close}`,
    );
    return filled.replace(
      /(<div[^>]*(?:data-slot-body|bp-slot-body)[^>]*>[\s\S]*?<\/div>)([\s\S]*)/i,
      (_m, slot: string, rest: string) => `${slot}${keepStructuralRemainder(rest)}`,
    );
  }
  if (/<h[12]\b/i.test(inner)) {
    return inner.replace(
      /(<h[12]\b[^>]*>[\s\S]*?<\/h[12]>)([\s\S]*)/i,
      (_m, heading: string, rest: string) =>
        `${heading}${wrapped}${keepStructuralRemainder(rest)}`,
    );
  }
  return `${wrapped}${keepStructuralRemainder(inner)}`;
}

export function formatSectionTitleHtml(raw: string): string {
  return formatInlineHtml(
    normalizeDocumentText(raw)
      .replace(/^#{1,6}\s+/, "")
      .trim(),
  );
}

/** Sample PDFs put cover chrome in the layout — these slots are OCR duplicates. */
export const LAYOUT_SLOT_KEYS = new Set([
  "cover",
  "footer",
  "header",
  "letterhead",
]);

export function isLayoutSlotKey(key: string | null | undefined): boolean {
  const k = (key || "").trim().toLowerCase();
  return LAYOUT_SLOT_KEYS.has(k);
}

/**
 * Slot keys that can be filled by alternate section keys (quote/invoice line
 * tables often use `line_items` while proposal-style layouts use `commercials`).
 */
const SLOT_SECTION_ALIASES: Record<string, string[]> = {
  commercials: ["commercials", "line_items", "items"],
  line_items: ["line_items", "commercials", "items"],
  items: ["items", "line_items", "commercials"],
  body: ["body", "line_items", "commercials"],
  features: ["features", "overview", "key_features"],
  overview: ["overview", "features"],
  conclusion: ["conclusion", "next_steps", "closing"],
  closing: ["closing", "conclusion", "next_steps"],
  tax_note: ["tax_note", "taxes", "tax"],
  tax: ["tax", "tax_note", "taxes", "financial_summary"],
  payment: ["payment", "payment_details", "bank"],
  payment_terms: ["payment_terms", "payment_details"],
  disclaimer: ["disclaimer", "footer", "closing"],
  customer: ["customer", "bill_to", "billing"],
};

export function resolveSectionForSlot(
  byKey: Map<string, MergeSection>,
  slotKey: string,
): { section: MergeSection; matchedKey: string } | null {
  const primary = String(slotKey || "").trim().toLowerCase();
  if (!primary || isLayoutSlotKey(primary)) return null;
  const lowerMap = new Map(
    [...byKey.entries()].map(([k, section]) => [
      k.toLowerCase(),
      { key: k, section },
    ]),
  );
  const candidates = SLOT_SECTION_ALIASES[primary] ?? [primary];
  let fallback: { section: MergeSection; matchedKey: string } | null = null;
  for (const candidate of candidates) {
    const hit = lowerMap.get(candidate.toLowerCase());
    if (!hit) continue;
    const body = (hit.section.body || "").trim();
    if (body) return { section: hit.section, matchedKey: hit.key };
    if (!fallback) fallback = { section: hit.section, matchedKey: hit.key };
  }
  return fallback;
}

/** Match an element including nested same-tag children (balanced open/close). */
export function matchBalancedElement(
  html: string,
  openRe: RegExp,
): { full: string; start: number; end: number } | null {
  const flags = openRe.flags.includes("g") ? openRe.flags : `${openRe.flags}g`;
  const re = new RegExp(openRe.source, flags);
  const open = re.exec(html);
  if (!open || open.index < 0) return null;
  const start = open.index;
  const openTag = open[0];
  const tagMatch = openTag.match(/^<\s*([a-z0-9]+)/i);
  if (!tagMatch?.[1]) return null;
  const tag = tagMatch[1].toLowerCase();
  // Self-closing
  if (/\/\s*>$/.test(openTag)) {
    return { full: openTag, start, end: start + openTag.length };
  }

  const openToken = new RegExp(`<\\s*${tag}\\b[^>]*>`, "gi");
  const closeToken = new RegExp(`</\\s*${tag}\\s*>`, "gi");
  let depth = 1;
  let i = start + openTag.length;
  while (i < html.length && depth > 0) {
    openToken.lastIndex = i;
    closeToken.lastIndex = i;
    const nextOpen = openToken.exec(html);
    const nextClose = closeToken.exec(html);
    if (!nextClose) break;
    if (nextOpen && nextOpen.index < nextClose.index) {
      // Self-closing open tags don't increase depth.
      if (!/\/\s*>$/.test(nextOpen[0])) depth += 1;
      i = nextOpen.index + nextOpen[0].length;
    } else {
      depth -= 1;
      i = nextClose.index + nextClose[0].length;
      if (depth === 0) {
        return { full: html.slice(start, i), start, end: i };
      }
    }
  }
  return null;
}

/** Drop OCR'd cover/footer section slots (real cover is bp-letterhead + bp-cover). */
export function stripLayoutSectionSlots(html: string): string {
  return (html || "").replace(
    /<section\b[^>]*\bdata-slot="(cover|footer|header|letterhead)"[^>]*>[\s\S]*?<\/section>/gi,
    "",
  );
}

/**
 * Repair previously corrupted cover HTML (orphan closing tags from nested-div
 * truncation) so regenerates stay format-stable.
 */
export function repairBlueprintHtml(html: string): string {
  let next = (html || "").trim();
  // Leading orphan closers left by the old non-greedy cover regex.
  next = next.replace(/^(?:\s*<\/(?:div|section|header|footer)>\s*)+/i, "");
  // Drop empty page-break spacers that created blank pages.
  next = next.replace(/<div class="bp-page-break"[^>]*>\s*<\/div>/gi, "");
  return next;
}

/**
 * Keep cover title/hero on page 1 (sample PDF layout).
 * Letterhead/footer are stamped onto every PDF page — not duplicated in body.
 * Exact page clones and invoice letterheads keep in-body chrome.
 */
export function blueprintUsesExternalChrome(
  blueprint: DocumentBlueprint | null | undefined,
): boolean {
  if (!blueprint) return true;
  if (blueprint.chrome === false || blueprint.mode === "page-clone") return false;
  if (blueprint.mode === "playbook-layout" || blueprint.mode === "playbook-template") return false;
  const html = blueprint.html || "";
  if (/proposal-doc/i.test(html)) return false;
  if (/bp-page-clone|bp-letterhead|bp-inv-banner|bp-playbook-root/i.test(html)) {
    return false;
  }
  return true;
}

/** Live invoices from PDF page-clone templates use a commercial fill layout. */
export function isCommercialInvoiceBlueprint(
  blueprint: DocumentBlueprint | null | undefined,
): boolean {
  if (!blueprint) return false;
  const html = `${blueprint.html || ""}\n${blueprint.fillHtml || ""}`;
  if (/bp-inv-banner|CUSTOMER\s+DETAILS/i.test(html)) return true;
  // Invoice page-clones store mergeable fillHtml; proposal/quote clones leave it empty.
  if (blueprint.mode === "page-clone" && (blueprint.fillHtml || "").trim()) {
    return true;
  }
  return false;
}

/**
 * Fillable HTML matching Worktual / commercial invoice sample PDFs.
 * Letterhead uses sample branding; variable fields are deal/invoice tokens only.
 */
export function buildCommercialInvoiceFillBlueprint(input?: {
  hasLogo?: boolean;
  hasBrand?: boolean;
  tagline?: string | null;
}): Pick<
  DocumentBlueprint,
  "html" | "css" | "theme" | "slots" | "chrome"
> {
  // Prefer crisp logo mark + CSS wordmark (brand page-crop is often soft/pixelated).
  const hasLogo = input?.hasLogo !== false;
  const tagline = (input?.tagline || "").trim();
  const brand = hasLogo
    ? `<div class="bp-inv-brand"><img class="bp-inv-logo" src="asset:logo" alt=""/><div class="bp-inv-wordmark">{{vendorName}}</div></div>`
    : `<div class="bp-inv-brand"><div class="bp-inv-wordmark">{{vendorName}}</div></div>`;
  const taglineHtml = tagline
    ? `<div class="bp-inv-tagline">${escapeHtml(tagline)}</div>`
    : "";

  const html = `
<header class="bp-inv-banner">
  <div class="bp-inv-banner-left">
    ${brand}
    ${taglineHtml}
    <div class="bp-inv-seller">{{sellerLetterhead}}</div>
  </div>
  <div class="bp-inv-banner-right">
    <div class="bp-inv-meta-row"><strong>Invoice #:</strong> {{invoiceNumber}}</div>
    <div class="bp-inv-meta-row">Date: {{date}}</div>
  </div>
</header>

<section class="bp-section bp-inv-block" data-slot="customer">
  <h2 data-slot-title>Customer details</h2>
  <div class="bp-body" data-slot-body></div>
</section>

<section class="bp-section bp-inv-block" data-slot="line_items">
  <h2 data-slot-title>Items</h2>
  <div class="bp-body" data-slot-body></div>
</section>

<div class="bp-inv-mid">
  <div class="bp-inv-words">Amount in words: {{amountInWords}}</div>
  <section class="bp-section bp-inv-summary" data-slot="tax">
    <h2 data-slot-title>Financial Summary</h2>
    <div class="bp-body" data-slot-body></div>
  </section>
</div>

<div class="bp-inv-grid2">
  <section class="bp-section bp-inv-box" data-slot="payment">
    <h2 data-slot-title>Bank details</h2>
    <div class="bp-body" data-slot-body></div>
  </section>
  <section class="bp-section bp-inv-box" data-slot="disclaimer">
    <h2 data-slot-title>{{vendorLegalName}}</h2>
    <div class="bp-body" data-slot-body></div>
  </section>
</div>

<div class="bp-inv-grid3">
  <section class="bp-section bp-inv-box" data-slot="terms">
    <h2 data-slot-title>Terms &amp; Conditions</h2>
    <div class="bp-body" data-slot-body></div>
  </section>
  <section class="bp-section bp-inv-box" data-slot="payment_terms">
    <h2 data-slot-title>Payment Terms</h2>
    <div class="bp-body" data-slot-body></div>
  </section>
  <section class="bp-section bp-inv-box" data-slot="delivery">
    <h2 data-slot-title>Delivery Timeline</h2>
    <div class="bp-body" data-slot-body></div>
  </section>
</div>
`.trim();

  const css = `
.proposal-blueprint{font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;color:#111;background:#fff;max-width:794px;margin:0 auto;padding:0 0 24px;box-sizing:border-box}
.proposal-blueprint .bp-inv-banner{display:flex;justify-content:space-between;gap:28px;align-items:flex-start;background:#000;color:#fff;padding:20px 22px 18px;margin:0 0 28px}
.proposal-blueprint .bp-inv-banner-left{flex:1;min-width:0}
.proposal-blueprint .bp-inv-banner-right{flex:0 0 auto;text-align:right;font-size:12px;line-height:1.55;padding-top:4px;white-space:nowrap}
.proposal-blueprint .bp-inv-brand{display:flex;align-items:center;gap:12px;margin:0 0 12px}
.proposal-blueprint .bp-inv-brand-img{display:block;height:28px;width:auto;max-width:280px;object-fit:contain;margin:0 0 12px}
.proposal-blueprint .bp-inv-logo{display:block;height:32px;width:auto;object-fit:contain;flex:0 0 auto}
.proposal-blueprint .bp-inv-wordmark{font-size:22px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin:0;line-height:1;color:#fff;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif}
.proposal-blueprint .bp-inv-tagline{font-size:11px;opacity:.9;margin:0 0 6px}
.proposal-blueprint .bp-inv-seller{font-size:11px;line-height:1.45;opacity:.95;white-space:pre-wrap;max-width:34em}
.proposal-blueprint .bp-inv-meta-row{margin:0 0 2px}
.proposal-blueprint .bp-inv-block{padding:0 22px;margin:0 0 1.35rem}
.proposal-blueprint .bp-section h2{font-size:10px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#9ca3af;margin:0 0 .65rem;border:none;padding:0}
.proposal-blueprint .bp-inv-summary h2,.proposal-blueprint .bp-inv-box h2{color:#111;font-size:13px;letter-spacing:0;text-transform:none;font-weight:700;margin:0 0 .55rem}
.proposal-blueprint .bp-section .bp-body{white-space:pre-wrap;line-height:1.5;font-size:13px;color:#111}
.proposal-blueprint .bp-inv-customer-name{font-size:22px;font-weight:700;margin:0 0 .45rem;line-height:1.2}
.proposal-blueprint .bp-inv-billto{font-size:13px;line-height:1.45;color:#111}
.proposal-blueprint .bp-table{width:100%;border-collapse:collapse;margin:.1em 0 .2em;font-size:12px;table-layout:fixed;border:1px solid #d1d5db}
.proposal-blueprint .bp-table th,.proposal-blueprint .bp-table td{border:1px solid #d1d5db;padding:.55em .55em;text-align:left;vertical-align:top;line-height:1.4}
.proposal-blueprint .bp-table th{font-weight:700;background:#f3f4f6;color:#111}
.proposal-blueprint .bp-table td:nth-child(3),.proposal-blueprint .bp-table th:nth-child(3){text-align:center;width:8%}
.proposal-blueprint .bp-table td:nth-child(4),.proposal-blueprint .bp-table th:nth-child(4),
.proposal-blueprint .bp-table td:nth-child(5),.proposal-blueprint .bp-table th:nth-child(5){text-align:right;width:16%}
.proposal-blueprint .bp-table td:nth-child(1),.proposal-blueprint .bp-table th:nth-child(1){width:28%}
.proposal-blueprint .bp-inv-mid{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;padding:0 22px;margin:0 0 1.35rem}
.proposal-blueprint .bp-inv-words{flex:1;font-size:12px;color:#374151;padding-top:10px}
.proposal-blueprint .bp-inv-summary{flex:0 0 250px;border:1px solid #d1d5db;border-radius:8px;padding:12px 14px;margin:0;background:#fff}
.proposal-blueprint .bp-inv-grid2{display:grid;grid-template-columns:1.35fr 1fr;gap:12px;padding:0 22px;margin:0 0 12px}
.proposal-blueprint .bp-inv-grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;padding:0 22px}
.proposal-blueprint .bp-inv-box{border:1px solid #d1d5db;border-radius:8px;padding:12px 14px;margin:0;background:#fff}
.proposal-blueprint .bp-inv-box .bp-body{font-size:12px;color:#374151;line-height:1.45}
@media (max-width:720px){
  .proposal-blueprint .bp-inv-banner{flex-direction:column}
  .proposal-blueprint .bp-inv-banner-right{text-align:left}
  .proposal-blueprint .bp-inv-mid,.proposal-blueprint .bp-inv-grid2,.proposal-blueprint .bp-inv-grid3{display:block}
  .proposal-blueprint .bp-inv-summary{margin-top:12px}
  .proposal-blueprint .bp-inv-box{margin-bottom:12px}
}
`.trim();

  return {
    chrome: false,
    theme: {
      primary: "#111111",
      secondary: "#9ca3af",
      fonts: "Arial, 'Helvetica Neue', Helvetica, sans-serif",
      background: "#ffffff",
    },
    slots: [
      { key: "customer", label: "Customer details" },
      { key: "line_items", label: "Items" },
      { key: "tax", label: "Financial Summary" },
      { key: "payment", label: "Bank details" },
      { key: "disclaimer", label: "Company note" },
      { key: "terms", label: "Terms & Conditions" },
      { key: "payment_terms", label: "Payment Terms" },
      { key: "delivery", label: "Delivery Timeline" },
    ],
    html,
    css,
  };
}

/** Crop logo+wordmark strip from a rasterized sample page (asset:page-1). */
export function cropBrandAssetFromPage(
  page: BlueprintAsset | undefined,
): BlueprintAsset | null {
  if (!page?.dataBase64) return null;
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-brand-"));
    const ext =
      page.mime.includes("png") ? "png" : page.mime.includes("webp") ? "webp" : "jpg";
    const src = path.join(dir, `page.${ext}`);
    const out = path.join(dir, "brand.png");
    fs.writeFileSync(src, Buffer.from(page.dataBase64, "base64"));
    const script = `
from PIL import Image
im=Image.open(${JSON.stringify(src)}).convert("RGB")
w,h=im.size
brand=im.crop((int(w*0.03), int(h*0.018), int(w*0.38), int(h*0.048)))
brand.save(${JSON.stringify(out)}, "PNG")
`;
    const py =
      process.env.PDF_EXTRACT_PYTHON?.trim() ||
      "/usr/bin/python3";
    const proc = spawnSync(py, ["-c", script], { encoding: "utf8" });
    if (proc.status !== 0 || !fs.existsSync(out)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      return null;
    }
    const data = fs.readFileSync(out);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    if (!data.length || data.length > 400_000) return null;
    return {
      id: "brand",
      kind: "image",
      mime: "image/png",
      dataBase64: data.toString("base64"),
    };
  } catch {
    return null;
  }
}

/** Template preview keeps page images; live invoices may use commercial fill. */
export function resolveBlueprintForView(
  blueprint: DocumentBlueprint,
  variant: "exact" | "fillable" = "exact",
  opts?: { hasLogo?: boolean; hasBrand?: boolean; tagline?: string | null },
): DocumentBlueprint {
  if (variant !== "fillable") return blueprint;
  // Proposal/quote page-clones stay on exact page images (no fillHtml redesign).
  if (blueprint.mode === "page-clone" && !(blueprint.fillHtml || "").trim()) {
    return blueprint;
  }
  if (isCommercialInvoiceBlueprint(blueprint)) {
    const fill = buildCommercialInvoiceFillBlueprint({
      hasLogo: opts?.hasLogo,
      hasBrand: opts?.hasBrand,
      tagline: opts?.tagline,
    });
    return {
      ...blueprint,
      html: fill.html,
      css: fill.css,
      theme: fill.theme,
      slots: fill.slots,
      chrome: false,
      mode: undefined,
    };
  }
  if ((blueprint.fillHtml || "").trim()) {
    return {
      ...blueprint,
      html: blueprint.fillHtml!.trim(),
      css: (blueprint.fillCss || blueprint.css || "").trim(),
      mode: undefined,
      chrome: false,
    };
  }
  return blueprint;
}

export function pinChromeToCoverPage(
  html: string,
  keepInBodyChrome = false,
): string {
  let next = repairBlueprintHtml(stripLayoutSectionSlots(html));
  if (keepInBodyChrome) {
    return next;
  }

  // Already wrapped — strip any letterhead/footer left inside (chrome is stamped).
  if (/bp-cover-page/i.test(next)) {
    return stripInBodyPageChrome(next);
  }

  const letterhead =
    matchBalancedElement(
      next,
      /<header\b[^>]*class="[^"]*\bbp-letterhead\b[^"]*"[^>]*>/i,
    )?.full ||
    matchBalancedElement(
      next,
      /<header\b[^>]*class="[^"]*\bbp-header\b[^"]*"[^>]*>/i,
    )?.full ||
    "";
  const coverMatch = matchBalancedElement(
    next,
    /<div\b[^>]*class="[^"]*\bbp-cover(?!-)\b[^"]*"[^>]*>/i,
  );
  const cover = coverMatch?.full || "";
  const footer =
    matchBalancedElement(
      next,
      /<footer\b[^>]*class="[^"]*\bbp-footer\b[^"]*"[^>]*>/i,
    )?.full || "";

  if (!cover) return next;

  if (letterhead) next = next.replace(letterhead, "");
  next = next.replace(cover, "");
  if (footer) next = next.replace(footer, "");
  next = repairBlueprintHtml(next);

  const coverPage = `<div class="bp-cover-page">${cover}</div>`;

  if (/<section\b/i.test(next)) {
    next = next.replace(/<section\b/i, `${coverPage}<section`);
  } else {
    next = `${coverPage}${next}`;
  }
  return next;
}

/**
 * Minimal structural CSS. Template CSS owns fonts/colors/alignment.
 * Tables get thin black borders like typical uploaded Word/PDF samples.
 */
const BODY_BASE_CSS = `
.proposal-blueprint .bp-body p{margin:0 0 .7em}
.proposal-blueprint .bp-body p:last-child{margin-bottom:0}
.proposal-blueprint .bp-body ul,.proposal-blueprint .bp-body ol,
.proposal-blueprint .proposal-doc ul,.proposal-blueprint .proposal-doc ol{margin:.35em 0 .85em;padding-left:1.35em}
.proposal-blueprint .bp-body li,.proposal-blueprint .proposal-doc li{margin:.22em 0;line-height:1.45}
.proposal-blueprint .bp-body strong{font-weight:700}
.proposal-blueprint .bp-body em{font-style:italic}
.proposal-blueprint .bp-body p.sec-subh,
.proposal-blueprint .proposal-doc p.sec-subh{font-weight:700;margin:.9em 0 .3em;line-height:1.3}
.proposal-blueprint .bp-table{width:100%;max-width:100%;border-collapse:collapse;margin:.5em 0 1em;font-size:inherit;table-layout:fixed}
.proposal-blueprint .bp-table th,.proposal-blueprint .bp-table td{vertical-align:top;line-height:1.4;overflow-wrap:anywhere;word-break:break-word}
.proposal-blueprint .bp-table th{font-weight:700}
.proposal-blueprint .bp-table th:first-child,.proposal-blueprint .bp-table td:first-child{width:38%}
.proposal-blueprint .bp-table th:nth-child(n+3),.proposal-blueprint .bp-table td:nth-child(n+3){width:14%;white-space:nowrap;text-align:right}
.proposal-blueprint .bp-table th:nth-child(2),.proposal-blueprint .bp-table td:nth-child(2){width:10%;white-space:nowrap;text-align:center}
.proposal-blueprint .bp-table th:last-child,.proposal-blueprint .bp-table td:last-child{text-align:right}
.proposal-blueprint .proposal-doc .bp-table th,
.proposal-blueprint .proposal-doc .bp-table td{width:auto;white-space:normal}
.proposal-blueprint .proposal-doc table.grid,
.proposal-blueprint .proposal-doc table.bp-table{
  display:table !important;
  table-layout:fixed !important;
  width:100% !important;
  max-width:100% !important;
}
.proposal-blueprint .proposal-doc table.grid thead,
.proposal-blueprint .proposal-doc table.bp-table thead{
  display:table-header-group !important;
}
.proposal-blueprint .proposal-doc table.grid tbody,
.proposal-blueprint .proposal-doc table.bp-table tbody{
  display:table-row-group !important;
}
.proposal-blueprint .proposal-doc table.grid tr,
.proposal-blueprint .proposal-doc table.bp-table tr{
  display:table-row !important;
}
.proposal-blueprint .proposal-doc table.grid th,
.proposal-blueprint .proposal-doc table.grid td,
.proposal-blueprint .proposal-doc table.bp-table th,
.proposal-blueprint .proposal-doc table.bp-table td{
  display:table-cell !important;
}
.proposal-blueprint .proposal-doc.table-borders-on table:not(.cover-meta){
  border-collapse:collapse;
}
.proposal-blueprint .proposal-doc.table-borders-on table:not(.cover-meta) th,
.proposal-blueprint .proposal-doc.table-borders-on table:not(.cover-meta) td{
  border-width:1px;
  border-style:solid;
}
.proposal-blueprint .proposal-doc.table-borders-off table:not(.cover-meta),
.proposal-blueprint .proposal-doc.table-borders-off table:not(.cover-meta) th,
.proposal-blueprint .proposal-doc.table-borders-off table:not(.cover-meta) td{
  border:none !important;
  outline:none !important;
  box-shadow:none !important;
}
.proposal-blueprint .proposal-doc table.cover-meta{
  width:100% !important;
  max-width:100% !important;
  table-layout:fixed !important;
  margin-left:0 !important;
  margin-right:0 !important;
}
.proposal-blueprint .proposal-doc .cover-meta td{text-align:left}
.proposal-blueprint .proposal-doc .cover-meta td:first-child{white-space:nowrap}
.proposal-blueprint .bp-playbook-cover{color:inherit;padding:0 0 1rem}
.proposal-blueprint header.bp-playbook-cover .bp-cover-brand{
  font-size:1.3rem;font-weight:700;line-height:1.25
}
.proposal-blueprint header.bp-playbook-cover .bp-cover-title,
.proposal-blueprint .bp-playbook-cover:not(.cover-block) .bp-cover-title{
  font-size:24px;font-weight:700;line-height:1.25;margin:.35rem 0 .4rem
}
.proposal-blueprint header.bp-playbook-cover .bp-cover-prepared{color:#333;font-size:.95rem;margin-top:.35rem}
.proposal-blueprint header.bp-playbook-cover .bp-cover-date{color:#595959;font-size:.9rem;margin-top:.1rem}
.proposal-blueprint .bp-section h2,
.proposal-blueprint .bp-playbook-root .bp-h2{
  font-size:14px;font-weight:700;line-height:1.3
}
.proposal-blueprint .bp-cover-page{page-break-after:always;break-after:page}
.proposal-blueprint .bp-cover{page-break-after:auto;break-after:auto}
.proposal-blueprint .bp-section{page-break-before:auto;break-before:auto;margin:0 0 1.25rem}
.proposal-blueprint .bp-section h2{page-break-after:avoid;break-after:avoid}
.proposal-blueprint img.bp-inline-logo{display:block;max-height:56px;width:auto;margin:0 0 .75em}
.proposal-blueprint img.bp-inline-hero{display:block;width:100%;max-height:220px;object-fit:cover;margin:.35em 0 1em}
.proposal-blueprint img.bp-inline-img{display:block;max-width:100%;height:auto;margin:.35em 0 .85em}
.proposal-blueprint img.bp-hero{display:block;width:100%;max-width:100%;margin:12px auto 0}
.proposal-blueprint .proposal-doc section.sec{text-align:left;padding-left:0;padding-right:0;margin-left:0;margin-right:0}
.proposal-blueprint .proposal-doc .cover-block.cover-align-center,
.proposal-blueprint .proposal-doc .cover-block.cover-align-center .cover-brand,
.proposal-blueprint .proposal-doc .cover-block.cover-align-center .cover-title,
.proposal-blueprint .proposal-doc .cover-block.cover-align-center .cover-prepared,
.proposal-blueprint .proposal-doc .cover-block.cover-align-center .cover-date,
.proposal-blueprint .proposal-doc .cover-block.cover-align-center .bp-cover-brand,
.proposal-blueprint .proposal-doc .cover-block.cover-align-center .bp-cover-title,
.proposal-blueprint .proposal-doc .cover-block.cover-align-center .bp-cover-prepared,
.proposal-blueprint .proposal-doc .cover-block.cover-align-center .bp-cover-date{text-align:center}
.proposal-blueprint .proposal-doc .cover-block.cover-align-center .cover-logo,
.proposal-blueprint .proposal-doc .cover-block.cover-align-center img.cover-logo{display:block;margin:0 auto .75rem;max-height:56px;width:auto}
.proposal-blueprint .proposal-doc .cover-block.cover-align-left,
.proposal-blueprint .proposal-doc .cover-block.cover-align-left .cover-brand,
.proposal-blueprint .proposal-doc .cover-block.cover-align-left .cover-title,
.proposal-blueprint .proposal-doc .cover-block.cover-align-left .cover-prepared,
.proposal-blueprint .proposal-doc .cover-block.cover-align-left .cover-date,
.proposal-blueprint .proposal-doc .cover-block.cover-align-left .bp-cover-brand,
.proposal-blueprint .proposal-doc .cover-block.cover-align-left .bp-cover-title,
.proposal-blueprint .proposal-doc .cover-block.cover-align-left .bp-cover-prepared,
.proposal-blueprint .proposal-doc .cover-block.cover-align-left .bp-cover-date{text-align:left;margin-left:0;margin-right:0}
.proposal-blueprint .proposal-doc .cover-block.cover-align-left .cover-logo,
.proposal-blueprint .proposal-doc .cover-block.cover-align-left img.cover-logo{display:block;margin:0 0 .75rem;max-height:56px;width:auto}
`.trim();

/** Page-break only — never override template fonts/sizes/alignment. */
const PRINT_FLOW_OVERRIDE_CSS = `
.proposal-blueprint .bp-cover-page{
  page-break-after:always !important;
  break-after:page !important;
  -webkit-column-break-after:always;
  display:block;
}
.proposal-blueprint .bp-section{page-break-before:auto !important;break-before:auto !important}
.proposal-blueprint .bp-section h2{page-break-after:avoid;break-after:avoid}
.proposal-blueprint .bp-table{page-break-inside:auto}
`.trim();

/**
 * Prefer fonts that Chromium can actually render in PDF (Calibri is often missing
 * and silently falls back to a serif face — format drift vs the uploaded sample).
 */
export function stabilizeTemplateCss(css: string): string {
  let next = css || "";
  next = next.replace(
    /font-family\s*:\s*Calibri\s*,\s*Arial/gi,
    "font-family:Arial,'Helvetica Neue',Helvetica,sans-serif",
  );
  next = next.replace(
    /font-family\s*:\s*Calibri\b/gi,
    "font-family:Arial,'Helvetica Neue',Helvetica,sans-serif",
  );
  return neutralizePlaceholderTableChrome(applyStoredTableHeaderFill(next));
}

/** Paint a measured --c-th onto white headers. Skip brand stand-ins. */
function applyStoredTableHeaderFill(css: string): string {
  const token = css.match(/--c-th\s*:\s*(#[0-9a-fA-F]{3,8})/i);
  if (!token) return css;
  const hex = token[1] || "";
  if (/^#(?:fff|ffffff)$/i.test(hex) || PLACEHOLDER_HEADER_RE.test(hex)) return css;
  const thBackgrounds = [...css.matchAll(/\bth\s*\{[^}]*background\s*:\s*([^;}]+)/gi)].map(
    (m) => m[1].trim(),
  );
  const hasDarkFill = thBackgrounds.some(
    (v) =>
      /var\(--c-th\)/i.test(v) ||
      (/^#/i.test(v) && !/^#(?:fff|ffffff)$/i.test(v) && !PLACEHOLDER_HEADER_RE.test(v)),
  );
  if (hasDarkFill) return css;
  return `${css}\n.proposal-doc table.grid th,.proposal-doc .bp-table th{background:var(--c-th);color:#fff;}`;
}

/** Hexes used when learning did not measure a table color. Do not paint these. */
const PLACEHOLDER_HEADER_RE = /#(?:0b3d4a|0f2942|1d4ed8|1f3864)\b/i;

function neutralizePlaceholderTableChrome(css: string): string {
  let next = css;
  let paintsPlaceholder = false;
  for (const match of next.matchAll(/\bth\s*\{[^}]*background\s*:\s*(#[0-9a-fA-F]{3,8})/gi)) {
    if (PLACEHOLDER_HEADER_RE.test(match[1] || "")) paintsPlaceholder = true;
  }
  const token = next.match(/--c-th\s*:\s*(#[0-9a-fA-F]{3,8})/i);
  if (token && PLACEHOLDER_HEADER_RE.test(token[1] || "")) paintsPlaceholder = true;
  if (paintsPlaceholder) {
    next += `\n.proposal-blueprint .proposal-doc table.grid th,.proposal-blueprint .proposal-doc .bp-table th{background:transparent !important;background-color:transparent !important;color:inherit !important;}`;
  }
  if (
    paintsPlaceholder &&
    /(?:th|td):last-child\s*\{[^}]*background\s*:\s*#(?:000|000000)\b/i.test(css)
  ) {
    next += `\n.proposal-blueprint .proposal-doc table.grid.emphasize th:last-child,.proposal-blueprint .proposal-doc table.grid.emphasize td:last-child,.proposal-blueprint .proposal-doc .bp-table.emphasize th:last-child,.proposal-blueprint .proposal-doc .bp-table.emphasize td:last-child{background:#000 !important;background-color:#000 !important;color:#fff !important;}`;
  }
  return next;
}
/** Fill tokens and section slots into blueprint HTML; rewrite asset: refs to data URIs. */
function injectPlaybookTable(
  inner: string,
  slotKey: string,
  section: MergeSection,
  allSections: MergeSection[],
): string {
  const fromThead = columnsFromTableHtml(inner);
  const columns = realTableColumns(
    fromThead.length > 0 ? fromThead : defaultColumnsForSectionKey(slotKey),
  );
  if (!columns.length) return inner;
  const rows = tableRowsForSection({
    key: slotKey,
    body: section.body,
    tableRows: section.tableRows,
    tableSpec: section.tableSpec,
    allBodies: allSections.map((s) => String(s.body || "")),
  });
  if (!rows.length) return inner;
  const colCount = columns.length || rows[0]?.cells?.length || 0;
  if (!colCount) return inner;
  const heads = columns
    .map((col) => `<th>${escapeHtml(col)}</th>`)
    .join("");
  const bodyRows = rows
    .map((row) => {
      const cells = Array.isArray(row.cells) ? [...row.cells] : [];
      while (cells.length < colCount) cells.push("");
      return `<tr>${cells
        .slice(0, colCount)
        .map((cell) => `<td>${escapeHtml(String(cell || ""))}</td>`)
        .join("")}</tr>`;
    })
    .join("");
  if (/<table\b/i.test(inner)) {
    if (/<tbody\b[^>]*>\s*<tr/i.test(inner) && /<td\b/i.test(inner)) return inner;
    if (/<tbody\b/i.test(inner)) {
      return inner.replace(
        /(<tbody\b[^>]*>)([\s\S]*?)(<\/tbody>)/i,
        `$1${bodyRows}$3`,
      );
    }
    return inner;
  }
  return `${inner}<table class="bp-table" data-slot-table="${escapeHtml(slotKey)}"><thead><tr>${heads}</tr></thead><tbody>${bodyRows}</tbody></table>`;
}

function isFrozenProposalHtml(html: string): boolean {
  return (
    /proposal-doc/i.test(html) ||
    /cover-block/i.test(html) ||
    /class="[^"]*cover-title/i.test(html)
  );
}

function documentTitleFromBlueprintTokens(
  tokens: Record<string, string>,
): string {
  const explicit = String(tokens.documentTitle || "").trim();
  if (explicit) return explicit;
  if (String(tokens.quoteNumber || "").trim()) return "Quotation";
  return "Commercial Proposal";
}

/** Quotes cloned from proposal templates often keep a baked-in proposal cover title. */
function applyQuoteDocumentCoverTitle(
  html: string,
  tokens: Record<string, string>,
): string {
  const title = documentTitleFromBlueprintTokens(tokens);
  if (!String(tokens.quoteNumber || "").trim() || title === "Commercial Proposal") {
    return html;
  }
  return html.replace(
    /(<h1[^>]*class="[^"]*(?:cover-title|bp-cover-title)[^"]*"[^>]*>)\s*Commercial Proposal\s*(<\/h1>)/gi,
    `$1${escapeHtml(title)}$2`,
  );
}

function tokensWithCoverScope(tokens: Record<string, string>): Record<string, string> {
  const coverTitle = String(tokens.productScope || tokens.dealTitle || "").trim();
  if (!coverTitle) return tokens;
  return { ...tokens, dealTitle: coverTitle, productScope: coverTitle };
}

function fillFrozenProposalCover(
  html: string,
  tokens: Record<string, string>,
): string {
  const replacements: Array<[string, string]> = [
    ["{{vendorName}}", tokens.vendorName || ""],
    ["{{customerName}}", tokens.customerName || tokens.companyName || ""],
    ["{{companyName}}", tokens.companyName || tokens.customerName || ""],
    ["{{date}}", tokens.date || ""],
    ["{{documentTitle}}", documentTitleFromBlueprintTokens(tokens)],
    ["{{dealTitle}}", tokens.dealTitle || ""],
    ["{{productScope}}", tokens.productScope || ""],
  ];
  let next = html;
  for (const [token, value] of replacements) {
    if (!value) continue;
    next = next.split(token).join(escapeHtml(value));
  }
  return next;
}

function ensurePlaybookCover(html: string, tokens: Record<string, string>): string {
  if (isFrozenProposalHtml(html)) {
    return fillFrozenProposalCover(html, tokens);
  }
  const vendor = escapeHtml(tokens.vendorName || "");
  const customer = escapeHtml(tokens.customerName || tokens.companyName || "");
  const date = escapeHtml(tokens.date || "");
  const scope = String(tokens.productScope || "").trim();
  const scopeLooksLikeDeal =
    !scope ||
    (customer &&
      scope.toLowerCase().includes(String(tokens.customerName || "").toLowerCase()));
  const coverInner = [
    vendor ? `<div class="bp-cover-brand">${vendor}</div>` : "",
    `<h1 class="bp-cover-title">${escapeHtml(documentTitleFromBlueprintTokens(tokens))}</h1>`,
    customer
      ? `<div class="bp-cover-prepared">Prepared for <strong>${customer}</strong></div>`
      : "",
    date ? `<div class="bp-cover-date">${date}</div>` : "",
    !scopeLooksLikeDeal ? `<div class="bp-cover-scope">${escapeHtml(scope)}</div>` : "",
  ]
    .filter(Boolean)
    .join("\n");
  if (/<header\b[^>]*bp-playbook-cover/i.test(html)) {
    if (/bp-cover-title/i.test(html)) {
      return html.replace(
        /<div class="bp-cover-scope">([\s\S]*?)<\/div>/i,
        (full) => (scopeLooksLikeDeal ? "" : full),
      );
    }
    return html.replace(
      /<header\b[^>]*class="[^"]*bp-playbook-cover[^"]*"[^>]*>[\s\S]*?<\/header>/i,
      `<header class="bp-playbook-cover bp-cover-left">${coverInner}</header>`,
    );
  }
  return html;
}

export function renderBlueprintHtml(input: {
  blueprint: DocumentBlueprint;
  assets?: BlueprintAsset[];
  sections: MergeSection[];
  tokens: BlueprintMergeTokens;
}): string {
  const keepInBodyChrome = !blueprintUsesExternalChrome(input.blueprint);
  let html = pinChromeToCoverPage(input.blueprint.html, keepInBodyChrome);
  html = repairPageCloneTextOverlap(html);
  // Template CSS first (fonts/alignment), then structural helpers, then page-breaks only.
  let css = `${stabilizeTemplateCss(input.blueprint.css || "")}\n${BODY_BASE_CSS}\n${PRINT_FLOW_OVERRIDE_CSS}`;
  if (/bp-page-clone|pdf-text/i.test(html) && !/\.pdf-text\{[^}]*overflow\s*:\s*hidden/i.test(css)) {
    css = `${css}\n${PAGE_CLONE_TEXT_CSS}`;
  }

  const tokens = tokensWithCoverScope(input.tokens);

  const applyTokensEscaped = (text: string) => {
    let out = text;
    for (const [key, value] of Object.entries(tokens)) {
      const token = key.startsWith("{{") ? key : `{{${key}}}`;
      out = out.split(token).join(escapeHtml(String(value ?? "")));
    }
    return out;
  };
  const applyTokensPlain = (text: string) => {
    let out = text;
    for (const [key, value] of Object.entries(tokens)) {
      const token = key.startsWith("{{") ? key : `{{${key}}}`;
      out = out.split(token).join(String(value ?? ""));
    }
    return out;
  };

  html = applyTokensEscaped(html);

  const byKey = new Map<string, MergeSection>();
  for (const s of input.sections) {
    if (s.key && !isLayoutSlotKey(s.key)) byKey.set(s.key, s);
  }

  const usedKeys = new Set<string>();
  html = html.replace(
    /<section([^>]*?)data-slot="([^"]+)"([^>]*)>([\s\S]*?)<\/section>/gi,
    (_full, pre, slotKey, post, inner) => {
      if (isLayoutSlotKey(slotKey)) return "";
      const resolved = resolveSectionForSlot(byKey, String(slotKey));
      let next = inner as string;
      if (resolved) {
        usedKeys.add(resolved.matchedKey);
        const section = resolved.section;
        const title = applyTokensPlain(section.title || "");
        const body = applyTokensPlain(section.body || "");
        const cleanedTitle = /commercial proposal overview/i.test(title)
          ? "Overview"
          : title;
        const cleanedBody = /cover_overview|^overview$/i.test(String(slotKey))
          ? body
              .replace(/^\s*ZIFO Commercial Proposal\s*/im, "")
              .replace(/^Document Title:.*$/gim, "")
              .replace(/^Prepared For:.*$/gim, "")
              .replace(/^Date:.*$/gim, "")
              .replace(/^Quotation Validity:.*$/gim, "")
              .trim()
          : body;
        next = next.replace(
          /(<[^>]*data-slot-title[^>]*>)([\s\S]*?)(<\/[^>]+>)/i,
          (_m, open: string, _old: string, close: string) =>
            `${open}${formatSectionTitleHtml(cleanedTitle)}${close}`,
        );
        next = injectLearnedSectionBody(
          next,
          formatSectionBodyHtml(cleanedBody, input.blueprint.emphasis),
        );
        next = injectPlaybookTable(next, String(slotKey), section, input.sections);
        return `<section${pre}data-slot="${slotKey}"${post}>${next}</section>`;
      }
      // Drop unmatched / sample-only slots (empty Overview, Tax Summary, etc.).
      if (
        /^(tax|tax_summary|totals|summary|features|scope|commercials|conclusion|overview|body|closing)$/i.test(
          String(slotKey),
        ) ||
        !String(inner || "").replace(/<[^>]+>/g, "").trim()
      ) {
        return "";
      }
      return `<section${pre}data-slot="${slotKey}"${post}>${next}</section>`;
    },
  );

  const leftovers = input.sections.filter((s) => {
    if (!s.key || isLayoutSlotKey(s.key) || usedKeys.has(s.key)) return false;
    // Title-only / empty shells must not reappear after an alias fill.
    return Boolean((s.body || "").trim());
  });
  if (
    leftovers.length > 0 &&
    input.blueprint.mode !== "page-clone" &&
    !/bp-page-clone/i.test(html) &&
    !/proposal-doc/i.test(html)
  ) {
    const extra = leftovers
      .map((s) => {
        const title = applyTokensPlain(s.title || "");
        const body = applyTokensPlain(s.body || "");
        return (
          `<section class="bp-section" data-slot="${escapeHtml(s.key || "section")}">` +
          `<h2 data-slot-title>${formatSectionTitleHtml(title)}</h2>` +
          `<div class="bp-body" data-slot-body>${formatSectionBodyHtml(body, input.blueprint.emphasis)}</div>` +
          `</section>`
        );
      })
      .join("\n");
    if (/<footer\b/i.test(html)) {
      html = html.replace(/<footer\b/i, `${extra}\n<footer`);
    } else {
      html = `${html}\n${extra}`;
    }
  }

  html = applyTokensEscaped(html);
  html = ensurePlaybookCover(html, tokens);
  html = applyQuoteDocumentCoverTitle(html, tokens);
  html = applyCoverAlignClass(html, css);
  html = stripSectionChromeHeader(html);

  const assets = input.assets ?? [];
  for (const asset of assets) {
    const ref = `asset:${asset.id}`;
    const dataUri = `data:${asset.mime};base64,${asset.dataBase64}`;
    html = html.split(ref).join(dataUri);
  }

  return `<div class="proposal-blueprint"><style>${css}</style>${html}</div>`;
}

/** Data URI for a blueprint asset, or null. */
export function blueprintAssetDataUri(
  assets: BlueprintAsset[] | undefined,
  id: string,
): string | null {
  const asset = (assets ?? []).find((a) => a.id === id);
  if (!asset?.dataBase64 || !asset.mime) return null;
  return `data:${asset.mime};base64,${asset.dataBase64}`;
}

/**
 * Playwright PDF header/footer templates — letterhead on every page.
 * Keep templates small: Chromium drops/ignores huge base64 images in
 * headerTemplate/footerTemplate, which left pages with no chrome at all.
 */
export function buildProposalPdfChrome(input: {
  assets?: BlueprintAsset[];
  vendorName: string;
  sellerAddress?: string | null;
}): {
  headerHtml: string;
  footerHtml: string;
  marginTop: string;
  marginBottom: string;
} {
  const vendor = escapeHtml(input.vendorName || "Our company");
  const address = escapeHtml((input.sellerAddress || "").trim());
  const logo = blueprintAssetDataUri(input.assets, "logo");
  // ~18KB decoded — larger data-URIs often fail silently in Chromium headers.
  const logoHtml =
    logo && logo.length <= 24_000
      ? `<img src="${logo}" style="display:block;margin:0 auto 4px;max-height:28px;width:auto;"/>`
      : "";
  const addressHtml = address
    ? `<div style="font-size:7px;color:#222;line-height:1.35;margin-top:2px;padding:0 8px;">${address}</div>`
    : "";

  const headerHtml =
    `<div style="width:100%;box-sizing:border-box;padding:6px 14mm 2px;text-align:center;font-size:10px;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact;">` +
    logoHtml +
    `<div style="font-family:'Times New Roman',Times,serif;font-weight:700;font-size:11px;line-height:1.25;">${vendor}</div>` +
    addressHtml +
    `</div>`;

  // CSS stripe — never embed the large footer asset in the template.
  const footerHtml =
    `<div style="width:100%;box-sizing:border-box;padding:2px 14mm 6px;text-align:center;font-size:8px;color:#333;-webkit-print-color-adjust:exact;print-color-adjust:exact;">` +
    `<div style="height:5px;margin:0 0 4px;background:linear-gradient(90deg,#E7372B 0 20%,#8067A8 20% 40%,#663534 40% 60%,#337FBD 60% 80%,#B4D068 80% 100%);"></div>` +
    `<div style="line-height:1.35;">Prepared by ${vendor}` +
    ` · <span class="pageNumber"></span> / <span class="totalPages"></span></div>` +
    `</div>`;

  return {
    headerHtml,
    footerHtml,
    marginTop: address ? "36mm" : "28mm",
    marginBottom: "18mm",
  };
}

/** Remove in-body letterhead/footer so stamped chrome is not doubled. */
export function stripInBodyPageChrome(html: string): string {
  return (html || "")
    .replace(
      /<header\b[^>]*class="[^"]*\bbp-letterhead\b[^"]*"[^>]*>[\s\S]*?<\/header>/gi,
      "",
    )
    .replace(
      /<header\b[^>]*class="[^"]*\bbp-header\b[^"]*"[^>]*>[\s\S]*?<\/header>/gi,
      "",
    )
    .replace(
      /<footer\b[^>]*class="[^"]*\bbp-footer\b[^"]*"[^>]*>[\s\S]*?<\/footer>/gi,
      "",
    )
    .replace(
      /<div\b[^>]*class="[^"]*\bbp-run-header\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
      "",
    )
    .replace(
      /<div\b[^>]*class="[^"]*\bbp-run-footer\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
      "",
    );
}

export const RUNNING_CHROME_CSS = `
.proposal-blueprint .bp-run-header{text-align:center;margin:0 0 1.1rem;padding-bottom:.55rem;border-bottom:1px solid #e5e7eb}
.proposal-blueprint .bp-run-logo{display:block;margin:0 auto 6px;max-height:36px;width:auto}
.proposal-blueprint .bp-run-company{font-family:'Times New Roman',Times,serif;font-weight:700;font-size:12px;margin:0}
.proposal-blueprint .bp-run-address{font-size:9px;color:#222;margin-top:4px;line-height:1.35}
.proposal-blueprint .bp-run-footer{margin-top:1.5rem;padding-top:.75rem;text-align:center}
.proposal-blueprint .bp-run-stripe{display:block;width:100%;height:8px;object-fit:cover;margin:0 0 8px}
.proposal-blueprint .bp-run-stripe-fallback{height:6px;margin:0 0 8px;background:linear-gradient(90deg,#E7372B 0 20%,#8067A8 20% 40%,#663534 40% 60%,#337FBD 60% 80%,#B4D068 80% 100%)}
.proposal-blueprint .bp-run-meta{font-size:10px;color:#333;line-height:1.4}
`.trim();

/**
 * Screen / print body chrome: letterhead + footer on the cover page and a
 * compact running bar at the start of the content flow (not every section —
 * that forced short sections to look like separate pages).
 */
export function injectDocumentPageChrome(
  html: string,
  input: {
    assets?: BlueprintAsset[];
    vendorName: string;
    sellerAddress?: string | null;
  },
): string {
  const vendor = escapeHtml(input.vendorName || "Our company");
  const address = escapeHtml((input.sellerAddress || "").trim());
  const logo = blueprintAssetDataUri(input.assets, "logo");
  const footerImg = blueprintAssetDataUri(input.assets, "footer");

  const logoHtml = logo
    ? `<img class="bp-run-logo" src="${logo}" alt=""/>`
    : "";
  const addressHtml = address
    ? `<div class="bp-run-address">${address}</div>`
    : "";
  const header =
    `<div class="bp-run-header">` +
    logoHtml +
    `<div class="bp-run-company">${vendor}</div>` +
    addressHtml +
    `</div>`;

  const stripe = footerImg
    ? `<img class="bp-run-stripe" src="${footerImg}" alt=""/>`
    : `<div class="bp-run-stripe-fallback"></div>`;
  const footer =
    `<div class="bp-run-footer">` +
    stripe +
    `<div class="bp-run-meta">Prepared by ${vendor}</div>` +
    `</div>`;

  let next = html;
  // If cover page lost its letterhead, put running header above cover content.
  if (!/bp-letterhead|bp-run-header/i.test(next) && /bp-cover/i.test(next)) {
    next = next.replace(
      /(<div class="bp-cover-page">)/i,
      (_m, open: string) => `${open}${header}`,
    );
  }
  // End-of-document footer if missing.
  if (!/bp-footer|bp-run-footer/i.test(next)) {
    if (/<\/div>\s*$/i.test(next.trim())) {
      next = next.replace(/(<\/div>\s*)$/i, (_m, close: string) => `${footer}${close}`);
    } else {
      next = `${next}${footer}`;
    }
  }

  if (next.includes("</style>")) {
    next = next.replace("</style>", `${RUNNING_CHROME_CSS}</style>`);
  }
  return next;
}

/** @deprecated use injectDocumentPageChrome */
export function injectRunningPageChrome(
  html: string,
  input: {
    assets?: BlueprintAsset[];
    vendorName: string;
    sellerAddress?: string | null;
  },
): string {
  return injectDocumentPageChrome(html, input);
}
