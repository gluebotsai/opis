/**
 * run: npx tsx src/lib/proposal-content-playbook.test.ts
 */
import {
  canUseContentPlaybook,
  pickVisualMasterPair,
  resolveContentPlaybook,
  planSectionLengths,
  retrieveSimilarCaseStudies,
  wordsToTokenBudget,
  measureProposalLength,
  overlayMeasuredLengthAnalysis,
  goldWordCountsForStopgapMean,
  canonicalizeSectionKey,
  lookupBySectionKey,
  exemplarsForSection,
  sectionsBelowPlannedWordBand,
  isTableHeavySectionKey,
  TABLE_CAPTION_TARGET_WORDS,
  shouldRejectPairSlot,
  buildRollingRecap,
  compactSectionRecap,
  extractClosedClaims,
  recapOverlapSnippets,
  mergeOutlineIntoSkeleton,
  shouldPersistScoredPair,
  nextContentPlaybookVersion,
  pairingSourceForBackfill,
  backfillWritesVisualPlaybookFk,
  contentPlaybookForSectionGenerate,
  stopgapContentPlaybookFromSkeleton,
  isAiServiceTimeoutReason,
  proposalGenerateAttemptCount,
  partitionSkeletonForGeneration,
  sectionDraftNeedsRetry,
  isProductKbUnavailableReason,
  isGeminiUnavailableReason,
  shouldRetryWholeDocumentGenerate,
  proposalGenerateQualityGateError,
  PRODUCT_KB_UNAVAILABLE_MESSAGE,
  GEMINI_UNAVAILABLE_MESSAGE,
} from "./proposal-content-playbook";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const latest = {
  id: "latest",
  caseStudyCount: 5,
  confidenceLevel: "low" as const,
};
const pinned = {
  id: "pinned-v1",
  caseStudyCount: 4,
  confidenceLevel: "low" as const,
};
const tooFew = { id: "few", caseStudyCount: 2, confidenceLevel: "low" as const };

assert(
  resolveContentPlaybook({
    existingProposal: false,
    pinnedPlaybook: pinned,
    latestForOrg: latest,
  })?.id === "latest",
  "new proposal uses latest, ignoring visual FK",
);

assert(
  resolveContentPlaybook({
    existingProposal: true,
    pinnedContentPlaybookId: pinned.id,
    pinnedPlaybook: pinned,
    latestForOrg: latest,
  })?.id === "pinned-v1",
  "existing proposal uses pinned FK",
);

assert(
  resolveContentPlaybook({
    existingProposal: true,
    pinnedContentPlaybookId: null,
    pinnedPlaybook: null,
    latestForOrg: latest,
  })?.id === "latest",
  "existing proposal with null FK falls back to latest",
);

assert(
  resolveContentPlaybook({
    existingProposal: true,
    pinnedPlaybook: null,
    latestForOrg: tooFew,
  }) === null,
  "null FK + below floor is no content playbook",
);

assert(!canUseContentPlaybook(tooFew), "floor is 3");
assert(canUseContentPlaybook(latest), "5 studies are usable");

const master = pickVisualMasterPair([
  { proposalItemId: "p2", confidence: 0.9, pairSlot: 1 },
  { proposalItemId: "p1", confidence: 0.9, pairSlot: 0 },
  { proposalItemId: "p3", confidence: 0.8, pairSlot: 2 },
]);
assert(master?.proposalItemId === "p1", "tie-break is lowest pairSlot");

const highMaster = pickVisualMasterPair([
  { proposalItemId: "p2", confidence: 0.91, pairSlot: 0 },
  { proposalItemId: "p1", confidence: 0.95, pairSlot: 1 },
]);
assert(highMaster?.proposalItemId === "p1", "highest confidence wins");

assert(wordsToTokenBudget(100) === 130, "1.3 tokens per word");

const dense = measureProposalLength({
  requirementText: Array.from({ length: 400 }, () => "need").join(" "),
  proposalText: Array.from({ length: 2000 }, () => "prose").join(" "),
  proposalPageCount: 8,
});
assert(dense.requirementWordCount === 400, "counts requirement words from extract");
assert(dense.proposalWordCount === 2000, "counts proposal words from extract");
assert(dense.proposalPageCount === 8, "keeps PDF pages when density is prose-like");

const sparse = measureProposalLength({
  requirementText: "Need CRM.",
  proposalText: Array.from({ length: 40 }, () => "logo").join(" "),
  proposalPageCount: 11,
});
assert(sparse.proposalWordCount === 40, "sparse extract keeps measured words");
assert(sparse.proposalPageCount === 1, "derives pages from words when density is absurd");

const overlayReplacesInvented = overlayMeasuredLengthAnalysis(
  {
    proposalWordCount: 550,
    proposalPageCount: 11,
    requirementWordCount: 4000,
    requirementComplexityScore: 0.9,
  },
  measureProposalLength({
    requirementText: Array.from({ length: 800 }, () => "need").join(" "),
    proposalText: Array.from({ length: 2020 }, () => "prose").join(" "),
    proposalPageCount: 8,
  }),
);
assert(
  overlayReplacesInvented.proposalWordCount === 2020,
  "standing ingest overlay replaces LLM 550-word invention with fullText counts",
);
assert(
  overlayReplacesInvented.proposalPageCount === 8,
  "standing ingest overlay keeps PDF pages when fullText density is prose-like",
);
assert(
  overlayReplacesInvented.requirementWordCount === 800,
  "standing ingest overlay replaces LLM requirement words with fullText counts",
);

assert(
  canonicalizeSectionKey("Executive Summary") === "overview",
  "slugger maps executive summary to overview",
);
assert(
  canonicalizeSectionKey("cover_and_overview") === "overview",
  "slugger maps cover_and_overview to overview",
);
assert(
  lookupBySectionKey({ overview: { purpose: "intro" } }, "cover_overview")
    ?.purpose === "intro",
  "planner/exemplar lookup uses the same slugger",
);

assert(
  canonicalizeSectionKey("Key Considerations & Assumptions") === "considerations",
  "containment rule collapses a longer heading onto considerations",
);
assert(
  canonicalizeSectionKey("Requested Solution & Approach") === "requested_solution",
  "containment rule collapses a longer heading onto requested_solution",
);
assert(
  canonicalizeSectionKey("Recommended Solution Overview") === "requested_solution",
  "containment rule collapses recommended_solution variants onto requested_solution too",
);
assert(
  canonicalizeSectionKey("Recommended Solution") === "requested_solution",
  "exact recommended_solution aliases onto requested_solution",
);
assert(
  canonicalizeSectionKey("Unrequested Solutions") === "unrequested_solutions",
  "containment rule does not fire on a look-alike word without a real boundary",
);
assert(
  canonicalizeSectionKey("a_note_for_vbike") === "note_for_client",
  "leading a_ on closing notes still canonicalizes to note_for_client",
);
assert(
  canonicalizeSectionKey("Note for Acme Corp") === "note_for_client",
  "note_for_* normalization handles multi-word customer names too",
);

const goldMean = goldWordCountsForStopgapMean({
  caseStudies: [
    { id: "a", lengthAnalysis: { proposalWordCount: 2443, proposalPageCount: 9 } },
    { id: "b", lengthAnalysis: { proposalWordCount: 2020, proposalPageCount: 8 } },
    { id: "c", lengthAnalysis: { proposalWordCount: 2057, proposalPageCount: 9 } },
  ],
});
assert(goldMean.mean === 2173, "stopgap mean is overlay gold words");
assert(goldMean.skipped.length === 0, "in-band golds are not skipped");

const threeWithOneOutOfBand = goldWordCountsForStopgapMean({
  organizationId: "1003",
  caseStudies: [
    { id: "ok1", lengthAnalysis: { proposalWordCount: 2000, proposalPageCount: 8 } },
    { id: "ok2", lengthAnalysis: { proposalWordCount: 2200, proposalPageCount: 8 } },
    {
      id: "dense",
      filename: "technical.pdf",
      lengthAnalysis: { proposalWordCount: 3000, proposalPageCount: 2 },
    },
  ],
});
assert(
  threeWithOneOutOfBand.bypassed,
  "density skip does not drop the mean below 3 usable studies",
);
assert(
  threeWithOneOutOfBand.words.length === 3,
  "bypass includes every overlay word count",
);
assert(
  threeWithOneOutOfBand.mean === Math.round((2000 + 2200 + 3000) / 3),
  "bypass mean uses all overlay words, not the in-band pair only",
);

const fiveWithOneOutOfBand = goldWordCountsForStopgapMean({
  caseStudies: [
    { id: "1", lengthAnalysis: { proposalWordCount: 2000, proposalPageCount: 8 } },
    { id: "2", lengthAnalysis: { proposalWordCount: 2100, proposalPageCount: 8 } },
    { id: "3", lengthAnalysis: { proposalWordCount: 2200, proposalPageCount: 8 } },
    { id: "4", lengthAnalysis: { proposalWordCount: 2300, proposalPageCount: 8 } },
    {
      id: "5",
      lengthAnalysis: { proposalWordCount: 4000, proposalPageCount: 2 },
    },
  ],
});
assert(!fiveWithOneOutOfBand.bypassed, "skip is allowed when 3+ remain in the mean");
assert(fiveWithOneOutOfBand.words.length === 4, "out-of-band row excluded from mean only");
assert(
  fiveWithOneOutOfBand.mean === Math.round((2000 + 2100 + 2200 + 2300) / 4),
  "mean ignores the out-of-band study when enough remain",
);

const stopgapPlaybook = {
  id: "stopgap",
  caseStudyCount: 3,
  confidenceLevel: "low" as const,
  sectionSpecsJson: {
    scope: {},
    approach: {},
  },
  lengthModelJson: {
    coefficients: { intercept: 4, perThousandWords: -2.5, perComplexityPoint: 3 },
  },
};
const stopgapStudies = [
  { id: "a", lengthAnalysis: { proposalWordCount: 2400, proposalPageCount: 9 } },
  { id: "b", lengthAnalysis: { proposalWordCount: 2000, proposalPageCount: 8 } },
  { id: "c", lengthAnalysis: { proposalWordCount: 2100, proposalPageCount: 9 } },
];
assert(
  goldWordCountsForStopgapMean({ caseStudies: stopgapStudies }).mean === 2167,
  "document gold mean stays overlay words",
);
const stopgapPlan = planSectionLengths({
  sectionKeys: ["scope", "approach"],
  requirementWordCount: 400,
  contentPlaybook: stopgapPlaybook,
  caseStudies: stopgapStudies,
});
assert(stopgapPlan.planned.scope === 80, "missing section analysis uses the floor");
assert(stopgapPlan.planned.approach === 80, "missing section analysis uses the floor for every key");
assert(
  stopgapPlan.targets.every((row) => row.fallback === "floor"),
  "empty specs and no analysis fall back to floor, not a document-mean split",
);
assert(stopgapPlan.documentGoldMean === 2167, "gold document mean is logged unused");
assert(stopgapPlan.lengthSource === "section_gold_mean", "planner uses per-section gold/spec/floor");
assert(stopgapPlan.documentBudget === 160, "budget is the sum of section targets");

const linearPlan = planSectionLengths({
  sectionKeys: ["scope", "approach"],
  requirementWordCount: 2000,
  requirementComplexityScore: 0.5,
  contentPlaybook: {
    id: "high",
    caseStudyCount: 8,
    confidenceLevel: "high",
    sectionSpecsJson: { scope: {}, approach: {} },
    lengthModelJson: {
      coefficients: {
        intercept: 4,
        perThousandWords: 1.2,
        perComplexityPoint: 3,
      },
    },
  },
  caseStudies: [
    { id: "gold", lengthAnalysis: { proposalWordCount: 9000, proposalPageCount: 20 } },
    { id: "gold2", lengthAnalysis: { proposalWordCount: 9000, proposalPageCount: 20 } },
    { id: "gold3", lengthAnalysis: { proposalWordCount: 9000, proposalPageCount: 20 } },
  ],
});
const fittedPages = 4 + 1.2 * (2000 / 1000) + 3 * 0.5;
const fittedWords = Math.round(fittedPages * 350);
assert(
  linearPlan.fittedDocumentTotal != null &&
    Math.abs(linearPlan.fittedDocumentTotal - fittedWords) <= 2,
  "high confidence still computes the fitted document total for the log",
);
assert(linearPlan.planned.scope === 80, "high confidence does not even-split the fitted total");
assert(
  linearPlan.planned.scope + linearPlan.planned.approach !== fittedWords,
  "high-confidence fitted total is not applied to section targets",
);

assert(
  exemplarsForSection(
    [
      {
        id: "cs",
        sectionAnalysis: [{ sectionKey: "Executive Summary", body: "ex" }],
      },
    ],
    "cover_overview",
  ).length === 1,
  "exemplars match via the shared slugger",
);

assert(
  sectionsBelowPlannedWordBand(
    [{ key: "scope", body: Array.from({ length: 50 }, () => "word").join(" ") }],
    { scope: 200 },
  ).join() === "scope",
  "word-band gate names short sections",
);
assert(
  /scope/.test(
    proposalGenerateQualityGateError({
      source: "ai",
      shortSectionKeys: ["scope"],
    }),
  ),
  "coworker error names the short sections",
);

const lengths = planSectionLengths({
  sectionKeys: ["scope", "approach"],
  requirementWordCount: 1600,
  contentPlaybook: {
    id: "x",
    caseStudyCount: 4,
    confidenceLevel: "low",
    sectionSpecsJson: {
      scope: { targetWordRange: [200, 400] },
      approach: { targetWordRange: [300, 500] },
    },
    lengthModelJson: {
      fallback: "proportional",
      coefficients: { intercept: 4, perThousandWords: 1.2, perComplexityPoint: 3 },
    },
  },
});
assert(lengths.planned.scope === 300, "missing analysis uses spec range midpoint");
assert(lengths.planned.approach === 400, "approach uses its own spec midpoint, not a shared total");
assert(
  lengths.targets.every((row) => row.fallback === "spec_range_mid"),
  "spec mid is the fallback when analysis and variance log are missing",
);
assert(lengths.lengthSource === "section_gold_mean", "spec-only plans stay per-section");

const notePlan = planSectionLengths({
  sectionKeys: ["note_for_client", "overview"],
  requirementWordCount: 800,
  contentPlaybook: {
    id: "note",
    caseStudyCount: 4,
    confidenceLevel: "low",
    sectionSpecsJson: {
      a_note_for_vbike: { targetWordRange: [100, 200] },
      overview: { targetWordRange: [150, 400] },
    },
  },
  caseStudies: [
    { id: "a", lengthAnalysis: { proposalWordCount: 2200, proposalPageCount: 8 } },
    { id: "b", lengthAnalysis: { proposalWordCount: 2300, proposalPageCount: 8 } },
    { id: "c", lengthAnalysis: { proposalWordCount: 2100, proposalPageCount: 8 } },
  ],
});
assert(notePlan.planned.note_for_client === 150, "canonical note spec uses midpoint");
assert(notePlan.documentGoldMean === 2200, "note plan logs gold mean unused");

const comparisonPlan = planSectionLengths({
  sectionKeys: ["requested_vs_recommended", "this_is_what_we_compare", "scope"],
  requirementWordCount: 400,
  contentPlaybook: {
    id: "cmp",
    caseStudyCount: 3,
    confidenceLevel: "low",
    sectionSpecsJson: {},
  },
  caseStudies: [
    {
      id: "g1",
      sectionAnalysis: [
        { sectionKey: "requested_vs_recommended", wordCount: 40 },
        { sectionKey: "this_is_what_we_compare", wordCount: 30 },
        { sectionKey: "scope", wordCount: 100 },
      ],
    },
    {
      id: "g2",
      sectionAnalysis: [
        { sectionKey: "requested_vs_recommended", wordCount: 50 },
        { sectionKey: "this_is_what_we_compare", wordCount: 32 },
        { sectionKey: "scope", wordCount: 140 },
      ],
    },
    {
      id: "g3",
      sectionAnalysis: [
        { sectionKey: "requested_vs_recommended", wordCount: 60 },
        { sectionKey: "this_is_what_we_compare", wordCount: 34 },
        { sectionKey: "scope", wordCount: 120 },
      ],
    },
  ],
});
assert(
  isTableHeavySectionKey("requested_vs_recommended"),
  "requested_vs_recommended is table-heavy",
);
assert(
  isTableHeavySectionKey("this_is_what_we_compare"),
  "compare key is table-heavy",
);
assert(
  comparisonPlan.planned.requested_vs_recommended === 50,
  "comparison table uses gold section wordCount mean",
);
assert(
  comparisonPlan.planned.this_is_what_we_compare === 32,
  "second comparison key uses its own gold mean",
);
assert(comparisonPlan.planned.scope === 120, "scope mean is independent of the comparison tables");
assert(
  comparisonPlan.targets.find((row) => row.key === "requested_vs_recommended")
    ?.fallback === "section_analysis_mean",
  "comparison fallback is the gold section mean",
);
assert(
  comparisonPlan.targets.find((row) => row.key === "requested_vs_recommended")
    ?.studiesUsed === 3,
  "studiesUsed is the matching gold count",
);

const aliasPlan = planSectionLengths({
  sectionKeys: ["executive_summary"],
  requirementWordCount: 200,
  contentPlaybook: { id: "alias", caseStudyCount: 3, confidenceLevel: "low" },
  caseStudies: [
    { id: "a", sectionAnalysis: [{ sectionKey: "overview", wordCount: 180 }] },
    {
      id: "b",
      sectionAnalysis: [{ sectionKey: "Executive Summary", wordCount: 200 }],
    },
    { id: "c", sectionAnalysis: [{ sectionKey: "overview", wordCount: 220 }] },
  ],
});
assert(
  aliasPlan.planned.executive_summary === 200,
  "skeleton executive_summary matches gold overview via the shared slugger",
);
assert(
  aliasPlan.targets[0]?.fallback === "section_analysis_mean",
  "alias hit is a section-analysis mean, not a document share",
);

const variancePlan = planSectionLengths({
  sectionKeys: ["scope"],
  requirementWordCount: 200,
  contentPlaybook: {
    id: "var",
    caseStudyCount: 3,
    confidenceLevel: "low",
    sectionSpecsJson: { scope: { targetWordRange: [200, 400] } },
    varianceLogJson: { scope: { wordMean: 175 } },
  },
});
assert(variancePlan.planned.scope === 175, "variance log beats spec midpoint when analysis is missing");
assert(
  variancePlan.targets[0]?.fallback === "variance_log_mean",
  "variance log is the second fallback",
);

const brdOutlinePlan = planSectionLengths({
  sectionKeys: [
    "overview",
    "requested_solution",
    "architecture",
    "rollout",
    "mystery_chapter",
  ],
  requirementWordCount: 800,
  contentPlaybook: {
    id: "outline",
    caseStudyCount: 3,
    confidenceLevel: "low",
    sectionSpecsJson: {
      overview: {},
      requested_solution: {},
    },
  },
  caseStudies: [
    { id: "a", lengthAnalysis: { proposalWordCount: 2200, proposalPageCount: 8 } },
    { id: "b", lengthAnalysis: { proposalWordCount: 2200, proposalPageCount: 8 } },
    { id: "c", lengthAnalysis: { proposalWordCount: 2200, proposalPageCount: 8 } },
  ],
});
assert(brdOutlinePlan.planned.architecture === 80, "added keys stay on the 80-word floor");
assert(brdOutlinePlan.planned.rollout === 80, "rollout is not inflated");
assert(brdOutlinePlan.planned.mystery_chapter === 80, "unrecognized chapters use the floor");
assert(
  (brdOutlinePlan.documentBudget ?? 0) === 400,
  "five floor sections do not inflate to 4x gold",
);

const recapAll = buildRollingRecap(
  Array.from({ length: 14 }, (_, i) => `Chapter ${i}: unique fact ${i}`),
);
assert(recapAll.length === 14, "rolling recap keeps a line per leaf");
assert(
  /already covered/.test(recapAll[0] || ""),
  "older leaves compress to a do-not-repeat heading",
);
assert(
  /unique fact 13/.test(recapAll[13] || ""),
  "recent leaves keep full recap text",
);

const closedBody =
  "Northwind requires 80 concurrent operator seats for night coverage across regions.";
const closed = extractClosedClaims(closedBody);
assert(closed.length > 0, "closed claims extracted from written body");
assert(
  closed.some((c) => /80 concurrent operator seats/i.test(c)),
  "quantity phrases are closed claims",
);
const recapLine = compactSectionRecap({
  heading: "Scope",
  body: closedBody,
  key: "scope_of_work",
});
assert(
  recapLine.includes("80 concurrent operator seats"),
  "recap stores quantity claims, not a body clip",
);
assert(
  recapOverlapSnippets(
    `Repeat for later chapter: ${closedBody}`,
    [recapLine],
  ).length > 0,
  "later body that repeats closed claims is flagged",
);
assert(
  recapOverlapSnippets(
    "The platform also covers night coverage across regions without restating seat counts.",
    [recapLine],
  ).length === 0,
  "shared theme words without the closed claim are not overlap",
);
assert(
  recapOverlapSnippets("Unrelated delivery sequencing and commercial timeline.", [
    recapLine,
  ]).length === 0,
  "unrelated later body does not overlap",
);

const merged = mergeOutlineIntoSkeleton(
  [{ key: "overview", title: "Overview", body: "" }],
  [
    { key: "overview", title: "Overview", purpose: "dup" },
    { key: "architecture", title: "Architecture", purpose: "design" },
  ],
);
assert(merged.length === 2, "outline merge appends new keys only");
assert(merged[1]?.key === "architecture", "architecture is appended");

const similar = retrieveSimilarCaseStudies(
  { themes: ["integration", "api"], summary: "Need system integration" },
  [
    {
      id: "a",
      sectionAnalysis: [
        {
          sectionKey: "technical_approach",
          sourceRequirementRefs: ["BRD integration api"],
        },
      ],
    },
    {
      id: "b",
      sectionAnalysis: [
        { sectionKey: "pricing", sourceRequirementRefs: ["renewal discount"] },
      ],
    },
  ],
  1,
);
assert(similar[0]?.id === "a", "lexical retrieval prefers overlapping themes");

assert(
  !shouldRejectPairSlot(0.4, false),
  "advisory 0.4 does not require use-anyway",
);
assert(shouldRejectPairSlot(0.2, false), "below 0.3 requires use-anyway");
assert(!shouldRejectPairSlot(0.2, true), "use-anyway admits a weak slot");
assert(
  shouldPersistScoredPair({ pairingSource: "user_explicit", confidence: 0.4 }),
  "user_explicit is never dropped for the old 0.65 gate",
);
assert(
  shouldPersistScoredPair({ pairingSource: "user_explicit", confidence: 0.1 }),
  "user_explicit persists even at 0.1 after use-anyway",
);
assert(
  !shouldPersistScoredPair({ pairingSource: "legacy_auto", confidence: 0.4 }),
  "legacy_auto still requires 0.65",
);
assert(
  shouldPersistScoredPair({ pairingSource: "legacy_auto", confidence: 0.7 }),
  "legacy_auto at 0.65+ is kept",
);

assert(nextContentPlaybookVersion(null) === 1, "first content playbook is v1");
assert(nextContentPlaybookVersion(3) === 4, "versions are append-only +1");
assert(
  pairingSourceForBackfill(null) === "legacy_auto",
  "backfill tags unknown pairs as legacy_auto",
);
assert(
  pairingSourceForBackfill("user_explicit") === "user_explicit",
  "backfill does not overwrite user_explicit",
);
assert(
  backfillWritesVisualPlaybookFk() === false,
  "backfill does not write contentPlaybookId on old visual playbooks",
);

assert(proposalGenerateAttemptCount(null) === 2, "max is section pass + last-resort whole-doc");
assert(
  proposalGenerateAttemptCount(tooFew) === 2,
  "below synthesis floor still starts with section-by-section",
);
assert(
  proposalGenerateAttemptCount(latest) === 2,
  "usable content playbook still allows one whole-doc last resort",
);

const stopgap = stopgapContentPlaybookFromSkeleton(
  [
    { key: "scope", title: "Scope" },
    { key: "commercials", title: "Commercials" },
  ],
  tooFew,
);
assert(stopgap.id === "few", "stopgap reuses latest id when present");
assert(
  Boolean(contentPlaybookForSectionGenerate({
    resolved: null,
    latestForOrg: tooFew,
    skeleton: [{ key: "scope", title: "Scope" }],
  }).id),
  "section generate always gets a writing playbook",
);
assert(
  contentPlaybookForSectionGenerate({
    resolved: latest,
    skeleton: [{ key: "scope" }],
  }).id === "latest",
  "synthesized playbook wins over stopgap",
);
assert(isAiServiceTimeoutReason("TimeoutError"), "fetch abort is a timeout");
assert(!isAiServiceTimeoutReason("kb_unavailable"), "kb is not a timeout");

assert(isProductKbUnavailableReason("kb_unavailable"), "exact kb reason");
assert(
  isProductKbUnavailableReason("kb_unavailable: ConnectTimeout"),
  "prefixed kb reason",
);
assert(!isProductKbUnavailableReason("llm_error:timeout"), "timeout is not kb");
assert(isGeminiUnavailableReason("gemini_unavailable"), "exact gemini capacity reason");
assert(
  shouldRetryWholeDocumentGenerate("llm_error:timeout"),
  "quality/timeout still retries",
);
assert(
  !shouldRetryWholeDocumentGenerate("kb_unavailable"),
  "kb down does not burn a second generate",
);
assert(
  !shouldRetryWholeDocumentGenerate("gemini_unavailable"),
  "gemini 503 does not burn remaining leaves or a second generate",
);
assert(
  proposalGenerateQualityGateError({ reason: "kb_unavailable" }) ===
    PRODUCT_KB_UNAVAILABLE_MESSAGE,
  "kb down uses the catalog lookup message",
);
assert(
  proposalGenerateQualityGateError({ reason: "gemini_unavailable" }) ===
    GEMINI_UNAVAILABLE_MESSAGE,
  "gemini 503 uses the high-demand message",
);
assert(
  /timed out while writing/.test(
    proposalGenerateQualityGateError({
      reason: "llm_error:timeout",
      timedOut: true,
    }),
  ),
  "timeout copy is unchanged when KB is up",
);

const ordered = partitionSkeletonForGeneration([
  { key: "executive_summary", title: "Executive summary" },
  { key: "scope", title: "Scope" },
  { key: "cover", title: "Cover" },
  { key: "approach", title: "Approach" },
]);
assert(
  JSON.stringify(ordered.generationOrder.map((s) => s.key)) ===
    JSON.stringify(["scope", "approach", "executive_summary", "cover"]),
  "body sections first; exec summary / cover last",
);
assert(
  sectionDraftNeedsRetry({ source: "heuristic", body: "short", targetWords: 200 }),
  "non-AI drafts retry",
);
assert(
  sectionDraftNeedsRetry({
    source: "ai",
    body: "Too short.",
    targetWords: 220,
  }),
  "too-short AI drafts retry",
);
assert(
  sectionDraftNeedsRetry({
    source: "ai",
    body: Array.from({ length: 120 }, () => "word").join(" "),
    targetWords: 220,
  }),
  "35%-of-target drafts still retry — 80% is the length floor",
);
assert(
  !sectionDraftNeedsRetry({
    source: "ai",
    body: Array.from({ length: 180 }, () => "word").join(" "),
    targetWords: 220,
  }),
  "adequate AI drafts near the target do not retry",
);

assert(
  sectionDraftNeedsRetry({
    source: "ai",
    body: "Short intro.",
    targetWords: 80,
  }),
  "short comparison-section prose without a table still fails the 80-word floor",
);
assert(
  !sectionDraftNeedsRetry({
    source: "ai",
    body: "Capability mapping.",
    tableRows: [
      { cells: ["Voice minutes", "5,000 / month", "Lola Voicebot"] },
      { cells: ["Web chat", "WhatsApp + site", "AI Web Chatbot"] },
      { cells: ["Languages", "English, Hindi", "English and Hindi"] },
    ],
    targetWords: 80,
  }),
  "filled requested_vs_recommended table is not treated as too-short prose",
);
assert(
  sectionsBelowPlannedWordBand(
    [
      {
        key: "this_is_what_we_compare",
        body: "See the grid.",
        tableRows: [
          { cells: ["Channel", "As-is", "To-be"] },
          { cells: ["Phone", "Spreadsheet", "CCaaS"] },
        ],
      },
    ],
    { this_is_what_we_compare: 80 },
  ).length === 0,
  "word-band gate counts table cells and does not fail compare sections",
);
assert(
  sectionsBelowPlannedWordBand(
    [{ key: "this_is_what_we_compare", body: "See the grid." }],
    { this_is_what_we_compare: 80 },
  ).join() === "this_is_what_we_compare",
  "compare section with no table still fails when body is a stub",
);

const scaled = planSectionLengths({
  sectionKeys: ["overview", "commercials"],
  requirementWordCount: 400,
  contentPlaybook: latest,
  caseStudies: [
    {
      lengthAnalysis: {
        proposalWordCount: 200,
        lengthSpec: {
          documentWordCount: 200,
          sectionWords: { overview: 400, commercials: 400 },
        },
      },
      sectionAnalysis: [],
    },
  ],
});
assert(scaled.lengthConfidence === "low", "section vs document disagreement is low confidence");
assert(scaled.lengthSource === "measured_scaled", "scales to document total");
assert(
  Math.abs((scaled.planned.overview || 0) + (scaled.planned.commercials || 0) - 200) <= 2,
  "scaled sum matches gold document words",
);

console.log("proposal-content-playbook.test.ts ok");
