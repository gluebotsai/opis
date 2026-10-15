/** Backfill thin playbook sections from proposal corpus deep-reads. */

const MIN_PATTERN_LEN = 40;

const KEY_ALIASES: Record<string, string[]> = {
  introduction: ["executive_summary", "cover", "overview"],
  executive_summary: ["introduction", "overview"],
  scope: ["solution_scope", "proposed_solutions", "project_objective"],
  features: ["solution_scope", "proposed_solutions", "solution_comparison"],
  commercials: ["pricing_monthly", "pricing_one_time", "pricing"],
  pricing_monthly: ["commercials", "pricing"],
  pricing_one_time: ["commercials", "pricing"],
  conclusion: ["recommendation_note", "next_steps"],
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normKey(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normTitle(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function patternLen(section: Record<string, unknown>): number {
  return String(section.contentPattern || "").trim().length;
}

function toPlaybookSection(section: Record<string, unknown>): Record<string, unknown> {
  const key = normKey(section.key) || "section";
  return {
    key,
    title: redactCustomerFromTitle(String(section.title || key)).slice(0, 120),
    intent: redactCustomerCopy(String(section.intent || "")).slice(0, 300),
    tone: String(section.tone || "formal").slice(0, 80),
    typicalLength: String(section.typicalLength || "medium").slice(0, 20),
    pricingHints: String(section.pricingHints || "").slice(0, 200),
    contentPattern: redactCustomerCopy(String(section.contentPattern || "")).slice(0, 1200),
    ...(Array.isArray(section.blocks) ? { blocks: section.blocks } : {}),
    ...(section.tableSpec && typeof section.tableSpec === "object"
      ? { tableSpec: section.tableSpec }
      : {}),
    ...(section.wordBand ? { wordBand: String(section.wordBand).slice(0, 40) } : {}),
  };
}

function redactCustomerFromTitle(title: string): string {
  let t = title.replace(/^\d+[\).:-]\s*/, "");
  t = t.replace(
    /\s*[—\-–:]\s*(?:as specified by|prepared for|for)\s+.{2,80}$/i,
    "",
  );
  t = t.replace(/\b(?:as specified by|prepared for)\s+.{2,80}$/i, "");
  return t.replace(/\s{2,}/g, " ").trim() || title;
}

function redactCustomerCopy(text: string): string {
  return text
    .replace(
      /(?:as specified by|prepared for)\s+[^.,;\n]{2,80}/gi,
      "for the customer",
    )
    .replace(/\s{2,}/g, " ");
}

/** Collect richest proposal-side deep-read sections across pairs. */
export function collectProposalDeepSections(
  pairPayload: Array<Record<string, unknown>>,
): Record<string, unknown>[] {
  const byKey = new Map<string, Record<string, unknown>>();

  for (const pair of pairPayload) {
    const proposal = asRecord(pair.proposal);
    const sections = Array.isArray(proposal.sections) ? proposal.sections : [];
    for (const raw of sections) {
      const section = asRecord(raw);
      const key = normKey(section.key);
      if (!key) continue;
      const existing = byKey.get(key);
      if (!existing || patternLen(section) > patternLen(existing)) {
        byKey.set(key, section);
      }
    }
  }

  const ordered: Record<string, unknown>[] = [];
  for (const pair of pairPayload) {
    const proposal = asRecord(pair.proposal);
    const order = Array.isArray(proposal.sectionOrder)
      ? proposal.sectionOrder.map(normKey)
      : [];
    if (order.length) {
      for (const key of order) {
        const section = byKey.get(key);
        if (section && !ordered.some((s) => normKey(s.key) === key)) {
          ordered.push(section);
        }
      }
    }
  }

  for (const section of byKey.values()) {
    const key = normKey(section.key);
    if (!ordered.some((s) => normKey(s.key) === key)) {
      ordered.push(section);
    }
  }

  return ordered.map(toPlaybookSection);
}

function findSourceSection(
  learned: Record<string, unknown>,
  sources: Map<string, Record<string, unknown>>,
  titles: Map<string, Record<string, unknown>>,
): Record<string, unknown> | null {
  const key = normKey(learned.key);
  if (key && sources.has(key)) return sources.get(key)!;

  const title = normTitle(learned.title);
  if (title && titles.has(title)) return titles.get(title)!;

  const aliases = KEY_ALIASES[key] || [];
  for (const alias of aliases) {
    if (sources.has(alias)) return sources.get(alias)!;
  }

  return null;
}

/** Merge synthesize output with deep-read contentPattern / blocks when LLM output is thin. */
export function enrichPlaybookSectionsFromPairs(input: {
  learnedSections: unknown[];
  pairPayload: Array<Record<string, unknown>>;
}): Record<string, unknown>[] {
  const sources = collectProposalDeepSections(input.pairPayload);
  const sourceByKey = new Map(sources.map((s) => [normKey(s.key), s]));
  const sourceByTitle = new Map(
    sources.map((s) => [normTitle(s.title), s]),
  );

  const learned = (Array.isArray(input.learnedSections) ? input.learnedSections : [])
    .map(asRecord)
    .filter((s) => normKey(s.key));

  const enriched: Record<string, unknown>[] = learned.map((section) => {
    const next = toPlaybookSection(section);
    if (patternLen(next) >= MIN_PATTERN_LEN) return next;

    const source = findSourceSection(section, sourceByKey, sourceByTitle);
    if (!source) return next;

    return toPlaybookSection({
      ...source,
      ...next,
      contentPattern:
        patternLen(next) >= MIN_PATTERN_LEN
          ? next.contentPattern
          : source.contentPattern,
      blocks: next.blocks ?? source.blocks,
      tableSpec: next.tableSpec ?? source.tableSpec,
    });
  });

  const seen = new Set(enriched.map((s) => normKey(s.key)));
  for (const source of sources) {
    const key = normKey(source.key);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    enriched.push(toPlaybookSection(source));
  }

  const patterned = enriched.filter((s) => patternLen(s) >= MIN_PATTERN_LEN);
  if (
    enriched.length === 0 ||
    patterned.length < Math.ceil(enriched.length / 2)
  ) {
    return sources.filter((s) => patternLen(s) >= MIN_PATTERN_LEN);
  }

  return enriched;
}

export function countPatternedSections(sections: unknown[]): number {
  return (Array.isArray(sections) ? sections : []).filter(
    (s) => patternLen(asRecord(s)) >= MIN_PATTERN_LEN,
  ).length;
}
