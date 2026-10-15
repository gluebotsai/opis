import {
  greetingFirstName,
  titleCasePersonName,
} from "./contact-validation.js";
import {
  canonicalizeEmailTemplateFields,
  compiledHtmlIsMeaningful,
  isHttpImageUrl,
} from "./email-template-canonical.js";
import { publicizeHtmlMediaUrls, publicizeMediaUrl } from "./media-public-url.js";
import { sanitizeCompiledHtmlForStorageAndSend } from "./email-outbound-html.js";

/** Build a simple HTML email body from structured template fields. */
export function renderCampaignEmail(fields: Record<string, unknown>): {
  subject: string;
  html: string;
  text: string;
} {
  const canonical = canonicalizeEmailTemplateFields(fields);
  const subject =
    String(canonical.subject ?? "").trim() || "Campaign message";
  const compiledHtml = sanitizeCompiledHtmlForStorageAndSend(
    String(canonical.compiled_html ?? canonical.html ?? "").trim(),
  );
  if (compiledHtml && compiledHtmlIsMeaningful(compiledHtml)) {
    const text = compiledHtml
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return {
      subject,
      html: publicizeHtmlMediaUrls(compiledHtml),
      text,
    };
  }
  const greeting = String(canonical.greeting ?? "").trim();
  const paragraphs = Array.isArray(canonical.paragraphs)
    ? canonical.paragraphs.map((p) => String(p ?? "").trim()).filter(Boolean)
    : [];
  const ctaLabel = String(canonical.cta_label ?? "").trim();
  const ctaUrl = resolveCtaHref(canonical.cta_url);
  const signoff = String(canonical.signoff ?? "").trim();
  const footer = String(canonical.footer ?? "").trim();
  const headerImage = resolveHeaderImageUrl(canonical);
  const rawSections = Array.isArray(canonical.sections)
    ? canonical.sections.filter(
        (section): section is Record<string, unknown> =>
          Boolean(section && typeof section === "object" && !Array.isArray(section)),
      )
    : [];
  if (rawSections.length > 0) {
    const sections = prepareSemanticSections(rawSections, headerImage);
    return renderSemanticEmail(canonical, subject, sections, headerImage);
  }

  const parts: string[] = [];
  if (greeting) parts.push(greeting);
  parts.push(...paragraphs);
  if (ctaLabel && ctaUrl) parts.push(`${ctaLabel}: ${ctaUrl}`);
  else if (ctaLabel) parts.push(ctaLabel);
  if (signoff) parts.push(signoff);
  if (footer) parts.push(footer);
  const text = parts.join("\n\n");

  const htmlParts: string[] = [
    `<div style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">`,
  ];
  if (headerImage) {
    htmlParts.push(renderHeaderImageHtml(headerImage));
  }
  if (greeting) htmlParts.push(`<p>${escapeHtml(greeting)}</p>`);
  for (const p of paragraphs) {
    htmlParts.push(`<p>${escapeHtml(p)}</p>`);
  }
  if (ctaLabel && ctaUrl) {
    htmlParts.push(
      `<p><a href="${escapeAttr(ctaUrl)}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;text-decoration:none;border-radius:6px">${escapeHtml(ctaLabel)}</a></p>`,
    );
  } else if (ctaLabel) {
    // No destination URL — omit the button (do not invent a merge-tag href).
  }
  if (signoff) htmlParts.push(`<p>${escapeHtml(signoff)}</p>`);
  if (footer) {
    htmlParts.push(
      `<p style="margin-top:24px;font-size:12px;color:#666">${escapeHtml(footer)}</p>`,
    );
  }
  // Forced unsubscribe merge tag — filled at send with track/unsubscribe URL.
  htmlParts.push(
    `<p style="margin-top:16px;font-size:12px;color:#666"><a href="{{unsubscribe_url}}" style="color:#666;text-decoration:underline">Unsubscribe</a></p>`,
  );
  htmlParts.push(`</div>`);

  const textWithUnsub = `${text}\n\nUnsubscribe: {{unsubscribe_url}}`;

  return { subject, html: publicizeHtmlMediaUrls(htmlParts.join("\n")), text: textWithUnsub.trim() };
}

/**
 * Resolve CTA href for HTML. Real https only — never invent a landing host.
 */
function resolveCtaHref(raw: unknown): string {
  const url = String(raw ?? "").trim();
  if (!url || url.includes("{{") || url === "#" || url === "/") {
    return "";
  }
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  return "";
}

function renderSemanticEmail(
  fields: Record<string, unknown>,
  subject: string,
  sections: Record<string, unknown>[],
  headerImage = "",
): { subject: string; html: string; text: string } {
  const rawTheme =
    fields.theme && typeof fields.theme === "object" && !Array.isArray(fields.theme)
      ? (fields.theme as Record<string, unknown>)
      : {};
  const safeColor = (value: unknown, fallback: string) => {
    const text = String(value ?? "").trim();
    return /^#[0-9a-f]{3,8}$/i.test(text) ? text : fallback;
  };
  const safeFont = (value: unknown, fallback: string) => {
    const text = String(value ?? "").trim();
    return /^(Arial|Georgia|Verdana|Tahoma|Trebuchet MS|system-ui)(,\s*(sans-serif|serif))?$/i.test(text)
      ? text
      : fallback;
  };
  const theme = {
    background: safeColor(rawTheme.background, "#f4f7fb"),
    surface: safeColor(rawTheme.surface, "#ffffff"),
    text: safeColor(rawTheme.text, "#172033"),
    muted: safeColor(rawTheme.muted, "#667085"),
    accent: safeColor(rawTheme.accent, "#2563eb"),
    buttonText: safeColor(rawTheme.button_text, "#ffffff"),
    heading: safeFont(rawTheme.font_heading, "Arial, sans-serif"),
    body: safeFont(rawTheme.font_body, "Arial, sans-serif"),
    alignment: rawTheme.alignment === "center" ? "center" : "left",
    radius: Math.min(24, Math.max(0, Number(rawTheme.button_radius) || 8)),
  };

  const textParts: string[] = [];
  const body: string[] = [];
  const hasImageSection = sections.some(
    (s) => String(s.type ?? "").trim().toLowerCase() === "image" && sectionImageUrl(s),
  );
  if (headerImage && !hasImageSection) {
    body.push(renderHeaderImageHtml(headerImage));
  }
  for (const section of sections) {
    const kind = String(section.type ?? "text").trim().toLowerCase();
    const content = String(section.content ?? "").trim();
    const imageUrl = sectionImageUrl(section) || String(section.url ?? content ?? "").trim();
    const items = Array.isArray(section.items)
      ? section.items.map((item) => String(item ?? "").trim()).filter(Boolean)
      : [];
    if (kind === "divider") {
      body.push(`<hr style="border:0;border-top:1px solid ${theme.muted};opacity:.35;margin:24px 0">`);
      continue;
    }
    if (kind === "spacer") {
      const h = Math.min(80, Math.max(8, Number(content) || 24));
      body.push(`<div style="height:${h}px;line-height:${h}px;font-size:0">&nbsp;</div>`);
      continue;
    }
    if (kind === "columns") {
      const cells = parseColumnSection(section);
      body.push(renderColumnsHtml(cells.a, cells.b, theme.text));
      if (cells.a) textParts.push(cells.a);
      if (cells.b) textParts.push(cells.b);
      continue;
    }
    if (kind === "image") {
      if (imageUrl) {
        body.push(renderHeaderImageHtml(imageUrl, sectionLayout(section)));
      }
      continue;
    }
    if (content) textParts.push(content);
    if (items.length) textParts.push(items.map((item) => `• ${item}`).join("\n"));

    if (kind === "headline") {
      body.push(
        `<h1 style="margin:0 0 20px;font-family:${escapeAttr(theme.heading)};font-size:30px;line-height:1.2;color:${theme.text}">${escapeHtml(content)}</h1>`,
      );
      continue;
    }
    if (kind === "benefits" || kind === "statistics" || kind === "comparison") {
      const list = items
        .map((item) => `<li style="margin:0 0 8px">${escapeHtml(item)}</li>`)
        .join("");
      body.push(
        `<div style="margin:20px 0;padding:18px;background:${theme.background};border-radius:8px">` +
          (content ? `<p style="margin:0 0 10px;font-weight:700">${escapeHtml(content)}</p>` : "") +
          `<ul style="margin:0;padding-left:20px">${list}</ul></div>`,
      );
      continue;
    }
    if (kind === "cta" || kind === "secondary_link") {
      const label = String(section.label ?? content ?? "Learn more").trim();
      const url = resolveCtaHref(section.url);
      const layout = sectionLayout(section);
      textParts.push(`${label}: ${url}`);
      body.push(renderCtaHtml(label, url, kind === "cta", theme, layout));
      continue;
    }
    const muted = kind === "compliance_footer" || kind === "signoff";
    const callout = kind === "testimonial" || kind === "offer" || kind === "proof";
    const list = items.length
      ? `<ul style="margin:10px 0 0;padding-left:20px">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
      : "";
    body.push(
      `<div style="margin:16px 0;${callout ? `padding:16px;background:${theme.background};border-left:4px solid ${theme.accent};` : ""}">` +
        (content ? `<p style="margin:0;white-space:pre-wrap;color:${muted ? theme.muted : theme.text}">${escapeHtml(content)}</p>` : "") +
        list +
        `</div>`,
    );
  }
  const preheader = String(fields.preheader ?? "").trim();
  const unsubBlock =
    `<p style="margin:24px 0 0;font-size:12px;color:${theme.muted};text-align:center">` +
    `<a href="{{unsubscribe_url}}" style="color:${theme.muted};text-decoration:underline">Unsubscribe</a></p>`;
  const html =
    `<div style="margin:0;padding:28px;background:${theme.background};font-family:${escapeAttr(theme.body)};line-height:1.55;color:${theme.text}">` +
    (preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>` : "") +
    `<div style="max-width:600px;margin:0 auto;padding:32px;background:${theme.surface};text-align:${theme.alignment};border-radius:12px">` +
    body.join("\n") +
    unsubBlock +
    `</div></div>`;
  const textBody = [...textParts, "Unsubscribe: {{unsubscribe_url}}"].join(
    "\n\n",
  );
  return { subject, html: publicizeHtmlMediaUrls(html), text: textBody };
}

/**
 * Soft PDOA merge tags.
 * Prefer Record from resolveMergeMap (personalization service).
 * Legacy MergeTagVars still accepted for callers that only have CRM fields.
 */
export type MergeTagVars = {
  firstName?: string | null;
  company?: string | null;
  city?: string | null;
  jobTitle?: string | null;
  campaignUrl?: string | null;
  unsubscribeUrl?: string | null;
  productName?: string | null;
  productUrl?: string | null;
  productImage?: string | null;
  productPrice?: string | null;
  productId?: string | null;
};

export type MergeTagMap = Record<string, string>;

const CAMEL_LEGACY_KEYS = new Set([
  "firstName",
  "jobTitle",
  "campaignUrl",
  "unsubscribeUrl",
  "productName",
  "productUrl",
  "productImage",
  "productPrice",
  "productId",
]);

/** Normalize legacy vars or a flat map into lowercase merge keys. */
export function toMergeTagMap(vars: MergeTagVars | MergeTagMap): MergeTagMap {
  const keys = Object.keys(vars || {});
  const isCamelLegacy = keys.some((k) => CAMEL_LEGACY_KEYS.has(k));

  if (!isCamelLegacy) {
    const out: MergeTagMap = {};
    for (const [k, v] of Object.entries(vars as MergeTagMap)) {
      out[String(k).toLowerCase()] = String(v ?? "");
    }
    if (!(out.first_name || "").trim()) {
      out.first_name = "there";
    } else {
      out.first_name = greetingFirstName(out.first_name);
    }
    out.firstname = greetingFirstName(out.firstname || out.first_name);
    if (out.last_name) out.last_name = titleCasePersonName(out.last_name);
    if (out.lastname) out.lastname = titleCasePersonName(out.lastname);
    return out;
  }

  const v = vars as MergeTagVars;
  const firstName = greetingFirstName(v.firstName);
  const company = (v.company || "").trim();
  const city = (v.city || "").trim();
  const jobTitle = (v.jobTitle || "").trim();
  const campaignUrl = (v.campaignUrl || "").trim();
  const unsubscribeUrl = (v.unsubscribeUrl || "").trim();
  const productName = (v.productName || "").trim();
  const productUrl = (v.productUrl || "").trim();
  const productImage = (v.productImage || "").trim();
  const productPrice = (v.productPrice || "").trim();
  const productId = (v.productId || "").trim();
  return {
    first_name: firstName,
    firstname: firstName,
    company,
    company_name: company,
    city,
    job_title: jobTitle,
    jobtitle: jobTitle,
    role: jobTitle,
    campaign_url: campaignUrl || productUrl,
    url: campaignUrl || productUrl,
    unsubscribe_url: unsubscribeUrl,
    product_name: productName,
    product_url: productUrl,
    product_image: productImage,
    product_price: productPrice,
    product_id: productId,
  };
}

function rawFirstNameFromVars(vars: MergeTagVars | MergeTagMap): string {
  const rec = vars as Record<string, unknown>;
  const raw =
    rec.firstName ?? rec.first_name ?? rec.firstname ?? rec.FirstName ?? "";
  return String(raw ?? "").trim();
}

/** True when this recipient has a usable given name (not empty / "there"). */
export function mergeHasRealFirstName(vars: MergeTagVars | MergeTagMap): boolean {
  const t = rawFirstNameFromVars(vars);
  return Boolean(t) && t.toLowerCase() !== "there";
}

/**
 * Recipients without a first name: "Hi there," / leftover merge tags look unfinished.
 * Keep a real name when present; otherwise drop the placeholder so the line is "Hi,".
 */
export function softenNamelessGreeting(value: string): string {
  return String(value || "")
    .replace(/\b(Hi|Hello|Hey|Dear)\s+there\s*,/gi, "$1,")
    .replace(/\b(Hi|Hello|Hey|Dear)\s+there\b/gi, "$1");
}

/** Never ship unreplaced {{merge_tags}} to a mailbox. */
export function stripLeftoverMergeTags(value: string): string {
  return String(value || "").replace(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g, "");
}

function finalizePersonalizedText(
  value: string,
  vars: MergeTagVars | MergeTagMap,
): string {
  let out = replaceMergeTags(value, vars);
  if (!mergeHasRealFirstName(vars)) {
    out = softenNamelessGreeting(out);
  }
  return stripLeftoverMergeTags(out);
}

/**
 * Replace {{merge_tags}} in a string.
 * Unknown tags become empty string (same as email).
 */
export function replaceMergeTags(
  value: string,
  vars: MergeTagVars | MergeTagMap,
): string {
  const map = toMergeTagMap(vars);
  return value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    const lower = String(key).toLowerCase();
    if (map[lower] != null) return map[lower];
    return "";
  });
}

/**
 * Replace merge tags before ESP send.
 * {{first_name}} → contact first name.
 * No first name (1 of 1000 unnamed) → greeting becomes "Hi," not "{{first_name}}" / "Hi there,".
 * {{campaign_url}} → offer.product_url or default campaign URL.
 * {{product_*}} → dynamic offer fields when adapter provides them.
 */
export function personalizeEmailContent(
  input: { subject: string; html: string; text?: string },
  vars: MergeTagVars | MergeTagMap,
): { subject: string; html: string; text: string } {
  return {
    subject: finalizePersonalizedText(input.subject, vars),
    html: finalizePersonalizedText(input.html, vars),
    text: finalizePersonalizedText(input.text || "", vars),
  };
}

/** If HTML/subject still contain {{tags}}, merge them (direct mailbox / test sends). */
export function ensureOutboundEmailPersonalized(
  input: { subject: string; html: string; text?: string },
  vars: MergeTagVars | MergeTagMap = {},
): { subject: string; html: string; text: string } {
  const blob = `${input.subject || ""}\n${input.html || ""}\n${input.text || ""}`;
  if (!/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/.test(blob)) {
    return {
      subject: input.subject,
      html: input.html,
      text: input.text || "",
    };
  }
  return personalizeEmailContent(input, vars);
}

/** Push title / body / CTA — same merge tags as email. */
export function personalizePushContent(
  input: { title: string; body: string; cta_label?: string; cta_url?: string },
  vars: MergeTagVars | MergeTagMap,
): { title: string; body: string; cta_label: string; cta_url: string } {
  return {
    title: finalizePersonalizedText(input.title, vars),
    body: finalizePersonalizedText(input.body, vars),
    cta_label: finalizePersonalizedText(input.cta_label || "", vars),
    cta_url: finalizePersonalizedText(input.cta_url || "", vars),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function parseColumnSection(section: Record<string, unknown>): { a: string; b: string } {
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
  const content = String(section.content ?? "").trim();
  try {
    const raw = JSON.parse(content) as { a?: string; b?: string };
    return { a: String(raw.a || ""), b: String(raw.b || "") };
  } catch {
    return { a: content, b: "" };
  }
}

function renderColumnCellHtml(value: string, color: string): string {
  const trimmed = String(value || "").trim();
  if (isHttpImageUrl(trimmed)) {
    const url = publicizeMediaUrl(trimmed);
    return `<img src="${escapeAttr(url)}" alt="" style="max-width:100%;height:auto;display:block;border-radius:8px" />`;
  }
  return `<p style="margin:0;white-space:pre-wrap;color:${color}">${escapeHtml(trimmed)}</p>`;
}

function renderColumnsHtml(a: string, b: string, color: string): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border-collapse:collapse"><tr>` +
    `<td width="50%" valign="top" style="padding-right:8px">${renderColumnCellHtml(a, color)}</td>` +
    `<td width="50%" valign="top" style="padding-left:8px">${renderColumnCellHtml(b, color)}</td>` +
    `</tr></table>`
  );
}

function resolveHeaderImageUrl(fields: Record<string, unknown>): string {
  const flat = String(
    fields.header_image ?? fields.image_url ?? fields.image ?? "",
  ).trim();
  if (flat) return publicizeMediaUrl(flat);
  const sections = Array.isArray(fields.sections) ? fields.sections : [];
  for (const raw of sections) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const url = sectionImageUrl(raw as Record<string, unknown>);
    if (url) return publicizeMediaUrl(url);
  }
  return "";
}

function isMediaImageUrl(value: string): boolean {
  return isHttpImageUrl(value);
}

function sectionImageUrl(section: Record<string, unknown>): string {
  const kind = String(section.type ?? "").trim().toLowerCase();
  const url = String(section.url ?? "").trim();
  const content = String(section.content ?? "").trim();
  let raw = "";
  if (kind === "image") raw = url || content;
  else if (isMediaImageUrl(content)) raw = content;
  else if (isMediaImageUrl(url)) raw = url;
  return raw ? publicizeMediaUrl(raw) : "";
}

/** Normalize sections so hero URLs always render as <img>, never raw links in body text. */
function prepareSemanticSections(
  sections: Record<string, unknown>[],
  headerImage: string,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  let heroPlaced = false;
  let hero = headerImage ? publicizeMediaUrl(headerImage) : "";

  for (const raw of sections) {
    const kind = String(raw.type ?? "text").trim().toLowerCase();
    const imgUrl = sectionImageUrl(raw);
    const content = String(raw.content ?? "").trim();
    const hasItems = Array.isArray(raw.items) && raw.items.length > 0;
    const hasLabel = Boolean(String(raw.label ?? "").trim());

    if (imgUrl) {
      hero = hero || imgUrl;
    }

    // URL-only text (or mis-typed image) → image section for outbound HTML.
    if (
      imgUrl &&
      (kind === "image" ||
        (isMediaImageUrl(content) && !hasItems && !hasLabel))
    ) {
      out.push({
        ...raw,
        type: "image",
        url: imgUrl,
        content: imgUrl,
      });
      heroPlaced = true;
      continue;
    }

    out.push(raw);
  }

  if (hero && !heroPlaced && !out.some((row) => sectionImageUrl(row))) {
    const headlineIdx = out.findIndex(
      (row) => String(row.type ?? "").trim().toLowerCase() === "headline",
    );
    const insertAt = headlineIdx >= 0 ? headlineIdx + 1 : 0;
    out.splice(insertAt, 0, { type: "image", url: hero, content: hero });
  }

  return out;
}

function sectionLayout(section: Record<string, unknown>): {
  align: "left" | "center" | "right";
  width?: number;
} {
  const align = String(section.align ?? "").trim().toLowerCase();
  const width = Number(section.width);
  return {
    align: align === "left" || align === "right" ? align : "center",
    width: Number.isFinite(width) && width >= 24 && width < 100 ? Math.round(width) : undefined,
  };
}

function renderCtaHtml(
  label: string,
  url: string,
  primary: boolean,
  theme: { accent: string; buttonText: string; radius: number },
  layout: { align: "left" | "center" | "right"; width?: number },
): string {
  const widthCss = layout.width ? `width:${layout.width}%;box-sizing:border-box;text-align:center;` : "";
  return (
    `<p style="margin:22px 0;text-align:${layout.align}">` +
    `<a href="${escapeAttr(url)}" style="display:inline-block;${widthCss}padding:11px 18px;background:${primary ? theme.accent : "transparent"};color:${primary ? theme.buttonText : theme.accent};border:1px solid ${theme.accent};text-decoration:none;border-radius:${theme.radius}px;font-weight:700">${escapeHtml(label)}</a>` +
    `</p>`
  );
}

function renderHeaderImageHtml(
  url: string,
  layout?: { align?: "left" | "center" | "right"; width?: number },
): string {
  const align = layout?.align === "left" || layout?.align === "right" ? layout.align : "center";
  const widthCss = layout?.width
    ? `width:${layout.width}%;`
    : "max-width:100%;width:100%;";
  return (
    `<p style="margin:0 0 16px;text-align:${align}">` +
    `<img src="${escapeAttr(url)}" alt="" style="${widthCss}height:auto;display:inline-block;border-radius:8px" />` +
    `</p>`
  );
}

/** Ensure hero image is present in outbound HTML when template fields carry header_image. */
export function ensureHeaderImageInHtml(
  html: string,
  fields: Record<string, unknown>,
): string {
  const url = resolveHeaderImageUrl(fields);
  if (!url) return publicizeHtmlMediaUrls(html);
  if (/<img\b[^>]*\bsrc=["'][^"']*["']/i.test(html) && html.includes(url)) {
    return publicizeHtmlMediaUrls(html);
  }
  // URL leaked as plain text / autolink — replace first text occurrence with img block.
  if (html.includes(url) && !html.includes("<img")) {
    const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const textLink = new RegExp(
      `<p[^>]*>\\s*${escaped}\\s*<\\/p>`,
      "i",
    );
    const block = renderHeaderImageHtml(url);
    if (textLink.test(html)) {
      return publicizeHtmlMediaUrls(html.replace(textLink, block));
    }
  }
  const block = renderHeaderImageHtml(url);
  const divOpen = html.match(/<div[^>]*style="font-family:system-ui/i);
  if (divOpen) {
    const idx = html.indexOf(divOpen[0]) + divOpen[0].length;
    return publicizeHtmlMediaUrls(html.slice(0, idx) + block + html.slice(idx));
  }
  const bodyOpen = html.match(/<body[^>]*>/i);
  if (bodyOpen) {
    const idx = html.indexOf(bodyOpen[0]) + bodyOpen[0].length;
    return publicizeHtmlMediaUrls(html.slice(0, idx) + block + html.slice(idx));
  }
  return publicizeHtmlMediaUrls(block + html);
}
