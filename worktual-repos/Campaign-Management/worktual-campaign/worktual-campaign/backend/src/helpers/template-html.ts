/**
 * Legacy HTML template previews -> structured key/value fields.
 * Only used when an agent card predates structured fields.
 */

export type TemplateFields = Record<string, unknown>;

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

function extractSubject(html: string): string {
  return html.match(/<!--\s*subject:\s*([^>]+?)\s*-->/i)?.[1]?.trim() ?? "";
}

function extractField(html: string, field: string): string {
  const match = html.match(
    new RegExp(`data-field=["']${field}["'][^>]*>([\\s\\S]*?)<\\/`, "i"),
  );
  return match ? stripTags(match[1]) : "";
}

function extractLinks(html: string): Array<{ label: string; url: string }> {
  const links: Array<{ label: string; url: string }> = [];
  const re =
    /<(?:a|button)[^>]*?(?:href=["']([^"']*)["'])?[^>]*>([\s\S]*?)<\/(?:a|button)>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const label = stripTags(match[2]);
    if (!label) continue;
    links.push({ label, url: match[1] || "" });
  }
  return links;
}

export function isEmptyFields(fields: unknown): boolean {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    return true;
  }
  return Object.values(fields as TemplateFields).every((value) => {
    if (Array.isArray(value)) return value.length === 0;
    return String(value ?? "").trim() === "";
  });
}

export function fieldsFromHtml(channel: string, html: string): TemplateFields {
  const source = String(html || "");
  if (!source.trim()) return {};
  const plain = stripTags(source);
  const links = extractLinks(source);

  if (channel === "sms") return { body: plain };

  if (channel === "whatsapp") {
    return {
      body: extractField(source, "body") || plain,
      footer: extractField(source, "footer"),
      buttons: links.slice(0, 3),
    };
  }

  if (channel === "email") {
    return {
      subject: extractSubject(source),
      greeting: "",
      paragraphs: plain
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      cta_label: links[0]?.label ?? "",
      cta_url: links[0]?.url ?? "",
      signoff: "",
      footer: "",
    };
  }

  if (channel === "push" || channel === "web") {
    return {
      title: extractField(source, "title") || plain.split("\n")[0] || "",
      body:
        extractField(source, "body") ||
        plain.split("\n").slice(1).join(" ").trim(),
      cta_label: links[0]?.label ?? "",
    };
  }

  return { body: plain };
}

/** Structured fields when present, otherwise derived from legacy HTML. */
export function resolveTemplateFields(
  channel: string,
  fields: TemplateFields | undefined,
  preview: string | null | undefined,
): TemplateFields {
  if (!isEmptyFields(fields)) return fields as TemplateFields;
  if (preview) return fieldsFromHtml(channel, preview);
  return fields ?? {};
}

function isGreetingOnly(text: string): boolean {
  const cleaned = String(text || "").trim();
  if (!cleaned) return true;
  const lines = cleaned
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length !== 1) return false;
  return /^(hi|hello|hey)\b[\s\S]{0,50}$/i.test(lines[0]);
}

/** Reject thin / greeting-only bodies for channels that need real copy. */
export function fieldsPassQuality(
  channel: string,
  fields: TemplateFields,
): boolean {
  const ch = channel.toLowerCase();
  if (ch === "whatsapp") {
    const body = String(fields.body || "");
    return body.length >= 80 && !isGreetingOnly(body);
  }
  if (ch === "sms") {
    const body = String(fields.body || "");
    return body.length >= 40 && !isGreetingOnly(body);
  }
  if (ch === "email") {
    // Phase 2 compose: full HTML email (no sections/paragraphs).
    // Subject may be filled later from campaign name / HTML; do not
    // silently drop a real compiled body.
    const compiled = String(
      fields.compiled_html ?? fields.html ?? "",
    ).trim();
    if (compiled.length >= 40) {
      return true;
    }
    const sections = Array.isArray(fields.sections) ? fields.sections : [];
    if (sections.length > 0) {
      const meaningful = sections.filter(
        (section) =>
          section &&
          typeof section === "object" &&
          (String((section as Record<string, unknown>).content || "").trim() ||
            Array.isArray((section as Record<string, unknown>).items) ||
            String((section as Record<string, unknown>).label || "").trim() ||
            (section as Record<string, unknown>).type === "divider"),
      );
      return Boolean(String(fields.subject || "").trim()) && meaningful.length >= 3;
    }
    return false;
  }
  if (ch === "push" || ch === "web") {
    return (
      Boolean(String(fields.title || "").trim()) &&
      String(fields.body || "").trim().length >= 12
    );
  }
  return !isEmptyFields(fields);
}
