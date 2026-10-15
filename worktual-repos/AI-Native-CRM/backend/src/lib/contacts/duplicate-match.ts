/**
 * Heuristic duplicate matching for contacts (AI-assisted suggestions).
 * Scores and reasons are explained so users can review before merge.
 *
 * Name-only and name+city are too weak (common names in a city) — they do not
 * interrupt save. Email, phone, or same name+company still flag.
 */

export type DuplicateMatchReason = {
  code:
    | "exact_email"
    | "secondary_email"
    | "exact_phone"
    | "secondary_phone"
    | "same_name_company"
    | "same_name_city"
    | "same_name";
  label: string;
  weight: number;
};

export type ContactMatchInput = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  secondaryEmails: string[];
  secondaryPhones: string[];
  companyId: string | null;
  companyName: string | null;
  city: string | null;
};

export type DuplicateMatchResult = {
  contactId: string;
  confidence: number;
  reasons: DuplicateMatchReason[];
};

function normEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function normPhone(value: string | null | undefined): string {
  return (value ?? "").replace(/\D+/g, "");
}

function normName(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function fullName(c: ContactMatchInput): string {
  return normName(`${c.firstName} ${c.lastName}`);
}

function allEmails(c: ContactMatchInput): string[] {
  return uniq([
    normEmail(c.email),
    ...c.secondaryEmails.map(normEmail),
  ].filter(Boolean));
}

function allPhones(c: ContactMatchInput): string[] {
  return uniq([
    normPhone(c.phone),
    ...c.secondaryPhones.map(normPhone),
  ].filter((p) => p.length >= 7));
}

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

function clampConfidence(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

/** Compare two contacts; returns null if below threshold. */
export function scoreContactPair(
  a: ContactMatchInput,
  b: ContactMatchInput,
  /** 75: email / phone / name+company only. Name-only (58) and name+city (68) stay below. */
  minConfidence = 75,
): DuplicateMatchResult | null {
  if (a.id === b.id) return null;

  const reasons: DuplicateMatchReason[] = [];
  let score = 0;

  const aEmails = allEmails(a);
  const bEmails = allEmails(b);
  const aPrimary = normEmail(a.email);
  const bPrimary = normEmail(b.email);

  if (aPrimary && bPrimary && aPrimary === bPrimary) {
    reasons.push({
      code: "exact_email",
      label: `Same primary email (${aPrimary})`,
      weight: 100,
    });
    score = 100;
  } else {
    const sharedEmail = aEmails.find((e) => bEmails.includes(e));
    if (sharedEmail) {
      reasons.push({
        code: "secondary_email",
        label: `Shared email address (${sharedEmail})`,
        weight: 92,
      });
      score = Math.max(score, 92);
    }
  }

  const aPhones = allPhones(a);
  const bPhones = allPhones(b);
  const aPrimaryPhone = normPhone(a.phone);
  const bPrimaryPhone = normPhone(b.phone);
  if (
    aPrimaryPhone &&
    bPrimaryPhone &&
    aPrimaryPhone.length >= 7 &&
    aPrimaryPhone === bPrimaryPhone
  ) {
    reasons.push({
      code: "exact_phone",
      label: "Same primary phone number",
      weight: 85,
    });
    score = Math.max(score, 85);
  } else {
    const sharedPhone = aPhones.find((p) => bPhones.includes(p));
    if (sharedPhone) {
      reasons.push({
        code: "secondary_phone",
        label: "Shared phone number",
        weight: 78,
      });
      score = Math.max(score, 78);
    }
  }

  const nameA = fullName(a);
  const nameB = fullName(b);
  const sameName = Boolean(nameA && nameB && nameA === nameB);
  if (sameName) {
    const companyA = (a.companyId || normName(a.companyName)).trim();
    const companyB = (b.companyId || normName(b.companyName)).trim();
    if (companyA && companyB && companyA.toLowerCase() === companyB.toLowerCase()) {
      reasons.push({
        code: "same_name_company",
        label: "Same name and company",
        weight: 80,
      });
      score = Math.max(score, 80);
    } else if (
      normName(a.city) &&
      normName(a.city) === normName(b.city)
    ) {
      reasons.push({
        code: "same_name_city",
        label: `Same name and city (${a.city})`,
        weight: 68,
      });
      score = Math.max(score, 68);
    } else {
      reasons.push({
        code: "same_name",
        label: "Same full name",
        weight: 58,
      });
      score = Math.max(score, 58);
    }
  }

  if (!reasons.length) return null;
  const confidence = clampConfidence(score);
  if (confidence < minConfidence) return null;

  return {
    contactId: b.id,
    confidence,
    reasons,
  };
}

export function recommendPrimaryContactId(
  contacts: Array<ContactMatchInput & { updatedAt?: string | Date | null }>,
): string {
  if (!contacts.length) return "";
  // Prefer most recently updated; tie-break by presence of company + email.
  const ranked = [...contacts].sort((a, b) => {
    const aScore =
      (a.companyId ? 2 : 0) +
      (a.email ? 1 : 0) +
      (a.phone ? 1 : 0);
    const bScore =
      (b.companyId ? 2 : 0) +
      (b.email ? 1 : 0) +
      (b.phone ? 1 : 0);
    if (bScore !== aScore) return bScore - aScore;
    const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return bTime - aTime;
  });
  return ranked[0]!.id;
}

export type MergeableFieldKey =
  | "firstName"
  | "lastName"
  | "email"
  | "phone"
  | "title"
  | "addressLine"
  | "city"
  | "country"
  | "companyId"
  | "locationId"
  | "ownerUserId"
  | "contactType"
  | "leadStatus"
  | "leadSource"
  | "status"
  | "notes"
  | "convertedDealId";

export const MERGEABLE_FIELDS: Array<{
  key: MergeableFieldKey;
  label: string;
}> = [
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Last name" },
  { key: "email", label: "Primary email" },
  { key: "phone", label: "Primary phone" },
  { key: "title", label: "Title" },
  { key: "addressLine", label: "Address" },
  { key: "city", label: "City" },
  { key: "country", label: "Country" },
  { key: "companyId", label: "Company" },
  { key: "locationId", label: "Location" },
  { key: "ownerUserId", label: "Owner" },
  { key: "contactType", label: "Lifecycle stage" },
  { key: "leadStatus", label: "Lead status" },
  { key: "leadSource", label: "Lead source" },
  { key: "status", label: "Status" },
  { key: "notes", label: "Notes" },
  { key: "convertedDealId", label: "Converted deal" },
];

/** Suggest best value source contact id for a field (prefer non-empty, richer). */
export function suggestFieldSource(
  field: MergeableFieldKey,
  contacts: Array<{ id: string; values: Record<string, string | null> }>,
): string {
  const nonEmpty = contacts.filter((c) => {
    const v = c.values[field];
    return v != null && String(v).trim() !== "";
  });
  if (!nonEmpty.length) return contacts[0]?.id ?? "";
  if (field === "notes") {
    return [...nonEmpty].sort(
      (a, b) =>
        String(b.values.notes ?? "").length - String(a.values.notes ?? "").length,
    )[0]!.id;
  }
  return nonEmpty[0]!.id;
}
