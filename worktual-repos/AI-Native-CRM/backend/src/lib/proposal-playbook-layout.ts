/**
 * Learned visual layout for proposals (from historical PDFs → playbook → draft).
 */

import type { DocumentBlueprint } from "@/lib/document-blueprint";
import {
  formatSectionBodyHtml,
  injectLearnedSectionBody,
} from "@/lib/document-blueprint";
import { canonicalizeSectionKey } from "@/lib/proposal-content-playbook";

export type PlaybookTableStyle = {
  headerBackground?: string;
  headerColor?: string;
  borderColor?: string;
  stripedRows?: boolean;
  cellAlign?: "left" | "center" | "right";
  cellPadding?: string;
  borderCollapse?: string;
  colWidths?: string[];
  firstColIsLabel?: boolean;
  headerRowHeight?: string;
};

/** Cover chrome learned from the uploaded proposal PDF — not a fixed template. */
export type PlaybookCoverSpec = {
  archetype?: "banner" | "centered" | "left" | string;
  slots?: string[];
  title?: string;
  preparedForLabel?: string;
  footer?: string;
  productScopeStyle?: "pills" | "line" | "none";
};

/** Inline emphasis colors/labels learned from the uploaded proposal. */
export type PlaybookEmphasis = {
  requestedColor?: string;
  recommendedColor?: string;
  requestedLabel?: string;
  recommendedLabel?: string;
};

export type PlaybookLayoutStyle = {
  fontFamily?: string;
  headingFontFamily?: string;
  baseFontSizePx?: number;
  headingFontSizePx?: number;
  coverTitleSizePx?: number;
  bodyLineHeight?: number;
  headingLineHeight?: number;
  letterSpacing?: string;
  headingColor?: string;
  accentColor?: string;
  textColor?: string;
  backgroundColor?: string;
  headerBandColor?: string;
  textAlign?: "left" | "center" | "justify";
  headingAlign?: "left" | "center";
  coverStyle?: "banner" | "centered" | "left";
  headingRule?: "none" | "underline";
  margins?: {
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
  };
  tableStyle?: PlaybookTableStyle;
  sectionSpacing?: "compact" | "comfortable" | "airy";
  cover?: PlaybookCoverSpec;
  emphasis?: PlaybookEmphasis;
};

export type PlaybookFeatureTable = {
  key: string;
  columns: string[];
  rowKind?: string;
  rowSlots?: Array<{ id: string; label: string; fillFrom?: string }>;
};

export type PlaybookFeatureSchema = {
  themes?: string[];
  products?: string[];
  constraints?: string[];
  requestedFeatures?: string[];
  tables?: PlaybookFeatureTable[];
};

export type PlaybookTemplateFillSection = {
  key: string;
  title?: string;
  body?: string;
  tableRows?: Array<{ cells: string[] }>;
  tableSpec?: unknown;
};

export function cssLooksComplete(css: string | null | undefined): boolean {
  const s = String(css || "").toLowerCase();
  if (s.length < 200) return false;
  if (!s.includes("font-size")) return false;
  if (!s.includes("padding")) return false;
  if (!s.includes("font-weight")) return false;
  const hasCoverTitle =
    s.includes("bp-cover-title") || s.includes("cover-title");
  const hasH2 =
    s.includes(".bp-h2") ||
    s.includes("h2{") ||
    s.includes("h1.sec-h") ||
    s.includes("sec-h");
  const hasTh =
    s.includes(".bp-table th") ||
    /\bth\{/.test(s) ||
    s.includes("table.grid th");
  return hasCoverTitle && hasH2 && hasTh;
}

export function htmlLooksLikeSkeleton(html: string | null | undefined): boolean {
  const s = String(html || "");
  if (s.length < 40) return false;
  if (/<script/i.test(s)) return false;
  const classic = /bp-playbook-cover/i.test(s) && /data-slot=/.test(s);
  const frozen =
    /proposal-doc/i.test(s) &&
    /cover-title/i.test(s) &&
    /data-slot=/.test(s);
  return classic || frozen;
}

export type PlaybookSkeletonCheck = { ok: boolean; reasons: string[] };

const OPTIONAL_FILL_TOKENS = new Set([
  "productScope",
  "dealTitle",
  "companyName",
  "documentTitle",
]);

export function tableSpecKeysFromPlaybook(input: {
  sections?: unknown;
  featureSchema?: unknown;
}): string[] {
  const keys = new Set<string>();
  const schema = parseFeatureSchema(input.featureSchema);
  for (const table of schema.tables || []) {
    if (table.key && table.columns.length) keys.add(table.key);
  }
  if (Array.isArray(input.sections)) {
    for (const item of input.sections) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const row = item as Record<string, unknown>;
      const key = String(row.key || "").trim();
      if (!key) continue;
      if (columnsFromSection(row).length) keys.add(key);
    }
  }
  return [...keys];
}

export function assertPlaybookSkeleton(input: {
  html?: string | null;
  css?: string | null;
  sectionOrder?: string[];
  tableSpecKeys?: string[];
}): PlaybookSkeletonCheck {
  const reasons: string[] = [];
  const html = String(input.html || "");
  const css = String(input.css || "");
  if (!htmlLooksLikeSkeleton(html)) {
    reasons.push(
      "Playbook HTML is not a real empty skeleton (need bp-playbook-cover and data-slot).",
    );
  }
  if (/<script/i.test(html)) {
    reasons.push("Playbook HTML contains script tags.");
  }
  if (!cssLooksComplete(css)) {
    reasons.push(
      "Playbook CSS is incomplete (need cover title size, heading weight, table header chrome).",
    );
  }
  for (const key of input.sectionOrder || []) {
    const k = String(key || "").trim();
    if (!k || k.toLowerCase() === "cover") continue;
    if (!new RegExp(`data-slot="${k}"`, "i").test(html)) {
      reasons.push(`Missing data-slot for section "${k}".`);
    }
  }
  for (const key of input.tableSpecKeys || []) {
    const k = String(key || "").trim();
    if (!k) continue;
    if (!new RegExp(`data-slot-table="${k}"`, "i").test(html)) {
      reasons.push(`Missing table shell for "${k}".`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

export function validateGeneratedProposalHtml(input: {
  html?: string | null;
  sectionOrder?: string[];
  tableSpecKeys?: string[];
  playbookId?: string | null;
}): PlaybookSkeletonCheck {
  const reasons: string[] = [];
  const html = String(input.html || "");
  const leftover = [...html.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)].map(
    (m) => m[1],
  );
  const required = leftover.filter((token) => !OPTIONAL_FILL_TOKENS.has(token));
  if (required.length) {
    reasons.push(`Unfilled tokens: ${[...new Set(required)].join(", ")}`);
  }
  for (const key of input.tableSpecKeys || []) {
    const k = String(key || "").trim();
    if (!k) continue;
    const tableMatch = html.match(
      new RegExp(
        `<table[^>]*data-slot-table="${k}"[^>]*>([\\s\\S]*?)</table>`,
        "i",
      ),
    );
    if (!tableMatch) {
      reasons.push(`Filled HTML missing table "${k}".`);
      continue;
    }
    const tbody = tableMatch[1].match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
    const rows = tbody ? tbody[1].match(/<tr\b/gi) || [] : [];
    if (!rows.length) {
      reasons.push(`Table "${k}" has no body rows.`);
    }
  }
  if (!String(input.playbookId || "").trim()) {
    reasons.push("playbookId is not pinned on the proposal blueprint.");
  }
  const order = (input.sectionOrder || []).filter(
    (key) => String(key || "").trim() && String(key).toLowerCase() !== "cover",
  );
  const slotKeys: string[] = [];
  const slotRe = /data-slot="([^"]+)"/gi;
  let match: RegExpExecArray | null;
  while ((match = slotRe.exec(html))) {
    slotKeys.push(match[1]);
  }
  let idx = 0;
  for (const key of order) {
    const found = slotKeys.indexOf(key, idx);
    if (found < 0) {
      reasons.push(`Section order missing "${key}".`);
    } else {
      idx = found + 1;
    }
  }
  return { ok: reasons.length === 0, reasons };
}

export function playbookVisualTemplateReady(raw: unknown): boolean {
  if (!isPlaybookTemplateBlueprint(raw)) return false;
  const o = raw as Record<string, unknown>;
  return (
    htmlLooksLikeSkeleton(String(o.html || "")) &&
    cssLooksComplete(String(o.css || ""))
  );
}

const DEFAULT_LAYOUT: Required<
  Omit<PlaybookLayoutStyle, "margins" | "tableStyle" | "cover" | "emphasis">
> & {
  margins: Required<NonNullable<PlaybookLayoutStyle["margins"]>>;
  tableStyle: Required<PlaybookTableStyle>;
} = {
  fontFamily: "Calibri, Arial, Helvetica, sans-serif",
  headingFontFamily: "Calibri, Arial, Helvetica, sans-serif",
  baseFontSizePx: 11,
  headingColor: "#1a1a1a",
  accentColor: "#1a1a1a",
  textColor: "#1a1a1a",
  backgroundColor: "#ffffff",
  headerBandColor: "transparent",
  textAlign: "left",
  headingAlign: "left",
  coverStyle: "banner",
  headingRule: "underline",
  sectionSpacing: "comfortable",
  margins: {
    top: "18mm",
    right: "16mm",
    bottom: "18mm",
    left: "16mm",
  },
  tableStyle: {
    headerBackground: "transparent",
    headerColor: "#1a1a1a",
    borderColor: "#cbd5e1",
    stripedRows: true,
    cellAlign: "left",
  },
};

function asColor(value: unknown, fallback: string): string {
  const s = String(value || "").trim();
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s)) return s;
  return fallback;
}

function asAlign(
  value: unknown,
  allowed: readonly string[],
  fallback: string,
): string {
  const s = String(value || "")
    .trim()
    .toLowerCase();
  return allowed.includes(s) ? s : fallback;
}

export function parsePlaybookLayoutStyle(raw: unknown): PlaybookLayoutStyle {
  const o =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const margins =
    o.margins && typeof o.margins === "object" && !Array.isArray(o.margins)
      ? (o.margins as Record<string, unknown>)
      : {};
  const table =
    o.tableStyle && typeof o.tableStyle === "object" && !Array.isArray(o.tableStyle)
      ? (o.tableStyle as Record<string, unknown>)
      : {};
  const fontPx = Number(o.baseFontSizePx);
  const headingPx = Number(o.headingFontSizePx);
  const coverTitlePx = Number(o.coverTitleSizePx);
  const bodyLh = Number(o.bodyLineHeight);
  const headingLh = Number(o.headingLineHeight);
  const colWidths = asStringList(table.colWidths);
  return {
    fontFamily:
      typeof o.fontFamily === "string" && o.fontFamily.trim()
        ? o.fontFamily.trim()
        : DEFAULT_LAYOUT.fontFamily,
    headingFontFamily:
      typeof o.headingFontFamily === "string" && o.headingFontFamily.trim()
        ? o.headingFontFamily.trim()
        : DEFAULT_LAYOUT.headingFontFamily,
    baseFontSizePx:
      Number.isFinite(fontPx) && fontPx >= 9 && fontPx <= 16
        ? Math.round(fontPx)
        : DEFAULT_LAYOUT.baseFontSizePx,
    headingFontSizePx:
      Number.isFinite(headingPx) && headingPx >= 10 && headingPx <= 28
        ? Math.round(headingPx)
        : undefined,
    coverTitleSizePx:
      Number.isFinite(coverTitlePx) && coverTitlePx >= 12 && coverTitlePx <= 36
        ? Math.round(coverTitlePx)
        : undefined,
    bodyLineHeight:
      Number.isFinite(bodyLh) && bodyLh >= 1 && bodyLh <= 2.2 ? bodyLh : undefined,
    headingLineHeight:
      Number.isFinite(headingLh) && headingLh >= 1 && headingLh <= 2
        ? headingLh
        : undefined,
    letterSpacing:
      typeof o.letterSpacing === "string" && o.letterSpacing.trim()
        ? o.letterSpacing.trim()
        : undefined,
    headingColor: asColor(o.headingColor, DEFAULT_LAYOUT.headingColor),
    accentColor: asColor(o.accentColor, DEFAULT_LAYOUT.accentColor),
    textColor: asColor(o.textColor, DEFAULT_LAYOUT.textColor),
    backgroundColor: asColor(o.backgroundColor, DEFAULT_LAYOUT.backgroundColor),
    headerBandColor: asColor(o.headerBandColor, DEFAULT_LAYOUT.headerBandColor),
    textAlign: asAlign(o.textAlign, ["left", "center", "justify"], "left") as
      | "left"
      | "center"
      | "justify",
    headingAlign: asAlign(o.headingAlign, ["left", "center"], "left") as
      | "left"
      | "center",
    coverStyle: asAlign(o.coverStyle, ["banner", "centered", "left"], "banner") as
      | "banner"
      | "centered"
      | "left",
    headingRule: asAlign(
      o.headingRule,
      ["none", "underline"],
      "underline",
    ) as "none" | "underline",
    sectionSpacing: asAlign(
      o.sectionSpacing,
      ["compact", "comfortable", "airy"],
      "comfortable",
    ) as "compact" | "comfortable" | "airy",
    margins: {
      top: String(margins.top || DEFAULT_LAYOUT.margins.top),
      right: String(margins.right || DEFAULT_LAYOUT.margins.right),
      bottom: String(margins.bottom || DEFAULT_LAYOUT.margins.bottom),
      left: String(margins.left || DEFAULT_LAYOUT.margins.left),
    },
    tableStyle: {
      headerBackground: asColor(
        table.headerBackground,
        DEFAULT_LAYOUT.tableStyle.headerBackground,
      ),
      headerColor: asColor(
        table.headerColor,
        DEFAULT_LAYOUT.tableStyle.headerColor,
      ),
      borderColor: asColor(
        table.borderColor,
        DEFAULT_LAYOUT.tableStyle.borderColor,
      ),
      stripedRows: table.stripedRows !== false,
      cellAlign: asAlign(
        table.cellAlign,
        ["left", "center", "right"],
        "left",
      ) as "left" | "center" | "right",
      ...(typeof table.cellPadding === "string" && table.cellPadding.trim()
        ? { cellPadding: table.cellPadding.trim() }
        : {}),
      ...(typeof table.borderCollapse === "string" && table.borderCollapse.trim()
        ? { borderCollapse: table.borderCollapse.trim() }
        : {}),
      ...(colWidths.length ? { colWidths } : {}),
      ...(typeof table.firstColIsLabel === "boolean"
        ? { firstColIsLabel: table.firstColIsLabel }
        : {}),
      ...(typeof table.headerRowHeight === "string" &&
      table.headerRowHeight.trim()
        ? { headerRowHeight: table.headerRowHeight.trim() }
        : {}),
    },
    cover: parseCoverSpec(o.cover, asAlign(o.coverStyle, ["banner", "centered", "left"], "banner")),
    emphasis: parseEmphasis(o.emphasis),
  };
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function parseCoverSpec(raw: unknown, coverStyle: string): PlaybookCoverSpec {
  const o =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const slots = asStringList(o.slots);
  const title = String(o.title || "").trim();
  const preparedForLabel = String(o.preparedForLabel || "").trim();
  const footer = String(o.footer || "").trim();
  const scopeStyle = asAlign(
    o.productScopeStyle,
    ["pills", "line", "none"],
    "",
  );
  return {
    archetype: String(o.archetype || coverStyle || "").trim() || coverStyle,
    ...(slots.length ? { slots } : {}),
    title: title || "Commercial Proposal",
    preparedForLabel: preparedForLabel || "Prepared for",
    ...(footer ? { footer } : {}),
    ...(scopeStyle
      ? {
          productScopeStyle: scopeStyle as "pills" | "line" | "none",
        }
      : {}),
  };
}

function parseEmphasis(raw: unknown): PlaybookEmphasis | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const requestedLabel = String(o.requestedLabel || "").trim();
  const recommendedLabel = String(o.recommendedLabel || "").trim();
  const requestedColor = asColor(o.requestedColor, "");
  const recommendedColor = asColor(o.recommendedColor, "");
  if (
    !requestedLabel &&
    !recommendedLabel &&
    !requestedColor &&
    !recommendedColor
  ) {
    return undefined;
  }
  return {
    ...(requestedLabel ? { requestedLabel } : {}),
    ...(recommendedLabel ? { recommendedLabel } : {}),
    ...(requestedColor ? { requestedColor } : {}),
    ...(recommendedColor ? { recommendedColor } : {}),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const SECTION_CHROME_RE = /^\d+(\.\d+)*[.)]?\s+\S/;
const BOILERPLATE_CHROME_RE =
  /\b(confidential|proprietary|copyright|page\s*\d+|internal use)\b|proposal\s*\|/i;
const SENTENCE_CHROME_RE =
  /^(this|that|the|our|an?)\s+\S|[.!?…]\s*$|\benables\b|\bintegrated approach\b|\bconnect customer\b/i;

export function isUsableRunningChrome(text: string): boolean {
  const raw = String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw || raw.length > 56) return false;
  if (raw.split(/\s+/).length > 8) return false;
  if (SECTION_CHROME_RE.test(raw)) return false;
  if (SENTENCE_CHROME_RE.test(raw) && !BOILERPLATE_CHROME_RE.test(raw)) return false;
  return true;
}

/** Drop gold body copy / section titles mis-learned as a running header. */
export function stripSectionChromeHeader(
  html: string,
  sectionTitles: string[] = [],
  otherCustomerNames: string[] = [],
): string {
  const titles = new Set(
    sectionTitles.map((t) => t.trim().toLowerCase()).filter(Boolean),
  );
  const others = otherCustomerNames
    .map((n) => n.trim().toLowerCase())
    .filter((n) => n.length >= 4);
  return html.replace(
    /<div class="chrome-header">([\s\S]*?)<\/div>/gi,
    (full, inner: string) => {
      const text = String(inner)
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!text) return "";
      if (!isUsableRunningChrome(text)) return "";
      if (titles.has(text.toLowerCase())) return "";
      const lower = text.toLowerCase();
      if (others.some((name) => lower.includes(name))) return "";
      return full;
    },
  );
}

const COVER_SLOT_IDS = new Set([
  "vendorname",
  "vendorlogo",
  "documenttitle",
  "title",
  "preparedfor",
  "customername",
  "date",
  "productscope",
]);

function normalizeSlotId(slot: string): string {
  return slot.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function coverSlotsFor(layout: PlaybookLayoutStyle): string[] {
  const learned = layout.cover?.slots?.map(normalizeSlotId).filter(Boolean) ?? [];
  if (learned.length) return learned;
  if (layout.coverStyle === "centered") {
    return ["vendorname", "documenttitle", "preparedfor", "date", "productscope"];
  }
  if (layout.coverStyle === "left") {
    return ["vendorname", "documenttitle", "customername", "date", "productscope"];
  }
  return ["vendorname", "documenttitle", "customername", "date"];
}

function renderCoverSlot(
  slot: string,
  layout: PlaybookLayoutStyle,
): string | null {
  const title = layout.cover?.title?.trim() || "";
  const prepared = layout.cover?.preparedForLabel?.trim() || "";
  switch (slot) {
    case "vendorname":
    case "vendorlogo":
      return `<div class="bp-cover-brand">{{vendorName}}</div>`;
    case "documenttitle":
    case "title":
      if (!title) return null;
      return `<h1 class="bp-cover-title">${escapeHtml(title)}</h1>`;
    case "preparedfor":
      return prepared
        ? `<div class="bp-cover-prepared">${escapeHtml(prepared)} <strong>{{customerName}}</strong></div>`
        : `<div class="bp-cover-meta"><strong>{{customerName}}</strong></div>`;
    case "customername":
      return `<div class="bp-cover-meta"><strong>{{customerName}}</strong></div>`;
    case "date":
      return `<div class="bp-cover-date">{{date}}</div>`;
    case "productscope":
      if (layout.cover?.productScopeStyle === "none") return null;
      return `<div class="bp-cover-scope">{{productScope}}</div>`;
    default:
      return null;
  }
}

function buildCoverHtml(layout: PlaybookLayoutStyle): string {
  const alignClass =
    layout.coverStyle === "centered"
      ? "bp-cover-centered"
      : layout.coverStyle === "left"
        ? "bp-cover-left"
        : "bp-cover-banner";
  const inner = coverSlotsFor(layout)
    .filter((id) => COVER_SLOT_IDS.has(id))
    .map((id) => renderCoverSlot(slotIdFromNormalized(id), layout))
    .filter((html): html is string => Boolean(html))
    .join("\n");
  if (layout.coverStyle === "banner") {
    return `<header class="bp-playbook-cover ${alignClass}"><div class="bp-cover-band">${inner}</div></header>`;
  }
  return `<header class="bp-playbook-cover ${alignClass}">${inner}</header>`;
}

function slotIdFromNormalized(id: string): string {
  if (id === "vendorlogo") return "vendorlogo";
  if (id === "documenttitle" || id === "title") return "documenttitle";
  if (id === "preparedfor") return "preparedfor";
  if (id === "customername") return "customername";
  if (id === "productscope") return "productscope";
  if (id === "date") return "date";
  return "vendorname";
}

export function mergePlaybookLayoutStyles(
  styles: unknown[],
): PlaybookLayoutStyle {
  const parsed = styles.map(parsePlaybookLayoutStyle);
  if (parsed.length === 0) return parsePlaybookLayoutStyle(null);
  // Prefer the densest / most complete later proposal signal.
  return parsePlaybookLayoutStyle(parsed[parsed.length - 1]);
}

type SectionSlot = { key: string; title: string; tableSpec?: unknown };

export function parseFeatureSchema(raw: unknown): PlaybookFeatureSchema {
  const o =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const tables: PlaybookFeatureTable[] = [];
  if (Array.isArray(o.tables)) {
    for (const item of o.tables) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const row = item as Record<string, unknown>;
      const key = String(row.key || "").trim();
      const columns = asStringList(row.columns);
      if (!key && !columns.length) continue;
      const rowSlots = Array.isArray(row.rowSlots)
        ? row.rowSlots
            .filter(
              (slot): slot is Record<string, unknown> =>
                !!slot && typeof slot === "object" && !Array.isArray(slot),
            )
            .map((slot) => ({
              id: String(slot.id || "").trim(),
              label: String(slot.label || slot.id || "").trim(),
              fillFrom: String(slot.fillFrom || "requirement").trim(),
            }))
            .filter((slot) => slot.id || slot.label)
        : [];
      tables.push({
        key: key || "table",
        columns,
        rowKind: String(row.rowKind || "").trim() || undefined,
        ...(rowSlots.length ? { rowSlots } : {}),
      });
    }
  }
  return {
    themes: asStringList(o.themes),
    products: asStringList(o.products),
    constraints: asStringList(o.constraints),
    requestedFeatures: asStringList(o.requestedFeatures),
    tables,
  };
}

function emptyTableHtml(key: string, columns: string[]): string {
  if (!columns.length) return "";
  const heads = columns
    .map((col) => `<th>${escapeHtml(col)}</th>`)
    .join("");
  return `<table class="bp-table" data-slot-table="${escapeHtml(key)}"><thead><tr>${heads}</tr></thead><tbody></tbody></table>`;
}

const FEATURE_TABLE_ALIASES: Record<string, string[]> = {
  commercials: [
    "monthly_recurring_charges",
    "one_time_charges",
    "marketing_campaign_usage",
    "pricing",
    "pricing_monthly",
    "pricing_one_time",
  ],
  comparison: [
    "what_we_compare",
    "why_ai_native_wins",
    "whats_added",
    "requested_solution",
  ],
  scope: ["what_we_compare", "requested_solution"],
  features: ["whats_added", "why_ai_native_wins"],
};

export function defaultColumnsForSectionKey(key: string): string[] {
  const k = String(key || "").toLowerCase();
  if (/monthly|mrc|recurring/.test(k)) {
    return ["Charges", "Requested Solution", "Recommended Solution"];
  }
  if (/one_time|otc|one-time/.test(k)) {
    return ["Charges / Solutions", "Requested Solution", "Recommended Solution"];
  }
  if (/usage|campaign/.test(k)) {
    return ["Channel", "Included Free", "Beyond Free Limit"];
  }
  if (/compare|wins|whats_added|comparison|commercial/.test(k)) {
    return ["Dimension", "Requested Solution", "Recommended Solution"];
  }
  return [];
}

function tableShapeWantsTable(spec: Record<string, unknown>): boolean {
  const shape = String(spec.shape || "").trim().toLowerCase();
  if (!shape || shape === "none") return false;
  return true;
}

export function tableRowsFromBody(
  body: string,
  colCount: number,
): Array<{ cells: string[] }> {
  const count = Math.max(1, colCount);
  const lines = String(body || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const pipeLines = lines.filter(
    (line) => line.includes("|") && !/^[\s|:-]+$/.test(line),
  );
  if (pipeLines.length >= 2) {
    const parsed = pipeLines.map((line) => {
      const cells = line
        .split("|")
        .map((cell) => cell.trim())
        .filter((cell, i, all) => !(i === 0 && !cell) && !(i === all.length - 1 && !cell));
      while (cells.length < count) cells.push("");
      return { cells: cells.slice(0, Math.max(count, cells.length)) };
    });
    return parsed.slice(1);
  }
  const bullets = lines.filter(
    (line) => /^[-*•]\s+/.test(line) || /^\d+[.)]\s+/.test(line),
  );
  if (!bullets.length) return [];
  const delimiter = /\s+[—–]\s+|:\s+/;
  const splitable = bullets.filter((line) =>
    delimiter.test(
      line.replace(/^[-*•]\s+/, "").replace(/^\d+[.)]\s+/, ""),
    ),
  );
  // Prose bullets are section copy, not a comparison table. Only split when
  // the line actually has a label/value delimiter.
  if (count >= 3 && splitable.length < bullets.length) {
    return [];
  }
  return bullets.map((line) => {
    const text = line
      .replace(/^[-*•]\s+/, "")
      .replace(/^\d+[.)]\s+/, "")
      .trim();
    const parts = text.split(delimiter);
    const cells =
      count >= 3
        ? [parts[0] || text, parts.slice(1).join(": ") || ""]
        : [text];
    while (cells.length < count) cells.push("");
    return { cells: cells.slice(0, count) };
  });
}

function padCells(cells: string[], count: number): string[] {
  const next = [...cells];
  while (next.length < count) next.push("");
  return next.slice(0, count);
}

function corpusHas(text: string, re: RegExp): boolean {
  re.lastIndex = 0;
  return re.test(text);
}

export function columnsFromTableHtml(html: string): string[] {
  const thead = String(html || "").match(/<thead[\s\S]*?<\/thead>/i)?.[0] || "";
  return [...thead.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)]
    .map((m) => m[1].replace(/<[^>]+>/g, "").trim())
    .filter(Boolean);
}

function cellForTableColumn(
  col: string,
  index: number,
  label: string,
  requested: string,
  recommended: string,
): string {
  if (index === 0) return label;
  const c = String(col || "").toLowerCase();
  if (/price|amount|rate|cost|mrc|fee|₹|rs\.?|usd|inr/.test(c)) return "";
  if (/request/.test(c)) return requested;
  if (/recommend/.test(c)) return recommended;
  if (/qty|quantity|seat|unit/.test(c)) {
    const n = requested.match(/\d+/);
    return n ? n[0] : "";
  }
  if (/note|remark|comment|assumption/.test(c)) return "";
  return recommended || requested || "";
}

/** BRD/catalog facts for any learned tableSpec — not a per-section-key list. */
function synthesizeTableRowsFromSpec(input: {
  columns: string[];
  corpus: string;
  requirementText?: string;
  allowedProducts?: string[];
}): Array<{ cells: string[] }> {
  const columns = input.columns.map((c) => String(c || "").trim()).filter(Boolean);
  if (!columns.length) return [];
  const count = columns.length;
  const corpus = String(input.corpus || "");
  const hay = `${input.requirementText || ""}\n${corpus}`;
  const seats = hay.match(
    /(\d+)\s+(?:sales\s+)?(?:representatives?|users?|seats?)/i,
  );
  const contacts = hay.match(/(\d+)\s+active contact/i);
  const crm = corpusHas(hay, /\bcrm\b/i) || Boolean(seats);
  const tally = corpusHas(hay, /\btally\b/i);
  const pipeline = corpusHas(hay, /pipeline/i);
  const followUp = corpusHas(hay, /follow-?up|activity/i);
  const requestedStandalone = corpusHas(
    hay,
    /standalone crm|requested(?: solution)?[:\s].{0,40}crm/i,
  );
  const crmRequested = seats
    ? `${seats[1]} users — ${requestedStandalone ? "standalone CRM" : "as requested"}`
    : "Standalone CRM as requested";
  const tallyRequested = corpusHas(hay, /two-way/i)
    ? "Two-way Tally integration"
    : "Tally integration as requested";

  type Fact = { label: string; requested: string; recommended: string };
  const facts: Fact[] = [];
  if (crm) {
    facts.push({
      label: "Intelligent CRM",
      requested: crmRequested,
      recommended: "Unified customer profiles (recommended)",
    });
  }
  if (tally) {
    facts.push({
      label: "Tally integration",
      requested: tallyRequested,
      recommended: "Automated two-way Tally synchronization",
    });
  }
  if (pipeline) {
    facts.push({
      label: "Sales pipeline",
      requested: "Lead to closure tracking",
      recommended: "End-to-end pipeline with unified profiles",
    });
  }
  if (followUp) {
    facts.push({
      label: "Activity & follow-up",
      requested: "Structured sales representative activity",
      recommended: "Activity plus unified customer intelligence",
    });
  }
  if (contacts) {
    facts.push({
      label: `${contacts[1]} active contacts in CRM`,
      requested: `${contacts[1]} active contacts in CRM`,
      recommended: "Unified profiles across sales and finance",
    });
  }
  if (corpusHas(hay, /\bgst\b/i)) {
    facts.push({
      label: "GST",
      requested: "As applicable",
      recommended: "As applicable",
    });
  }
  if (corpusHas(hay, /campaign|usage/i)) {
    facts.push({
      label: "Marketing campaigns",
      requested: "As requested in this BRD",
      recommended: "Optional with the recommended platform",
    });
  }

  const seen = new Set<string>();
  const rows: string[][] = [];
  const push = (label: string, requested: string, recommended: string) => {
    const key = label.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    rows.push(
      columns.map((col, i) =>
        cellForTableColumn(col, i, label, requested, recommended),
      ),
    );
  };
  for (const name of input.allowedProducts ?? []) {
    const label = String(name || "").trim();
    if (!label) continue;
    push(
      label,
      "As requested for this engagement",
      "Included on the recommended platform",
    );
  }
  for (const fact of facts) {
    push(fact.label, fact.requested, fact.recommended);
  }
  return rows.map((cells) => ({ cells: padCells(cells, count) }));
}

/** Fill learned table shells from LLM rows, body bullets, or BRD facts already in copy. */
export function tableRowsForSection(input: {
  key: string;
  body?: string;
  tableRows?: Array<{ cells: string[] }>;
  tableSpec?: unknown;
  allBodies?: string[];
  requirementText?: string;
  allowedProducts?: string[];
  otherCustomerNames?: string[];
}): Array<{ cells: string[] }> {
  const columns = tableColumnsFromFill(
    {
      key: input.key,
      body: input.body,
      tableRows: input.tableRows,
      tableSpec: input.tableSpec,
    },
    input.key,
  );
  const colCount = columns.length;
  const filterCtx = {
    requirementText: input.requirementText,
    allowedProducts: input.allowedProducts,
    otherCustomerNames: input.otherCustomerNames,
  };
  const existing = Array.isArray(input.tableRows) ? input.tableRows : [];
  const kept = filterRowsToRequirement(existing, filterCtx);
  if (!colCount) return kept;
  return kept.map((row) => {
    const cells = (row.cells || []).map((cell) => String(cell ?? ""));
    while (cells.length < colCount) cells.push("");
    return { cells: cells.slice(0, colCount) };
  });
}

function cellOrEmpty(c: unknown): string {
  return String(c ?? "");
}

const PLAYBOOK_ONLY_ROW = [
  /voice\s*bot/i,
  /chatbot/i,
  /\bcdp\b/i,
  /customer data platform/i,
  /\bcvm\b/i,
  /customer value management/i,
  /ticketing/i,
  /whatsapp/i,
  /web push/i,
  /app push/i,
  /live agents?/i,
  /website visitor/i,
  /web tracking/i,
  /campaign management/i,
];

export type TableRowLeakContext = {
  requirementText?: string;
  allowedProducts?: string[];
  otherCustomerNames?: string[];
};

function leakHaystack(ctx?: TableRowLeakContext): string {
  return [ctx?.requirementText || "", ...(ctx?.allowedProducts ?? [])]
    .join("\n")
    .toLowerCase();
}

function capabilityInThisDeal(matched: string, hay: string): boolean {
  const needle = matched.toLowerCase().trim();
  if (!needle) return false;
  if (hay.includes(needle)) return true;
  const compactHay = hay.replace(/\s+/g, "");
  const compactNeedle = needle.replace(/\s+/g, "");
  if (compactNeedle.length >= 6 && compactHay.includes(compactNeedle)) return true;
  const tokens = needle.split(/\s+/).filter((t) => t.length >= 5);
  return tokens.some((t) => hay.includes(t));
}

/**
 * Drop rows that name another customer or another deal's product.
 * Capability words that also appear in this BRD or allowedProducts stay.
 */
export function filterRowsToRequirement(
  rows: Array<{ cells: string[] }>,
  ctx?: TableRowLeakContext,
): Array<{ cells: string[] }> {
  const hay = leakHaystack(ctx);
  const others = (ctx?.otherCustomerNames ?? [])
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name.length >= 4);
  return rows.filter((row) => {
    const label = String(row.cells?.[0] || "");
    const blob = (row.cells || [])
      .map((c) => String(c || ""))
      .join(" ")
      .toLowerCase();
    if (others.some((name) => blob.includes(name) && !hay.includes(name))) {
      return false;
    }
    const leak = PLAYBOOK_ONLY_ROW.find((re) => {
      re.lastIndex = 0;
      return re.test(label);
    });
    if (leak) {
      leak.lastIndex = 0;
      const matched = label.match(leak)?.[0] || "";
      if (!capabilityInThisDeal(matched, hay)) return false;
    }
    return (row.cells || []).some((cell) => String(cell || "").trim());
  });
}

function matchFeatureTable(
  key: string,
  featureSchema?: PlaybookFeatureSchema | null,
): PlaybookFeatureTable | undefined {
  const tables = featureSchema?.tables ?? [];
  const exact =
    tables.find((t) => t.key === key) ||
    tables.find((t) => t.key.replace(/_/g, "") === key.replace(/_/g, ""));
  if (exact) return exact;
  for (const [schemaKey, aliases] of Object.entries(FEATURE_TABLE_ALIASES)) {
    if (aliases.includes(key) || schemaKey === key) {
      const found = tables.find((t) => t.key === schemaKey);
      if (found) return { ...found, key };
    }
  }
  return undefined;
}

/** tableSpec.comparisonKind for a section, if the deep-read agent set one. */
function sectionComparisonKind(section: unknown): string | undefined {
  if (!section || typeof section !== "object" || Array.isArray(section)) {
    return undefined;
  }
  const row = section as Record<string, unknown>;
  const spec =
    row.tableSpec && typeof row.tableSpec === "object" && !Array.isArray(row.tableSpec)
      ? (row.tableSpec as Record<string, unknown>)
      : {};
  return typeof spec.comparisonKind === "string" ? spec.comparisonKind : undefined;
}

function tableHtmlForSlot(
  key: string,
  featureSchema?: PlaybookFeatureSchema | null,
  extraColumns?: string[],
  suppressDefaultColumns?: boolean,
): string {
  const match = matchFeatureTable(key, featureSchema);
  const columns =
    (extraColumns?.length ? extraColumns : undefined) ||
    (match?.columns?.length ? match.columns : undefined) ||
    (suppressDefaultColumns ? [] : defaultColumnsForSectionKey(key));
  return emptyTableHtml(key, columns);
}

function uniqueBodySlots(sections: SectionSlot[]): Array<{ key: string; label: string }> {
  const slots = sections
    .filter((s) => {
      const key = s.key?.trim().toLowerCase();
      if (!key) return false;
      if (key === "cover") return false;
      return true;
    })
    .map((s) => ({
      key: s.key.trim(),
      label: s.title?.trim() || s.key.trim(),
    }));
  const seen = new Set<string>();
  return slots.filter((s) => {
    if (seen.has(s.key)) return false;
    seen.add(s.key);
    return true;
  });
}

function columnsFromSection(section: unknown): string[] {
  if (!section || typeof section !== "object" || Array.isArray(section)) {
    return [];
  }
  const row = section as Record<string, unknown>;
  const spec =
    row.tableSpec && typeof row.tableSpec === "object" && !Array.isArray(row.tableSpec)
      ? (row.tableSpec as Record<string, unknown>)
      : {};
  const fromSpec = asStringList(spec.columns);
  if (fromSpec.length) return fromSpec;
  // A section the deep-read agent grounded as narrative (no real spec_rows
  // table in the gold instance) must not still get forced into the generic
  // Dimension/Requested/Recommended grid just because its key name matches a
  // comparison-ish pattern — that's how comparison_wins and what_we_compare
  // used to converge on identical content.
  if (spec.comparisonKind === "narrative") return [];
  if (tableShapeWantsTable(spec)) {
    return defaultColumnsForSectionKey(String(row.key || ""));
  }
  return [];
}

/**
 * Build a slot-based document blueprint using learned visual style
 * (colors, fonts, alignment, table look) — not a page-clone of one PDF.
 */
export function buildPlaybookDocumentBlueprint(input: {
  layoutStyle?: unknown;
  sections: SectionSlot[];
  featureSchema?: unknown;
  css?: string | null;
}): DocumentBlueprint {
  const layout = parsePlaybookLayoutStyle(input.layoutStyle);
  const featureSchema = parseFeatureSchema(input.featureSchema);
  const spacing =
    layout.sectionSpacing === "compact"
      ? "0.85rem"
      : layout.sectionSpacing === "airy"
        ? "1.75rem"
        : "1.25rem";
  const m = layout.margins!;
  const t = layout.tableStyle!;
  const requestedColor =
    layout.emphasis?.requestedColor || layout.accentColor || layout.headingColor;
  const recommendedColor =
    layout.emphasis?.recommendedColor || layout.headingColor;

  const cover = buildCoverHtml(layout);
  const footerRaw = layout.cover?.footer?.trim() || "";
  const footerHtml = footerRaw
    ? `<footer class="bp-footer">${footerRaw
        .split("{{vendorName}}")
        .map(escapeHtml)
        .join("{{vendorName}}")}</footer>`
    : "";

  const uniqueSlots = uniqueBodySlots(input.sections);
  const sectionByKey = new Map(
    input.sections.map((s) => [s.key.trim(), s as unknown]),
  );

  const sectionHtml = uniqueSlots
    .map((s) => {
      const table = tableHtmlForSlot(
        s.key,
        featureSchema,
        columnsFromSection(sectionByKey.get(s.key)),
        sectionComparisonKind(sectionByKey.get(s.key)) === "narrative",
      );
      return `
<section class="bp-section" data-slot="${s.key}">
  <h2 class="bp-h2" data-slot-title>${escapeHtml(s.label)}</h2>
  <div class="bp-body" data-slot-body></div>
  ${table}
</section>`.trim();
    })
    .join("\n");

  const headingRule =
    layout.headingRule === "none"
      ? "border-bottom:0;padding-bottom:0;"
      : `border-bottom:2px solid ${layout.accentColor};padding-bottom:.28rem;`;
  const coverRule =
    layout.headingRule === "none"
      ? "border-bottom:0;"
      : `border-bottom:2px solid ${layout.accentColor};`;
  const headingSize = layout.headingFontSizePx
    ? `${layout.headingFontSizePx}px`
    : "1.05rem";
  const bodyLh = layout.bodyLineHeight ?? 1.55;
  const cellPad = t.cellPadding || ".45em .55em";
  const collapse = t.borderCollapse || "collapse";
  const headerHeight = t.headerRowHeight
    ? `height:${t.headerRowHeight};`
    : "";
  const colCss =
    t.colWidths && t.colWidths.length
      ? t.colWidths
          .map(
            (w, i) =>
              `.proposal-blueprint .bp-table th:nth-child(${i + 1}),.proposal-blueprint .bp-table td:nth-child(${i + 1}){width:${w};}`,
          )
          .join("\n")
      : "";

  const generatedCss = `
.proposal-blueprint{
  font-family:${layout.fontFamily};
  color:${layout.textColor};
  background:${layout.backgroundColor};
  font-size:${layout.baseFontSizePx}pt;
  line-height:${bodyLh};
  text-align:${layout.textAlign};
  padding:${m.top} ${m.right} ${m.bottom} ${m.left};
}
.proposal-blueprint .bp-playbook-cover{margin:0 0 ${spacing};}
.proposal-blueprint .bp-cover-banner .bp-cover-band{
  background:${layout.headerBandColor};
  color:#fff;
  padding:1.25rem 1.35rem;
  border-radius:4px;
}
.proposal-blueprint .bp-cover-centered{
  text-align:center;
  padding:0.4rem 0 1.35rem;
  border-bottom:0;
}
.proposal-blueprint .bp-cover-centered .bp-cover-brand{
  margin:0;
  font-size:1.85rem;
  font-weight:700;
  letter-spacing:${layout.letterSpacing || ".04em"};
  text-transform:uppercase;
  color:${layout.textColor};
  font-family:${layout.headingFontFamily};
}
.proposal-blueprint .bp-cover-centered .bp-cover-title{
  margin:.35rem 0 0;
  font-size:${layout.coverTitleSizePx ? `${layout.coverTitleSizePx}px` : "1.2rem"};
  font-weight:700;
  color:${layout.textColor};
  font-family:${layout.headingFontFamily};
}
.proposal-blueprint .bp-cover-centered .bp-cover-prepared,
.proposal-blueprint .bp-cover-centered .bp-cover-date{
  margin-top:.45rem;
  font-size:.95rem;
  color:${layout.headingColor};
}
.proposal-blueprint .bp-cover-centered .bp-cover-scope{
  margin:.85rem auto 0;
  max-width:42rem;
  font-size:.92rem;
  font-weight:700;
  color:${layout.headingColor};
  line-height:1.45;
}
.proposal-blueprint .bp-cover-scope.bp-cover-scope-pills{
  font-weight:700;
}
.proposal-blueprint .bp-cover-left{text-align:${layout.headingAlign};padding:0 0 1rem;${coverRule}}
.proposal-blueprint .bp-cover-left .bp-cover-brand{font-size:1.3rem;font-weight:700;color:${layout.headingColor};opacity:1;letter-spacing:0;text-align:${layout.headingAlign};}
.proposal-blueprint .bp-cover-left .bp-cover-title{font-size:1.05rem;color:${layout.accentColor};margin-top:.25rem;text-align:${layout.headingAlign};}
.proposal-blueprint .bp-cover-left .bp-cover-date{margin-top:.1rem;font-size:.9rem;color:#595959;text-align:${layout.headingAlign};}
.proposal-blueprint .bp-cover-left .bp-cover-scope{margin-top:.7rem;font-size:.9rem;font-weight:700;color:${layout.headingColor};text-align:${layout.headingAlign};}
.proposal-blueprint .bp-cover-kicker{
  font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;opacity:.9;margin:0 0 .35rem;
  font-family:${layout.headingFontFamily};
}
.proposal-blueprint .bp-cover-title{
  margin:0;font-size:${layout.coverTitleSizePx ? `${layout.coverTitleSizePx}px` : "1.65rem"};font-weight:700;color:inherit;
  font-family:${layout.headingFontFamily};text-align:inherit;
}
.proposal-blueprint .bp-cover-banner .bp-cover-title{color:#fff;}
.proposal-blueprint .bp-cover-meta{margin-top:.35rem;font-size:.9rem;opacity:.92;}
.proposal-blueprint .bp-section{margin:0 0 ${spacing};}
.proposal-blueprint .bp-h2{
  margin:0 0 .55rem;font-size:${headingSize};font-weight:700;
  color:${layout.headingColor};text-align:${layout.headingAlign};
  font-family:${layout.headingFontFamily};
  ${headingRule}
}
.proposal-blueprint .bp-body{white-space:pre-wrap;line-height:${bodyLh};text-align:${layout.textAlign};}
.proposal-blueprint .bp-body p{margin:0 0 .65em;}
.proposal-blueprint .bp-body ul,.proposal-blueprint .bp-body ol{margin:.3em 0 .8em;padding-left:1.3em;}
.proposal-blueprint .bp-body .bp-requested{color:${requestedColor};font-weight:700;}
.proposal-blueprint .bp-body .bp-recommended{color:${recommendedColor};font-weight:700;}
.proposal-blueprint .bp-table{
  width:100%;border-collapse:${collapse};margin:.55em 0 1em;font-size:inherit;table-layout:fixed;
  border:1px solid ${t.borderColor};
}
.proposal-blueprint .bp-table th,.proposal-blueprint .bp-table td{
  border:1px solid ${t.borderColor};padding:${cellPad};text-align:${t.cellAlign};vertical-align:top;line-height:1.4;
}
.proposal-blueprint .bp-table th{
  font-weight:700;background:${t.headerBackground};color:${t.headerColor};${headerHeight}
}
${
  t.stripedRows
    ? `.proposal-blueprint .bp-table tbody tr:nth-child(even) td{background:#f8fafc;}`
    : ""
}
${colCss}
.proposal-blueprint .bp-footer{
  margin-top:1.75rem;padding-top:.75rem;border-top:1px solid ${t.borderColor};
  font-size:.8rem;color:#64748b;
}
`.trim();

  const learnedCss = String(input.css || "").trim();
  const css = learnedCss
    ? `${generatedCss}\n${learnedCss}`
    : generatedCss;

  return {
    version: 1,
    mode: "playbook-layout",
    chrome: false,
    theme: {
      primary: layout.headingColor,
      secondary: layout.accentColor,
      fonts: layout.fontFamily,
      background: layout.backgroundColor,
    },
    slots: uniqueSlots,
    html: `<div class="bp-playbook-root">${cover}\n${sectionHtml}${footerHtml ? `\n${footerHtml}` : ""}</div>`,
    css,
    ...(layout.emphasis
      ? {
          emphasis: {
            requestedLabel: layout.emphasis.requestedLabel,
            recommendedLabel: layout.emphasis.recommendedLabel,
          },
        }
      : {}),
  };
}

function ensureSectionTables(
  html: string,
  sections: SectionSlot[],
  featureSchema: PlaybookFeatureSchema,
): string {
  let next = html;
  const sectionByKey = new Map(sections.map((s) => [s.key.trim(), s]));
  for (const section of uniqueBodySlots(sections)) {
    const full = sectionByKey.get(section.key);
    const table = tableHtmlForSlot(
      section.key,
      featureSchema,
      columnsFromSection(full),
      sectionComparisonKind(full) === "narrative",
    );
    if (!table) continue;
    const tableRe = new RegExp(
      `<table[^>]*data-slot-table="${section.key}"[^>]*>[\\s\\S]*?<\\/table>`,
      "i",
    );
    if (tableRe.test(next)) continue;
    const sectionRe = new RegExp(
      `(<section[^>]*data-slot="${section.key}"[^>]*>)([\\s\\S]*?)(<\\/section>)`,
      "i",
    );
    if (sectionRe.test(next)) {
      next = next.replace(sectionRe, `$1$2${table}$3`);
    }
  }
  return next;
}

function ensureMissingSlots(
  html: string,
  fallbackHtml: string,
  sections: SectionSlot[],
): string {
  let next = html;
  for (const section of uniqueBodySlots(sections)) {
    if (new RegExp(`data-slot="${section.key}"`, "i").test(next)) continue;
    const sectionRe = new RegExp(
      `<section[^>]*data-slot="${section.key}"[^>]*>[\\s\\S]*?<\\/section>`,
      "i",
    );
    const fromFallback = fallbackHtml.match(sectionRe);
    if (!fromFallback) continue;
    if (/<footer\b/i.test(next)) {
      next = next.replace(/<footer\b/i, `${fromFallback[0]}\n<footer`);
    } else if (/<\/div>\s*$/i.test(next)) {
      next = next.replace(/<\/div>\s*$/i, `${fromFallback[0]}\n</div>`);
    } else {
      next += `\n${fromFallback[0]}`;
    }
  }
  return next;
}

export function isPlaybookTemplateBlueprint(
  raw: unknown,
): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const o = raw as Record<string, unknown>;
  return String(o.mode || "") === "playbook-template" && typeof o.html === "string";
}

/**
 * Persist Gemini HTML as the empty skeleton (plus missing section/table shells).
 * Compact 5-rule CSS cannot win: incomplete CSS is stored as-is so persist fails.
 */
export function buildPlaybookTemplateBlueprint(input: {
  layoutStyle?: unknown;
  css?: string | null;
  html?: string | null;
  sections: SectionSlot[];
  featureSchema?: unknown;
  emphasis?: unknown;
}): DocumentBlueprint {
  const layout = parsePlaybookLayoutStyle(input.layoutStyle);
  const featureSchema = parseFeatureSchema(input.featureSchema);
  const fallback = buildPlaybookDocumentBlueprint({
    layoutStyle: layout,
    sections: input.sections,
    featureSchema,
    css: input.css,
  });
  const geminiHtml = String(input.html || "").trim();
  let html = "";
  if (htmlLooksLikeSkeleton(geminiHtml)) {
    html = ensureSectionTables(geminiHtml, input.sections, featureSchema);
    html = ensureMissingSlots(html, fallback.html, input.sections);
    html = ensureSectionTables(html, input.sections, featureSchema);
  }
  const learnedCss = String(input.css || "").trim();
  const css = cssLooksComplete(learnedCss)
    ? `${fallback.css}\n${learnedCss}`
    : learnedCss;
  const emphasis = parseEmphasis(input.emphasis) || layout.emphasis;
  return {
    version: 1,
    mode: "playbook-template",
    chrome: false,
    theme: fallback.theme,
    slots: fallback.slots,
    html,
    css,
    ...(emphasis
      ? {
          emphasis: {
            requestedLabel: emphasis.requestedLabel,
            recommendedLabel: emphasis.recommendedLabel,
          },
        }
      : {}),
  };
}

const DOCUMENT_TYPE_TITLE_RE = /proposal|quotation|\bquote\b|commercial/i;
const GENERIC_COVER_TITLE_RE =
  /^(commercial\s+proposal(?:\s*&\s*quotation)?|quotation|quote)\s*$/i;

export function isDocumentTypeTitle(title: string): boolean {
  const text = String(title || "").trim();
  return Boolean(text) && text.length <= 80 && DOCUMENT_TYPE_TITLE_RE.test(text);
}

/** Frozen gold H1 phrases that must not be painted onto a generated cover. */
export function isGenericCoverTitle(title: string): boolean {
  return GENERIC_COVER_TITLE_RE.test(String(title || "").trim());
}

export function selectPlaybookCoverTags(input: {
  goldTags?: string[];
  allowedProducts?: string[];
  productScope?: string;
  tags?: string[];
}): string[] {
  return (input.tags || [])
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .slice(0, 6);
}

function metaValueForCoverLabel(
  label: string,
  goldValue: string,
  tokens: Record<string, string>,
): string {
  const key = String(label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (["client", "prepared for", "customer", "client name"].includes(key)) {
    return tokens.customerName || tokens.companyName || "";
  }
  if (["document", "document title"].includes(key)) {
    return tokens.documentTitle || "";
  }
  if (key === "date") return tokens.date || "";
  if (["prepared by", "vendor", "from"].includes(key)) {
    return tokens.vendorName || "";
  }
  return goldValue;
}

export function coverAlignFromLayout(
  cover?: Record<string, unknown> | null,
): "left" | "center" | "right" {
  const rec = cover && typeof cover === "object" ? cover : {};
  const nested =
    rec.layout && typeof rec.layout === "object" && !Array.isArray(rec.layout)
      ? (rec.layout as Record<string, unknown>)
      : {};
  const raw = String(
    rec.cover_align ||
      rec.coverAlign ||
      nested.cover_align ||
      rec.brand_align ||
      rec.title_align ||
      "",
  )
    .trim()
    .toLowerCase();
  if (raw === "center" || raw === "right" || raw === "left") return raw;
  return "center";
}

function cssTextAlign(block: string): "left" | "center" | "right" | null {
  const match = /(?:^|;)\s*text-align\s*:\s*(left|center|right)\b/i.exec(block);
  const v = match?.[1]?.toLowerCase();
  if (v === "left" || v === "center" || v === "right") return v;
  return null;
}

function cssRuleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s*\\{([^{}]+)\\}`, "i").exec(css)?.[1] || "";
}

function voteCoverAlign(
  votes: Array<"left" | "center" | "right" | null | undefined>,
): "left" | "center" | "right" {
  const found = votes.filter(
    (v): v is "left" | "center" | "right" =>
      v === "left" || v === "center" || v === "right",
  );
  if (!found.length) return "center";
  const centerN = found.filter((v) => v === "center").length;
  const rightN = found.filter((v) => v === "right").length;
  const leftN = found.filter((v) => v === "left").length;
  if (centerN >= leftN && centerN >= rightN && centerN > 0) return "center";
  if (rightN > leftN && rightN > centerN) return "right";
  return "left";
}

/** Infer cover chrome alignment from stored class + frozen CSS (not a constant). */
export function inferCoverAlign(html: string, css = ""): "left" | "center" | "right" {
  const classMatch = /\bcover-align-(left|center|right)\b/i.exec(html);
  if (classMatch) {
    const v = classMatch[1].toLowerCase();
    if (v === "left" || v === "center" || v === "right") return v;
  }
  const styles = [
    css,
    ...[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1] || ""),
  ].join("\n");
  const block = cssTextAlign(cssRuleBody(styles, ".proposal-doc .cover-block"));
  if (block) return block;
  return voteCoverAlign([
    cssTextAlign(cssRuleBody(styles, ".proposal-doc .cover-brand")),
    cssTextAlign(cssRuleBody(styles, ".proposal-doc .cover-title")),
    cssTextAlign(cssRuleBody(styles, ".proposal-doc .cover-prepared")),
    cssTextAlign(cssRuleBody(styles, ".proposal-doc .cover-date")),
  ]);
}

export function applyCoverAlignClass(html: string, css = ""): string {
  if (!/\bcover-block\b/i.test(html)) return html;
  const align = inferCoverAlign(html, css);
  const alignClass = `cover-align-${align}`;
  return html.replace(
    /<div([^>]*class=")([^"]*\bcover-block\b[^"]*)("[^>]*)>/i,
    (_full, pre: string, classes: string, post: string) => {
      const cleaned = classes
        .replace(/\bcover-align-(?:left|center|right)\b/g, "")
        .replace(/\s+/g, " ")
        .trim();
      return `<div${pre}${cleaned} ${alignClass}${post}>`;
    },
  );
}

export function realTableColumns(columns: string[]): string[] {
  const next = (columns || [])
    .map((c) => String(c || "").trim())
    .filter(Boolean);
  if (!next.length) return [];
  if (next.every((c) => /^col(?:umn)?\s*\d+$/i.test(c))) return [];
  return next;
}

export function playbookCoverInnerHtml(input: {
  cover?: Record<string, unknown> | null;
  tokens: Record<string, string>;
  productTags?: string[];
  logoDataUrl?: string;
}): string {
  const cover =
    input.cover && typeof input.cover === "object" && !Array.isArray(input.cover)
      ? input.cover
      : {};
  const bits: string[] = [];
  const logo = String(input.logoDataUrl || "").trim();
  if (logo) {
    bits.push(`<img class="cover-logo" src="${escapeHtml(logo)}" alt="logo" />`);
  }
  const brand = String(input.tokens.vendorName || cover.brand || "").trim();
  if (brand) {
    bits.push(`<p class="cover-brand">${escapeHtml(brand)}</p>`);
  }
  const title = String(input.tokens.documentTitle || "").trim();
  if (title && !isGenericCoverTitle(title)) {
    bits.push(`<h1 class="cover-title bp-cover-title">${escapeHtml(title)}</h1>`);
  }
  const customer = String(
    input.tokens.customerName || input.tokens.companyName || "",
  ).trim();
  if (customer) {
    bits.push(
      `<p class="cover-prepared">Prepared for ${escapeHtml(customer)}</p>`,
    );
  }
  if (String(input.tokens.date || "").trim()) {
    bits.push(
      `<p class="cover-date">${escapeHtml(String(input.tokens.date))}</p>`,
    );
  }
  const tags = (input.productTags || [])
    .map((tag) => String(tag || "").trim())
    .filter(Boolean);
  const tagLayout = String(cover.tag_layout || "centered_wrap");
  if (tags.length) {
    const lis = tags.map((tag) => `<li>${escapeHtml(tag)}</li>`).join("");
    bits.push(
      `<ul class="product-tags layout-${escapeHtml(tagLayout)}" data-slot-tags>${lis}</ul>`,
    );
  }
  const meta = Array.isArray(cover.meta_rows) ? cover.meta_rows : [];
  const rows = meta
    .map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) return "";
      const rec = row as Record<string, unknown>;
      const label = String(rec.label || "").trim();
      if (!label) return "";
      const value = metaValueForCoverLabel(
        label,
        String(rec.value || ""),
        input.tokens,
      );
      return `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`;
    })
    .filter(Boolean);
  if (rows.length) {
    bits.push(
      `<table class="cover-meta"><tbody>${rows.join("")}</tbody></table>`,
    );
  }
  return bits.join("");
}

export function applyPlaybookCoverHtml(
  html: string,
  input: {
    coverLayout?: unknown;
    tokens: Record<string, string>;
    allowedProducts?: string[];
    productTags?: string[];
    logoDataUrl?: string;
  },
): string {
  const coverLayout =
    input.coverLayout &&
    typeof input.coverLayout === "object" &&
    !Array.isArray(input.coverLayout)
      ? (input.coverLayout as Record<string, unknown>)
      : null;
  if (!coverLayout) return html;
  const inner = playbookCoverInnerHtml({
    cover: coverLayout,
    tokens: input.tokens,
    productTags: selectPlaybookCoverTags({
      tags: input.productTags,
    }),
    logoDataUrl: input.logoDataUrl,
  });
  return replaceCoverBlock(html, inner, coverAlignFromLayout(coverLayout));
}

function replaceCoverBlock(
  html: string,
  inner: string,
  align: "left" | "center" | "right" = "center",
): string {
  if (!inner.trim()) return html;
  const alignClass = `cover-align-${align}`;
  if (/<div[^>]*class="[^"]*\bcover-block\b/i.test(html)) {
    return html.replace(
      /<div([^>]*class=")([^"]*\bcover-block\b[^"]*)("[^>]*)>[\s\S]*?<\/div>/i,
      (_full, pre: string, classes: string, post: string) => {
        const cleaned = classes
          .replace(/\bcover-align-(?:left|center|right)\b/g, "")
          .replace(/\s+/g, " ")
          .trim();
        return `<div${pre}${cleaned} ${alignClass}${post}>${inner}</div>`;
      },
    );
  }
  if (/<article\b[^>]*>/i.test(html)) {
    return html.replace(
      /(<article\b[^>]*>)/i,
      `$1<div class="cover-block bp-playbook-cover ${alignClass}">${inner}</div>`,
    );
  }
  return html;
}

function coverTitleFromTokens(tokens: Record<string, string>): string {
  return String(tokens.productScope || tokens.dealTitle || "").trim();
}

function applyTokens(
  html: string,
  tokens: Record<string, string>,
  opts?: { preserveCoverTitle?: boolean },
): string {
  const coverTitle = coverTitleFromTokens(tokens);
  const merged =
    coverTitle && !opts?.preserveCoverTitle
      ? { ...tokens, dealTitle: coverTitle, productScope: coverTitle }
      : tokens;
  let out = html;
  for (const [key, value] of Object.entries(merged)) {
    const token = key.startsWith("{{") ? key : `{{${key}}}`;
    out = out.split(token).join(escapeHtml(String(value ?? "")));
  }
  return out;
}

function tableColumnsFromFill(
  section: PlaybookTemplateFillSection,
  slotKey: string,
): string[] {
  const fromSpec = columnsFromSection({
    key: section.key || slotKey,
    tableSpec: section.tableSpec,
  });
  if (fromSpec.length) return fromSpec;
  if (sectionComparisonKind(section) === "narrative") return [];
  return defaultColumnsForSectionKey(slotKey || section.key);
}

function tbodyFromRows(rows: Array<{ cells: string[] }>, colCount: number): string {
  if (!rows.length) return "";
  return rows
    .map((row) => {
      const cells = Array.isArray(row.cells) ? row.cells : [];
      const padded = [...cells];
      while (padded.length < colCount) padded.push("");
      const tds = padded
        .slice(0, Math.max(colCount, cells.length))
        .map((cell) => `<td>${escapeHtml(String(cell || ""))}</td>`)
        .join("");
      return `<tr>${tds}</tr>`;
    })
    .join("");
}

function appendMissingPlaybookSections(
  html: string,
  sections: PlaybookTemplateFillSection[],
): string {
  let next = html;
  for (const section of sections) {
    const key = String(section.key || "").trim();
    if (!key) continue;
    if (new RegExp(`data-slot="${key}"`, "i").test(next)) continue;
    const title = escapeHtml(String(section.title || key));
    const bodyHtml = formatSectionBodyHtml(section.body || "");
    const block = `<section class="bp-section" data-slot="${escapeHtml(key)}">
  <h2 class="bp-h2" data-slot-title>${title}</h2>
  <div class="bp-body" data-slot-body>${bodyHtml}</div>
</section>`;
    if (/<footer\b/i.test(next)) {
      next = next.replace(/<footer\b/i, `${block}\n<footer`);
    } else if (/<\/div>\s*$/i.test(next)) {
      next = next.replace(/<\/div>\s*$/i, `${block}\n</div>`);
    } else {
      next += `\n${block}`;
    }
  }
  return next;
}

/**
 * Clone a learned playbook template and fill tokens, slot bodies, and table rows.
 * Does not regenerate CSS.
 */
export function fillPlaybookTemplate(input: {
  template: {
    html?: string;
    css?: string;
    slots?: unknown;
    emphasis?: unknown;
    mode?: string;
    coverLayout?: unknown;
    logoDataUrl?: string;
  };
  tokens: Record<string, string>;
  sections: PlaybookTemplateFillSection[];
  allowedProducts?: string[];
  productTags?: string[];
  requirementText?: string;
  otherCustomerNames?: string[];
}): DocumentBlueprint {
  const css = String(input.template.css || "").replace(/\s+$/, "");
  const withCoverBreak =
    css &&
    /proposal-doc/i.test(String(input.template.html || css)) &&
    !/page-break-after/i.test(css)
      ? `${css}\n.proposal-doc .cover-block{page-break-after:always;break-after:page;}`
      : css;
  let html = String(input.template.html || "");
  html = stripSectionChromeHeader(
    html,
    input.sections.map((s) => String(s.title || s.key || "")),
    input.otherCustomerNames || [],
  );
  const emphasisRaw = input.template.emphasis;
  const emphasis =
    emphasisRaw && typeof emphasisRaw === "object" && !Array.isArray(emphasisRaw)
      ? {
          requestedLabel: String(
            (emphasisRaw as Record<string, unknown>).requestedLabel || "",
          ).trim() || undefined,
          recommendedLabel: String(
            (emphasisRaw as Record<string, unknown>).recommendedLabel || "",
          ).trim() || undefined,
        }
      : undefined;

  const coverLayout =
    input.template.coverLayout &&
    typeof input.template.coverLayout === "object" &&
    !Array.isArray(input.template.coverLayout)
      ? (input.template.coverLayout as Record<string, unknown>)
      : null;
  html = applyPlaybookCoverHtml(html, {
    coverLayout,
    tokens: input.tokens,
    allowedProducts: input.allowedProducts,
    productTags: input.productTags,
    logoDataUrl: input.template.logoDataUrl,
  });
  html = applyTokens(html, input.tokens, {
    preserveCoverTitle: Boolean(coverLayout),
  });

  const byKey = new Map(
    input.sections
      .filter((s) => s.key)
      .map((s) => [s.key.trim(), s] as const),
  );
  const allBodies = input.sections.map((s) => String(s.body || ""));
  const findSectionForSlot = (slotKey: string) => {
    const exact =
      byKey.get(String(slotKey)) || byKey.get(String(slotKey).toLowerCase());
    if (exact) return exact;
    const canon = canonicalizeSectionKey(slotKey);
    for (const [k, section] of byKey) {
      if (canonicalizeSectionKey(k) === canon) return section;
    }
    return undefined;
  };

  html = html.replace(
    /<section([^>]*?)data-slot="([^"]+)"([^>]*)>([\s\S]*?)<\/section>/gi,
    (_full, pre: string, slotKey: string, post: string, inner: string) => {
      const section = findSectionForSlot(String(slotKey));
      if (!section) {
        return `<section${pre}data-slot="${slotKey}"${post}>${inner}</section>`;
      }
      let next = inner;
      const title = escapeHtml(String(section.title || ""));
      const bodyHtml = formatSectionBodyHtml(section.body || "", emphasis);
      next = next.replace(
        /(<[^>]*data-slot-title[^>]*>)([\s\S]*?)(<\/[^>]+>)/i,
        (_m, open: string, _old: string, close: string) => `${open}${title}${close}`,
      );
      next = injectLearnedSectionBody(next, bodyHtml);
      if (title && !/<h[12]\b/i.test(next) && !/data-slot-title/i.test(next)) {
        next = `<h2 class="bp-h2" data-slot-title>${title}</h2>${next}`;
      }
      const columns = realTableColumns(tableColumnsFromFill(section, slotKey));
      const rows = tableRowsForSection({
        key: slotKey,
        body: section.body,
        tableRows: section.tableRows,
        tableSpec: section.tableSpec,
        allBodies,
        requirementText: input.requirementText,
        allowedProducts: input.allowedProducts,
        otherCustomerNames: input.otherCustomerNames,
      });
      if (columns.length && !new RegExp(`data-slot-table="${slotKey}"`, "i").test(next)) {
        next += emptyTableHtml(slotKey, columns);
      }
      if (rows.length && columns.length) {
        const headMatch = next.match(
          new RegExp(
            `<table[^>]*data-slot-table="${slotKey}"[^>]*>[\\s\\S]*?<thead>[\\s\\S]*?<\\/thead>`,
            "i",
          ),
        );
        const colCount = headMatch
          ? (headMatch[0].match(/<th\b/gi) || []).length
          : rows[0]?.cells?.length || columns.length;
        const tbody = tbodyFromRows(rows, colCount);
        if (/<tbody\b/i.test(next)) {
          next = next.replace(
            /(<tbody\b[^>]*>)([\s\S]*?)(<\/tbody>)/i,
            `$1${tbody}$3`,
          );
        }
      }
      return `<section${pre}data-slot="${slotKey}"${post}>${next}</section>`;
    },
  );

  html = appendMissingPlaybookSections(html, input.sections);
  html = applyCoverAlignClass(html, withCoverBreak);

  return {
    version: 1,
    mode: "playbook-template",
    chrome: false,
    html,
    css: withCoverBreak,
    slots: Array.isArray(input.template.slots)
      ? (input.template.slots as DocumentBlueprint["slots"])
      : undefined,
    ...(emphasis && (emphasis.requestedLabel || emphasis.recommendedLabel)
      ? { emphasis }
      : {}),
  };
}
