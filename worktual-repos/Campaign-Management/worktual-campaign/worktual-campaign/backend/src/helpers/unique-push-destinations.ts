/** One campaign push per device token, and one token per contact (latest first). */

export type PushDestLike = {
  contactId?: string | null;
  destination: string;
  platform?: string | null;
};

export function uniquePushDestinations<T extends PushDestLike>(dests: T[]): T[] {
  const seenDest = new Set<string>();
  const seenContact = new Set<string>();
  const out: T[] = [];
  for (const row of dests) {
    const destination = String(row.destination || "").trim();
    if (!destination) continue;
    if (seenDest.has(destination)) continue;
    const contactId = String(row.contactId || "").trim();
    if (contactId && seenContact.has(contactId)) continue;
    seenDest.add(destination);
    if (contactId) seenContact.add(contactId);
    out.push({ ...row, destination });
  }
  return out;
}
