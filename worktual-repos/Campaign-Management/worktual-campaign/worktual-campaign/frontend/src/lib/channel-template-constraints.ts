/** Live Manual-Edit constraints — mirror WhatsApp Meta + generate-agent limits. */

export type ConstraintIssue = {
  severity: "hard" | "soft";
  field?: string;
  message: string;
};

export type FieldLimit = {
  key: string;
  label: string;
  max: number;
  warnAt?: number;
};

const FORBIDDEN_RE =
  /https?:\/\/bit\.ly\/|https?:\/\/tinyurl\.|\b(whatsapp\.me|wa\.me)\/\+?\d{8,}|\b(viagra|casino|crypto\s*giveaway)\b|click\s+here\s+now\s+!!!/i;

const SPAMMY_RE =
  /\b(free money|act now|limited time only|click here now|winner|congratulations you won)\b/i;

const HTML_RE = /<\/?[a-z][\s\S]*>/i;

export const CHANNEL_LIMITS: Record<string, FieldLimit[]> = {
  whatsapp: [
    { key: "header", label: "Header", max: 60 },
    { key: "body", label: "Body", max: 1024, warnAt: 920 },
    { key: "footer", label: "Footer", max: 60 },
  ],
  sms: [{ key: "body", label: "Message", max: 320, warnAt: 160 }],
  push: [
    { key: "title", label: "Title", max: 50 },
    { key: "body", label: "Body", max: 120 },
  ],
  web: [
    { key: "title", label: "Title", max: 60 },
    { key: "body", label: "Body", max: 120 },
  ],
  email: [
    { key: "subject", label: "Subject", max: 120, warnAt: 90 },
  ],
};

export const WHATSAPP_BUTTON_LABEL_MAX = 25;
export const WHATSAPP_BUTTONS_MAX = 3;
export const WHATSAPP_URL_BUTTONS_MAX = 2;

export function capText(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max);
}

export function looksSpammy(text: string): boolean {
  const t = text || "";
  if (FORBIDDEN_RE.test(t) || SPAMMY_RE.test(t)) return true;
  const letters = t.replace(/[^a-zA-Z]/g, "");
  if (letters.length >= 12) {
    const caps = letters.replace(/[^A-Z]/g, "").length;
    if (caps / letters.length > 0.7) return true;
  }
  if ((t.match(/!/g) || []).length >= 4) return true;
  return false;
}

function fieldStr(fields: Record<string, unknown>, key: string): string {
  return String(fields[key] || "");
}

export function evaluateChannelConstraints(
  channel: string,
  fields: Record<string, unknown>,
): ConstraintIssue[] {
  const ch = (channel || "").toLowerCase();
  const issues: ConstraintIssue[] = [];
  const limits = CHANNEL_LIMITS[ch] || [];

  for (const lim of limits) {
    const val = fieldStr(fields, lim.key);
    if (val.length > lim.max) {
      issues.push({
        severity: "hard",
        field: lim.key,
        message: `${lim.label} max ${lim.max} characters (${val.length} now).`,
      });
    }
  }

  if (looksSpammy(fieldStr(fields, "body") + " " + fieldStr(fields, "title") + " " + fieldStr(fields, "subject") + " " + fieldStr(fields, "header"))) {
    issues.push({
      severity: "soft",
      message:
        "Copy looks spammy (caps, shorteners, or aggressive phrasing). Soften it before save.",
    });
  }

  if (ch === "whatsapp") {
    const body = fieldStr(fields, "body");
    const header = fieldStr(fields, "header");
    const footer = fieldStr(fields, "footer");
    if (HTML_RE.test(body) || HTML_RE.test(header) || HTML_RE.test(footer)) {
      issues.push({
        severity: "hard",
        message: "WhatsApp cannot contain HTML tags.",
      });
    }
    if (/\{\{/.test(footer)) {
      issues.push({
        severity: "hard",
        field: "footer",
        message: "Footer cannot contain merge tags (Meta rule).",
      });
    }
    if (/\}\}\s*\{\{/.test(body)) {
      issues.push({
        severity: "hard",
        field: "body",
        message: "Do not place two variables next to each other.",
      });
    }
    const buttons = Array.isArray(fields.buttons) ? fields.buttons : [];
    if (buttons.length > WHATSAPP_BUTTONS_MAX) {
      issues.push({
        severity: "hard",
        message: `Max ${WHATSAPP_BUTTONS_MAX} WhatsApp buttons.`,
      });
    }
    let urlCount = 0;
    buttons.forEach((raw, i) => {
      const btn = raw as { label?: string; text?: string; url?: string };
      const label = String(btn.label || btn.text || "");
      if (label.length > WHATSAPP_BUTTON_LABEL_MAX) {
        issues.push({
          severity: "hard",
          message: `Button ${i + 1} label max ${WHATSAPP_BUTTON_LABEL_MAX} characters.`,
        });
      }
      if (String(btn.url || "").trim()) urlCount += 1;
    });
    if (urlCount > WHATSAPP_URL_BUTTONS_MAX) {
      issues.push({
        severity: "hard",
        message: `Max ${WHATSAPP_URL_BUTTONS_MAX} URL buttons.`,
      });
    }
  }

  if (ch === "sms" && fieldStr(fields, "body").length > 160) {
    issues.push({
      severity: "soft",
      field: "body",
      message: "Over 160 characters — this will send as more than one SMS.",
    });
  }

  return issues;
}

export function hardIssues(issues: ConstraintIssue[]): ConstraintIssue[] {
  return issues.filter((i) => i.severity === "hard");
}

export function isLikelyLockedText(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return false;
  if (/unsubscribe|reply stop|opt out/i.test(t) && t.length < 80) return true;
  const withoutTags = t.replace(/\{\{\s*[a-z0-9_]+\s*\}\}/gi, "").trim();
  return withoutTags.length === 0 && /\{\{/.test(t);
}
