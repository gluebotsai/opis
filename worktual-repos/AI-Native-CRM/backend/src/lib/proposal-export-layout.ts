/**
 * Read page inset + type styles from frozen .proposal-doc CSS so PDF/DOCX
 * exports can match the on-screen preview without changing that preview.
 */

export type ProposalExportMarginsPt = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type ProposalExportLayout = {
  margins: ProposalExportMarginsPt;
  primary: string;
  text: string;
  muted: string;
  titleColor: string;
  headingColor: string;
  brandColor: string;
  fontBody: string;
  fontHeading: string;
  fontBrand: string;
  sizeBodyPt: number;
  sizeTitlePt: number;
  sizeHeadingPt: number;
  sizeBrandPt: number;
  tableHeaderBg: string;
  tableBorder: string;
  tableHeaderFill: boolean;
  coverBrandAlign: "left" | "center" | "right";
  coverTitleAlign: "left" | "center" | "right";
  productTagsAlign: "left" | "center" | "right";
};

const DEFAULT_MARGINS: ProposalExportMarginsPt = {
  top: 48,
  right: 48,
  bottom: 48,
  left: 48,
};

export const DEFAULT_PROPOSAL_EXPORT_LAYOUT: ProposalExportLayout = {
  margins: { ...DEFAULT_MARGINS },
  primary: "0B3D4A",
  text: "1A1A1A",
  muted: "5C6B73",
  titleColor: "0B3D4A",
  headingColor: "0B3D4A",
  brandColor: "0B3D4A",
  fontBody: "Arial",
  fontHeading: "Arial",
  fontBrand: "Arial",
  sizeBodyPt: 11,
  sizeTitlePt: 14,
  sizeHeadingPt: 11,
  sizeBrandPt: 24,
  tableHeaderBg: "0B3D4A",
  tableBorder: "BFBFBF",
  tableHeaderFill: true,
  coverBrandAlign: "center",
  coverTitleAlign: "center",
  productTagsAlign: "center",
};

export function cssLengthToPt(value: string, fallback = 48): number {
  const match = /^([\d.]+)\s*(pt|px|mm|cm|in|em)?$/i.exec(value.trim());
  if (!match) return fallback;
  const n = Number.parseFloat(match[1] || "");
  if (!Number.isFinite(n)) return fallback;
  const unit = (match[2] || "pt").toLowerCase();
  if (unit === "pt") return n;
  if (unit === "px") return (n * 72) / 96;
  if (unit === "mm") return (n * 72) / 25.4;
  if (unit === "cm") return (n * 72) / 2.54;
  if (unit === "in") return n * 72;
  if (unit === "em") return n * 11;
  return n;
}

export function ptToMm(pt: number): string {
  return `${Math.round(((pt * 25.4) / 72) * 100) / 100}mm`;
}

export function ptToTwip(pt: number): number {
  return Math.round(pt * 20);
}

export function ptToHalfPoints(pt: number): number {
  return Math.max(16, Math.round(pt * 2));
}

export function hexColor(value: string | null | undefined, fallback: string): string {
  const raw = String(value || "").trim();
  const match = /#?([0-9a-f]{3}|[0-9a-f]{6})\b/i.exec(raw);
  if (!match) return fallback;
  let hex = match[1].toUpperCase();
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((ch) => ch + ch)
      .join("");
  }
  return hex;
}

function firstFamily(value: string | null | undefined, fallback: string): string {
  const family = String(value || "")
    .split(",")[0]
    ?.replace(/['"]/g, "")
    .trim();
  if (!family) return fallback;
  if (/calibri|times|georgia|serif/i.test(family) && !/sans/i.test(family)) {
    return "Arial";
  }
  return family;
}

function cssAlign(
  value: string | null | undefined,
  fallback: "left" | "center" | "right",
): "left" | "center" | "right" {
  const v = String(value || "").toLowerCase();
  if (v === "center" || v === "right" || v === "left") return v;
  return fallback;
}

function extractRule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}\\s*\\{([^{}]+)\\}`, "i");
  return re.exec(css)?.[1] || "";
}

function decl(block: string, prop: string): string | null {
  const re = new RegExp(
    `(?:^|;)\\s*${prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*([^;]+)`,
    "i",
  );
  return re.exec(block)?.[1]?.trim() || null;
}

function parsePadding(block: string): ProposalExportMarginsPt {
  const shorthand = decl(block, "padding");
  if (shorthand) {
    const parts = shorthand.split(/\s+/).filter(Boolean);
    const [a, b, c, d] = parts;
    if (parts.length === 1) {
      const n = cssLengthToPt(a!, 48);
      return { top: n, right: n, bottom: n, left: n };
    }
    if (parts.length === 2) {
      const y = cssLengthToPt(a!, 48);
      const x = cssLengthToPt(b!, 48);
      return { top: y, right: x, bottom: y, left: x };
    }
    if (parts.length === 3) {
      return {
        top: cssLengthToPt(a!, 48),
        right: cssLengthToPt(b!, 48),
        bottom: cssLengthToPt(c!, 48),
        left: cssLengthToPt(b!, 48),
      };
    }
    return {
      top: cssLengthToPt(a!, 48),
      right: cssLengthToPt(b!, 48),
      bottom: cssLengthToPt(c!, 48),
      left: cssLengthToPt(d!, 48),
    };
  }
  return {
    top: cssLengthToPt(decl(block, "padding-top") || "48pt"),
    right: cssLengthToPt(decl(block, "padding-right") || "48pt"),
    bottom: cssLengthToPt(decl(block, "padding-bottom") || "48pt"),
    left: cssLengthToPt(decl(block, "padding-left") || "48pt"),
  };
}

function styleSheets(html: string): string {
  return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1] || "")
    .join("\n");
}

export function parseProposalExportLayout(html: string): ProposalExportLayout {
  const css = styleSheets(html);
  const root = extractRule(css, ".proposal-doc");
  const titleRule =
    extractRule(css, ".proposal-doc .cover-title") ||
    extractRule(css, ".proposal-doc .bp-cover-title");
  const headingRule =
    extractRule(css, ".proposal-doc h1.sec-h") ||
    extractRule(css, ".proposal-doc .sec-h");
  const brandRule = extractRule(css, ".proposal-doc .cover-brand");
  const tagsRule =
    extractRule(css, ".proposal-doc .product-tags") ||
    extractRule(css, ".proposal-doc .product-tags.layout-centered_wrap");
  const thRule =
    extractRule(css, ".proposal-doc table.grid th") ||
    /table\.grid th[^{]*\{([^{}]+)\}/i.exec(css)?.[1] ||
    "";
  const fallback = DEFAULT_PROPOSAL_EXPORT_LAYOUT;
  if (!root && !css.includes(".proposal-doc")) return { ...fallback, margins: { ...fallback.margins } };

  const primary = hexColor(decl(root, "--c-primary"), fallback.primary);
  const text = hexColor(decl(root, "--c-text"), fallback.text);
  const headingFromVar = hexColor(decl(root, "--c-primary"), primary);
  const coverAlign = coverAlignFromHtml(html, css);
  return {
    margins: root ? parsePadding(root) : { ...fallback.margins },
    primary,
    text,
    muted: hexColor(decl(root, "--c-muted"), fallback.muted),
    titleColor: hexColor(decl(titleRule, "color") || decl(root, "--c-primary"), headingFromVar),
    headingColor: hexColor(decl(headingRule, "color") || decl(root, "--c-primary"), headingFromVar),
    brandColor: hexColor(decl(brandRule, "color") || decl(root, "--c-primary"), primary),
    fontBody: firstFamily(decl(root, "--font-body") || decl(root, "font-family"), fallback.fontBody),
    fontHeading: firstFamily(decl(root, "--font-h"), fallback.fontHeading),
    fontBrand: firstFamily(decl(root, "--font-brand"), fallback.fontBrand),
    sizeBodyPt: cssLengthToPt(decl(root, "--size-body") || "11pt", 11),
    sizeTitlePt: cssLengthToPt(decl(root, "--size-title") || "14pt", 14),
    sizeHeadingPt: cssLengthToPt(decl(root, "--size-h1") || "11pt", 11),
    sizeBrandPt: cssLengthToPt(decl(root, "--size-brand") || "24pt", 24),
    tableHeaderBg: hexColor(decl(thRule, "background") || decl(root, "--c-th"), fallback.tableHeaderBg),
    tableBorder: hexColor(decl(root, "--c-border"), fallback.tableBorder),
    tableHeaderFill: Boolean(thRule && /background\s*:/i.test(thRule)),
    coverBrandAlign: coverAlign,
    coverTitleAlign: coverAlign,
    productTagsAlign: cssAlign(decl(tagsRule, "text-align"), fallback.productTagsAlign),
  };
}

function voteCoverAlign(
  votes: Array<"left" | "center" | "right">,
): "left" | "center" | "right" {
  if (!votes.length) return "center";
  const centerN = votes.filter((v) => v === "center").length;
  const rightN = votes.filter((v) => v === "right").length;
  const leftN = votes.filter((v) => v === "left").length;
  if (centerN >= leftN && centerN >= rightN && centerN > 0) return "center";
  if (rightN > leftN && rightN > centerN) return "right";
  return "left";
}

function coverAlignFromHtml(html: string, css: string): "left" | "center" | "right" {
  const classMatch = /\bcover-align-(left|center|right)\b/i.exec(html);
  if (classMatch) {
    const v = classMatch[1].toLowerCase();
    if (v === "left" || v === "center" || v === "right") return v;
  }
  const blockRule = extractRule(css, ".proposal-doc .cover-block");
  const fromBlock = String(decl(blockRule, "text-align") || "").toLowerCase();
  if (fromBlock === "left" || fromBlock === "center" || fromBlock === "right") {
    return fromBlock;
  }
  const brandRule = extractRule(css, ".proposal-doc .cover-brand");
  const titleRule =
    extractRule(css, ".proposal-doc .cover-title") ||
    extractRule(css, ".proposal-doc .bp-cover-title");
  const preparedRule = extractRule(css, ".proposal-doc .cover-prepared");
  const dateRule = extractRule(css, ".proposal-doc .cover-date");
  const votes: Array<"left" | "center" | "right"> = [];
  for (const rule of [brandRule, titleRule, preparedRule, dateRule]) {
    const raw = String(decl(rule, "text-align") || "").toLowerCase();
    if (raw === "left" || raw === "center" || raw === "right") votes.push(raw);
  }
  return voteCoverAlign(votes);
}

export function proposalPrintOverrideCss(): string {
  return `
@media print {
  html, body { margin: 0 !important; padding: 0 !important; }
  .proposal-blueprint { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  .proposal-doc {
    padding: 0 !important;
    width: auto !important;
    max-width: none !important;
    margin: 0 !important;
  }
  .proposal-doc h1, .proposal-doc h2, .proposal-doc .sec-h, .proposal-doc .cover-title {
    page-break-after: avoid;
    break-after: avoid;
  }
  .proposal-doc li, .proposal-doc tr { page-break-inside: avoid; break-inside: avoid; }
  .proposal-doc .cover-block.cover-align-center,
  .proposal-doc .cover-block.cover-align-center .cover-brand,
  .proposal-doc .cover-block.cover-align-center .cover-title,
  .proposal-doc .cover-block.cover-align-center .bp-cover-title,
  .proposal-doc .cover-block.cover-align-center .cover-prepared,
  .proposal-doc .cover-block.cover-align-center .cover-date {
    text-align: center !important;
  }
  .proposal-doc .cover-block.cover-align-left,
  .proposal-doc .cover-block.cover-align-left .cover-brand,
  .proposal-doc .cover-block.cover-align-left .cover-title,
  .proposal-doc .cover-block.cover-align-left .bp-cover-title,
  .proposal-doc .cover-block.cover-align-left .cover-prepared,
  .proposal-doc .cover-block.cover-align-left .cover-date {
    text-align: left !important;
  }
}
`.trim();
}
