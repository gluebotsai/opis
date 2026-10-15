/**
 * Org-level proposal content playbook helpers (lookup, length, retrieval).
 * Visual freeze stays on ProposalPlaybook; this is writing-style only.
 */

export const CONTENT_PLAYBOOK_SYNTHESIS_FLOOR = 3;
export const CONTENT_PLAYBOOK_HIGH_CONFIDENCE_FLOOR = 8;
export const PAIR_USE_ANYWAY_THRESHOLD = 0.3;
/** Pre-ship auto-match floor. User-declared pairs are never dropped for this. */
export const LEGACY_AUTO_CONFIDENCE_FLOOR = 0.65;
/** Recalibrate in one place. English ~1.3 tokens/word. */
export const WORDS_TO_TOKENS_RATIO = 1.3;
/** Same basis as planSectionLengths (pages → words). */
export const WORDS_PER_PROPOSAL_PAGE = 350;
/** PDF sheet count is only trusted when extracted prose density looks like writing. */
export const MIN_WORDS_PER_PAGE_DENSITY = 120;
export const MAX_WORDS_PER_PAGE_DENSITY = 500;
/** Per-section retry: draft must be close to the planned target, not a stub. */
export const SECTION_LENGTH_RETRY_RATIO = 0.8;
/** Legacy absolute floor — not the final target. Last-ditch after shares. */
export const SECTION_LENGTH_FLOOR_WORDS = 80;
/** Shrinkage strength: n=0–1 leans on the prior; n=4 leans on observed share. */
export const SHARE_SHRINKAGE_K = 2;
/** Prose caption band for table-heavy sections (compare / commercials). */
export const TABLE_CAPTION_TARGET_WORDS = 120;
/** Last-ditch per-section floor after shares (not used as the document target). */
export const SECTION_LENGTH_ABSOLUTE_FLOOR_WORDS = 40;
/** Fitted BRD total cannot exceed this multiple of the gold document mean. */
export const DOCUMENT_BUDGET_FIT_CAP = 1.5;
/** Expanded BRD outline may grow the budget up to this multiple of gold. */
export const DOCUMENT_BUDGET_EXPAND_CAP = 4;
/** Default share for a chapter kind with no canonical or BRD-category prior. */
export const UNRECOGNIZED_CHAPTER_SHARE = 0.06;
/** Hard cap on playbook slots plus BRD-only leaves. */
export const MAX_PROPOSAL_OUTLINE_LEAVES = 32;
/** Keep full recap text for this many most-recent leaves. */
export const ROLLING_RECAP_FULL_TAIL = 12;
/** Body clip stored on each recap line. */
export const ROLLING_RECAP_CLIP = 900;
/** Distinctive claim length floor for closed-fact overlap. */
export const CLOSED_CLAIM_MIN = 18;
/** Spec floors may overshoot the document budget by this fraction. */
export const DOCUMENT_BUDGET_OVERSHOOT = 0.1;

/**
 * LLM / freeze headings collapse onto these skeleton slugs.
 * Visual HTML `data-slot` values stay as frozen; lookup uses this map.
 */
const SECTION_KEY_ALIASES: Record<string, string> = {
  executive_summary: "overview",
  exec_summary: "overview",
  executive_overview: "overview",
  cover_and_overview: "overview",
  cover_overview: "overview",
  scope_of_work: "scope",
  sow: "scope",
  proposed_solution: "requested_solution",
  the_solution: "requested_solution",
  recommended_solution: "requested_solution",
  pricing: "commercials",
  commercials_pricing: "commercials",
  technical_architecture: "architecture",
  solution_architecture: "architecture",
  apis: "integrations",
  api_integrations: "integrations",
  implementation: "rollout",
  implementation_plan: "rollout",
  migration: "rollout",
};

/**
 * Gold headings sometimes wrap one of these concept keys in extra words
 * ("Key Considerations & Assumptions", "Recommended Solution Overview").
 * Rather than hand-alias every observed variant, collapse any heading whose
 * slug contains one of these as a whole underscore-delimited word/phrase.
 * Keep in lockstep with ai-service `proposal_section_keys.py`.
 */
const CONTAINMENT_KEYS = ["considerations", "requested_solution", "recommended_solution"] as const;

/** Snake-case slug shared by case studies, synthesize, planner, and exemplars. */
export function slugSectionKey(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Whole-word containment on `_`-joined slugs — not a raw substring test, so
 * "unrequested_solution" does not collapse onto "requested_solution". */
function slugContainsKey(haystack: string, needle: string): boolean {
  if (!needle || needle === haystack) return false;
  const pattern = new RegExp(`(?:^|_)${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:_|$)`);
  return pattern.test(haystack);
}

export function canonicalizeSectionKey(raw: string): string {
  const slug = slugSectionKey(raw);
  if (SECTION_KEY_ALIASES[slug]) return SECTION_KEY_ALIASES[slug];
  for (const canon of CONTAINMENT_KEYS) {
    if (slugContainsKey(slug, canon)) return SECTION_KEY_ALIASES[canon] || canon;
  }
  // Closing notes are signed to a different customer in every gold instance
  // by design ("note_for_vbike", "note_for_acme_corp", …) — this can never
  // collapse via containment/aliasing against a fixed canonical key, so it
  // gets its own normalization: strip the trailing customer-name token(s).
  // Keep in lockstep with ai-service `proposal_section_keys.py`.
  if (/(?:^|_)note_for(?:_|$)/.test(slug) && slug !== "note_for") {
    return "note_for_client";
  }
  return slug;
}

export function sectionKeysEqual(a: string, b: string): boolean {
  const left = canonicalizeSectionKey(a);
  const right = canonicalizeSectionKey(b);
  return Boolean(left) && left === right;
}

export function lookupBySectionKey<T>(
  map: Record<string, T>,
  key: string,
): T | undefined {
  if (Object.prototype.hasOwnProperty.call(map, key)) return map[key];
  const canon = canonicalizeSectionKey(key);
  if (canon && Object.prototype.hasOwnProperty.call(map, canon)) {
    return map[canon];
  }
  for (const [k, value] of Object.entries(map)) {
    if (sectionKeysEqual(k, key)) return value;
  }
  return undefined;
}

export function canonicalizeSectionAnalysis(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.map((row) => {
    const rec = asRecord(row);
    const key = canonicalizeSectionKey(
      String(rec.sectionKey || rec.key || ""),
    );
    return key ? { ...rec, sectionKey: key } : rec;
  });
}

export function canonicalizeSectionSpecs(
  value: unknown,
): Record<string, unknown> {
  const specs = asRecord(value);
  const nested = asRecord(specs.sectionSpecs);
  const map = Object.keys(nested).length ? nested : specs;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(map)) {
    if (k === "sectionSpecs") continue;
    const rec = asRecord(v);
    if (!Object.keys(rec).length) continue;
    const key = canonicalizeSectionKey(
      String(rec.key || rec.sectionKey || k),
    );
    if (!key) continue;
    out[key] = { ...rec, key };
  }
  return out;
}

export type ContentPlaybookLike = {
  id: string;
  caseStudyCount: number;
  confidenceLevel?: string | null;
  sectionSpecsJson?: unknown;
  lengthModelJson?: unknown;
  exemplarBankJson?: unknown;
  varianceLogJson?: unknown;
};

export type VisualMasterCandidate = {
  pairId?: string;
  proposalItemId: string;
  requirementItemId?: string;
  confidence?: number | null;
  pairSlot?: number | null;
};

export function contentPlaybookConfidenceLevel(
  caseStudyCount: number,
): "low" | "high" {
  return caseStudyCount >= CONTENT_PLAYBOOK_HIGH_CONFIDENCE_FLOOR
    ? "high"
    : "low";
}

export function canUseContentPlaybook(
  playbook: ContentPlaybookLike | null | undefined,
): playbook is ContentPlaybookLike {
  return Boolean(
    playbook && playbook.caseStudyCount >= CONTENT_PLAYBOOK_SYNTHESIS_FLOOR,
  );
}

export function wordsToTokenBudget(words: number): number {
  return Math.max(32, Math.round(Number(words || 0) * WORDS_TO_TOKENS_RATIO));
}

export function countWords(text: string | null | undefined): number {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/**
 * Measure requirement/proposal length from the extracted text that will train
 * the length model. Never mix PDF sheet count with a different word source.
 * PDF pageCount is kept only when words/page is in a prose-like band; otherwise
 * pages are derived from proposalWordCount / WORDS_PER_PROPOSAL_PAGE.
 */
export function measureProposalLength(input: {
  requirementText?: string | null;
  proposalText?: string | null;
  proposalPageCount?: number | null;
  proposalSectionBodies?: string[] | null;
}): {
  requirementWordCount: number;
  proposalWordCount: number;
  proposalPageCount: number;
} {
  const requirementWordCount = countWords(input.requirementText);
  let proposalWordCount = countWords(input.proposalText);
  if (!proposalWordCount && input.proposalSectionBodies?.length) {
    proposalWordCount = input.proposalSectionBodies.reduce(
      (n, body) => n + countWords(body),
      0,
    );
  }
  const pdfPages = Math.max(0, Math.round(Number(input.proposalPageCount || 0)));
  const derivedPages =
    proposalWordCount > 0
      ? Math.max(1, Math.round(proposalWordCount / WORDS_PER_PROPOSAL_PAGE))
      : 0;
  let proposalPageCount = derivedPages;
  if (pdfPages > 0 && proposalWordCount > 0) {
    const density = proposalWordCount / pdfPages;
    if (
      density >= MIN_WORDS_PER_PAGE_DENSITY &&
      density <= MAX_WORDS_PER_PAGE_DENSITY
    ) {
      proposalPageCount = pdfPages;
    }
  }
  return { requirementWordCount, proposalWordCount, proposalPageCount };
}

export function clampRequirementComplexity(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

export function overlayMeasuredLengthAnalysis(
  raw: unknown,
  measured: ReturnType<typeof measureProposalLength>,
): Record<string, unknown> {
  const rec = asRecord(raw);
  const lengthSpec =
    rec.lengthSpec && typeof rec.lengthSpec === "object"
      ? rec.lengthSpec
      : undefined;
  return {
    ...rec,
    ...measured,
    ...(lengthSpec ? { lengthSpec } : {}),
    requirementComplexityScore: clampRequirementComplexity(
      rec.requirementComplexityScore,
    ),
  };
}

export function sectionBodiesFromUnknown(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object"))
    .map((row) => String(row.body || row.content || ""));
}

/**
 * Pick the visual-master pair: highest pairing confidence, then lowest pairSlot.
 */
export function pickVisualMasterPair<T extends VisualMasterCandidate>(
  pairs: T[],
): T | null {
  if (!pairs.length) return null;
  return [...pairs].sort((a, b) => {
    const conf = Number(b.confidence ?? 0) - Number(a.confidence ?? 0);
    if (conf !== 0) return conf;
    return Number(a.pairSlot ?? 0) - Number(b.pairSlot ?? 0);
  })[0];
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export type ResolveContentPlaybookInput = {
  /** True when rewriting an already-persisted Proposal row. */
  existingProposal: boolean;
  pinnedContentPlaybookId?: string | null;
  pinnedPlaybook?: ContentPlaybookLike | null;
  latestForOrg?: ContentPlaybookLike | null;
};

/**
 * New Proposal rows always use the org's latest content playbook.
 * Existing rows use the visual playbook's snapshot FK; null FK (pre-ship
 * playbooks) falls back to latest. §4.5 applies only when nothing usable exists.
 */
export function resolveContentPlaybook(
  input: ResolveContentPlaybookInput,
): ContentPlaybookLike | null {
  if (input.existingProposal) {
    const pinned = input.pinnedPlaybook;
    if (canUseContentPlaybook(pinned)) return pinned;
    if (input.pinnedContentPlaybookId && !pinned) {
      // ID present but row missing — fall through to latest rather than fail.
    }
    return canUseContentPlaybook(input.latestForOrg)
      ? input.latestForOrg
      : null;
  }
  return canUseContentPlaybook(input.latestForOrg) ? input.latestForOrg : null;
}

/**
 * Section-by-section generate always needs a spec bag. When synthesis is below
 * the 3-study floor, derive targets from the visual playbook skeleton so we
 * never fall through to one whole-document Gemini call.
 */
export function stopgapContentPlaybookFromSkeleton(
  skeleton: Array<{ key?: string; id?: string; title?: string }>,
  latest?: ContentPlaybookLike | null,
): ContentPlaybookLike {
  const sectionSpecsJson: Record<string, unknown> = {};
  for (const row of skeleton) {
    const key = canonicalizeSectionKey(String(row.key || row.id || ""));
    if (!key) continue;
    sectionSpecsJson[key] = {
      key,
      title: String(row.title || key),
      purpose: String(row.title || key),
      kind: "prose",
      targetWordRange: [SECTION_LENGTH_FLOOR_WORDS, 220],
    };
  }
  const latestSpecs = latest
    ? canonicalizeSectionSpecs(latest.sectionSpecsJson)
    : {};
  return {
    id: latest?.id || "stopgap-visual-skeleton",
    caseStudyCount: latest?.caseStudyCount ?? 0,
    confidenceLevel: latest?.confidenceLevel || "low",
    sectionSpecsJson: Object.keys(latestSpecs).length
      ? latestSpecs
      : sectionSpecsJson,
    lengthModelJson: latest?.lengthModelJson ?? { fallback: "proportional" },
    exemplarBankJson: latest?.exemplarBankJson ?? [],
    varianceLogJson: latest?.varianceLogJson ?? null,
  };
}

/** Prefer a synthesized playbook; otherwise a skeleton stopgap (never null). */
export function contentPlaybookForSectionGenerate(input: {
  resolved: ContentPlaybookLike | null | undefined;
  latestForOrg?: ContentPlaybookLike | null;
  skeleton: Array<{ key?: string; id?: string; title?: string }>;
}): ContentPlaybookLike {
  if (input.resolved) return input.resolved;
  return stopgapContentPlaybookFromSkeleton(
    input.skeleton,
    input.latestForOrg ?? null,
  );
}

export type RequirementProfileLike = {
  themes?: unknown;
  summary?: unknown;
  products?: unknown;
};

function tokensFrom(...parts: unknown[]): Set<string> {
  const out = new Set<string>();
  for (const part of parts) {
    const text = Array.isArray(part)
      ? part.map((p) => String(p || "")).join(" ")
      : String(part || "");
    for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
      if (raw.length >= 3) out.add(raw);
    }
  }
  return out;
}

export type CaseStudyLike = {
  id: string;
  pairingConfidence?: number | null;
  sectionAnalysis?: unknown;
  lengthAnalysis?: unknown;
};

export function retrieveSimilarCaseStudies(
  profile: RequirementProfileLike,
  caseStudies: CaseStudyLike[],
  k = 3,
): CaseStudyLike[] {
  const query = tokensFrom(profile.themes, profile.summary, profile.products);
  const ranked = caseStudies
    .map((study) => {
      const analysis = Array.isArray(study.sectionAnalysis)
        ? study.sectionAnalysis
        : [];
      const refs = analysis.flatMap((row) => {
        const rec = asRecord(row);
        return [
          rec.sectionKey,
          rec.sourceRequirementRefs,
          rec.toneRegister,
        ];
      });
      const hay = tokensFrom(...refs);
      let overlap = 0;
      for (const t of query) {
        if (hay.has(t)) overlap += 1;
      }
      return { study, score: overlap };
    })
    .sort((a, b) => b.score - a.score || String(a.study.id).localeCompare(b.study.id));
  return ranked.slice(0, Math.max(1, k)).map((row) => row.study);
}

export function exemplarsForSection(
  caseStudies: CaseStudyLike[],
  sectionKey: string,
  extraBank?: unknown,
): unknown[] {
  const fromStudies: unknown[] = [];
  for (const study of caseStudies) {
    const rows = Array.isArray(study.sectionAnalysis)
      ? study.sectionAnalysis
      : [];
    for (const row of rows) {
      const rec = asRecord(row);
      if (sectionKeysEqual(String(rec.sectionKey || ""), sectionKey)) {
        fromStudies.push({
          sourceCaseStudyId: study.id,
          sectionKey,
          ...rec,
        });
      }
    }
  }
  const bank = asRecord(extraBank);
  const list = Array.isArray(bank.exemplarBank)
    ? bank.exemplarBank
    : Array.isArray(extraBank)
      ? extraBank
      : [];
  const fromBank = list.filter((row) =>
    sectionKeysEqual(String(asRecord(row).sectionKey || ""), sectionKey),
  );
  return [...fromStudies, ...fromBank].slice(0, 4);
}

export type LengthMeanStudy = {
  id?: string;
  pairId?: string;
  filename?: string;
  lengthAnalysis?: unknown;
  sectionAnalysis?: unknown;
};

export type GoldLengthMeanResult = {
  /** Overlay word counts used in the stopgap average (never drops synthesis). */
  words: number[];
  mean: number;
  skipped: Array<{
    id?: string;
    pairId?: string;
    filename?: string;
    proposalWordCount: number;
    proposalPageCount: number;
    wordsPerPage: number;
  }>;
  /** True when out-of-band rows were kept so the mean would not fall below 3. */
  bypassed: boolean;
};

function overlayLengthFields(study: LengthMeanStudy): {
  proposalWordCount: number;
  proposalPageCount: number;
} {
  const rec = asRecord(study.lengthAnalysis);
  return {
    proposalWordCount: Math.max(0, Math.round(Number(rec.proposalWordCount || 0))),
    proposalPageCount: Math.max(0, Math.round(Number(rec.proposalPageCount || 0))),
  };
}

/**
 * Stopgap length target for orgs below 8 studies: mean of overlay gold
 * `proposalWordCount`. Density outside 120–500 excludes a study from this
 * mean only — never from `canUseContentPlaybook` / exemplars / synthesis.
 * If exclusion would leave fewer than 3 in the mean, keep every overlay
 * word count and log the bypass.
 */
export function goldWordCountsForStopgapMean(input: {
  caseStudies: LengthMeanStudy[];
  organizationId?: string;
  synthesisFloor?: number;
}): GoldLengthMeanResult {
  const floor = input.synthesisFloor ?? CONTENT_PLAYBOOK_SYNTHESIS_FLOOR;
  const skipped: GoldLengthMeanResult["skipped"] = [];
  const inBand: number[] = [];
  const allOverlay: number[] = [];

  for (const study of input.caseStudies) {
    const { proposalWordCount, proposalPageCount } = overlayLengthFields(study);
    if (proposalWordCount <= 0) continue;
    allOverlay.push(proposalWordCount);
    const wpp =
      proposalPageCount > 0 ? proposalWordCount / proposalPageCount : null;
    const outOfBand =
      wpp != null &&
      (wpp < MIN_WORDS_PER_PAGE_DENSITY || wpp > MAX_WORDS_PER_PAGE_DENSITY);
    if (outOfBand && wpp != null) {
      skipped.push({
        id: study.id,
        pairId: study.pairId,
        filename: study.filename,
        proposalWordCount,
        proposalPageCount,
        wordsPerPage: Math.round(wpp * 10) / 10,
      });
      continue;
    }
    inBand.push(proposalWordCount);
  }

  let words = inBand;
  let bypassed = false;
  if (skipped.length) {
    const remaining = inBand.length;
    for (const row of skipped) {
      console.info("[proposal-generate] length-mean skipped study", {
        organizationId: input.organizationId ?? null,
        studyId: row.id ?? null,
        pairId: row.pairId ?? null,
        filename: row.filename ?? null,
        proposalWordCount: row.proposalWordCount,
        proposalPageCount: row.proposalPageCount,
        wordsPerPage: row.wordsPerPage,
        remainingUsableForMean: remaining,
        stillCountsTowardSynthesis: true,
        reason: "density_outside_120_500",
      });
    }
    if (inBand.length < floor && allOverlay.length >= floor) {
      bypassed = true;
      words = allOverlay;
      console.warn(
        "[proposal-generate] length-mean density guard bypassed",
        {
          organizationId: input.organizationId ?? null,
          skippedCount: skipped.length,
          usableForMean: inBand.length,
          includedCount: allOverlay.length,
          synthesisFloor: floor,
          reason: "exclusion_would_drop_below_3_in_mean",
        },
      );
    }
  }

  const mean =
    words.length > 0
      ? Math.round(words.reduce((n, w) => n + w, 0) / words.length)
      : 0;
  return { words, mean, skipped, bypassed };
}

export type SectionLengthFallback =
  | "section_analysis_share"
  | "share_prior"
  | "spec_range_floor"
  | "table_caption"
  | "section_analysis_mean"
  | "variance_log_mean"
  | "spec_range_mid"
  | "measured_spec"
  | "floor";

export type SectionLengthPlanRow = {
  key: string;
  words: number;
  studiesUsed: number;
  wordMean: number | null;
  fallback: SectionLengthFallback;
};

export type SectionLengthPlan = {
  planned: Record<string, number>;
  targets: SectionLengthPlanRow[];
  /** Unclamped BRD-fitted total (defaults applied even at low confidence). */
  fittedDocumentTotal: number | null;
  /** Overlay gold document mean. */
  documentGoldMean: number | null;
  /** Sum of per-section gold/spec/floor targets (not a 4× document inflate). */
  documentBudget: number;
  lengthSource: "section_gold_mean" | "measured_spec" | "measured_scaled";
  lengthConfidence: "high" | "low";
};

function varianceMeanMap(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const take = (keyRaw: string, meanRaw: unknown) => {
    const key = canonicalizeSectionKey(keyRaw);
    const mean = Math.round(Number(meanRaw || 0));
    if (key && mean > 0) out[key] = mean;
  };
  if (Array.isArray(raw)) {
    for (const row of raw) {
      const rec = asRecord(row);
      take(String(rec.sectionKey || rec.key || ""), rec.wordMean);
    }
    return out;
  }
  const rec = asRecord(raw);
  const nested = asRecord(rec.varianceLog);
  const map = Object.keys(nested).length ? nested : rec;
  for (const [k, v] of Object.entries(map)) {
    if (k === "varianceLog") continue;
    const row = asRecord(v);
    take(
      String(row.sectionKey || row.key || k),
      row.wordMean ?? (typeof v === "number" ? v : 0),
    );
  }
  return out;
}

function specRangeMid(spec: Record<string, unknown>): number | null {
  const range = Array.isArray(spec.targetWordRange) ? spec.targetWordRange : [];
  const lo = Number(range[0] || 0);
  const hi = Number(range[1] || 0);
  if (lo > 0 && hi >= lo) return Math.round((lo + hi) / 2);
  if (lo > 0) return Math.round(lo);
  return null;
}

function specRangeMin(spec: Record<string, unknown>): number | null {
  const range = Array.isArray(spec.targetWordRange) ? spec.targetWordRange : [];
  const lo = Number(range[0] || 0);
  return lo > 0 ? Math.round(lo) : null;
}

function wordCountsForSectionKey(
  studies: Array<{ sectionAnalysis?: unknown }>,
  key: string,
): number[] {
  const counts: number[] = [];
  for (const study of studies) {
    const rows = canonicalizeSectionAnalysis(study.sectionAnalysis);
    for (const row of rows) {
      const rec = asRecord(row);
      if (!sectionKeysEqual(String(rec.sectionKey || ""), key)) continue;
      const n = Math.round(Number(rec.wordCount || 0));
      if (n > 0) {
        counts.push(n);
        break;
      }
    }
  }
  return counts;
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((n, w) => n + w, 0) / values.length;
}

/** Table-heavy slots are caption + grid, not long prose. */
export function isTableHeavySectionKey(key: string, spec?: unknown): boolean {
  const slug = slugSectionKey(key);
  const canon = canonicalizeSectionKey(key);
  if (
    canon === "commercials" ||
    /pric|commercial|compare|what_we_compare|vs_recommended/.test(slug)
  ) {
    return true;
  }
  const table = asRecord(asRecord(spec).tableSpec);
  const cols = table.columns;
  return Array.isArray(cols) && cols.some((c) => String(c || "").trim());
}

function sectionSharePrior(key: string): number {
  const slug = slugSectionKey(key);
  const canon = canonicalizeSectionKey(key);
  if (canon === "overview" || /overview|exec/.test(slug)) return 0.12;
  if (canon === "considerations" || /consider/.test(slug)) return 0.15;
  if (
    /compare|what_we_compare|vs_recommended/.test(slug) ||
    /compare/.test(canon)
  ) {
    return 0.1;
  }
  if (canon === "commercials" || /pric|commercial/.test(slug)) return 0.12;
  if (canon === "note_for_client" || slug.startsWith("note_for_")) return 0.08;
  if (
    canon === "architecture" ||
    /architect|technical_design|solution_design/.test(slug)
  ) {
    return 0.1;
  }
  if (canon === "integrations" || /integrat|interop|\bapis?\b/.test(slug)) {
    return 0.08;
  }
  if (/rollout|implement|migrat|deployment/.test(slug)) return 0.08;
  if (/sla|support|operations/.test(slug)) return 0.06;
  if (/risk|assumption|dependenc/.test(slug)) return 0.05;
  if (/security|compliance|gdpr/.test(slug)) return 0.06;
  if (
    canon === "requested_solution" ||
    /solution|scope|approach/.test(slug)
  ) {
    return 0.18;
  }
  return UNRECOGNIZED_CHAPTER_SHARE;
}

function assignSharePriors(keys: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of keys) {
    out[key] = sectionSharePrior(key);
  }
  const sum = keys.reduce((n, key) => n + (out[key] || 0), 0) || 1;
  for (const key of keys) out[key] = (out[key] || 0) / sum;
  return out;
}

function shareObservationsForKey(
  studies: LengthMeanStudy[],
  key: string,
): number[] {
  const shares: number[] = [];
  for (const study of studies) {
    const doc = overlayLengthFields(study).proposalWordCount;
    if (doc <= 0) continue;
    const rows = canonicalizeSectionAnalysis(study.sectionAnalysis);
    for (const row of rows) {
      const rec = asRecord(row);
      if (!sectionKeysEqual(String(rec.sectionKey || ""), key)) continue;
      const n = Math.round(Number(rec.wordCount || 0));
      if (n > 0) {
        shares.push(n / doc);
        break;
      }
    }
  }
  return shares;
}

function fittedDocumentTotalWords(input: {
  requirementWordCount: number;
  requirementComplexityScore?: number;
  contentPlaybook: ContentPlaybookLike;
}): number | null {
  const model = asRecord(input.contentPlaybook.lengthModelJson);
  const nestedModel = asRecord(model.lengthModel);
  const lengthModel = Object.keys(nestedModel).length ? nestedModel : model;
  const coef = asRecord(lengthModel.coefficients);
  const intercept = Number(coef.intercept ?? 4);
  const perThousand = Number(coef.perThousandWords ?? 1.2);
  const perComplexity = Number(coef.perComplexityPoint ?? 3);
  const reqWords = Math.max(0, Number(input.requirementWordCount || 0));
  const complexity = Math.min(
    1,
    Math.max(0, Number(input.requirementComplexityScore ?? 0.5)),
  );
  const pages =
    intercept + perThousand * (reqWords / 1000) + perComplexity * complexity;
  if (!Number.isFinite(pages)) return null;
  return Math.max(800, Math.round(pages * WORDS_PER_PROPOSAL_PAGE));
}

function clampFittedDocumentTotal(
  fitted: number | null,
  goldMean: number | null,
): number | null {
  if (fitted == null || !Number.isFinite(fitted) || fitted <= 0) return null;
  if (goldMean == null || goldMean <= 0) return fitted;
  const lo = goldMean;
  const hi = goldMean * DOCUMENT_BUDGET_FIT_CAP;
  return Math.round(Math.min(hi, Math.max(lo, fitted)));
}

function plannedSum(planned: Record<string, number>): number {
  return Object.values(planned).reduce((n, w) => n + w, 0);
}

/**
 * Per-section targets from gold `sectionAnalysis.wordCount`.
 * Spec range / variance log are fallbacks. Do not inflate to a 4× document budget.
 */
export function planSectionLengths(input: {
  sectionKeys: string[];
  requirementWordCount: number;
  requirementComplexityScore?: number;
  contentPlaybook: ContentPlaybookLike;
  caseStudies?: Array<LengthMeanStudy | CaseStudyLike>;
  organizationId?: string;
}): SectionLengthPlan {
  const keys = input.sectionKeys.filter(Boolean);
  const specMap = canonicalizeSectionSpecs(
    input.contentPlaybook.sectionSpecsJson,
  );
  const varianceMap = varianceMeanMap(input.contentPlaybook.varianceLogJson);
  const studies = input.caseStudies ?? [];
  const planned: Record<string, number> = {};
  const targets: SectionLengthPlanRow[] = [];

  const measuredDocs: number[] = [];
  const measuredSectionSums: Record<string, number[]> = {};
  for (const study of studies) {
    const rec = asRecord((study as { lengthAnalysis?: unknown }).lengthAnalysis);
    const spec = asRecord(rec.lengthSpec);
    const doc = Math.round(Number(spec.documentWordCount || 0));
    if (doc > 0) measuredDocs.push(doc);
    const sectionWords = asRecord(spec.sectionWords);
    for (const [rawKey, rawWords] of Object.entries(sectionWords)) {
      const canon = canonicalizeSectionKey(rawKey);
      const n = Math.round(Number(rawWords));
      if (!canon || n <= 0) continue;
      (measuredSectionSums[canon] ||= []).push(n);
    }
  }
  const measuredDocumentMean =
    measuredDocs.length > 0
      ? Math.round(
          measuredDocs.reduce((n, w) => n + w, 0) / measuredDocs.length,
        )
      : null;

  for (const key of keys) {
    const measuredForKey = measuredSectionSums[canonicalizeSectionKey(key)] || [];
    const counts = wordCountsForSectionKey(studies, key);
    const spec = asRecord(lookupBySectionKey(specMap, key) ?? {});
    const varianceMean = lookupBySectionKey(varianceMap, key);
    let words = SECTION_LENGTH_FLOOR_WORDS;
    let studiesUsed = 0;
    let wordMean: number | null = null;
    let fallback: SectionLengthFallback = "floor";
    if (measuredForKey.length) {
      studiesUsed = measuredForKey.length;
      wordMean = Math.round(
        measuredForKey.reduce((n, w) => n + w, 0) / measuredForKey.length,
      );
      words = wordMean;
      fallback = "measured_spec";
    } else if (counts.length) {
      studiesUsed = counts.length;
      wordMean = Math.round(counts.reduce((n, w) => n + w, 0) / counts.length);
      words = wordMean;
      fallback = "section_analysis_mean";
    } else if (typeof varianceMean === "number" && varianceMean > 0) {
      wordMean = varianceMean;
      words = varianceMean;
      fallback = "variance_log_mean";
    } else {
      const mid = specRangeMid(spec);
      if (mid && mid > 0) {
        words = mid;
        fallback = "spec_range_mid";
      }
    }
    planned[key] = words;
    targets.push({ key, words, studiesUsed, wordMean, fallback });
  }

  const gold = goldWordCountsForStopgapMean({
    caseStudies: studies,
    organizationId: input.organizationId,
  });
  let lengthSource: SectionLengthPlan["lengthSource"] = "section_gold_mean";
  let lengthConfidence: "high" | "low" = "high";
  const goldMean = gold.mean > 0 ? gold.mean : null;
  const sectionTotal = plannedSum(planned);
  if (
    measuredDocumentMean &&
    measuredDocumentMean > 0 &&
    sectionTotal > 0
  ) {
    const drift =
      Math.abs(sectionTotal - measuredDocumentMean) / measuredDocumentMean;
    if (drift > 0.15) {
      const scale = measuredDocumentMean / sectionTotal;
      for (const key of Object.keys(planned)) {
        planned[key] = Math.max(
          SECTION_LENGTH_ABSOLUTE_FLOOR_WORDS,
          Math.round((planned[key] || 0) * scale),
        );
      }
      for (const row of targets) {
        row.words = planned[row.key] || row.words;
      }
      lengthSource = "measured_scaled";
      lengthConfidence = "low";
    } else {
      lengthSource = "measured_spec";
    }
  }

  return {
    planned,
    targets,
    fittedDocumentTotal: fittedDocumentTotalWords(input),
    documentGoldMean: goldMean,
    documentBudget: plannedSum(planned),
    lengthSource,
    lengthConfidence,
  };
}

export function shouldRejectPairSlot(
  confidence: number | null | undefined,
  useAnyway: boolean,
): boolean {
  return (
    Number.isFinite(Number(confidence)) &&
    Number(confidence) < PAIR_USE_ANYWAY_THRESHOLD &&
    !useAnyway
  );
}

/**
 * User-declared slots are always persisted (no 0.65 reject).
 * Legacy auto-pairs still require the old floor.
 */
export function shouldPersistScoredPair(input: {
  pairingSource: string;
  confidence: number | null | undefined;
}): boolean {
  if (input.pairingSource === "user_explicit") return true;
  return Number(input.confidence ?? 0) >= LEGACY_AUTO_CONFIDENCE_FLOOR;
}

export function nextContentPlaybookVersion(
  latestVersion: number | null | undefined,
): number {
  return (latestVersion ?? 0) + 1;
}

export function pairingSourceForBackfill(
  existing: string | null | undefined,
): "user_explicit" | "legacy_auto" {
  return existing === "user_explicit" ? "user_explicit" : "legacy_auto";
}

/** Backfill writes case studies + optional new content versions; never re-freezes. */
export function backfillWritesVisualPlaybookFk(): boolean {
  return false;
}

export function proposalGenerateAttemptCount(
  _resolvedContentPlaybook?: ContentPlaybookLike | null,
): number {
  // Pass 1 is always section-by-section. Pass 2 is whole-doc last resort only
  // when section mode itself failed (not Gemini/KB unavailable).
  return 2;
}

/** Whole-document generate when product KB search never reached the index. */
export const PRODUCT_KB_UNAVAILABLE_REASON = "kb_unavailable";
export const PRODUCT_KB_UNAVAILABLE_MESSAGE =
  "Product catalog lookup is temporarily unavailable, try again shortly";

export const GEMINI_UNAVAILABLE_REASON = "gemini_unavailable";
export const GEMINI_UNAVAILABLE_MESSAGE =
  "Gemini is temporarily unavailable due to high demand. Retry in a few minutes.";

export function isProductKbUnavailableReason(
  reason: string | null | undefined,
): boolean {
  const raw = String(reason || "").trim().toLowerCase();
  return (
    raw === PRODUCT_KB_UNAVAILABLE_REASON ||
    raw.startsWith(`${PRODUCT_KB_UNAVAILABLE_REASON}:`)
  );
}

export function isGeminiUnavailableReason(
  reason: string | null | undefined,
): boolean {
  const raw = String(reason || "").trim().toLowerCase();
  return (
    raw === GEMINI_UNAVAILABLE_REASON ||
    raw.startsWith(`${GEMINI_UNAVAILABLE_REASON}:`)
  );
}

export function shouldRetryWholeDocumentGenerate(
  reason: string | null | undefined,
): boolean {
  return (
    !isProductKbUnavailableReason(reason) &&
    !isGeminiUnavailableReason(reason)
  );
}

export function isAiServiceTimeoutReason(
  reason: string | null | undefined,
): boolean {
  return /timeout|timed out|aborted/i.test(String(reason || ""));
}

export function proposalGenerateQualityGateError(input: {
  reason?: string | null;
  source?: string | null;
  timedOut?: boolean;
  shortSectionKeys?: string[] | null;
}): string {
  if (isProductKbUnavailableReason(input.reason)) {
    return PRODUCT_KB_UNAVAILABLE_MESSAGE;
  }
  if (isGeminiUnavailableReason(input.reason)) {
    return GEMINI_UNAVAILABLE_MESSAGE;
  }
  if (input.timedOut) {
    return "Proposal generation timed out while writing sections. Retry — large BRDs can take a few minutes.";
  }
  const short = (input.shortSectionKeys ?? []).map(String).filter(Boolean);
  if (short.length) {
    return `These sections were too short versus the learned word bands: ${short.join(", ")}. Nothing was saved; retry.`;
  }
  if (input.source !== "ai") {
    return "The AI could not finish writing proposal sections. Retry in a moment.";
  }
  return "The AI did not produce a complete customer-ready proposal. Nothing was saved; retry after checking the selected playbook and products.";
}

export function sectionsBelowPlannedWordBand(
  sections: Array<{
    key?: string;
    id?: string;
    body?: string;
    tableRows?: Array<{ cells?: string[] | null } | null> | null;
  }>,
  planned: Record<string, number>,
): string[] {
  return sections
    .filter((section) => {
      const key = String(section.key || section.id || "");
      if (
        isTableHeavySectionKey(key) &&
        sectionHasPopulatedTable(section.tableRows)
      ) {
        return false;
      }
      const target =
        planned[key] ??
        lookupBySectionKey(planned, key) ??
        0;
      if (target <= 0) return false;
      return sectionDraftNeedsRetry({
        source: "ai",
        body: section.body,
        tableRows: section.tableRows,
        targetWords: target,
      });
    })
    .map((section) => String(section.key || section.id || ""))
    .filter(Boolean);
}

export function partitionSkeletonForGeneration<
  T extends { key?: string; id?: string; title?: string },
>(skeleton: T[]): { body: T[]; summary: T[]; generationOrder: T[] } {
  const body = skeleton.filter(
    (s) =>
      !isSynthesizingSectionKey(String(s.key || s.id || ""), String(s.title || "")),
  );
  const summary = skeleton.filter((s) =>
    isSynthesizingSectionKey(String(s.key || s.id || ""), String(s.title || "")),
  );
  return { body, summary, generationOrder: [...body, ...summary] };
}

function tokenizeDraftWords(text: string): number {
  return String(text || "")
    .replace(/<[^>]+>/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^[^\w]+|[^\w]+$/g, ""))
    .filter((token) => token.length > 0).length;
}

/** Prose plus table-cell copy — comparison sections live in tableRows, not body. */
export function sectionDraftWordCount(input: {
  body?: string | null;
  tableRows?: Array<{ cells?: string[] | null } | null> | null;
}): number {
  let words = tokenizeDraftWords(String(input.body || ""));
  for (const row of input.tableRows ?? []) {
    for (const cell of row?.cells ?? []) {
      words += tokenizeDraftWords(String(cell || ""));
    }
  }
  return words;
}

export function sectionHasPopulatedTable(
  tableRows?: Array<{ cells?: string[] | null } | null> | null,
): boolean {
  const filled = (tableRows ?? []).filter((row) =>
    (row?.cells ?? []).some((cell) => String(cell || "").trim()),
  );
  return filled.length >= 2;
}

export function sectionDraftNeedsRetry(input: {
  source?: string;
  body?: string;
  tableRows?: Array<{ cells?: string[] | null } | null> | null;
  targetWords: number;
}): boolean {
  if (input.source !== "ai") return true;
  const words = sectionDraftWordCount(input);
  if (sectionHasPopulatedTable(input.tableRows)) {
    // Requested-vs-recommended / compare grids are the section. An 80-word
    // prose floor (or empty body) must not discard a filled table.
    return words < 8;
  }
  const body = String(input.body || "").trim();
  if (!body) return true;
  const tooShort =
    words <
    Math.max(40, Math.round(input.targetWords * SECTION_LENGTH_RETRY_RATIO));
  return tooShort;
}

export function isSynthesizingSectionKey(key: string, title = ""): boolean {
  const blob = `${key} ${title}`.toLowerCase();
  return /exec(utive)?[_\s-]*sum|cover|overview|preamble/.test(blob);
}

export function extractClosedClaims(body: string, limit = 12): string[] {
  const text = String(body || "").replace(/\s+/g, " ").trim();
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const value = raw.replace(/\s+/g, " ").trim();
    if (value.length < CLOSED_CLAIM_MIN) return;
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(value.slice(0, 160));
  };
  for (const match of text.match(
    /\b\d[\d,]*(?:\.\d+)?(?:\s+[A-Za-z%][A-Za-z0-9%-]*){1,6}\b/g,
  ) || []) {
    push(match);
  }
  for (const match of text.match(
    /\b[A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+){1,5}\b/g,
  ) || []) {
    push(match);
  }
  return out.slice(0, limit);
}

export function compactSectionRecap(section: {
  heading?: string;
  body?: string;
  key?: string;
}): string {
  const heading = String(section.heading || section.key || "Section").trim();
  const claims = extractClosedClaims(String(section.body || ""));
  if (!claims.length) {
    return `${heading}: already covered — do not repeat; add only new depth for this section.`;
  }
  return `${heading}: ${claims.join("; ")}`;
}

export function recapOverlapSnippets(
  body: string,
  recap: string[],
  minHits = 1,
): string[] {
  const hay = String(body || "").toLowerCase();
  if (!hay.trim()) return [];
  const hits: string[] = [];
  const consider = (claim: string) => {
    const needle = claim.replace(/\s+/g, " ").replace(/…/g, "").trim();
    if (needle.length < CLOSED_CLAIM_MIN || needle.length > 160) return;
    if (/^already covered/i.test(needle)) return;
    const key = needle.toLowerCase();
    if (hay.includes(key) && !hits.some((h) => h.toLowerCase() === key)) {
      hits.push(needle);
    }
  };
  for (const line of recap) {
    const afterColon = String(line || "").replace(/^[^:]*:\s*/, "");
    for (const part of afterColon.split(/\s*;\s*/)) {
      consider(part);
    }
  }
  return hits.length >= minHits ? hits.slice(0, 8) : [];
}

/** Full recap for recent leaves; heading-only lines for older ones so facts stay in context. */
export function buildRollingRecap(recaps: string[]): string[] {
  const lines = recaps.map((line) => String(line || "").trim()).filter(Boolean);
  if (lines.length <= ROLLING_RECAP_FULL_TAIL) return lines;
  const older = lines.slice(0, -ROLLING_RECAP_FULL_TAIL).map((line) => {
    const heading = line.split(":")[0]?.trim() || "Section";
    return `${heading}: already covered — do not repeat; add only new depth for this section.`;
  });
  return [...older, ...lines.slice(-ROLLING_RECAP_FULL_TAIL)];
}

export type OutlineLeaf = {
  key?: string;
  title?: string;
  heading?: string;
  purpose?: string;
  kind?: string;
};

export function mergeOutlineIntoSkeleton<
  T extends { key?: string; id?: string; title?: string; body?: string },
>(skeleton: T[], leaves: OutlineLeaf[] | null | undefined): T[] {
  const out: T[] = [...skeleton];
  const seen = new Set(
    out.map((s) => canonicalizeSectionKey(String(s.key || s.id || ""))).filter(Boolean),
  );
  for (const leaf of leaves ?? []) {
    if (out.length >= MAX_PROPOSAL_OUTLINE_LEAVES) break;
    const title = String(leaf.title || leaf.heading || leaf.key || "").trim();
    const key = slugSectionKey(String(leaf.key || title));
    if (!key) continue;
    const canon = canonicalizeSectionKey(key);
    if (seen.has(canon) || seen.has(key)) continue;
    seen.add(canon);
    seen.add(key);
    out.push({
      key,
      title: title || key,
      body: "",
      ...(leaf.purpose ? { purpose: leaf.purpose } : {}),
      ...(leaf.kind ? { kind: leaf.kind } : {}),
    } as T);
  }
  return out.slice(0, MAX_PROPOSAL_OUTLINE_LEAVES);
}
