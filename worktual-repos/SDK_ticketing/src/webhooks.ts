import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify `X-Worktual-Signature: sha256=<hex>` from the ticket event outbox.
 * Pass the raw request body string (exact bytes used when signing).
 */
export function verifyWorktualSignature(
  rawBody: string | Buffer,
  signatureHeader: string | null | undefined,
  secret: string
): boolean {
  const secretStr = String(secret || "").trim();
  const header = String(signatureHeader || "").trim();
  if (!secretStr || !header) return false;

  const expectedHex = createHmac("sha256", secretStr)
    .update(rawBody)
    .digest("hex");
  const expected = `sha256=${expectedHex}`;

  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Build the signature header value the API would send for a given body. */
export function signWorktualPayload(
  rawBody: string | Buffer,
  secret: string
): string {
  const hex = createHmac("sha256", String(secret))
    .update(rawBody)
    .digest("hex");
  return `sha256=${hex}`;
}
