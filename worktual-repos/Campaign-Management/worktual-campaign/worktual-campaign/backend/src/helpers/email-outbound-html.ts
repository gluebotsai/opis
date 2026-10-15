/**
 * Outbound compose HTML — strip editor/preview artifacts before persist and send.
 * Must stay aligned with frontend sanitizeCompiledHtmlForStorageAndSend.
 */

const UNSUB_MERGE = "{{unsubscribe_url}}";
const PREVIEW_UNSUB = "#unsubscribe";

function fixInvalidCssSlashComments(css: string): string {
  const raw = String(css || "");
  if (!/;\s+\/\s*[^/\s*]/.test(raw)) return raw;
  return raw.replace(
    /;\s+\/\s*([^/*\n][^/\n]*?)\s*\/(?!\/)/g,
    "; /* $1 */",
  );
}

export function sanitizeInvalidCssSlashComments(html: string): string {
  return html.replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, (_m, attrs, css) => {
    const fixed = fixInvalidCssSlashComments(String(css));
    return `<style${attrs}>${fixed}</style>`;
  });
}

/** Remove preview/editor-only markup; normalize unsubscribe merge tag. */
export function sanitizeCompiledHtmlForStorageAndSend(html: string): string {
  let out = String(html || "").trim();
  if (!out) return out;

  out = out.replace(/<base\b[^>]*>/gi, "");
  out = out.replace(/\scontenteditable\s*=\s*(["']?)true\1/gi, "");
  out = out.replace(/\scontenteditable(?=[\s/>])/gi, "");
  out = out.replace(/\sdesignmode\s*=\s*(["'])[^"']*\1/gi, "");
  out = out.replace(/\sspellcheck\s*=\s*(["']?)false\1/gi, "");

  out = out.replace(
    /href\s*=\s*(["'])#unsubscribe\1/gi,
    `href=$1${UNSUB_MERGE}$1`,
  );
  out = out.replace(
    /href\s*=\s*(["'])[^"']*#unsubscribe[^"']*\1/gi,
    `href=$1${UNSUB_MERGE}$1`,
  );

  out = sanitizeInvalidCssSlashComments(out);

  return out.trim();
}

export function sanitizeEmailTemplateFields(
  fields: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    return {};
  }
  const out: Record<string, unknown> = { ...fields };
  for (const key of ["compiled_html", "html"] as const) {
    const raw = out[key];
    if (typeof raw === "string" && raw.trim()) {
      out[key] = sanitizeCompiledHtmlForStorageAndSend(raw);
    }
  }
  for (const key of ["variant_a", "variant_b"] as const) {
    const variant = out[key];
    if (variant && typeof variant === "object" && !Array.isArray(variant)) {
      out[key] = sanitizeEmailTemplateFields(
        variant as Record<string, unknown>,
      );
    }
  }
  return out;
}

export function compiledHtmlHasEditorArtifacts(html: string): boolean {
  const s = String(html || "");
  return (
    /<base\b/i.test(s) ||
    /\scontenteditable\s*=\s*["']?true/i.test(s) ||
    /\sdesignmode\s*=/i.test(s)
  );
}
