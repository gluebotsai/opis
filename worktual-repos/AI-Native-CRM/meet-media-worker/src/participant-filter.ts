/** Customer-only filter for Meet Media participant labels. */

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function nameOverlap(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length >= 3 && y.includes(x)) return true;
  if (y.length >= 3 && x.includes(y)) return true;
  return false;
}

export function isSalesParticipant(
  speaker: string,
  salesNames: string[],
): boolean {
  if (!speaker.trim()) return false;
  if (/\b(sales|rep|host|agent|you|me|worktual)\b/i.test(speaker)) return true;
  return salesNames.some((n) => nameOverlap(speaker, n));
}

export function customerSpeakerLabel(input: {
  participantName?: string | null;
  contactName?: string | null;
}): string {
  const fromParticipant = input.participantName?.trim();
  if (fromParticipant) return fromParticipant;
  const fromContact = input.contactName?.trim();
  if (fromContact) return fromContact;
  return "Customer";
}
