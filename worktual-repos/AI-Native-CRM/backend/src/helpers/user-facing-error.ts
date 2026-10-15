/**
 * Map thrown errors to short messages safe for chat / forms.
 * Never forward raw Postgres / Prisma internals to the UI.
 */

const SQL_INTERNAL_RE =
  /\b(violates\s+(not-null|unique|foreign key|check)\s+constraint|null value in column|relation\s+"|duplicate key value|prisma\.|SQLSTATE|ECONNREFUSED)\b/i;

export function userFacingCommandError(
  err: unknown,
  fallback: string,
): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const message = raw.trim();
  if (!message) return fallback;

  const lower = message.toLowerCase();
  if (lower.includes("unique") && (lower.includes("email") || lower.includes("identity"))) {
    return "A contact with this email or phone already exists.";
  }
  if (lower.includes("unique") && lower.includes("name")) {
    return "A record with this name already exists.";
  }
  if (SQL_INTERNAL_RE.test(message) || lower.includes("cdp_id")) {
    return fallback;
  }
  // Keep short product messages we threw on purpose.
  if (message.length <= 160 && !/[`"{}]/.test(message) && !message.includes("\n")) {
    return message;
  }
  return fallback;
}
