/**
 * Generate a deal proposal draft from an org-learned writing pattern + requirement.
 *
 * Uploaded historical proposals are corpus input only — we learn section order,
 * tone, contentPattern, and layout per organization. Generated copy always
 * comes from the current requirement (meeting transcript, BRD, or rep brief),
 * never by reusing an uploaded reference document as the answer.
 */

import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  callAiServiceAgent,
  AI_SERVICE_JOB_TIMEOUT_MS,
  AI_SERVICE_MAX_TIMEOUT_MS,
} from "@/service/ai/ai-service-client";
import { canEditDeals } from "@/service/auth/rbac";
import {
  getCurrentOrganizationId,
  requireRole,
} from "@/service/auth/require-role";
import { assertRecordAccess } from "@/service/auth/ownership-scope";
import { getServerUserId } from "@/service/account/session-cookie";
import { getDeal } from "@/dao/sales/deal-service";
import { prisma } from "@/dao/db/prisma";
import {
  createProposal,
  getProposal,
  updateProposal,
  markProposalGenerateInFlight,
  clearProposalGenerateInFlight,
} from "@/dao/sales/proposal-service";
import { listApprovedPlaybooks, getContentPlaybookById, getLatestContentPlaybookForOrg, listCaseStudiesForOrg } from "@/dao/ai/proposal-corpus-store";
import {
  proposalGenerateAttemptCount,
  proposalGenerateQualityGateError,
  isProductKbUnavailableReason,
  isGeminiUnavailableReason,
  shouldRetryWholeDocumentGenerate,
  PRODUCT_KB_UNAVAILABLE_MESSAGE,
  GEMINI_UNAVAILABLE_MESSAGE,
  resolveContentPlaybook,
  contentPlaybookForSectionGenerate,
  sectionsBelowPlannedWordBand,
  type ContentPlaybookLike,
} from "@/lib/proposal-content-playbook";
import { isProposalPipelineV2Enabled } from "@/lib/proposal-pipeline-v2";
import { applyProposalV2PreWrite } from "@/service/sales/proposal-v2-hooks";
import { catalogRateUnitLabel } from "@/dao/products/product-labels";
import {
  catalogAmountAllowlist,
  runDeterministicProposalQa,
} from "@/lib/proposal-qa";
import { markProposalGenerationRun } from "@/dao/sales/proposal-generation-run";
import {
  generateProposalSectionsFromContentPlaybook,
  retryCommercialTableGaps,
} from "@/service/sales/proposal-section-orchestrator";
import { rewriteProposalSectionBodies } from "@/service/sales/proposal-section-rewrite";
import {
  listActiveProductsForProposalCatalog,
  listProductsByIds,
  type ProposalCatalogProduct,
} from "@/dao/products/product-service";
import { loadSellerOrganization } from "@/service/ai/seller-org";
import { loadMeetingNotesForDeal } from "@/service/ai/proposal-brief";
import { resolveProposalProductScope } from "@/service/sales/proposal-visuals";
import { recordAgentStep } from "@/dao/ai/agent-step-events";
import { withUser } from "@/middlewares/auth";
import {
  buildPlaybookDocumentBlueprint,
  fillPlaybookTemplate,
  applyPlaybookCoverHtml,
  isGenericCoverTitle,
  isPlaybookTemplateBlueprint,
  playbookVisualTemplateReady,
  cssLooksComplete,
  tableRowsForSection,
  defaultColumnsForSectionKey,
  tableSpecKeysFromPlaybook,
  validateGeneratedProposalHtml,
} from "@/lib/proposal-playbook-layout";
import { retrieveTopPlaybooks } from "@/lib/proposal-playbook-retrieve";
import {
  normalizeRequirementThemes,
  readStoredRequirementThemes,
  requirementThemesChanged,
} from "@/lib/proposal-theme-match";
export {
  normalizeRequirementThemes,
  readStoredRequirementThemes,
  requirementThemesChanged,
} from "@/lib/proposal-theme-match";
import type { DocumentBlueprint } from "@/lib/document-blueprint";
import {
  gateProposalSectionsAgainstAllowedProducts,
  playbookPatternForAgent,
  splitPlaybookPattern,
} from "@/lib/proposal-playbook-pattern";
import type { ProposalSection } from "@/lib/proposal-sections";

/** Requirement for regenerate — meeting/deal facts only, never the previous draft. */
export function buildProposalRegenerateRequirement(input: {
  productHint?: string | null;
  meetingNotes?: string | null;
  dealNotes?: string | null;
  dealTitle?: string | null;
  companyName?: string | null;
}): string {
  return [
    input.productHint?.trim(),
    input.meetingNotes?.trim(),
    input.dealNotes?.trim(),
    input.dealTitle ? `Customer need related to: ${input.dealTitle}` : "",
    input.companyName ? `Company: ${input.companyName}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Label meeting vs BRD so generate can use both without mixing sources. */
export function composeProposalRequirement(input: {
  meetingNotes?: string | null;
  requirementText?: string | null;
}): string {
  const meeting = input.meetingNotes?.trim() || "";
  const requirement = input.requirementText?.trim() || "";
  const alreadyHasMeeting =
    meeting.length >= 40 && requirement.includes(meeting.slice(0, 80));
  const parts: string[] = [];
  if (meeting && !alreadyHasMeeting) {
    parts.push(
      `MEETING NOTES (what they prefer / asked for):\n${meeting}`,
    );
  }
  if (requirement) {
    parts.push(`CUSTOMER REQUIREMENT / BRD:\n${requirement}`);
  } else if (meeting && alreadyHasMeeting) {
    parts.push(`MEETING NOTES (what they prefer / asked for):\n${meeting}`);
  }
  return parts.join("\n\n");
}

const MAX_STORED_REQUIREMENT_CHARS = 100_000;

/** Original BRD/requirement persisted on the proposal blueprint for regenerate. */
export function readStoredProposalRequirement(blueprint: unknown): string | null {
  const rec =
    blueprint && typeof blueprint === "object" && !Array.isArray(blueprint)
      ? (blueprint as Record<string, unknown>)
      : {};
  const text = String(rec.requirementText || "").trim();
  return text.length >= 8 ? text : null;
}

export function withStoredProposalRequirement<T extends Record<string, unknown>>(
  blueprint: T,
  requirementText: string,
  requirementSource?: string | null,
  themes?: unknown,
): T {
  return {
    ...blueprint,
    requirementText: requirementText.slice(0, MAX_STORED_REQUIREMENT_CHARS),
    requirementThemes: normalizeRequirementThemes(themes),
    ...(requirementSource ? { requirementSource } : {}),
  };
}

function pageImagesFromPlaybookAssets(assets: unknown): Array<{
  page: number;
  mime: string;
  dataBase64: string;
}> {
  const rec =
    assets && typeof assets === "object" && !Array.isArray(assets)
      ? (assets as Record<string, unknown>)
      : {};
  const raw = rec.pageImages;
  if (!Array.isArray(raw)) return [];
  const out: Array<{ page: number; mime: string; dataBase64: string }> = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    let b64 = String(item.dataBase64 || "").trim();
    const dataUrl = String(item.dataUrl || "");
    if (!b64 && dataUrl.includes(",")) b64 = dataUrl.split(",")[1] || "";
    if (b64.length < 32) continue;
    out.push({
      page: Number(item.page) || out.length + 1,
      mime: String(item.mime || "image/png"),
      dataBase64: b64,
    });
    if (out.length >= 8) break;
  }
  return out;
}

const MONEY_CELL_RE = /(?:₹|\$|€|£|[A-Z]{3})\s*[\d,]+(?:\.\d+)?|[\d,]+\.\d{2}/;

function compactCatalogProductForLog(p: {
  id?: string;
  name?: string | null;
  sku?: string | null;
  price?: unknown;
  currency?: string | null;
  unitOfMeasure?: string | null;
  billingFrequency?: string | null;
  addons?: Array<{
    id?: string;
    name?: string | null;
    pricingModel?: string | null;
    flatPrice?: unknown;
    unitPrice?: unknown;
    stepSize?: unknown;
    stepPrice?: unknown;
    tiers?: Array<{ minQty: number; maxQty: number | null; unitPrice: number }>;
  }>;
}) {
  return {
    id: p.id ?? null,
    name: p.name ?? null,
    sku: p.sku ?? null,
    price: p.price ?? null,
    currency: p.currency ?? null,
    unitOfMeasure: p.unitOfMeasure ?? null,
    billingFrequency: p.billingFrequency ?? null,
    addons: (p.addons ?? []).map((a) => ({
      id: a.id ?? null,
      name: a.name ?? null,
      pricingModel: a.pricingModel ?? null,
      flatPrice: a.flatPrice ?? null,
      unitPrice: a.unitPrice ?? null,
      stepSize: a.stepSize ?? null,
      stepPrice: a.stepPrice ?? null,
      tiers: a.tiers ?? [],
    })),
  };
}

function pricingTableCellsForLog(
  sections: Array<{
    key?: string;
    title?: string;
    tableRows?: Array<{ cells?: string[] }>;
  }>,
) {
  return sections
    .filter((section) =>
      (section.tableRows ?? []).some((row) =>
        (row.cells ?? []).some((cell) => MONEY_CELL_RE.test(String(cell || ""))),
      ),
    )
    .map((section) => ({
      key: section.key ?? null,
      title: section.title ?? null,
      rows: (section.tableRows ?? []).map((row) => row.cells ?? []),
    }));
}

async function assertDealAccess(dealId: string) {
  const deal = await getDeal(dealId);
  if (!deal) throw new Error("Deal not found.");
  await assertRecordAccess(
    deal.ownerUserId != null ? String(deal.ownerUserId) : null,
    "You do not have access to this deal.",
    deal.companyId,
  );
  return deal;
}

type PlaybookViewRow = {
  id: string;
  name: string;
  tagsJson: unknown;
  sectionsJson: unknown;
  sourceBatchId?: string | null;
  contentPlaybookId?: string | null;
  updatedAt?: Date;
  blueprint?: unknown;
  assets?: unknown;
};

function playbookView(row: PlaybookViewRow) {
  const tagsObj =
    row.tagsJson && typeof row.tagsJson === "object" && !Array.isArray(row.tagsJson)
      ? (row.tagsJson as Record<string, unknown>)
      : {};
  const tags = Array.isArray(tagsObj.tags)
    ? tagsObj.tags
    : Array.isArray(row.tagsJson)
      ? row.tagsJson
      : [];
  return {
    id: row.id,
    name: row.name,
    tags,
    tagsJson: tagsObj,
    pricingShape: tagsObj.pricingShape ?? "line_items",
    overallTone: tagsObj.overallTone ?? "formal",
    layoutStyle: tagsObj.format ?? tagsObj.layoutStyle ?? null,
    sections: Array.isArray(row.sectionsJson) ? row.sectionsJson : [],
    sectionsJson: Array.isArray(row.sectionsJson) ? row.sectionsJson : [],
    sourceBatchId: row.sourceBatchId ?? null,
    contentPlaybookId: row.contentPlaybookId ?? null,
    updatedAt: row.updatedAt ?? null,
    blueprint: row.blueprint ?? null,
    assets: row.assets ?? null,
  };
}

/** Pattern metadata only — never pass historical proposal prose to the writer LLM. */
export function playbookPatternForGeneration(
  playbook: ReturnType<typeof playbookView>,
) {
  return playbookPatternForAgent(playbook);
}

function cleanSectionTitle(title: string, key: string): string {
  const raw = title.trim();
  if (!raw) return key;
  // Learned titles sometimes arrive as "A / B" compounds — keep the body-facing side.
  if (raw.includes(" / ")) {
    const parts = raw
      .split(" / ")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      if (!/^commercial\s*proposal$/i.test(last)) return last;
      return parts[0];
    }
  }
  return raw;
}

async function nameGeneratedProposalDocument(input: {
  customerName: string;
  sections: Array<{ key?: string; title?: string; body?: string }>;
  profileProducts: string[];
}): Promise<{ title: string; productTags: string[] }> {
  const fallback = input.customerName
    ? `Proposal for ${input.customerName}`
    : "";
  const result = await callAiServiceAgent<{
    source?: string;
    title?: string;
    product_tags?: unknown;
  }>(
    "proposal-title",
    {
      customerName: input.customerName,
      allowedProducts: input.profileProducts,
      sections: input.sections.slice(0, 8).map((section) => ({
        key: section.key,
        title: section.title,
        body: section.body,
      })),
    },
    { timeoutMs: AI_SERVICE_MAX_TIMEOUT_MS },
  );
  let title = String(result?.title || "").trim();
  if (!title || isGenericCoverTitle(title)) {
    title = fallback;
  }
  const tagsRaw = result?.product_tags;
  const productTags = Array.isArray(tagsRaw)
    ? tagsRaw
        .map((tag) => String(tag || "").trim())
        .filter(Boolean)
        .slice(0, 4)
    : [];
  console.info("[proposal-generate] document title", {
    source: result?.source,
    title,
    productTags,
  });
  return { title: title.slice(0, 200), productTags };
}

/** Pick an approved playbook id. Topical confidence must not block generation. */
export function selectLearnedPlaybookId(input: {
  requestedId?: string | null;
  matchId?: string | null;
  shortlistIds: string[];
  approvedIds: string[];
}): string | null {
  const approved = new Set(input.approvedIds.filter(Boolean));
  if (!approved.size) return null;
  for (const raw of [
    input.requestedId,
    input.matchId,
    ...input.shortlistIds,
    input.approvedIds[0],
  ]) {
    const id = String(raw || "").trim();
    if (id && approved.has(id)) return id;
  }
  return null;
}

function skeletonFromPlaybook(playbook: { sections: unknown }): ProposalSection[] {
  const raw = Array.isArray(playbook.sections) ? playbook.sections : [];
  const usedKeys = new Set<string>();
  return raw
    .map((item, i) => {
      if (!item || typeof item !== "object") return null;
      const s = item as Record<string, unknown>;
      const rawTitle = String(s.title || s.key || "").trim();
      let key = String(s.key || rawTitle || `section_${i + 1}`)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
      if (!rawTitle && !key) return null;
      // Cover is rendered by the blueprint header — keep it out of body slots.
      if (key === "cover" || /^commercial\s*proposal$/i.test(rawTitle)) {
        return null;
      }
      if (!key) key = `section_${i + 1}`;
      if (usedKeys.has(key)) {
        key = `${key}_${i + 1}`;
      }
      usedKeys.add(key);
      return {
        id: `pb${randomBytes(6).toString("hex")}`,
        key,
        title: cleanSectionTitle(rawTitle, key),
        body: "",
        sortOrder: i + 1,
        ...(s.tableSpec && typeof s.tableSpec === "object"
          ? { tableSpec: s.tableSpec }
          : {}),
      };
    })
    .filter((s): s is ProposalSection => s != null);
}

export async function createProposalFromPlaybookCommand(input: {
  dealId: string;
  requirementText: string;
  title?: string | null;
  templateId?: string | null;
  playbookId?: string | null;
  productIds?: string[] | null;
  productHint?: string | null;
  /** Optional requirement file (PDF/DOCX/TXT/MD, base64) — text is extracted and prepended. */
  requirementPdfBase64?: string | null;
  requirementFilename?: string | null;
  /** When set, overwrite this draft instead of creating a new proposal. */
  replaceProposalId?: string | null;
  /** Where the requirement facts came from — drives writer prompts, not layout. */
  requirementSource?: "meeting" | "brd" | "meeting+brd" | "manual";
  /** Wait for generate to finish (scripts / post-meeting). UI uses async jobs. */
  sync?: boolean;
  /** Durable V2 run — skip enqueue and persist snapshots. */
  generationRunId?: string | null;
}) {
  try {
    await requireRole(canEditDeals, "You cannot create proposals.");
    const deal = await assertDealAccess(input.dealId);
    const orgId = await getCurrentOrganizationId();
    const userId = await getServerUserId();
    const warnings: string[] = [];

    const approvedEarly = await listApprovedPlaybooks(orgId);
    if (approvedEarly.length === 0) {
      return {
        ok: false as const,
        error:
          "No learned proposal patterns yet. Upload historical proposals in Configuration → Proposal patterns. Agents use those patterns automatically when generating.",
      };
    }

    if (!input.sync) {
      if (!input.generationRunId && isProposalPipelineV2Enabled(orgId)) {
        const { enqueueProposalGenerationRun } = await import(
          "@/service/sales/proposal-run-commands"
        );
        try {
          return await enqueueProposalGenerationRun({
            dealId: input.dealId,
            requirementText: input.requirementText,
            title: input.title,
            playbookId: input.playbookId,
            productIds: input.productIds,
            productHint: input.productHint,
            requirementPdfBase64: input.requirementPdfBase64,
            requirementFilename: input.requirementFilename,
            replaceProposalId: input.replaceProposalId,
            requirementSource: input.requirementSource,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (/ProposalGenerationRun|proposal_generation_runs/i.test(message)) {
            console.warn("[proposal-generate] V2 unavailable, using sync legacy path", {
              error: message.slice(0, 300),
            });
          } else {
            throw err;
          }
        }
      }
      const hasInlineRequirement =
        (input.requirementText || "").trim().length >= 8 ||
        Boolean(input.requirementPdfBase64?.trim()) ||
        Boolean(input.replaceProposalId);
      let hasRequirement = hasInlineRequirement;
      if (!hasRequirement) {
        const meetingPeek = await loadMeetingNotesForDeal(input.dealId);
        hasRequirement = Boolean(meetingPeek?.trim());
      }
      if (!hasRequirement) {
        return {
          ok: false as const,
          error:
            "Provide a BRD, meeting notes on this deal, or a requirement brief.",
        };
      }
      const replaceId = input.replaceProposalId?.trim() || null;
      let jobId = replaceId;
      if (replaceId) {
        await prisma.proposal.update({
          where: { id: replaceId },
          data: { approvalStatus: "generating" },
        });
      } else {
        const stub = await createProposal({
          dealId: input.dealId,
          title:
            (input.title || "").trim() ||
            `Proposal for ${deal.company?.name || "customer"}`,
          summary: "Generating proposal…",
          customerName: deal.company?.name ?? null,
          sections: [],
          createdByUserId: userId,
          organizationId: orgId,
          approvalStatus: "generating",
        });
        jobId = stub.id;
      }
      const targetId = jobId!;
      const actorId = userId;
      markProposalGenerateInFlight(targetId);
      console.info("[proposal-generate] job queued", {
        proposalId: targetId,
        dealId: input.dealId,
        organizationId: orgId,
        hasPdf: Boolean(input.requirementPdfBase64?.trim()),
        requirementChars: (input.requirementText || "").trim().length,
      });
      void withUser(actorId, async () => {
        console.info("[proposal-generate] job started", {
          proposalId: targetId,
          dealId: input.dealId,
          organizationId: orgId,
        });
        const result = await createProposalFromPlaybookCommand({
          ...input,
          replaceProposalId: targetId,
          sync: true,
        });
        if (!result.ok) {
          console.warn("[proposal-generate] job failed", {
            proposalId: targetId,
            error: result.error,
          });
          await prisma.proposal
            .update({
              where: { id: targetId },
              data: {
                approvalStatus: "failed",
                summary: result.error.slice(0, 500),
              },
            })
            .catch(() => undefined);
        } else {
          console.info("[proposal-generate] job completed", {
            proposalId: targetId,
            playbookId: result.playbookId,
            warnings: result.warnings?.length ?? 0,
          });
        }
      })
        .catch(async (err) => {
          console.error("[proposal-generate] job crashed", {
            proposalId: targetId,
            error: err instanceof Error ? err.message : String(err),
          });
          await prisma.proposal
            .update({
              where: { id: targetId },
              data: {
                approvalStatus: "failed",
                summary: String(err instanceof Error ? err.message : err).slice(
                  0,
                  500,
                ),
              },
            })
            .catch(() => undefined);
        })
        .finally(() => {
          clearProposalGenerateInFlight(targetId);
        });
      return {
        ok: true as const,
        id: targetId,
        status: "generating" as const,
        warnings,
      };
    }

    const meetingNotes = await loadMeetingNotesForDeal(input.dealId);
    let requirement = (input.requirementText || "").trim();
    const pdfB64 = input.requirementPdfBase64?.trim() || "";
    if (pdfB64) {
      const filename =
        input.requirementFilename?.trim() || "requirement.pdf";
      const ingest = await callAiServiceAgent<{
        ok?: boolean;
        fullText?: string;
        reason?: string;
      }>(
        "proposal-corpus-ingest",
        {
          itemId: `req-${randomBytes(6).toString("hex")}`,
          filename,
          contentBase64: pdfB64,
          organizationId: orgId,
        },
        { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS },
      );
      const extracted = String(ingest?.fullText || "").trim();
      console.info("[proposal-generate] requirement file ingest", {
        organizationId: orgId,
        filename,
        extractedChars: extracted.length,
        ok: ingest?.ok,
        reason: ingest?.reason,
      });
      if (extracted.length >= 8) {
        requirement = requirement
          ? `${extracted}\n\n---\n\n${requirement}`
          : extracted;
      } else if (!ingest?.ok) {
        warnings.push(
          ingest?.reason
            ? `Could not read the requirement file (${ingest.reason}).`
            : "Could not extract text from the requirement file.",
        );
      }
    }
    if (input.replaceProposalId && requirement.length < 8) {
      const existing = await getProposal(input.replaceProposalId);
      const stored = readStoredProposalRequirement(existing?.blueprint);
      if (stored) requirement = stored;
    }
    if (requirement.length < 8 && !(meetingNotes?.trim())) {
      return {
        ok: false as const,
        error:
          "Provide a BRD, meeting notes on this deal, or a requirement brief.",
      };
    }

    const approved = await listApprovedPlaybooks(orgId);
    if (approved.length === 0) {
      return {
        ok: false as const,
        error:
          "No learned proposal patterns yet. Upload historical proposals in Configuration → Proposal patterns. Agents use those patterns automatically when generating.",
      };
    }

    const runId = `ppg${randomBytes(10).toString("hex")}`;
    console.info("[proposal-generate] sync run start", {
      dealId: input.dealId,
      organizationId: orgId,
      proposalId: input.replaceProposalId ?? null,
      runId,
      requirementChars: requirement.length,
      meetingChars: (meetingNotes || "").length,
    });
    const seller = await loadSellerOrganization(orgId);
    const fullRequirement = composeProposalRequirement({
      meetingNotes,
      requirementText: requirement,
    });
    const requirementSource =
      input.requirementSource ??
      (meetingNotes?.trim() && pdfB64
        ? "meeting+brd"
        : meetingNotes?.trim()
          ? "meeting"
          : pdfB64
            ? "brd"
            : "manual");

    await recordAgentStep({
      organizationId: orgId,
      agent: "proposal_generate",
      jobId: runId,
      contactId: null,
      step: "profile",
      label: "Profile requirement",
      status: "started",
    });

    const profileRes = await callAiServiceAgent<{
      ok?: boolean;
      profile?: Record<string, unknown>;
      source?: string;
    }>(
      "proposal-requirement-profile",
      {
        requirementText: fullRequirement,
        dealTitle: deal.title,
        companyName: deal.company?.name ?? null,
        companyIndustry: null,
        organizationId: orgId,
      },
      { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS },
    );

    let profile = profileRes?.profile ?? {
      themes: [],
      products: [],
      summary: requirement.slice(0, 400),
      dealSizeBand: "unknown",
    };
    const requirementCustomer = String(profile.customerName || "").trim();
    const dealCustomer = deal.company?.name?.trim() || "";
    const normalizeCompany = (value: string) =>
      value
        .toLowerCase()
        .replace(/\b(?:private|pvt|limited|ltd|inc|llc|plc)\b/g, "")
        .replace(/[^a-z0-9]+/g, "")
        .trim();
    const normalizedRequirementCustomer = normalizeCompany(requirementCustomer);
    const normalizedDealCustomer = normalizeCompany(dealCustomer);
    if (
      normalizedRequirementCustomer.length >= 3 &&
      normalizedDealCustomer.length >= 3 &&
      !normalizedRequirementCustomer.includes(normalizedDealCustomer) &&
      !normalizedDealCustomer.includes(normalizedRequirementCustomer)
    ) {
      return {
        ok: false as const,
        error: `The requirement names ${requirementCustomer}, but this deal belongs to ${dealCustomer}. Generate from the matching deal or upload the correct requirement.`,
      };
    }

    await recordAgentStep({
      organizationId: orgId,
      agent: "proposal_generate",
      jobId: runId,
      contactId: null,
      step: "profile",
      label: "Profile requirement",
      status: "ok",
      detail: { source: profileRes?.source },
    });
    console.info("[proposal-generate] profile done", {
      organizationId: orgId,
      runId,
      source: profileRes?.source,
      themes: profile.themes,
      products: profile.products,
    });

    const playbookRows = approved.map(playbookView);
    let storedThemes: string[] = [];
    if (input.replaceProposalId) {
      const existingForThemes = await getProposal(input.replaceProposalId);
      storedThemes = readStoredRequirementThemes(existingForThemes?.blueprint);
    }
    const themesChanged = requirementThemesChanged(storedThemes, profile.themes);
    let matchedId = input.playbookId?.trim() || null;
    let matchMeta: Record<string, unknown> = {};
    if (themesChanged) {
      console.info("[proposal-generate] requirement themes changed, rematching playbook", {
        organizationId: orgId,
        runId,
        storedThemes,
        themes: profile.themes,
      });
      matchedId = null;
    }

    if (!matchedId || !playbookRows.some((p) => p.id === matchedId)) {
      await recordAgentStep({
        organizationId: orgId,
        agent: "proposal_generate",
        jobId: runId,
        contactId: null,
        step: "match",
        label: "Match playbook",
        status: "started",
      });
      const shortlist = retrieveTopPlaybooks(
        profile as Record<string, unknown>,
        playbookRows,
        5,
      );
      const shortlistRows = shortlist
        .map((card) => playbookRows.find((p) => p.id === card.id))
        .filter((p): p is (typeof playbookRows)[number] => Boolean(p));
      const match = await callAiServiceAgent<{
        playbookId?: string;
        confidence?: number;
        rationale?: string;
        source?: string;
        reason?: string;
      }>(
        "proposal-playbook-match",
        {
          profile,
          playbooks: shortlistRows.map((p) => {
            const pattern = playbookPatternForGeneration(p);
            return {
              id: p.id,
              name: p.name,
              tags: pattern.content.matchTags,
              content: pattern.content,
              sectionKeys: pattern.content.sectionOrder.slice(0, 12),
              blurb: shortlist.find((c) => c.id === p.id)?.blurb ?? "",
              retrieveScore: shortlist.find((c) => c.id === p.id)?.score ?? 0,
            };
          }),
          organizationId: orgId,
        },
        { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS },
      );
      matchedId = selectLearnedPlaybookId({
        requestedId: matchedId,
        matchId: match?.playbookId,
        shortlistIds: shortlist.map((c) => c.id),
        approvedIds: playbookRows.map((p) => p.id),
      });
      matchMeta = {
        confidence: match?.confidence,
        rationale: match?.rationale,
        source: match?.source,
        reason: match?.reason,
        shortlist: shortlist.map((c) => ({
          id: c.id,
          name: c.name,
          score: c.score,
        })),
      };
      await recordAgentStep({
        organizationId: orgId,
        agent: "proposal_generate",
        jobId: runId,
        contactId: null,
        step: "match",
        label: "Match playbook",
        status: "ok",
        detail: matchMeta,
      });
      // Learned patterns are writing/layout templates for this org — not a
      // topical classifier. Low match confidence still uses the playbook.
      if (!matchedId) {
        return {
          ok: false as const,
          error:
            "No learned proposal patterns yet. Upload historical proposals in Configuration → Proposal patterns.",
        };
      }
    }

    const playbook =
      playbookRows.find((p) => p.id === matchedId) ?? playbookRows[0];

    const skeleton = skeletonFromPlaybook(playbook);
    console.info("[proposal-generate] playbook selected", {
      organizationId: orgId,
      runId,
      playbookId: playbook.id,
      playbookName: playbook.name,
      skeletonKeys: skeleton.map((s) => s.key),
      contentPlaybook: Boolean(playbook.contentPlaybookId),
    });
    if (skeleton.length === 0) {
      return {
        ok: false as const,
        error: "The learned pattern has no sections to write.",
      };
    }
    if (
      isPlaybookTemplateBlueprint(playbook.blueprint) &&
      !playbookVisualTemplateReady(playbook.blueprint)
    ) {
      await recordAgentStep({
        organizationId: orgId,
        agent: "proposal_generate",
        jobId: runId,
        contactId: null,
        step: "generate",
        label: "Generate sections",
        status: "failed",
        errorReason: "Playbook has no visual template.",
      });
      return {
        ok: false as const,
        error:
          "This playbook has no visual template; Retry learning in Configuration → Proposal patterns.",
      };
    }

    const companyName = deal.company?.name?.trim() || "Customer";
    const customerName = companyName;
    const vendorName = seller?.companyName?.trim() || "Vendor";
    const date = new Date().toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    const titleBase =
      input.title?.trim() ||
      `Proposal — ${String(profile.summary || deal.title).slice(0, 60)}`;

    const dealContext = {
      customerName,
      companyName,
      companyDomain: null as string | null,
      companyIndustry: null as string | null,
      companyEmployeeCount: null as number | null,
      dealTitle: deal.title,
      dealStage: deal.stage,
      dealAmount: deal.amount != null ? String(deal.amount) : null,
      dealNotes: deal.notes?.trim() || null,
      contactName: deal.contactName?.trim() || null,
      contactEmail: deal.contactEmail?.trim() || null,
      date,
      vendorName,
      seller: seller
        ? {
            companyName: seller.companyName,
            industryType: seller.industryType,
            businessType: seller.businessType,
            websiteUrl: seller.websiteUrl,
            country: seller.country,
            companySize: seller.companySize,
            contactName: seller.contactName,
            workEmail: seller.workEmail,
            billingAddress: seller.billingAddress,
          }
        : null,
    };

    const productHint = input.productHint?.trim() || null;

    const profileProductNames = Array.isArray(profile.products)
      ? profile.products.map((p) => String(p)).filter(Boolean)
      : [];
    const scoped = await resolveProposalProductScope({
      dealId: input.dealId,
      organizationId: orgId,
      dealTitle: deal.title,
      dealNotes: deal.notes?.trim() || null,
      matchText: fullRequirement,
      productHint,
      productIds: input.productIds,
      profileProductNames,
      // Previous draft titles often list the whole catalog — don't re-scope from them.
      title: input.replaceProposalId ? null : input.title,
    });

    const productScope = scoped.productScope?.trim() || scoped.product?.name || null;

    const allowedProductNames = (scoped.discussedProducts ?? [])
      .map((p) => p.name.trim())
      .filter(Boolean);
    if (allowedProductNames.length) {
      profile = {
        ...profile,
        products: allowedProductNames,
      };
    }

    const selectedIds = new Set<string>();
    for (const p of scoped.discussedProducts ?? []) {
      if (p.productId) selectedIds.add(p.productId);
    }
    for (const id of input.productIds ?? []) {
      const trimmed = id?.trim();
      if (trimmed) selectedIds.add(trimmed);
    }
    for (const line of scoped.quoteLines ?? []) {
      const quoted = line.productId?.trim();
      if (quoted) selectedIds.add(quoted);
    }
    if (scoped.product?.productId) {
      selectedIds.add(scoped.product.productId);
    }
    const catalogById = new Map<string, ProposalCatalogProduct>();
    const catalogAll = await listActiveProductsForProposalCatalog(orgId, 100);
    for (const p of catalogAll) catalogById.set(p.id, p);
    if (selectedIds.size) {
      const scopedRows = await listProductsByIds([...selectedIds]);
      for (const p of scopedRows) catalogById.set(p.id, p);
    }
    const catalog = [...catalogById.values()];
    console.info("[proposal-generate] catalog from db", {
      organizationId: orgId,
      runId,
      dealId: input.dealId,
      selectedProductIds: [...selectedIds],
      catalogCount: catalog.length,
      orgCatalogCount: catalogAll.length,
      catalog: catalog.map((p) => compactCatalogProductForLog(p)),
      quoteLines: (scoped.quoteLines ?? []).map((line) => ({
        name: line.name,
        productId: line.productId ?? null,
        quantity: line.quantity ?? null,
        unitPrice: line.unitPrice ?? null,
      })),
    });
    const byId = new Map(catalog.map((p) => [p.id, p]));
    const productPayload = [
      ...catalog.map((p) => {
        const unit = catalogRateUnitLabel({
          unitOfMeasure: p.unitOfMeasure,
          billingFrequency: p.billingFrequency,
          offers: p.offers,
          addons: p.addons,
        });
        return {
          id: p.id,
          name: p.name,
          price: p.price ?? null,
          currency: p.currency ?? null,
          sku: p.sku ?? null,
          description: p.description ?? null,
          tagline: p.tagline ?? null,
          category: p.category ?? null,
          unitOfMeasure: p.unitOfMeasure ?? null,
          billingFrequency: p.billingFrequency ?? null,
          billingType: p.billingType ?? null,
          offers: p.offers,
          addons: p.addons,
          unit,
          uom: p.unitOfMeasure ?? null,
        };
      }),
      ...(scoped.discussedProducts ?? [])
        .filter((p) => p.productId && !byId.has(p.productId))
        .map((p) => {
          const unit = catalogRateUnitLabel({
            unitOfMeasure: p.unitOfMeasure,
          });
          return {
            id: p.productId,
            name: p.name,
            price: p.price ?? null,
            currency: p.currency ?? null,
            sku: p.sku ?? null,
            description: p.description ?? null,
            tagline: p.tagline ?? null,
            category: p.category ?? null,
            unitOfMeasure: p.unitOfMeasure ?? null,
            unit,
            uom: p.unitOfMeasure ?? null,
          };
        }),
    ];

    await recordAgentStep({
      organizationId: orgId,
      agent: "proposal_generate",
      jobId: runId,
      contactId: null,
      step: "generate",
      label: "Generate sections",
      status: "started",
    });

    const pattern = playbookPatternForGeneration(playbook);
    const templateMode = playbookVisualTemplateReady(playbook.blueprint);
    const { format } = splitPlaybookPattern(playbook);
    const storedTemplate = templateMode
      ? (playbook.blueprint as Record<string, unknown>)
      : null;
    const visualMode = storedTemplate ? "playbook-template" : "playbook-layout";
    const assets = null;
    const coverLayout =
      storedTemplate?.coverLayout &&
      typeof storedTemplate.coverLayout === "object" &&
      !Array.isArray(storedTemplate.coverLayout)
        ? (storedTemplate.coverLayout as Record<string, unknown>)
        : null;
    const playbookAssets =
      playbook.assets && typeof playbook.assets === "object" && !Array.isArray(playbook.assets)
        ? (playbook.assets as Record<string, unknown>)
        : {};
    const tokens: Record<string, string> = {
      vendorName,
      customerName,
      companyName,
      date,
      productScope: productScope || "",
      dealTitle: deal.title || "",
      documentTitle: "",
    };
    const tablesFromSections = pattern.content.sections
      .map((section) => {
        const spec =
          section.tableSpec &&
          typeof section.tableSpec === "object" &&
          !Array.isArray(section.tableSpec)
            ? (section.tableSpec as { columns?: unknown })
            : {};
        const columns = Array.isArray(spec.columns)
          ? spec.columns.map((c) => String(c).trim()).filter(Boolean)
          : defaultColumnsForSectionKey(section.key);
        if (!columns.length) return null;
        return { key: section.key, columns };
      })
      .filter((row): row is { key: string; columns: string[] } => Boolean(row));
    const storedSchema =
      pattern.content.featureSchema &&
      typeof pattern.content.featureSchema === "object"
        ? (pattern.content.featureSchema as { tables?: unknown[] })
        : {};
    const featureSchema = {
      ...storedSchema,
      tables: tablesFromSections.length
        ? tablesFromSections
        : Array.isArray(storedSchema.tables)
          ? storedSchema.tables
          : [],
    };
    const layoutShell = storedTemplate
      ? null
      : buildPlaybookDocumentBlueprint({
          layoutStyle: format,
          sections: pattern.content.sections.map((s) => ({
            key: s.key,
            title: s.title || s.key,
            tableSpec: s.tableSpec,
          })),
          featureSchema,
        });
    const templateShell = storedTemplate
      ? {
          html: String(storedTemplate.html || ""),
          css: String(storedTemplate.css || ""),
          slots: storedTemplate.slots,
          emphasis: storedTemplate.emphasis,
          mode: "playbook-template" as const,
          coverLayout,
          logoDataUrl: String(playbookAssets.logoDataUrl || ""),
        }
      : {
          html: String(layoutShell?.html || ""),
          css: String(layoutShell?.css || ""),
          slots: layoutShell?.slots,
          emphasis: layoutShell?.emphasis,
          mode: "playbook-template" as const,
        };

    let validatorNotes = "";
    let generated: {
      ok?: boolean;
      sections?: Array<ProposalSection & { tableRows?: Array<{ cells: string[] }> }>;
      html?: string;
      css?: string;
      content?: Record<string, unknown>;
      warnings?: string[];
      source?: string;
      reason?: string;
    } | null = null;
    let filledSections: Array<
      ProposalSection & {
        tableRows?: Array<{ cells: string[] }>;
        tableSpec?: unknown;
      }
    > = [];
    let sections: ProposalSection[] = [];
    let blueprint: Record<string, unknown> | null = null;

    const nearestInstances = playbookAssets.goldInstance
      ? [playbookAssets.goldInstance]
      : undefined;

    const existingProposal = Boolean(input.replaceProposalId?.trim());
    const latestContent = await getLatestContentPlaybookForOrg(orgId);
    const pinnedContent = playbook.contentPlaybookId
      ? await getContentPlaybookById(playbook.contentPlaybookId)
      : null;
    const contentPlaybook = resolveContentPlaybook({
      existingProposal,
      pinnedContentPlaybookId: playbook.contentPlaybookId ?? null,
      pinnedPlaybook: pinnedContent
        ? {
            id: pinnedContent.id,
            caseStudyCount: pinnedContent.caseStudyCount,
            confidenceLevel: pinnedContent.confidenceLevel,
            sectionSpecsJson: pinnedContent.sectionSpecsJson,
            lengthModelJson: pinnedContent.lengthModelJson,
            exemplarBankJson: pinnedContent.exemplarBankJson,
            varianceLogJson: pinnedContent.varianceLogJson,
          }
        : null,
      latestForOrg: latestContent
        ? {
            id: latestContent.id,
            caseStudyCount: latestContent.caseStudyCount,
            confidenceLevel: latestContent.confidenceLevel,
            sectionSpecsJson: latestContent.sectionSpecsJson,
            lengthModelJson: latestContent.lengthModelJson,
            exemplarBankJson: latestContent.exemplarBankJson,
            varianceLogJson: latestContent.varianceLogJson,
          }
        : null,
    }) as ContentPlaybookLike | null;
    const latestForSection = latestContent
      ? {
          id: latestContent.id,
          caseStudyCount: latestContent.caseStudyCount,
          confidenceLevel: latestContent.confidenceLevel,
          sectionSpecsJson: latestContent.sectionSpecsJson,
          lengthModelJson: latestContent.lengthModelJson,
          exemplarBankJson: latestContent.exemplarBankJson,
          varianceLogJson: latestContent.varianceLogJson,
        }
      : null;
    const writingPlaybook = contentPlaybookForSectionGenerate({
      resolved: contentPlaybook,
      latestForOrg: latestForSection,
      skeleton,
    });
    const caseStudies = await listCaseStudiesForOrg(orgId);
    console.info("[proposal-generate] section writing playbook", {
      organizationId: orgId,
      runId,
      visualContentPlaybookId: playbook.contentPlaybookId ?? null,
      resolvedContentPlaybookId: contentPlaybook?.id ?? null,
      writingPlaybookId: writingPlaybook.id,
      writingCaseStudyCount: writingPlaybook.caseStudyCount,
      skeletonKeys: skeleton.map((s) => s.key),
    });
    let v2DealBrief = "";
    if (input.generationRunId) {
      const v2 = await applyProposalV2PreWrite({
        generationRunId: input.generationRunId,
        organizationId: orgId,
        skeleton: skeleton.map((s) => ({
          key: String(s.key || s.id || ""),
          title: String(s.title || s.key || ""),
        })),
        requirementText: fullRequirement,
        products: productPayload as Array<Record<string, unknown> & { id?: string; name?: string }>,
        profile,
      });
      v2DealBrief = v2.dealBrief;
      if (v2.skeleton.length) {
        const byKey = new Map(v2.skeleton.map((s) => [s.key, s]));
        for (const section of skeleton) {
          const next = byKey.get(String(section.key || section.id || ""));
          if (next?.title) section.title = next.title;
        }
      }
    }
    const generateAttempts = proposalGenerateAttemptCount(contentPlaybook);
    let plannedLengths: Record<string, number> = {};
    let shortSectionKeys: string[] = [];
    let generatedTitle = titleBase;
    let coverTags: string[] = [];
    let usedWholeDocFallback = false;

    const wholeDocumentBody = {
      sections: skeleton,
      playbook: pattern,
      playbookFormat: pattern.format,
      playbookContent: pattern.content,
      blueprint: playbook.blueprint,
      assets: playbook.assets,
      nearestInstances,
      profile,
      layoutStyle: pattern.format,
      requirementText: fullRequirement,
      requirementSource,
      templateMode,
      validatorNotes: validatorNotes || undefined,
      context: {
        ...dealContext,
        dealNotes: [deal.notes, meetingNotes].filter(Boolean).join("\n\n"),
        productHint,
        productScope,
        allowedProducts: allowedProductNames,
        discussedProducts: allowedProductNames,
        quoteLines: scoped.quoteLines ?? [],
        product: scoped.product
          ? {
              name: scoped.product.name,
              description: scoped.product.description,
              price: scoped.product.price,
            }
          : null,
        requirementSummary: profile.summary,
        requirementSource,
        vendorName,
        seller,
        organizationId: orgId,
      },
      products: productPayload,
      vendorName,
      organizationId: orgId,
    };

    const learnedCss = String(
      (playbook.blueprint as { css?: string } | null)?.css ||
        templateShell.css ||
        "",
    );
    if (templateMode && !cssLooksComplete(learnedCss)) {
      warnings.push(
        "Learned template CSS looks incomplete (colors or table chrome may be missing). Generating anyway.",
      );
    }
    const pageImages = pageImagesFromPlaybookAssets(playbook.assets);
    console.info("[proposal-generate] template fill gate", {
      organizationId: orgId,
      runId,
      templateMode,
      pageImageCount: pageImages.length,
      cssComplete: cssLooksComplete(learnedCss),
    });
    if (templateMode && !pageImages.length) {
      warnings.push(
        "No learned page images on this playbook; using section writer.",
      );
    }

    for (let attempt = 1; attempt <= generateAttempts; attempt++) {
      let filledByTemplate = false;
      if (!usedWholeDocFallback && templateMode && pageImages.length) {
        console.info("[proposal-generate] template fill start", {
          organizationId: orgId,
          runId,
          pageImageCount: pageImages.length,
          catalogCount: productPayload.length,
        });
        const fill = await callAiServiceAgent<{
          source?: string;
          reason?: string;
          sections?: Array<ProposalSection & { tableRows?: Array<{ cells: string[] }> }>;
          warnings?: string[];
        }>(
          "proposal-fill-template",
          {
            organizationId: orgId,
            pageImages,
            skeleton: skeleton.map((section) => ({
              key: section.key,
              title: section.title,
              purpose: (section as { purpose?: string }).purpose,
              tableSpec: (section as { tableSpec?: unknown }).tableSpec,
            })),
            css: learnedCss,
            requirementText: fullRequirement,
            requirementSummary:
              typeof profile.summary === "string" ? profile.summary : "",
            allowedProducts: allowedProductNames,
            products: productPayload,
          },
          { timeoutMs: AI_SERVICE_MAX_TIMEOUT_MS },
        );
        const fillSections = Array.isArray(fill?.sections) ? fill.sections : [];
        if (fill?.source === "ai" && fillSections.length) {
          generated = {
            ok: true,
            source: "ai",
            sections: fillSections,
            html: "",
            warnings: fill.warnings,
          };
          filledByTemplate = true;
          console.info("[proposal-generate] template fill ok", {
            organizationId: orgId,
            runId,
            sections: fillSections.length,
          });
        } else {
          warnings.push(
            `Template fill unavailable (${fill?.reason || "empty"}); using section writer.`,
          );
        }
      }
      if (!usedWholeDocFallback && !filledByTemplate) {
        const orch = await generateProposalSectionsFromContentPlaybook({
          organizationId: orgId,
          skeleton,
          contentPlaybook: writingPlaybook,
          caseStudies,
          profile: profile as { themes?: unknown; summary?: unknown; products?: unknown },
          requirementText: fullRequirement,
          requirementWordCount: fullRequirement.split(/\s+/).filter(Boolean).length,
          allowedProducts: allowedProductNames,
          products: productPayload,
          generationRunId: input.generationRunId,
          dealBrief: v2DealBrief,
        });
        warnings.push(...orch.warnings);
        plannedLengths = orch.plannedLengths;
        shortSectionKeys = orch.shortSectionKeys ?? [];
        console.info("[proposal-generate] section orchestrator planned lengths", {
          organizationId: orgId,
          contentPlaybookId: writingPlaybook.id,
          plannedLengths: orch.plannedLengths,
        });
        generated = {
          ok: !orch.reason,
          source: orch.reason ? "heuristic" : "ai",
          sections: orch.sections,
          html: "",
          warnings: orch.warnings,
          reason: orch.reason,
        };
        if (
          orch.qaFailedKeys.length &&
          String(process.env.PROPOSAL_CONTENT_QA_MODE || "shadow").toLowerCase() ===
            "active"
        ) {
          let rewritten = orch.sections as ProposalSection[];
          for (const key of orch.qaFailedKeys) {
            const next = await rewriteProposalSectionBodies({
              sections: rewritten,
              sectionKey: key,
              instruction:
                "Rewrite to match the learned proposal playbook: specific, right length, no generic filler.",
              dealId: input.dealId,
              proposalTitle: titleBase,
            });
            rewritten = next.sections;
            warnings.push(...next.warnings);
          }
          generated.sections = rewritten;
        }
        const sectionModeFailed =
          generated.source !== "ai" || Boolean(orch.reason);
        if (
          sectionModeFailed &&
          shouldRetryWholeDocumentGenerate(orch.reason) &&
          !isProductKbUnavailableReason(orch.reason) &&
          !isGeminiUnavailableReason(orch.reason)
        ) {
          console.warn("[proposal-generate] section mode failed, whole-doc last resort", {
            organizationId: orgId,
            runId,
            reason: orch.reason,
            source: generated.source,
          });
          usedWholeDocFallback = true;
          generated = await callAiServiceAgent<typeof generated>(
            "proposal-generate",
            wholeDocumentBody,
            { timeoutMs: AI_SERVICE_MAX_TIMEOUT_MS },
          );
          if (!generated) {
            generated = {
              ok: false,
              source: "heuristic",
              reason: "gemini_unavailable",
              sections: skeleton,
            };
          }
        }
      } else {
        generated = await callAiServiceAgent<typeof generated>(
          "proposal-generate",
          {
            ...wholeDocumentBody,
            validatorNotes: validatorNotes || undefined,
          },
          { timeoutMs: AI_SERVICE_MAX_TIMEOUT_MS },
        );
        if (!generated) {
          generated = {
            ok: false,
            source: "heuristic",
            reason: "gemini_unavailable",
            sections: skeleton,
          };
        }
      }

      if (isProductKbUnavailableReason(generated?.reason)) {
        await recordAgentStep({
          organizationId: orgId,
          agent: "proposal_generate",
          jobId: runId,
          contactId: null,
          step: "generate",
          label: "Generate sections",
          status: "failed",
          detail: {
            source: generated?.source,
            reason: generated?.reason,
          },
          errorReason: PRODUCT_KB_UNAVAILABLE_MESSAGE,
        });
        return {
          ok: false as const,
          error: PRODUCT_KB_UNAVAILABLE_MESSAGE,
        };
      }
      if (isGeminiUnavailableReason(generated?.reason)) {
        await recordAgentStep({
          organizationId: orgId,
          agent: "proposal_generate",
          jobId: runId,
          contactId: null,
          step: "generate",
          label: "Generate sections",
          status: "failed",
          detail: {
            source: generated?.source,
            reason: generated?.reason,
          },
          errorReason: GEMINI_UNAVAILABLE_MESSAGE,
        });
        return {
          ok: false as const,
          error: GEMINI_UNAVAILABLE_MESSAGE,
        };
      }

      const generatedSections: Array<
        ProposalSection & { tableRows?: Array<{ cells: string[] }>; tableSpec?: unknown }
      > =
        Array.isArray(generated?.sections) && generated.sections.length > 0
          ? (generated.sections as Array<
              ProposalSection & { tableRows?: Array<{ cells: string[] }>; tableSpec?: unknown }
            >)
          : skeleton;
      const specByKey = new Map(
        skeleton.map((section) => [String(section.key || ""), section]),
      );
      for (const section of generatedSections) {
        const learned = specByKey.get(String(section.key || ""));
        if (learned && !(section as { tableSpec?: unknown }).tableSpec) {
          (section as { tableSpec?: unknown }).tableSpec = (
            learned as { tableSpec?: unknown }
          ).tableSpec;
        }
      }
      if (generated?.source === "ai") {
        const retried = await retryCommercialTableGaps({
          organizationId: orgId,
          sections: generatedSections,
          requirementText: fullRequirement,
          products: productPayload,
          allowedProducts: allowedProductNames,
          profile,
          dealBrief: v2DealBrief,
        });
        if (retried.retried.length) {
          generatedSections.splice(0, generatedSections.length, ...retried.sections);
          console.info("[proposal-generate] commercial table retried", {
            organizationId: orgId,
            runId,
            keys: retried.retried,
          });
        }
      }

      const catalogNames = catalog.map((p) => p.name).filter(Boolean);
      const gated = gateProposalSectionsAgainstAllowedProducts({
        sections: generatedSections,
        allowedProducts: allowedProductNames,
        catalogNames,
      });
      if (gated.stripped.length && attempt === 1) {
        warnings.push(
          `Removed out-of-scope product mentions (${gated.stripped.slice(0, 6).join(", ")}).`,
        );
      }
      const allBodies = generatedSections.map((section, i) =>
        String(gated.sections[i]?.body ?? section.body ?? ""),
      );
      filledSections = generatedSections.map((section, i) => {
        const playbookSection = pattern.content.sections.find(
          (row) => String(row.key || "") === String(section.key || ""),
        );
        const tableSpec = playbookSection?.tableSpec;
        const existingRows =
          (
            gated.sections[i] as {
              tableRows?: Array<{ cells: string[] }>;
            }
          )?.tableRows ?? section.tableRows;
        const body = String(gated.sections[i]?.body ?? section.body ?? "");
        const tableRows = tableRowsForSection({
          key: String(section.key || ""),
          body,
          tableRows: existingRows,
          tableSpec,
          allBodies,
          requirementText: fullRequirement,
          allowedProducts: allowedProductNames,
        });
        return {
          ...section,
          body,
          tableRows,
          tableSpec,
        };
      });
      console.info("[proposal-generate] commercial tables from llm (catalog in prompt)", {
        organizationId: orgId,
        runId,
        catalogProductCount: productPayload.length,
      });
      console.info("[proposal-generate] proposal table money cells", {
        organizationId: orgId,
        runId,
        tables: pricingTableCellsForLog(filledSections),
      });
      if (input.generationRunId) {
        const qa = runDeterministicProposalQa({
          sections: filledSections,
          requirementText: fullRequirement,
          allowedPriceTokens: catalogAmountAllowlist(productPayload),
        });
        await markProposalGenerationRun(input.generationRunId, {
          qaReport: qa as unknown as Prisma.InputJsonValue,
        }).catch(() => undefined);
        if (!qa.ok) {
          warnings.push(
            `Deterministic QA flagged ${qa.findings.map((f) => f.code).join(", ")}.`,
          );
        }
      }
      sections = filledSections.map((section) => ({
        id: section.id,
        key: section.key,
        title: section.title,
        body: section.body,
        sortOrder: section.sortOrder,
      }));

      const tableChars = filledSections.reduce((sum, section) => {
        const rows = section.tableRows ?? [];
        return (
          sum +
          rows.reduce(
            (rowSum, row) =>
              rowSum +
              (row.cells || []).reduce((c, cell) => c + String(cell || "").length, 0),
            0,
          )
        );
      }, 0);
      const totalBodyChars =
        sections.reduce(
          (sum, section) => sum + String(section.body || "").trim().length,
          0,
        ) + tableChars;
      const placeholderBodies = sections.filter((section) =>
        /(?:^|\n)(?:Requirement themes:|Present |Define |Clarify |Close with )/i.test(
          String(section.body || "").trim(),
        ),
      ).length;
      const emptyBodies = sections.filter((section, i) => {
        const bodyEmpty = !String(section.body || "").trim();
        const rows = filledSections[i]?.tableRows ?? [];
        const hasRows = rows.some((row) =>
          (row.cells || []).some((cell) => String(cell || "").trim()),
        );
        return bodyEmpty && !hasRows;
      }).length;
      const minChars =
        tableChars > 200
          ? Math.max(800, sections.length * 120)
          : Math.max(1_500, sections.length * 220);
      const belowBand =
        writingPlaybook && Object.keys(plannedLengths).length
          ? sectionsBelowPlannedWordBand(filledSections, plannedLengths)
          : shortSectionKeys;
      const namedShort = [...new Set(belowBand.filter(Boolean))];
      if (
        generated?.source !== "ai" ||
        namedShort.length > 0 ||
        totalBodyChars < minChars ||
        placeholderBodies >= Math.ceil(sections.length / 3) ||
        emptyBodies > 0
      ) {
        const reason = String(generated?.reason || "");
        console.warn("[proposal-generate] quality gate failed", {
          organizationId: orgId,
          runId,
          attempt,
          source: generated?.source,
          reason,
          totalBodyChars,
          minChars,
          placeholderBodies,
          emptyBodies,
          shortSectionKeys: namedShort,
          sectionCount: sections.length,
        });
        const timedOut =
          !generated || /timeout|timed out|llm_error/i.test(reason);
        await recordAgentStep({
          organizationId: orgId,
          agent: "proposal_generate",
          jobId: runId,
          contactId: null,
          step: "generate",
          label: "Generate sections",
          status: "failed",
          detail: {
            source: generated?.source,
            reason: generated?.reason,
            totalBodyChars,
            placeholderBodies,
            emptyBodies,
            shortSectionKeys: namedShort,
          },
          errorReason: proposalGenerateQualityGateError({
            reason,
            source: generated?.source,
            timedOut,
            shortSectionKeys: namedShort,
          }),
        });
        return {
          ok: false as const,
          error: proposalGenerateQualityGateError({
            reason,
            source: generated?.source,
            timedOut,
            shortSectionKeys: namedShort,
          }),
        };
      }

      const named = await nameGeneratedProposalDocument({
        customerName,
        sections: filledSections,
        profileProducts: profileProductNames,
      });
      generatedTitle = named.title;
      coverTags = named.productTags;
      tokens.documentTitle = named.title;

      const coverPaint = {
        coverLayout,
        tokens,
        allowedProducts: allowedProductNames,
        productTags: coverTags,
        logoDataUrl: String(playbookAssets.logoDataUrl || ""),
      };
      const nextBlueprint: DocumentBlueprint = String(generated?.html || "").trim()
        ? {
            version: 1,
            chrome: false,
            html: applyPlaybookCoverHtml(String(generated.html || ""), coverPaint),
            css: String(generated.css || templateShell.css || ""),
            slots: Array.isArray(templateShell.slots)
              ? templateShell.slots
              : undefined,
            emphasis:
              templateShell.emphasis &&
              typeof templateShell.emphasis === "object" &&
              !Array.isArray(templateShell.emphasis)
                ? (templateShell.emphasis as DocumentBlueprint["emphasis"])
                : undefined,
            mode: "playbook-template",
          }
        : fillPlaybookTemplate({
            template: {
              html: String(templateShell.html || ""),
              css: String(templateShell.css || ""),
              slots: templateShell.slots,
              emphasis: templateShell.emphasis,
              mode: "playbook-template" as const,
              coverLayout,
              logoDataUrl: String(playbookAssets.logoDataUrl || ""),
            },
            tokens,
            sections: filledSections,
            allowedProducts: allowedProductNames,
            productTags: coverTags,
            requirementText: fullRequirement,
          });
      blueprint = {
        ...nextBlueprint,
        playbookId: playbook.id,
        layoutStyle: format,
        sourceBatchId: playbook.sourceBatchId ?? null,
        visualMaster: false,
      };
      blueprint = withStoredProposalRequirement(
        blueprint,
        requirement,
        requirementSource,
        profile.themes,
      );
      const usedFrozenHtml = Boolean(String(generated?.html || "").trim());
      console.info("[proposal-generate] html filled", {
        organizationId: orgId,
        runId,
        htmlChars: String(nextBlueprint.html || "").length,
        cssChars: String(nextBlueprint.css || "").length,
        sectionCount: filledSections.length,
        usedFrozenHtml,
      });
      const structural = validateGeneratedProposalHtml({
        html: String(nextBlueprint.html || ""),
        sectionOrder: usedFrozenHtml
          ? []
          : pattern.content.sectionOrder || skeleton.map((s) => s.key),
        tableSpecKeys: usedFrozenHtml
          ? []
          : tableSpecKeysFromPlaybook({
              sections: filledSections,
              featureSchema,
            }),
        playbookId: playbook.id,
      });
      if (usedFrozenHtml && !/proposal-doc/i.test(String(nextBlueprint.html || ""))) {
        validatorNotes = "Frozen HTML missing proposal-doc root.";
        if (attempt === generateAttempts) {
          await recordAgentStep({
            organizationId: orgId,
            agent: "proposal_generate",
            jobId: runId,
            contactId: null,
            step: "generate",
            label: "Generate sections",
            status: "failed",
            detail: { reasons: [validatorNotes] },
            errorReason: "Filled proposal failed the structural validator.",
          });
          return {
            ok: false as const,
            error:
              "The generated proposal did not match the learned template. Nothing was saved. Retry after Retry learning if the playbook skeleton is incomplete.",
          };
        }
        continue;
      }
      if (structural.ok) break;
      validatorNotes = structural.reasons.join("; ").slice(0, 1200);
      if (attempt === generateAttempts) {
        await recordAgentStep({
          organizationId: orgId,
          agent: "proposal_generate",
          jobId: runId,
          contactId: null,
          step: "generate",
          label: "Generate sections",
          status: "failed",
          detail: { reasons: structural.reasons },
          errorReason: "Filled proposal failed the structural validator.",
        });
        return {
          ok: false as const,
          error:
            "The generated proposal did not match the learned template. Nothing was saved. Retry after Retry learning if the playbook skeleton is incomplete.",
        };
      }
    }

    if (generated?.warnings?.length) warnings.push(...generated.warnings);

    await recordAgentStep({
      organizationId: orgId,
      agent: "proposal_generate",
      jobId: runId,
      contactId: null,
      step: "generate",
      label: "Generate sections",
      status: "ok",
      detail: {
        source: generated?.source,
        playbookId: playbook.id,
        sectionCount: sections.length,
      },
    });

    const title = generatedTitle;

    const summary =
      typeof profile.summary === "string"
        ? profile.summary.slice(0, 500)
        : `Proposal for ${customerName}`;

    if (!blueprint) {
      return {
        ok: false as const,
        error:
          "The generated proposal did not match the learned template. Nothing was saved.",
      };
    }

    await recordAgentStep({
      organizationId: orgId,
      agent: "proposal_generate",
      jobId: runId,
      contactId: null,
      step: "layout",
      label: "Apply Format layout",
      status: "ok",
      detail: {
        playbookId: playbook.id,
        coverStyle: format.coverStyle,
        sectionCount: sections.length,
      },
    });

    const replaceId = input.replaceProposalId?.trim() || null;
    if (replaceId) {
      const existing = await getProposal(replaceId);
      if (!existing || existing.dealId !== input.dealId) {
        return {
          ok: false as const,
          error: "Proposal not found for this deal.",
        };
      }
      if (existing.status !== "draft") {
        return {
          ok: false as const,
          error: "Only draft proposals can be regenerated.",
        };
      }
      await prisma.proposal.update({
        where: { id: replaceId },
        data: {
          title,
          summary,
          sections: filledSections as unknown as Prisma.InputJsonValue,
          customerName,
          templateId: null,
          blueprint: blueprint as unknown as Prisma.InputJsonValue,
          approvalStatus: "drafting",
          assets:
            assets == null
              ? Prisma.DbNull
              : (assets as Prisma.InputJsonValue),
        },
      });
      console.info("[proposal-generate] proposal saved", {
        organizationId: orgId,
        runId,
        proposalId: replaceId,
        sectionCount: filledSections.length,
        title,
      });
      return {
        ok: true as const,
        id: replaceId,
        playbookId: playbook.id,
        runId,
        warnings,
        match: matchMeta,
        visualMode,
      };
    }

    const proposal = await createProposal({
      dealId: input.dealId,
      title,
      summary,
      templateId: null,
      sections: filledSections as unknown as ProposalSection[],
      blueprint,
      assets: assets ?? undefined,
      customerName,
      createdByUserId: userId,
      organizationId: orgId,
    });

    await updateProposal(proposal.id, {
      sections: filledSections as unknown as ProposalSection[],
      blueprint,
      ...(assets != null ? { assets } : {}),
    });

    console.info("[proposal-generate] proposal saved", {
      organizationId: orgId,
      runId,
      proposalId: proposal.id,
      sectionCount: filledSections.length,
      title,
    });

    return {
      ok: true as const,
      id: proposal.id,
      playbookId: playbook.id,
      runId,
      warnings,
      match: matchMeta,
      visualMode,
    };
  } catch (err) {
    console.error("[proposal-generate] sync run error", {
      dealId: input.dealId,
      proposalId: input.replaceProposalId ?? null,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : "Failed to generate proposal.",
    };
  }
}
