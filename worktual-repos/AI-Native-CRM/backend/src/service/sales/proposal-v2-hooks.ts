/**
 * V2 pre-write hooks: plan, conservative outline, deal brief.
 * Catalog prices stay on products for the section writer — no TS pricing math.
 */

import { callAiServiceAgent, AI_SERVICE_JOB_TIMEOUT_MS } from "@/service/ai/ai-service-client";
import { markProposalGenerationRun } from "@/dao/sales/proposal-generation-run";
import { validateProposalOutline, type OutlineLeaf } from "@/lib/proposal-outline";
import { proposalOutlineMode } from "@/lib/proposal-pipeline-v2";
import type { Prisma } from "@prisma/client";

type ProductRow = Record<string, unknown> & {
  id?: string;
  name?: string;
  sku?: string | null;
  price?: string | number | null;
  currency?: string | null;
  unitOfMeasure?: string | null;
  billingFrequency?: string | null;
  unitLabel?: string | null;
  meterKey?: string | null;
  offers?: Array<{ meterKey?: string | null }>;
  addons?: Array<{
    id?: string;
    productId?: string;
    name?: string;
    pricingModel?: string;
    flatPrice?: number | null;
    unitPrice?: number | null;
    stepSize?: number | null;
    stepPrice?: number | null;
    tiers?: unknown;
    unitLabel?: string | null;
    meterKey?: string | null;
  }>;
};

export async function applyProposalV2PreWrite(input: {
  generationRunId?: string | null;
  organizationId: string;
  skeleton: OutlineLeaf[];
  requirementText: string;
  products: ProductRow[];
  profile?: unknown;
}): Promise<{
  skeleton: OutlineLeaf[];
  productsForWriter: ProductRow[];
  pricingTokens: string;
  dealBrief: string;
  sendBlocked: boolean;
}> {
  if (!input.generationRunId) {
    return {
      skeleton: input.skeleton,
      productsForWriter: input.products,
      pricingTokens: "",
      dealBrief: "",
      sendBlocked: false,
    };
  }

  const runId = input.generationRunId;
  const plan = await callAiServiceAgent<{
    source?: string;
    lines?: Array<{
      productId?: string;
      sku?: string | null;
      name?: string;
      productName?: string;
      quantity?: number;
      addonId?: string | null;
    }>;
    risks?: string[];
    assumptions?: string[];
  }>(
    "proposal-plan",
    {
      organizationId: input.organizationId,
      requirementText: input.requirementText,
      products: input.products,
      profile: input.profile,
    },
    { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS },
  );
  const lines = (Array.isArray(plan?.lines) ? plan.lines : []).map((row) => {
    const rec = row;
    return {
      productId: rec.productId,
      sku: rec.sku,
      name: rec.name || rec.productName || "",
      quantity: Number(rec.quantity),
      addonId: rec.addonId,
    };
  });

  const mode = proposalOutlineMode();
  let proposed: OutlineLeaf[] | null = null;
  if (mode !== "frozen") {
    const outline = await callAiServiceAgent<{ sections?: OutlineLeaf[] }>(
      "proposal-outline",
      {
        organizationId: input.organizationId,
        requirementText: input.requirementText,
        skeleton: input.skeleton,
      },
      { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS },
    );
    proposed = Array.isArray(outline?.sections) ? outline.sections : null;
  }
  const outline = validateProposalOutline({
    organizationId: input.organizationId,
    playbookLeaves: input.skeleton,
    proposed,
    mode,
  });

  const brief = await callAiServiceAgent<{
    summary?: string;
    closedFacts?: string[];
    audience?: string;
    source?: string;
  }>(
    "proposal-brief",
    {
      organizationId: input.organizationId,
      requirementText: input.requirementText,
      profile: input.profile,
      plan,
      outline: outline.sections,
    },
    { timeoutMs: AI_SERVICE_JOB_TIMEOUT_MS },
  );
  const dealBrief = [
    String(brief?.summary || "").trim(),
    ...(Array.isArray(brief?.closedFacts) ? brief.closedFacts.map(String) : []),
  ]
    .filter(Boolean)
    .join("\n");

  const catalogSnapshot = input.products.map((p) => ({
    id: String(p.id || ""),
    name: String(p.name || ""),
    sku: p.sku ? String(p.sku) : null,
    price: p.price ?? null,
    currency: p.currency ? String(p.currency) : null,
    unitOfMeasure: p.unitOfMeasure ?? null,
    billingFrequency: p.billingFrequency ?? null,
    addons: p.addons ?? [],
    offers: p.offers ?? [],
  }));

  await markProposalGenerationRun(runId, {
    dealPlan: {
      schemaVersion: 1,
      source: plan?.source || "heuristic",
      lines,
      risks: plan?.risks || [],
      assumptions: plan?.assumptions || [],
    } as Prisma.InputJsonValue,
    outline: outline as unknown as Prisma.InputJsonValue,
    pricingSnapshot: {
      schemaVersion: 2,
      source: "catalog",
      products: catalogSnapshot,
    } as Prisma.InputJsonValue,
    pricingIssues: {
      schemaVersion: 2,
      sendBlocked: false,
      issues: [],
    } as Prisma.InputJsonValue,
    dealBrief: {
      schemaVersion: 1,
      source: brief?.source || "heuristic",
      summary: brief?.summary || "",
      closedFacts: brief?.closedFacts || [],
      audience: brief?.audience || "",
    } as Prisma.InputJsonValue,
  }).catch(() => undefined);

  return {
    skeleton: outline.sections,
    productsForWriter: input.products,
    pricingTokens: "",
    dealBrief,
    sendBlocked: false,
  };
}
