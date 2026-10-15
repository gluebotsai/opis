/** True when a value is a database id or a long bare number, not a name. */
export function looksLikeBareId(value: string | null | undefined): boolean {
  const text = (value || "").trim();
  if (!text) return false;
  if (/^\d{6,}$/.test(text)) return true;
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)
  ) {
    return true;
  }
  if (/^c[a-z0-9]{24}$/i.test(text)) return true;
  return false;
}

export function humanLabel(value: string | null | undefined): string | null {
  const text = (value || "").trim();
  if (!text || looksLikeBareId(text)) return null;
  return text;
}
