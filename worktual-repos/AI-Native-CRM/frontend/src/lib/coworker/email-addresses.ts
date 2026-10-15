const EMAIL_ADDRESS = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** Real email addresses only. Surrounding words are not part of the address. */
export function emailAddresses(value: unknown): string[] {
  const chunks = Array.isArray(value) ? value : [value];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const chunk of chunks) {
    const text = String(chunk ?? "");
    for (const match of text.matchAll(EMAIL_ADDRESS)) {
      const email = match[0];
      const key = email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(email);
    }
  }
  return out;
}
