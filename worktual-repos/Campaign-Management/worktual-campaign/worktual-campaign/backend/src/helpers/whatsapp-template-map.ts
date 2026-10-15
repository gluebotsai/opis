/**
 * Map agent-generated WhatsApp template fields → Meta / social-service payloads.
 * Agent fields: body, footer, buttons[{label,url?}]. Merge tags {{first_name}} → {{1}}.
 */

import {
  collapseDoubledCallingCode,
  greetingFirstName,
  parseAndValidatePhone,
} from "./contact-validation.js";

export type AgentWhatsAppFields = {
  body?: unknown;
  header?: unknown;
  footer?: unknown;
  buttons?: unknown;
  language?: unknown;
  category?: unknown;
  name?: unknown;
};

export type MetaBodyMapping = {
  text: string;
  /** Original merge-tag names in {{1}}, {{2}}, … order (e.g. first_name). */
  placeholders: string[];
  exampleValues: string[];
};

export type UrlButtonSendSpec = {
  /** 0-based index among URL buttons on the template. */
  index: number;
  /** Named merge tags for each {{n}} in the button URL (in order). */
  placeholderKeys: string[];
};

const PROMO_RE =
  /\b(offer|discount|sale|promo|coupon|deal|free|% off|buy now|shop now|upgrade|subscribe|renew|invite|webinar|exclusive)\b/i;
const UTILITY_INTENT_RE =
  /\b(order|delivery|shipment|tracking|parcel|appointment|reminder|account|meeting|schedule|support|assistance|status update|notification)\b/i;
const OPTOUT_RE = /\b(stop|unsubscribe|opt[\s-]?out)\b/i;
const VAR_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** Meta submit `example` values — samples only (draft copy keeps {{first_name}}, etc.). */
export function exampleValueForPlaceholder(tag: string): string {
  const key = String(tag || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  const byTag: Record<string, string> = {
    first_name: "Customer",
    firstname: "Customer",
    name: "Customer",
    company: "Acme",
    company_name: "Acme",
    city: "London",
    campaign_url: "https://example.com",
    url: "https://example.com",
    link: "https://example.com",
    product_url: "https://example.com/p",
    report_date: "19 Sep 2026",
    date: "19 Sep 2026",
    period: "19 Sep 2026",
    report_period: "19 Sep 2026",
  };
  return byTag[key] || "Sample";
}

/** Meta template names: lowercase letters, digits, underscore only. */
export function sanitizeWhatsAppTemplateName(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return cleaned.slice(0, 512) || "wa_template";
}

/** Stable unique Meta name from campaign channel template id. */
export function metaNameFromTemplateId(templateId: string): string {
  const hex = templateId.replace(/-/g, "").toLowerCase().slice(0, 24);
  return sanitizeWhatsAppTemplateName(`wa_${hex}`);
}

/**
 * Digits-only phone for social-service `to` (country code + national).
 * Fixes common double country-code mistakes (e.g. 91 + 919346765884 → 919346765884).
 */
export function phoneToWhatsAppTo(raw: string | null | undefined): string | null {
  const parsed = parseAndValidatePhone(raw);
  if (parsed.ok) {
    return parsed.e164.replace(/\D/g, "");
  }

  // Soft path for legacy bad rows that still need collapse before send.
  let digits = String(raw || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  digits = collapseDoubledCallingCode(digits);
  if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) {
    digits = `91${digits}`;
  }
  const retry = parseAndValidatePhone(digits);
  if (retry.ok) return retry.e164.replace(/\D/g, "");
  if (digits.length >= 8 && digits.length <= 15) return digits;
  return null;
}

/**
 * Meta often stores locale codes (en_US). Library rows may have short `en`.
 * Prefer the stored value; provide a single alternate for retry on language errors.
 */
export function whatsappLanguageCandidates(
  raw: string | null | undefined,
): string[] {
  const primary = String(raw || "en").trim() || "en";
  const alts: string[] = [primary];
  const lower = primary.toLowerCase();
  if (lower === "en") alts.push("en_US");
  else if (lower === "en_us") alts.push("en");
  else if (/^[a-z]{2}$/i.test(primary)) {
    alts.push(`${primary.toLowerCase()}_${primary.toUpperCase()}`);
  }
  return [...new Set(alts)];
}

/** Meta submit/send body must be plain text — never HTML. */
export function stripHtmlToPlain(raw: string | null | undefined): string {
  if (!raw) return "";
  return String(raw)
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Convert agent merge tags to Meta {{n}} and collect example values for submit.
 */
export function mapBodyForMeta(bodyRaw: string): MetaBodyMapping {
  const placeholders: string[] = [];
  const text = bodyRaw.replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (_m, tag: string) => {
      const key = String(tag || "").trim().toLowerCase();
      placeholders.push(key);
      return `{{${placeholders.length}}}`;
    },
  );
  const exampleValues = placeholders.map((p) => exampleValueForPlaceholder(p));
  return { text: text.trim(), placeholders, exampleValues };
}

/** Map merge tags inside a URL button to Meta {{n}} + optional example suffix list. */
export function mapUrlButtonForMeta(rawUrl: string): {
  url: string;
  example?: string[];
  placeholderKeys: string[];
} {
  const url = String(rawUrl || "").trim();
  if (!url) return { url: "", placeholderKeys: [] };
  if (!/\{\{/.test(url)) return { url, placeholderKeys: [] };

  const placeholderKeys: string[] = [];
  const exampleParts: string[] = [];
  const mapped = url.replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (_m, tag: string) => {
      const key = String(tag || "").trim().toLowerCase();
      placeholderKeys.push(key);
      exampleParts.push(exampleValueForPlaceholder(key));
      return `{{${placeholderKeys.length}}}`;
    },
  );

  if (/^\{\{1\}\}$/.test(mapped) && placeholderKeys.length === 1) {
    return {
      url: "https://example.com/{{1}}",
      example: [exampleParts[0] || "https://example.com"],
      placeholderKeys,
    };
  }

  return {
    url: mapped,
    ...(exampleParts.length ? { example: exampleParts } : {}),
    placeholderKeys,
  };
}

function metaSubmitButtonsFromDraft(
  buttons: Array<{
    label: string;
    url?: string;
    phone_number?: string;
    type?: "URL" | "QUICK_REPLY" | "PHONE_NUMBER";
  }>,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const b of buttons.slice(0, 3)) {
    if (b.type === "PHONE_NUMBER" || b.phone_number) continue;
    const url = String(b.url || "").trim();
    if (b.type === "QUICK_REPLY" || (!url && b.type !== "URL")) {
      out.push({ type: "QUICK_REPLY", text: b.label });
      continue;
    }
    if (!url && b.type === "URL") continue;
    if (url) {
      const mapped = mapUrlButtonForMeta(url);
      if (!mapped.url) continue;
      out.push({
        type: "URL",
        text: b.label,
        url: mapped.url,
        ...(mapped.example ? { example: mapped.example } : {}),
      });
    }
  }
  return out;
}

function sanitizeStoredSubmitComponents(
  components: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const item of components) {
    const type = String(item.type || "")
      .trim()
      .toUpperCase();
    if (type === "BUTTONS" && Array.isArray(item.buttons)) {
      const metaButtons: Array<Record<string, unknown>> = [];
      for (const raw of item.buttons.slice(0, 3)) {
        if (!raw || typeof raw !== "object") continue;
        const b = raw as Record<string, unknown>;
        const bType = String(b.type || "").toUpperCase();
        const text = stripHtmlToPlain(String(b.text || b.label || "")).slice(
          0,
          25,
        );
        if (!text) continue;
        if (bType === "QUICK_REPLY") {
          metaButtons.push({ type: "QUICK_REPLY", text });
          continue;
        }
        const url = String(b.url || "").trim();
        if (url) {
          const mapped = mapUrlButtonForMeta(url);
          if (mapped.url) {
            metaButtons.push({
              type: "URL",
              text,
              url: mapped.url,
              ...(mapped.example ? { example: mapped.example } : {}),
            });
          }
        }
      }
      if (!metaButtons.length) continue;
      out.push({ ...item, type: "BUTTONS", buttons: metaButtons });
      continue;
    }
    out.push(item);
  }
  return out;
}

/** Ensure BODY/HEADER TEXT rows include Meta `example` when {{n}} present. */
export function enrichSubmitComponentsWithExamples(
  components: Array<Record<string, unknown>>,
  draftBody: string,
  draftHeader?: string,
): Array<Record<string, unknown>> {
  const bodyMapped = mapBodyForMeta(draftBody);
  const headerMapped = draftHeader ? mapBodyForMeta(draftHeader) : null;

  return components.map((item) => {
    const type = String(item.type || "")
      .trim()
      .toUpperCase();
    const row = { ...item };
    if (type === "BODY" && typeof row.text === "string") {
      if (/\{\{\d+\}\}/.test(row.text) && !row.example) {
        if (bodyMapped.exampleValues.length) {
          row.example = { body_text: [bodyMapped.exampleValues] };
        }
      }
    }
    if (
      type === "HEADER" &&
      String(row.format || "TEXT").toUpperCase() === "TEXT" &&
      typeof row.text === "string"
    ) {
      if (/\{\{\d+\}\}/.test(row.text) && !row.example && headerMapped) {
        if (headerMapped.exampleValues.length) {
          row.example = { header_text: headerMapped.exampleValues };
        }
      }
    }
    if (type === "BUTTONS" && Array.isArray(row.buttons)) {
      row.buttons = row.buttons.map((raw) => {
        if (!raw || typeof raw !== "object") return raw;
        const b = { ...(raw as Record<string, unknown>) };
        const bType = String(b.type || "").toUpperCase();
        if (bType !== "URL") return b;
        const url = String(b.url || "");
        if (/\{\{\d+\}\}/.test(url) && !b.example) {
          const mapped = mapUrlButtonForMeta(
            url.replace(/\{\{(\d+)\}\}/g, (_m, n) => {
              const idx = Number(n) - 1;
              const key = bodyMapped.placeholders[idx] || "url";
              return `{{${key}}}`;
            }),
          );
          if (mapped.example) b.example = mapped.example;
        }
        return b;
      });
    }
    return row;
  });
}

/** URL buttons with {{n}} vars — used at send time (lowercase `button` components). */
export function urlButtonSendSpecsFromComponents(
  components: Array<Record<string, unknown>> | null | undefined,
  bodyPlaceholderKeys: string[],
): UrlButtonSendSpec[] {
  if (!components?.length) return [];
  const specs: UrlButtonSendSpec[] = [];
  let urlIndex = 0;
  for (const item of components) {
    if (String(item.type || "").toUpperCase() !== "BUTTONS") continue;
    const buttons = item.buttons;
    if (!Array.isArray(buttons)) continue;
    for (const raw of buttons) {
      if (!raw || typeof raw !== "object") continue;
      const b = raw as Record<string, unknown>;
      if (String(b.type || "").toUpperCase() !== "URL") continue;
      const url = String(b.url || "");
      if (!/\{\{\d+\}\}/.test(url)) {
        urlIndex += 1;
        continue;
      }
      const keys: string[] = [];
      url.replace(/\{\{(\d+)\}\}/g, (_m, n) => {
        const idx = Number(n) - 1;
        keys.push(bodyPlaceholderKeys[idx] || `var_${n}`);
        return "";
      });
      if (keys.length) {
        specs.push({ index: urlIndex, placeholderKeys: keys });
      }
      urlIndex += 1;
    }
  }
  return specs;
}

function buttonLinesFromFields(buttons: unknown): Array<{
  label: string;
  url?: string;
  phone_number?: string;
  type?: "URL" | "QUICK_REPLY" | "PHONE_NUMBER";
}> {
  if (typeof buttons === "string") {
    return [];
  }
  if (!Array.isArray(buttons)) return [];
  const out: Array<{
    label: string;
    url?: string;
    phone_number?: string;
    type?: "URL" | "QUICK_REPLY" | "PHONE_NUMBER";
  }> = [];
  for (const item of buttons.slice(0, 3)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const label = stripHtmlToPlain(String(row.text || row.label || "")).slice(
      0,
      25,
    );
    if (!label) continue;
    const url = String(row.url || row.href || "").trim();
    const phone = String(row.phone_number || row.phone || "").replace(
      /\D/g,
      "",
    );
    const typeRaw = String(row.type || "")
      .trim()
      .toUpperCase();
    if (typeRaw === "PHONE_NUMBER" || typeRaw === "PHONE" || phone) {
      if (phone.length >= 8) {
        out.push({ label, phone_number: phone, type: "PHONE_NUMBER" });
      }
      continue;
    }
    if (url || typeRaw === "URL") {
      out.push({ label, url, type: "URL" });
    } else {
      out.push({ label, type: "QUICK_REPLY" });
    }
  }
  return out;
}

export function extractAgentWhatsAppFields(
  fields: Record<string, unknown> | null | undefined,
): {
  header: string;
  body: string;
  footer: string;
  buttons: Array<{
    label: string;
    url?: string;
    phone_number?: string;
    type?: "URL" | "QUICK_REPLY" | "PHONE_NUMBER";
  }>;
  language: string;
  category: string;
} {
  const f = fields || {};
  return {
    header: stripHtmlToPlain(String(f.header || "")),
    body: stripHtmlToPlain(String(f.body || "")),
    footer: stripHtmlToPlain(String(f.footer || "")),
    buttons: buttonLinesFromFields(f.buttons),
    language: String(f.language || "en").trim() || "en",
    category: String(f.category || "MARKETING").trim().toUpperCase() || "MARKETING",
  };
}

function readStoredMetaComponents(
  fields: Record<string, unknown> | null | undefined,
): Array<Record<string, unknown>> | null {
  const raw = fields?.components;
  if (!Array.isArray(raw) || !raw.length) return null;
  const out: Array<Record<string, unknown>> = [];
  let hasBody = false;
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = { ...(item as Record<string, unknown>) };
    const type = String(row.type || "")
      .trim()
      .toUpperCase();
    if (!type) continue;
    row.type = type;
    if (typeof row.text === "string") {
      row.text = stripHtmlToPlain(row.text);
    }
    if (type === "BODY") hasBody = true;
    out.push(row);
  }
  if (!hasBody) return null;
  return sanitizeStoredSubmitComponents(out);
}

function inferWhatsAppCategory(
  body: string,
  goal?: string,
  objective?: string,
): "MARKETING" | "UTILITY" {
  if (PROMO_RE.test(body)) return "MARKETING";
  const blob = `${body} ${goal || ""} ${objective || ""}`;
  if (UTILITY_INTENT_RE.test(blob) && !PROMO_RE.test(body)) return "UTILITY";
  return "MARKETING";
}

/** Booxoo WABA: BODY variables often → REJECTED; static copy → PENDING. */
function approvalFirstStaticBody(body: string): string {
  let t = stripHtmlToPlain(body).trim();
  if (!VAR_RE.test(t)) return t.slice(0, 1024);
  t = t.replace(VAR_RE, "");
  t = t.replace(/^(hi|hey|hello|dear)\s*,?\s*\n+/gim, "");
  t = t.replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ");
  if (t.length < 80) {
    t = `${t} Please contact our support team if you need any help.`.trim();
  }
  return t.slice(0, 1024);
}

function ensureMarketingOptOutFooter(
  footer: string,
  category: string,
): string {
  if (category !== "MARKETING") return footer.slice(0, 60);
  const foot = stripHtmlToPlain(footer).trim();
  if (OPTOUT_RE.test(foot)) return foot.slice(0, 60);
  if (!foot) return "Reply STOP to opt out".slice(0, 60);
  return `${foot}. Reply STOP to opt out.`.slice(0, 60);
}

/** Align draft fields with Meta approval-first rules (mirrors Python sanitize). */
export function normalizeWhatsAppDraftForMetaSubmit(
  fields: Record<string, unknown> | null | undefined,
  ctx?: { goal?: string; objective?: string },
): Record<string, unknown> {
  const out = { ...(fields || {}) };
  const body = approvalFirstStaticBody(String(out.body || ""));
  out.body = body;
  let cat = String(out.category || "")
    .trim()
    .toUpperCase();
  if (cat !== "MARKETING" && cat !== "UTILITY") {
    cat = inferWhatsAppCategory(body, ctx?.goal, ctx?.objective);
  } else if (cat === "MARKETING" && !PROMO_RE.test(body)) {
    const inferred = inferWhatsAppCategory(body, ctx?.goal, ctx?.objective);
    if (inferred === "UTILITY") cat = "UTILITY";
  }
  if (cat === "UTILITY" && PROMO_RE.test(body)) cat = "MARKETING";
  out.category = cat;

  const hf = String(out.header_format || "NONE").trim().toUpperCase();
  const header = stripHtmlToPlain(String(out.header || ""));
  if (hf === "TEXT" && !String(out.header_media_handle || "").trim()) {
    if (cat === "UTILITY" || (header && (VAR_RE.test(body) || VAR_RE.test(header)))) {
      out.header = "";
      out.header_format = "NONE";
    }
  }

  let footer = stripHtmlToPlain(String(out.footer || "")).replace(VAR_RE, "");
  footer = ensureMarketingOptOutFooter(footer, cat);
  out.footer = footer;
  return out;
}

/** Components for POST submit-approval (Meta create template). */
export function buildSubmitComponentsFromAgentFields(
  fields: Record<string, unknown> | null | undefined,
  ctx?: { goal?: string; objective?: string },
): {
  components: Array<Record<string, unknown>>;
  bodyPlaceholders: string[];
  language: string;
  category: string;
  body: string;
  urlButtonSendSpecs: UrlButtonSendSpec[];
} {
  const normalized = normalizeWhatsAppDraftForMetaSubmit(fields, ctx);
  const extracted = extractAgentWhatsAppFields(normalized);
  if (!extracted.body) {
    throw new Error("WhatsApp template body is empty.");
  }

  const mapped = mapBodyForMeta(extracted.body);

  // Always rebuild from draft body/header/buttons so edits cannot submit stale components[].
  const components: Array<Record<string, unknown>> = [];
  const rawFields = fields || {};

  const headerFormat = String(rawFields.header_format || "")
    .trim()
    .toUpperCase();
  const headerMediaHandle = String(rawFields.header_media_handle || "").trim();
  if (headerFormat === "IMAGE" && headerMediaHandle) {
    components.push({
      type: "HEADER",
      format: "IMAGE",
      example: { header_handle: [headerMediaHandle] },
    });
  } else if (extracted.header) {
    const headerMapped = mapBodyForMeta(extracted.header);
    const headerComp: Record<string, unknown> = {
      type: "HEADER",
      format: "TEXT",
      text: headerMapped.text,
    };
    if (headerMapped.exampleValues.length) {
      headerComp.example = { header_text: headerMapped.exampleValues };
    }
    components.push(headerComp);
  }

  const bodyComp: Record<string, unknown> = {
    type: "BODY",
    text: mapped.text,
  };
  if (mapped.exampleValues.length) {
    bodyComp.example = { body_text: [mapped.exampleValues] };
  }
  components.push(bodyComp);

  if (extracted.footer) {
    components.push({
      type: "FOOTER",
      text: extracted.footer.slice(0, 60),
    });
  }

  const submitButtons = metaSubmitButtonsFromDraft(extracted.buttons);
  if (submitButtons.length) {
    components.push({
      type: "BUTTONS",
      buttons: submitButtons,
    });
  }

  const category =
    extracted.category === "UTILITY" ||
    extracted.category === "AUTHENTICATION"
      ? extracted.category
      : "MARKETING";

  return {
    components,
    bodyPlaceholders: mapped.placeholders,
    language: extracted.language,
    category,
    body: mapped.text,
    urlButtonSendSpecs: urlButtonSendSpecsFromComponents(
      components,
      mapped.placeholders,
    ),
  };
}

function resolvePlaceholderValue(
  key: string,
  merge: {
    firstName?: string;
    company?: string;
    city?: string;
    campaignUrl?: string;
    map?: Record<string, string>;
  },
): string {
  const flat = merge.map || {};
  if (flat[key] != null && String(flat[key]).trim() !== "") {
    return String(flat[key]).trim();
  }
  if (key === "first_name" || key === "firstname" || key === "name") {
    return greetingFirstName(
      flat.first_name?.trim() || merge.firstName?.trim() || "",
    );
  }
  if (key === "company" || key === "company_name") {
    return flat.company?.trim() || merge.company?.trim() || "your team";
  }
  if (key === "city") return flat.city?.trim() || merge.city?.trim() || "";
  if (
    key === "campaign_url" ||
    key === "url" ||
    key === "link" ||
    key === "product_url"
  ) {
    return (
      flat.campaign_url?.trim() ||
      flat.product_url?.trim() ||
      merge.campaignUrl?.trim() ||
      "https://example.com"
    );
  }
  if (key === "report_date" || key === "date" || key === "period") {
    return flat[key]?.trim() || new Date().toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }
  if (flat[key] != null) return String(flat[key]);
  return greetingFirstName(
    merge.firstName?.trim() || flat.first_name?.trim() || "",
  );
}

/** Resolve ordered body param strings for send API from contact merge fields. */
export function bodyParamsForPlaceholders(
  placeholders: string[],
  merge: {
    firstName?: string;
    company?: string;
    city?: string;
    campaignUrl?: string;
    map?: Record<string, string>;
  },
): string[] | undefined {
  if (!placeholders.length) return undefined;
  return placeholders.map((p) =>
    resolvePlaceholderValue(String(p || "").trim().toLowerCase(), merge),
  );
}

export function buildSendBodyComponents(bodyParams?: string[]) {
  if (!bodyParams?.length) return undefined;
  return [
    {
      type: "body",
      parameters: bodyParams.map((text) => ({ type: "text", text })),
    },
  ];
}

/** Send API components: body + dynamic URL buttons (Meta lowercase types). */
export function buildSendTemplateComponents(args: {
  bodyPlaceholders: string[];
  urlButtonSendSpecs?: UrlButtonSendSpec[];
  merge: {
    firstName?: string;
    company?: string;
    city?: string;
    campaignUrl?: string;
    map?: Record<string, string>;
  };
}): Array<Record<string, unknown>> | undefined {
  const bodyParams = bodyParamsForPlaceholders(args.bodyPlaceholders, args.merge);
  const parts: Array<Record<string, unknown>> = [];
  if (bodyParams?.length) {
    parts.push({
      type: "body",
      parameters: bodyParams.map((text) => ({ type: "text", text })),
    });
  }
  for (const spec of args.urlButtonSendSpecs || []) {
    const texts = spec.placeholderKeys.map((k) =>
      resolvePlaceholderValue(k, args.merge),
    );
    if (!texts.length) continue;
    parts.push({
      type: "button",
      sub_type: "url",
      index: String(spec.index),
      parameters: texts.map((text) => ({ type: "text", text })),
    });
  }
  return parts.length ? parts : undefined;
}
