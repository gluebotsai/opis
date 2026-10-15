/**
 * CAN-SPAM-style postal line on campaign HTML.
 * Seed demo rows use Worktual / Campaign HQ / London / UK — never show that
 * on live tenant mail (ZIFO and others inherit the seed profile).
 */

export type OrgPostalFields = {
  legalName?: string | null;
  street?: string | null;
  city?: string | null;
  country?: string | null;
};

function norm(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

export function isSeedPlaceholderPostal(org: OrgPostalFields | null | undefined): boolean {
  if (!org) return true;
  const street = norm(org.street);
  const legal = norm(org.legalName);
  const city = norm(org.city);
  if (street === "campaign hq") return true;
  if (legal === "worktual" && city === "london") return true;
  return false;
}

export function orgPostalFooterText(
  org: OrgPostalFields | null | undefined,
): string {
  if (!org || isSeedPlaceholderPostal(org)) return "";
  const parts = [org.legalName, org.street, org.city, org.country]
    .map((p) => String(p || "").trim())
    .filter(Boolean);
  if (parts.length < 3) return "";
  return parts.join(", ");
}
