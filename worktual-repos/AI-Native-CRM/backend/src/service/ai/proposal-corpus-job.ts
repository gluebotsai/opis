/**
 * Proposal corpus orchestration:
 * ingest → persist user pairs → extract → case-study → synthesize → freeze.
 * Uploaded PDFs are training input only — we never clone them as generated output.
 */

import {
  callAiServiceAgent,
  AI_SERVICE_JOB_TIMEOUT_MS,
  AI_SERVICE_MAX_TIMEOUT_MS,
} from "@/service/ai/ai-service-client";
import {
  claimCorpusJob,
  contentPlaybookConfidenceLevel,
  createContentPlaybookVersion,
  createCorpusJob,
  createPlaybook,
  getCorpusBatch,
  getLatestContentPlaybook,
  listCaseStudiesForOrg,
  listCorpusItems,
  replaceCorpusPairs,
  updateCorpusBatch,
  updateCorpusItem,
  updateCorpusJob,
  upsertCorpusCaseStudy,
  CONTENT_PLAYBOOK_SYNTHESIS_FLOOR,
} from "@/dao/ai/proposal-corpus-store";
import {
  pickVisualMasterPair,
  shouldPersistScoredPair,
  measureProposalLength,
  overlayMeasuredLengthAnalysis,
  sectionBodiesFromUnknown,
  canonicalizeSectionAnalysis,
  canonicalizeSectionSpecs,
} from "@/lib/proposal-content-playbook";
import { scoreExplicitRequirementProposalPair } from "@/service/sales/proposal-pair-score";
import { deriveSectionLibrary } from "@/lib/proposal-section-library";
import { readCorpusFile, corpusFileExists } from "@/lib/proposal-corpus-storage";
import {
  assertPlaybookSkeleton,
  tableSpecKeysFromPlaybook,
} from "@/lib/proposal-playbook-layout";
import { buildPlaybookTagsJson, displayPlaybookSectionTitle } from "@/lib/proposal-playbook-pattern";
import { recordAgentStep } from "@/dao/ai/agent-step-events";
import { loadSellerOrganization } from "@/service/ai/seller-org";
import type { Prisma } from "@prisma/client";

const CORPUS_AGENT_TIMEOUT_MS = Math.max(AI_SERVICE_JOB_TIMEOUT_MS, 180_000);
const EXTRACT_AGENT_TIMEOUT_MS = AI_SERVICE_MAX_TIMEOUT_MS;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const MIN_INGEST_TEXT_CHARS = 80;

export function corpusItemHasReusableIngest(item: {
  status?: string;
  extractJson?: unknown;
}): boolean {
  if (item.status === "failed") return false;
  const text = String(asRecord(item.extractJson).fullText || "").trim();
  return text.length >= MIN_INGEST_TEXT_CHARS;
}

export function corpusItemAlreadyExtracted(item: {
  kind?: string;
  extractJson?: unknown;
}): boolean {
  const ex = asRecord(item.extractJson);
  if (item.kind === "proposal") {
    return Boolean(
      ex.instance && typeof ex.instance === "object" && !Array.isArray(ex.instance),
    );
  }
  return Boolean(ex.brd && typeof ex.brd === "object" && !Array.isArray(ex.brd));
}

function goldFromStoredExtract(item: {
  id: string;
  filename: string;
  extractJson?: unknown;
}) {
  const ex = asRecord(item.extractJson);
  return {
    itemId: item.id,
    filename: item.filename,
    gold: {
      instance: ex.instance,
      layout: ex.layout,
      themeTokens: {
        ...asRecord(ex.themeTokens),
        header_text: String(
          asRecord(ex.themeTokens).header_text || ex.headerText || "",
        ),
        footer_text: String(
          asRecord(ex.themeTokens).footer_text || ex.footerText || "",
        ),
      },
      logoB64: ex.logoB64,
      headerText: ex.headerText,
      footerText: ex.footerText,
      pageImages: Array.isArray(ex.pageImages) ? ex.pageImages : [],
    },
  };
}

async function traceStep(input: {
  organizationId: string;
  jobId: string;
  step: string;
  label: string;
  status: "ok" | "failed" | "skipped";
  detail?: unknown;
  errorReason?: string | null;
}) {
  try {
    await recordAgentStep({
      organizationId: input.organizationId,
      agent: "proposal_corpus",
      jobId: input.jobId,
      contactId: null,
      step: input.step,
      label: input.label,
      status: input.status,
      detail: input.detail,
      errorReason: input.errorReason ?? null,
    });
  } catch (err) {
    console.error("[proposal-corpus-job] step trace failed", err);
  }
}

export function corpusLearnAgentSequence(): string[] {
  return [
    "proposal-corpus-ingest",
    "proposal-corpus-pair",
    "proposal-corpus-extract",
    "proposal-corpus-case-study",
    "proposal-playbook-synthesize",
    "proposal-playbook-freeze",
  ];
}

export async function enqueueProposalCorpusJob(input: {
  batchId: string;
  organizationId: string;
}) {
  await updateCorpusBatch(input.batchId, { status: "processing", lastError: null });
  const job = await createCorpusJob({
    batchId: input.batchId,
    organizationId: input.organizationId,
  });
  void processProposalCorpusJob(job.id).catch((err) =>
    console.error("[proposal-corpus-job]", job.id, err),
  );
  return job;
}

export async function processProposalCorpusJob(jobId: string): Promise<void> {
  const claimed = await claimCorpusJob(jobId);
  if (!claimed) return;

  const orgId = String(claimed.organizationId);
  const batchId = claimed.batchId;

  try {
    await traceStep({
      organizationId: orgId,
      jobId,
      step: "claim",
      label: "Claim corpus job",
      status: "ok",
      detail: { batchId },
    });

    const items = claimed.batch?.items?.length
      ? claimed.batch.items
      : await listCorpusItems(batchId);

    const requirementHashes = new Set(
      items
        .filter((item) => item.kind === "requirement" && item.sha256)
        .map((item) => item.sha256),
    );
    const duplicateAcrossSides = items.find(
      (item) =>
        item.kind === "proposal" &&
        item.sha256 &&
        requirementHashes.has(item.sha256),
    );
    if (duplicateAcrossSides) {
      throw new Error(
        `Invalid training pair: ${duplicateAcrossSides.filename} is byte-identical to a requirement file. Upload the actual requirement and its corresponding winning proposal.`,
      );
    }

    await updateCorpusJob(jobId, { status: "ingesting", stage: "ingest" });
    for (const item of items) {
      const hasFile = await corpusFileExists(item.storagePath);
      if (!hasFile && !corpusItemHasReusableIngest(item)) {
        throw new Error(
          `Uploaded file missing for ${item.filename}. The server lost proposal-corpus storage (usually after redeploy). Delete this batch and upload the files again.`,
        );
      }
      if (corpusItemHasReusableIngest(item)) {
        await traceStep({
          organizationId: orgId,
          jobId,
          step: `ingest_${item.id}`,
          label: `Reuse ingest ${item.filename}`,
          status: "skipped",
          detail: { kind: item.kind, reused: true },
        });
        continue;
      }
      const buf = await readCorpusFile(item.storagePath);
      const contentBase64 = buf.toString("base64");
      const ingest = await callAiServiceAgent<{
        ok?: boolean;
        status?: string;
        pages?: unknown[];
        pageCount?: number;
        fullText?: string;
        warnings?: string[];
        geometryHint?: unknown;
        tables?: unknown;
        themeTokens?: unknown;
        layoutMeasured?: unknown;
        headerText?: string;
        footerText?: string;
        reason?: string;
      }>(
        "proposal-corpus-ingest",
        {
          itemId: item.id,
          filename: item.filename,
          kind: item.kind,
          contentBase64,
          organizationId: orgId,
        },
        { timeoutMs: CORPUS_AGENT_TIMEOUT_MS },
      );

      if (!ingest?.ok && ingest?.status === "failed") {
        await updateCorpusItem(item.id, {
          status: "failed",
          lastError: ingest.reason || "ingest_failed",
        });
        continue;
      }

      const prior = asRecord(item.extractJson);
      await updateCorpusItem(item.id, {
        status: corpusItemAlreadyExtracted(item) ? "structured" : "ingested",
        pageCount: ingest?.pageCount ?? item.pageCount ?? null,
        extractJson: {
          ...prior,
          pages: (ingest?.pages ?? prior.pages ?? []) as Prisma.InputJsonValue,
          fullText: ingest?.fullText ?? prior.fullText ?? "",
          warnings: (ingest?.warnings ?? prior.warnings ?? []) as Prisma.InputJsonValue,
          ...(ingest?.geometryHint
            ? { geometryHint: ingest.geometryHint as Prisma.InputJsonValue }
            : {}),
          ...(ingest?.tables
            ? { tables: ingest.tables as Prisma.InputJsonValue }
            : {}),
          ...(ingest?.themeTokens
            ? { themeTokens: ingest.themeTokens as Prisma.InputJsonValue }
            : {}),
          ...(ingest?.layoutMeasured
            ? { layoutMeasured: ingest.layoutMeasured as Prisma.InputJsonValue }
            : {}),
          ...(ingest?.headerText ? { headerText: ingest.headerText } : {}),
          ...(ingest?.footerText ? { footerText: ingest.footerText } : {}),
          ...((ingest as { lengthSpec?: unknown })?.lengthSpec
            ? {
                lengthSpec: (ingest as { lengthSpec: unknown })
                  .lengthSpec as Prisma.InputJsonValue,
              }
            : {}),
        } as Prisma.InputJsonValue,
        lastError: null,
      });

      await traceStep({
        organizationId: orgId,
        jobId,
        step: `ingest_${item.id}`,
        label: `Ingest ${item.filename}`,
        status: "ok",
        detail: { pageCount: ingest?.pageCount ?? 0, kind: item.kind },
      });
    }

    const refreshed = await listCorpusItems(batchId);
    const batchRow = await getCorpusBatch(batchId, orgId);
    const submitted = Array.isArray(asRecord(batchRow?.resultSummary).submittedPairs)
      ? (asRecord(batchRow?.resultSummary).submittedPairs as unknown[])
      : [];
    const submittedBySlot = new Map<
      number,
      { confidence: number | null; useAnyway?: boolean }
    >();
    for (const row of submitted) {
      const rec = asRecord(row);
      submittedBySlot.set(Number(rec.pairSlot ?? 0), {
        confidence:
          typeof rec.confidence === "number" ? rec.confidence : null,
        useAnyway: Boolean(rec.useAnyway),
      });
    }

    const slots = new Map<number, typeof refreshed>();
    for (const item of refreshed.filter((row) => row.status !== "failed")) {
      const slot = Number(item.pairSlot ?? 0);
      const list = slots.get(slot) ?? [];
      list.push(item);
      slots.set(slot, list);
    }

    await updateCorpusJob(jobId, { status: "pairing", stage: "pair" });
    const builtPairs: Array<{
      requirementItemId: string;
      proposalItemId: string;
      confidence: number | null;
      pairingSource: string;
      pairSlot: number;
      gapsJson: Prisma.InputJsonValue;
    }> = [];
    for (const [slot, slotItems] of [...slots.entries()].sort(
      (a, b) => a[0] - b[0],
    )) {
      const req = slotItems.find((item) => item.kind === "requirement");
      const prop = slotItems.find((item) => item.kind === "proposal");
      if (!req || !prop) {
        throw new Error(
          `Pair ${slot + 1} is missing a requirement or a proposal file.`,
        );
      }
      let confidence = submittedBySlot.get(slot)?.confidence ?? null;
      let gaps: string[] = [];
      if (confidence == null) {
        const scored = await scoreExplicitRequirementProposalPair({
          organizationId: orgId,
          requirement: {
            filename: req.filename,
            fullText: String(asRecord(req.extractJson).fullText || ""),
          },
          proposal: {
            filename: prop.filename,
            fullText: String(asRecord(prop.extractJson).fullText || ""),
          },
        });
        confidence = scored.confidence;
        gaps = scored.gaps;
      }
      if (
        !shouldPersistScoredPair({
          pairingSource: "user_explicit",
          confidence,
        })
      ) {
        continue;
      }
      builtPairs.push({
        requirementItemId: req.id,
        proposalItemId: prop.id,
        confidence,
        pairingSource: "user_explicit",
        pairSlot: slot,
        gapsJson: gaps as Prisma.InputJsonValue,
      });
    }
    if (builtPairs.length === 0) {
      throw new Error(
        "No requirement/proposal slots were found. Attach each BRD with its winning proposal.",
      );
    }
    const master = pickVisualMasterPair(
      builtPairs.map((pair) => ({
        proposalItemId: pair.proposalItemId,
        confidence: pair.confidence,
        pairSlot: pair.pairSlot,
      })),
    );
    const persistedPairs = await replaceCorpusPairs(
      batchId,
      orgId,
      builtPairs.map((pair) => ({
        requirementItemId: pair.requirementItemId,
        proposalItemId: pair.proposalItemId,
        confidence: pair.confidence,
        pairingSource: pair.pairingSource,
        isVisualMaster: pair.proposalItemId === master?.proposalItemId,
        gapsJson: pair.gapsJson,
      })),
    );

    await traceStep({
      organizationId: orgId,
      jobId,
      step: "pair",
      label: "Persist user-built pairs",
      status: "ok",
      detail: {
        pairCount: persistedPairs.length,
        visualMasterProposalItemId: master?.proposalItemId ?? null,
      },
    });

    await updateCorpusJob(jobId, { status: "structuring", stage: "extract" });
    const extractedProposals: Array<{
      itemId: string;
      filename: string;
      gold: Record<string, unknown>;
    }> = [];
    const instances: unknown[] = [];

    for (const item of refreshed) {
      if (item.status === "failed") continue;
      if (corpusItemAlreadyExtracted(item)) {
        if (item.status !== "structured") {
          await updateCorpusItem(item.id, { status: "structured", lastError: null });
        }
        if (item.kind === "proposal") {
          extractedProposals.push(goldFromStoredExtract(item));
          const stored = asRecord(item.extractJson).instance;
          if (stored) instances.push(stored);
        }
        await traceStep({
          organizationId: orgId,
          jobId,
          step: `extract_${item.id}`,
          label: `Reuse extract ${item.filename}`,
          status: "skipped",
          detail: { kind: item.kind, reused: true },
        });
        continue;
      }
      const buf = await readCorpusFile(item.storagePath);
      const extract = await callAiServiceAgent<{
        ok?: boolean;
        source?: string;
        reason?: string;
        brd?: unknown;
        instance?: unknown;
        layout?: unknown;
        themeTokens?: unknown;
        tables?: unknown;
        logoB64?: string;
        headerText?: string;
        footerText?: string;
        pageImages?: unknown;
      }>(
        "proposal-corpus-extract",
        {
          itemId: item.id,
          filename: item.filename,
          kind: item.kind,
          contentBase64: buf.toString("base64"),
          fullText: asRecord(item.extractJson).fullText ?? "",
          organizationId: orgId,
        },
        { timeoutMs: EXTRACT_AGENT_TIMEOUT_MS },
      );

      if (extract?.source !== "ai") {
        throw new Error(
          `Extract failed for ${item.filename}: ${extract?.reason || "not produced by Gemini"}`,
        );
      }

      const prior = asRecord(item.extractJson);
      const merged = {
        ...prior,
        brd: extract.brd ?? null,
        instance: extract.instance ?? null,
        layout: extract.layout ?? prior.layoutMeasured ?? null,
        themeTokens: extract.themeTokens ?? prior.themeTokens ?? null,
        tables: extract.tables ?? prior.tables ?? [],
        logoB64: extract.logoB64 ?? "",
        headerText: extract.headerText ?? prior.headerText ?? "",
        footerText: extract.footerText ?? prior.footerText ?? "",
        pageImages: Array.isArray(extract.pageImages)
          ? extract.pageImages
          : prior.pageImages ?? [],
      };
      await updateCorpusItem(item.id, {
        status: "structured",
        extractJson: merged as Prisma.InputJsonValue,
        lastError: null,
      });

      if (item.kind === "proposal") {
        extractedProposals.push({
          itemId: item.id,
          filename: item.filename,
          gold: {
            instance: extract.instance,
            layout: extract.layout,
            themeTokens: extract.themeTokens,
            logoB64: extract.logoB64,
            pageImages: Array.isArray(extract.pageImages) ? extract.pageImages : [],
          },
        });
        if (extract.instance) instances.push(extract.instance);
      }

      await traceStep({
        organizationId: orgId,
        jobId,
        step: `extract_${item.id}`,
        label: `Extract ${item.filename}`,
        status: "ok",
        detail: { kind: item.kind, source: extract.source },
      });
    }

    if (!extractedProposals.length) {
      throw new Error("No proposal document was extracted. Upload a winning proposal PDF.");
    }

    await updateCorpusJob(jobId, { status: "structuring", stage: "case-study" });
    const structuredItems = await listCorpusItems(batchId);
    const itemById = new Map(structuredItems.map((item) => [item.id, item]));
    const existingStudyPairIds = new Set(
      (await listCaseStudiesForOrg(orgId)).map((row) => row.pairId),
    );
    for (const pair of persistedPairs) {
      const req = itemById.get(pair.requirementItemId);
      const prop = itemById.get(pair.proposalItemId);
      const reqExtract = asRecord(req?.extractJson);
      const propExtract = asRecord(prop?.extractJson);
      if (existingStudyPairIds.has(pair.id)) {
        await traceStep({
          organizationId: orgId,
          jobId,
          step: `case_study_${pair.id}`,
          label: `Reuse case study ${prop?.filename || pair.id}`,
          status: "skipped",
          detail: { reused: true },
        });
        continue;
      }
      const study = await callAiServiceAgent<{
        ok?: boolean;
        source?: string;
        reason?: string;
        sectionAnalysis?: unknown;
        lengthAnalysis?: unknown;
      }>(
        "proposal-corpus-case-study",
        {
          organizationId: orgId,
          pairId: pair.id,
          requirement: {
            filename: req?.filename,
            fullText: reqExtract.fullText ?? "",
            brd: reqExtract.brd ?? null,
            pageCount: req?.pageCount ?? null,
          },
          proposal: {
            filename: prop?.filename,
            fullText: propExtract.fullText ?? "",
            instance: propExtract.instance ?? null,
            sections: asRecord(propExtract.instance).sections ?? [],
            pageCount: prop?.pageCount ?? null,
          },
        },
        { timeoutMs: CORPUS_AGENT_TIMEOUT_MS },
      );
      if (study?.source !== "ai") {
        throw new Error(
          `Case study failed for ${prop?.filename || pair.id}: ${study?.reason || "not produced by the LLM"}`,
        );
      }
      const measured = measureProposalLength({
        requirementText: String(reqExtract.fullText ?? ""),
        proposalText: String(propExtract.fullText ?? ""),
        proposalPageCount: prop?.pageCount ?? null,
        proposalSectionBodies: sectionBodiesFromUnknown(
          asRecord(propExtract.instance).sections ?? propExtract.sections,
        ),
      });
      await upsertCorpusCaseStudy({
        organizationId: orgId,
        batchId,
        pairId: pair.id,
        pairingConfidence: Number(pair.confidence ?? 0),
        sectionAnalysis: canonicalizeSectionAnalysis(
          study.sectionAnalysis ?? [],
        ) as Prisma.InputJsonValue,
        lengthAnalysis: overlayMeasuredLengthAnalysis(
          {
            ...(study.lengthAnalysis && typeof study.lengthAnalysis === "object"
              ? study.lengthAnalysis
              : {}),
            lengthSpec:
              asRecord(propExtract).lengthSpec ||
              asRecord(study.lengthAnalysis).lengthSpec,
          },
          measured,
        ) as Prisma.InputJsonValue,
      });
      await traceStep({
        organizationId: orgId,
        jobId,
        step: `case_study_${pair.id}`,
        label: `Case study ${prop?.filename || pair.id}`,
        status: "ok",
      });
    }

    const allStudies = await listCaseStudiesForOrg(orgId);
    if (allStudies.length >= CONTENT_PLAYBOOK_SYNTHESIS_FLOOR) {
      await updateCorpusJob(jobId, { status: "synthesizing", stage: "synthesize" });
      const sellerForSynth = await loadSellerOrganization(orgId);
      const synthesized = await callAiServiceAgent<{
        ok?: boolean;
        source?: string;
        reason?: string;
        sectionSpecs?: unknown;
        lengthModel?: unknown;
        exemplarBank?: unknown;
        varianceLog?: unknown;
      }>(
        "proposal-playbook-synthesize",
        {
          organizationId: orgId,
          organizationName: sellerForSynth?.companyName ?? "Vendor",
          caseStudies: allStudies.map((row) => ({
            id: row.id,
            pairingConfidence: row.pairingConfidence,
            sectionAnalysis: row.sectionAnalysis,
            lengthAnalysis: row.lengthAnalysis,
          })),
        },
        { timeoutMs: CORPUS_AGENT_TIMEOUT_MS },
      );
      if (synthesized?.source !== "ai" || !synthesized.sectionSpecs) {
        throw new Error(
          `Content playbook synthesis failed (${synthesized?.reason || "unknown"}). Retry learning.`,
        );
      }
      await createContentPlaybookVersion({
        organizationId: orgId,
        sectionSpecsJson: canonicalizeSectionSpecs(
          synthesized.sectionSpecs,
        ) as Prisma.InputJsonValue,
        lengthModelJson: (synthesized.lengthModel ?? {}) as Prisma.InputJsonValue,
        exemplarBankJson: (synthesized.exemplarBank ?? []) as Prisma.InputJsonValue,
        caseStudyCount: allStudies.length,
        confidenceLevel: contentPlaybookConfidenceLevel(allStudies.length),
        varianceLogJson: (synthesized.varianceLog ?? null) as Prisma.InputJsonValue,
      });
      await traceStep({
        organizationId: orgId,
        jobId,
        step: "synthesize",
        label: "Synthesize content playbook",
        status: "ok",
        detail: { caseStudyCount: allStudies.length },
      });
    }

    await updateCorpusJob(jobId, { status: "synthesizing", stage: "freeze" });
    const goldItemId =
      persistedPairs.find((pair) => pair.isVisualMaster)?.proposalItemId ??
      master?.proposalItemId ??
      extractedProposals[0]?.itemId;
    const gold =
      extractedProposals.find((p) => p.itemId === goldItemId) ??
      extractedProposals[0];
    const seller = await loadSellerOrganization(orgId);
    const freeze = await callAiServiceAgent<{
      ok?: boolean;
      source?: string;
      reason?: string;
      name?: string;
      blueprint?: Record<string, unknown>;
      assets?: Record<string, unknown>;
      sections?: unknown[];
      contentTemplate?: Record<string, unknown>;
    }>(
      "proposal-playbook-freeze",
      {
        gold: gold.gold,
        instances,
        name: `${seller?.companyName ?? "Vendor"} proposal pattern`,
        organizationId: orgId,
      },
      { timeoutMs: CORPUS_AGENT_TIMEOUT_MS },
    );

    if (freeze?.source !== "ai" || !freeze.blueprint) {
      throw new Error(
        `Playbook freeze failed (${freeze?.reason || "unknown"}). Retry learning.`,
      );
    }

    const sections = Array.isArray(freeze.sections) ? freeze.sections : [];
    const learnedSections = sections.map((s) => {
      const row = asRecord(s);
      const rawTitle = String(
        row.title || row.heading_pattern || row.key || row.id || "",
      );
      return {
        key: String(row.key || row.id || ""),
        title: displayPlaybookSectionTitle(rawTitle) || rawTitle,
        intent: String(row.intent || ""),
        tone: "formal",
        contentPattern: String(row.contentPattern || "medium"),
        ...(row.tableSpec ? { tableSpec: row.tableSpec } : {}),
      };
    });
    const sectionOrder = learnedSections
      .map((s) => s.key)
      .filter(Boolean);
    const skeletonCheck = assertPlaybookSkeleton({
      html: String(freeze.blueprint.html || ""),
      css: String(freeze.blueprint.css || ""),
      sectionOrder,
      tableSpecKeys: tableSpecKeysFromPlaybook({
        sections: learnedSections,
        featureSchema: freeze.contentTemplate,
      }),
    });
    if (!skeletonCheck.ok) {
      throw new Error(
        `Playbook has no visual template; Retry learning. ${skeletonCheck.reasons.join("; ")}`,
      );
    }

    const tags = ["learned", "frozen-theme"];
    const goldTheme = asRecord(asRecord(gold.gold.themeTokens).colors);
    const goldFonts = asRecord(asRecord(gold.gold.themeTokens).fonts);
    const goldTable = asRecord(asRecord(gold.gold.themeTokens).table);
    const goldBody = asRecord(goldFonts.body);
    const goldCover = asRecord(asRecord(gold.gold.instance).cover);
    const brandAlign = String(
      goldCover.brand_align || asRecord(gold.gold.layout).brand_align || "",
    ).toLowerCase();
    const latestContent = await getLatestContentPlaybook(orgId);
    const playbook = await createPlaybook({
      organizationId: orgId,
      sourceBatchId: batchId,
      contentPlaybookId: latestContent?.id ?? null,
      name: String(freeze.name || gold.filename || "Learned proposal pattern"),
      tagsJson: buildPlaybookTagsJson({
        tags,
        format: {
          coverStyle: brandAlign === "center" ? "centered" : "left",
          headingColor: String(goldTheme.primary || ""),
          fontFamily: String(goldBody.family || ""),
          headingAlign: brandAlign === "center" ? "center" : "left",
          tableStyle: {
            headerBackground: String(
              goldTable.header_bg || goldTheme.table_header_bg || goldTheme.primary || "",
            ),
            headerColor: String(
              asRecord(goldFonts.table_header).color || "",
            ),
            borderColor: String(goldTheme.table_border || ""),
          },
          cover: {
            title: String(goldCover.title || "Commercial Proposal"),
            archetype: brandAlign === "center" ? "centered" : "left",
          },
        },
        content: {
          overallTone: "formal",
          pricingShape: "line_items",
          sectionOrder,
          matchTags: tags,
          sections: learnedSections,
        },
        visualMasterMode: "none",
      }) as Prisma.InputJsonValue,
      sectionsJson: learnedSections as Prisma.InputJsonValue,
      sectionLibraryJson: deriveSectionLibrary({
        sectionsJson: learnedSections,
        sectionSpecsJson: latestContent?.sectionSpecsJson,
      }) as Prisma.InputJsonValue,
      blueprint: freeze.blueprint as Prisma.InputJsonValue,
      assets: {
        ...(freeze.assets ?? {}),
        pageImages: Array.isArray(gold.gold.pageImages)
          ? gold.gold.pageImages.slice(0, 8)
          : Array.isArray(freeze.assets?.pageImages)
            ? freeze.assets.pageImages
            : [],
      } as Prisma.InputJsonValue,
      status: "approved",
    });

    await traceStep({
      organizationId: orgId,
      jobId,
      step: "freeze",
      label: `Freeze ${playbook.name}`,
      status: "ok",
      detail: { playbookId: playbook.id, goldItemId: gold.itemId },
    });

    const summary = {
      playbookId: playbook.id,
      playbookIds: [playbook.id],
      pairCount: persistedPairs.length,
      itemCount: refreshed.length,
      goldItemId: gold.itemId,
      source: freeze.source,
    };
    await updateCorpusJob(jobId, {
      status: "pending_review",
      stage: "pending_review",
      resultSummary: summary as Prisma.InputJsonValue,
      completedAt: new Date(),
      lastError: null,
    });
    await updateCorpusBatch(batchId, {
      status: "completed",
      resultSummary: summary as Prisma.InputJsonValue,
      completedAt: new Date(),
      lastError: null,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "proposal_corpus_failed";
    console.error("[proposal-corpus-job] failed", jobId, message);
    try {
      await updateCorpusJob(jobId, {
        status: "failed",
        stage: "failed",
        lastError: message,
        completedAt: new Date(),
      });
      await updateCorpusBatch(batchId, {
        status: "failed",
        lastError: message,
        completedAt: new Date(),
      });
      await traceStep({
        organizationId: orgId,
        jobId,
        step: "failed",
        label: "Corpus job failed",
        status: "failed",
        detail: { error: message.slice(0, 200) },
        errorReason: message.slice(0, 500),
      });
    } catch (updateErr) {
      console.error(
        "[proposal-corpus-job] failed after batch removed",
        jobId,
        updateErr,
      );
    }
  }
}
