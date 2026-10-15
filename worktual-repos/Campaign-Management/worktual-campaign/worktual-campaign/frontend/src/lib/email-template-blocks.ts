import type { TemplateFields } from "@/components/campaigns/ChannelTemplatePreview";
import {
  canonicalTemplateHeroUrl,
  isHttpImageUrl,
} from "@/lib/template-fields-merge";
import { absolutizeMediaUrl } from "@/services/media.api";

export type EmailBlockType =
  | "subject"
  | "banner"
  | "heading"
  | "text"
  | "image"
  | "button"
  | "spacer"
  | "divider"
  | "columns";

export type EmailBlockStyle = {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: "normal" | "bold";
  fontStyle?: "normal" | "italic";
  textDecoration?: "none" | "underline" | "line-through";
  color?: string;
  highlightColor?: string;
  textAlign?: "left" | "center" | "right";
  backgroundColor?: string;
  gradientFrom?: string;
  gradientTo?: string;
  borderRadius?: number;
  lineHeight?: number;
  paddingLeft?: number;
  listStyle?: "none" | "disc" | "decimal";
  /** Block width as a percent of the email column (24–100). */
  width?: number;
};

export const EMAIL_CANVAS_ID = "__canvas__";

export function initialEmailSelectionId(blocks: EmailBlock[]): string {
  const heading = blocks.find((b) => b.type === "heading" && !b.locked);
  if (heading) return heading.id;
  const body = blocks.find(
    (b) => b.type !== "subject" && b.type !== "banner" && !b.locked,
  );
  if (body) return body.id;
  return EMAIL_CANVAS_ID;
}

export function isEmailCellImage(value: string): boolean {
  return isHttpImageUrl(String(value || "").trim());
}

export type CanvasFill = {
  backgroundColor?: string;
  gradientFrom?: string;
  gradientTo?: string;
};

export function fillToCss(
  fill?: Pick<
    EmailBlockStyle,
    "backgroundColor" | "gradientFrom" | "gradientTo"
  >,
): { backgroundColor?: string; backgroundImage?: string } {
  const from = String(fill?.gradientFrom || "").trim();
  const to = String(fill?.gradientTo || "").trim();
  if (from && to) {
    return {
      backgroundColor: from,
      backgroundImage: `linear-gradient(90deg, ${from} 0%, ${to} 100%)`,
    };
  }
  const solid = String(fill?.backgroundColor || "").trim();
  if (solid) return { backgroundColor: solid };
  return {};
}

export function canvasFillFromTheme(theme: unknown): CanvasFill {
  if (!theme || typeof theme !== "object" || Array.isArray(theme)) return {};
  const t = theme as Record<string, unknown>;
  return {
    backgroundColor: String(t.canvas_bg || t.background || "").trim() || undefined,
    gradientFrom: String(t.canvas_from || "").trim() || undefined,
    gradientTo: String(t.canvas_to || "").trim() || undefined,
  };
}

export type EmailBlock = {
  id: string;
  type: EmailBlockType;
  content: string;
  href?: string;
  style?: EmailBlockStyle;
  /** Legal footer, merge-tag-only copy, campaign URL — user cannot edit. */
  locked?: boolean;
};

const DEFAULT_STYLE: EmailBlockStyle = {
  fontFamily: "Georgia, serif",
  fontSize: 15,
  fontWeight: "normal",
  color: "#374151",
  textAlign: "left",
};

function uid(): string {
  return `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function isHttpUrl(value: string): boolean {
  return isHttpImageUrl(value);
}

function heroInsertIndex(blocks: EmailBlock[]): number {
  const headlineIdx = blocks.findIndex((b) => b.type === "heading");
  if (headlineIdx >= 0) return headlineIdx + 1;
  const bannerIdx = blocks.findIndex((b) => b.type === "banner");
  if (bannerIdx >= 0) return bannerIdx + 1;
  const subjectIdx = blocks.findIndex((b) => b.type === "subject");
  if (subjectIdx >= 0) return subjectIdx + 1;
  return 0;
}

/** Match live preview — inject or repair hero image blocks from header_image / sections. */
export function ensureHeroInEmailBlocks(
  blocks: EmailBlock[],
  heroSrc: string,
): EmailBlock[] {
  const hero = absolutizeMediaUrl(String(heroSrc || "").trim());
  if (!hero || !isHttpUrl(hero)) return blocks;
  const next = blocks.map((b) => ({
    ...b,
    style: { ...DEFAULT_STYLE, ...(b.style || {}) },
  }));
  const imgIdx = next.findIndex((b) => b.type === "image");
  if (imgIdx >= 0) {
    const content = absolutizeMediaUrl(String(next[imgIdx].content || "").trim());
    if (!isHttpUrl(content)) {
      next[imgIdx] = { ...next[imgIdx], content: hero };
    } else {
      next[imgIdx] = { ...next[imgIdx], content };
    }
    return next;
  }
  const insertAt = heroInsertIndex(next);
  next.splice(insertAt, 0, {
    id: uid(),
    type: "image",
    content: hero,
    style: { ...DEFAULT_STYLE, textAlign: "center" },
  });
  return next;
}

function themeRecord(fields: TemplateFields): Record<string, string> {
  const theme =
    fields.theme && typeof fields.theme === "object" && !Array.isArray(fields.theme)
      ? (fields.theme as Record<string, unknown>)
      : {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(theme)) {
    if (v == null) continue;
    out[k] = String(v);
  }
  return out;
}

function ensureBannerInEmailBlocks(
  blocks: EmailBlock[],
  fields: TemplateFields,
): EmailBlock[] {
  if (blocks.some((b) => b.type === "banner")) return blocks;
  const theme = themeRecord(fields);
  const subjectIdx = blocks.findIndex((b) => b.type === "subject");
  const banner: EmailBlock = {
    id: uid(),
    type: "banner",
    content: String(theme.brand_name || "worktual").trim() || "worktual",
    style: {
      ...DEFAULT_STYLE,
      fontSize: 16,
      fontWeight: "bold",
      color: theme.banner_text || "#111827",
      textAlign: "center",
      backgroundColor: theme.banner_bg || "#ffffff",
      gradientFrom: theme.banner_from || undefined,
      gradientTo: theme.banner_to || undefined,
    },
  };
  const at = subjectIdx >= 0 ? subjectIdx + 1 : 0;
  return [...blocks.slice(0, at), banner, ...blocks.slice(at)];
}

function emailBlocksToSections(blocks: EmailBlock[]): Record<string, unknown>[] {
  const bodyBlocks = blocks.filter((b) => b.type !== "subject");
  const sections: Record<string, unknown>[] = [];
  let ctaCount = 0;
  for (const block of bodyBlocks) {
    if (block.type === "banner") continue;
    const content = block.content.trim();
    if (block.type === "heading" && content) {
      sections.push({ type: "headline", content });
      continue;
    }
    if (block.type === "text" && content) {
      sections.push({
        type: block.locked ? "compliance_footer" : "text",
        content,
      });
      continue;
    }
    if (block.type === "image" && content) {
      const pub = absolutizeMediaUrl(content);
      sections.push({
        type: "image",
        url: pub,
        content: pub,
        ...sectionLayoutFromStyle(block.style),
      });
      continue;
    }
    if (block.type === "button" && content) {
      ctaCount += 1;
      sections.push({
        type: ctaCount === 1 ? "cta" : "secondary_link",
        label: content,
        url: block.href || "",
        ...sectionLayoutFromStyle(block.style),
      });
      continue;
    }
    if (block.type === "divider") {
      sections.push({ type: "divider", content: "" });
      continue;
    }
    if (block.type === "spacer") {
      sections.push({
        type: "spacer",
        content: content || "24",
      });
      continue;
    }
    if (block.type === "columns") {
      const cells = parseColumnCells(block.content);
      sections.push({
        type: "columns",
        cells,
        items: [cells.a, cells.b],
        content: JSON.stringify(cells),
      });
    }
  }
  return sections;
}

/** Re-attach structured social_links from field-level source of truth after canvas edit. */
function ensureSocialSectionInSections(
  sections: Record<string, unknown>[],
  socialLinks: unknown,
): Record<string, unknown>[] {
  if (!Array.isArray(socialLinks) || !socialLinks.length) {
    return sections.filter(
      (row) =>
        !(
          row &&
          typeof row === "object" &&
          String((row as { type?: unknown }).type || "").toLowerCase() ===
            "social_links"
        ),
    );
  }
  const links = socialLinks
    .filter((row): row is Record<string, unknown> =>
      Boolean(row && typeof row === "object" && !Array.isArray(row)),
    )
    .map((row) => ({
      label: String(row.label || "").trim(),
      url: String(row.url || row.href || "").trim(),
      network: String(row.network || "other").trim() || "other",
    }))
    .filter((row) => row.label && /^https?:\/\//i.test(row.url));
  if (!links.length) return sections;
  const without = sections.filter(
    (row) =>
      !(
        row &&
        typeof row === "object" &&
        String((row as { type?: unknown }).type || "").toLowerCase() ===
          "social_links"
      ),
  );
  const socialRow = {
    type: "social_links",
    purpose: "brand_links",
    links,
    items: links.map((l) => `${l.label}|${l.url}`),
  };
  const insertAt = without.findIndex(
    (row) =>
      row &&
      typeof row === "object" &&
      String((row as { type?: unknown }).type || "").toLowerCase() ===
        "compliance_footer",
  );
  if (insertAt >= 0) {
    without.splice(insertAt, 0, socialRow);
  } else {
    without.push(socialRow);
  }
  return without;
}


function isBlock(raw: unknown): raw is EmailBlock {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const b = raw as EmailBlock;
  return (
    typeof b.id === "string" &&
    typeof b.type === "string" &&
    typeof b.content === "string"
  );
}

export function cloneWithNewId(block: EmailBlock): EmailBlock {
  return { ...block, id: uid(), locked: false, style: { ...(block.style || {}) } };
}

export function createEmailBlock(
  type: Exclude<EmailBlockType, "subject">,
): EmailBlock {
  if (type === "image") {
    return {
      id: uid(),
      type,
      content: "",
      style: { ...DEFAULT_STYLE, textAlign: "center" },
    };
  }
  if (type === "button") {
    return {
      id: uid(),
      type,
      content: "Learn more",
      href: "",
      style: {
        ...DEFAULT_STYLE,
        fontWeight: "bold",
        color: "#ffffff",
        textAlign: "center",
        fontSize: 14,
      },
    };
  }
  if (type === "heading") {
    return {
      id: uid(),
      type,
      content: "New heading",
      style: {
        ...DEFAULT_STYLE,
        fontSize: 22,
        fontWeight: "bold",
        color: "#111827",
      },
    };
  }
  if (type === "spacer") {
    return { id: uid(), type, content: "24", style: { ...DEFAULT_STYLE } };
  }
  if (type === "divider") {
    return { id: uid(), type, content: "", style: { ...DEFAULT_STYLE } };
  }
  if (type === "columns") {
    return {
      id: uid(),
      type,
      content: JSON.stringify({ a: "Column 1", b: "Column 2" }),
      style: { ...DEFAULT_STYLE },
    };
  }
  return {
    id: uid(),
    type: "text",
    content: "New paragraph",
    style: { ...DEFAULT_STYLE },
  };
}

/** Turn stored fields into editable canvas blocks. */
export function fieldsToEmailBlocks(fields: TemplateFields): EmailBlock[] {
  const heroSrc = canonicalTemplateHeroUrl(fields as Record<string, unknown>);
  const raw = fields.blocks;
  if (Array.isArray(raw) && raw.length > 0 && raw.every(isBlock)) {
    const mapped = raw.map((b) => ({
      ...b,
      style: { ...DEFAULT_STYLE, ...(b.style || {}) },
    }));
    return ensureBannerInEmailBlocks(
      ensureHeroInEmailBlocks(mapped, heroSrc),
      fields,
    );
  }

  const blocks: EmailBlock[] = [];
  const subject = String(fields.subject || "").trim();
  blocks.push({
    id: uid(),
    type: "subject",
    content: subject || "Email subject",
    style: {
      ...DEFAULT_STYLE,
      fontSize: 14,
      fontWeight: "bold",
      color: "#111827",
    },
  });

  const sections = Array.isArray(fields.sections) ? fields.sections : [];
  if (sections.length > 0) {
    const theme =
      fields.theme && typeof fields.theme === "object"
        ? (fields.theme as Record<string, string>)
        : {};
    for (const raw of sections) {
      if (!raw || typeof raw !== "object") continue;
      const section = raw as {
        type?: string;
        content?: string;
        items?: string[];
        label?: string;
        url?: string;
        align?: string;
        width?: number;
        cells?: { a?: string; b?: string };
      };
      const kind = String(section.type || "text");
      const content = String(section.content || "").trim();
      const items = Array.isArray(section.items)
        ? section.items.map(String).filter(Boolean)
        : [];
      if (kind === "divider") {
        blocks.push(createEmailBlock("divider"));
        continue;
      }
      if (kind === "spacer") {
        blocks.push({
          id: uid(),
          type: "spacer",
          content: content || "24",
          style: { ...DEFAULT_STYLE },
        });
        continue;
      }
      if (kind === "columns") {
        const cells = columnCellsFromSection(section);
        blocks.push({
          id: uid(),
          type: "columns",
          content: JSON.stringify(cells),
          style: { ...DEFAULT_STYLE },
        });
        continue;
      }
      if (kind === "image") {
        const sectionSrc = String(section.url || section.content || "").trim();
        const src = isHttpUrl(sectionSrc) ? sectionSrc : heroSrc;
        if (src) {
          blocks.push({
            id: uid(),
            type: "image",
            content: src,
            style: {
              ...DEFAULT_STYLE,
              textAlign: "center",
              ...styleFromSectionLayout(section),
            },
          });
        }
        continue;
      }
      if (kind === "cta" || kind === "secondary_link") {
        blocks.push({
          id: uid(),
          type: "button",
          content: String(section.label || content || "Learn more"),
          href: String(section.url || ""),
          style: {
            ...DEFAULT_STYLE,
            color: String(theme.button_text || "#ffffff"),
            fontWeight: "bold",
            textAlign: "center",
            ...styleFromSectionLayout(section),
          },
        });
        continue;
      }
      if (kind === "social_links") {
        // Keep social on fields.social_links (source of truth); canvas stays text/image/cta.
        // emailBlocksToFields re-injects the social_links section from base.social_links.
        continue;
      }
      const combined = [content, ...items.map((item) => `• ${item}`)]
        .filter(Boolean)
        .join("\n");
      if (!combined) continue;
      blocks.push({
        id: uid(),
        type: kind === "headline" ? "heading" : "text",
        content: combined,
        locked: kind === "compliance_footer",
        style: {
          ...DEFAULT_STYLE,
          fontFamily: String(
            kind === "headline"
              ? theme.font_heading || DEFAULT_STYLE.fontFamily
              : theme.font_body || DEFAULT_STYLE.fontFamily,
          ),
          fontSize: kind === "headline" ? 26 : kind === "compliance_footer" ? 12 : 15,
          fontWeight: kind === "headline" ? "bold" : "normal",
          color: String(
            kind === "compliance_footer"
              ? theme.muted || "#9ca3af"
              : theme.text || DEFAULT_STYLE.color,
          ),
          textAlign: theme.alignment === "center" ? "center" : "left",
        },
      });
    }
    return ensureBannerInEmailBlocks(
      ensureHeroInEmailBlocks(blocks, heroSrc),
      fields,
    );
  }

  const image = absolutizeMediaUrl(
    String(
      fields.header_image || fields.image_url || fields.image || heroSrc || "",
    ).trim(),
  );
  if (image) {
    blocks.push({
      id: uid(),
      type: "image",
      content: image,
      style: { ...DEFAULT_STYLE, textAlign: "center" },
    });
  }

  const greeting = String(fields.greeting || "").trim();
  if (greeting) {
    blocks.push({
      id: uid(),
      type: "text",
      content: greeting,
      style: { ...DEFAULT_STYLE },
    });
  }

  const paragraphs = Array.isArray(fields.paragraphs)
    ? fields.paragraphs.map(String).filter((p) => p.trim())
    : String(fields.body || "")
        .split(/\n\n+/)
        .map((s) => s.trim())
        .filter(Boolean);

  for (const p of paragraphs) {
    blocks.push({
      id: uid(),
      type: "text",
      content: p,
      style: { ...DEFAULT_STYLE },
    });
  }

  const cta = String(fields.cta_label || "").trim();
  if (cta) {
    blocks.push({
      id: uid(),
      type: "button",
      content: cta,
      href: String(fields.cta_url || ""),
      style: {
        ...DEFAULT_STYLE,
        fontWeight: "bold",
        color: "#ffffff",
        textAlign: "center",
        fontSize: 14,
      },
    });
  }

  const signoff = String(fields.signoff || "").trim();
  if (signoff) {
    blocks.push({
      id: uid(),
      type: "text",
      content: signoff,
      style: { ...DEFAULT_STYLE },
    });
  }

  const footer = String(fields.footer || "").trim();
  if (footer) {
    blocks.push({
      id: uid(),
      type: "text",
      content: footer,
      locked: true,
      style: {
        ...DEFAULT_STYLE,
        fontSize: 12,
        color: "#9ca3af",
        textAlign: "center",
      },
    });
  }

  if (blocks.length === 1) {
    blocks.push({
      id: uid(),
      type: "text",
      content: "Write your email body here…",
      style: { ...DEFAULT_STYLE },
    });
  }

  return ensureBannerInEmailBlocks(
    ensureHeroInEmailBlocks(blocks, heroSrc),
    fields,
  );
}

/** Persist blocks + flat fields so agent/preview keep working. */
export function emailBlocksToFields(
  blocks: EmailBlock[],
  base: TemplateFields,
  canvasFill?: CanvasFill,
): TemplateFields {
  const subject =
    blocks.find((b) => b.type === "subject")?.content.trim() || "";
  const bodyBlocks = blocks.filter((b) => b.type !== "subject");
  const button = bodyBlocks.find((b) => b.type === "button");
  const image = bodyBlocks.find(
    (b) => b.type === "image" && isHttpUrl(b.content.trim()),
  );
  const imageUrl = absolutizeMediaUrl(image?.content.trim() || "");
  const prevTheme =
    base.theme && typeof base.theme === "object" && !Array.isArray(base.theme)
      ? { ...(base.theme as Record<string, unknown>) }
      : {};
  const banner = blocks.find((b) => b.type === "banner");
  const bannerStyle = banner?.style || {};
  const theme = {
    ...prevTheme,
    brand_name: banner?.content.trim() || prevTheme.brand_name || "worktual",
    banner_text: bannerStyle.color || prevTheme.banner_text,
    banner_bg: bannerStyle.backgroundColor || prevTheme.banner_bg,
    banner_from: bannerStyle.gradientFrom || "",
    banner_to: bannerStyle.gradientTo || "",
    canvas_bg: canvasFill?.backgroundColor || prevTheme.canvas_bg,
    canvas_from: canvasFill?.gradientFrom || "",
    canvas_to: canvasFill?.gradientTo || "",
  };

  const sections = ensureSocialSectionInSections(
    emailBlocksToSections(blocks),
    base.social_links,
  );

  return {
    ...base,
    blocks,
    sections,
    subject,
    greeting: "",
    paragraphs: [],
    body: "",
    cta_label: button?.content.trim() || "",
    cta_url: button?.href || base.cta_url || "",
    signoff: "",
    footer: "",
    theme,
    brand: base.brand,
    social_links: base.social_links,
    footer_links: base.footer_links,
    theme_id: base.theme_id,
    ...(imageUrl
      ? {
          header_image: imageUrl,
          image_url: imageUrl,
        }
      : {}),
  };
}

export function insertEmailBlock(
  blocks: EmailBlock[],
  next: EmailBlock,
  selectedId: string | null,
  place: "below" | "above" = "below",
): EmailBlock[] {
  if (!selectedId) return [...blocks, next];
  const idx = blocks.findIndex((b) => b.id === selectedId);
  if (idx < 0) return [...blocks, next];
  const at = place === "above" ? idx : idx + 1;
  return [...blocks.slice(0, at), next, ...blocks.slice(at)];
}

export function duplicateEmailBlock(
  blocks: EmailBlock[],
  id: string,
): { blocks: EmailBlock[]; newId: string | null } {
  const idx = blocks.findIndex((b) => b.id === id);
  if (idx < 0 || blocks[idx].locked || blocks[idx].type === "subject" || blocks[idx].type === "banner") {
    return { blocks, newId: null };
  }
  const copy = cloneWithNewId(blocks[idx]);
  return {
    blocks: [...blocks.slice(0, idx + 1), copy, ...blocks.slice(idx + 1)],
    newId: copy.id,
  };
}

export function moveEmailBlock(
  blocks: EmailBlock[],
  fromId: string,
  toId: string,
): EmailBlock[] {
  if (fromId === toId) return blocks;
  const from = blocks.findIndex((b) => b.id === fromId);
  const to = blocks.findIndex((b) => b.id === toId);
  if (from < 0 || to < 0) return blocks;
  if (blocks[from].type === "subject" || blocks[from].type === "banner") return blocks;
  const next = [...blocks];
  const [item] = next.splice(from, 1);
  const insertAt = next.findIndex((b) => b.id === toId);
  if (insertAt < 0) return blocks;
  next.splice(insertAt, 0, item);
  return next;
}

export function sectionLayoutFromStyle(
  style?: EmailBlockStyle,
): { align?: "left" | "center" | "right"; width?: number } {
  const align = style?.textAlign;
  const width = Number(style?.width);
  const out: { align?: "left" | "center" | "right"; width?: number } = {};
  if (align === "left" || align === "center" || align === "right") {
    out.align = align;
  }
  if (Number.isFinite(width) && width >= 24 && width < 100) {
    out.width = Math.round(width);
  }
  return out;
}

export function styleFromSectionLayout(section: {
  align?: unknown;
  width?: unknown;
}): Pick<EmailBlockStyle, "textAlign" | "width"> {
  const align = String(section.align || "");
  const width = Number(section.width);
  return {
    ...(align === "left" || align === "center" || align === "right"
      ? { textAlign: align }
      : {}),
    ...(Number.isFinite(width) && width >= 24 && width <= 100
      ? { width: Math.round(width) }
      : {}),
  };
}

export function parseColumnCells(content: string): { a: string; b: string } {
  try {
    const raw = JSON.parse(content) as { a?: string; b?: string };
    return { a: String(raw.a || ""), b: String(raw.b || "") };
  } catch {
    return { a: content, b: "" };
  }
}

export function columnCellsFromSection(section: {
  cells?: unknown;
  items?: unknown;
  content?: unknown;
}): { a: string; b: string } {
  const cells = section.cells;
  if (cells && typeof cells === "object" && !Array.isArray(cells)) {
    const rec = cells as Record<string, unknown>;
    return { a: String(rec.a ?? ""), b: String(rec.b ?? "") };
  }
  const items = Array.isArray(section.items)
    ? section.items.map((item) => String(item ?? ""))
    : [];
  if (items.length >= 2) {
    return { a: items[0] || "", b: items[1] || "" };
  }
  if (items.length === 1 && String(items[0] || "").trim()) {
    return { a: items[0] || "", b: "" };
  }
  return parseColumnCells(String(section.content ?? ""));
}

export function writeColumnCell(
  content: string,
  cell: "a" | "b",
  value: string,
): string {
  const cells = parseColumnCells(content);
  return JSON.stringify({ ...cells, [cell]: value });
}

export function defaultBlockStyle(type: EmailBlockType): EmailBlockStyle {
  if (type === "heading") {
    return {
      ...DEFAULT_STYLE,
      fontSize: 22,
      fontWeight: "bold",
      color: "#111827",
    };
  }
  if (type === "button") {
    return {
      ...DEFAULT_STYLE,
      fontWeight: "bold",
      color: "#ffffff",
      textAlign: "center",
      fontSize: 14,
    };
  }
  if (type === "subject") {
    return {
      ...DEFAULT_STYLE,
      fontSize: 14,
      fontWeight: "bold",
      color: "#111827",
    };
  }
  return { ...DEFAULT_STYLE };
}
