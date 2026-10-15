/**
 * Configuration commands for proposal corpus upload + playbook HITL.
 */

import {
  canManageDocumentTemplates,
} from "@/service/auth/rbac";
import {
  ForbiddenError,
  getCurrentOrganizationId,
  requireRole,
} from "@/service/auth/require-role";
import { getServerUserId } from "@/service/account/session-cookie";
import {
  PAIR_USE_ANYWAY_THRESHOLD,
  countCaseStudiesForOrg,
  countCorpusItemsForOrg,
  createCorpusBatch,
  createCorpusItem,
  deleteCorpusBatch,
  deleteProposalPatternsForOrg,
  getCorpusBatch,
  getLatestContentPlaybook,
  getPlaybook,
  listCorpusBatches,
  listPlaybooks,
  updateCorpusBatch,
  updateCorpusItem,
  updatePlaybook,
} from "@/dao/ai/proposal-corpus-store";
import { shouldRejectPairSlot } from "@/lib/proposal-content-playbook";
import {
  corpusUploadExceedsOrgCap,
  proposalCorpusMaxDocsPerOrg,
} from "@/lib/proposal-corpus-limits";
import { splitPlaybookPattern } from "@/lib/proposal-playbook-pattern";
import {
  CORPUS_MAX_FILE_BYTES,
  corpusFileExists,
  removeCorpusBatchDir,
  storeCorpusFile,
} from "@/lib/proposal-corpus-storage";
import { enqueueProposalCorpusJob } from "@/service/ai/proposal-corpus-job";
import { scoreExplicitRequirementProposalPair } from "@/service/sales/proposal-pair-score";
import type { Prisma, ProposalCorpusItemKind, ProposalPlaybookStatus } from "@prisma/client";

function asRec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function overlayFormatFromBlueprint(
  blueprint: unknown,
  format: {
    coverStyle?: string;
    fontFamily?: string;
    headingFontFamily?: string;
    headingColor?: string;
    accentColor?: string;
    textColor?: string;
    backgroundColor?: string;
    headerBandColor?: string;
    headingAlign?: string;
    coverTitle?: string | null;
    tableHeaderBackground?: string | null;
    tableHeaderColor?: string | null;
  },
) {
  const bp = asRec(blueprint);
  const tokens = asRec(bp.tokens);
  const colors = asRec(tokens.colors);
  const fonts = asRec(tokens.fonts);
  const body = asRec(fonts.body);
  const h1 = asRec(fonts.h1);
  const brandFont = asRec(fonts.brand);
  const tableHeader = asRec(fonts.table_header);
  const cover = asRec(bp.coverLayout);
  const theme = asRec(bp.theme);
  const brandAlign = String(cover.brand_align || "").toLowerCase();
  const coverAlign = String(cover.cover_align || "").toLowerCase();
  const centered = brandAlign === "center" || coverAlign === "center";
  const brand = String(cover.brand || "").trim();
  const title = String(cover.title || "").trim();
  const rawFont = String(body.family || theme.fonts || "").trim();
  const genericFont =
    /helvetica|arial/i.test(rawFont) && !/calibri|times|georgia/i.test(rawFont);
  const fontFamily = genericFont
    ? format.fontFamily
    : rawFont || format.fontFamily;
  const rawHeadingFont = String(h1.family || brandFont.family || "").trim();
  const genericHeadingFont =
    /helvetica|arial/i.test(rawHeadingFont) &&
    !/calibri|times|georgia/i.test(rawHeadingFont);
  const headingFontFamily = genericHeadingFont
    ? format.headingFontFamily
    : rawHeadingFont || format.headingFontFamily;
  const headingColor = String(
    h1.color || brandFont.color || colors.primary || theme.primary || "",
  ).trim();
  return {
    coverBrand: brand && !brand.includes("{{") ? brand : null,
    coverTitle:
      title && !title.includes("{{") ? title : format.coverTitle ?? null,
    fontFamily: fontFamily || format.fontFamily,
    headingFontFamily: headingFontFamily || format.headingFontFamily,
    headingColor: headingColor || format.headingColor,
    accentColor: String(colors.accent || "").trim() || format.accentColor,
    textColor: String(body.color || colors.text || "").trim() || format.textColor,
    backgroundColor: String(colors.bg || "").trim() || format.backgroundColor,
    headerBandColor:
      String(colors.primary || "").trim() || format.headerBandColor,
    headingAlign: centered ? "center" : format.headingAlign,
    coverStyle: centered ? "centered" : format.coverStyle,
    tableHeaderBackground:
      String(colors.table_header_bg || "").trim() ||
      format.tableHeaderBackground,
    tableHeaderColor:
      String(tableHeader.color || "").trim() || format.tableHeaderColor,
  };
}

function commandError(err: unknown, fallback: string) {
  if (err instanceof ForbiddenError) {
    return { ok: false as const, error: err.message, status: 403 as const };
  }
  return {
    ok: false as const,
    error: err instanceof Error ? err.message : fallback,
    status: 400 as const,
  };
}

function mapPlaybookPublic(p: {
  id: string;
  name: string;
  status: string;
  tagsJson: unknown;
  sectionsJson: unknown;
  sourceBatchId: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  blueprint?: unknown;
  sectionLibraryJson?: unknown;
}) {
  const split = splitPlaybookPattern(p);
  const featureSchema =
    split.content.featureSchema && typeof split.content.featureSchema === "object"
      ? (split.content.featureSchema as Record<string, unknown>)
      : {};
  const tables = Array.isArray(featureSchema.tables) ? featureSchema.tables : [];
  const tableColumns = tables.flatMap((table) => {
    if (!table || typeof table !== "object" || Array.isArray(table)) return [];
    const cols = (table as { columns?: unknown }).columns;
    return Array.isArray(cols) ? cols.map((c) => String(c)) : [];
  });
  const bp =
    p.blueprint && typeof p.blueprint === "object" && !Array.isArray(p.blueprint)
      ? (p.blueprint as Record<string, unknown>)
      : {};
  const slotCount = Array.isArray(bp.slots)
    ? bp.slots.length
    : split.content.sectionOrder.length;
  const baseFormat = {
    coverStyle: split.format.coverStyle,
    fontFamily: split.format.fontFamily,
    headingFontFamily: split.format.headingFontFamily,
    headingColor: split.format.headingColor,
    accentColor: split.format.accentColor,
    textColor: split.format.textColor,
    backgroundColor: split.format.backgroundColor,
    headerBandColor: split.format.headerBandColor,
    headingAlign: split.format.headingAlign,
    headingRule: split.format.headingRule,
    pageCountTypical: split.format.pageCountTypical ?? null,
    coverTitle: split.format.cover?.title ?? null,
    coverSlots: split.format.cover?.slots ?? [],
    tableHeaderBackground: split.format.tableStyle?.headerBackground ?? null,
    tableHeaderColor: split.format.tableStyle?.headerColor ?? null,
    cssComplete:
      typeof bp.css === "string" &&
      /font-size/i.test(bp.css) &&
      /padding|margin/i.test(bp.css),
  };
  const fromGold = overlayFormatFromBlueprint(p.blueprint, baseFormat);
  return {
    id: p.id,
    name: p.name,
    status: p.status,
    tagsJson: p.tagsJson,
    sectionsJson: p.sectionsJson,
    sourceBatchId: p.sourceBatchId,
    approvedAt: p.approvedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    sectionLibrary: p.sectionLibraryJson ?? null,
    visualMasterMode: split.visualMasterMode,
    format: {
      ...baseFormat,
      ...fromGold,
    },
    content: {
      overallTone: split.content.overallTone,
      pricingShape: split.content.pricingShape,
      sectionOrder: split.content.sectionOrder,
      sectionTitles: split.content.sections
        .map((s) => String(s.title || s.key || "").trim())
        .filter(Boolean)
        .slice(0, 12),
      matchTags: split.content.matchTags,
      tableColumns: [...new Set(tableColumns)].slice(0, 16),
      slotCount,
      requestedFeatures: Array.isArray(featureSchema.requestedFeatures)
        ? featureSchema.requestedFeatures.map((f) => String(f)).slice(0, 12)
        : [],
    },
  };
}

export async function listProposalCorpusBatchesCommand() {
  try {
    await requireRole(
      canManageDocumentTemplates,
      "You cannot manage proposal patterns.",
    );
    const orgId = await getCurrentOrganizationId();
    const batches = await listCorpusBatches(orgId);
    const [latestContent, caseStudyCount] = await Promise.all([
      getLatestContentPlaybook(orgId),
      countCaseStudiesForOrg(orgId),
    ]);
    return {
      ok: true as const,
      items: batches.map((b) => ({
        id: b.id,
        name: b.name,
        status: b.status,
        lastError: b.lastError,
        itemCount: b._count.items,
        playbookCount: b._count.playbooks,
        jobStatus: b.jobs[0]?.status ?? null,
        jobId: b.jobs[0]?.id ?? null,
        createdAt: b.createdAt.toISOString(),
        updatedAt: b.updatedAt.toISOString(),
        completedAt: b.completedAt?.toISOString() ?? null,
        files: b.items.map((i) => ({
          id: i.id,
          kind: i.kind,
          filename: i.filename,
          status: i.status,
        })),
      })),
      contentPlaybook: latestContent
        ? {
            id: latestContent.id,
            version: latestContent.version,
            caseStudyCount: latestContent.caseStudyCount,
            confidenceLevel: latestContent.confidenceLevel,
          }
        : {
            id: null,
            version: 0,
            caseStudyCount,
            confidenceLevel: caseStudyCount >= 8 ? "high" : "low",
          },
    };
  } catch (err) {
    return commandError(err, "Failed to list corpus batches.");
  }
}

export async function getProposalCorpusBatchCommand(batchId: string) {
  try {
    await requireRole(
      canManageDocumentTemplates,
      "You cannot manage proposal patterns.",
    );
    const orgId = await getCurrentOrganizationId();
    const batch = await getCorpusBatch(batchId, orgId);
    if (!batch) {
      return { ok: false as const, error: "Batch not found.", status: 404 as const };
    }
    return {
      ok: true as const,
      batch: {
        id: batch.id,
        name: batch.name,
        status: batch.status,
        lastError: batch.lastError,
        resultSummary: batch.resultSummary,
        createdAt: batch.createdAt.toISOString(),
        items: batch.items.map((i) => ({
          id: i.id,
          kind: i.kind,
          filename: i.filename,
          pageCount: i.pageCount,
          status: i.status,
          lastError: i.lastError,
        })),
        pairs: batch.pairs.map((p) => ({
          id: p.id,
          requirementItemId: p.requirementItemId,
          proposalItemId: p.proposalItemId,
          confidence: p.confidence,
        })),
        job: batch.jobs[0]
          ? {
              id: batch.jobs[0].id,
              status: batch.jobs[0].status,
              stage: batch.jobs[0].stage,
              lastError: batch.jobs[0].lastError,
            }
          : null,
        playbooks: batch.playbooks.map((p) => ({
          id: p.id,
          name: p.name,
          status: p.status,
        })),
      },
    };
  } catch (err) {
    return commandError(err, "Failed to load corpus batch.");
  }
}

export async function deleteProposalCorpusBatchCommand(batchId: string) {
  try {
    await requireRole(
      canManageDocumentTemplates,
      "You cannot manage proposal patterns.",
    );
    const orgId = await getCurrentOrganizationId();
    const deleted = await deleteCorpusBatch(batchId, orgId);
    if (!deleted) {
      return {
        ok: false as const,
        error: "Batch not found.",
        status: 404 as const,
      };
    }
    await removeCorpusBatchDir({
      organizationId: orgId,
      batchId,
    }).catch(() => undefined);
    return { ok: true as const, id: batchId };
  } catch (err) {
    return commandError(err, "Failed to delete corpus batch.");
  }
}

export async function resetProposalPatternsCommand() {
  try {
    await requireRole(
      canManageDocumentTemplates,
      "You cannot manage proposal patterns.",
    );
    const orgId = await getCurrentOrganizationId();
    const result = await deleteProposalPatternsForOrg(orgId);
    for (const batchId of result.batchIds) {
      await removeCorpusBatchDir({
        organizationId: orgId,
        batchId,
      }).catch(() => undefined);
    }
    return {
      ok: true as const,
      deletedBatches: result.batchCount,
      deletedPlaybooks: result.playbookCount,
    };
  } catch (err) {
    return commandError(err, "Failed to clear learned extracts.");
  }
}

export type CorpusUploadFile = {
  kind: "requirement" | "proposal";
  filename: string;
  contentBase64: string;
  mime?: string | null;
  pairSlot?: number;
  confidence?: number | null;
  useAnyway?: boolean;
};

export type CorpusUploadPair = {
  pairSlot: number;
  requirement: CorpusUploadFile;
  proposal: CorpusUploadFile;
  confidence?: number | null;
  useAnyway?: boolean;
};

export async function scoreProposalCorpusPairCommand(input: {
  requirement: CorpusUploadFile;
  proposal: CorpusUploadFile;
}) {
  try {
    await requireRole(
      canManageDocumentTemplates,
      "You cannot manage proposal patterns.",
    );
    const orgId = await getCurrentOrganizationId();
    const scored = await scoreExplicitRequirementProposalPair({
      organizationId: orgId,
      requirement: input.requirement,
      proposal: input.proposal,
    });
    return {
      ok: true as const,
      confidence: scored.confidence,
      gaps: scored.gaps,
      source: scored.source,
      needsUseAnyway: scored.confidence < PAIR_USE_ANYWAY_THRESHOLD,
    };
  } catch (err) {
    return commandError(err, "Failed to score this pair.");
  }
}

function flattenUploadPairs(
  files: CorpusUploadFile[],
  pairs?: CorpusUploadPair[],
): CorpusUploadFile[] {
  if (Array.isArray(pairs) && pairs.length > 0) {
    const out: CorpusUploadFile[] = [];
    for (const pair of pairs) {
      const slot = Number(pair.pairSlot ?? out.length / 2);
      out.push({
        ...pair.requirement,
        kind: "requirement",
        pairSlot: slot,
        confidence: pair.confidence ?? pair.requirement.confidence,
        useAnyway: pair.useAnyway ?? pair.requirement.useAnyway,
      });
      out.push({
        ...pair.proposal,
        kind: "proposal",
        pairSlot: slot,
        confidence: pair.confidence ?? pair.proposal.confidence,
        useAnyway: pair.useAnyway ?? pair.proposal.useAnyway,
      });
    }
    return out;
  }
  return files.map((file) => ({
    ...file,
    pairSlot: Number.isFinite(file.pairSlot) ? Number(file.pairSlot) : 0,
  }));
}

export async function createProposalCorpusBatchCommand(input: {
  name?: string | null;
  files?: CorpusUploadFile[];
  pairs?: CorpusUploadPair[];
  startProcessing?: boolean;
}) {
  try {
    await requireRole(
      canManageDocumentTemplates,
      "You cannot manage proposal patterns.",
    );
    const orgId = await getCurrentOrganizationId();
    const userId = await getServerUserId();
    if (!userId) {
      return { ok: false as const, error: "Not signed in.", status: 401 as const };
    }
    const files = flattenUploadPairs(input.files ?? [], input.pairs);
    if (!files.length) {
      return {
        ok: false as const,
        error: "Upload at least one requirement or proposal file.",
        status: 400 as const,
      };
    }
    if (files.length > 20) {
      return {
        ok: false as const,
        error: "At most 20 files per batch.",
        status: 400 as const,
      };
    }
    const existingDocs = await countCorpusItemsForOrg(orgId);
    const cap = proposalCorpusMaxDocsPerOrg();
    if (
      corpusUploadExceedsOrgCap({
        existingCount: existingDocs,
        incomingCount: files.length,
        cap,
      })
    ) {
      return {
        ok: false as const,
        error: `This organization already has ${existingDocs} learned documents (limit ${cap}). Remove older corpus batches before uploading more.`,
        status: 400 as const,
      };
    }

    const bySlot = new Map<number, CorpusUploadFile[]>();
    for (const file of files) {
      const slot = Number(file.pairSlot ?? 0);
      const list = bySlot.get(slot) ?? [];
      list.push(file);
      bySlot.set(slot, list);
    }
    for (const [slot, slotFiles] of bySlot) {
      const reqs = slotFiles.filter((f) => f.kind === "requirement");
      const props = slotFiles.filter((f) => f.kind === "proposal");
      if (reqs.length !== 1 || props.length !== 1) {
        return {
          ok: false as const,
          error: `Pair ${slot + 1} must have exactly one requirement and one proposal.`,
          status: 400 as const,
        };
      }
      const confidence = Number(
        reqs[0].confidence ?? props[0].confidence ?? NaN,
      );
      const useAnyway = Boolean(reqs[0].useAnyway || props[0].useAnyway);
      if (shouldRejectPairSlot(confidence, useAnyway)) {
        return {
          ok: false as const,
          error: `Pair ${slot + 1} scored ${confidence.toFixed(2)}. Confirm “use anyway” to include it.`,
          status: 400 as const,
        };
      }
    }

    const batch = await createCorpusBatch({
      organizationId: orgId,
      createdByUserId: String(userId),
      name: input.name,
    });

    await updateCorpusBatch(batch.id, {
      resultSummary: {
        submittedPairs: [...bySlot.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([slot, slotFiles]) => {
            const req = slotFiles.find((f) => f.kind === "requirement");
            const prop = slotFiles.find((f) => f.kind === "proposal");
            return {
              pairSlot: slot,
              requirementFilename: req?.filename ?? "",
              proposalFilename: prop?.filename ?? "",
              confidence: req?.confidence ?? prop?.confidence ?? null,
              useAnyway: Boolean(req?.useAnyway || prop?.useAnyway),
            };
          }),
      } as Prisma.InputJsonValue,
    });

    const createdItems = [];
    for (const file of files) {
      const name = (file.filename || "").toLowerCase();
      if (
        !name.endsWith(".pdf") &&
        !name.endsWith(".docx") &&
        !name.endsWith(".txt") &&
        !name.endsWith(".md")
      ) {
        return {
          ok: false as const,
          error: `Unsupported file type: ${file.filename}`,
          status: 400 as const,
        };
      }
      let buffer: Buffer;
      try {
        buffer = Buffer.from(file.contentBase64, "base64");
      } catch {
        return {
          ok: false as const,
          error: `Could not decode ${file.filename}`,
          status: 400 as const,
        };
      }
      if (buffer.byteLength > CORPUS_MAX_FILE_BYTES) {
        return {
          ok: false as const,
          error: `${file.filename} exceeds 8 MB.`,
          status: 413 as const,
        };
      }
      const kind: ProposalCorpusItemKind =
        file.kind === "requirement" ? "requirement" : "proposal";
      const item = await createCorpusItem({
        batchId: batch.id,
        organizationId: orgId,
        kind,
        pairSlot: Number(file.pairSlot ?? 0),
        storagePath: "pending",
        filename: file.filename,
        mime: file.mime ?? null,
        sha256: null,
      });
      const stored = await storeCorpusFile({
        organizationId: orgId,
        batchId: batch.id,
        itemId: item.id,
        filename: file.filename,
        buffer,
      });
      await updateCorpusItem(item.id, {
        storagePath: stored.storagePath,
        sha256: stored.sha256,
      });
      createdItems.push({
        id: item.id,
        kind: item.kind,
        filename: item.filename,
        pairSlot: item.pairSlot,
      });
    }

    const hasReq = createdItems.some((i) => i.kind === "requirement");
    const hasProp = createdItems.some((i) => i.kind === "proposal");
    if (!hasReq || !hasProp) {
      await updateCorpusBatch(batch.id, {
        status: "failed",
        lastError: "Batch needs at least one requirement and one proposal file.",
      });
      return {
        ok: false as const,
        error: "Upload at least one requirement and one proposal file.",
        status: 400 as const,
      };
    }

    let jobId: string | null = null;
    if (input.startProcessing !== false) {
      const job = await enqueueProposalCorpusJob({
        batchId: batch.id,
        organizationId: orgId,
      });
      jobId = job.id;
    }

    return {
      ok: true as const,
      batchId: batch.id,
      jobId,
      items: createdItems,
    };
  } catch (err) {
    return commandError(err, "Failed to create corpus batch.");
  }
}

export async function processProposalCorpusBatchCommand(batchId: string) {
  try {
    await requireRole(
      canManageDocumentTemplates,
      "You cannot manage proposal patterns.",
    );
    const orgId = await getCurrentOrganizationId();
    const batch = await getCorpusBatch(batchId, orgId);
    if (!batch) {
      return { ok: false as const, error: "Batch not found.", status: 404 as const };
    }
    const missing = [];
    for (const item of batch.items) {
      if (!(await corpusFileExists(item.storagePath))) {
        missing.push(item.filename);
      }
    }
    if (missing.length > 0) {
      return {
        ok: false as const,
        error: `Uploaded files are no longer on the server (${missing.join(", ")}). Delete this batch and upload the requirement and proposal PDFs again.`,
        status: 409 as const,
      };
    }
    const job = await enqueueProposalCorpusJob({
      batchId,
      organizationId: orgId,
    });
    return { ok: true as const, jobId: job.id };
  } catch (err) {
    return commandError(err, "Failed to start corpus processing.");
  }
}

export async function listProposalPlaybooksCommand(status?: string) {
  try {
    await requireRole(
      canManageDocumentTemplates,
      "You cannot manage proposal patterns.",
    );
    const orgId = await getCurrentOrganizationId();
    const allowed: ProposalPlaybookStatus[] = [
      "draft",
      "pending_review",
      "approved",
      "rejected",
    ];
    const filter =
      status && allowed.includes(status as ProposalPlaybookStatus)
        ? (status as ProposalPlaybookStatus)
        : undefined;
    const rows = await listPlaybooks(orgId, filter ? { status: filter } : undefined);
    return {
      ok: true as const,
      items: rows.map(mapPlaybookPublic),
    };
  } catch (err) {
    return commandError(err, "Failed to list playbooks.");
  }
}

export async function getProposalPlaybookCommand(id: string) {
  try {
    await requireRole(
      canManageDocumentTemplates,
      "You cannot manage proposal patterns.",
    );
    const orgId = await getCurrentOrganizationId();
    const p = await getPlaybook(id, orgId);
    if (!p) {
      return { ok: false as const, error: "Playbook not found.", status: 404 as const };
    }
    return {
      ok: true as const,
      playbook: mapPlaybookPublic(p),
    };
  } catch (err) {
    return commandError(err, "Failed to load playbook.");
  }
}

export async function reviewProposalPlaybookCommand(input: {
  id: string;
  action: "approve" | "reject";
  name?: string;
}) {
  try {
    await requireRole(
      canManageDocumentTemplates,
      "You cannot manage proposal patterns.",
    );
    const orgId = await getCurrentOrganizationId();
    const userId = await getServerUserId();
    const existing = await getPlaybook(input.id, orgId);
    if (!existing) {
      return { ok: false as const, error: "Playbook not found.", status: 404 as const };
    }
    if (input.action === "approve") {
      await updatePlaybook(input.id, {
        status: "approved",
        name: input.name?.trim() || existing.name,
        approvedAt: new Date(),
        approvedByUserId: userId ? String(userId) : null,
      });
      if (existing.sourceBatchId) {
        await updateCorpusBatch(existing.sourceBatchId, {
          status: "completed",
          completedAt: new Date(),
        });
      }
    } else {
      await updatePlaybook(input.id, {
        status: "rejected",
        approvedAt: null,
        approvedByUserId: null,
      });
    }
    return { ok: true as const, id: input.id };
  } catch (err) {
    return commandError(err, "Failed to review playbook.");
  }
}
