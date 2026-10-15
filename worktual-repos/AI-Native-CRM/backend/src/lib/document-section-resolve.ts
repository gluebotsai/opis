/**
 * Fuzzy section resolution for proposal + quote document bodies.
 * Users may say any natural label; we match keys, aliases, and titles.
 */

export type DocumentSectionLike = {
  id: string;
  key: string;
  title: string;
  body: string;
  sortOrder: number;
  tableRows?: Array<{ cells: string[] }>;
};

/** Proposal template keys → spoken / LLM aliases */
export const PROPOSAL_SECTION_ALIASES: Record<string, readonly string[]> = {
  introduction: ["introduction", "intro", "opening", "cover letter"],
  overview: ["overview", "executive summary", "background", "situation"],
  business_context: [
    "business context",
    "business context & strategic alignment",
    "strategic alignment",
    "context",
  ],
  features: [
    "features",
    "feature",
    "capabilities",
    "product features",
    "key product features",
  ],
  scope: ["scope", "scope of work", "sow", "scope_of_work"],
  requested_solution: [
    "requested solution",
    "requested_solution",
    "proposed solution",
    "the solution",
  ],
  plan_of_action: [
    "plan of action",
    "plan_of_action",
    "action plan",
    "milestones",
    "timeline",
  ],
  commercials: ["commercials", "pricing", "price", "commercial", "cost"],
  onboarding: ["onboarding", "onboard", "onboarding process"],
  implementation: [
    "implementation",
    "implementation plan",
    "implementation_plan",
    "implement",
    "rollout",
  ],
  support: ["support", "sla", "service level"],
  conclusion: ["conclusion", "closing", "summary", "next steps"],
};

/** Quote template keys → spoken / LLM aliases */
export const QUOTE_SECTION_ALIASES: Record<string, readonly string[]> = {
  introduction: ["introduction", "intro", "cover letter", "opening"],
  tax_note: ["tax note", "tax_note", "taxes", "tax", "gst", "vat"],
  bank: [
    "bank details",
    "bank_detail",
    "bank",
    "payment details",
    "account details",
    "banking",
    "ifsc",
    "iban",
    "routing",
  ],
  terms: [
    "terms and conditions",
    "terms & conditions",
    "terms_conditions",
    "terms",
    "t&c",
    "conditions",
  ],
  payment_terms: [
    "payment terms",
    "payment_terms",
    "payment term",
    "payment schedule",
  ],
  delivery: [
    "delivery timeline",
    "delivery_timeline",
    "delivery",
    "timeline",
    "lead time",
    "shipping",
  ],
  footer: ["footer", "closing", "signature", "sign off"],
};

export const DOCUMENT_SECTION_ALIASES: Record<string, readonly string[]> = {
  ...PROPOSAL_SECTION_ALIASES,
  ...Object.fromEntries(
    Object.entries(QUOTE_SECTION_ALIASES).map(([key, aliases]) => [
      key,
      [...(PROPOSAL_SECTION_ALIASES[key] ?? []), ...aliases],
    ]),
  ),
};

export function normalizeSectionKeyHint(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/[^\w\s&.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripSectionNumberPrefix(title: string): string {
  return title.replace(/^\d+(?:\.\d+)?\.\s*/, "").trim().toLowerCase();
}

function hintWords(hint: string): string[] {
  return hint.split(/\s+/).filter((w) => w.length > 1);
}

function titleMatchesHint(title: string, hint: string): boolean {
  const titleCore = stripSectionNumberPrefix(title);
  if (!titleCore) return false;
  if (titleCore.includes(hint) || hint.includes(titleCore)) return true;
  const words = hintWords(hint);
  return words.length > 0 && words.every((word) => titleCore.includes(word));
}

function keyMatchesHint(sectionKey: string, hint: string): boolean {
  const keyNorm = normalizeSectionKeyHint(sectionKey);
  if (!keyNorm) return false;
  if (keyNorm === hint || keyNorm.includes(hint) || hint.includes(keyNorm)) {
    return true;
  }
  const words = hintWords(hint);
  return words.length > 0 && words.every((word) => keyNorm.includes(word));
}

function findByCanonicalOrTitle(
  sections: DocumentSectionLike[],
  canonical: string,
  matchedAlias?: string,
): DocumentSectionLike | null {
  const canonNorm = normalizeSectionKeyHint(canonical);
  const byKey = sections.find(
    (s) => normalizeSectionKeyHint(s.key) === canonNorm,
  );
  if (byKey) return byKey;
  const label = matchedAlias || canonical.replace(/_/g, " ");
  return sections.find((s) => titleMatchesHint(s.title, label)) ?? null;
}

/** Resolve a fuzzy section hint (key, alias, or title fragment) to a section. */
export function resolveDocumentSection(
  sections: DocumentSectionLike[],
  sectionKey: string,
  aliases: Record<string, readonly string[]> = DOCUMENT_SECTION_ALIASES,
): DocumentSectionLike | null {
  const hint = normalizeSectionKeyHint(sectionKey);
  if (!hint || sections.length === 0) return null;

  const byExactKey = sections.find(
    (s) => normalizeSectionKeyHint(s.key) === hint,
  );
  if (byExactKey) return byExactKey;

  for (const section of sections) {
    if (keyMatchesHint(section.key, hint)) return section;
  }

  for (const [canonical, canonAliases] of Object.entries(aliases)) {
    const aliasHit =
      normalizeSectionKeyHint(canonical) === hint ||
      canonAliases.some((a) => normalizeSectionKeyHint(a) === hint);
    if (!aliasHit) continue;
    const found = findByCanonicalOrTitle(sections, canonical, hint);
    if (found) return found;
  }

  for (const section of sections) {
    if (titleMatchesHint(section.title, hint)) return section;
  }

  // Partial alias: "implementation plan content" contains alias "implementation plan"
  for (const [canonical, canonAliases] of Object.entries(aliases)) {
    const sorted = [...canonAliases].sort((a, b) => b.length - a.length);
    const hit = sorted.find((a) => {
      const norm = normalizeSectionKeyHint(a);
      return norm && (hint.includes(norm) || norm.includes(hint));
    });
    if (!hit) continue;
    const found = findByCanonicalOrTitle(sections, canonical, hit);
    if (found) return found;
  }

  return null;
}
