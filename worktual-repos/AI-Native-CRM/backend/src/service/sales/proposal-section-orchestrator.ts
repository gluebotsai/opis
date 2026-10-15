/**
 * Section-by-section proposal generation using the org content playbook.
 */

import {
  AI_SERVICE_MAX_TIMEOUT_MS,
  callAiServiceAgent,
} from "@/service/ai/ai-service-client";
import {
  asRecord,
  buildRollingRecap,
  canonicalizeSectionSpecs,
  compactSectionRecap,
  exemplarsForSection,
  GEMINI_UNAVAILABLE_REASON,
  isAiServiceTimeoutReason,
  isGeminiUnavailableReason,
  lookupBySectionKey,
  partitionSkeletonForGeneration,
  planSectionLengths,
  retrieveSimilarCaseStudies,
  sectionDraftNeedsRetry,
  sectionsBelowPlannedWordBand,
  sectionDraftWordCount,
  wordsToTokenBudget,
  type CaseStudyLike,
  type ContentPlaybookLike,
  type RequirementProfileLike,
} from "@/lib/proposal-content-playbook";
import type { ProposalSection } from "@/lib/proposal-sections";
import {
  backoffIfRateLimited,
  effectiveLeafConcurrency,
  noteProposalWriterResult,
} from "@/lib/proposal-gemini-limiter";
import { upsertProposalGenerationLeaf } from "@/dao/sales/proposal-generation-run";

export type OrchestratedSection = ProposalSection & {
  heading?: string;
  tableRows?: Array<{ cells: string[] }>;
  kind?: string;
  purpose?: string;
  tableSpec?: unknown;
};

const COMMERCIAL_KEY =
  /pricing|commercial|usage|compare|comparison|one_time|monthly|mrc|otc/i;
const MONEY_COLUMN = /price|amount|rate|fee|cost|charge|total/i;

function specColumns(tableSpec: unknown): string[] {
  if (!tableSpec || typeof tableSpec !== "object" || Array.isArray(tableSpec)) {
    return [];
  }
  const cols = (tableSpec as { columns?: unknown }).columns;
  return Array.isArray(cols)
    ? cols.map((c) => String(c).trim()).filter(Boolean)
    : [];
}

/** Commercial sections whose learned table is missing rows or money cells. */
export function commercialTableNeedsRetry(section: {
  key?: string;
  title?: string;
  tableSpec?: unknown;
  tableRows?: Array<{ cells?: string[] }>;
}): boolean {
  const key = `${section.key || ""} ${section.title || ""}`;
  if (!COMMERCIAL_KEY.test(key)) return false;
  const cols = specColumns(section.tableSpec);
  if (!cols.length) return false;
  const rows = Array.isArray(section.tableRows) ? section.tableRows : [];
  if (!rows.length) return true;
  const moneyIdx = cols
    .map((col, i) => (MONEY_COLUMN.test(col) ? i : -1))
    .filter((i) => i >= 0);
  if (!moneyIdx.length) return false;
  return rows.every((row) =>
    moneyIdx.every((i) => !String(row.cells?.[i] || "").trim()),
  );
}

export async function retryCommercialTableGaps(
  input: {
    organizationId: string;
    sections: OrchestratedSection[];
    requirementText: string;
    products: unknown;
    allowedProducts: string[];
    profile: unknown;
    knowledgeBase?: string;
    dealBrief?: string;
  },
  deps?: { callAgent?: AgentCaller },
): Promise<{ sections: OrchestratedSection[]; retried: string[] }> {
  const callAgent = deps?.callAgent ?? callAiServiceAgent;
  const sections = input.sections.map((section) => ({ ...section }));
  const retried: string[] = [];
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    if (!section || !commercialTableNeedsRetry(section)) continue;
    const key = String(section.key || section.id || "");
    console.info("[proposal-generate] commercial table retry", {
      organizationId: input.organizationId,
      key,
    });
    const again = await generateOneSection({
      section,
      spec:
        (section as OrchestratedSection & { tableSpec?: unknown }).tableSpec ??
        null,
      purpose: section.purpose,
      targetWords: 220,
      exemplars: [],
      rollingRecap: [],
      requirementText: input.requirementText,
      profile: input.profile,
      allowedProducts: input.allowedProducts,
      products: input.products,
      knowledgeBase: input.knowledgeBase,
      organizationId: input.organizationId,
      callAgent,
      dealBrief: input.dealBrief,
      tableFillRetry: true,
    });
    retried.push(key);
    if (again.source === "ai") sections[i] = again.section;
  }
  return { sections, retried };
}

function qaMode(): "shadow" | "active" | "off" {
  const raw = String(process.env.PROPOSAL_CONTENT_QA_MODE || "shadow")
    .trim()
    .toLowerCase();
  if (raw === "active" || raw === "off") return raw;
  return "shadow";
}

type AgentCaller = typeof callAiServiceAgent;

async function generateOneSection(input: {
  section: OrchestratedSection;
  spec: unknown;
  purpose?: string;
  targetWords: number;
  exemplars: unknown[];
  rollingRecap: string[];
  requirementText: string;
  profile: unknown;
  allowedProducts: string[];
  products: unknown;
  knowledgeBase?: string;
  organizationId: string;
  callAgent: AgentCaller;
  dealBrief?: string;
  pricingTokens?: string;
  tableFillRetry?: boolean;
}): Promise<{ section: OrchestratedSection; source: string; reason?: string }> {
  const specRec = asRecord(input.spec);
  const purpose = String(
    input.purpose || specRec.purpose || input.section.purpose || "",
  ).trim();
  const key = String(input.section.key || input.section.id || "");
  console.info("[proposal-generate] section write start", {
    organizationId: input.organizationId,
    key,
    heading: String(input.section.title || key),
    targetWords: input.targetWords,
    recapLines: input.rollingRecap.length,
    kbChars: String(input.knowledgeBase || "").length,
  });
  const payload = {
    sectionKey: String(input.section.key || input.section.id || ""),
    heading: String(input.section.title || input.section.key || ""),
    purpose: purpose || undefined,
    section: input.section,
    spec: input.spec,
    targetWords: input.targetWords,
    targetTokens: wordsToTokenBudget(input.targetWords),
    exemplars: input.exemplars,
    rollingRecap: input.rollingRecap,
    alreadyCovered: input.rollingRecap,
    requirementText: input.requirementText,
    profile: input.profile,
    allowedProducts: input.allowedProducts,
    products: input.products,
    knowledgeBase: input.knowledgeBase || undefined,
    tableSpec: (input.section as { tableSpec?: unknown }).tableSpec,
    organizationId: input.organizationId,
    dealBrief: input.dealBrief,
    pricingTokens: input.pricingTokens,
    tableFillRetry: input.tableFillRetry || undefined,
  };
  const write = (extra?: Record<string, unknown>) =>
    input.callAgent<{
      source?: string;
      reason?: string;
      section?: Record<string, unknown>;
    }>(
      "proposal-generate-section",
      { ...payload, ...extra },
      { timeoutMs: AI_SERVICE_MAX_TIMEOUT_MS },
    );

  let result = await write();
  if (
    !result ||
    isAiServiceTimeoutReason(result.reason) ||
    isGeminiUnavailableReason(result.reason)
  ) {
    if (!isGeminiUnavailableReason(result?.reason)) {
      console.warn("[proposal-generate] section write timeout, retrying once", {
        organizationId: input.organizationId,
        key,
      });
      result = (await write({ formatRetry: true })) ?? result;
    }
  }
  if (
    !result ||
    isAiServiceTimeoutReason(result.reason) ||
    isGeminiUnavailableReason(result.reason)
  ) {
    noteProposalWriterResult(GEMINI_UNAVAILABLE_REASON);
    await backoffIfRateLimited(GEMINI_UNAVAILABLE_REASON);
    console.warn("[proposal-generate] section write unavailable", {
      organizationId: input.organizationId,
      key,
      reason: result?.reason || GEMINI_UNAVAILABLE_REASON,
    });
    return {
      section: input.section,
      source: "heuristic",
      reason: GEMINI_UNAVAILABLE_REASON,
    };
  }

  let rec = asRecord(result.section);
  let body = String(rec.body || "").trim();
  let source = String(result.source || "heuristic");
  let reason = result.reason;
  if (!body && source === "ai") {
    const retry = await write({ formatRetry: true });
    rec = asRecord(retry?.section);
    body = String(rec.body || "").trim();
    source = String(retry?.source || source);
    reason = retry?.reason || reason;
    if (
      !retry ||
      isAiServiceTimeoutReason(reason) ||
      isGeminiUnavailableReason(reason)
    ) {
      noteProposalWriterResult(GEMINI_UNAVAILABLE_REASON);
      await backoffIfRateLimited(GEMINI_UNAVAILABLE_REASON);
      return {
        section: input.section,
        source: "heuristic",
        reason: GEMINI_UNAVAILABLE_REASON,
      };
    }
  }
  noteProposalWriterResult(reason);
  await backoffIfRateLimited(reason);
  const section: OrchestratedSection = {
    ...input.section,
    title: String(rec.heading || input.section.title || ""),
    heading: String(rec.heading || input.section.title || ""),
    body,
    kind: String(rec.kind || "prose"),
    tableRows: Array.isArray(rec.tableRows)
      ? (rec.tableRows as Array<{ cells: string[] }>)
      : [],
  };
  console.info("[proposal-generate] section write ok", {
    organizationId: input.organizationId,
    key,
    source,
    reason,
    words: sectionDraftWordCount({
      body,
      tableRows: section.tableRows,
    }),
    targetWords: input.targetWords,
    short: sectionDraftNeedsRetry({
      source,
      body,
      tableRows: section.tableRows,
      targetWords: input.targetWords,
    }),
  });
  return { section, source, reason };
}

export async function generateProposalSectionsFromContentPlaybook(
  input: {
    organizationId: string;
    skeleton: OrchestratedSection[];
    contentPlaybook: ContentPlaybookLike;
    caseStudies: CaseStudyLike[];
    profile: RequirementProfileLike;
    requirementText: string;
    requirementWordCount: number;
    allowedProducts: string[];
    products: unknown;
    generationRunId?: string | null;
    dealBrief?: string | null;
    pricingTokens?: string | null;
    measuredLengthSpec?: unknown;
  },
  deps?: { callAgent?: AgentCaller },
): Promise<{
  sections: OrchestratedSection[];
  warnings: string[];
  qaFailedKeys: string[];
  plannedLengths: Record<string, number>;
  shortSectionKeys: string[];
  reason?: string;
}> {
  const callAgent = deps?.callAgent ?? callAiServiceAgent;
  const warnings: string[] = [];
  const specMap = canonicalizeSectionSpecs(
    input.contentPlaybook.sectionSpecsJson,
  );

  let skeleton = input.skeleton;
  console.info("[proposal-generate] writing playbook slots", {
    organizationId: input.organizationId,
    playbookSlots: skeleton.map((s) => String(s.key || s.id || "")),
    requirementWords: input.requirementWordCount,
    products: input.allowedProducts,
  });

  console.info("[proposal-generate] kb retrieve start", {
    organizationId: input.organizationId,
    productCount: Array.isArray(input.products) ? input.products.length : 0,
    allowedProducts: input.allowedProducts,
  });
  const kb = await callAgent<{
    source?: string;
    reason?: string;
    knowledgeBase?: string;
  }>(
    "proposal-kb-retrieve",
    {
      organizationId: input.organizationId,
      products: input.products,
      allowedProducts: input.allowedProducts,
      requirementText: input.requirementText,
      requirementSummary: String(
        (input.profile as { summary?: unknown })?.summary || "",
      ),
    },
    { timeoutMs: AI_SERVICE_MAX_TIMEOUT_MS },
  );
  const knowledgeBase = [
    String(kb?.knowledgeBase || "").trim(),
    String(input.pricingTokens || "").trim(),
  ]
    .filter(Boolean)
    .join("\n\n");
  console.info("[proposal-generate] kb retrieve done", {
    organizationId: input.organizationId,
    source: kb?.source,
    reason: kb?.reason,
    kbChars: knowledgeBase.length,
  });
  if (String(kb?.reason || "") === "kb_unavailable") {
    console.warn("[proposal-generate] kb unavailable, stopping generate", {
      organizationId: input.organizationId,
    });
    return {
      sections: skeleton,
      warnings,
      qaFailedKeys: [],
      plannedLengths: {},
      shortSectionKeys: [],
      reason: "kb_unavailable",
    };
  }

  const keys = skeleton.map((s) => String(s.key || s.id || ""));
  const lengthPlan = planSectionLengths({
    sectionKeys: keys,
    requirementWordCount: input.requirementWordCount,
    contentPlaybook: input.contentPlaybook,
    caseStudies: input.caseStudies,
    organizationId: input.organizationId,
  });
  const planned = lengthPlan.planned;
  const plannedTotal = Object.values(planned).reduce((n, w) => n + w, 0);
  console.info("[proposal-generate] planSectionLengths", {
    organizationId: input.organizationId,
    contentPlaybookId: input.contentPlaybook.id,
    caseStudyCount: input.contentPlaybook.caseStudyCount,
    confidenceLevel: input.contentPlaybook.confidenceLevel,
    requirementWordCount: input.requirementWordCount,
    planned,
    plannedTotalWords: plannedTotal,
    sectionTargets: lengthPlan.targets,
    fittedDocumentTotal: lengthPlan.fittedDocumentTotal,
    documentGoldMean: lengthPlan.documentGoldMean,
    documentBudget: lengthPlan.documentBudget,
    lengthSource: lengthPlan.lengthSource,
    outlineLeaves: keys.length,
  });
  const similar = retrieveSimilarCaseStudies(input.profile, input.caseStudies, 3);
  const { body, summary } = partitionSkeletonForGeneration(skeleton);
  const written: OrchestratedSection[] = [];
  const recap: string[] = input.dealBrief?.trim()
    ? [String(input.dealBrief).trim()]
    : [];

  console.info("[proposal-generate] writing sections", {
    organizationId: input.organizationId,
    body: body.map((s) => String(s.key || s.id || "")),
    summary: summary.map((s) => String(s.key || s.id || "")),
    concurrency: effectiveLeafConcurrency(),
  });

  async function writeLeaf(
    section: OrchestratedSection,
    wave: number,
    rolling: string[],
  ) {
    const key = String(section.key || section.id || "");
    if (input.generationRunId) {
      await upsertProposalGenerationLeaf({
        runId: input.generationRunId,
        leafKey: key,
        title: String(section.title || key),
        sectionType: key,
        wave,
        status: "running",
      }).catch(() => undefined);
    }
    const generated = await generateOneSection({
      section,
      spec: lookupBySectionKey(specMap, key) ?? specMap[key] ?? null,
      purpose: section.purpose,
      targetWords: planned[key] || lookupBySectionKey(planned, key) || 220,
      exemplars: exemplarsForSection(
        similar,
        key,
        input.contentPlaybook.exemplarBankJson,
      ),
      rollingRecap: rolling,
      requirementText: input.requirementText,
      profile: input.profile,
      allowedProducts: input.allowedProducts,
      products: input.products,
      knowledgeBase,
      organizationId: input.organizationId,
      callAgent,
      dealBrief: input.dealBrief || undefined,
      pricingTokens: input.pricingTokens || undefined,
    });
    if (input.generationRunId) {
      await upsertProposalGenerationLeaf({
        runId: input.generationRunId,
        leafKey: key,
        status:
          generated.reason === "gemini_unavailable" || generated.source !== "ai"
            ? "failed"
            : "done",
        errorClass: generated.reason || null,
        outputJson: { body: generated.section.body },
      }).catch(() => undefined);
    }
    return { key, generated };
  }

  async function writeWave(
    sections: OrchestratedSection[],
    wave: number,
    parallel: boolean,
  ): Promise<string | undefined> {
    const rolling = buildRollingRecap(recap);
    const limit = parallel ? effectiveLeafConcurrency() : 1;
    if (limit <= 1 || sections.length <= 1) {
      for (const section of sections) {
        const { key, generated } = await writeLeaf(section, wave, rolling);
        if (generated.reason === "kb_unavailable") return "kb_unavailable";
        if (generated.reason === "gemini_unavailable") return "gemini_unavailable";
        if (generated.source !== "ai") {
          warnings.push(
            `Section ${key} was not AI-sourced (${generated.reason || "unknown"}).`,
          );
        }
        written.push(generated.section);
        recap.push(compactSectionRecap(generated.section));
      }
      return undefined;
    }
    let i = 0;
    const results: Array<{ key: string; generated: Awaited<ReturnType<typeof generateOneSection>> }> =
      [];
    const workers = Array.from({ length: Math.min(limit, sections.length) }, async () => {
      while (i < sections.length) {
        const idx = i++;
        const section = sections[idx];
        if (!section) continue;
        results[idx] = await writeLeaf(section, wave, rolling);
      }
    });
    await Promise.all(workers);
    for (const row of results) {
      if (!row) continue;
      if (row.generated.reason === "kb_unavailable") return "kb_unavailable";
      if (row.generated.reason === "gemini_unavailable") {
        return "gemini_unavailable";
      }
      if (row.generated.source !== "ai") {
        warnings.push(
          `Section ${row.key} was not AI-sourced (${row.generated.reason || "unknown"}).`,
        );
      }
      written.push(row.generated.section);
      recap.push(compactSectionRecap(row.generated.section));
    }
    return undefined;
  }

  const stop =
    (await writeWave(body, 1, false)) || (await writeWave(summary, 2, false));
  if (stop) {
    return {
      sections: skeleton,
      warnings,
      qaFailedKeys: [],
      plannedLengths: planned,
      shortSectionKeys: [],
      reason: stop,
    };
  }

  const byKey = new Map(
    written.map((s) => [String(s.key || s.id || ""), s] as const),
  );
  const ordered = skeleton.map(
    (s) => byKey.get(String(s.key || s.id || "")) ?? s,
  );

  const shortSectionKeys = sectionsBelowPlannedWordBand(ordered, planned);
  if (shortSectionKeys.length) {
    console.info("[proposal-generate] word-band short after single write", {
      organizationId: input.organizationId,
      keys: shortSectionKeys,
    });
    warnings.push(
      `These sections were below 80% of the planned word band: ${shortSectionKeys.join(", ")}.`,
    );
  }

  const mode = qaMode();
  let qaFailedKeys: string[] = [];
  if (mode !== "off") {
    console.info("[proposal-generate] content qa start", {
      organizationId: input.organizationId,
      mode,
      sections: ordered.length,
    });
    const qa = await callAgent<{
      source?: string;
      failedSectionKeys?: string[];
      mismatches?: Array<{ sectionKey?: string; reason?: string }>;
    }>(
      "proposal-content-qa",
      {
        organizationId: input.organizationId,
        sectionSpecs: specMap,
        sections: ordered.map((s) => ({
          key: s.key,
          title: s.title,
          body: s.body,
        })),
      },
      { timeoutMs: AI_SERVICE_MAX_TIMEOUT_MS },
    );
    qaFailedKeys = Array.isArray(qa?.failedSectionKeys)
      ? qa.failedSectionKeys.map(String)
      : [];
    if (qaFailedKeys.length) {
      warnings.push(
        `Content QA flagged ${qaFailedKeys.join(", ")} (${mode}).`,
      );
      if (mode === "shadow") {
        console.info("[proposal-content-qa] shadow mismatches", {
          failedSectionKeys: qaFailedKeys,
          mismatches: qa?.mismatches ?? [],
        });
      }
    }
  }

  console.info("[proposal-generate] orchestrator done", {
    organizationId: input.organizationId,
    sections: ordered.length,
    shortSectionKeys,
    qaFailedKeys,
    warnings: warnings.length,
  });

  return {
    sections: ordered,
    warnings,
    qaFailedKeys,
    plannedLengths: planned,
    shortSectionKeys,
  };
}
