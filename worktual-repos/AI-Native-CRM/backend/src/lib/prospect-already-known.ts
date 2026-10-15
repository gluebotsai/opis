/** Identity keys so a new prospect pull does not offer the same person again. */

export function normalizeProspectToken(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function zoominfoIdOf(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const id = (payload as { zoominfoId?: unknown }).zoominfoId;
  if (typeof id === "string" && id.trim()) return id.trim();
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  return null;
}

export function prospectIdentityKeys(input: {
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  providerPayload?: unknown;
}): string[] {
  const keys: string[] = [];
  const email = normalizeProspectToken(input.email);
  if (email.includes("@")) keys.push(`e:${email}`);
  const zoominfoId = zoominfoIdOf(input.providerPayload);
  if (zoominfoId) keys.push(`zi:${zoominfoId}`);
  const first = normalizeProspectToken(input.firstName);
  const last = normalizeProspectToken(input.lastName);
  const company = normalizeProspectToken(input.companyName);
  if (first && last && company) keys.push(`n:${first}|${last}|${company}`);
  return keys;
}

export function sharesProspectIdentity(
  candidate: {
    email?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    companyName?: string | null;
    providerPayload?: unknown;
  },
  known: Set<string>,
): boolean {
  return prospectIdentityKeys(candidate).some((key) => known.has(key));
}

export function rememberProspectIdentity(
  candidate: {
    email?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    companyName?: string | null;
    providerPayload?: unknown;
  },
  known: Set<string>,
): void {
  for (const key of prospectIdentityKeys(candidate)) known.add(key);
}

/**
 * Same email, or the same full name when the companies do not disagree.
 * Two people who share a name at different companies stay distinct.
 */
export function crmNameIsSamePerson(input: {
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  email?: string | null;
  matchName?: string | null;
  matchCompany?: string | null;
  matchEmail?: string | null;
}): boolean {
  const email = normalizeProspectToken(input.email);
  const matchEmail = normalizeProspectToken(input.matchEmail);
  if (email.includes("@") && email === matchEmail) return true;
  const name = `${normalizeProspectToken(input.firstName)} ${normalizeProspectToken(input.lastName)}`.trim();
  const matchName = normalizeProspectToken(input.matchName);
  if (!name || name !== matchName) return false;
  const company = normalizeProspectToken(input.companyName);
  const matchCompany = normalizeProspectToken(input.matchCompany);
  if (company && matchCompany && company !== matchCompany) return false;
  return true;
}
