/**
 * Channel template preview shells.
 * Agent supplies structured key/value fields; this layer fills device/UI formats.
 * Legacy HTML is accepted only as a fallback for older session payloads.
 */

import { useState, type CSSProperties, type ReactNode } from "react";
import { WebPushPreviewGrid } from "@/components/campaigns/WebPushGalleryPreview";
import { canonicalTemplateHeroUrl, canonicalizeEmailTemplateFields, isHttpImageUrl } from "@/lib/template-fields-merge";
import { previewComposeHtml } from "@/lib/compose-html-manual-edit";

export type TemplateFields = {
  subject?: string;
  preheader?: string;
  compiled_html?: string;
  html?: string;
  pattern_id?: string;
  theme_id?: string;
  theme?: Record<string, string>;
  sections?: Array<{
    type?: string;
    purpose?: string;
    display?: string;
    aspect_ratio?: string;
    content?: string;
    items?: string[];
    label?: string;
    url?: string;
    cells?: { a?: string; b?: string };
    align?: string;
    width?: number;
  }>;
  greeting?: string;
  paragraphs?: string[];
  cta_label?: string;
  cta_url?: string;
  signoff?: string;
  footer?: string;
  body?: string;
  title?: string;
  buttons?: Array<{
    label?: string;
    text?: string;
    url?: string;
    type?: string;
  }>;
  [key: string]: unknown;
};

function stripTags(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function emailHeroSrc(fields: TemplateFields): string {
  return canonicalTemplateHeroUrl(fields as Record<string, unknown>);
}

function emailSectionIsGridCell(section: {
  display?: string;
  purpose?: string;
}): boolean {
  const display = String(section.display || "").toLowerCase();
  const purpose = String(section.purpose || "").toLowerCase();
  return display === "grid_cell" || purpose === "product";
}

function EmailHeroImage({
  src,
  compact = false,
  variant = "hero",
}: {
  src: string;
  compact?: boolean;
  variant?: "hero" | "grid";
}) {
  const [broken, setBroken] = useState(false);
  const trimmed = String(src || "").trim();
  const isPlaceholder =
    !trimmed ||
    (!/^https?:\/\//i.test(trimmed) &&
      (/\[.*image.*\]/i.test(trimmed) || /placeholder/i.test(trimmed)));

  if (isPlaceholder) {
    return (
      <div
        className={
          compact
            ? "rounded-md border border-dashed border-neutral-300 bg-neutral-50 px-3 py-6 text-center text-[11px] text-neutral-500"
            : "rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-4 py-10 text-center text-sm text-neutral-500"
        }
      >
        Hero image not attached yet. Ask in template chat to generate one, or use
        Edit template to upload a public image URL.
      </div>
    );
  }

  if (broken) {
    return (
      <div
        className={
          compact
            ? "rounded-md border border-dashed border-amber-300 bg-amber-50 px-3 py-6 text-center text-[11px] text-amber-900"
            : "rounded-lg border border-dashed border-amber-300 bg-amber-50 px-4 py-10 text-center text-sm text-amber-900"
        }
      >
        This image link did not load. It may be a dev placeholder or an
        unreachable URL — try generating again or upload a public image URL.
      </div>
    );
  }

  const gridClass = compact
    ? "mx-auto block aspect-square max-h-20 w-full rounded-md object-cover"
    : "mx-auto block aspect-square w-full rounded-lg object-cover";
  const heroClass = compact
    ? "mx-auto block max-h-24 w-full rounded-md object-cover"
    : "mx-auto block h-auto w-full rounded-lg";

  return (
    <img
      src={trimmed}
      alt=""
      onError={() => setBroken(true)}
      className={variant === "grid" ? gridClass : heroClass}
    />
  );
}

function sectionBoxAlign(value: unknown): "left" | "center" | "right" {
  const align = String(value || "");
  return align === "left" || align === "right" ? align : "center";
}

function sectionBoxWidth(value: unknown): string | undefined {
  const width = Number(value);
  if (!Number.isFinite(width) || width < 24 || width >= 100) return undefined;
  return `${Math.round(width)}%`;
}

function justifyClass(align: "left" | "center" | "right"): string {
  if (align === "left") return "justify-start";
  if (align === "right") return "justify-end";
  return "justify-center";
}

function emailColumnCells(section: {
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
  const content = String(section.content ?? "");
  try {
    const raw = JSON.parse(content) as { a?: string; b?: string };
    return { a: String(raw.a || ""), b: String(raw.b || "") };
  } catch {
    return { a: content, b: "" };
  }
}

function EmailColumnPair({
  a,
  b,
  compact = false,
  style,
}: {
  a: string;
  b: string;
  compact?: boolean;
  style?: CSSProperties;
}) {
  const cell = (value: string) => {
    const trimmed = String(value || "").trim();
    if (isHttpImageUrl(trimmed)) {
      return (
        <img
          src={trimmed}
          alt=""
          className={
            compact
              ? "mx-auto block h-auto w-full rounded-md object-cover"
              : "mx-auto block h-auto w-full rounded-lg object-cover"
          }
        />
      );
    }
    return (
      <p style={style} className="whitespace-pre-wrap">
        {trimmed}
      </p>
    );
  };
  return (
    <div className={`grid grid-cols-2 ${compact ? "gap-2" : "gap-3"}`}>
      <div>{cell(a)}</div>
      <div>{cell(b)}</div>
    </div>
  );
}

type EmailSectionRow = NonNullable<TemplateFields["sections"]>[number];

type EmailRenderBlock =
  | { kind: "section"; section: EmailSectionRow; index: number }
  | {
      kind: "image_grid";
      cells: Array<{ section: EmailSectionRow; index: number }>;
    };

function buildEmailRenderBlocks(sections: EmailSectionRow[]): EmailRenderBlock[] {
  const blocks: EmailRenderBlock[] = [];
  let i = 0;
  while (i < sections.length) {
    const section = sections[i]!;
    if (
      String(section.type || "") === "image" &&
      emailSectionIsGridCell(section)
    ) {
      const cells: Array<{ section: EmailSectionRow; index: number }> = [];
      while (
        i < sections.length &&
        String(sections[i]?.type || "") === "image" &&
        emailSectionIsGridCell(sections[i]!)
      ) {
        cells.push({ section: sections[i]!, index: i });
        i += 1;
      }
      blocks.push({ kind: "image_grid", cells });
      continue;
    }
    blocks.push({ kind: "section", section, index: i });
    i += 1;
  }
  return blocks;
}

/** Real https for preview. Placeholders / merge tags are not clickable. */
function resolvePreviewHref(raw: string | undefined | null): string {
  const url = String(raw || "").trim();
  if (/^https?:\/\//i.test(url) && !/\{\{/.test(url)) return url;
  return "";
}

/** Panel preview omits per-recipient wt= tokens (injected at send time). */
function EmailSentTrackingNote() {
  return (
    <p className="mt-2 text-center text-[11px] text-neutral-400">
      Preview buttons use the real https link from the template. Tracking (wt=)
      is added per recipient when the email is sent.
    </p>
  );
}

function previewMergeTags(
  value: string,
  sample: { firstName?: string; company?: string; city?: string } = {},
): string {
  const first = (sample.firstName || "Alex").trim() || "there";
  const company = (sample.company || "Acme").trim();
  const city = (sample.city || "Chennai").trim();
  const map: Record<string, string> = {
    first_name: first,
    firstname: first,
    company,
    company_name: company,
    city,
    job_title: "",
    jobtitle: "",
    role: "",
    campaign_url: "",
    url: "",
  };
  return value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    const lower = String(key).toLowerCase();
    if (map[lower] != null) return map[lower];
    return "";
  });
}

function extractSubject(html: string): string | null {
  const match = html.match(/<!--\s*subject:\s*([^>]+?)\s*-->/i);
  return match?.[1]?.trim() || null;
}

function extractField(html: string, field: string): string {
  const re = new RegExp(
    `data-field=["']${field}["'][^>]*>([\\s\\S]*?)<\\/`,
    "i",
  );
  const match = html.match(re);
  return match ? stripTags(match[1]) : "";
}

function extractLinks(
  html: string,
): Array<{ label: string; href: string; external?: boolean }> {
  const links: Array<{ label: string; href: string; external?: boolean }> = [];
  const re =
    /<(?:a|button)[^>]*?(?:href=["']([^"']*)["'])?[^>]*>([\s\S]*?)<\/(?:a|button)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const label = stripTags(m[2]);
    if (!label) continue;
    const href = m[1] || "";
    const external = /visit|website|shop|learn|explore|url/i.test(label);
    links.push({ label, href, external });
  }
  return links;
}

function fieldsFromHtml(channel: string, html: string): TemplateFields {
  const plain = stripTags(html);
  if (channel === "sms") return { body: plain };
  if (channel === "whatsapp") {
    const body = extractField(html, "body") || plain;
    const links = extractLinks(html);
    return {
      body,
      footer: extractField(html, "footer") || "",
      buttons: links.map((l) => ({ label: l.label, url: l.href })),
    };
  }
  if (channel === "email") {
    return {
      subject: extractSubject(html) || "",
      greeting: "",
      paragraphs: plain.split("\n").map((l) => l.trim()).filter(Boolean),
      cta_label: extractLinks(html)[0]?.label || "",
      cta_url: extractLinks(html)[0]?.href || "",
      signoff: "",
      footer: "",
    };
  }
  if (channel === "push" || channel === "web") {
    return {
      title: extractField(html, "title") || plain.split("\n")[0] || "",
      body:
        extractField(html, "body") ||
        plain.split("\n").slice(1).join(" ").trim() ||
        "",
      cta_label: extractLinks(html)[0]?.label || "",
    };
  }
  return { body: plain };
}

export function isEmptyTemplateFields(fields?: TemplateFields | null): boolean {
  if (!fields) return true;
  return Object.values(fields).every((value) => {
    if (Array.isArray(value)) return value.length === 0;
    return String(value ?? "").trim() === "";
  });
}

function hasRenderableEmailLayout(fields?: TemplateFields | null): boolean {
  if (!fields) return false;
  const compiled = String(fields.compiled_html || fields.html || "").trim();
  if (compiled) return true;
  if (Array.isArray(fields.sections) && fields.sections.length > 0) return true;
  if (Array.isArray(fields.blocks) && fields.blocks.length > 0) return true;
  return false;
}

function resolveFields(
  channel: string,
  fields?: TemplateFields | null,
  html?: string | null,
): TemplateFields {
  const ch = (channel || "").toLowerCase();
  const preview = String(html || "").trim();
  if (ch === "email") {
    if (hasRenderableEmailLayout(fields)) return fields as TemplateFields;
    if (preview) {
      const fromHtml = fieldsFromHtml(channel, preview);
      return {
        ...(fields || {}),
        ...fromHtml,
        compiled_html:
          String((fields || {}).compiled_html || "").trim() || preview,
      };
    }
    return fields ?? {};
  }
  if (!isEmptyTemplateFields(fields)) return fields as TemplateFields;
  if (preview) return fieldsFromHtml(channel, preview);
  return fields ?? {};
}

function PhoneChrome({
  children,
  number,
  composerLabel = "iMessage",
}: {
  children: ReactNode;
  number?: string;
  composerLabel?: string;
}) {
  const headerLabel = number || "Business number";
  return (
    <div className="mx-auto w-full max-w-[280px]">
      <div className="overflow-hidden rounded-[2.1rem] border-[3px] border-neutral-900 bg-neutral-900 shadow-lg">
        <div className="bg-[#f7f7f8]">
          {/* Status bar + notch */}
          <div className="relative bg-white px-4 pt-2.5 pb-1">
            <div className="flex items-center justify-between text-[10px] font-semibold text-neutral-900">
              <span>9:41</span>
              <span className="tracking-tighter text-neutral-700">●●●</span>
            </div>
            <div className="pointer-events-none absolute top-1.5 left-1/2 h-5 w-[5.5rem] -translate-x-1/2 rounded-full bg-neutral-900" />
          </div>

          {/* Chat header */}
          <div className="flex items-center gap-2 border-b border-neutral-200 bg-white px-3 py-2">
            <span className="text-lg leading-none text-neutral-400" aria-hidden>
              ‹
            </span>
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-[10px] text-neutral-500">
              ●
            </span>
            <p className="min-w-0 flex-1 truncate text-[12px] font-medium text-neutral-800">
              {headerLabel}
            </p>
          </div>

          {children}

          {/* Composer */}
          <div className="flex items-center gap-2 border-t border-neutral-200 bg-white px-2.5 py-2">
            <span className="size-6 shrink-0 rounded-full bg-neutral-200" />
            <span className="size-6 shrink-0 rounded-full bg-neutral-200" />
            <div className="h-8 min-w-0 flex-1 rounded-full bg-neutral-100 px-3 text-[11px] leading-8 text-neutral-400">
              {composerLabel}
            </div>
            <span className="size-7 shrink-0 rounded-full bg-neutral-200" />
          </div>
        </div>
      </div>
    </div>
  );
}

function SmsPreview({ fields }: { fields: TemplateFields }) {
  const plain = String(fields.body || "").trim() || "SMS preview";
  return (
    <PhoneChrome number="Business number" composerLabel="Message">
      <div className="min-h-[240px] bg-[#f2f2f7] px-3 py-4">
        <div className="max-w-[92%] rounded-2xl rounded-bl-md bg-[#e9e9eb] px-3 py-2.5 text-[13px] leading-5 text-neutral-800 whitespace-pre-wrap">
          {plain}
        </div>
      </div>
    </PhoneChrome>
  );
}

function WhatsappPreview({ fields }: { fields: TemplateFields }) {
  // Authoring preview: show merge tags literally ({{first_name}}), not sample names.
  const header = stripTags(String(fields.header || fields.title || ""));
  const body = stripTags(String(fields.body || ""));
  const footer = stripTags(String(fields.footer || ""));
  const imageSrc = canonicalTemplateHeroUrl(fields as Record<string, unknown>);
  const buttons = (Array.isArray(fields.buttons) ? fields.buttons : []).map(
    (action) => ({
      label: stripTags(String(action.text || action.label || "")),
      url: String(action.url || "").trim(),
    }),
  );

  return (
    <PhoneChrome number="Business number" composerLabel="Message">
      <div
        className="chat-scroll-xs max-h-[min(60vh,28rem)] min-h-[260px] overflow-y-auto px-3 py-3"
        style={{
          backgroundColor: "#efeae2",
          backgroundImage:
            "radial-gradient(circle at 18% 22%, rgba(0,0,0,0.035) 1px, transparent 1px)",
          backgroundSize: "16px 16px",
        }}
      >
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          {imageSrc ? (
            <div className="px-2 pt-2">
              <img
                src={imageSrc}
                alt=""
                className="h-auto w-full rounded-xl"
              />
            </div>
          ) : null}
          <div className="space-y-2 px-3 py-3 text-[12.5px] leading-5 text-neutral-800">
            {header ? (
              <p className="font-semibold text-neutral-900">{header}</p>
            ) : null}
            {body
              ? body.split("\n").map((line, i) => (
                  <p
                    key={i}
                    className={!header && i === 0 ? "font-medium" : undefined}
                  >
                    {line}
                  </p>
                ))
              : !header ? (
                <p className="text-neutral-400">WhatsApp preview</p>
              ) : null}
            {footer ? (
              <p className="text-[11px] text-neutral-400">{footer}</p>
            ) : null}
          </div>
          {buttons.length > 0 ? (
            <div className="border-t border-neutral-100">
              {buttons.map((action, i) => {
                const href = resolvePreviewHref(action.url);
                const rowClass = `flex items-center justify-center gap-1.5 px-3 py-2.5 text-[13px] font-medium text-[#0b6bcb] ${
                  i > 0 ? "border-t border-neutral-100" : ""
                }`;
                return (
                  <a
                    key={`${action.label}-${i}`}
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className={rowClass}
                  >
                    <span>{action.label}</span>
                    <span aria-hidden className="text-[11px]">
                      ↗
                    </span>
                  </a>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </PhoneChrome>
  );
}

function isEmailVariantBlob(raw: unknown): raw is TemplateFields {
  return Boolean(raw && typeof raw === "object" && !Array.isArray(raw));
}

export function hasEmailAb(fields: TemplateFields): boolean {
  return (
    fields.ab_test === true ||
    (isEmailVariantBlob(fields.variant_a) && isEmailVariantBlob(fields.variant_b))
  );
}

function emailFieldsForPreview(
  fields: TemplateFields,
  variant: "a" | "b",
): TemplateFields {
  const nested = variant === "a" ? fields.variant_a : fields.variant_b;
  if (!isEmailVariantBlob(nested)) return fields;
  const nestedSections = Array.isArray(nested.sections) ? nested.sections : [];
  if (nestedSections.length > 0) return nested;
  const parentSections = Array.isArray(fields.sections) ? fields.sections : [];
  if (parentSections.length > 0) {
    // Thin A/B variants: keep designed layout, overlay variant subject/CTA.
    return {
      ...fields,
      ...nested,
      sections: parentSections,
      subject: String(nested.subject || fields.subject || "").trim() || fields.subject,
    };
  }
  return nested;
}

function EmailAbPreview({
  fields,
  variant: controlled,
  onVariantChange,
}: {
  fields: TemplateFields;
  variant?: "a" | "b";
  onVariantChange?: (v: "a" | "b") => void;
}) {
  const [internal, setInternal] = useState<"a" | "b">(controlled ?? "a");
  const variant = controlled ?? internal;
  const setVariant = (next: "a" | "b") => {
    if (!controlled) setInternal(next);
    onVariantChange?.(next);
  };
  const shown = emailFieldsForPreview(fields, variant);
  return (
    <div className="w-full max-w-xl">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
          A/B
        </span>
        {(["a", "b"] as const).map((letter) => {
          const active = variant === letter;
          return (
            <button
              key={letter}
              type="button"
              onClick={() => setVariant(letter)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-border-default bg-surface text-text-secondary hover:bg-subtle"
              }`}
            >
              Variant {letter.toUpperCase()}
            </button>
          );
        })}
      </div>
      <EmailPreview fields={shown} />
    </div>
  );
}

function EmailPreview({
  fields,
  compact = false,
  hideSubject = false,
}: {
  fields: TemplateFields;
  compact?: boolean;
  hideSubject?: boolean;
}) {
  const resolved = canonicalizeEmailTemplateFields(
    fields as Record<string, unknown>,
  ) as TemplateFields;
    const compiledHtml = String(
    resolved.compiled_html || resolved.html || "",
  ).trim();
  const hasHtmlTag = /<(html|body|table|div|p)\b/i.test(compiledHtml);
  if (hasHtmlTag) {
    const subject = String(resolved.subject || "").trim();
    const preheader = String(resolved.preheader || "").trim();
    return (
      <div className={compact ? "w-full" : "w-full max-w-xl"}>
        {!hideSubject && subject ? (
          <p className={`mb-3 ${compact ? "text-[10px]" : "text-sm"} text-neutral-800`}>
            <span className="font-semibold">Subject:</span> {subject}
          </p>
        ) : null}
        {!hideSubject && preheader ? (
          <p className={`-mt-2 mb-3 ${compact ? "text-[9px]" : "text-xs"} text-neutral-500`}>
            {preheader}
          </p>
        ) : null}
        <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
          <iframe
            title="Email HTML preview"
            sandbox=""
            srcDoc={previewComposeHtml(compiledHtml)}
            className="w-full bg-white"
            style={{ height: compact ? 280 : 640, border: 0 }}
          />
        </div>
        {!compact ? <EmailSentTrackingNote /> : null}
      </div>
    );
  }
  const sections = Array.isArray(resolved.sections)
    ? resolved.sections.filter((section) => section && typeof section === "object")
    : [];
  if (sections.length > 0) {
    const rawTheme =
      resolved.theme && typeof resolved.theme === "object" ? resolved.theme : {};
    const color = (value: unknown, fallback: string) =>
      /^#[0-9a-f]{3,8}$/i.test(String(value || ""))
        ? String(value)
        : fallback;
    const theme = {
      background: color(rawTheme.background, "#f4f7fb"),
      surface: color(rawTheme.surface, "#ffffff"),
      text: color(rawTheme.text, "#172033"),
      muted: color(rawTheme.muted, "#667085"),
      accent: color(rawTheme.accent, "#2563eb"),
      buttonText: color(rawTheme.button_text, "#ffffff"),
      heading: String(rawTheme.font_heading || "Arial, sans-serif"),
      body: String(rawTheme.font_body || "Arial, sans-serif"),
      alignment:
        rawTheme.alignment === "center" ? ("center" as const) : ("left" as const),
      radius: Math.min(24, Math.max(0, Number(rawTheme.button_radius) || 8)),
    };
    const subject = String(resolved.subject || "").trim();
    const preheader = String(resolved.preheader || "").trim();
    const heroSrc = emailHeroSrc(resolved);
    const shellPad = compact ? "p-2" : "p-5";
    const innerPad = compact ? "px-3 py-3" : "px-7 py-7";
    const headlineClass = compact
      ? "text-sm font-bold leading-snug"
      : "text-2xl font-bold leading-tight";
    const bodyClass = compact
      ? "whitespace-pre-wrap text-[10px] leading-4"
      : "whitespace-pre-wrap leading-6";
    return (
      <div className={compact ? "w-full" : "w-full max-w-xl"}>
        {!hideSubject && subject ? (
          <p className={`mb-3 ${compact ? "text-[10px]" : "text-sm"} text-neutral-800`}>
            <span className="font-semibold">Subject:</span> {subject}
          </p>
        ) : null}
        {!hideSubject && preheader ? (
          <p className={`-mt-2 mb-3 ${compact ? "text-[9px]" : "text-xs"} text-neutral-500`}>
            {preheader}
          </p>
        ) : null}
        <div
          className={`overflow-hidden rounded-2xl border border-neutral-200 shadow-sm ${shellPad}`}
          style={{ backgroundColor: theme.background }}
        >
          <div
            className={`mx-auto max-w-[540px] overflow-hidden rounded-xl ${innerPad}`}
            style={{
              backgroundColor: theme.surface,
              color: theme.text,
              fontFamily: theme.body,
              textAlign: theme.alignment,
            }}
          >
            <div className={compact ? "space-y-2" : "space-y-5"}>
              {buildEmailRenderBlocks(sections).map((block) => {
                if (block.kind === "image_grid") {
                  const cols =
                    block.cells.length >= 3 ? 3 : block.cells.length === 2 ? 2 : 1;
                  return (
                    <div
                      key={`grid-${block.cells[0]?.index ?? 0}`}
                      className={`grid gap-2 ${cols === 3 ? "grid-cols-3" : cols === 2 ? "grid-cols-2" : "grid-cols-1"}`}
                    >
                      {block.cells.map(({ section, index }) => {
                        const sectionSrc = String(
                          section.url || section.content || "",
                        ).trim();
                        const src = /^https?:\/\//i.test(sectionSrc)
                          ? sectionSrc
                          : heroSrc;
                        if (!src) return null;
                        return (
                          <EmailHeroImage
                            key={index}
                            src={src}
                            compact={compact}
                            variant="grid"
                          />
                        );
                      })}
                    </div>
                  );
                }
                const section = block.section;
                const index = block.index;
                const kind = String(section.type || "text");
                const content = String(section.content || "");
                const items = Array.isArray(section.items)
                  ? section.items.map(String).filter(Boolean)
                  : [];
                if (kind === "image") {
                  const sectionSrc = String(section.url || section.content || "").trim();
                  const src = /^https?:\/\//i.test(sectionSrc) ? sectionSrc : heroSrc;
                  if (!src) return null;
                  const align = sectionBoxAlign(section.align);
                  const width = sectionBoxWidth(section.width);
                  return (
                    <div key={index} className={`flex ${justifyClass(align)}`}>
                      <div style={width ? { width } : undefined} className={width ? "max-w-full" : "w-full"}>
                        <EmailHeroImage src={src} compact={compact} />
                      </div>
                    </div>
                  );
                }
                if (kind === "divider") {
                  return (
                    <hr
                      key={index}
                      style={{ borderColor: theme.muted, opacity: 0.35 }}
                    />
                  );
                }
                if (kind === "spacer") {
                  const h = Math.min(80, Math.max(8, Number(content) || 24));
                  return <div key={index} style={{ height: compact ? Math.round(h / 2) : h }} />;
                }
                if (kind === "columns") {
                  const cells = emailColumnCells(section);
                  return (
                    <EmailColumnPair
                      key={index}
                      a={cells.a}
                      b={cells.b}
                      compact={compact}
                      style={{
                        color: theme.text,
                        fontFamily: theme.body,
                        textAlign: theme.alignment,
                      }}
                    />
                  );
                }
                if (kind === "headline") {
                  return (
                    <h2
                      key={index}
                      className={headlineClass}
                      style={{ fontFamily: theme.heading, color: theme.text }}
                    >
                      {content}
                    </h2>
                  );
                }
                if (kind === "benefits" || kind === "statistics" || kind === "comparison") {
                  return (
                    <div key={index} className={`rounded-lg ${compact ? "p-2" : "p-4"}`} style={{ backgroundColor: theme.background }}>
                      {content ? <p className={`mb-2 ${compact ? "text-[10px] font-semibold" : "font-semibold"}`}>{content}</p> : null}
                      <ul className={`space-y-2 ${compact ? "text-[9px]" : ""} text-left`}>
                        {items.map((item, itemIndex) => (
                          <li key={itemIndex} className="flex gap-2">
                            <span style={{ color: theme.accent }}>●</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                }
                if (kind === "cta" || kind === "secondary_link") {
                  const label = String(section.label || content || "Learn more");
                  const href = resolvePreviewHref(String(section.url || ""));
                  const align = sectionBoxAlign(section.align);
                  const width = sectionBoxWidth(section.width);
                  const button = (
                    <span
                      className={`inline-flex font-semibold ${compact ? "px-2.5 py-1 text-[9px]" : "px-5 py-2.5 text-sm"} ${width ? "w-full justify-center" : ""}`}
                      style={{
                        color: kind === "cta" ? theme.buttonText : theme.accent,
                        backgroundColor: kind === "cta" ? theme.accent : "transparent",
                        border: `1px solid ${theme.accent}`,
                        borderRadius: theme.radius,
                      }}
                    >
                      {label}
                    </span>
                  );
                  return (
                    <div key={index} className={`flex py-1 ${justifyClass(align)}`}>
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        style={width ? { width } : undefined}
                        className={width ? "max-w-full" : undefined}
                      >
                        {button}
                      </a>
                    </div>
                  );
                }
                if (kind === "social_links") {
                  const links = Array.isArray(section.links)
                    ? section.links
                        .filter(
                          (row): row is { label?: unknown; url?: unknown } =>
                            Boolean(row) && typeof row === "object",
                        )
                        .map((row) => ({
                          label: String(row.label || "").trim(),
                          url: String(row.url || "").trim(),
                        }))
                        .filter(
                          (row) =>
                            row.label && /^https?:\/\//i.test(row.url),
                        )
                    : [];
                  if (!links.length) return null;
                  return (
                    <div
                      key={index}
                      className={`flex flex-wrap justify-center gap-3 ${compact ? "py-1 text-[9px]" : "py-2 text-sm"}`}
                    >
                      {links.map((link, linkIndex) => (
                        <a
                          key={`${link.url}-${linkIndex}`}
                          href={link.url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: theme.accent, textDecoration: "underline" }}
                        >
                          {link.label}
                        </a>
                      ))}
                    </div>
                  );
                }
                const isMuted =
                  kind === "compliance_footer" || kind === "signoff";
                const isCallout =
                  kind === "testimonial" || kind === "offer" || kind === "proof";
                return (
                  <div
                    key={index}
                    className={isCallout ? "rounded-lg border-l-4 p-4" : ""}
                    style={isCallout ? { borderColor: theme.accent, backgroundColor: theme.background } : undefined}
                  >
                    {content ? (
                      <p
                        className={bodyClass}
                        style={{ color: isMuted ? theme.muted : theme.text }}
                      >
                        {content}
                      </p>
                    ) : null}
                    {items.length ? (
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-left">
                        {items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}
                      </ul>
                    ) : null}
                  </div>
                );
              })}
              {Array.isArray(resolved.footer_links) &&
              resolved.footer_links.length
                ? (
                    <p
                      className={`flex flex-wrap justify-center gap-3 ${compact ? "pt-1 text-[9px]" : "pt-2 text-xs"}`}
                      style={{ color: theme.muted }}
                    >
                      {(resolved.footer_links as Array<{ label?: unknown; url?: unknown }>)
                        .map((row) => ({
                          label: String(row?.label || "").trim(),
                          url: String(row?.url || "").trim(),
                        }))
                        .filter((row) => row.label && /^https?:\/\//i.test(row.url))
                        .map((link, linkIndex) => (
                          <a
                            key={`${link.url}-${linkIndex}`}
                            href={link.url}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: theme.muted, textDecoration: "underline" }}
                          >
                            {link.label}
                          </a>
                        ))}
                    </p>
                  )
                : null}
            </div>
          </div>
        </div>
        {!compact ? <EmailSentTrackingNote /> : null}
      </div>
    );
  }
  const blocks = Array.isArray(resolved.blocks) ? resolved.blocks : null;
  if (
    blocks &&
    blocks.length > 0 &&
    blocks.every(
      (b) =>
        b &&
        typeof b === "object" &&
        typeof (b as { type?: unknown }).type === "string" &&
        typeof (b as { content?: unknown }).content === "string",
    )
  ) {
    const subjectBlock = blocks.find(
      (b) => (b as { type: string }).type === "subject",
    ) as { content?: string; style?: Record<string, unknown> } | undefined;
    const bodyBlocks = blocks.filter(
      (b) => (b as { type: string }).type !== "subject",
    ) as Array<{
      type: string;
      content: string;
      href?: string;
      style?: {
        fontFamily?: string;
        fontSize?: number;
        fontWeight?: string;
        color?: string;
        textAlign?: "left" | "center" | "right";
        width?: number;
      };
    }>;
    const heroSrc = emailHeroSrc(resolved);
    const hasImageBlock = bodyBlocks.some(
      (b) => b.type === "image" && String(b.content || "").trim(),
    );
    return (
      <div className="w-full max-w-xl">
        {subjectBlock?.content ? (
          <p className="mb-3 text-sm text-neutral-800">
            <span className="font-semibold">Subject:</span>{" "}
            {String(subjectBlock.content)}
          </p>
        ) : null}
        <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
          <div className="flex items-center justify-center gap-2 border-b border-neutral-100 px-6 py-5">
            <span className="inline-flex size-7 items-center justify-center rounded-full bg-neutral-900 text-[10px] text-white">
              W
            </span>
            <span className="text-base font-semibold tracking-tight text-neutral-900">
              worktual
            </span>
          </div>
        <div className="space-y-3 px-6 py-5 text-[14px] leading-6 text-neutral-700">
          {!hasImageBlock && heroSrc ? (
            <EmailHeroImage src={heroSrc} />
          ) : null}
          {bodyBlocks.length === 0 ? (
            <p className="text-neutral-400">Email preview</p>
          ) : (
            bodyBlocks.map((b, i) => {
                const style = {
                  fontFamily: b.style?.fontFamily,
                  fontSize: b.style?.fontSize
                    ? `${b.style.fontSize}px`
                    : undefined,
                  fontWeight: b.style?.fontWeight as
                    | CSSProperties["fontWeight"]
                    | undefined,
                  color: b.style?.color,
                  textAlign: b.style?.textAlign,
                };
                if (b.type === "spacer") {
                  const h = Math.min(80, Math.max(8, Number(b.content) || 24));
                  return <div key={i} style={{ height: h }} />;
                }
                if (b.type === "divider") {
                  return <hr key={i} className="border-neutral-200" />;
                }
                if (b.type === "columns") {
                  const cells = emailColumnCells({ content: b.content });
                  return (
                    <EmailColumnPair
                      key={i}
                      a={cells.a}
                      b={cells.b}
                      style={style}
                    />
                  );
                }
                if (b.type === "image" && b.content) {
                  const src = /^https?:\/\//i.test(b.content) ? b.content : heroSrc;
                  if (!src) return null;
                  const align = sectionBoxAlign(b.style?.textAlign);
                  const width = sectionBoxWidth(b.style?.width);
                  return (
                    <div key={i} className={`flex ${justifyClass(align)}`}>
                      <img
                        src={src}
                        alt=""
                        className={`block h-auto rounded-lg ${width ? "max-w-full" : "w-full"}`}
                        style={width ? { width } : undefined}
                      />
                    </div>
                  );
                }
                if (b.type === "button") {
                  const href = resolvePreviewHref(String(b.href || ""));
                  const align = sectionBoxAlign(b.style?.textAlign);
                  const width = sectionBoxWidth(b.style?.width);
                  const buttonEl = (
                    <span
                      className={`inline-flex rounded-md bg-[#2563eb] px-5 py-2.5 text-sm font-semibold text-white ${width ? "w-full justify-center" : ""}`}
                      style={style}
                    >
                      {b.content || "Button"}
                    </span>
                  );
                  return (
                    <div key={i} className={`flex py-2 ${justifyClass(align)}`}>
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        style={width ? { width } : undefined}
                        className={width ? "max-w-full" : undefined}
                      >
                        {buttonEl}
                      </a>
                    </div>
                  );
                }
                return (
                  <p key={i} style={style} className="whitespace-pre-wrap">
                    {b.content}
                  </p>
                );
              })
            )}
          </div>
        </div>
        <EmailSentTrackingNote />
      </div>
    );
  }

  const subject = String(resolved.subject || "").trim();
  const greeting = String(resolved.greeting || "").trim();
  const heroSrc = emailHeroSrc(resolved);
  const paragraphs = Array.isArray(resolved.paragraphs)
    ? resolved.paragraphs.map(String).filter(Boolean)
    : [];
  const body = String(resolved.body || "").trim();
  const cta = String(resolved.cta_label || "").trim();
  const ctaHref = resolvePreviewHref(String(resolved.cta_url || ""));
  const signoff = String(resolved.signoff || "").trim();
  const footer = String(resolved.footer || "").trim();
  const lines = [
    greeting,
    body,
    ...paragraphs,
    signoff,
  ].filter(Boolean);

  return (
    <div className="w-full max-w-xl">
      {subject ? (
        <p className="mb-3 text-sm text-neutral-800">
          <span className="font-semibold">Subject:</span> {subject}
        </p>
      ) : null}
      <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <div className="flex items-center justify-center gap-2 border-b border-neutral-100 px-6 py-5">
          <span className="inline-flex size-7 items-center justify-center rounded-full bg-neutral-900 text-[10px] text-white">
            W
          </span>
          <span className="text-base font-semibold tracking-tight text-neutral-900">
            worktual
          </span>
        </div>
        <div className="space-y-3 px-6 py-5 text-[14px] leading-6 text-neutral-700">
          {heroSrc ? <EmailHeroImage src={heroSrc} /> : null}
          {lines.length > 0 ? (
            lines.map((line, i) => <p key={i}>{line}</p>)
          ) : (
            <p className="text-neutral-400">Email preview</p>
          )}
          {cta ? (
            <div className="flex justify-center py-3">
              <a
                href={ctaHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex rounded-md bg-[#2563eb] px-5 py-2.5 text-sm font-semibold text-white"
              >
                {cta}
              </a>
            </div>
          ) : null}
          {footer ? (
            <p className="pt-2 text-center text-xs text-neutral-400">{footer}</p>
          ) : null}
        </div>
      </div>
      <EmailSentTrackingNote />
    </div>
  );
}

function WebPushPreview({ fields }: { fields: TemplateFields }) {
  return <WebPushPreviewGrid fields={fields} />;
}

function AppPushBanner({
  platform,
  text,
  cta,
}: {
  platform: "android" | "ios";
  text: string;
  cta: string;
}) {
  const isAndroid = platform === "android";
  return (
    <div
      className={`relative mx-auto w-full max-w-[260px] overflow-hidden rounded-[1.75rem] border-[3px] border-neutral-800 ${
        isAndroid
          ? "bg-gradient-to-b from-orange-300 via-rose-400 to-amber-700"
          : "bg-gradient-to-b from-indigo-400 via-fuchsia-400 to-sky-300"
      }`}
    >
      <div className="px-4 pt-3 text-center text-white">
        <p className="text-[10px] opacity-90">
          {isAndroid ? "Sun, Oct 31" : "Monday, June 3"}
        </p>
        <p className="text-4xl font-light tracking-tight">
          {isAndroid ? "12:30" : "9:41"}
        </p>
      </div>
      <div className="mx-3 mt-6 mb-16 rounded-2xl bg-white/95 p-3 shadow-lg backdrop-blur">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-[10px] text-white">
            W
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium leading-4 text-neutral-900">
              {text}
            </p>
            {cta ? (
              <p className="mt-1 text-[12px] font-medium text-[#2563eb]">{cta}</p>
            ) : null}
          </div>
          <span className="text-neutral-400">▾</span>
        </div>
      </div>
    </div>
  );
}

function AppPushPreview({ fields }: { fields: TemplateFields }) {
  const title = previewMergeTags(String(fields.title || "").trim());
  const body = previewMergeTags(String(fields.body || "").trim());
  const text = [title, body].filter(Boolean).join(" ") || "Push preview";
  const cta = previewMergeTags(String(fields.cta_label || "").trim());

  return (
    <div className="grid w-full gap-4 sm:grid-cols-2">
      <div>
        <p className="mb-2 text-center text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
          Android
        </p>
        <AppPushBanner platform="android" text={text} cta={cta} />
      </div>
      <div>
        <p className="mb-2 text-center text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
          iOS
        </p>
        <AppPushBanner platform="ios" text={text} cta={cta} />
      </div>
    </div>
  );
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v || "").trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(/[,;\n]+/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

type PpcKeywordItem = { text: string; match?: string };

function asPpcKeywords(value: unknown): PpcKeywordItem[] {
  if (!Array.isArray(value)) {
    if (typeof value === "string" && value.trim()) {
      return value
        .split(/[,;\n]+/)
        .map((v) => v.trim())
        .filter(Boolean)
        .map((text) => ({ text }));
    }
    return [];
  }
  const out: PpcKeywordItem[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) {
      out.push({ text: item.trim() });
      continue;
    }
    if (item && typeof item === "object") {
      const row = item as Record<string, unknown>;
      const text = String(row.text || row.keyword || row.query || "").trim();
      if (!text) continue;
      const match = String(row.match || row.match_type || "")
        .trim()
        .toLowerCase();
      out.push(
        match === "broad" || match === "phrase" || match === "exact"
          ? { text, match }
          : { text },
      );
    }
  }
  return out;
}

function PpcPreview({ fields }: { fields: TemplateFields }) {
  const network = String(fields.network || "meta").toLowerCase();
  const objective = String(fields.objective || "").trim();
  const campaignType = String(fields.campaign_type || "").trim();
  const creativeFormat = String(fields.creative_format || "").trim();
  const placements = asStringList(fields.placements);
  const headlines = asStringList(fields.headlines);
  const primary = String(fields.primary_text || "").trim();
  const descriptions = String(fields.descriptions || "").trim();
  const cta = String(fields.cta || "").trim();
  const landing = String(fields.landing_url || "").trim();
  const budget = String(fields.daily_budget || "").trim();
  const currency = String(fields.currency || "INR").trim();
  const geo = asStringList(fields.geo);
  const keywords = asPpcKeywords(fields.keywords);
  const audienceNotes = String(fields.audience_notes || "").trim();
  const media =
    fields.media && typeof fields.media === "object" && !Array.isArray(fields.media)
      ? (fields.media as Record<string, unknown>)
      : null;
  const mediaType = String(media?.type || creativeFormat || "").trim();
  const mediaUrl = String(media?.url || "").trim();
  const mediaAlt = String(media?.alt || "").trim();

  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-neutral-900 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
          {network === "google" ? "Google" : "Meta"} PPC
        </span>
        {objective ? (
          <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-[11px] font-medium capitalize text-neutral-600">
            {objective}
          </span>
        ) : null}
        {network === "google" && campaignType ? (
          <span className="rounded-full bg-sky-50 px-2.5 py-0.5 text-[11px] font-medium capitalize text-sky-800">
            {campaignType}
          </span>
        ) : null}
        {network === "meta" && creativeFormat ? (
          <span className="rounded-full bg-violet-50 px-2.5 py-0.5 text-[11px] font-medium capitalize text-violet-800">
            {creativeFormat}
          </span>
        ) : null}
        <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-800">
          Plan only
        </span>
      </div>

      {budget ? (
        <p className="mt-3 text-sm text-neutral-700">
          Daily budget:{" "}
          <span className="font-semibold">
            {currency} {budget}
          </span>
        </p>
      ) : null}

      {geo.length ? (
        <p className="mt-1 text-xs text-neutral-500">Geo: {geo.join(", ")}</p>
      ) : null}

      {network === "meta" && placements.length ? (
        <p className="mt-1 text-xs text-neutral-500">
          Placements:{" "}
          {placements.map((p) => p.replace(/_/g, " ")).join(" · ")}
        </p>
      ) : null}

      {network === "meta" ? (
        <div className="mt-4 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 px-3 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
            {mediaType === "video" ? "Video slot" : "Media slot"}
          </p>
          {mediaUrl ? (
            <p className="mt-1 break-all text-xs text-neutral-600">{mediaUrl}</p>
          ) : (
            <p className="mt-1 text-xs text-neutral-500">
              Placeholder only — no live Meta upload yet
              {mediaAlt ? ` · ${mediaAlt}` : ""}
            </p>
          )}
        </div>
      ) : null}

      <div className="mt-4 space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
          Headlines
        </p>
        {headlines.length ? (
          <ul className="space-y-1.5">
            {headlines.map((h) => (
              <li
                key={h}
                className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm font-medium text-neutral-900"
              >
                {h}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-neutral-400">No headlines yet</p>
        )}
      </div>

      {primary ? (
        <div className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
            Primary text
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-neutral-700">
            {primary}
          </p>
        </div>
      ) : null}

      {descriptions ? (
        <p className="mt-3 text-xs leading-5 text-neutral-500">{descriptions}</p>
      ) : null}

      {(cta || landing) && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {cta ? (
            <span className="inline-flex rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white">
              {cta}
            </span>
          ) : null}
          {landing ? (
            <span className="truncate text-[11px] text-neutral-400">
              {landing}
            </span>
          ) : null}
        </div>
      )}

      {keywords.length ? (
        <div className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
            {network === "google" ? "Keywords" : "Interest themes"}
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {keywords.map((kw) => (
              <li
                key={`${kw.text}-${kw.match || ""}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs text-neutral-700"
              >
                <span>{kw.text}</span>
                {network === "google" && kw.match ? (
                  <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-600">
                    {kw.match}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {audienceNotes ? (
        <p className="mt-3 text-xs text-neutral-500">
          Audience: {audienceNotes}
        </p>
      ) : null}
    </div>
  );
}

export function ChannelTemplatePreview({
  channel,
  fields,
  html,
  abVariant,
  onAbVariantChange,
  compact,
  hideSubject,
}: {
  channel: string;
  fields?: TemplateFields | null;
  html?: string | null;
  abVariant?: "a" | "b";
  onAbVariantChange?: (v: "a" | "b") => void;
  compact?: boolean;
  hideSubject?: boolean;
}) {
  const ch = (channel || "web").toLowerCase();
  const resolved = resolveFields(ch, fields, html);

  if (ch === "sms") return <SmsPreview fields={resolved} />;
  if (ch === "whatsapp") return <WhatsappPreview fields={resolved} />;
  if (ch === "email") {
    if (hasEmailAb(resolved)) {
      return (
        <EmailAbPreview
          fields={resolved}
          variant={abVariant}
          onVariantChange={onAbVariantChange}
        />
      );
    }
    return (
      <EmailPreview
        fields={resolved}
        compact={compact}
        hideSubject={hideSubject}
      />
    );
  }
  if (ch === "push") return <AppPushPreview fields={resolved} />;
  if (ch === "web") return <WebPushPreview fields={resolved} />;
  if (ch === "ppc") return <PpcPreview fields={resolved} />;

  return <EmailPreview fields={resolved} />;
}
